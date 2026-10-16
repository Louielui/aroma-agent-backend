'use strict'

// Host-only composition of the existing protocol. Deliberately fixture-scoped:
// no Windows service, production database or installed launcher adapter exists.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { createGate } = require('./quiescence')
const { command } = require('./repository')
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const canonical = value => JSON.stringify(value)

function regular (file) {
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error('untrusted_file')
  return fs.readFileSync(file)
}
function snapshot (root) {
  if (!fs.lstatSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink()) throw Error('untrusted_file')
  const result = {}
  function walk (directory, prefix) {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name), relative = prefix + name, stat = fs.lstatSync(file)
      if (stat.isSymbolicLink()) throw Error('untrusted_file')
      if (stat.isDirectory()) walk(file, relative + '/')
      else result[relative] = digest(regular(file))
    }
  }
  walk(root, '')
  return result
}

function createMaintenance ({ root, ownerPassword, serviceCredentials, jobs, probe, database, source }) {
  // This is a safety boundary, not a claim that a path name grants permissions.
  // Production integration needs a separately approved immutable host binding.
  const real = fs.realpathSync(root)
  if (process.platform !== 'win32' || real !== path.resolve(root) ||
      path.dirname(real) !== fs.realpathSync(os.tmpdir()) || !/^imagine-offline-[a-f0-9-]{36}$/.test(path.basename(real))) throw Error('disposable_scope_required')
  if (!Array.isArray(jobs) || !jobs.length || new Set(jobs).size !== jobs.length || jobs.some(x => !/^imagine-fixture-[a-f0-9-]{36}$/.test(x))) throw Error('invalid_job_inventory')
  const pins = new Map([probe, database.psql, database.pgctl].map(file => [file, digest(regular(file))]))
  if (!source || ['initial', 'candidate', 'rollback', 'candidateTree', 'rollbackTree'].some(k => !/^[a-f0-9]{40}$/.test(source[k] || ''))) throw Error('source_identity_required')
  const sourceRoot = path.join(real, 'source')
  if (fs.realpathSync(sourceRoot) !== sourceRoot || !fs.lstatSync(path.join(sourceRoot, '.git')).isDirectory() || fs.lstatSync(path.join(sourceRoot, '.git')).isSymbolicLink()) throw Error('disposable_source_required')
  const configuration = digest(canonical({ jobs, pins: [...pins], database, source }))
  const protectedRoot = path.join(real, 'protected')
  const gate = createGate({ directory: path.join(real, 'gate'), participants: ['offline-host'], ownerPassword, serviceCredentials })
  const journal = path.join(real, 'maintenance.json')
  function pinned (file, args) {
    if (digest(regular(file)) !== pins.get(file)) throw Error('tool_identity_changed')
    return execFileSync(file, args, { encoding: 'utf8', timeout: 15000, windowsHide: true, env: { SystemRoot: process.env.SystemRoot, PATH: path.dirname(file), TEMP: os.tmpdir() } }).trim()
  }
  function authorize (request) {
    const { passwordMatches, MIN_PASSWORD_CHARS } = require('../governance/ownerAuth')
    const secret = ownerPassword()
    if (typeof secret !== 'string' || secret.length < MIN_PASSWORD_CHARS || !passwordMatches(request?.password, secret) || serviceCredentials().some(token => typeof token === 'string' && passwordMatches(request?.password, token))) throw Error('deployment_control_unauthorized')
  }
  function logicalMemory () {
    // Fixed read-only SQL; no caller SQL and no production connection settings.
    const data = fs.realpathSync(database.data)
    if (data !== path.join(real, 'pg') || database.port < 49152 || database.port > 65535 || !Number.isInteger(database.port)) throw Error('disposable_database_required')
    const pid = regular(path.join(data, 'postmaster.pid')).toString().split(/\r?\n/)
    if (path.resolve(pid[1]) !== data || Number(pid[3]) !== database.port) throw Error('database_identity_changed')
    const sql = "BEGIN READ ONLY; SELECT json_build_object('records',(SELECT coalesce(json_agg(t ORDER BY id),'[]') FROM records t),'audit',(SELECT coalesce(json_agg(t ORDER BY id),'[]') FROM audit t),'principals',(SELECT coalesce(json_agg(t ORDER BY id),'[]') FROM principals t),'access_audit',(SELECT coalesce(json_agg(t ORDER BY id),'[]') FROM access_audit t),'operations',(SELECT coalesce(json_agg(t ORDER BY id),'[]') FROM async_operations t),'otherClients',(SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid()),'dataDirectory',current_setting('data_directory'),'port',current_setting('port')); COMMIT;"
    const out = pinned(database.psql, ['-X', '-q', '-A', '-t', '-h', '127.0.0.1', '-p', String(database.port), '-U', 'fixture', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql])
    const observed = JSON.parse(out)
    if (observed.otherClients !== 0 || path.resolve(observed.dataDirectory) !== data || Number(observed.port) !== database.port) throw Error('independent_writer_unconfirmed')
    if (observed.operations.some(op => !['completed', 'failed'].includes(op.state))) throw Error('memory_work_pending')
    return observed
  }
  function taskIdle () {
    const tasks = JSON.parse(regular(path.join(protectedRoot, 'tasks.json')))
    if (!Array.isArray(tasks) || tasks.some(t => !t || typeof t.id !== 'string' || !['completed', 'interrupted', 'cancelled'].includes(t.state))) throw Error('pending_or_unknown_task')
  }
  function isolated (exceptDatabase = false) {
    for (const job of jobs) {
      if (exceptDatabase && job === database.job) continue
      const result = JSON.parse(pinned(probe, ['probe', job]))
      if (result.job !== job || result.limitFlags !== 0 || !Array.isArray(result.pids) || result.pids.length || result.active !== 0) throw Error('writers_not_isolated')
    }
    // Unknown process brokers and independent services cannot be introduced by
    // this fixture adapter. A production inventory cannot use this assertion.
  }
  function record (value) {
    const temporary = journal + '.tmp'
    fs.writeFileSync(temporary, canonical(value), { flag: 'wx' })
    fs.renameSync(temporary, journal)
  }
  function readRecord () {
    const evidence = JSON.parse(regular(journal))
    if (evidence.configuration !== configuration) throw Error('maintenance_inventory_changed')
    return evidence
  }
  function sourceIdentity () {
    if (command(sourceRoot, ['status', '--porcelain', '--untracked-files=all'])) throw Error('source_dirty')
    // Do not trust index flags, ignored files or a clean status alone.
    const expected = {}
    function tree (identity, prefix) {
      const entries = command(sourceRoot, ['cat-file', '-p', identity]).split('\n').filter(Boolean)
      for (const row of entries) {
        const match = row.match(/^(100644|100755|040000) (blob|tree) ([a-f0-9]{40})\t([A-Za-z0-9_.-]+)$/)
        if (!match || ['..', '.git', '.'].includes(match[4])) throw Error('unsupported_source_entry')
        if (match[1] === '040000' && match[2] === 'tree') tree(match[3], prefix + match[4] + '/')
        else if (match[2] === 'blob') expected[prefix + match[4]] = digest(command(sourceRoot, ['cat-file', 'blob', match[3]], { buffer: true }))
        else throw Error('unsupported_source_entry')
      }
    }
    tree(command(sourceRoot, ['rev-parse', 'HEAD^{tree}']), '')
    const actual = {}
    for (const name of fs.readdirSync(sourceRoot).sort()) {
      if (name === '.git') continue
      const target = path.join(sourceRoot, name)
      if (fs.lstatSync(target).isDirectory()) for (const [relative, hash] of Object.entries(snapshot(target))) actual[name + '/' + relative] = hash
      else actual[name] = digest(regular(target))
    }
    const sorted = value => canonical(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
    if (sorted(actual) !== sorted(expected)) throw Error('source_scope_changed')
    return { commit: command(sourceRoot, ['rev-parse', 'HEAD']), tree: command(sourceRoot, ['rev-parse', 'HEAD^{tree}']) }
  }
  function prepare (request) {
    authorize(request)
    if (fs.existsSync(journal)) throw Error('existing_maintenance_record')
    if (sourceIdentity().commit !== source.initial || !jobs.includes(database.job)) throw Error('baseline_identity_changed')
    const state = gate.prepare(request)
    record({ configuration, run: state.run, baseline: null, logical: null, recovered: false })
    return state
  }
  function capture (request) {
    authorize(request)
    const state = gate.status(), evidence = readRecord()
    if (state.phase !== 'draining' || state.run !== request.run || state.run !== evidence.run || state.leases.length) throw Error('writers_not_drained')
    taskIdle()
    // Snapshot after graceful completion. This capture alone is not isolation.
    evidence.baseline = snapshot(protectedRoot)
    evidence.logical = logicalMemory()
    record(evidence)
    return digest(canonical(evidence))
  }
  async function drain (request, timeoutMs = 10000) {
    authorize(request)
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw Error('invalid_drain_window')
    const deadline = Date.now() + timeoutMs
    while (true) {
      const state = gate.status()
      if (state.phase !== 'draining' || state.run !== request.run || state.generation !== request.expectedGeneration) throw Error('gate_identity_changed')
      taskIdle()
      if (!state.leases.length) {
        try { isolated(true); return capture(request) } catch (error) {
          if (error.message !== 'writers_not_isolated') throw error
        }
      }
      if (Date.now() >= deadline) throw Error('drain_window_expired')
      await new Promise(resolve => setTimeout(resolve, 25))
    }
  }
  function stopMemory (request) {
    authorize(request)
    const state = gate.status(), evidence = readRecord()
    if (!['draining', 'frozen'].includes(state.phase) || state.run !== request.run || state.generation !== request.expectedGeneration || state.leases.length) throw Error('gate_identity_changed')
    isolated(true)
    if (canonical(logicalMemory()) !== canonical(evidence.logical)) throw Error('logical_preservation_failed')
    // Smart mode only. Never fast/immediate, taskkill or automatic retry. A
    // timeout leaves the latch closed even if shutdown completes afterwards.
    pinned(database.pgctl, ['-D', database.data, 'stop', '-m', 'smart', '-w', '-t', '10'])
    isolated()
    if (fs.existsSync(path.join(database.data, 'postmaster.pid'))) throw Error('database_not_stopped')
    evidence.databaseFiles = snapshot(database.data)
    record(evidence)
  }
  function freeze (request) {
    authorize(request)
    const evidence = readRecord()
    if (evidence.run !== request.run || !evidence.baseline || !evidence.logical) throw Error('baseline_missing')
    isolated(); taskIdle()
    if (!evidence.databaseFiles || canonical(snapshot(database.data)) !== canonical(evidence.databaseFiles)) throw Error('database_preservation_failed')
    if (canonical(snapshot(protectedRoot)) !== canonical(evidence.baseline)) throw Error('preservation_failed')
    gate.acknowledge('offline-host', () => { isolated(); return { idle: true } })
    return gate.freeze(request)
  }
  function promote (request, rollback = false) {
    authorize(request)
    const state = gate.status(), evidence = readRecord()
    if (state.phase !== 'frozen' || state.run !== request.run || state.generation !== request.expectedGeneration) throw Error('gate_identity_changed')
    isolated()
    if (canonical(snapshot(protectedRoot)) !== canonical(evidence.baseline)) throw Error('preservation_failed')
    const target = rollback ? source.rollback : source.candidate
    const tree = rollback ? source.rollbackTree : source.candidateTree
    if (command(sourceRoot, ['rev-parse', target + '^{tree}']) !== tree) throw Error('source_identity_changed')
    sourceIdentity()
    command(sourceRoot, ['merge', '--ff-only', target])
    const actual = sourceIdentity()
    if (actual.commit !== target || actual.tree !== tree) throw Error('source_identity_changed')
    evidence.recovered = false; record(evidence)
    return actual
  }
  function release (request) {
    authorize(request)
    // Recovery SQL is performed externally while application Jobs remain empty;
    // this function re-reads independently, never accepts a caller PASS receipt.
    const evidence = readRecord()
    const state = gate.status()
    if (state.phase !== 'frozen' || state.run !== request.run || state.generation !== request.expectedGeneration) throw Error('gate_identity_changed')
    isolated(true)
    const current = logicalMemory()
    if (evidence.run !== request.run || canonical(current) !== canonical(evidence.logical)) throw Error('logical_preservation_failed')
    // Database must be stopped again before this gate can be released. Therefore
    // release is a separate offline step after a durable verification capture.
    const actualSource = sourceIdentity()
    if (!((actualSource.commit === source.candidate && actualSource.tree === source.candidateTree) || (actualSource.commit === source.rollback && actualSource.tree === source.rollbackTree))) throw Error('source_identity_changed')
    evidence.recovered = { logical: digest(canonical(current)), protected: digest(canonical(snapshot(protectedRoot))), source: actualSource }
    evidence.databaseFiles = null
    record(evidence)
    return { verified: false, reason: 'stop_fixture_database_then_release' }
  }
  function releaseStopped (request) {
    authorize(request)
    return gate.release(request, () => {
      const evidence = readRecord()
      isolated(); taskIdle()
      if (fs.existsSync(path.join(database.data, 'postmaster.pid'))) throw Error('database_not_stopped')
      if (!evidence.databaseFiles || canonical(snapshot(database.data)) !== canonical(evidence.databaseFiles)) throw Error('database_preservation_failed')
      if (evidence.run !== request.run || !evidence.recovered || evidence.recovered.logical !== digest(canonical(evidence.logical)) ||
          evidence.recovered.protected !== digest(canonical(evidence.baseline)) || canonical(sourceIdentity()) !== canonical(evidence.recovered.source) || canonical(snapshot(protectedRoot)) !== canonical(evidence.baseline)) throw Error('recovery_unverified')
      return { verified: true, receiptHash: digest(canonical(evidence)) }
    })
  }
  return Object.freeze({ initialize: credentials => gate.initialize(credentials), status: () => gate.status(), prepare, drain, capture, stopMemory, freeze, promote, rollback: request => promote(request, true), verifyRecovery: release, releaseStopped, snapshot: () => snapshot(protectedRoot) })
}
module.exports = { createMaintenance, snapshot }
