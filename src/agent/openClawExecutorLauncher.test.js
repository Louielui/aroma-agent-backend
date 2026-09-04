'use strict'

/**
 * openClawExecutorLauncher.test.js — THE ORDER OF THE TWO LEDGERS, PROVEN WITH STRICT FAKES.
 *
 * Every fake appends OWN data entries to a shared order log, so the security-critical
 * sub-order markRunning < launchAttempted < launchUnit is asserted on what actually happened,
 * and every crash/failure injection asserts the durable states left behind AND that no
 * forbidden later action occurred. The instance manager is the REAL one over an in-memory
 * store; the quarantine is a strict fake of the FUTURE contract, plus one compatibility test
 * against the CURRENT real quarantine proving the launcher cannot activate before B4.
 */

const os = require('os')
const fs = require('fs')
const path = require('path')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-x4b3-launcher-'))

const test = require('node:test')
const assert = require('node:assert')

const L = require('../agent/openClawExecutorLauncher')
const { createOpenClawInstanceManager, derivedPathsFor, unitNameFor, STATES } = require('../agent/openClawInstanceManager')
const Q = require('../agent/openClawQuarantine')
const { createOpenClawRetirementVerifier, VERDICT } = require('../agent/openClawRetirementVerifier')

const APPROVAL = 'appr_x4b3'
const UNIT = unitNameFor(APPROVAL)
const P = derivedPathsFor(APPROVAL)
const CG = '/user.slice/user-1000.slice/user@1000.service/app.slice/' + UNIT
const PORT = 18901

/** An order log whose entries are OWN data elements (immune to an Array.prototype setter). */
function orderLog () {
  const log = []
  return { log, note: (step, extra) => { Object.defineProperty(log, log.length, { value: Object.assign({ step }, extra || {}), writable: true, enumerable: true, configurable: true }) } }
}
const steps = (log) => log.map((e) => e.step)

/** A strict fake of the FUTURE quarantine contract: markRunning accepts executor_launch_attempting. */
function futureQuarantine (o, over = {}) {
  const st = { state: 'PREPARED', phase: null, agentId: null, sessionKey: null }
  return {
    st,
    markRunning (approvalId, meta) {
      o.note('quarantine.markRunning', { approvalId, phase: meta && meta.phase })
      if (over.markRunningThrows) throw new Error('refuse: injected markRunning failure')
      assert.strictEqual(meta.phase, 'executor_launch_attempting', 'the launcher opens with the ISOLATED phase')
      assert.strictEqual(meta.agentId, Q.expectedAgentIdFor(approvalId))
      assert.strictEqual(meta.sessionKey, Q.expectedSessionKeyFor(approvalId))
      st.state = 'RUNNING'; st.phase = meta.phase; st.agentId = meta.agentId; st.sessionKey = meta.sessionKey
    },
    retire () { o.note('quarantine.retire'); throw new Error('quarantine.retire must NEVER be called in B3') }
  }
}

/** The real instance manager over an in-memory store, with every mutation logged. */
function instances (o, over = {}) {
  let data = {}
  const store = { read: () => JSON.parse(JSON.stringify(data)), write: (all) => { data = JSON.parse(JSON.stringify(all)) } }
  const m = createOpenClawInstanceManager({ store })
  const wrap = (name, before) => (...args) => {
    o.note('instances.' + name, { approvalId: args[0] })
    if (before) before(...args)
    return m[name](...args)
  }
  return {
    raw: m,
    peek: () => data[APPROVAL] || null,
    prepare: wrap('prepare', over.prepareThrows ? () => { throw new Error('refuse: injected prepare failure') } : null),
    launchAttempted: wrap('launchAttempted', over.launchAttemptedThrows ? () => { throw new Error('refuse: injected launchAttempted failure') } : null),
    observeControlGroup: wrap('observeControlGroup'),
    observePids: wrap('observePids'),
    requestStop: wrap('requestStop'),
    record: (id) => m.record(id)
  }
}

const statOk = (dev, ino) => ({ exists: true, dev, ino })
const STAT = { [P.envelopeRoot]: statOk('2096', '126262'), [P.repoRoot]: statOk('2096', '126263') }

/** Default seams: everything healthy, everything logged. */
function seams (o, over = {}) {
  return Object.assign({
    statPath: (p) => { o.note('statPath', { path: p }); return STAT[p] || { exists: false } },
    allocateGatewayPort: () => { o.note('allocateGatewayPort'); return PORT },
    launchUnit: (spec) => { o.note('launchUnit', { unitName: spec.unitName }); return { ok: true, unitName: spec.unitName } },
    observeControlGroup: (unit) => { o.note('observeControlGroup', { unitName: unit }); return CG },
    readControlGroup: (p) => { o.note('readControlGroup', { path: p }); return { exists: true, procs: [93018, 93017] } },
    stopUnit: (unit) => { o.note('stopUnit', { unitName: unit }); return { ok: true, unitName: unit } }
  }, over)
}

function launcher (o, over = {}) {
  const q = futureQuarantine(o, over)
  const i = instances(o, over)
  const l = L.createOpenClawExecutorLauncher(Object.assign({ instances: i, quarantine: q }, seams(o, over.seams || {}), over.deps || {}))
  return { l, q, i }
}

const idx = (log, step) => steps(log).indexOf(step)
const never = (log, step) => assert.strictEqual(idx(log, step), -1, step + ' must not have happened: ' + steps(log).join(' > '))

/* ══════════════ inertness ══════════════ */

