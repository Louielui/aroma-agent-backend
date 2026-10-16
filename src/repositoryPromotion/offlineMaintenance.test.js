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
  fs.writeFileSync(path.join(root, 'old-entry.cjs'), "require('node:fs').writeFileSync(require('node:path').join(__dirname,'protected','initialized'),'old application initialization')")
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
  function controller (db) { return createMaintenance({ root, ownerPassword: () => password, serviceCredentials: () => ['fixture-service-token'], jobs: db.inventory || [...jobs], probe, database: { data: path.join(root, 'pg'), port: db.port, recoveryPort: db.recoveryPort, recoveryJob: db.recoveryJob, psql: path.join(pgBin, 'psql.exe'), pgctl: path.join(pgBin, 'pg_ctl.exe'), job: db.job || jobs[jobs.length - 1] }, source }) }
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

async function databaseFixture () {
  const f = setup()
  const data = path.join(f.root, 'pg')
  const server = require('node:net').createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let port = server.address().port
  await new Promise(resolve => server.close(resolve))
  // Windows ephemeral allocation can be below the fixture-only admission range.
  if (port < 49152) port += 16384
  const recoveryPort = port === 65535 ? port - 1 : port + 1
  const sql = (text, target = port) => cp.execFileSync(path.join(pgBin, 'psql.exe'), ['-X', '-h', '127.0.0.1', '-p', String(target), '-U', 'fixture', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', text], { windowsHide: true, timeout: 15000, stdio: 'pipe' })
  f.gate().initialize(credentials)
  const application = f.launch(process.execPath, [fixture, f.root, 'new'])
  await application.ready(); await until(() => f.probeJob(application.name).active === 0)
  fs.writeFileSync(path.join(f.root, 'protected', 'finished'), '')
  const start = Date.parse('2026-01-01T00:00:00Z')
  fs.writeFileSync(path.join(f.root, 'protected', 'company-access.json'), JSON.stringify({ version: 1, adminMailboxRegistered: true, tenantDomain: 'fixture.invalid',
    users: [{ id: 'owner', role: 'owner', grants: ['admin-mail'], sub: 'synthetic-identity', suspended: false }], principals: ['synthetic'], revision: 500,
    sources: [{ id: 'admin-mail', kind: 'mail', state: 'connected', mailbox: 'synthetic@fixture.invalid', checkedAt: new Date(start + 499000).toISOString() }],
    audit: Array.from({ length: 500 }, (_, i) => ({ id: randomUUID(), at: new Date(start + i * 1000).toISOString(), revision: i + 1, actor: 'owner', action: 'mail_connected', target: 'admin-mail' })) }))
  for (let i = 0; i < 545; i++) fs.writeFileSync(path.join(f.root, 'protected', 'fixed-' + i), 'synthetic protected bytes')
  try {
    cp.execFileSync(path.join(pgBin, 'initdb.exe'), ['-D', data, '-U', 'fixture', '-A', 'trust', '--no-locale'], { windowsHide: true, stdio: 'pipe', timeout: 30000 })
    const db = f.launch(path.join(pgBin, 'postgres.exe'), ['-D', data, '-p', String(port), '-h', '127.0.0.1'])
    await db.ready(); await until(() => { try { sql('SELECT 1'); return true } catch { return false } })
    sql("CREATE TABLE records(id int PRIMARY KEY,value text); CREATE TABLE audit(id int PRIMARY KEY,value text); CREATE TABLE principals(id int PRIMARY KEY,value text); CREATE TABLE access_audit(id int PRIMARY KEY,value text); CREATE TABLE async_operations(id int PRIMARY KEY,state text); INSERT INTO records VALUES(1,'synthetic memory'); INSERT INTO audit VALUES(1,'synthetic audit'); INSERT INTO principals VALUES(1,'synthetic-private-value'); INSERT INTO access_audit VALUES(1,'synthetic authorization history');")
    const recovery = f.launch(process.execPath, ['-e', 'setTimeout(()=>{},10)'])
    await recovery.ready(); await until(() => f.probeJob(recovery.name).active === 0)
    const configuration = { port, job: db.name, recoveryPort, recoveryJob: recovery.name }
    const make = () => f.controller(configuration)
    async function startClone () {
      const child = f.launch(path.join(pgBin, 'postgres.exe'), ['-D', path.join(f.root, 'recovery-pg'), '-p', String(recoveryPort), '-h', '127.0.0.1'], recovery.name)
      await child.ready(); await until(() => { try { sql('SELECT 1', recoveryPort); return true } catch { return false } })
    }
    async function close () {
      for (const dir of [data, path.join(f.root, 'recovery-pg')]) if (fs.existsSync(path.join(dir, 'postmaster.pid'))) cp.execFileSync(path.join(pgBin, 'pg_ctl.exe'), ['-D', dir, 'stop', '-m', 'smart', '-w', '-t', '10'], { windowsHide: true, timeout: 20000, stdio: 'pipe' })
      await f.close()
    }
    return { f, data, make, configuration, sql, startClone, close, application }
  } catch (error) {
    if (fs.existsSync(path.join(data, 'postmaster.pid'))) cp.execFileSync(path.join(pgBin, 'pg_ctl.exe'), ['-D', data, 'stop', '-m', 'smart', '-w', '-t', '10'], { windowsHide: true, timeout: 20000, stdio: 'pipe' })
    await f.close(); throw error
  }
}

async function freeze (context) {
  const maintenance = context.make()
  const draining = maintenance.prepare({ ...credentials, run: randomUUID(), expectedGeneration: 0 })
  const request = { ...credentials, run: draining.run, expectedGeneration: draining.generation }
  await maintenance.drain(request)
  maintenance.stopMemory(request)
  const frozen = maintenance.freeze(request)
  return { maintenance, request: { ...request, expectedGeneration: frozen.generation } }
}

for (const rollback of [false, true]) test('integrated G2/G3/G4 complete encrypted snapshot, clone recovery and ' + (rollback ? 'forward rollback' : 'promotion'), { timeout: 180000 }, async () => {
  const context = await databaseFixture(), { f } = context
  try {
    // A real leased detached descendant finishes after the parent exits.
    const child = f.launch(process.execPath, [fixture, f.root, 'leased-descendant'], context.application.name)
    await child.ready(); await until(() => fs.existsSync(path.join(f.root, 'child-ready')))
    const { maintenance, request } = await freeze(context)
    assert.equal(fs.readFileSync(path.join(f.root, 'protected', 'finished'), 'utf8'), 'descendant final persistence')
    assert.equal(Object.keys(maintenance.snapshot()).length, 549)
    for (const mode of ['new', 'rollback']) {
      const attempt = f.launch(process.execPath, [fixture, f.root, mode], context.application.name)
      await attempt.ready(); await until(() => f.probeJob(context.application.name).active === 0)
    }
    assert.deepEqual(maintenance.promote(request), { commit: f.source.candidate, tree: f.source.candidateTree })
    if (rollback) assert.deepEqual(maintenance.rollback(request), { commit: f.source.rollback, tree: f.source.rollbackTree })
    const protectedBefore = maintenance.snapshot()
    maintenance.prepareRecovery(request); await context.startClone()
    const rebuilt = context.make()
    rebuilt.verifyRecovery(request); rebuilt.stopRecovery(request)
    assert.deepEqual(rebuilt.snapshot(), protectedBefore)
    const journal = JSON.parse(fs.readFileSync(path.join(f.root, 'maintenance.json')))
    assert.ok(journal.seal && journal.recovered && journal.recoveryStopped)
    assert.equal(JSON.stringify(journal).includes('synthetic-private-value'), false)
    for (const name of fs.readdirSync(path.join(f.root, 'snapshots'))) assert.equal(fs.readFileSync(path.join(f.root, 'snapshots', name)).includes(Buffer.from('synthetic-private-value')), false)
    assert.throws(() => rebuilt.releaseStopped({ ...request, password: 'fixture-service-token' }), /unauthorized/)
    assert.equal(rebuilt.releaseStopped(request).phase, 'open')
    fs.writeFileSync(path.join(f.root, 'lifecycle-evidence.json'), JSON.stringify({ kind: 'disposable-only', root: f.root, protectedCount: 549, run: request.run, source: f.git('rev-parse', 'HEAD'), tree: f.git('rev-parse', 'HEAD^{tree}'), stages: JSON.parse(fs.readFileSync(path.join(f.root, 'maintenance.json'))).stages }, null, 2))
    const reopened = f.launch(process.execPath, [fixture, f.root, 'new'], context.application.name)
    await reopened.ready(); await until(() => f.probeJob(context.application.name).active === 0)
  } finally { await context.close() }
})

test('snapshot failure is durable across controller reconstruction', async () => {
  const f = setup()
  try {
    f.gate().initialize(credentials)
    const worker = f.launch(process.execPath, ['-e', 'setTimeout(()=>{},10)'])
    await worker.ready(); await until(() => f.probeJob(worker.name).active === 0)
    const maintenance = f.controller({ port: 55439 })
    const state = maintenance.prepare({ ...credentials, run: randomUUID(), expectedGeneration: 0 })
    assert.throws(() => maintenance.capture({ ...credentials, run: state.run, expectedGeneration: state.generation }))
    assert.equal(f.controller({ port: 55439 }).status().maintenanceFailed, true)
    assert.equal(f.gate().status().phase, 'draining')
  } finally { await f.close() }
})

for (const scenario of ['invalid-authorization', 'pending-consent', 'active-timeout', 'service-crash', 'unknown-job', 'corrupt-gate']) test('integrated closed maintenance refuses ' + scenario, async () => {
  const f = setup()
  let lease
  try {
    f.gate().initialize(credentials)
    const worker = f.launch(process.execPath, scenario === 'service-crash' ? [fixture, f.root, 'crash'] : ['-e', 'setTimeout(()=>{},10)'])
    await worker.ready(); await until(() => f.probeJob(worker.name).active === 0)
    if (scenario === 'pending-consent') fs.writeFileSync(path.join(f.root, 'protected', 'tasks.json'), '[{"id":"synthetic","state":"awaiting_consent"}]')
    if (scenario === 'active-timeout') lease = f.gate().admit('offline-host')
    const configuration = { port: 55439, inventory: scenario === 'unknown-job' ? [...f.jobs, 'imagine-fixture-' + randomUUID()] : [...f.jobs] }
    const maintenance = f.controller(configuration)
    if (scenario === 'invalid-authorization') {
      fs.writeFileSync(path.join(f.root, 'protected', 'company-access.json'), '{}')
      assert.throws(() => maintenance.prepare({ ...credentials, run: randomUUID(), expectedGeneration: 0 }), /authorization_reference_invalid/)
      assert.equal(maintenance.status().phase, 'draining'); assert.equal(maintenance.status().maintenanceFailed, true)
      return
    }
    const state = maintenance.prepare({ ...credentials, run: randomUUID(), expectedGeneration: 0 })
    const request = { ...credentials, run: state.run, expectedGeneration: state.generation }
    if (scenario === 'corrupt-gate') fs.writeFileSync(path.join(f.root, 'gate', 'gate.json'), '{')
    if (['active-timeout', 'service-crash'].includes(scenario)) await assert.rejects(maintenance.drain(request, 30), /drain_window_expired/)
    else assert.throws(() => maintenance.capture(request))
    assert.equal(fs.existsSync(path.join(f.root, 'maintenance.failed.json')), true)
    assert.throws(() => f.controller(configuration).promote(request), /maintenance_attempt_failed/)
    if (scenario !== 'corrupt-gate') assert.equal(f.gate().status().phase, 'draining')
    for (const mode of ['new', 'rollback']) {
      const attempt = f.launch(process.execPath, [fixture, f.root, mode], worker.name)
      await attempt.ready(); await until(() => f.probeJob(worker.name).active === 0)
    }
    assert.equal(fs.existsSync(path.join(f.root, 'protected', 'initialized')), false)
  } finally { if (lease) lease.finish(); await f.close() }
})

for (const mutation of ['authorization-metadata', 'unknown-file', 'snapshot-corruption', 'source-drift']) test('isolated mutation persists failure after bytes are restored: ' + mutation, { timeout: 180000 }, async () => {
  const context = await databaseFixture(), { f } = context
  try {
    const { maintenance, request } = await freeze(context)
    let target = path.join(f.root, 'protected', 'company-access.json'), before
    if (mutation === 'authorization-metadata') {
      before = fs.readFileSync(target)
      const state = JSON.parse(before), at = new Date().toISOString()
      state.revision++; state.sources[0].checkedAt = at
      state.audit.push({ id: randomUUID(), actor: 'owner', action: 'mail_connected', target: 'admin-mail', revision: state.revision, at }); state.audit = state.audit.slice(-500)
      fs.writeFileSync(target, JSON.stringify(state))
      const retention = require(path.join(os.homedir(), '.imagine/gmail-reply-e1-packaging-repair-20261015/controlled-promotion-a8f05ce/preservation-option-a-v1/verify.cjs'))
      assert.equal(retention.verify(before, fs.readFileSync(target)).pass, true, 'a valid normal-operation pattern is still forbidden after isolation')
    } else if (mutation === 'unknown-file') {
      target = path.join(f.root, 'protected', 'unexpected'); fs.writeFileSync(target, 'unknown writer')
    } else if (mutation === 'snapshot-corruption') {
      const journal = JSON.parse(fs.readFileSync(path.join(f.root, 'maintenance.json')))
      target = path.join(f.root, 'snapshots', journal.seal.file); before = fs.readFileSync(target); fs.writeFileSync(target, 'corrupt')
    } else { target = path.join(f.sourceRoot, 'unexpected'); fs.writeFileSync(target, 'source drift') }
    assert.throws(() => maintenance.promote(request))
    if (before) fs.writeFileSync(target, before); else fs.unlinkSync(target)
    assert.equal(context.make().status().maintenanceFailed, true)
    assert.throws(() => context.make().releaseStopped(request), /maintenance_attempt_failed/)
    assert.equal(f.gate().status().phase, 'frozen')
  } finally { await context.close() }
})

for (const table of ['records', 'audit', 'principals', 'access_audit']) test('clone recovery rejects logical ' + table + ' mutation without reverting original history', { timeout: 180000 }, async () => {
  const context = await databaseFixture()
  try {
    const { maintenance, request } = await freeze(context)
    maintenance.promote(request); maintenance.prepareRecovery(request); await context.startClone()
    context.sql("UPDATE " + table + " SET value='unexpected'", context.configuration.recoveryPort)
    assert.throws(() => maintenance.verifyRecovery(request), /logical_preservation_failed/)
    assert.equal(context.make().status().maintenanceFailed, true)
    assert.throws(() => context.make().releaseStopped(request), /maintenance_attempt_failed/)
    assert.equal(context.f.gate().status().phase, 'frozen')
    assert.equal(fs.existsSync(path.join(context.data, 'postmaster.pid')), false)
  } finally { await context.close() }
})

for (const mutation of ['pending-memory', 'unknown-schema', 'pre-isolation-grant', 'physical-database', 'premature-release']) test('incomplete preservation blocks the integrated controller: ' + mutation, { timeout: 180000 }, async () => {
  const context = await databaseFixture(), { f } = context
  try {
    if (mutation === 'pre-isolation-grant') {
      const maintenance = context.make(), draining = maintenance.prepare({ ...credentials, run: randomUUID(), expectedGeneration: 0 })
      const target = path.join(f.root, 'protected', 'company-access.json'), state = JSON.parse(fs.readFileSync(target))
      state.users[0].grants.push('unexpected'); fs.writeFileSync(target, JSON.stringify(state))
      assert.throws(() => maintenance.capture({ ...credentials, run: draining.run, expectedGeneration: draining.generation }), /pre_isolation_authorization_unexplained/)
    } else if (mutation === 'pending-memory' || mutation === 'unknown-schema') {
      context.sql(mutation === 'pending-memory' ? "INSERT INTO async_operations VALUES(1,'processing')" : 'CREATE TABLE unknown_writer(id int)')
      await assert.rejects(freeze(context))
    } else {
      const { maintenance, request } = await freeze(context)
      if (mutation === 'physical-database') fs.writeFileSync(path.join(context.data, 'unknown-writer'), 'unexplained')
      assert.throws(() => maintenance.releaseStopped(request))
    }
    assert.equal(context.make().status().maintenanceFailed, true)
    assert.notEqual(f.gate().status().phase, 'open')
  } finally { await context.close() }
})

test('maintenance host crash leaves an unreconciled operation and external startup closed', { timeout: 30000 }, async () => {
  const f = setup()
  let lease
  try {
    f.gate().initialize(credentials)
    const worker = f.launch(process.execPath, ['-e', 'setTimeout(()=>{},10)'])
    await worker.ready(); await until(() => f.probeJob(worker.name).active === 0)
    lease = f.gate().admit('offline-host')
    const maintenance = f.controller({ port: 55439 })
    const state = maintenance.prepare({ ...credentials, run: randomUUID(), expectedGeneration: 0 })
    const config = { root: f.root, jobs: [...f.jobs], probe: f.probe, database: { data: path.join(f.root, 'pg'), port: 55439, psql: path.join(pgBin, 'psql.exe'), pgctl: path.join(pgBin, 'pg_ctl.exe'), job: worker.name }, source: f.source }
    const configPath = path.join(f.root, 'host-config.json'); fs.writeFileSync(configPath, JSON.stringify(config))
    const script = "const fs=require('fs');const c=JSON.parse(fs.readFileSync(process.argv[1]));c.ownerPassword=()=> 'fixture-owner-password';c.serviceCredentials=()=>['fixture-service-token'];const m=require(process.argv[2]).createMaintenance(c);const s=m.status();m.drain({password:'fixture-owner-password',run:s.run,expectedGeneration:s.generation},60000).catch(()=>{});setTimeout(()=>process.reallyExit(31),50)"
    const child = cp.spawn(process.execPath, ['-e', script, configPath, path.join(__dirname, 'offlineMaintenance.js')], { windowsHide: true, stdio: 'ignore' })
    const exit = await new Promise(resolve => child.once('exit', resolve)); assert.equal(exit, 31)
    assert.equal(maintenance.status().maintenanceFailed, true)
    assert.throws(() => f.controller({ port: 55439 }).freeze({ ...credentials, run: state.run, expectedGeneration: state.generation }), /maintenance_operation_unreconciled/)
    for (const mode of ['new', 'rollback']) {
      const attempt = f.launch(process.execPath, [fixture, f.root, mode], worker.name)
      await attempt.ready(); await until(() => f.probeJob(worker.name).active === 0)
    }
    assert.equal(fs.existsSync(path.join(f.root, 'protected', 'initialized')), false)
  } finally { if (lease) lease.finish(); await f.close() }
})
