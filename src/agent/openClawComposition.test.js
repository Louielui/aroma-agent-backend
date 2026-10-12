'use strict'

/**
 * openClawComposition.test.js — THE OFFLINE COMPOSITION ROOT, PROVEN INERT AND HONEST.
 *
 * Every test drives the REAL composition root over the REAL ledgers, redirected to a
 * disposable AROMA_DATA_DIR. State is asserted by reading the actual JSON files, because the
 * facade deliberately hands out no authority object to inspect — and a test that needed one
 * would be arguing for the very hole this module exists to close.
 */

const os = require('os')
const fs = require('fs')
const path = require('path')
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-x4b4b-'))
process.env.AROMA_DATA_DIR = DATA_DIR

const test = require('node:test')
const assert = require('node:assert')

const COMP = require('../agent/openClawComposition')
const { createOpenClawComposition, LEDGER_SCOPE, OUTCOME, EXECUTION_SEAMS, VERIFIER_READERS } = COMP
const Q = require('../agent/openClawQuarantine')
const { STATES: I, unitNameFor, derivedPathsFor } = require('../agent/openClawInstanceManager')

const APPROVAL = 'appr_b4b'
const UNIT = unitNameFor(APPROVAL)
const P = derivedPathsFor(APPROVAL)
const CG = '/user.slice/user-1000.slice/user@1000.service/app.slice/' + UNIT
const Q_FILE = path.join(DATA_DIR, 'openclaw-quarantine.json')
const I_FILE = path.join(DATA_DIR, 'openclaw-instances.json')

/* ══════════════ the ledgers, read and written as FILES ══════════════ */

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { return null } }
const writeJson = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 2), 'utf8')
const clean = () => { for (const f of [Q_FILE, I_FILE]) { try { fs.unlinkSync(f) } catch (e) {} } }
const qRec = () => (readJson(Q_FILE) || {})[APPROVAL] || null
const iRec = () => (readJson(I_FILE) || {})[APPROVAL] || null
const qState = () => (qRec() || {}).state || null
const iState = () => (iRec() || {}).state || null

const identity = (id) => ({ agentId: 'aroma-' + id, sessionKey: 'agent:aroma-' + id + ':' + id })

/** Seed the quarantine ledger directly, exactly as a crash would have left it. */
function seedQ (fields) {
  writeJson(Q_FILE, { [APPROVAL]: Object.assign({ approvalId: APPROVAL, updatedAt: 'then' }, fields) })
}
function seedI (fields) {
  const paths = derivedPathsFor(APPROVAL)
  writeJson(I_FILE, {
    [APPROVAL]: Object.assign({
      approvalId: APPROVAL, instanceId: APPROVAL, unitName: UNIT, instanceMarker: APPROVAL,
      createdAt: 'then', updatedAt: 'then', gatewayPort: 18901,
      envelopeObject: { dev: '2096', ino: '126262' }, repoObject: { dev: '2096', ino: '126263' },
      observedControlGroup: null, mainPid: null, observedPids: [], restartPolicy: 'no',
      stateRoot: paths.stateRoot, configPath: paths.configPath,
      envelopeRoot: paths.envelopeRoot, repoRoot: paths.repoRoot
    }, fields)
  })
}

/* ══════════════ fakes ══════════════ */

/** A coordinator that records how it was used. Exclusive by fiat — B4b tests the CONTRACT. */
function coordinator (over = {}) {
  const calls = []
  return {
    calls,
    runExclusive (scope, fn) {
      calls.push(scope)
      if (over.throwBefore) throw new Error('coordinator unavailable')
      if (over.neverRun) return
      const out = fn()
      if (over.runTwice) fn()
      if (over.saveForReplay) over.saveForReplay.fn = fn
      if (over.throwAfter) throw new Error('coordinator lost the lease after the section')
      return out
    }
  }
}

const okStat = (dev, ino) => ({ exists: true, dev, ino })
const STAT = { [P.envelopeRoot]: okStat('2096', '126262'), [P.repoRoot]: okStat('2096', '126263') }

/** A run() that answers every adapter read as a clean, empty world. */
function cleanWorldRun () {
  return (argv) => {
    const a = argv.join(' ')
    if (a.includes('/proc') || a.includes('cgroup.procs')) return { status: 1, stdout: '', stderr: '' }
    return { status: 0, stdout: '', stderr: '' }
  }
}

/** The four execution seams, healthy, with a log. */
function seams (log, over = {}) {
  return Object.assign({
    allocateGatewayPort: () => { log.push('allocateGatewayPort'); return 18901 },
    launchUnit: (spec) => { log.push('launchUnit'); return { ok: true, unitName: spec.unitName } },
    observeControlGroup: (u) => { log.push('observeControlGroup'); return CG },
    stopUnit: (u) => { log.push('stopUnit'); return { ok: true, unitName: u } }
  }, over)
}

/** A composition with everything wired, including a protection gate and a chosen verifier answer. */
function wired (over = {}) {
  const log = []
  const coord = over.coordinator || coordinator()
  const deps = Object.assign({
    run: over.run || cleanWorldRun(),
    ledgerCoordinator: coord,
    protectedInstancesOk: over.protectedInstancesOk === undefined ? () => true : over.protectedInstancesOk,
    executorUid: 1000
  }, seams(log, over.seams || {}), over.deps || {})
  return { c: createOpenClawComposition(deps), log, coord, deps }
}

/**
 * ⛔ A REAL WORLD FOR THE REAL ADAPTERS, answering the exact argv they issue.
 *
 * `state.alive` flips the whole world between "the executor is running" (so a launch can be
 * positively observed) and "the executor is gone" (so the real verifier can reach RETIRED).
 * Nothing here is a stub of the adapters or the verifier: both are the production modules.
 */
const EXEC_PID = 93018
function makeWorld (state) {
  const ok = (stdout) => ({ status: 0, stdout, stderr: '' })
  const clean1 = { status: 1, stdout: '', stderr: '' }
  return (argv) => {
    const [bin, ...rest] = argv
    if (bin === '/usr/bin/cat') {
      const p = rest[0]
      if (/\/cgroup\.procs$/.test(p)) return state.alive ? ok(EXEC_PID + '\n') : clean1
      const m = /^\/proc\/(\d+)\/status$/.exec(p)
      if (m) {
        if (m[1] === '1') return ok('Name:\tinit\nUid:\t0\t0\t0\t0\n')
        return state.alive ? ok('Name:\tnode\nUid:\t1000\t1000\t1000\t1000\n') : clean1
      }
      return clean1
    }
    // presence probes: a CLEAN status 1 is the only "absent"
    if (bin === '/usr/bin/test') {
      const p = rest[rest.length - 1]
      if (/^\/proc\/\d+$/.test(p)) return (state.alive && !p.endsWith('/1')) ? ok('') : clean1
      return state.alive ? ok('') : clean1
    }
    if (bin === '/usr/bin/find') {
      if (rest[0] === '/proc') return ok(state.alive ? '/proc/1\0/proc/' + EXEC_PID + '\0' : '/proc/1\0')
      return ok('')
    }
    if (bin === '/usr/bin/stat') {
      const p = rest[rest.length - 1]
      if (p === P.envelopeRoot) return ok('2096 126262\n')
      if (p === P.repoRoot) return ok('2096 126263\n')
      return clean1
    }
    if (bin === '/usr/bin/systemctl') {
      if (rest.includes('list-units')) return ok('[]\n')
      return ok('LoadState=not-found\nActiveState=inactive\nSubState=dead\nResult=success\nRestart=no\n')
    }
    if (bin === '/usr/bin/readlink' || bin === '/usr/bin/grep' || bin === '/usr/bin/ss') return clean1
    return clean1
  }
}

test.beforeEach(() => clean())

/* ══════════════ F — the facade ══════════════ */

test('F1. ⛔ the facade is frozen and has EXACTLY the eight approved members', () => {
  const { c } = wired()
  assert.deepStrictEqual(Object.keys(c).sort(),
    ['abortPrepared', 'capabilities', 'gate', 'launchApproved', 'listUnaccounted', 'reconcile', 'recoverInstance', 'status'])
  assert.ok(Object.isFrozen(c))
  for (const forbidden of ['quarantine', 'instances', 'instanceStore', 'launcher', 'verifier', 'adapters', 'coordinator', 'store', 'ledgerCoordinator']) {
    assert.strictEqual(c[forbidden], undefined, forbidden + ' must not be reachable')
  }
})

test('F2. ⛔ no authority method is reachable through any facade value, at any depth', () => {
  const { c } = wired()
  const AUTHORITY = ['retire', 'observeExecutorGone', 'markRunning', 'abortPreExecution', 'markCleaned',
    'requestStop', 'launchAttempted', 'prepare', 'runExclusive', 'evaluate', 'verifyForQuarantine', 'write']
  const seen = new Set()
  const walk = (v, where) => {
    if (v === null || typeof v !== 'object' || seen.has(v)) return
    seen.add(v)
    for (const k of Object.keys(v)) {
      assert.ok(!(AUTHORITY.includes(k) && typeof v[k] === 'function'),
        'authority method ' + k + ' is reachable at ' + where)
      walk(v[k], where + '.' + k)
    }
  }
  walk(c.capabilities, 'capabilities')
  walk(c.gate(APPROVAL), 'gate()')
  walk(c.listUnaccounted(), 'listUnaccounted()')
  walk(c.status(APPROVAL), 'status()')
  walk(c.recoverInstance(APPROVAL), 'recoverInstance()')
  // and the facade members themselves are plain functions, not bound authority objects
  for (const k of ['launchApproved', 'abortPrepared', 'recoverInstance', 'reconcile', 'gate', 'status', 'listUnaccounted']) {
    assert.strictEqual(typeof c[k], 'function')
  }
})