test('I1. ⛔ the launcher imports no process-creating capability and has no default external seam', () => {
  const src = fs.readFileSync(path.join(__dirname, 'openClawExecutorLauncher.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  for (const bad of ['child_process', 'spawn', 'execSync', 'execFile', 'systemd-run', 'systemctl', 'wsl.exe', 'openclaw agent', 'exactWslExec', 'openClawOsAdapters']) {
    assert.ok(!code.includes(bad), 'no ' + bad + ' in the launcher')
  }
  const requires = code.match(/require\([^)]*\)/g) || []
  assert.deepStrictEqual(requires.sort(), ["require('./openClawInstanceManager')", "require('./openClawQuarantine')", "require('./openClawReaderContracts')"].sort())
  assert.ok(!code.includes("'agent_add_attempting'"), 'the legacy phase is never used')
  assert.strictEqual(L.PHASE_EXECUTOR_LAUNCH_ATTEMPTING, 'executor_launch_attempting')
})

test('I2. ⛔ a missing execution seam refuses BEFORE any ledger write', () => {
  for (const missing of L.LAUNCH_SEAMS) {
    const o = orderLog()
    const over = { seams: {} }; over.seams[missing] = undefined
    const { l, i, q } = launcher(o, over)
    const r = l.run(APPROVAL)
    assert.strictEqual(r.ok, false); assert.strictEqual(r.outcome, L.OUTCOME.REFUSED)
    assert.match(r.reason, new RegExp(missing))
    assert.deepStrictEqual(steps(o.log), [], missing + ': nothing at all happened')
    assert.strictEqual(i.peek(), null); assert.strictEqual(q.st.state, 'PREPARED')
  }
  assert.throws(() => L.createOpenClawExecutorLauncher({ quarantine: {} }), TypeError)
  assert.throws(() => L.createOpenClawExecutorLauncher({ instances: instances(orderLog()) }), TypeError)
})

/* ══════════════ the happy path and its exact order ══════════════ */

test('O1. ⛔ the full order, and the security-critical sub-order markRunning < launchAttempted < launchUnit', () => {
  const o = orderLog()
  const { l, i, q } = launcher(o)
  const r = l.run(APPROVAL)
  assert.strictEqual(r.ok, true); assert.strictEqual(r.outcome, L.OUTCOME.OBSERVED)
  assert.deepStrictEqual(steps(o.log), [
    'statPath', 'statPath', 'allocateGatewayPort',
    'instances.prepare',
    'quarantine.markRunning',
    'instances.launchAttempted',
    'launchUnit',
    'observeControlGroup',
    'readControlGroup',
    'instances.observeControlGroup',
    'instances.observePids'
  ])
  assert.ok(idx(o.log, 'quarantine.markRunning') < idx(o.log, 'instances.launchAttempted'))
  assert.ok(idx(o.log, 'instances.launchAttempted') < idx(o.log, 'launchUnit'))
  // durable end state
  const rec = i.record(APPROVAL)
  assert.strictEqual(rec.state, STATES.OBSERVED)
  assert.strictEqual(rec.observedControlGroup, CG)
  assert.deepStrictEqual(rec.observedPids, [93017, 93018])
  assert.strictEqual(rec.gatewayPort, PORT)
  assert.strictEqual(rec.envelopeObject.ino, '126262'); assert.strictEqual(rec.repoObject.ino, '126263')
  assert.strictEqual(q.st.state, 'RUNNING'); assert.strictEqual(q.st.phase, 'executor_launch_attempting')
  assert.deepStrictEqual(r.pids, [93018, 93017]); assert.strictEqual(r.controlGroup, CG); assert.strictEqual(r.unitName, UNIT)
  never(o.log, 'quarantine.retire')
})

test('O2. the launch spec is derived from identity only: no caller path, no secret, no argv', () => {
  const o = orderLog()
  const { l } = launcher(o)
  const spec = l.buildLaunchSpec(APPROVAL, derivedPathsFor(APPROVAL), PORT)
  assert.deepStrictEqual({ ...spec }, {
    approvalId: APPROVAL, instanceId: APPROVAL, unitName: UNIT, instanceMarker: APPROVAL, gatewayPort: PORT,
    stateRoot: P.stateRoot, configPath: P.configPath, envelopeRoot: P.envelopeRoot, repoRoot: P.repoRoot
  })
  assert.ok(Object.isFrozen(spec))
  assert.ok(!JSON.stringify(spec).match(/key|token|secret|argv|--/i))
})

/* ══════════════ pre-launch measurements ══════════════ */

test('PM1. ⛔ identity is measured through the reader contract; anything short of ok/exists refuses before RUNNING', () => {
  const cases = {
    'envelope absent': { [P.envelopeRoot]: { exists: false }, [P.repoRoot]: STAT[P.repoRoot] },
    'repo absent': { [P.envelopeRoot]: STAT[P.envelopeRoot], [P.repoRoot]: { exists: false } },
    'envelope unreadable': { [P.envelopeRoot]: { unreadable: true }, [P.repoRoot]: STAT[P.repoRoot] },
    'numeric ino': { [P.envelopeRoot]: { exists: true, dev: '2096', ino: 126262 }, [P.repoRoot]: STAT[P.repoRoot] },
    'non-canonical dev': { [P.envelopeRoot]: { exists: true, dev: '02096', ino: '1' }, [P.repoRoot]: STAT[P.repoRoot] },
    'malformed': { [P.envelopeRoot]: 'garbage', [P.repoRoot]: STAT[P.repoRoot] },
    'statPath throws': null
  }
  for (const [name, table] of Object.entries(cases)) {
    const o = orderLog()
    const { l, i, q } = launcher(o, { seams: { statPath: (p) => { o.note('statPath'); if (table === null) throw new Error('boom'); return table[p] } } })
    const r = l.run(APPROVAL)
    assert.strictEqual(r.outcome, L.OUTCOME.REFUSED, name)
    never(o.log, 'instances.prepare'); never(o.log, 'quarantine.markRunning'); never(o.log, 'launchUnit')
    assert.strictEqual(i.peek(), null, name); assert.strictEqual(q.st.state, 'PREPARED', name)
  }
})

