'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const cp = require('node:child_process')
const { createMaintenance } = require('./offlineMaintenance')
const { createGate } = require('./quiescence')
const password = 'fixture-owner-password'
const credentials = { password }
const csc = 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe'
const pgBin = 'C:/Users/louis/.pg0/installation/18.1.0/bin'
const fixture = path.join(__dirname, 'offlineMaintenance.fixture.cjs')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until (predicate, ms = 10000) {
  const end = Date.now() + ms
  while (!predicate()) { if (Date.now() >= end) throw Error('fixture_deadline'); await sleep(40) }
}
function setup () {
  const root = path.join(fs.realpathSync(os.tmpdir()), 'imagine-offline-' + randomUUID())
  fs.mkdirSync(path.join(root, 'protected'), { recursive: true })
  fs.writeFileSync(path.join(root, 'protected', 'tasks.json'), '[]')
  fs.writeFileSync(path.join(root, 'entry.cjs'), "require('node:fs').writeFileSync(require('node:path').join(__dirname,'protected','initialized'),'application initialization')")
  const probe = path.join(root, 'job.exe')
  cp.execFileSync(csc, ['/nologo', '/out:' + probe, path.resolve(__dirname, '../../scripts/repository/OfflineFixtureJob.cs')], { windowsHide: true })
  const jobs = []
  const hosts = []
  const hostJobs = []
  const sourceRoot = path.join(root, 'source'); fs.mkdirSync(sourceRoot)
  const git = (...args) => cp.execFileSync('git', ['-c', 'core.hooksPath=', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-C', sourceRoot, ...args], { encoding: 'utf8', windowsHide: true }).trim()
  git('init', '-q'); fs.writeFileSync(path.join(sourceRoot, 'app.txt'), 'old'); git('add', '.'); git('commit', '-qm', 'fixture old')
  const initial = git('rev-parse', 'HEAD'), rollbackTree = git('rev-parse', 'HEAD^{tree}')
  fs.writeFileSync(path.join(sourceRoot, 'app.txt'), 'new'); git('add', '.'); git('commit', '-qm', 'fixture new')
  const candidate = git('rev-parse', 'HEAD'), candidateTree = git('rev-parse', 'HEAD^{tree}')
  const rollback = git('commit-tree', rollbackTree, '-p', candidate, '-m', 'fixture forward rollback')
  git('checkout', '-q', '--detach', initial)
  const source = { initial, candidate, candidateTree, rollback, rollbackTree }
  function launch (exe, args, existing) {
    const name = existing || 'imagine-fixture-' + randomUUID()
    const host = cp.spawn(probe, [existing ? 'join' : 'launch', name, exe, ...args], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', error = ''; host.stdout.on('data', b => { out += b }); host.stderr.on('data', b => { error += b })
    host.on('error', e => { error += e.message })
    if (!existing) jobs.push(name); hosts.push(host); hostJobs.push(name)
    return { name, host, ready: async () => { await until(() => out.includes('\n') || host.exitCode !== null); if (!out.includes('\n')) throw Error(error); return JSON.parse(out.split('\n')[0]).pid } }
  }
  function probeJob (name) { return JSON.parse(cp.execFileSync(probe, ['probe', name], { encoding: 'utf8', windowsHide: true })) }
  function gate () { return createGate({ directory: path.join(root, 'gate'), participants: ['offline-host'], ownerPassword: () => password, serviceCredentials: () => ['fixture-service-token'] }) }
  function controller (db) { return createMaintenance({ root, ownerPassword: () => password, serviceCredentials: () => ['fixture-service-token'], jobs: [...jobs], probe, database: { data: path.join(root, 'pg'), port: db.port, psql: path.join(pgBin, 'psql.exe'), pgctl: path.join(pgBin, 'pg_ctl.exe'), job: db.job || jobs[jobs.length - 1] }, source }) }
  async function close () {
    for (let i = 0; i < hosts.length; i++) {
      await until(() => probeJob(hostJobs[i]).active === 0)
      hosts[i].stdin.end('release\n')
      await until(() => hosts[i].exitCode !== null)
    }
    // Evidence is intentionally retained under a disposable temp root.
  }
  return { root, probe, jobs, launch, probeJob, gate, controller, close, source, sourceRoot, git }
}

test('offline gate uses actual Windows Job descendants, refuses unknown jobs and has no forced cancellation', async () => {
  const f = setup()
  try {
    f.gate().initialize(credentials)
    const worker = f.launch(process.execPath, [fixture, f.root, 'descendant'])
    await worker.ready()
    await sleep(200)
    assert.ok(f.probeJob(worker.name).active > 0, 'orphaned descendant stays in the actual named Job')
    assert.equal(f.probeJob(worker.name).limitFlags, 0, 'no breakaway and no kill-on-close')
    assert.throws(() => f.probeJob('imagine-fixture-' + randomUUID()))
    await until(() => f.probeJob(worker.name).active === 0)
    assert.equal(fs.readFileSync(path.join(f.root, 'protected', 'delayed'), 'utf8'), 'delayed')
  } finally { await f.close() }
})

test('draining blocks old/new startup before writes, lets admitted final persistence complete and refuses stale leases', async () => {
  const f = setup()
  try {
    const gate = f.gate(); gate.initialize(credentials)
    const active = f.launch(process.execPath, [fixture, f.root, 'hold']); await active.ready()
    await until(() => fs.existsSync(path.join(f.root, 'ready')))
    const state = gate.prepare({ ...credentials, run: randomUUID(), expectedGeneration: 0 })
    assert.equal(state.leases.length, 1)
    assert.throws(() => gate.admit('offline-host'), /deployment_draining/)
    for (const version of ['new', 'rollback']) {
      const attempt = f.launch(process.execPath, [fixture, f.root, version]); await attempt.ready()
      await until(() => f.probeJob(attempt.name).active === 0)
    }
    assert.equal(fs.existsSync(path.join(f.root, 'protected', 'initialized')), false)
    await until(() => f.probeJob(active.name).active === 0)
    assert.equal(fs.readFileSync(path.join(f.root, 'protected', 'finished'), 'utf8'), 'complete')
    assert.equal(f.gate().status().phase, 'draining', 'restart does not open the latch')
    assert.equal(f.gate().status().leases.length, 0)
    assert.throws(() => gate.freeze({ ...credentials, run: state.run, expectedGeneration: state.generation }), /participants_unconfirmed/)
  } finally { await f.close() }
})

test('real HTTP side-effecting GET and consent POST refuse during drain, read-only survives and authenticated stop drains the Job', async () => {
  const f = setup()
  let port
  const request = (route, method = 'GET', authorization = 'Bearer fixture-service-token') => new Promise((resolve, reject) => {
    const req = require('node:http').request({ host: '127.0.0.1', port, path: route, method, headers: { authorization } }, res => {
      let body = ''; res.on('data', b => { body += b }); res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.on('error', reject); req.end()
  })
  try {
    const gate = f.gate(); gate.initialize(credentials)
    const host = f.launch(process.execPath, [fixture, f.root, 'http']); await host.ready()
    await until(() => fs.existsSync(path.join(f.root, 'http-port')))
    port = Number(fs.readFileSync(path.join(f.root, 'http-port')))
    const admitted = request('/write')
    await until(() => gate.status().leases.length === 1)
    gate.prepare({ ...credentials, run: randomUUID(), expectedGeneration: 0 })
    assert.equal((await request('/write')).status, 503)
    assert.equal((await request('/consent', 'POST')).status, 503)
    assert.equal((await request('/read')).body, '[]')
    assert.equal((await request('/stop', 'POST')).status, 403)
    assert.equal((await admitted).status, 200)
    assert.equal(fs.readFileSync(path.join(f.root, 'protected', 'http-complete'), 'utf8'), 'GET')
    assert.equal((await request('/stop', 'POST', 'Owner fixture-owner-password')).status, 200)
    await until(() => f.probeJob(host.name).active === 0)
  } finally { await f.close() }
})

test('real disposable PostgreSQL smart shutdown, logical preservation, negative release and durable freeze', { timeout: 120000 }, async () => {
  const f = setup()
  const data = path.join(f.root, 'pg')
  const server = require('node:net').createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let port = server.address().port
  await new Promise(resolve => server.close(resolve))
  // Windows ephemeral allocation can be below the fixture-only admission range.
  if (port < 49152) port += 16384
  const pgctl = (...args) => cp.execFileSync(path.join(pgBin, 'pg_ctl.exe'), ['-D', data, ...args], { windowsHide: true, timeout: 20000, stdio: 'pipe' })
  const sql = text => cp.execFileSync(path.join(pgBin, 'psql.exe'), ['-X', '-h', '127.0.0.1', '-p', String(port), '-U', 'fixture', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', text], { windowsHide: true, timeout: 15000, stdio: 'pipe' })
  let running = false
  let databaseJob
  try {
    f.gate().initialize(credentials)
    const application = f.launch(process.execPath, [fixture, f.root, 'new'])
    await application.ready(); await until(() => f.probeJob(application.name).active === 0)
    assert.equal(fs.readFileSync(path.join(f.root, 'protected', 'initialized'), 'utf8'), 'application initialization')
    cp.execFileSync(path.join(pgBin, 'initdb.exe'), ['-D', data, '-U', 'fixture', '-A', 'trust', '--no-locale'], { windowsHide: true, stdio: 'pipe', timeout: 30000 })
    async function start () {
      const db = f.launch(path.join(pgBin, 'postgres.exe'), ['-D', data, '-p', String(port), '-h', '127.0.0.1'], databaseJob)
      databaseJob = db.name
      await db.ready(); running = true
      await until(() => { try { sql('SELECT 1'); return true } catch { return false } })
    }
    await start()
    sql('CREATE TABLE records(id int PRIMARY KEY, value text); CREATE TABLE audit(id int PRIMARY KEY, value text); CREATE TABLE principals(id int PRIMARY KEY, value text); CREATE TABLE access_audit(id int PRIMARY KEY, value text); CREATE TABLE async_operations(id int PRIMARY KEY, state text); INSERT INTO records VALUES(1,\'synthetic memory\'); INSERT INTO audit VALUES(1,\'synthetic audit\'); INSERT INTO principals VALUES(1,\'synthetic Owner\'); INSERT INTO access_audit VALUES(1,\'synthetic authorization history\');')
    let maintenance = f.controller({ port }); maintenance.initialize(credentials)
    assert.throws(() => maintenance.prepare({ password: 'fixture-service-token', run: randomUUID(), expectedGeneration: 0 }), /unauthorized/)
    const unfinished = f.gate().admit('offline-host')
    const draining = maintenance.prepare({ ...credentials, run: randomUUID(), expectedGeneration: 0 })
    const request = { ...credentials, run: draining.run, expectedGeneration: draining.generation }
    await assert.rejects(maintenance.drain(request, 30), /drain_window_expired/)
    assert.equal(maintenance.status().phase, 'draining')
    unfinished.finish()
    fs.writeFileSync(path.join(f.root, 'protected', 'tasks.json'), '[{"id":"pending","state":"awaiting_consent"}]')
    assert.throws(() => maintenance.capture(request), /pending_or_unknown_task/)
    fs.writeFileSync(path.join(f.root, 'protected', 'tasks.json'), '[]')
    sql("INSERT INTO async_operations VALUES(1,'processing')")
    assert.throws(() => maintenance.capture(request), /memory_work_pending/)
    sql('DELETE FROM async_operations')
    const stuck = f.gate().admit // admission after prepare is still refused
    assert.throws(() => stuck('offline-host'), /deployment_draining/)
    await maintenance.drain(request)
    assert.throws(() => maintenance.freeze(request), /writers_not_isolated/)
    maintenance.stopMemory(request); running = false
    await until(() => f.jobs.every(name => f.probeJob(name).active === 0))
    const frozen = maintenance.freeze(request)
    const release = { ...request, expectedGeneration: frozen.generation }
    for (const mode of ['new', 'rollback']) {
      const denied = f.launch(process.execPath, [fixture, f.root, mode], application.name)
      await denied.ready(); await until(() => f.probeJob(application.name).active === 0)
      assert.equal(fs.readFileSync(path.join(f.root, 'protected', 'initialized'), 'utf8'), 'application initialization')
    }
    fs.writeFileSync(path.join(f.sourceRoot, 'unexpected'), 'unreviewed')
    assert.throws(() => maintenance.promote(release), /source_dirty/)
    fs.unlinkSync(path.join(f.sourceRoot, 'unexpected'))
    assert.deepEqual(maintenance.promote(release), { commit: f.source.candidate, tree: f.source.candidateTree })
    assert.throws(() => maintenance.releaseStopped(release), /recovery_unverified/)
    assert.throws(() => maintenance.releaseStopped({ ...release, password: 'fixture-service-token' }), /unauthorized/)
    assert.equal(f.gate().status().phase, 'frozen')
    assert.deepEqual(maintenance.rollback(release), { commit: f.source.rollback, tree: f.source.rollbackTree })
    await start()
    maintenance = f.controller({ port })
    for (const [table, value] of Object.entries({ records: 'synthetic memory', audit: 'synthetic audit', principals: 'synthetic Owner', access_audit: 'synthetic authorization history' })) {
      sql(`UPDATE ${table} SET value='unexpected'`)
      assert.throws(() => maintenance.verifyRecovery(release), /logical_preservation_failed/)
      // Restore only this disposable negative fixture; never production records.
      sql(`UPDATE ${table} SET value='${value}'`)
    }
    maintenance.verifyRecovery(release)
    maintenance.stopMemory(release); running = false
    await until(() => f.jobs.every(name => f.probeJob(name).active === 0))
    fs.writeFileSync(path.join(data, 'unexpected-memory-file'), 'unknown writer')
    assert.throws(() => maintenance.releaseStopped(release), /database_preservation_failed/)
    fs.unlinkSync(path.join(data, 'unexpected-memory-file'))
    fs.writeFileSync(path.join(f.root, 'protected', 'unrelated'), 'unexpected')
    assert.throws(() => maintenance.releaseStopped(release), /recovery_unverified/)
    fs.unlinkSync(path.join(f.root, 'protected', 'unrelated'))
    assert.equal(maintenance.releaseStopped(release).phase, 'open')
    const reopened = f.launch(process.execPath, [fixture, f.root, 'new'], application.name)
    await reopened.ready(); await until(() => f.probeJob(application.name).active === 0)
    assert.equal(f.gate().status().leases.length, 0)
  } finally {
    if (running) { pgctl('stop', '-m', 'smart', '-w', '-t', '10'); running = false }
    await f.close()
  }
})