test('F3. every returned value is detached, deep-frozen, null-prototype data', () => {
  seedQ({ state: Q.STATES.RUNNING, phase: Q.PHASES[0], agentId: identity(APPROVAL).agentId, sessionKey: identity(APPROVAL).sessionKey })
  seedI({ state: I.LAUNCH_ATTEMPTED })
  const { c } = wired()
  const s = c.status(APPROVAL)
  assert.strictEqual(Object.getPrototypeOf(s), null)
  assert.ok(Object.isFrozen(s))
  assert.strictEqual(Object.getPrototypeOf(s.quarantine), null)
  assert.ok(Object.isFrozen(s.quarantine) && Object.isFrozen(s.instance))
  // mutating the copy cannot reach the ledger
  assert.throws(() => { s.quarantine.state = 'EXECUTOR_RETIRED' }, TypeError)
  assert.strictEqual(qState(), Q.STATES.RUNNING)
  const u = c.listUnaccounted()
  assert.ok(Object.isFrozen(u) && u.every((r) => Object.isFrozen(r) && Object.getPrototypeOf(r) === null))
})

/* ══════════════ K — the one global lock ══════════════ */

test('K1. ⛔ with no coordinator, every mutating operation refuses before touching anything', () => {
  const c = createOpenClawComposition({ run: cleanWorldRun(), protectedInstancesOk: () => true, ...seams([]) })
  seedQ({ state: Q.STATES.PREPARED })
  const before = fs.readFileSync(Q_FILE, 'utf8')
  for (const op of ['launchApproved', 'abortPrepared', 'recoverInstance', 'status']) {
    const r = c[op](APPROVAL)
    assert.strictEqual(r.ok, false, op)
    assert.strictEqual(r.outcome, OUTCOME.REFUSED_NO_COORDINATOR, op + ': ' + r.outcome)
    assert.strictEqual(r.effects, 'none', op)
  }
  const rec = c.reconcile()
  assert.strictEqual(rec.outcome, OUTCOME.REFUSED_NO_COORDINATOR)
  assert.strictEqual(fs.readFileSync(Q_FILE, 'utf8'), before, 'not one byte was written')
  assert.strictEqual(iRec(), null, 'no instance ledger was created')
})

test('K2. gate() and listUnaccounted() are single-ledger reads and work without a coordinator', () => {
  const c = createOpenClawComposition({ run: cleanWorldRun() })
  seedQ({ state: Q.STATES.RUNNING, phase: Q.PHASES[0], agentId: identity(APPROVAL).agentId, sessionKey: identity(APPROVAL).sessionKey })
  const g = c.gate('appr_other')
  assert.strictEqual(g.ok, false)
  assert.match(g.reason, /unaccounted/)
  assert.deepStrictEqual(c.listUnaccounted().map((r) => r.approvalId), [APPROVAL])
})

test('K3a. ⛔ coordinator throws BEFORE the section: a plain refusal, and genuinely zero effect', () => {
  seedQ({ state: Q.STATES.PREPARED })
  const before = fs.readFileSync(Q_FILE, 'utf8')
  const { c, log } = wired({ coordinator: coordinator({ throwBefore: true }) })
  const r = c.abortPrepared(APPROVAL)
  assert.strictEqual(r.outcome, OUTCOME.REFUSED_COORDINATOR_FAILED)
  assert.strictEqual(r.effects, 'none')
  assert.strictEqual(fs.readFileSync(Q_FILE, 'utf8'), before)
  assert.deepStrictEqual(log, [], 'no OS action either')
})

test('K3b. ⛔ coordinator throws AFTER the section: NOT a refusal, the durable write STANDS', () => {
  seedQ({ state: Q.STATES.PREPARED })
  const { c } = wired({ coordinator: coordinator({ throwAfter: true }) })
  const r = c.abortPrepared(APPROVAL)
  assert.strictEqual(r.outcome, OUTCOME.COORDINATOR_FAILED_AFTER_OPERATION)
  assert.notStrictEqual(r.effects, 'none')
  assert.strictEqual(r.innerCompleted, true)
  assert.strictEqual(r.innerOutcome.outcome, OUTCOME.PRE_EXECUTION_ABORTED, 'the inner outcome is preserved verbatim')
  // ⛔ the abort really happened and was NOT rolled back
  assert.strictEqual(qState(), Q.STATES.PRE_EXECUTION_ABORTED)
  assert.strictEqual(r.observed.crossLedgerConsistency, 'UNVERIFIED', 'the readback is diagnostic, never a snapshot')
})

/**
 * A coordinator that corrupts the quarantine ledger inside the section, so the inner operation
 * genuinely throws part-way. `swallow` decides whether the coordinator hides that exception.
 */
function corruptingCoordinator (swallow) {
  return {
    runExclusive (scope, fn) {
      fs.writeFileSync(Q_FILE, '{ this is not json', 'utf8')
      try { return fn() } catch (e) { if (!swallow) throw e }
    }
  }
}

test('K3c. ⛔ the INNER operation throws after entry: DURING_OPERATION, not completed, possibly-partial', () => {
  seedQ(Object.assign({ state: Q.STATES.RUNNING, phase: Q.PHASES[0] }, identity(APPROVAL)))
  const { c } = wired({ coordinator: corruptingCoordinator(false) })
  const r = c.reconcile()
  assert.strictEqual(r.outcome, OUTCOME.COORDINATOR_FAILED_DURING_OPERATION, JSON.stringify(r))
  assert.strictEqual(r.innerCompleted, false)
  assert.strictEqual(r.effects, 'possibly-partial')
  assert.strictEqual(r.innerOutcome, null)
  assert.ok(r.observed, 'a diagnostic readback is attached')
  assert.strictEqual(r.observed.crossLedgerConsistency, 'UNKNOWN', 'the corrupt ledger cannot be read back')
})

test('K3d. ⛔ the coordinator SWALLOWS the inner failure: still DURING_OPERATION, never a clean result', () => {
  seedQ(Object.assign({ state: Q.STATES.RUNNING, phase: Q.PHASES[0] }, identity(APPROVAL)))
  const { c } = wired({ coordinator: corruptingCoordinator(true) })
  const r = c.reconcile()
  // ⛔ the coordinator returned normally; without the recorded section error this would have
  // been reported as a successful reconcile (or as null)
  assert.notStrictEqual(r, null)
  assert.strictEqual(r.outcome, OUTCOME.COORDINATOR_FAILED_DURING_OPERATION, JSON.stringify(r))
  assert.strictEqual(r.innerCompleted, false)
  assert.strictEqual(r.effects, 'possibly-partial')
  assert.notStrictEqual(r.outcome, OUTCOME.REFUSED_COORDINATOR_DID_NOT_RUN)
})

test('K4c. ⛔ the coordinator SWALLOWS the duplicate-callback violation: still a protocol violation after the operation', () => {
  seedQ({ state: Q.STATES.PREPARED })
  const coord = {
    runExclusive (scope, fn) {
      fn()
      try { fn() } catch (e) { /* swallowed on purpose */ }
    }
  }
  const { c } = wired({ coordinator: coord })
  const r = c.abortPrepared(APPROVAL)
  // ⛔ NOT "did not run", and NOT zero effect: the first call wrote durably
  assert.strictEqual(r.outcome, OUTCOME.COORDINATOR_PROTOCOL_VIOLATION_AFTER_OPERATION, JSON.stringify(r))
  assert.notStrictEqual(r.outcome, OUTCOME.REFUSED_COORDINATOR_DID_NOT_RUN)
  assert.notStrictEqual(r.effects, 'none')
  assert.strictEqual(r.innerCompleted, true)
  assert.strictEqual(r.innerOutcome.outcome, OUTCOME.PRE_EXECUTION_ABORTED, 'the first outcome is preserved')
  assert.strictEqual(qState(), Q.STATES.PRE_EXECUTION_ABORTED, 'and the durable write stands')
})

test('K4a. ⛔ the coordinator runs the section twice: the SECOND is blocked, the FIRST still stands', () => {
  seedQ({ state: Q.STATES.PREPARED })
  const { c } = wired({ coordinator: coordinator({ runTwice: true }) })
  const r = c.abortPrepared(APPROVAL)
  assert.strictEqual(r.outcome, OUTCOME.COORDINATOR_PROTOCOL_VIOLATION_AFTER_OPERATION)
  assert.notStrictEqual(r.effects, 'none')
  assert.strictEqual(r.innerOutcome.outcome, OUTCOME.PRE_EXECUTION_ABORTED, 'the first result is not erased')
  assert.strictEqual(qState(), Q.STATES.PRE_EXECUTION_ABORTED, 'and it is still on disk exactly once')
})

test('K4b. ⛔ a saved callback replayed after runExclusive returned does nothing', () => {
  seedQ({ state: Q.STATES.PREPARED })
  const saved = {}
  const { c } = wired({ coordinator: coordinator({ saveForReplay: saved }) })
  const first = c.abortPrepared(APPROVAL)
  assert.strictEqual(first.outcome, OUTCOME.PRE_EXECUTION_ABORTED)
  const after = fs.readFileSync(Q_FILE, 'utf8')
  assert.throws(() => saved.fn(), /replayed AFTER runExclusive returned/)
  assert.strictEqual(fs.readFileSync(Q_FILE, 'utf8'), after, 'the replay wrote nothing')
})

test('K5. ⛔ re-entrancy is refused, and the guard is cleared even when the section throws', () => {
  seedQ({ state: Q.STATES.PREPARED })
  let inner = null
  const reentrant = {
    runExclusive (scope, fn) {
      inner = c.abortPrepared(APPROVAL)   // re-enter from inside the section
      return fn()
    }
  }
  const { c } = wired({ coordinator: reentrant })
  c.abortPrepared(APPROVAL)
  assert.strictEqual(inner.outcome, OUTCOME.REFUSED_REENTRANT)
  assert.strictEqual(inner.effects, 'none')
  // the guard was released in finally, so the composition is still usable
  clean(); seedQ({ state: Q.STATES.PREPARED })
  const { c: c2 } = wired({ coordinator: coordinator({ throwBefore: true }) })
  assert.strictEqual(c2.abortPrepared(APPROVAL).outcome, OUTCOME.REFUSED_COORDINATOR_FAILED)
  const { c: c3 } = wired()
  assert.strictEqual(c3.abortPrepared(APPROVAL).outcome, OUTCOME.PRE_EXECUTION_ABORTED, 'not wedged')
})