test('PM2. ⛔ the gateway port comes only from the allocator, and 18789 / bad values refuse before RUNNING', () => {
  for (const bad of [18789, 0, -1, 65536, 1.5, '18901', null, undefined, NaN]) {
    const o = orderLog()
    const { l, i, q } = launcher(o, { seams: { allocateGatewayPort: () => bad } })
    const r = l.run(APPROVAL)
    assert.strictEqual(r.outcome, L.OUTCOME.REFUSED, String(bad))
    never(o.log, 'instances.prepare'); never(o.log, 'quarantine.markRunning'); never(o.log, 'launchUnit')
    assert.strictEqual(i.peek(), null); assert.strictEqual(q.st.state, 'PREPARED')
  }
  const o = orderLog()
  const { l } = launcher(o, { seams: { allocateGatewayPort: () => { throw new Error('no ports') } } })
  assert.strictEqual(l.run(APPROVAL).outcome, L.OUTCOME.REFUSED)
  never(o.log, 'instances.prepare')
})

test('PM3. ⛔ the caller cannot supply dev/ino, ports or paths: run() takes ONLY an approvalId', () => {
  const o = orderLog()
  const { l, i } = launcher(o)
  // a second argument is ignored entirely — identity is measured, never accepted
  const r = l.run(APPROVAL, { envelopeObject: { dev: '1', ino: '1' }, repoObject: { dev: '1', ino: '1' }, gatewayPort: 1, envelopeRoot: '/tmp/x' })
  assert.strictEqual(r.ok, true)
  const rec = i.record(APPROVAL)
  assert.strictEqual(rec.envelopeObject.ino, '126262', 'measured, not supplied')
  assert.strictEqual(rec.gatewayPort, PORT)
  assert.strictEqual(rec.envelopeRoot, P.envelopeRoot)
  for (const bad of ['', 'has space', '../x', null, 42]) assert.throws(() => l.run(bad), /unsafe approvalId/)
})

/* ══════════════ crash / failure injections ══════════════ */

test('X-A. before instances.prepare (a measurement refuses): nothing durable', () => {
  const o = orderLog()
  const { l, i, q } = launcher(o, { seams: { statPath: () => ({ exists: false }) } })
  assert.strictEqual(l.run(APPROVAL).outcome, L.OUTCOME.REFUSED)
  assert.strictEqual(i.peek(), null); assert.strictEqual(q.st.state, 'PREPARED'); never(o.log, 'launchUnit')
})

test('X-B. after instances.prepare, before markRunning (prepare itself throws): instance absent, lock not opened', () => {
  const o = orderLog()
  const { l, i, q } = launcher(o, { prepareThrows: true })
  assert.throws(() => l.run(APPROVAL), /injected prepare failure/)
  assert.strictEqual(i.peek(), null); assert.strictEqual(q.st.state, 'PREPARED')
  never(o.log, 'quarantine.markRunning'); never(o.log, 'instances.launchAttempted'); never(o.log, 'launchUnit')
})

test('X-C. ⛔ markRunning rejects: launchAttempted MUST NOT occur, launchUnit MUST NOT occur', () => {
  const o = orderLog()
  const { l, i, q } = launcher(o, { markRunningThrows: true })
  assert.throws(() => l.run(APPROVAL), /injected markRunning failure/)
  assert.strictEqual(i.record(APPROVAL).state, STATES.PREPARED, 'instance still PREPARED: no launch was ever attempted')
  assert.strictEqual(q.st.state, 'PREPARED')
  never(o.log, 'instances.launchAttempted'); never(o.log, 'launchUnit')
})

test('X-D. after markRunning, before launchAttempted: the instance manager itself is the durable witness', () => {
  // the manager is REAL: if the process died here, RUNNING is on the ledger and the instance
  // is still PREPARED — which is exactly the state B4\'s Owner pre-launch abort is scoped to
  const o = orderLog()
  const { l, i, q } = launcher(o, { launchAttemptedThrows: true })
  assert.throws(() => l.run(APPROVAL), /injected launchAttempted failure/)
  assert.strictEqual(q.st.state, 'RUNNING', 'RUNNING was written first')
  assert.strictEqual(i.record(APPROVAL).state, STATES.PREPARED, 'launchAttempted never landed')
  never(o.log, 'launchUnit')
})

test('X-E. ⛔ launchAttempted rejects: launchUnit MUST NOT occur, and RUNNING is not undone', () => {
  const o = orderLog()
  const { l, i, q } = launcher(o, { launchAttemptedThrows: true })
  assert.throws(() => l.run(APPROVAL))
  never(o.log, 'launchUnit')
  assert.strictEqual(q.st.state, 'RUNNING'); assert.strictEqual(i.record(APPROVAL).state, STATES.PREPARED)
})

test('X-F. after launchAttempted, before launchUnit returns (launchUnit never answers): ambiguous, nothing reset', () => {
  const o = orderLog()
  const { l, i, q } = launcher(o, { seams: { launchUnit: (spec) => { o.note('launchUnit'); return undefined } } })
  const r = l.run(APPROVAL)
  assert.strictEqual(r.ok, false); assert.strictEqual(r.outcome, L.OUTCOME.LAUNCH_AMBIGUOUS)
  assert.strictEqual(i.record(APPROVAL).state, STATES.LAUNCH_ATTEMPTED, 'stays launch-attempted')
  assert.strictEqual(q.st.state, 'RUNNING', 'stays execution-bearing')
  never(o.log, 'instances.observeControlGroup'); never(o.log, 'observeControlGroup')
})

