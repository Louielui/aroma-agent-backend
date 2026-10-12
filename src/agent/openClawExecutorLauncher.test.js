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
  assert.ok(!code.includes("'agent_add_attempting'"), 'the retired legacy phase name is never used')
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

test('Q1. ⛔ B4a: the phase is now CANONICAL, so the ledger no longer refuses this module — the interlock is gone, deliberately', () => {
  const o = orderLog()
  let ledger = {}
  const store = { read: () => JSON.parse(JSON.stringify(ledger)), write: (d) => { ledger = JSON.parse(JSON.stringify(d)) } }
  const real = Q.createOpenClawQuarantine({ store })
  real.begin(APPROVAL)
  const i = instances(o)
  const l = L.createOpenClawExecutorLauncher(Object.assign({ instances: i, quarantine: real }, seams(o)))
  // ⛔ THIS NOW SUCCEEDS. Before B4a the real ledger threw at markRunning; that third interlock
  // no longer exists, and pretending otherwise in a test would be the dangerous kind of green.
  const r = l.run(APPROVAL)
  assert.strictEqual(r.outcome, L.OUTCOME.OBSERVED)
  assert.strictEqual(real.state(APPROVAL), Q.STATES.RUNNING, 'the real ledger opened RUNNING at the canonical phase')
  assert.strictEqual(real.record(APPROVAL).phase, Q.PHASES[0])
  // the vocabularies are pinned to each other, in both directions
  assert.strictEqual(L.PHASE_EXECUTOR_LAUNCH_ATTEMPTING, Q.PHASES[0])
  assert.ok(!Q.PHASES.includes('agent_add_attempting'), 'the legacy name is no longer writable vocabulary')
  assert.ok(Q.READABLE_PHASES.includes('agent_add_attempting'), 'but it is still readable history')
})

/* ══════════════ A3 GATES: what still makes this module inert, now that Q1 does not ══════════════ */

test('A3-1. ⛔ there is NO OpenClaw composition/construction site anywhere outside src/agent, and src/app.js has none at all', () => {
  const srcRoot = path.join(__dirname, '..')
  const files = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) files.push(full)
    }
  }
  walk(srcRoot)
  assert.ok(files.length > 5, 'the scan actually found production files: ' + files.length)
  const rel = (f) => path.relative(srcRoot, f).split(path.sep).join('/')

  const agentDir = path.join(srcRoot, 'agent')
  const importers = []
  const constructedBy = []
  const mentions = []
  for (const f of files) {
    const raw = fs.readFileSync(f, 'utf8')
    const code = raw.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    const inAgent = f.startsWith(agentDir + path.sep)
    if (!inAgent) {
      // (a) nothing outside src/agent may IMPORT an OpenClaw module — that is what a
      //     composition point would have to do first
      if (/require\([^)]*openClaw/i.test(code)) importers.push(path.relative(srcRoot, f))
      if (/openClaw/i.test(code)) mentions.push(rel(f))
    }
    // (b) nowhere may a factory be CALLED; only defined and exported
    for (const m of code.matchAll(/(.{0,10})\b(createOpenClaw\w*|createExactWslExecRunner)\s*\(/g)) {
      if (!/function\s*$/.test(m[1])) constructedBy.push(rel(f) + ' -> ' + m[2])
    }
  }
  assert.deepStrictEqual(importers, [], 'no production file outside src/agent may import an OpenClaw module')

  // ⛔ THE ONE PERMITTED MENTION, PINNED SO IT CANNOT QUIETLY BECOME A ROUTE.
  // workers/registry.js carries an OpenClaw worker IDENTITY row. It imports nothing from
  // src/agent and constructs nothing; the dispatcher only executes a worker that is connected,
  // so the row can be addressed without anything being able to run. If that ever flips to
  // connected:true, this module becomes reachable and this test must fail first.
  assert.deepStrictEqual(mentions, ['workers/registry.js'],
    'the only OpenClaw mention outside src/agent is the inert registry identity row: ' + JSON.stringify(mentions))
  const registry = fs.readFileSync(path.join(srcRoot, 'workers', 'registry.js'), 'utf8')
  assert.match(registry, /id: 'openclaw'[\s\S]{0,200}?connected: false/,
    'the OpenClaw worker row must remain connected:false')
  /**
   * ⛔ EXACTLY TWO PERMITTED CONSTRUCTION SITES, AND NEITHER IS REACHABLE.
   *
   * exactWslExecRunner builds its own module-level singleton: a pure argv builder that spawns
   * nothing until called. openClawComposition is the B4b offline composition root — it is the
   * one file allowed to construct the OpenClaw factories, and it is inert for a different
   * reason: NOTHING REQUIRES IT. That is asserted immediately below, and it is the property
   * that keeps the whole subsystem unreachable now that the composition root exists.
   */
  const compositionSites = constructedBy.filter((s) => s.startsWith('agent/openClawComposition.js -> '))
  const otherSites = constructedBy.filter((s) => !s.startsWith('agent/openClawComposition.js -> '))
  assert.deepStrictEqual(otherSites, ['agent/exactWslExecRunner.js -> createExactWslExecRunner'],
    'outside the composition root, no OpenClaw factory may be constructed: ' + JSON.stringify(otherSites))
  assert.ok(compositionSites.length > 0, 'the composition root is expected to construct the factories')

  // ⛔ AND NOBODY REQUIRES THE COMPOSITION ROOT. If this ever fails, the subsystem became
  // reachable and every offline guarantee in B4b is void.
  const compositionImporters = []
  for (const f of files) {
    if (path.basename(f) === 'openClawComposition.js') continue
    const code = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    if (/require\([^)]*openClawComposition/.test(code)) compositionImporters.push(rel(f))
  }
  assert.deepStrictEqual(compositionImporters, [],
    'no production file may require the composition root: ' + JSON.stringify(compositionImporters))

  const appJs = fs.readFileSync(path.join(srcRoot, 'app.js'), 'utf8')
  assert.ok(!/openClaw/i.test(appJs), 'src/app.js must contain zero OpenClaw references')
  assert.ok(!/openclaw/i.test(appJs), 'src/app.js must not mount OpenClaw under any spelling')
})