test('K6. a coordinator that never runs the section is refused, with zero effect', () => {
  seedQ({ state: Q.STATES.PREPARED })
  const before = fs.readFileSync(Q_FILE, 'utf8')
  const { c } = wired({ coordinator: coordinator({ neverRun: true }) })
  const r = c.abortPrepared(APPROVAL)
  assert.strictEqual(r.outcome, OUTCOME.REFUSED_COORDINATOR_DID_NOT_RUN)
  assert.strictEqual(r.effects, 'none')
  assert.strictEqual(fs.readFileSync(Q_FILE, 'utf8'), before)
})

test('K7. ⛔ the scope is the fixed shared one and NEVER carries an approvalId', () => {
  seedQ({ state: Q.STATES.PREPARED })
  const { c, coord } = wired()
  c.abortPrepared(APPROVAL)
  c.status(APPROVAL)
  c.reconcile()
  assert.ok(coord.calls.length >= 3)
  for (const s of coord.calls) {
    assert.strictEqual(s, LEDGER_SCOPE)
    assert.ok(!s.includes(APPROVAL), 'the scope must not be per-approval: both files are shared')
  }
  assert.strictEqual(LEDGER_SCOPE, 'openclaw-ledgers-v1')
})

test('K8. ⛔ ALL FIVE mutating/cross-ledger operations take the lock — not only recovery', () => {
  const taken = []
  const coord = { runExclusive (scope, fn) { taken.push(scope); return fn() } }
  const { c } = wired({ coordinator: coord })
  seedQ({ state: Q.STATES.PREPARED })
  c.launchApproved(APPROVAL); c.abortPrepared(APPROVAL); c.recoverInstance(APPROVAL)
  c.reconcile(); c.status(APPROVAL)
  assert.strictEqual(taken.length, 5, 'launchApproved, abortPrepared, recoverInstance, reconcile, status')
  // and the two single-ledger reads do NOT take it
  const n = taken.length
  c.gate(APPROVAL); c.listUnaccounted()
  assert.strictEqual(taken.length, n)
})

test('K9. a diagnostic readback that fails is marked UNKNOWN, never guessed', () => {
  seedQ({ state: Q.STATES.PREPARED })
  const { c } = wired({ coordinator: coordinator({ throwAfter: true }) })
  const r = c.abortPrepared(APPROVAL)
  assert.ok(['UNVERIFIED', 'UNKNOWN'].includes(r.observed.crossLedgerConsistency))
  // corrupt the ledger, then force the same path again: the readback must say UNKNOWN
  clean(); seedQ({ state: Q.STATES.PREPARED })
  const { c: c2 } = wired({
    coordinator: {
      runExclusive (scope, fn) { const out = fn(); fs.writeFileSync(Q_FILE, '{ not json', 'utf8'); throw new Error('lease lost') }
    }
  })
  const r2 = c2.abortPrepared(APPROVAL)
  assert.strictEqual(r2.observed.crossLedgerConsistency, 'UNKNOWN')
  assert.ok(r2.observed.quarantineUnreadable)
})

/* ══════════════ S — construction snapshot ══════════════ */

test('S1. ⛔ every seam is read exactly once at construction', () => {
  const reads = Object.create(null)
  const deps = { run: cleanWorldRun(), ledgerCoordinator: coordinator(), protectedInstancesOk: () => true }
  for (const name of EXECUTION_SEAMS.concat(['run', 'ledgerCoordinator', 'protectedInstancesOk'])) {
    if (name === 'run' || name === 'ledgerCoordinator' || name === 'protectedInstancesOk') continue
    reads[name] = 0
    Object.defineProperty(deps, name, {
      enumerable: true, configurable: true,
      get () { reads[name] += 1; return () => { throw new Error('poisoned seam ran') } }
    })
  }
  createOpenClawComposition(deps)
  for (const k of Object.keys(reads)) assert.strictEqual(reads[k], 1, k + ' read exactly once')
})

test('S2. ⛔ a seam added or replaced AFTER construction changes nothing', () => {
  const log = []
  const deps = { run: cleanWorldRun(), ledgerCoordinator: coordinator(), protectedInstancesOk: () => true }
  const c = createOpenClawComposition(deps)
  assert.strictEqual(c.capabilities.canLaunch, false)
  assert.deepStrictEqual(c.capabilities.missingSeams.slice(), EXECUTION_SEAMS.slice())
  Object.assign(deps, seams(log))
  seedQ({ state: Q.STATES.PREPARED })
  const r = c.launchApproved(APPROVAL)
  assert.strictEqual(r.outcome, OUTCOME.REFUSED_MISSING_SEAM)
  assert.deepStrictEqual(log, [], 'the late seam never ran')
  assert.strictEqual(c.capabilities.canLaunch, false, 'capabilities are frozen at construction')
})

test('S3. capabilities are literal booleans and canStop/canLaunch follow the snapshot', () => {
  const { c } = wired()
  for (const k of ['hasRunner', 'hasCoordinator', 'hasProtectionGate', 'hasVerifierReaders', 'canStop', 'canLaunch']) {
    assert.strictEqual(typeof c.capabilities[k], 'boolean', k + ' must be a literal boolean')
  }
  assert.strictEqual(c.capabilities.canLaunch, true)
  assert.ok(Object.isFrozen(c.capabilities))
  const bare = createOpenClawComposition({ run: cleanWorldRun() })
  assert.strictEqual(bare.capabilities.canStop, false)
  assert.strictEqual(bare.capabilities.canLaunch, false)
})

/* ══════════════ G — launch lifecycle ══════════════ */