test('X-G. ⛔ launchUnit throws: NEVER reset either ledger; the outcome is ambiguous', () => {
  const o = orderLog()
  const { l, i, q } = launcher(o, { seams: { launchUnit: () => { o.note('launchUnit'); throw new Error('systemd-run exploded') } } })
  const r = l.run(APPROVAL)
  assert.strictEqual(r.outcome, L.OUTCOME.LAUNCH_AMBIGUOUS)
  assert.match(r.reason, /launchUnit threw/)
  assert.strictEqual(i.record(APPROVAL).state, STATES.LAUNCH_ATTEMPTED)
  assert.strictEqual(q.st.state, 'RUNNING')
  assert.ok(!/nothing ran/i.test(r.reason), 'never claims nothing ran')
  // a malformed answer is the same
  for (const bad of [null, {}, { ok: false }, { ok: true }, { ok: true, unitName: 'other.service' }, { ok: 'true', unitName: UNIT }]) {
    const o2 = orderLog()
    const { l: l2, i: i2 } = launcher(o2, { seams: { launchUnit: () => bad } })
    assert.strictEqual(l2.run(APPROVAL).outcome, L.OUTCOME.LAUNCH_AMBIGUOUS, JSON.stringify(bad))
    assert.strictEqual(i2.record(APPROVAL).state, STATES.LAUNCH_ATTEMPTED)
  }
})

test('X-H. ⛔ launch succeeds, cgroup cannot be observed: LAUNCH_ATTEMPTED stays — unretirable by construction', () => {
  for (const [name, obs] of [['null', () => null], ['empty', () => ''], ['relative', () => 'not/absolute'], ['throws', () => { throw new Error('show failed') }], ['number', () => 42]]) {
    const o = orderLog()
    const { l, i } = launcher(o, { seams: { observeControlGroup: obs } })
    const r = l.run(APPROVAL)
    assert.strictEqual(r.outcome, L.OUTCOME.LAUNCHED_UNOBSERVED, name)
    const rec = i.record(APPROVAL)
    assert.strictEqual(rec.state, STATES.LAUNCH_ATTEMPTED, name)
    assert.strictEqual(rec.observedControlGroup, null, name + ': a predicted path was NEVER written')
    never(o.log, 'instances.observeControlGroup'); never(o.log, 'readControlGroup')
  }
})

test('X-I. ⛔ cgroup path observed but readControlGroup unreadable/malformed/absent: nothing written', () => {
  for (const [name, rc] of [['unreadable', { unreadable: true }], ['absent', { exists: false }], ['malformed pid', { exists: true, procs: [1, 'x'] }], ['garbage', 'garbage'], ['throws', null]]) {
    const o = orderLog()
    const { l, i } = launcher(o, { seams: { readControlGroup: () => { if (rc === null) throw new Error('cat failed'); return rc } } })
    const r = l.run(APPROVAL)
    assert.strictEqual(r.outcome, L.OUTCOME.LAUNCHED_UNOBSERVED, name)
    assert.strictEqual(i.record(APPROVAL).observedControlGroup, null, name)
    assert.deepStrictEqual(i.record(APPROVAL).observedPids, [], name + ': no partial pid salvage')
    never(o.log, 'instances.observeControlGroup'); never(o.log, 'instances.observePids')
  }
})

test('X-J. cgroup exists with PIDs: the measured path and ALL its members are recorded; empty cgroup records the path only', () => {
  const o = orderLog()
  const { l, i } = launcher(o)
  l.run(APPROVAL)
  assert.deepStrictEqual(i.record(APPROVAL).observedPids, [93017, 93018])
  const o2 = orderLog()
  const { l: l2, i: i2 } = launcher(o2, { seams: { readControlGroup: () => ({ exists: true, procs: [] }) } })
  const r = l2.run(APPROVAL)
  assert.strictEqual(r.outcome, L.OUTCOME.OBSERVED)
  assert.strictEqual(i2.record(APPROVAL).observedControlGroup, CG)
  assert.deepStrictEqual(i2.record(APPROVAL).observedPids, [])
  never(o2.log, 'instances.observePids')
})

/* ══════════════ B3 recovery — no retirement authority ══════════════ */

test('X-K. recovery stop throws: stays STOP_REQUESTED, outcome unknown, no retire', () => {
  const o = orderLog()
  const { l, i, q } = launcher(o, { seams: { stopUnit: () => { o.note('stopUnit'); throw new Error('systemctl stop failed') } } })
  l.run(APPROVAL)
  const r = l.recover(APPROVAL)
  assert.strictEqual(r.outcome, L.OUTCOME.STOP_UNKNOWN)
  assert.strictEqual(i.record(APPROVAL).state, STATES.STOP_REQUESTED)
  assert.ok(idx(o.log, 'instances.requestStop') < idx(o.log, 'stopUnit'), 'stop intent is durable BEFORE the stop')
  never(o.log, 'quarantine.retire'); assert.strictEqual(q.st.state, 'RUNNING')
})