test('A3-2. ⛔ every execution seam still has NO default: a launcher built with ledgers alone can neither launch, stop nor retire', () => {
  const o = orderLog()
  const i = instances(o)
  const q = futureQuarantine(o)
  const bare = L.createOpenClawExecutorLauncher({ instances: i, quarantine: q })
  const r = bare.run(APPROVAL)
  assert.strictEqual(r.outcome, L.OUTCOME.REFUSED)
  for (const s of L.LAUNCH_SEAMS) assert.match(r.reason, new RegExp(s), 'every missing seam is named: ' + r.reason)
  assert.deepStrictEqual(steps(o.log), [], 'nothing durable, nothing external')
  assert.strictEqual(i.peek(), null); assert.strictEqual(q.st.state, 'PREPARED')

  // and recovery of an unknown instance refuses too — there is no stop path either
  assert.strictEqual(bare.recover(APPROVAL).outcome, L.OUTCOME.REFUSED)
  never(o.log, 'stopUnit'); never(o.log, 'quarantine.retire')

  // the module exposes no retirement entry point at all
  assert.deepStrictEqual(Object.keys(bare).sort(), ['OUTCOME', 'PHASE', 'buildLaunchSpec', 'recover', 'run'].sort())
})

test('A3-3. ⛔ the launcher still cannot retire: it holds no path to quarantine.retire, wired or not', () => {
  const src = fs.readFileSync(path.join(__dirname, 'openClawExecutorLauncher.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  assert.ok(!/\.retire\s*\(/.test(code), 'no retire() call in the launcher')
  assert.ok(!/observeExecutorGone/.test(code), 'the launcher does not reach the new ledger transition either')
  // even handed a real ledger and a verifier that says RETIRED, recovery never retires
  const o = orderLog()
  const { l, q } = launcher(o, { deps: { retirementVerifier: loggingVerifier(o) } })
  l.run(APPROVAL)
  const r = l.recover(APPROVAL)
  assert.strictEqual(r.outcome, L.OUTCOME.STOP_ISSUED_RETIREMENT_NOT_WIRED)
  never(o.log, 'quarantine.retire')
  assert.strictEqual(q.st.state, 'RUNNING', 'the lock is still held by the launcher path')
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

/* ══════════════ HOSTILE THROWN VALUES: describing a failure is never a second failure ══════════════ */

/**
 * ⛔ THE TEST ITSELF MUST NOT READ THE HOSTILE VALUE EITHER.
 * A failure message built with `e.message` would throw while reporting, turning a real assertion
 * failure into an unrelated crash. Every message below uses only the label.
 */
function hostileValues () {
  const revocable = Proxy.revocable({ message: 'never readable' }, {})
  revocable.revoke()
  return [
    ['null', null],
    ['undefined', undefined],
    ['a string', 'plain string throw'],
    ['a number', 42],
    ['a boolean', true],
    ['a bigint', BigInt(7)],
    ['a symbol', Symbol('boom')],
    ['an ordinary Error', new Error('ordinary failure')],
    ['a function', function boom () {}],
    ['a null-prototype object', Object.assign(Object.create(null), { message: 'np' })],
    ['an own message getter that throws', { get message () { throw new Error('hostile message getter') } }],
    ['a throwing toString/toPrimitive', {
      get message () { throw new Error('m') },
      toString () { throw new Error('ts') },
      get [Symbol.toPrimitive] () { throw new Error('tp') }
    }],
    ['a Proxy whose get trap throws', new Proxy({}, { get () { throw new Error('trap') } })],
    ['a revoked Proxy', revocable.proxy]
  ]
}
const boundedReason = (r, label) => {
  assert.strictEqual(typeof r, 'string', label + ': reason must be a string')
  assert.ok(r.length <= 400, label + ': reason must be bounded (got ' + r.length + ')')
}

test('H1. ⛔ a hostile launchUnit throw is LAUNCH_AMBIGUOUS: no escape, no reset, nothing downstream', () => {
  for (const [label, thrown] of hostileValues()) {
    const o = orderLog()
    const { l, i, q } = launcher(o, { seams: { launchUnit: () => { o.note('launchUnit'); throw thrown } } })
    let r
    try {
      r = l.run(APPROVAL)
    } catch (e) {
      assert.fail(label + ': the hostile throw escaped run()')
    }
    assert.strictEqual(r.outcome, L.OUTCOME.LAUNCH_AMBIGUOUS, label)
    assert.strictEqual(r.ok, false, label)
    boundedReason(r.reason, label)
    assert.match(r.reason, /^launchUnit threw: /, label + ': the prefix is preserved')
    // ⛔ neither ledger was reset
    assert.strictEqual(i.record(APPROVAL).state, STATES.LAUNCH_ATTEMPTED, label)
    assert.strictEqual(q.st.state, 'RUNNING', label)
    // ⛔ nothing downstream ran
    never(o.log, 'observeControlGroup'); never(o.log, 'readControlGroup')
    never(o.log, 'instances.observeControlGroup'); never(o.log, 'instances.observePids')
    never(o.log, 'quarantine.retire')
    // ⛔ no live REFERENCE to the thrown value travelled out. Only references are checked:
    // a primitive like null may legitimately equal a field's own value (verdict: null).
    if (thrown !== null && (typeof thrown === 'object' || typeof thrown === 'function')) {
      for (const k of Object.keys(r)) assert.notStrictEqual(r[k], thrown, label + ': the thrown value must not be returned')
    }
  }
})

test('H2. ⛔ a hostile stopUnit throw is STOP_UNKNOWN: stop intent durable, no verifier, no retire', () => {
  for (const [label, thrown] of hostileValues()) {
    const o = orderLog()
    const verifier = { evaluate: () => { o.note('verifier.evaluate'); return { ok: true, verdict: VERDICT.RETIRED, reason: 'clean', evidence: {} } } }
    const { l, i, q } = launcher(o, {
      deps: { retirementVerifier: verifier },
      seams: { stopUnit: () => { o.note('stopUnit'); throw thrown } }
    })
    l.run(APPROVAL)
    let r
    try {
      r = l.recover(APPROVAL)
    } catch (e) {
      assert.fail(label + ': the hostile throw escaped recover()')
    }
    assert.strictEqual(r.outcome, L.OUTCOME.STOP_UNKNOWN, label)
    assert.strictEqual(r.ok, false, label)
    boundedReason(r.reason, label)
    assert.match(r.reason, /^stopUnit failed: /, label + ': the prefix is preserved')
    // ⛔ the stop intent is durable, and the quarantine did not advance or release
    assert.strictEqual(i.record(APPROVAL).state, STATES.STOP_REQUESTED, label)
    assert.strictEqual(q.st.state, 'RUNNING', label)
    assert.ok(idx(o.log, 'instances.requestStop') < idx(o.log, 'stopUnit'), label)
    // ⛔ the verifier was never consulted and nothing was retired
    never(o.log, 'verifier.evaluate'); never(o.log, 'quarantine.retire')
    assert.strictEqual(r.verifierDiagnostic, undefined, label)
    if (thrown !== null && (typeof thrown === 'object' || typeof thrown === 'function')) {
      for (const k of Object.keys(r)) assert.notStrictEqual(r[k], thrown, label)
    }
  }
})

test('H3. ⛔ a hostile verifier throw after an ACKNOWLEDGED stop stays a diagnostic — never authority', () => {
  for (const [label, thrown] of hostileValues()) {
    const o = orderLog()
    const verifier = { evaluate: () => { o.note('verifier.evaluate'); throw thrown } }
    const { l, i, q } = launcher(o, { deps: { retirementVerifier: verifier } })
    l.run(APPROVAL)
    let r
    try {
      r = l.recover(APPROVAL)
    } catch (e) {
      assert.fail(label + ': the hostile throw escaped recover()')
    }
    // the stop WAS positively acknowledged, so the outer outcome is unchanged
    assert.strictEqual(r.outcome, L.OUTCOME.STOP_ISSUED_RETIREMENT_NOT_WIRED, label)
    assert.strictEqual(r.ok, false, label)
    assert.ok(idx(o.log, 'verifier.evaluate') >= 0, label + ': the verifier really was consulted')
    // ⛔ the diagnostic is a refusal, and never retirement authority
    assert.strictEqual(r.verifierDiagnostic.verdict, null, label)
    assert.strictEqual(r.verifierDiagnostic.ok, false, label)
    boundedReason(r.verifierDiagnostic.reason, label)
    assert.match(r.verifierDiagnostic.reason, /^verifier threw: /, label + ': the prefix is preserved')
    never(o.log, 'quarantine.retire')
    assert.strictEqual(q.st.state, 'RUNNING', label + ': the lock is not released')
    assert.strictEqual(i.record(APPROVAL).state, STATES.STOP_REQUESTED, label)
    if (thrown !== null && (typeof thrown === 'object' || typeof thrown === 'function')) {
      for (const k of Object.keys(r.verifierDiagnostic)) assert.notStrictEqual(r.verifierDiagnostic[k], thrown, label)
    }
  }
})

test('H4. the three hostile shapes the old code actually crashed on are genuinely exercised', () => {
  const labels = hostileValues().map(([l]) => l)
  for (const required of ['null', 'a revoked Proxy', 'an own message getter that throws', 'a Proxy whose get trap throws']) {
    assert.ok(labels.includes(required), 'the table must cover ' + required)
  }
  // and the launcher source no longer contains an unguarded property read in a catch
  const src = fs.readFileSync(path.join(__dirname, 'openClawExecutorLauncher.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  assert.ok(!/e\s*&&\s*e\.message/.test(code), 'no `(e && e.message)` read may remain in the launcher')
  assert.strictEqual((code.match(/describeThrown\(e\)/g) || []).length, 3, 'all three catches use the total formatter')
})

test('H5. ⛔ the formatter degrades PRECISELY: exact reason text, and a hard 300-character bound', () => {
  const longMessage = 'x'.repeat(5000)
  const cases = [
    ['null', null, 'null'],
    ['undefined', undefined, 'undefined'],
    ['a string', 'plain string throw', 'plain string throw'],
    ['a number', 42, '42'],
    ['a boolean', false, 'false'],
    ['an ordinary Error', new Error('ordinary failure'), 'ordinary failure'],
    // ⛔ the message read is GUARDED, so this degrades to String(e) rather than bailing out
    ['an own message getter that throws', { get message () { throw new Error('hostile') } }, '[object Object]'],
    // ⛔ an EMPTY message is not a usable description, so it also falls through to String(e)
    ['an empty message', { message: '' }, '[object Object]'],
    // ⛔ nothing can be read at all: the bounded fallback, never an escape
    ['a throwing toString and message', {
      get message () { throw new Error('m') },
      toString () { throw new Error('ts') },
      get [Symbol.toPrimitive] () { throw new Error('tp') }
    }, 'unknown']
  ]
  for (const [label, thrown, expected] of cases) {
    const o = orderLog()
    const { l } = launcher(o, { seams: { launchUnit: () => { throw thrown } } })
    const r = l.run(APPROVAL)
    assert.strictEqual(r.outcome, L.OUTCOME.LAUNCH_AMBIGUOUS, label)
    assert.strictEqual(r.reason, 'launchUnit threw: ' + expected, label + ': exact reason text')
  }

  // ⛔ THE BOUND IS REAL: a 5,000-character message is truncated to exactly 300
  const o = orderLog()
  const { l } = launcher(o, { seams: { launchUnit: () => { throw new Error(longMessage) } } })
  const r = l.run(APPROVAL)
  const prefix = 'launchUnit threw: '
  assert.ok(r.reason.startsWith(prefix))
  assert.strictEqual(r.reason.length - prefix.length, 300, 'the described value is capped at 300 characters')
  assert.strictEqual(r.reason.length, prefix.length + 300)

  // and the same bound applies on the stop and verifier paths
  const o2 = orderLog()
  const { l: l2 } = launcher(o2, { seams: { stopUnit: () => { throw new Error(longMessage) } } })
  l2.run(APPROVAL)
  const r2 = l2.recover(APPROVAL)
  assert.strictEqual(r2.reason.length - 'stopUnit failed: '.length, 300)

  const o3 = orderLog()
  const { l: l3 } = launcher(o3, { deps: { retirementVerifier: { evaluate: () => { throw new Error(longMessage) } } } })
  l3.run(APPROVAL)
  const r3 = l3.recover(APPROVAL)
  assert.strictEqual(r3.verifierDiagnostic.reason.length - 'verifier threw: '.length, 300)
})