test('G1. ⛔ the composition NEVER calls quarantine.begin: a launch with no record refuses', () => {
  const src = fs.readFileSync(path.join(__dirname, 'openClawComposition.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  assert.ok(!/\.begin\s*\(/.test(code), 'no begin() call in the composition root')
  const { c } = wired()
  const r = c.launchApproved(APPROVAL)
  assert.strictEqual(r.outcome, OUTCOME.REFUSED_PRECONDITION)
  assert.strictEqual(r.effects, 'none')
  assert.strictEqual(qRec(), null, 'and no quarantine record was created')
})

test('G2. ⛔ launch requires quarantine EXACTLY PREPARED', () => {
  const { c, log } = wired()
  for (const st of [Q.STATES.RUNNING, Q.STATES.TERMINAL_OBSERVED, Q.STATES.EXECUTOR_RETIRED, Q.STATES.CLEANED]) {
    clean()
    const extra = st === Q.STATES.CLEANED ? { cleanedFrom: Q.STATES.PRE_EXECUTION_ABORTED } : {}
    const bearing = [Q.STATES.RUNNING, Q.STATES.TERMINAL_OBSERVED, Q.STATES.EXECUTOR_RETIRED].includes(st)
    seedQ(Object.assign({ state: st }, bearing ? Object.assign({ phase: Q.PHASES[0] }, identity(APPROVAL)) : {},
      st === Q.STATES.TERMINAL_OBSERVED || st === Q.STATES.EXECUTOR_RETIRED ? { taskStatus: 'failed' } : {}, extra))
    const r = c.launchApproved(APPROVAL)
    assert.strictEqual(r.outcome, OUTCOME.REFUSED_PRECONDITION, st)
    assert.strictEqual(r.effects, 'none', st)
  }
  assert.deepStrictEqual(log, [], 'no OS action for any of them')
})

test('G3. ⛔ a launch is NEVER retried when an instance record already exists', () => {
  seedQ({ state: Q.STATES.PREPARED })
  seedI({ state: I.LAUNCH_ATTEMPTED })
  const { c, log } = wired()
  const r = c.launchApproved(APPROVAL)
  assert.strictEqual(r.outcome, OUTCOME.REFUSED_PRECONDITION)
  assert.match(r.reason, /never retried/)
  assert.strictEqual(r.effects, 'none')
  assert.deepStrictEqual(log, [])
  assert.strictEqual(iState(), I.LAUNCH_ATTEMPTED, 'untouched')
})

test('G4. ⛔ a missing execution seam refuses before any write or OS action', () => {
  for (const missing of EXECUTION_SEAMS) {
    clean(); seedQ({ state: Q.STATES.PREPARED })
    const log = []
    const over = {}; over[missing] = undefined
    const { c } = wired({ seams: over })
    const r = c.launchApproved(APPROVAL)
    assert.strictEqual(r.outcome, OUTCOME.REFUSED_MISSING_SEAM, missing)
    assert.match(r.reason, new RegExp(missing))
    assert.strictEqual(r.effects, 'none')
    assert.strictEqual(iRec(), null, missing + ': no instance identity was written')
  }
})

test('G5. ⛔ NO PROTECTION GATE, NO LAUNCH: an executor that cannot be retired is never started', () => {
  seedQ({ state: Q.STATES.PREPARED })
  const log = []
  const c = createOpenClawComposition(Object.assign(
    { run: cleanWorldRun(), ledgerCoordinator: coordinator(), executorUid: 1000 },
    seams(log)
    // protectedInstancesOk deliberately absent — the four execution seams ARE all present
  ))
  assert.strictEqual(c.capabilities.hasProtectionGate, false)
  assert.strictEqual(c.capabilities.canLaunch, false, 'four seams are not enough')
  const r = c.launchApproved(APPROVAL)
  assert.strictEqual(r.outcome, OUTCOME.REFUSED_NO_RETIREMENT_PATH)
  assert.strictEqual(r.effects, 'none')
  assert.deepStrictEqual(log, [], 'nothing was launched')
  assert.strictEqual(iRec(), null)
})

test('G6. ⛔ a coordinator is part of the launch capability too', () => {
  const log = []
  const c = createOpenClawComposition(Object.assign(
    { run: cleanWorldRun(), protectedInstancesOk: () => true }, seams(log)))
  assert.strictEqual(c.capabilities.canLaunch, false)
  assert.strictEqual(c.capabilities.hasCoordinator, false)
  seedQ({ state: Q.STATES.PREPARED })
  // the most specific cause wins: the coordinator is what is missing here
  assert.strictEqual(c.launchApproved(APPROVAL).outcome, OUTCOME.REFUSED_NO_COORDINATOR)
  assert.deepStrictEqual(log, [])
})

test('G7. ⛔ the dynamic preconditions are read INSIDE the critical section', () => {
  seedQ({ state: Q.STATES.PREPARED })
  const order = []
  const coord = {
    runExclusive (scope, fn) {
      order.push('lock-acquired')
      // change the world just before the section reads it: the section must see THIS
      seedQ({ state: Q.STATES.RUNNING, phase: Q.PHASES[0], ...identity(APPROVAL) })
      const out = fn()
      order.push('lock-released')
      return out
    }
  }
  const { c, log } = wired({ coordinator: coord })
  const r = c.launchApproved(APPROVAL)
  assert.deepStrictEqual(order, ['lock-acquired', 'lock-released'])
  assert.strictEqual(r.outcome, OUTCOME.REFUSED_PRECONDITION, 'it read the state set inside the lock')
  assert.strictEqual(r.quarantineState, Q.STATES.RUNNING)
  assert.deepStrictEqual(log, [])
})

test('G8. the full launch succeeds when every capability is present, and writes both ledgers', () => {
  seedQ({ state: Q.STATES.PREPARED })
  const st = { alive: true }
  const { c, log } = wired({ run: makeWorld(st) })
  assert.strictEqual(c.capabilities.canLaunch, true)
  const r = c.launchApproved(APPROVAL)
  assert.strictEqual(r.outcome, OUTCOME.LAUNCHED, JSON.stringify(r))
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(log, ['allocateGatewayPort', 'launchUnit', 'observeControlGroup'])
  assert.strictEqual(qState(), Q.STATES.RUNNING)
  assert.strictEqual(qRec().phase, Q.PHASES[0])
  assert.strictEqual(iState(), I.OBSERVED)
  assert.strictEqual(iRec().observedControlGroup, CG)
})

/* ══════════════ R — the state matrix ══════════════ */

test('R1. PREPARED + instance null/PREPARED: abort ONLY — never stop, never verify', () => {
  for (const seed of [null, I.PREPARED]) {
    clean(); seedQ({ state: Q.STATES.PREPARED })
    if (seed) seedI({ state: seed })
    const log = []
    let verifierRan = false
    const { c } = wired({ protectedInstancesOk: () => { verifierRan = true; return true }, seams: seams(log) })
    for (const op of ['abortPrepared', 'recoverInstance']) {
      clean(); seedQ({ state: Q.STATES.PREPARED }); if (seed) seedI({ state: seed })
      const r = c[op](APPROVAL)
      assert.strictEqual(r.outcome, OUTCOME.PRE_EXECUTION_ABORTED, op + ' with instance ' + seed)
      assert.strictEqual(qState(), Q.STATES.PRE_EXECUTION_ABORTED)
      assert.deepStrictEqual(log, [], 'no stop was issued')
      assert.strictEqual(verifierRan, false, 'no verification was run')
      // ⛔ no execution evidence was invented
      for (const f of ['phase', 'taskStatus', 'sessionKey', 'agentId', 'runId', 'goneObservedAt']) {
        assert.ok(!Object.prototype.hasOwnProperty.call(qRec(), f), f + ' must not appear')
      }
    }
  }
})

test('R2. already PRE_EXECUTION_ABORTED: idempotent, zero write, zero stop', () => {
  seedQ({ state: Q.STATES.PRE_EXECUTION_ABORTED })
  const before = fs.readFileSync(Q_FILE, 'utf8')
  const log = []
  const { c } = wired({ seams: seams(log) })
  for (const op of ['abortPrepared', 'recoverInstance']) {
    const r = c[op](APPROVAL)
    assert.strictEqual(r.outcome, OUTCOME.ALREADY_ABORTED, op)
    assert.strictEqual(r.effects, 'none')
  }
  assert.strictEqual(fs.readFileSync(Q_FILE, 'utf8'), before)
  assert.deepStrictEqual(log, [])
})

test('R3. RUNNING + launched instance: requestStop -> positive ack -> observe -> retire', () => {
  const st = { alive: true }
  const { c, log } = wired({ run: makeWorld(st) })
  seedQ({ state: Q.STATES.PREPARED })
  assert.strictEqual(c.launchApproved(APPROVAL).outcome, OUTCOME.LAUNCHED)
  st.alive = false
  log.length = 0
  const r = c.recoverInstance(APPROVAL)
  assert.strictEqual(r.outcome, OUTCOME.RETIRED, JSON.stringify(r))
  assert.deepStrictEqual(log, ['stopUnit'])
  assert.strictEqual(iState(), I.STOP_REQUESTED)
  assert.strictEqual(qState(), Q.STATES.EXECUTOR_RETIRED)
  assert.ok(qRec().goneObservedAt, 'the OS history was recorded')
  assert.ok(!Object.prototype.hasOwnProperty.call(qRec(), 'taskStatus'), 'and no task status was invented')
  assert.strictEqual(c.gate('appr_fresh').ok, true, 'the lock is released only now')
})

test('R3b. RUNNING but nothing was launched: sequence mismatch, no stop, no write', () => {
  for (const seed of [null, I.PREPARED]) {
    clean()
    seedQ({ state: Q.STATES.RUNNING, phase: Q.PHASES[0], ...identity(APPROVAL) })
    if (seed) seedI({ state: seed })
    const before = fs.readFileSync(Q_FILE, 'utf8')
    const log = []
    const { c } = wired({ seams: seams(log) })
    const r = c.recoverInstance(APPROVAL)
    assert.strictEqual(r.outcome, OUTCOME.REFUSED_SEQUENCE_MISMATCH, 'instance ' + seed)
    assert.strictEqual(r.effects, 'none')
    assert.deepStrictEqual(log, [])
    assert.strictEqual(fs.readFileSync(Q_FILE, 'utf8'), before)
  }
})

test('R4. EXECUTOR_GONE_OBSERVED + STOP_REQUESTED: no second stop, no second observe, one fresh retire', () => {
  const st = { alive: true }
  const { c, log } = wired({ run: makeWorld(st) })
  seedQ({ state: Q.STATES.PREPARED })
  c.launchApproved(APPROVAL)
  st.alive = false
  // drive to the crash window: observed gone, not yet retired
  seedQ(Object.assign({}, qRec(), { state: Q.STATES.EXECUTOR_GONE_OBSERVED, goneObservedAt: '2026-09-04T00:00:00.000Z' }))
  seedI(Object.assign({}, iRec(), { state: I.STOP_REQUESTED }))
  log.length = 0
  const r = c.recoverInstance(APPROVAL)
  assert.strictEqual(r.outcome, OUTCOME.RETIRED, JSON.stringify(r))
  assert.deepStrictEqual(log, [], '⛔ no second stop was issued')
  assert.strictEqual(qState(), Q.STATES.EXECUTOR_RETIRED)
  assert.strictEqual(qRec().goneObservedAt, '2026-09-04T00:00:00.000Z', 'the original observation was not restamped')
})

test('R4b. EXECUTOR_GONE_OBSERVED with a wrong instance pairing is a sequence mismatch', () => {
  for (const seed of [null, I.PREPARED, I.LAUNCH_ATTEMPTED, I.OBSERVED]) {
    clean()
    seedQ(Object.assign({ state: Q.STATES.EXECUTOR_GONE_OBSERVED, phase: Q.PHASES[0], goneObservedAt: '2026-09-04T00:00:00.000Z' }, identity(APPROVAL)))
    if (seed) seedI({ state: seed, observedControlGroup: seed === I.OBSERVED ? CG : null })
    const before = fs.readFileSync(Q_FILE, 'utf8')
    const log = []
    const { c } = wired({ seams: seams(log) })
    const r = c.recoverInstance(APPROVAL)
    assert.strictEqual(r.outcome, OUTCOME.REFUSED_SEQUENCE_MISMATCH, 'instance ' + seed)
    assert.deepStrictEqual(log, [])
    assert.strictEqual(fs.readFileSync(Q_FILE, 'utf8'), before)
  }
})

test('R5. EXECUTOR_RETIRED + STOP_REQUESTED: idempotent already-retired, no stop, no write', () => {
  seedQ(Object.assign({ state: Q.STATES.EXECUTOR_RETIRED, phase: Q.PHASES[0], goneObservedAt: '2026-09-04T00:00:00.000Z' }, identity(APPROVAL)))
  seedI({ state: I.STOP_REQUESTED, observedControlGroup: CG })
  const before = fs.readFileSync(Q_FILE, 'utf8')
  const log = []
  const { c } = wired({ seams: seams(log) })
  const r = c.recoverInstance(APPROVAL)
  assert.strictEqual(r.outcome, OUTCOME.ALREADY_RETIRED)
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.effects, 'none')
  assert.deepStrictEqual(log, [])
  assert.strictEqual(fs.readFileSync(Q_FILE, 'utf8'), before)
})

test('R5b. ⛔ EXECUTOR_RETIRED with any other instance pairing: mismatch REPORTED, retirement NOT rolled back', () => {
  for (const seed of [null, I.PREPARED, I.LAUNCH_ATTEMPTED, I.OBSERVED]) {
    clean()
    seedQ(Object.assign({ state: Q.STATES.EXECUTOR_RETIRED, phase: Q.PHASES[0], goneObservedAt: '2026-09-04T00:00:00.000Z' }, identity(APPROVAL)))
    if (seed) seedI({ state: seed, observedControlGroup: seed === I.OBSERVED ? CG : null })
    const before = fs.readFileSync(Q_FILE, 'utf8')
    const log = []
    const { c } = wired({ seams: seams(log) })
    const r = c.recoverInstance(APPROVAL)
    assert.strictEqual(r.outcome, OUTCOME.ALREADY_RETIRED_WITH_SEQUENCE_MISMATCH, 'instance ' + seed)
    assert.strictEqual(r.ok, false, 'the contradiction is not hidden behind ok:true')
    assert.strictEqual(r.effects, 'none')
    assert.deepStrictEqual(log, [], 'no stop')
    assert.strictEqual(fs.readFileSync(Q_FILE, 'utf8'), before, 'the durable retirement stands')
    assert.strictEqual(qState(), Q.STATES.EXECUTOR_RETIRED)
  }
})

test('R6. ⛔ TERMINAL_OBSERVED: stop must be acknowledged, then retire DIRECTLY — never observe-gone', () => {
  const st = { alive: true }
  const { c, log } = wired({ run: makeWorld(st) })
  seedQ({ state: Q.STATES.PREPARED })
  c.launchApproved(APPROVAL)
  st.alive = false
  seedQ(Object.assign({}, qRec(), { state: Q.STATES.TERMINAL_OBSERVED, taskStatus: 'failed' }))
  log.length = 0
  const r = c.recoverInstance(APPROVAL)
  assert.strictEqual(r.outcome, OUTCOME.RETIRED, JSON.stringify(r))
  assert.deepStrictEqual(log, ['stopUnit'])
  assert.strictEqual(qState(), Q.STATES.EXECUTOR_RETIRED)
  assert.strictEqual(qRec().taskStatus, 'failed', 'the task history is intact')
  assert.ok(!Object.prototype.hasOwnProperty.call(qRec(), 'goneObservedAt'),
    '⛔ no gone-stamp: mixing the two histories is exactly what B4a forbids')
})

test('R6b. TERMINAL_OBSERVED with nothing launched is a sequence mismatch', () => {
  for (const seed of [null, I.PREPARED]) {
    clean()
    seedQ(Object.assign({ state: Q.STATES.TERMINAL_OBSERVED, phase: Q.PHASES[0], taskStatus: 'failed' }, identity(APPROVAL)))
    if (seed) seedI({ state: seed })
    const log = []
    const { c } = wired({ seams: seams(log) })
    const r = c.recoverInstance(APPROVAL)
    assert.strictEqual(r.outcome, OUTCOME.REFUSED_SEQUENCE_MISMATCH, 'instance ' + seed)
    assert.deepStrictEqual(log, [])
  }
})

test('R7. SUCCEEDED / CLIENT_TIMEOUT / QUARANTINED: containment only — requestStop IS written, lock HELD', () => {
  for (const st of [Q.STATES.SUCCEEDED, Q.STATES.CLIENT_TIMEOUT, Q.STATES.QUARANTINED]) {
    clean()
    seedQ(Object.assign({ state: st, phase: Q.PHASES[0] }, identity(APPROVAL)))
    seedI({ state: I.OBSERVED, observedControlGroup: CG })
    const log = []
    const { c } = wired({ seams: seams(log) })
    const r = c.recoverInstance(APPROVAL)
    assert.strictEqual(r.outcome, OUTCOME.CONTAINED_HANDOFF, st)
    assert.strictEqual(r.lockHeld, true, st)
    assert.deepStrictEqual(log, ['stopUnit'], st)
    // ⛔ the containment stop DOES write the instance ledger, and we say so
    assert.strictEqual(iState(), I.STOP_REQUESTED, st + ': stop intent is durable')
    assert.strictEqual(r.effects, 'stop-intent-recorded', st)
    assert.strictEqual(qState(), st, st + ': the quarantine did NOT advance')
    assert.strictEqual(c.gate('appr_fresh').ok, false, st + ': the lock is still held')
  }
})

test('R7b. containment on an already-STOP_REQUESTED record does not rewrite requestStop', () => {
  seedQ(Object.assign({ state: Q.STATES.QUARANTINED, phase: Q.PHASES[0] }, identity(APPROVAL)))
  seedI({ state: I.STOP_REQUESTED, observedControlGroup: CG, updatedAt: 'first' })
  const log = []
  const { c } = wired({ seams: seams(log) })
  const r = c.recoverInstance(APPROVAL)
  assert.strictEqual(r.outcome, OUTCOME.CONTAINED_HANDOFF_REISSUED)
  assert.strictEqual(r.effects, 'stop-reissued')
  assert.deepStrictEqual(log, ['stopUnit'], 'the stop may be reissued')
  assert.strictEqual(iRec().updatedAt, 'first', 'but requestStop was NOT written again')
  assert.strictEqual(r.lockHeld, true)
})

test('R7c. ⛔ containment NEVER stops when nothing was launched', () => {
  for (const seed of [null, I.PREPARED]) {
    clean()
    seedQ(Object.assign({ state: Q.STATES.SUCCEEDED, phase: Q.PHASES[0] }, identity(APPROVAL)))
    if (seed) seedI({ state: seed })
    const log = []
    const { c } = wired({ seams: seams(log) })
    const r = c.recoverInstance(APPROVAL)
    assert.strictEqual(r.outcome, OUTCOME.REFUSED_SEQUENCE_MISMATCH, 'instance ' + seed)
    assert.deepStrictEqual(log, [], 'no containment stop')
    assert.strictEqual(iState(), seed)
  }
})

test('R8. CLEANED / PREPARATION_FAILED: legal pairings by provenance, everything else a mismatch', () => {
  const legal = [
    [Q.STATES.PRE_EXECUTION_ABORTED, [null, I.PREPARED]],
    [Q.STATES.PREPARATION_FAILED, [null]],
    [Q.STATES.EXECUTOR_RETIRED, [I.STOP_REQUESTED]]
  ]
  for (const [from, allowed] of legal) {
    for (const seed of [null, I.PREPARED, I.LAUNCH_ATTEMPTED, I.OBSERVED, I.STOP_REQUESTED]) {
      clean()
      const base = { state: Q.STATES.CLEANED, cleanedFrom: from }
      if (from === Q.STATES.EXECUTOR_RETIRED) Object.assign(base, { phase: Q.PHASES[0], goneObservedAt: '2026-09-04T00:00:00.000Z' }, identity(APPROVAL))
      seedQ(base)
      if (seed) seedI({ state: seed, observedControlGroup: seed === I.OBSERVED || seed === I.STOP_REQUESTED ? CG : null })
      const before = fs.readFileSync(Q_FILE, 'utf8')
      const log = []
      const { c } = wired({ seams: seams(log) })
      const r = c.recoverInstance(APPROVAL)
      if (allowed.includes(seed)) {
        assert.strictEqual(r.outcome, OUTCOME.NOTHING_TO_DO, from + ' + ' + seed)
        assert.strictEqual(r.provenance, from)
      } else {
        assert.strictEqual(r.outcome, OUTCOME.REFUSED_SEQUENCE_MISMATCH, from + ' + ' + seed)
      }
      assert.deepStrictEqual(log, [], 'never a stop')
      assert.strictEqual(fs.readFileSync(Q_FILE, 'utf8'), before, 'never a write')
    }
  }
})

test('R9. ⛔ an unreadable ledger refuses and makes NO claim about the lock', () => {
  fs.writeFileSync(Q_FILE, '{ this is not json', 'utf8')
  const log = []
  const { c } = wired({ seams: seams(log) })
  for (const op of ['recoverInstance', 'abortPrepared', 'status']) {
    const r = c[op](APPROVAL)
    assert.strictEqual(r.outcome, OUTCOME.REFUSED_UNREADABLE, op)
    assert.strictEqual(r.effects, 'none', op)
    assert.strictEqual(r.lockClaim, 'none', op + ': the ledger we would read to know is the unreadable one')
    assert.ok(!('lockHeld' in r), op + ': no lock assertion of any kind')
  }
  assert.deepStrictEqual(log, [])
})

/* ══════════════ V — the two fresh verifications ══════════════ */

test('V1. ⛔ observe and retire each run their OWN fresh verification, and a world that changes back holds the lock', () => {
  let answers = 0
  const gate = () => { answers += 1; return true }
  const st = { alive: true }
  const { c, log } = wired({ run: makeWorld(st), protectedInstancesOk: gate })
  seedQ({ state: Q.STATES.PREPARED })
  c.launchApproved(APPROVAL)
  st.alive = false
  answers = 0
  const r = c.recoverInstance(APPROVAL)
  assert.strictEqual(r.outcome, OUTCOME.RETIRED)
  assert.ok(answers >= 2, 'the protection gate was consulted at least once per verification, got ' + answers)

  // now the same crash window, but the world comes back to life before retire()
  clean()
  // ⛔ the world comes back to life BETWEEN the two verifications: the gate answers true until
  // the observation has been durably recorded, and false from then on.
  const flip = () => qState() !== Q.STATES.EXECUTOR_GONE_OBSERVED
  const st2 = { alive: true }
  const { c: c2, log: log2 } = wired({ run: makeWorld(st2), protectedInstancesOk: flip })
  seedQ({ state: Q.STATES.PREPARED })
  c2.launchApproved(APPROVAL)
  st2.alive = false
  const r2 = c2.recoverInstance(APPROVAL)
  assert.strictEqual(r2.outcome, OUTCOME.RETIRE_REFUSED, JSON.stringify(r2))
  assert.strictEqual(r2.lockHeld, true)
  assert.strictEqual(qState(), Q.STATES.EXECUTOR_GONE_OBSERVED, 'the observation stands, the retirement does not')
  assert.strictEqual(c2.gate('appr_fresh').ok, false, '⛔ the lock is STILL held')
})

/* ══════════════ T — stores are not injectable ══════════════ */

test('T1. ⛔ the constructor accepts no store, fsImpl or path: they cannot redirect the ledgers', () => {
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-x4b4b-elsewhere-'))
  const rogue = { read: () => ({}), write: () => { throw new Error('a rogue store was used') } }
  const { c } = wired({
    deps: {
      store: rogue, instanceStore: rogue, quarantineStore: rogue,
      fsImpl: { readFileSync: () => { throw new Error('rogue fs') } },
      file: path.join(elsewhere, 'x.json'), dataDir: elsewhere, path: elsewhere
    }
  })
  seedQ({ state: Q.STATES.PREPARED })
  const r = c.abortPrepared(APPROVAL)
  assert.strictEqual(r.outcome, OUTCOME.PRE_EXECUTION_ABORTED)
  // the write landed in the FIXED location, not the injected one
  assert.strictEqual(qState(), Q.STATES.PRE_EXECUTION_ABORTED)
  assert.deepStrictEqual(fs.readdirSync(elsewhere), [], 'nothing was written to the injected directory')
  const src = fs.readFileSync(path.join(__dirname, 'openClawComposition.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  for (const bad of ['deps.store', 'deps.instanceStore', 'deps.quarantineStore', 'deps.fsImpl', 'deps.file', 'deps.dataDir']) {
    assert.ok(!code.includes(bad), 'the constructor must not read ' + bad)
  }
})

test('T2. state is verified through the real JSON stores at the fixed data dir', () => {
  seedQ({ state: Q.STATES.PREPARED })
  const { c } = wired()
  c.abortPrepared(APPROVAL)
  assert.strictEqual(path.dirname(Q_FILE), DATA_DIR)
  assert.strictEqual(readJson(Q_FILE)[APPROVAL].state, Q.STATES.PRE_EXECUTION_ABORTED)
})

/* ══════════════ I — offline and unreachable ══════════════ */

test('I1. ⛔ requiring the module constructs nothing, spawns nothing and reads no ledger', () => {
  const before = readJson(Q_FILE)
  let spawned = 0
  const spied = require.resolve('../agent/openClawComposition')
  delete require.cache[spied]
  const fresh = require('../agent/openClawComposition')
  assert.strictEqual(typeof fresh.createOpenClawComposition, 'function')
  assert.deepStrictEqual(readJson(Q_FILE), before, 'no ledger read or write on import')
  assert.strictEqual(spawned, 0)
  const src = fs.readFileSync(path.join(__dirname, 'openClawComposition.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  // ⛔ no module-level construction: every factory call must sit INSIDE the factory function,
  // which is true iff every such call is indented (the factory body) rather than at column 0.
  const topLevelCalls = code.split('\n').filter((l) => /^\s{0,1}\S.*\bcreateOpenClaw\w*\s*\(/.test(l) && !/^function |^\s*\*/.test(l))
  assert.deepStrictEqual(topLevelCalls, [], 'no factory may be constructed at module level: ' + JSON.stringify(topLevelCalls))
  assert.ok(!/^const \w+ = createOpenClaw/m.test(code), 'no module-level instance')
  // and it never reaches a process-creating capability itself
  for (const bad of ['child_process', 'spawn(', 'execSync', 'systemd-run', 'wsl.exe', 'exactWslExec']) {
    assert.ok(!code.includes(bad), 'no ' + bad + ' in the composition root')
  }
})

test('I2. ⛔ NOTHING requires the composition root; app.js and the registry are untouched', () => {
  const srcRoot = path.join(__dirname, '..')
  const files = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.endsWith('.js')) files.push(full)
    }
  }
  walk(srcRoot)
  const importers = []
  for (const f of files) {
    if (path.basename(f) === 'openClawComposition.test.js') continue
    const code = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    if (/require\([^)]*openClawComposition/.test(code)) importers.push(path.relative(srcRoot, f))
  }
  assert.deepStrictEqual(importers, [], 'only its own test may require the composition root')

  const app = fs.readFileSync(path.join(srcRoot, 'app.js'), 'utf8')
  assert.ok(!/openclaw/i.test(app), 'src/app.js must contain zero OpenClaw references')
  const registry = fs.readFileSync(path.join(srcRoot, 'workers', 'registry.js'), 'utf8')
  assert.match(registry, /id: 'openclaw'[\s\S]{0,200}?connected: false/, 'the OpenClaw worker row stays connected:false')
})

test('I3. ⛔ the composition root does not construct the legacy transport or either workspace', () => {
  const src = fs.readFileSync(path.join(__dirname, 'openClawComposition.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  for (const bad of ['createOpenClawTransport', 'createOpenClawWslWorkspace', 'createOpenClawGovernedWorkspace']) {
    assert.ok(!code.includes(bad), bad + ' must not be composed: it would be a second spawn path or a second begin() owner')
  }
  const requires = (code.match(/require\('\.\/[^']+'\)/g) || []).sort()
  assert.deepStrictEqual(requires, [
    "require('./openClawExecutorLauncher')",
    "require('./openClawInstanceManager')",
    "require('./openClawInstanceStore')",
    "require('./openClawOsAdapters')",
    "require('./openClawQuarantine')",
    "require('./openClawReconciler')",
    "require('./openClawRetirementVerifier')"
  ])
})

test('I4. the B4c deferrals are recorded in the source, including the governed-workspace scope rule', () => {
  const src = fs.readFileSync(path.join(__dirname, 'openClawComposition.js'), 'utf8')
  assert.match(src, /B4c/, 'the deferral is stated')
  assert.match(src, /governedWorkspace[\s\S]{0,200}openclaw-ledgers-v1|openclaw-ledgers-v1[\s\S]{0,200}governedWorkspace/,
    'B4c must route the governed-workspace ledger mutations through the same scope')
  assert.match(src, /production ledgerCoordinator|production global coordinator|the production implementation/i)
})

/* ══════════════ M — reconcile ══════════════ */

test('M1. reconcile() runs inside the lock and reports without releasing anything', () => {
  seedQ(Object.assign({ state: Q.STATES.RUNNING, phase: Q.PHASES[0] }, identity(APPROVAL)))
  const { c, coord } = wired()
  const r = c.reconcile()
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.report.unaccounted, 1)
  assert.strictEqual(r.report.executionAllowed, false)
  assert.deepStrictEqual(coord.calls, [LEDGER_SCOPE])
  assert.strictEqual(qState(), Q.STATES.RUNNING, 'the reconciler advanced nothing without evidence')
})

/* ══════════════ gaps closed after the first mutation run ══════════════ */

test('K5b. ⛔ the SAME composition is still usable after a section throws: the guard is cleared in finally', () => {
  // one composition, whose coordinator throws on the first call and works afterwards
  let calls = 0
  const coord = {
    runExclusive (scope, fn) {
      calls += 1
      if (calls === 1) throw new Error('coordinator unavailable on the first attempt')
      return fn()
    }
  }
  const log = []
  const c = createOpenClawComposition(Object.assign(
    { run: cleanWorldRun(), ledgerCoordinator: coord, protectedInstancesOk: () => true, executorUid: 1000 },
    seams(log)))

  seedQ({ state: Q.STATES.PREPARED })
  const first = c.abortPrepared(APPROVAL)
  assert.strictEqual(first.outcome, OUTCOME.REFUSED_COORDINATOR_FAILED)
  assert.strictEqual(first.effects, 'none')
  assert.strictEqual(qState(), Q.STATES.PREPARED, 'nothing happened')

  // ⛔ THE SAME INSTANCE must not be wedged: inFlight has to have been cleared in finally
  const second = c.abortPrepared(APPROVAL)
  assert.strictEqual(second.outcome, OUTCOME.PRE_EXECUTION_ABORTED,
    'the composition is wedged: the re-entrancy flag was not released after the throw')
  assert.strictEqual(qState(), Q.STATES.PRE_EXECUTION_ABORTED)

  // and the same after a section that throws AFTER entering
  clean(); seedQ({ state: Q.STATES.PREPARED })
  let n = 0
  const coord2 = {
    runExclusive (scope, fn) {
      n += 1
      const out = fn()
      if (n === 1) throw new Error('lease lost after the section')
      return out
    }
  }
  const c2 = createOpenClawComposition(Object.assign(
    { run: cleanWorldRun(), ledgerCoordinator: coord2, protectedInstancesOk: () => true, executorUid: 1000 },
    seams([])))
  assert.strictEqual(c2.abortPrepared(APPROVAL).outcome, OUTCOME.COORDINATOR_FAILED_AFTER_OPERATION)
  assert.strictEqual(c2.status(APPROVAL).ok, true, 'still usable after an after-section throw')
})

test('S2b. ⛔ the containment stop uses the CAPTURED seam, never a later deps.stopUnit', () => {
  const log = []
  const deps = Object.assign(
    { run: cleanWorldRun(), ledgerCoordinator: coordinator(), protectedInstancesOk: () => true, executorUid: 1000 },
    seams(log))
  const c = createOpenClawComposition(deps)

  // replace the seam AFTER construction with one that must never run
  deps.stopUnit = (u) => { log.push('stopUnit.replaced'); return { ok: true, unitName: u } }

  seedQ(Object.assign({ state: Q.STATES.QUARANTINED, phase: Q.PHASES[0] }, identity(APPROVAL)))
  seedI({ state: I.OBSERVED, observedControlGroup: CG })
  const r = c.recoverInstance(APPROVAL)
  assert.strictEqual(r.outcome, OUTCOME.CONTAINED_HANDOFF)
  assert.deepStrictEqual(log, ['stopUnit'], 'the ORIGINAL captured seam ran')
  assert.ok(!log.includes('stopUnit.replaced'), 'the late replacement must never run')

  // deleting it afterwards changes nothing either
  delete deps.stopUnit
  clean()
  seedQ(Object.assign({ state: Q.STATES.QUARANTINED, phase: Q.PHASES[0] }, identity(APPROVAL)))
  seedI({ state: I.OBSERVED, observedControlGroup: CG })
  log.length = 0
  assert.strictEqual(c.recoverInstance(APPROVAL).outcome, OUTCOME.CONTAINED_HANDOFF)
  assert.deepStrictEqual(log, ['stopUnit'])
})

test('R3c. ⛔ RUNNING recovery with an UNACKNOWLEDGED stop never observes and never retires', () => {
  const answers = [
    ['null', null],
    ['{ issued: true }', { issued: true }],
    ['{ ok: false, unitName }', { ok: false, unitName: UNIT }],
    ['{ ok: true } with no unit', { ok: true }],
    ['wrong unit', { ok: true, unitName: 'aroma-oc-someone-else.service' }],
    ["ok as the string 'true'", { ok: 'true', unitName: UNIT }]
  ]
  for (const [label, answer] of answers) {
    clean()
    const st = { alive: true }
    const log = []
    const { c } = wired({ run: makeWorld(st), seams: seams(log, { stopUnit: (u) => { log.push('stopUnit'); return answer } }) })
    seedQ({ state: Q.STATES.PREPARED })
    assert.strictEqual(c.launchApproved(APPROVAL).outcome, OUTCOME.LAUNCHED, label)
    st.alive = false
    log.length = 0

    const r = c.recoverInstance(APPROVAL)
    assert.strictEqual(r.outcome, OUTCOME.STOP_NOT_ACKNOWLEDGED, label + ': ' + JSON.stringify(r))
    assert.strictEqual(r.lockHeld, true, label)
    assert.deepStrictEqual(log, ['stopUnit'], label)
    // ⛔ the quarantine never advanced: no observation, no retirement
    assert.strictEqual(qState(), Q.STATES.RUNNING, label + ': the lock is still held by RUNNING')
    assert.ok(!Object.prototype.hasOwnProperty.call(qRec(), 'goneObservedAt'), label + ': nothing was observed')
    // the durable stop intent WAS recorded, and we report that honestly
    assert.strictEqual(iState(), I.STOP_REQUESTED, label)
    assert.strictEqual(r.effects, 'stop-intent-recorded', label)
    assert.strictEqual(c.gate('appr_fresh').ok, false, label + ': execution stays locked out')
  }
})

test('R3d. ⛔ a thrown stop is equally unacknowledged: no observation, no retirement, lock held', () => {
  const st = { alive: true }
  const log = []
  const { c } = wired({ run: makeWorld(st), seams: seams(log, { stopUnit: () => { log.push('stopUnit'); throw new Error('systemctl stop exploded') } }) })
  seedQ({ state: Q.STATES.PREPARED })
  c.launchApproved(APPROVAL)
  st.alive = false
  log.length = 0
  const r = c.recoverInstance(APPROVAL)
  assert.strictEqual(r.outcome, OUTCOME.STOP_NOT_ACKNOWLEDGED)
  assert.strictEqual(r.lockHeld, true)
  assert.strictEqual(qState(), Q.STATES.RUNNING)
  assert.strictEqual(iState(), I.STOP_REQUESTED)
})

/* ══════════════ corrections required by review ══════════════ */

test('S1b. ⛔ EVERY constructor property is read exactly ONCE, and a poisoned second read never runs', () => {
  const reads = Object.create(null)
  const base = {
    run: cleanWorldRun(),
    ledgerCoordinator: coordinator(),
    protectedInstancesOk: () => true,
    executorUid: 1000,
    now: () => '2026-09-04T00:00:00.000Z'
  }
  const log = []
  Object.assign(base, seams(log))

  const deps = {}
  const NAMES = ['run', 'ledgerCoordinator', 'protectedInstancesOk', 'executorUid', 'now'].concat(EXECUTION_SEAMS.slice())
  for (const name of NAMES) {
    reads[name] = 0
    Object.defineProperty(deps, name, {
      enumerable: true,
      configurable: true,
      get () {
        reads[name] += 1
        if (reads[name] === 1) return base[name]
        // ⛔ the SECOND read hands back something that must never be used
        if (name === 'executorUid') return -1
        if (name === 'ledgerCoordinator') return { runExclusive: () => { throw new Error('poisoned coordinator ran') } }
        return () => { throw new Error('poisoned ' + name + ' ran') }
      }
    })
  }

  const c = createOpenClawComposition(deps)
  for (const name of NAMES) assert.strictEqual(reads[name], 1, name + ' must be read exactly once at construction')

  // and nothing consults deps again, through any facade operation
  seedQ({ state: Q.STATES.PREPARED })
  c.status(APPROVAL)
  c.gate(APPROVAL)
  c.listUnaccounted()
  c.launchApproved(APPROVAL)
  c.abortPrepared(APPROVAL)
  c.recoverInstance(APPROVAL)
  c.reconcile()
  for (const name of NAMES) assert.strictEqual(reads[name], 1, name + ' was re-read after construction')
  assert.strictEqual(qState(), Q.STATES.PRE_EXECUTION_ABORTED, 'and the real dependencies were the ones used')
})

test('S1c. ⛔ ledgerCoordinator.runExclusive is read exactly ONCE, before it is bound', () => {
  let reads = 0
  const real = coordinator()
  const coord = {
    get runExclusive () {
      reads += 1
      if (reads === 1) return real.runExclusive
      return () => { throw new Error('a re-read runExclusive was used') }
    }
  }
  const log = []
  const c = createOpenClawComposition(Object.assign(
    { run: cleanWorldRun(), ledgerCoordinator: coord, protectedInstancesOk: () => true, executorUid: 1000 },
    seams(log)))
  assert.strictEqual(reads, 1, 'read once at construction (typeof and bind must share one read)')

  seedQ({ state: Q.STATES.PREPARED })
  assert.strictEqual(c.abortPrepared(APPROVAL).outcome, OUTCOME.PRE_EXECUTION_ABORTED)
  c.status(APPROVAL); c.reconcile()
  assert.strictEqual(reads, 1, 'runExclusive was never re-read')
})

test('S1d. ⛔ a hostile property whose FIRST read is not a function stays missing forever', () => {
  let n = 0
  const deps = { run: cleanWorldRun(), ledgerCoordinator: coordinator(), protectedInstancesOk: () => true, executorUid: 1000 }
  Object.assign(deps, seams([]))
  Object.defineProperty(deps, 'stopUnit', {
    enumerable: true,
    configurable: true,
    get () { n += 1; return n === 1 ? undefined : (u) => ({ ok: true, unitName: u }) }
  })
  const c = createOpenClawComposition(deps)
  assert.strictEqual(n, 1)
  assert.strictEqual(c.capabilities.canStop, false)
  assert.strictEqual(c.capabilities.canLaunch, false, 'a missing stop seam also blocks launching')
  seedQ(Object.assign({ state: Q.STATES.QUARANTINED, phase: Q.PHASES[0] }, identity(APPROVAL)))
  seedI({ state: I.OBSERVED, observedControlGroup: CG })
  const r = c.recoverInstance(APPROVAL)
  assert.strictEqual(r.outcome, OUTCOME.REFUSED_MISSING_SEAM)
  assert.strictEqual(n, 1, 'never re-read')
})

test('G6b. ⛔ READER COMPLETENESS: the launch capability tracks the readers ACTUALLY wired to the verifier', () => {
  const log = []
  const { c } = wired({ seams: seams(log) })
  // with every reader wired, the capability is on and a launch is permitted
  assert.strictEqual(c.capabilities.hasVerifierReaders, true)
  assert.strictEqual(c.capabilities.canLaunch, true)
  assert.strictEqual(VERIFIER_READERS.length, 8)

  // the capability must be DERIVED from the wiring, not from the adapter surface: a mutant that
  // drops one reader connection has to turn this false and refuse the launch before any write.
  const src = fs.readFileSync(path.join(__dirname, 'openClawComposition.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  assert.match(code, /readersComplete\s*=\s*VERIFIER_READERS\.every\(\(r\)\s*=>\s*typeof verifierDeps\[r\]\s*===\s*'function'\)/,
    'readersComplete must be computed from verifierDeps, so dropping a wired reader is visible')
  assert.match(code, /canLaunch:[\s\S]{0,200}?readersComplete/, 'and canLaunch must depend on it')

  // and every one of the eight is genuinely wired from the adapters
  for (const r of VERIFIER_READERS) {
    assert.match(code, new RegExp('for \\(const r of VERIFIER_READERS\\) verifierDeps\\[r\\] = adapters\\[r\\]'),
      'reader ' + r + ' is wired from the adapters')
  }
})

/* ══════════════ hostile thrown values: containment must be total ══════════════ */

/** A revoked Proxy: typeof works, but any property access throws. */
function revokedProxy () {
  const r = Proxy.revocable({ message: 'never readable' }, {})
  r.revoke()
  return r.proxy
}
/** An object whose `message` getter throws, and whose String() also throws. */
function hostileError () {
  return {
    get message () { throw new Error('hostile message getter') },
    toString () { throw new Error('hostile toString') },
    get [Symbol.toPrimitive] () { throw new Error('hostile toPrimitive') }
  }
}
/** A Proxy whose every trap throws. */
function trapProxy () {
  return new Proxy({}, {
    get () { throw new Error('hostile get trap') },
    has () { throw new Error('hostile has trap') },
    getOwnPropertyDescriptor () { throw new Error('hostile gOPD trap') }
  })
}
const HOSTILE = [
  ['null', () => null],
  ['undefined', () => undefined],
  ['a string', () => 'plain string throw'],
  ['a number', () => 42],
  ['a symbol', () => Symbol('boom')],
  ['a revoked Proxy', revokedProxy],
  ['a throwing-message object', hostileError],
  ['a trap Proxy', trapProxy]
]

test('E1. ⛔ ANY value thrown BEFORE the callback is a zero-effect coordinator refusal — never DID_NOT_RUN', () => {
  for (const [label, make] of HOSTILE) {
    clean(); seedQ({ state: Q.STATES.PREPARED })
    const before = fs.readFileSync(Q_FILE, 'utf8')
    const log = []
    const thrown = make()
    const coord = { runExclusive () { throw thrown } }
    const { c } = wired({ coordinator: coord, seams: seams(log) })
    let r
    try {
      r = c.abortPrepared(APPROVAL)
    } catch (e) {
      assert.fail(label + ': the exception escaped instead of being contained')
    }
    assert.strictEqual(r.outcome, OUTCOME.REFUSED_COORDINATOR_FAILED, label)
    assert.notStrictEqual(r.outcome, OUTCOME.REFUSED_COORDINATOR_DID_NOT_RUN, label)
    assert.strictEqual(r.effects, 'none', label)
    assert.strictEqual(typeof r.reason, 'string', label + ': the reason is always a bounded string')
    assert.ok(r.reason.length <= 300, label)
    assert.strictEqual(fs.readFileSync(Q_FILE, 'utf8'), before, label + ': nothing was written')
    assert.deepStrictEqual(log, [], label + ': no OS action')
  }
})

test('E2. ⛔ ANY value thrown by the INNER OPERATION ITSELF and SWALLOWED is DURING_OPERATION — never a null return', () => {
  /**
   * ⛔ THE HOSTILE VALUE MUST COME FROM THE INNER OPERATION, NOT FROM THE COORDINATOR.
   *
   * An earlier version of this test let the inner call throw an ordinary Error and had the
   * coordinator substitute the hostile value afterwards. That proved nothing: the section's own
   * catch had already recorded the ordinary Error, and first-error-wins meant the substituted
   * value never reached the classifier — every iteration re-tested the same plain Error.
   *
   * So the throw is planted INSIDE the operation: `now()` is called by the quarantine while it
   * writes, so abortPrepared() enters the section, begins the write, and throws the hostile
   * value from there. The coordinator then swallows it.
   */
  for (const [label, make] of HOSTILE) {
    clean(); seedQ({ state: Q.STATES.PREPARED })
    const thrown = make()
    let entered = false
    const swallowing = {
      runExclusive (scope, fn) {
        entered = true
        try { fn() } catch (e) { /* swallowed on purpose */ }
      }
    }
    const c = createOpenClawComposition(Object.assign({
      run: cleanWorldRun(),
      ledgerCoordinator: swallowing,
      protectedInstancesOk: () => true,
      executorUid: 1000,
      // ⛔ the inner operation itself throws, part-way through its durable write
      now: () => { throw thrown }
    }, seams([])))

    let r
    try {
      r = c.abortPrepared(APPROVAL)
    } catch (e) {
      assert.fail(label + ': the exception escaped instead of being contained')
    }
    assert.strictEqual(entered, true, label + ': the section really ran')
    assert.notStrictEqual(r, null, label + ': a structured result, never null')
    assert.notStrictEqual(r, undefined, label)
    assert.strictEqual(r.outcome, OUTCOME.COORDINATOR_FAILED_DURING_OPERATION, label + ': ' + JSON.stringify(r))
    assert.strictEqual(r.innerCompleted, false, label)
    assert.strictEqual(r.effects, 'possibly-partial', label)
    assert.strictEqual(typeof r.reason, 'string', label)
    assert.ok(r.reason.length <= 300, label)
    // ⛔ the preserved value is the INNER throw, not something the coordinator supplied
    if (label === 'null') assert.strictEqual(r.reason, 'null', 'the null thrown by the operation itself was preserved')
    if (label === 'undefined') assert.strictEqual(r.reason, 'undefined', label)
    if (label === 'a string') assert.strictEqual(r.reason, 'plain string throw', label)
    if (label === 'a number') assert.strictEqual(r.reason, '42', label)
  }
})

test('E3. ⛔ ANY value thrown AFTER a completed callback keeps the durable outcome and is never success', () => {
  for (const [label, make] of HOSTILE) {
    clean(); seedQ({ state: Q.STATES.PREPARED })
    const thrown = make()
    const coord = { runExclusive (scope, fn) { fn(); throw thrown } }
    const { c } = wired({ coordinator: coord })
    let r
    try {
      r = c.abortPrepared(APPROVAL)
    } catch (e) {
      assert.fail(label + ': the exception escaped')
    }
    assert.strictEqual(r.outcome, OUTCOME.COORDINATOR_FAILED_AFTER_OPERATION, label + ': ' + JSON.stringify(r))
    assert.strictEqual(r.ok, false, label + ': never reported as success')
    assert.strictEqual(r.innerCompleted, true, label)
    assert.notStrictEqual(r.effects, 'none', label)
    assert.strictEqual(r.innerOutcome.outcome, OUTCOME.PRE_EXECUTION_ABORTED, label + ': the first outcome is preserved')
    // ⛔ the durable write stands and is not rolled back
    assert.strictEqual(qState(), Q.STATES.PRE_EXECUTION_ABORTED, label)
    assert.strictEqual(typeof r.reason, 'string', label)
  }
})

test('E4. ⛔ a FORGED protocol brand cannot buy the protocol-violation outcome', () => {
  seedQ({ state: Q.STATES.PREPARED })
  // a coordinator that throws something carrying every plausible marker property
  const forged = new Error('forged')
  forged['openclaw-composition-protocol-violation'] = true
  forged.protocol = true
  forged.isProtocolViolation = true
  const coord = { runExclusive (scope, fn) { fn(); throw forged } }
  const { c } = wired({ coordinator: coord })
  const r = c.abortPrepared(APPROVAL)
  assert.strictEqual(r.outcome, OUTCOME.COORDINATOR_FAILED_AFTER_OPERATION,
    'an ordinary coordinator failure must NOT be able to label itself a protocol violation')
  assert.notStrictEqual(r.outcome, OUTCOME.COORDINATOR_PROTOCOL_VIOLATION_AFTER_OPERATION)
  // and a genuine violation still classifies correctly
  clean(); seedQ({ state: Q.STATES.PREPARED })
  const dup = { runExclusive (scope, fn) { fn(); try { fn() } catch (e) { throw e } } }
  const { c: c2 } = wired({ coordinator: dup })
  assert.strictEqual(c2.abortPrepared(APPROVAL).outcome, OUTCOME.COORDINATOR_PROTOCOL_VIOLATION_AFTER_OPERATION)
})

test('E5. ⛔ a hostile stopUnit throw during containment does not crash, and the lock stays held', () => {
  for (const [label, make] of HOSTILE) {
    clean()
    seedQ(Object.assign({ state: Q.STATES.QUARANTINED, phase: Q.PHASES[0] }, identity(APPROVAL)))
    seedI({ state: I.OBSERVED, observedControlGroup: CG })
    const log = []
    const thrown = make()
    const { c } = wired({ seams: seams(log, { stopUnit: () => { log.push('stopUnit'); throw thrown } }) })
    let r
    try {
      r = c.recoverInstance(APPROVAL)
    } catch (e) {
      assert.fail(label + ': the hostile throw escaped recovery')
    }
    assert.strictEqual(r.outcome, OUTCOME.CONTAINED_HANDOFF, label)
    assert.strictEqual(r.stopAcknowledged, false, label)
    assert.strictEqual(typeof r.stopReason, 'string', label + ': a bounded reason, never a crash')
    // the durable stop intent was still recorded, and the quarantine did not advance
    assert.strictEqual(iState(), I.STOP_REQUESTED, label)
    assert.strictEqual(qState(), Q.STATES.QUARANTINED, label)
    assert.strictEqual(r.lockHeld, true, label)
    assert.strictEqual(c.gate('appr_fresh').ok, false, label + ': execution stays locked out')
  }
})

test('E6. ⛔ a hostile stopUnit throw during a RUNNING recovery: no observation, no retirement, lock held', () => {
  for (const make of [revokedProxy, hostileError, () => null]) {
    clean()
    const st = { alive: true }
    const log = []
    const thrown = make()
    const { c } = wired({ run: makeWorld(st), seams: seams(log, { stopUnit: () => { log.push('stopUnit'); throw thrown } }) })
    seedQ({ state: Q.STATES.PREPARED })
    assert.strictEqual(c.launchApproved(APPROVAL).outcome, OUTCOME.LAUNCHED)
    st.alive = false
    log.length = 0
    let r
    try {
      r = c.recoverInstance(APPROVAL)
    } catch (e) {
      assert.fail('the hostile throw escaped: ' + e)
    }
    assert.strictEqual(r.outcome, OUTCOME.STOP_NOT_ACKNOWLEDGED)
    assert.strictEqual(r.lockHeld, true)
    assert.strictEqual(qState(), Q.STATES.RUNNING, 'no observation, no retirement')
    assert.strictEqual(iState(), I.STOP_REQUESTED, 'the stop intent is durable')
  }
})

/* ══════════════ the composition boundary still contains a GENUINE launcher escape ══════════════ */

test('E7. ⛔ launcher.recover() throwing from a NON-formatting path is contained by the composition boundary', () => {
  /**
   * ⛔ THIS IS NO LONGER THE SEAM-FORMATTING HOLE — THAT ONE IS CLOSED IN THE LAUNCHER.
   *
   * A hostile stopUnit throw is now described by the launcher's own total formatter and comes
   * back as a structured STOP_UNKNOWN (see E5/E6). So the boundary is proven here against a
   * different, still-real escape: recover() calls instances.requestStop() OUTSIDE any try, and
   * the instance ledger stamps its writes with now(). A now() that fails during that write
   * throws straight out of recover().
   */
  for (const [label, make] of [
    ['a revoked Proxy', revokedProxy],
    ['a throwing-message object', hostileError],
    ['null', () => null]
  ]) {
    clean()
    const armed = { on: false }
    const thrown = make()
    const st = { alive: true }
    const log = []
    const c = createOpenClawComposition(Object.assign({
      run: makeWorld(st),
      ledgerCoordinator: coordinator(),
      protectedInstancesOk: () => true,
      executorUid: 1000,
      // the SAME captured function throughout; only the world it reports changes
      now: () => {
        if (armed.on) throw thrown
        return new Date().toISOString()
      }
    }, seams(log)))

    seedQ({ state: Q.STATES.PREPARED })
    assert.strictEqual(c.launchApproved(APPROVAL).outcome, OUTCOME.LAUNCHED, label)
    st.alive = false
    log.length = 0
    armed.on = true // ⛔ from here the instance ledger cannot stamp a write

    let r
    try {
      r = c.recoverInstance(APPROVAL)
    } catch (e) {
      assert.fail(label + ': the launcher escape was not contained by the composition boundary')
    }
    assert.strictEqual(r.outcome, OUTCOME.STOP_NOT_ACKNOWLEDGED, label + ': ' + JSON.stringify(r))
    assert.strictEqual(r.ok, false, label)
    // ⛔ never 'none': recover() had already begun when it threw
    assert.notStrictEqual(r.effects, 'none', label)
    assert.strictEqual(r.effects, 'possibly-partial', label)
    assert.strictEqual(r.lockHeld, true, label)
    assert.strictEqual(typeof r.reason, 'string', label)
    assert.ok(r.reason.length <= 400, label)
    // ⛔ nothing was observed and nothing was retired
    assert.strictEqual(qState(), Q.STATES.RUNNING, label + ': the quarantine did not advance')
    assert.ok(!Object.prototype.hasOwnProperty.call(qRec(), 'goneObservedAt'), label)
    assert.deepStrictEqual(log, [], label + ': the stop was never even issued')
    assert.strictEqual(c.gate('appr_fresh').ok, false, label + ': execution stays locked out')
  }
})

test('E8. the launcher now contains its own seam and verifier throws — the boundary is defence in depth', () => {
  // the composition comment must describe the CURRENT truth, not the closed hole
  const src = fs.readFileSync(path.join(__dirname, 'openClawComposition.js'), 'utf8')
  assert.match(src, /DEFENCE IN DEPTH/, 'the boundary is documented as defence in depth')
  assert.ok(!/THE LAUNCHER'S OWN ERROR FORMATTING IS NOT TOTAL/.test(src),
    'the stale claim that the launcher formatting is unsafe must be gone')
  // and the launcher really does contain them now
  const launcherSrc = fs.readFileSync(path.join(__dirname, 'openClawExecutorLauncher.js'), 'utf8')
  const code = launcherSrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  assert.ok(!/e\s*&&\s*e\.message/.test(code), 'the launcher has no unguarded .message read left')
  assert.strictEqual((code.match(/describeThrown\(e\)/g) || []).length, 3)
})