test('X-L. recovery after an observed cgroup: requestStop, stopUnit, diagnostic — and NO quarantine.retire', () => {
  const o = orderLog()
  const { l, i, q } = launcher(o)
  l.run(APPROVAL)
  const r = l.recover(APPROVAL)
  assert.strictEqual(r.outcome, L.OUTCOME.STOP_ISSUED_RETIREMENT_NOT_WIRED)
  assert.strictEqual(r.ok, false, 'recovery never reports success in B3')
  assert.strictEqual(i.record(APPROVAL).state, STATES.STOP_REQUESTED)
  assert.deepStrictEqual(steps(o.log).slice(-2), ['instances.requestStop', 'stopUnit'])
  never(o.log, 'quarantine.retire'); assert.strictEqual(q.st.state, 'RUNNING')
  assert.strictEqual(r.verifierDiagnostic, null, 'no verifier injected: no diagnostic, and still no retire')
  // recovery is re-issuable: a second recover does not re-request stop, still stops, still never retires
  const r2 = l.recover(APPROVAL)
  assert.strictEqual(r2.outcome, L.OUTCOME.STOP_ISSUED_RETIREMENT_NOT_WIRED)
  assert.strictEqual(steps(o.log).filter((s) => s === 'instances.requestStop').length, 1)
  never(o.log, 'quarantine.retire')
})

test('X-L2. recovery without an observed cgroup is unretirable/unknown; recovery of PREPARED stops nothing', () => {
  const o = orderLog()
  const { l, i, q } = launcher(o, { seams: { observeControlGroup: () => null } })
  l.run(APPROVAL)
  const r = l.recover(APPROVAL)
  assert.strictEqual(r.outcome, L.OUTCOME.UNRETIRABLE_NO_OBSERVED_CGROUP)
  assert.strictEqual(i.record(APPROVAL).state, STATES.STOP_REQUESTED, 'the stop was still issued')
  never(o.log, 'quarantine.retire')

  const o2 = orderLog()
  const { l: l2, i: i2 } = launcher(o2, { markRunningThrows: true })
  try { l2.run(APPROVAL) } catch (_) {}
  assert.strictEqual(i2.record(APPROVAL).state, STATES.PREPARED)
  const r2 = l2.recover(APPROVAL)
  assert.strictEqual(r2.outcome, L.OUTCOME.PRE_LAUNCH_RECOVERY_NOT_WIRED)
  never(o2.log, 'stopUnit'); never(o2.log, 'instances.requestStop')
  assert.strictEqual(i2.record(APPROVAL).state, STATES.PREPARED)
  assert.strictEqual(q.st.state, 'RUNNING')

  // and a missing stop seam refuses recovery without touching the ledger
  const o3 = orderLog()
  const { l: l3, i: i3 } = launcher(o3, { seams: { stopUnit: undefined } })
  l3.run(APPROVAL)
  const r3 = l3.recover(APPROVAL)
  assert.strictEqual(r3.outcome, L.OUTCOME.REFUSED); assert.match(r3.reason, /stopUnit/)
  assert.strictEqual(i3.record(APPROVAL).state, STATES.OBSERVED); never(o3.log, 'instances.requestStop')
})

test('X-M. ⛔ the verifier says RETIRED during B3 recovery — and quarantine.retire is STILL never called', () => {
  const o = orderLog()
  const fakeVerifier = { evaluate: (ref) => { o.note('verifier.evaluate', ref); return { ok: true, verdict: VERDICT.RETIRED, reason: 'clean', evidence: {} } } }
  const { l, i, q } = launcher(o, { deps: { retirementVerifier: fakeVerifier } })
  l.run(APPROVAL)
  const r = l.recover(APPROVAL)
  assert.strictEqual(r.outcome, L.OUTCOME.STOP_ISSUED_RETIREMENT_NOT_WIRED)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.verifierDiagnostic.verdict, VERDICT.RETIRED)
  assert.strictEqual(r.verifierDiagnostic.ok, true, 'reported as a diagnostic')
  never(o.log, 'quarantine.retire')
  assert.strictEqual(q.st.state, 'RUNNING', 'the lock is NOT released')
  assert.strictEqual(i.record(APPROVAL).state, STATES.STOP_REQUESTED)
  const ev = o.log.find((e) => e.step === 'verifier.evaluate')
  assert.deepStrictEqual({ approvalId: ev.approvalId, instanceId: ev.instanceId }, { approvalId: APPROVAL, instanceId: APPROVAL })
  // and stop success is never interpreted as retirement either
  assert.ok(!/retired/i.test(r.reason) || /not wired/i.test(r.reason))
})

test('X-M2. a REAL verifier over the real record can be asked for a diagnostic — still no retire', () => {
  const o = orderLog()
  const { i } = launcher(o)
  // build a real verifier over the launcher\'s instance manager with clean-world readers
  const readers = {
    readControlGroup: () => ({ exists: false }),
    listPids: () => ({ pids: [] }),
    readStatus: () => ({ gone: true }), readEnviron: () => ({ gone: true }), readCwd: () => ({ gone: true }), readFds: () => ({ gone: true }),
    statPath: (p) => STAT[p] || { exists: false },
    readUnit: () => ({ exists: false, successor: false, restart: 'no', result: 'success' }),
    protectedInstancesOk: () => true
  }
  const verifier = createOpenClawRetirementVerifier(Object.assign({ instances: i.raw, executorUid: 1000 }, readers))
  const q = futureQuarantine(o)
  const l = L.createOpenClawExecutorLauncher(Object.assign({ instances: i, quarantine: q, retirementVerifier: verifier }, seams(o)))
  l.run(APPROVAL)
  const r = l.recover(APPROVAL)
  assert.strictEqual(r.verifierDiagnostic.verdict, VERDICT.RETIRED, 'a genuinely clean world is diagnosed RETIRED')
  assert.strictEqual(r.outcome, L.OUTCOME.STOP_ISSUED_RETIREMENT_NOT_WIRED)
  never(o.log, 'quarantine.retire'); assert.strictEqual(q.st.state, 'RUNNING')
})

