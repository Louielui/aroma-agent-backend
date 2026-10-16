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
      else Object.defineProperty(result, relative, { value: digest(regular(file)), enumerable: true })
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
  const protectedRoot = path.join(real, 'protected')
  const recoveryRoot = path.join(real, 'recovery-pg')
  const { createSnapshots, durableNew } = require('./offlineSnapshots.cjs')
  const sealed = createSnapshots({ root: real, inventory: snapshot,
    powershell: 'C:/Users/louis/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe',
    script: path.resolve(__dirname, '../../scripts/repository/offlineProtect.ps1') })
  const retentionPath = path.join(os.homedir(), '.imagine/gmail-reply-e1-packaging-repair-20261015/controlled-promotion-a8f05ce/preservation-option-a-v1/verify.cjs')
  const retentionPin = '8154cd60f7a4d3e39cbbd12445aee4b1d2b247d0cea27c4ad71c306b767fe268'
  if (digest(regular(retentionPath)) !== retentionPin) throw Error('preservation_verifier_changed')
  const retention = require(retentionPath)
  const configuration = digest(canonical({ jobs, pins: [...pins], snapshotTools: sealed.tools, retentionPin, database, source }))
  const gate = createGate({ directory: path.join(real, 'gate'), participants: ['offline-host'], ownerPassword, serviceCredentials })
  const journal = path.join(real, 'maintenance.json')
  const failed = path.join(real, 'maintenance.failed.json'), operationLock = path.join(real, 'maintenance.operation.lock')
  let operating = false
  function pinned (file, args) {
    if (digest(regular(file)) !== pins.get(file)) throw Error('tool_identity_changed')
    try { return execFileSync(file, args, { encoding: 'utf8', timeout: 15000, windowsHide: true, env: { SystemRoot: process.env.SystemRoot, PATH: path.dirname(file), TEMP: os.tmpdir() }, stdio: 'pipe' }).trim() }
    catch (_) { throw Error('offline_tool_failed') }
  }
  function authorize (request) {
    const { passwordMatches, MIN_PASSWORD_CHARS } = require('../governance/ownerAuth')
    const secret = ownerPassword()
    if (typeof secret !== 'string' || secret.length < MIN_PASSWORD_CHARS || !passwordMatches(request?.password, secret) || serviceCredentials().some(token => typeof token === 'string' && passwordMatches(request?.password, token))) throw Error('deployment_control_unauthorized')
  }
  function logicalMemory (recovery = false) {
    // Fixed read-only SQL; no caller SQL and no production connection settings.
    const data = fs.realpathSync(recovery ? recoveryRoot : database.data), port = recovery ? database.recoveryPort : database.port
    if (data !== (recovery ? recoveryRoot : path.join(real, 'pg')) || port < 49152 || port > 65535 || !Number.isInteger(port) || (recovery && port === database.port)) throw Error('disposable_database_required')
    const pid = regular(path.join(data, 'postmaster.pid')).toString().split(/\r?\n/)
    if (path.resolve(pid[1]) !== data || Number(pid[3]) !== port) throw Error('database_identity_changed')
    const sql = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT json_build_object('records',(SELECT coalesce(json_agg(t ORDER BY id),'[]') FROM records t),'audit',(SELECT coalesce(json_agg(t ORDER BY id),'[]') FROM audit t),'principals',(SELECT coalesce(json_agg(t ORDER BY id),'[]') FROM principals t),'access_audit',(SELECT coalesce(json_agg(t ORDER BY id),'[]') FROM access_audit t),'operations',(SELECT coalesce(json_agg(t ORDER BY id),'[]') FROM async_operations t),'tables',(SELECT json_agg(table_name ORDER BY table_name) FROM information_schema.tables WHERE table_schema='public'),'columns',(SELECT json_agg(t ORDER BY table_name,ordinal_position) FROM (SELECT table_name,column_name,ordinal_position,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public') t),'roles',(SELECT json_agg(t ORDER BY rolname) FROM pg_authid t),'otherClients',(SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid()),'dataDirectory',current_setting('data_directory'),'port',current_setting('port')); COMMIT;"
    const out = pinned(database.psql, ['-X', '-q', '-A', '-t', '-h', '127.0.0.1', '-p', String(port), '-U', 'fixture', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql])
    const observed = JSON.parse(out)
    if (observed.otherClients !== 0 || path.resolve(observed.dataDirectory) !== data || Number(observed.port) !== port) throw Error('independent_writer_unconfirmed')
    if (canonical(observed.tables) !== canonical(['access_audit', 'async_operations', 'audit', 'principals', 'records'])) throw Error('unknown_database_schema')
    if (observed.operations.some(op => !['completed', 'failed'].includes(op.state))) throw Error('memory_work_pending')
    delete observed.otherClients; delete observed.dataDirectory; delete observed.port
    return observed
  }
  function taskIdle () {
    const tasks = JSON.parse(regular(path.join(protectedRoot, 'tasks.json')))
    if (!Array.isArray(tasks) || tasks.some(t => !t || typeof t.id !== 'string' || !['completed', 'interrupted', 'cancelled'].includes(t.state))) throw Error('pending_or_unknown_task')
  }
  function isolated (exceptDatabase = false, exceptRecovery = false) {
    for (const job of jobs) {
      if (exceptDatabase && job === database.job) continue
      if (exceptRecovery && job === database.recoveryJob) continue
      const result = JSON.parse(pinned(probe, ['probe', job]))
      if (result.job !== job || result.limitFlags !== 0 || !Array.isArray(result.pids) || result.pids.length || result.active !== 0) throw Error('writers_not_isolated')
    }
    // Unknown process brokers and independent services cannot be introduced by
    // this fixture adapter. A production inventory cannot use this assertion.
  }
  function record (value) {
    const temporary = journal + '.' + crypto.randomUUID() + '.tmp'
    durableNew(temporary, canonical(value))
    fs.renameSync(temporary, journal)
  }
  function readRecord () {
    if (fs.existsSync(failed)) throw Error('maintenance_attempt_failed')
    const evidence = JSON.parse(regular(journal))
    if (evidence.configuration !== configuration) throw Error('maintenance_inventory_changed')
    if (evidence.pending && !operating) throw Error('maintenance_operation_unreconciled')
    return evidence
  }
  function guarded (stage, operation) {
    return (request, ...args) => {
      authorize(request)
      if (operating || fs.existsSync(operationLock)) throw Error('maintenance_operation_unreconciled')
      if (fs.existsSync(failed)) throw Error('maintenance_attempt_failed')
      const lock = fs.openSync(operationLock, 'wx', 0o600)
      fs.writeFileSync(lock, canonical({ stage, run: request.run })); fs.fsyncSync(lock)
      let asynchronous = false
      function cleanup () { operating = false; fs.closeSync(lock); fs.unlinkSync(operationLock) }
      function success (value) {
        if (stage === 'releaseStopped') return value
        const row = readRecord(); row.pending = null
        row.stages = [...(row.stages || []), { stage, at: new Date().toISOString() }]; record(row)
        return value
      }
      function failure (error) {
        const reason = /^[a-z_]+$/.test(error.message) ? error.message : 'offline_step_failed'
        if (!fs.existsSync(failed)) durableNew(failed, canonical({ stage, reason, run: request.run, at: new Date().toISOString() }))
        throw Error(reason)
      }
      try {
        if (fs.existsSync(journal)) { const row = readRecord(); row.pending = stage; record(row) }
        operating = true
        const result = operation(request, ...args)
        if (result && typeof result.then === 'function') { asynchronous = true; return result.then(success).catch(failure).finally(cleanup) }
        return success(result)
      } catch (error) { return failure(error) } finally { if (!asynchronous) cleanup() }
    }
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
    record({ configuration, run: state.run, baseline: null, logicalHash: null, recovered: false, pending: 'prepare' })
    const initial = sealed.seal({ groups: { protected: protectedRoot }, logical: null, binding: { configuration, run: state.run, stage: 'prepared' } })
    const evidence = readRecord(); evidence.initial = initial; record(evidence)
    return state
  }
  function capture (request) {
    authorize(request)
    const state = gate.status(), evidence = readRecord()
    if (state.phase !== 'draining' || state.run !== request.run || state.run !== evidence.run || state.leases.length || evidence.preliminary) throw Error('writers_not_drained')
    taskIdle()
    isolated(true)
    const initial = sealed.read(evidence.initial, { configuration, run: state.run, stage: 'prepared' })
    const authorization = 'company-access.json', before = initial.groups.protected.files[authorization]
    const present = fs.existsSync(path.join(protectedRoot, authorization))
    if (Boolean(before) !== present) throw Error('authorization_membership_changed')
    if (before) {
      if (digest(regular(retentionPath)) !== retentionPin) throw Error('preservation_verifier_changed')
      const proof = retention.verify(Buffer.from(before.bytes, 'base64'), regular(path.join(protectedRoot, authorization)))
      if (!proof.pass) throw Error('pre_isolation_authorization_unexplained')
      evidence.preIsolationAuthorization = { immutable: proof.nonAudit.immutableObservedSha256, appended: proof.audit.appendedCount, ownerActorIsHumanApproval: false }
    }
    // Complete encrypted pre-isolation evidence. It cannot authorize promotion.
    evidence.baseline = snapshot(protectedRoot)
    const logical = logicalMemory()
    evidence.logicalHash = digest(canonical(logical))
    evidence.preliminary = sealed.seal({ groups: { protected: protectedRoot }, logical,
      binding: { configuration, run: state.run, stage: 'drained' } })
    record(evidence)
    return digest(canonical(evidence))
  }
  async function drain (request, timeoutMs = 10000) {
    authorize(request)
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw Error('invalid_drain_window')
    const deadline = Date.now() + timeoutMs
    while (true) {
      let state
      try { state = gate.status() } catch (error) {
        if (error.message !== 'gate_busy' || Date.now() >= deadline) throw error
        await new Promise(resolve => setTimeout(resolve, 25)); continue
      }
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
    if (state.phase !== 'draining' || state.run !== request.run || state.generation !== request.expectedGeneration || state.leases.length || evidence.seal) throw Error('gate_identity_changed')
    isolated(true)
    if (digest(canonical(logicalMemory())) !== evidence.logicalHash) throw Error('logical_preservation_failed')
    // Smart mode only. Never fast/immediate, taskkill or automatic retry. A
    // timeout leaves the latch closed even if shutdown completes afterwards.
    pinned(database.pgctl, ['-D', database.data, 'stop', '-m', 'smart', '-w', '-t', '10'])
    isolated()
    if (fs.existsSync(path.join(database.data, 'postmaster.pid'))) throw Error('database_not_stopped')
    evidence.databaseFiles = snapshot(database.data)
    if (canonical(snapshot(protectedRoot)) !== canonical(evidence.baseline)) throw Error('preservation_failed')
    const preliminary = sealed.read(evidence.preliminary, { configuration, run: state.run, stage: 'drained' })
    if (digest(canonical(preliminary.logical)) !== evidence.logicalHash) throw Error('logical_preservation_failed')
    evidence.seal = sealed.seal({ groups: { protected: protectedRoot, database: database.data }, logical: preliminary.logical,
      binding: { configuration, run: state.run, stage: 'isolated' } })
    record(evidence)
  }
  function verifySealed (evidence) {
    isolated(); taskIdle()
    if (fs.existsSync(path.join(database.data, 'postmaster.pid'))) throw Error('database_not_stopped')
    const payload = sealed.read(evidence.seal, { configuration, run: evidence.run, stage: 'isolated' })
    sealed.verifyGroup(payload.groups.protected, protectedRoot)
    sealed.verifyGroup(payload.groups.database, database.data)
    if (canonical(payload.groups.protected.hashes) !== canonical(evidence.baseline) || canonical(snapshot(protectedRoot)) !== canonical(evidence.baseline)) throw Error('preservation_failed')
    if (canonical(payload.groups.database.hashes) !== canonical(evidence.databaseFiles) || canonical(snapshot(database.data)) !== canonical(evidence.databaseFiles)) throw Error('database_preservation_failed')
    if (digest(canonical(payload.logical)) !== evidence.logicalHash) throw Error('logical_preservation_failed')
    return payload
  }
  function freeze (request) {
    authorize(request)
    const evidence = readRecord()
    if (evidence.run !== request.run || !evidence.baseline || !evidence.logicalHash || !evidence.seal) throw Error('baseline_missing')
    verifySealed(evidence)
    gate.acknowledge('offline-host', () => { isolated(); return { idle: true } })
    return gate.freeze(request)
  }
  function promote (request, rollback = false) {
    authorize(request)
    const state = gate.status(), evidence = readRecord()
    if (state.phase !== 'frozen' || state.run !== request.run || state.generation !== request.expectedGeneration) throw Error('gate_identity_changed')
    verifySealed(evidence)
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
  function prepareRecovery (request) {
    authorize(request)
    const evidence = readRecord(), state = gate.status()
    if (state.phase !== 'frozen' || state.run !== request.run || state.generation !== request.expectedGeneration) throw Error('gate_identity_changed')
    if (!jobs.includes(database.recoveryJob) || database.recoveryJob === database.job || !Number.isInteger(database.recoveryPort) || database.recoveryPort === database.port || database.recoveryPort < 49152 || database.recoveryPort > 65535) throw Error('recovery_configuration_invalid')
    const payload = verifySealed(evidence)
    if (fs.existsSync(recoveryRoot)) throw Error('recovery_already_prepared')
    fs.mkdirSync(recoveryRoot)
    for (const directory of payload.groups.database.directories) {
      const target = path.resolve(recoveryRoot, directory)
      if (!target.startsWith(recoveryRoot + path.sep)) throw Error('snapshot_scope_invalid')
      fs.mkdirSync(target, { recursive: true })
    }
    for (const [name, entry] of Object.entries(payload.groups.database.files)) {
      const target = path.resolve(recoveryRoot, name)
      if (!target.startsWith(recoveryRoot + path.sep)) throw Error('snapshot_scope_invalid')
      fs.mkdirSync(path.dirname(target), { recursive: true })
      durableNew(target, Buffer.from(entry.bytes, 'base64'))
    }
    if (canonical(snapshot(recoveryRoot)) !== canonical(evidence.databaseFiles)) throw Error('recovery_copy_failed')
    evidence.recoveryPrepared = true; record(evidence)
    return { directory: recoveryRoot, port: database.recoveryPort, job: database.recoveryJob }
  }
  function release (request) {
    authorize(request)
    const evidence = readRecord(), state = gate.status()
    if (state.phase !== 'frozen' || state.run !== request.run || state.generation !== request.expectedGeneration || !evidence.recoveryPrepared) throw Error('gate_identity_changed')
    isolated(false, true); taskIdle()
    if (canonical(snapshot(protectedRoot)) !== canonical(evidence.baseline) || canonical(snapshot(database.data)) !== canonical(evidence.databaseFiles)) throw Error('preservation_failed')
    const current = logicalMemory(true)
    if (digest(canonical(current)) !== evidence.logicalHash) throw Error('logical_preservation_failed')
    // Read the encrypted source independently; never trust a caller PASS receipt.
    const original = sealed.read(evidence.seal, { configuration, run: evidence.run, stage: 'isolated' })
    if (canonical(original.logical) !== canonical(current)) throw Error('logical_preservation_failed')
    const actualSource = sourceIdentity()
    if (!((actualSource.commit === source.candidate && actualSource.tree === source.candidateTree) || (actualSource.commit === source.rollback && actualSource.tree === source.rollbackTree))) throw Error('source_identity_changed')
    evidence.recovered = { logical: evidence.logicalHash, protected: digest(canonical(evidence.baseline)), source: actualSource }
    record(evidence)
    return { verified: false, reason: 'stop_recovery_clone_then_release' }
  }
  function stopRecovery (request) {
    authorize(request)
    const evidence = readRecord(), state = gate.status()
    if (state.phase !== 'frozen' || state.run !== request.run || state.generation !== request.expectedGeneration || !evidence.recovered) throw Error('recovery_unverified')
    isolated(false, true)
    if (digest(canonical(logicalMemory(true))) !== evidence.logicalHash) throw Error('logical_preservation_failed')
    pinned(database.pgctl, ['-D', recoveryRoot, 'stop', '-m', 'smart', '-w', '-t', '10'])
    verifySealed(evidence)
    if (fs.existsSync(path.join(recoveryRoot, 'postmaster.pid'))) throw Error('database_not_stopped')
    evidence.recoveryStopped = true; record(evidence)
  }
  function releaseStopped (request) {
    authorize(request)
    return gate.release(request, () => {
      const evidence = readRecord()
      verifySealed(evidence)
      if (evidence.run !== request.run || !evidence.recovered || !evidence.recoveryStopped || evidence.recovered.logical !== evidence.logicalHash ||
          evidence.recovered.protected !== digest(canonical(evidence.baseline)) || canonical(sourceIdentity()) !== canonical(evidence.recovered.source) || canonical(snapshot(protectedRoot)) !== canonical(evidence.baseline)) throw Error('recovery_unverified')
      evidence.pending = null; evidence.stages = [...(evidence.stages || []), { stage: 'verified-release', at: new Date().toISOString() }]
      record(evidence)
      return { verified: true, receiptHash: digest(canonical(evidence)) }
    })
  }
  return Object.freeze({ initialize: credentials => gate.initialize(credentials), status: () => ({ ...gate.status(), maintenanceFailed: fs.existsSync(failed) || (!operating && fs.existsSync(operationLock)) }),
    prepare: guarded('prepare', prepare), drain: guarded('drain', drain), capture: guarded('capture', capture), stopMemory: guarded('stopMemory', stopMemory), freeze: guarded('freeze', freeze),
    promote: guarded('promote', promote), rollback: guarded('rollback', request => promote(request, true)), prepareRecovery: guarded('prepareRecovery', prepareRecovery),
    verifyRecovery: guarded('verifyRecovery', release), stopRecovery: guarded('stopRecovery', stopRecovery), releaseStopped: guarded('releaseStopped', releaseStopped), snapshot: () => snapshot(protectedRoot) })
}
module.exports = { createMaintenance, snapshot }