/* ══════════════ the stop answer must be a POSITIVE acknowledgement ══════════════ */

/** A verifier fake that records every evaluation; in these tests it must usually never be reached. */
function loggingVerifier (o) {
  return { evaluate: (ref) => { o.note('verifier.evaluate', ref); return { ok: true, verdict: VERDICT.RETIRED, reason: 'clean', evidence: {} } } }
}

test('ST1. exactly { ok:true, unitName:<derived> } acknowledges the stop and permits the diagnostic-readiness flow', () => {
  const o = orderLog()
  const { l, i, q } = launcher(o, { deps: { retirementVerifier: loggingVerifier(o) }, seams: { stopUnit: (unit) => { o.note('stopUnit', { unitName: unit }); return { ok: true, unitName: UNIT } } } })
  l.run(APPROVAL)
  const r = l.recover(APPROVAL)
  assert.strictEqual(r.outcome, L.OUTCOME.STOP_ISSUED_RETIREMENT_NOT_WIRED)
  assert.strictEqual(r.ok, false)
  assert.ok(idx(o.log, 'stopUnit') < idx(o.log, 'verifier.evaluate'), 'the diagnostic runs only AFTER an acknowledged stop')
  assert.strictEqual(r.verifierDiagnostic.verdict, VERDICT.RETIRED)
  assert.strictEqual(i.record(APPROVAL).state, STATES.STOP_REQUESTED)
  never(o.log, 'quarantine.retire'); assert.strictEqual(q.st.state, 'RUNNING')
})

test('ST2. ⛔ every malformed / negative stop answer is STOP_UNKNOWN: state STOP_REQUESTED, verifier NOT called, retire NOT called', () => {
  const inherited = Object.create({ ok: true, unitName: UNIT }) // the right values, but not OWN
  const answers = [
    ['null', null], ['undefined', undefined], ['false', false], ['true', true], ['{}', {}],
    ['{ ok:false }', { ok: false }], ['{ ok:true }', { ok: true }],
    ["{ ok:true, unitName:'wrong.service' }", { ok: true, unitName: 'wrong.service' }],
    ["{ ok:'true', unitName:<correct> }", { ok: 'true', unitName: UNIT }],
    ['{ ok:1, unitName:<correct> }', { ok: 1, unitName: UNIT }],
    ['inherited ok/unitName (not own)', inherited],
    ['array [true, unit]', [true, UNIT]],
    ['string unitName', UNIT]
  ]
  for (const [label, answer] of answers) {
    const o = orderLog()
    const { l, i, q } = launcher(o, { deps: { retirementVerifier: loggingVerifier(o) }, seams: { stopUnit: (unit) => { o.note('stopUnit', { unitName: unit }); return answer } } })
    l.run(APPROVAL)
    const r = l.recover(APPROVAL)
    assert.strictEqual(r.outcome, L.OUTCOME.STOP_UNKNOWN, label + ': outcome')
    assert.strictEqual(r.ok, false, label + ': never ok')
    assert.notStrictEqual(r.outcome, L.OUTCOME.STOP_ISSUED_RETIREMENT_NOT_WIRED, label)
    assert.ok(!/stop issued/i.test(r.reason), label + ': the result must not claim a stop was issued: ' + r.reason)
    assert.strictEqual(i.record(APPROVAL).state, STATES.STOP_REQUESTED, label + ': state')
    assert.ok(idx(o.log, 'instances.requestStop') < idx(o.log, 'stopUnit'), label + ': intent before stop')
    never(o.log, 'verifier.evaluate'); never(o.log, 'quarantine.retire')
    assert.strictEqual(q.st.state, 'RUNNING', label + ': lock not released')
    assert.strictEqual(r.verifierDiagnostic, undefined, label + ': no diagnostic field on an unknown stop')
  }
})

test('ST3. a thrown stop keeps the existing behaviour, and additionally the verifier is never reached', () => {
  const o = orderLog()
  const { l, i, q } = launcher(o, { deps: { retirementVerifier: loggingVerifier(o) }, seams: { stopUnit: () => { o.note('stopUnit'); throw new Error('systemctl stop failed') } } })
  l.run(APPROVAL)
  const r = l.recover(APPROVAL)
  assert.strictEqual(r.outcome, L.OUTCOME.STOP_UNKNOWN); assert.strictEqual(r.ok, false)
  assert.match(r.reason, /stopUnit failed/)
  assert.strictEqual(i.record(APPROVAL).state, STATES.STOP_REQUESTED)
  never(o.log, 'verifier.evaluate'); never(o.log, 'quarantine.retire'); assert.strictEqual(q.st.state, 'RUNNING')
})

/* ══════════════ an answer that cannot be INSPECTED is UNKNOWN, never a crash ══════════════ */

/** Answers whose mere inspection throws: hostile own getters, Proxy traps, a revoked Proxy. */
function uninspectableAnswers () {
  const withGetter = (key, rest) => {
    const o = Object.assign({}, rest)
    Object.defineProperty(o, key, { enumerable: true, configurable: true, get () { throw new Error('hostile ' + key + ' getter') } })
    return o
  }
  const revocable = Proxy.revocable({ ok: true, unitName: UNIT }, {})
  revocable.revoke()
  return [
    ['own ok getter throws', () => withGetter('ok', { unitName: UNIT })],
    ['own unitName getter throws', () => withGetter('unitName', { ok: true })],
    ['Proxy getOwnPropertyDescriptor trap throws', () => new Proxy({ ok: true, unitName: UNIT }, { getOwnPropertyDescriptor () { throw new Error('hostile gOPD trap') } })],
    ['Proxy get trap throws', () => new Proxy({ ok: true, unitName: UNIT }, { get () { throw new Error('hostile get trap') } })],
    ['Proxy has trap throws', () => new Proxy({ ok: true, unitName: UNIT }, { has () { throw new Error('hostile has trap') }, getOwnPropertyDescriptor () { throw new Error('hostile gOPD trap') } })],
    ['revoked Proxy', () => revocable.proxy]
  ]
}

test('ST4. ⛔ a stop answer whose INSPECTION throws is STOP_UNKNOWN — contained, never propagated', () => {
  for (const [label, make] of uninspectableAnswers()) {
    const o = orderLog()
    const { l, i, q } = launcher(o, { deps: { retirementVerifier: loggingVerifier(o) }, seams: { stopUnit: (unit) => { o.note('stopUnit', { unitName: unit }); return make() } } })
    l.run(APPROVAL)
    let r
    try {
      r = l.recover(APPROVAL)
    } catch (e) {
      assert.fail(label + ': recover() must NOT throw while inspecting a hostile answer — it threw: ' + e.message)
    }
    assert.strictEqual(r.outcome, L.OUTCOME.STOP_UNKNOWN, label + ': outcome')
    assert.strictEqual(r.ok, false, label + ': never ok')
    assert.ok(!/stop issued/i.test(r.reason), label + ': must not claim a stop was issued')
    assert.strictEqual(r.verifierDiagnostic, undefined, label + ': no diagnostic field')
    assert.strictEqual(i.record(APPROVAL).state, STATES.STOP_REQUESTED, label + ': state stays STOP_REQUESTED')
    assert.ok(idx(o.log, 'instances.requestStop') < idx(o.log, 'stopUnit'), label + ': intent before stop')
    never(o.log, 'verifier.evaluate'); never(o.log, 'quarantine.retire')
    assert.strictEqual(q.st.state, 'RUNNING', label + ': the lock is NOT released')
  }
})

test('ST5. ⛔ the SAME helper maps an uninspectable LAUNCH answer to LAUNCH_AMBIGUOUS — without throwing, without resetting', () => {
  for (const [label, make] of uninspectableAnswers()) {
    const o = orderLog()
    const { l, i, q } = launcher(o, { seams: { launchUnit: (spec) => { o.note('launchUnit', { unitName: spec.unitName }); return make() } } })
    let r
    try {
      r = l.run(APPROVAL)
    } catch (e) {
      assert.fail(label + ': run() must NOT throw while inspecting a hostile launch answer — it threw: ' + e.message)
    }
    assert.strictEqual(r.outcome, L.OUTCOME.LAUNCH_AMBIGUOUS, label + ': outcome')
    assert.strictEqual(r.ok, false, label + ': never ok')
    // ⛔ a unit may exist: the ledgers stay execution-bearing, exactly as for a thrown launch
    assert.strictEqual(i.record(APPROVAL).state, STATES.LAUNCH_ATTEMPTED, label + ': NOT reset')
    assert.strictEqual(q.st.state, 'RUNNING', label + ': the lock stays held')
    assert.ok(idx(o.log, 'quarantine.markRunning') < idx(o.log, 'instances.launchAttempted'), label)
    assert.ok(idx(o.log, 'instances.launchAttempted') < idx(o.log, 'launchUnit'), label)
    never(o.log, 'observeControlGroup'); never(o.log, 'instances.observeControlGroup'); never(o.log, 'instances.observePids')
    never(o.log, 'quarantine.retire')
  }
})

/* ══════════════ execution seams are captured ONCE at construction ══════════════ */

test('SS4. ⛔ a seam missing at construction stays missing: adding deps.launchUnit later still refuses before any ledger write', () => {
  const o = orderLog()
  const deps = Object.assign({ instances: instances(o), quarantine: futureQuarantine(o) }, seams(o))
  delete deps.launchUnit
  const l = L.createOpenClawExecutorLauncher(deps)
  deps.launchUnit = (spec) => { o.note('launchUnit.late', { unitName: spec.unitName }); return { ok: true, unitName: spec.unitName } }
  const r = l.run(APPROVAL)
  assert.strictEqual(r.ok, false); assert.strictEqual(r.outcome, L.OUTCOME.REFUSED); assert.match(r.reason, /launchUnit/)
  assert.deepStrictEqual(steps(o.log), [], 'nothing at all happened')
  never(o.log, 'instances.prepare'); never(o.log, 'quarantine.markRunning'); never(o.log, 'instances.launchAttempted'); never(o.log, 'launchUnit.late')
  assert.strictEqual(deps.instances.peek(), null); assert.strictEqual(deps.quarantine.st.state, 'PREPARED')
  // and it stays refused on a second attempt too
  assert.strictEqual(l.run(APPROVAL).outcome, L.OUTCOME.REFUSED); assert.deepStrictEqual(steps(o.log), [])
})

test('SS5. ⛔ a seam captured at construction is the one used: replacing then deleting deps.launchUnit / deps.stopUnit changes nothing', () => {
  const o = orderLog()
  const deps = Object.assign({ instances: instances(o), quarantine: futureQuarantine(o) }, seams(o))
  const l = L.createOpenClawExecutorLauncher(deps)
  deps.launchUnit = (spec) => { o.note('launchUnit.replaced'); return { ok: true, unitName: spec.unitName } }
  deps.stopUnit = (unit) => { o.note('stopUnit.replaced'); return { ok: true, unitName: unit } }
  let r = l.run(APPROVAL)
  assert.strictEqual(r.outcome, L.OUTCOME.OBSERVED)
  assert.strictEqual(steps(o.log).filter((s) => s === 'launchUnit').length, 1, 'the ORIGINAL launchUnit ran')
  never(o.log, 'launchUnit.replaced')
  delete deps.launchUnit; delete deps.stopUnit; delete deps.statPath; delete deps.allocateGatewayPort
  r = l.recover(APPROVAL)
  assert.strictEqual(r.outcome, L.OUTCOME.STOP_ISSUED_RETIREMENT_NOT_WIRED)
  assert.strictEqual(steps(o.log).filter((s) => s === 'stopUnit').length, 1, 'the ORIGINAL stopUnit ran'); never(o.log, 'stopUnit.replaced')
  // a fresh launcher over the now-deleted seams is refused: the capture belongs to the instance, not the module
  const o2 = orderLog()
  const l2 = L.createOpenClawExecutorLauncher(Object.assign({ instances: instances(o2), quarantine: futureQuarantine(o2) }, deps, { instances: instances(o2), quarantine: futureQuarantine(o2) }))
  assert.strictEqual(l2.run(APPROVAL).outcome, L.OUTCOME.REFUSED); assert.deepStrictEqual(steps(o2.log), [])
})

test('SS6. ⛔ an accessor dependency is read exactly once at construction and never re-read by run()/recover()', () => {
  const o = orderLog()
  const base = seams(o)
  const reads = Object.create(null)
  const deps = { instances: instances(o), quarantine: futureQuarantine(o) }
  for (const name of L.LAUNCH_SEAMS.concat(['stopUnit'])) {
    reads[name] = 0
    Object.defineProperty(deps, name, {
      enumerable: true, configurable: true,
      get () {
        reads[name] += 1
        // first answer: the real seam. Any later read would get a poisoned one that must never run.
        return reads[name] === 1 ? base[name] : () => { o.note(name + '.reread'); throw new Error('re-read seam must never run') }
      }
    })
  }
  const l = L.createOpenClawExecutorLauncher(deps)
  for (const name of Object.keys(reads)) assert.strictEqual(reads[name], 1, name + ' read exactly once at construction')
  const r = l.run(APPROVAL)
  assert.strictEqual(r.outcome, L.OUTCOME.OBSERVED)
  const r2 = l.recover(APPROVAL)
  assert.strictEqual(r2.outcome, L.OUTCOME.STOP_ISSUED_RETIREMENT_NOT_WIRED)
  for (const name of Object.keys(reads)) assert.strictEqual(reads[name], 1, name + ' not re-read by run()/recover()')
  assert.ok(!steps(o.log).some((s) => s.endsWith('.reread')), 'no poisoned seam ever ran: ' + steps(o.log).join(' > '))

  // the same for a getter that answers "missing" first and "present" later: missing wins, forever
  const o3 = orderLog()
  let n = 0
  const deps3 = Object.assign({ instances: instances(o3), quarantine: futureQuarantine(o3) }, seams(o3))
  Object.defineProperty(deps3, 'launchUnit', { enumerable: true, configurable: true, get () { n += 1; return n === 1 ? undefined : base.launchUnit } })
  const l3 = L.createOpenClawExecutorLauncher(deps3)
  assert.strictEqual(l3.run(APPROVAL).outcome, L.OUTCOME.REFUSED)
  assert.strictEqual(n, 1, 'never re-read'); assert.deepStrictEqual(steps(o3.log), [])
})

/* ══════════════ the CURRENT real quarantine refuses the launcher — before anything launches ══════════════ */

test('Q1. ⛔ COMPAT: the current real quarantine rejects executor_launch_attempting BEFORE launchAttempted and BEFORE launchUnit', () => {
  const o = orderLog()
  let ledger = {}
  const store = { read: () => JSON.parse(JSON.stringify(ledger)), write: (d) => { ledger = JSON.parse(JSON.stringify(d)) } }
  const real = Q.createOpenClawQuarantine({ store })
  real.begin(APPROVAL)
  assert.strictEqual(real.state(APPROVAL), Q.STATES.PREPARED)
  const i = instances(o)
  const l = L.createOpenClawExecutorLauncher(Object.assign({ instances: i, quarantine: real }, seams(o)))
  assert.throws(() => l.run(APPROVAL), /markRunning must open at phase 'agent_add_attempting'/)
  // the refusal came from the CURRENT ledger, unchanged — and nothing launched
  assert.strictEqual(real.state(APPROVAL), Q.STATES.PREPARED, 'the current ledger did not open RUNNING')
  assert.strictEqual(i.record(APPROVAL).state, STATES.PREPARED, 'launchAttempted never landed')
  never(o.log, 'instances.launchAttempted'); never(o.log, 'launchUnit')
  assert.deepStrictEqual(Q.PHASES[0], 'agent_add_attempting', 'the current vocabulary is untouched by B3')
})

/* ══════════════ prototype pollution cannot shape the order or the results ══════════════ */

test('PP1. results are frozen null-prototype data; an Array.prototype setter cannot hide a step from the order log', () => {
  const o = orderLog()
  try {
    Object.defineProperty(Array.prototype, 0, { set () {}, get () { return 'polluted' }, configurable: true })
    Object.prototype.ok = 'polluted'
    const { l } = launcher(o)
    const r = l.run(APPROVAL)
    assert.strictEqual(Object.getPrototypeOf(r), null); assert.ok(Object.isFrozen(r))
    assert.strictEqual(r.ok, true)
    assert.strictEqual(o.log.length, 11); assert.strictEqual(o.log[0].step, 'statPath', 'entry 0 is an own element')
  } finally {
    delete Array.prototype[0]; delete Object.prototype.ok
  }
})
