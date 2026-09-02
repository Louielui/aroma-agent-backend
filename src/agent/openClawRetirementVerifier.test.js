'use strict'

/**
 * openClawRetirementVerifier.test.js — THE VERDICT MUST COME FROM THE WORLD, NOT THE CALLER.
 *
 * Two classes of assertion:
 *   1. every REQUIRED fact is load-bearing — remove it and the verdict changes;
 *   2. nothing a caller says can become authority, and no refusal can be read as permission.
 *
 * The second is not theoretical. openClawQuarantine.retire() does
 * `if (!verifyRetirementProof(proof, {approvalId}))`, and in JavaScript `{ ok: false }` is
 * TRUTHY — so handing it an evaluate()-shaped result would turn every refusal into authority
 * to release the global lock.
 */

const os = require('os')
const fs = require('fs')
const path = require('path')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-x3b-rv-'))

const test = require('node:test')
const assert = require('node:assert')

const { createOpenClawInstanceManager, derivedPathsFor } = require('../agent/openClawInstanceManager')
const {
  createOpenClawRetirementVerifier, isRetirementAuthority, classifyFacet, VERDICT
} = require('../agent/openClawRetirementVerifier')

const APPROVAL = 'appr_x3b'
const CG = '/user.slice/user-1000.slice/user@1000.service/app.slice/aroma-oc-appr_x3b.service'
const UID = 1000
const P = derivedPathsFor(APPROVAL)

const SPEC = Object.freeze({
  gatewayPort: 18901,
  envelopeObject: { dev: '2096', ino: '126262' },
  repoObject: { dev: '2096', ino: '126263' }
})

const memStore = () => {
  let data = {}
  return { read: () => JSON.parse(JSON.stringify(data)), write: (d) => { data = JSON.parse(JSON.stringify(d)) } }
}

/** An instance that reached the point where retirement is a fair question. */
function instances (over = {}) {
  const m = createOpenClawInstanceManager({ store: memStore() })
  m.prepare(APPROVAL, SPEC)
  m.launchAttempted(APPROVAL)
  if (!over.noControlGroup) m.observeControlGroup(APPROVAL, CG)
  m.observePids(APPROVAL, [93017, 93018])
  m.requestStop(APPROVAL)
  return m
}

/**
 * A process table expressed the way the per-facet contract requires: each PID answers for
 * status, environ, cwd and fd separately, and each answer is one of ok / gone / unreadable.
 */
function table (procs) {
  const byPid = new Map(procs.map((p) => [p.pid, p]))
  const facet = (name, shape) => (pid) => {
    const p = byPid.get(pid)
    if (!p) return { gone: true }
    if (p[name] === 'gone') return { gone: true }
    if (p[name] === 'unreadable') return { unreadable: true }
    return Object.assign({ ok: true }, shape(p))
  }
  return {
    listPids: () => ({ pids: procs.map((p) => p.pid) }),
    readStatus: facet('status', (p) => ({ uid: p.uid })),
    readEnviron: facet('environ', (p) => ({ marker: p.marker === undefined ? null : p.marker })),
    readCwd: facet('cwd', (p) => ({ cwd: p.cwdPath === undefined ? '/home/openclaw' : p.cwdPath })),
    readFds: facet('fds', (p) => ({ fds: p.fdPaths === undefined ? [] : p.fdPaths }))
  }
}

/** The clean world after a successful X2-B style retirement. */
function world (over = {}) {
  const base = Object.assign({
    readControlGroup: () => ({ exists: false }),
    statPath: (p) => (
      p === P.envelopeRoot ? { exists: true, dev: '2096', ino: '126262' }
        : p === P.repoRoot ? { exists: true, dev: '2096', ino: '126263' }
          : { exists: false }
    ),
    // measured in X2-B: a clean retirement reports failed/timeout when a SIGTERM-resistant
    // descendant forces escalation
    readUnit: () => ({ exists: false, successor: false, restart: 'no', activeState: 'failed', subState: 'failed', result: 'timeout' }),
    listListeners: () => [],
    protectedInstancesOk: () => true
  }, table([
    // unrelated root processes whose every facet is unreadable — must NOT poison the verdict
    { pid: 1, uid: 0, status: 'ok', environ: 'unreadable', cwd: 'unreadable', fds: 'unreadable' },
    { pid: 336, uid: 0, status: 'ok', environ: 'unreadable', cwd: 'unreadable', fds: 'unreadable' },
    // an unrelated same-uid process, fully readable, nothing to do with us
    { pid: 45022, uid: UID, status: 'ok', environ: 'ok', cwd: 'ok', fds: 'ok' }
  ]))
  return Object.assign(base, over)
}

const verifier = (over = {}, m) =>
  createOpenClawRetirementVerifier(Object.assign({ instances: m || instances(), executorUid: UID }, world(over)))

const ID = { approvalId: APPROVAL, instanceId: APPROVAL }

/* ══════════════ the accepting cases ══════════════ */

test('V1. a clean shutdown is RETIRED, and the workspace survived it', () => {
  const r = verifier().evaluate(ID)
  assert.strictEqual(r.verdict, VERDICT.RETIRED, r.reason)
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.evidence.envelopePreserved, true)
  assert.strictEqual(r.evidence.repoPreserved, true)
})

test('V2. ⛔ Result=timeout with clean OS evidence MUST be accepted', () => {
  // X2-B: the gateway exited in 147ms, the detached SIGTERM-resistant helper did not, and
  // systemd SIGKILLed it by control group at TimeoutStopSec. Keying on unit success would
  // reject the very case this design exists to handle.
  const r = verifier().evaluate(ID)
  assert.strictEqual(r.verdict, VERDICT.RETIRED, r.reason)
  assert.strictEqual(r.evidence.unitResult, 'timeout', 'recorded as diagnostic only')
  assert.strictEqual(r.evidence.unitActiveState, 'failed')
})

test('V3. an empty-but-present cgroup is as good as an absent one', () => {
  const r = verifier({ readControlGroup: () => ({ exists: true, procs: [] }) }).evaluate(ID)
  assert.strictEqual(r.verdict, VERDICT.RETIRED, r.reason)
})

test('V4. ⛔ unreadable facets on UNRELATED root processes do not cause UNKNOWN', () => {
  // X2-B measured 26 of 34 /proc entries unreadable, all root/system owned. Treating that as
  // doubt would make every verdict UNKNOWN forever. uid is read FIRST precisely so that these
  // are excluded by classification rather than by failing to read them.
  const r = verifier(table([
    { pid: 1, uid: 0, status: 'ok', environ: 'unreadable', cwd: 'unreadable', fds: 'unreadable' },
    { pid: 9, uid: 101, status: 'ok', environ: 'unreadable', cwd: 'unreadable', fds: 'unreadable' }
  ])).evaluate(ID)
  assert.strictEqual(r.verdict, VERDICT.RETIRED, r.reason)
})

/* ══════════════ LIVE — something of ours is still there ══════════════ */

test('V5. a populated cgroup is LIVE', () => {
  const r = verifier({ readControlGroup: () => ({ exists: true, procs: [93018] }) }).evaluate(ID)
  assert.strictEqual(r.verdict, VERDICT.LIVE)
  assert.match(r.reason, /still has 1 member/)
})

test('V6. an observed pid still alive is LIVE', () => {
  const r = verifier(table([{ pid: 93018, uid: UID, status: 'ok', environ: 'ok', cwd: 'ok', fds: 'ok' }])).evaluate(ID)
  assert.strictEqual(r.verdict, VERDICT.LIVE)
  assert.match(r.reason, /93018/)
})

test('V7. ⛔ a same-uid survivor carrying the instance marker is LIVE, even outside the cgroup', () => {
  // The check that survives the measured cgroup residual: X2-B proved a sibling unit's
  // cgroup.procs IS writable by uid 1000, so a descendant could migrate out.
  const r = verifier(table([
    { pid: 99999, uid: UID, status: 'ok', environ: 'ok', cwd: 'ok', fds: 'ok', marker: APPROVAL }
  ])).evaluate(ID)
  assert.strictEqual(r.verdict, VERDICT.LIVE)
  assert.match(r.reason, /instance marker/)
})

test('V8. ⛔ a same-uid process holding our state/config/envelope/repo is LIVE', () => {
  const HOLDERS = [
    ['cwd in stateRoot', { cwdPath: P.stateRoot + '/state' }],
    ['cwd is the envelope', { cwdPath: P.envelopeRoot }],
    ['cwd in the repo', { cwdPath: P.repoRoot + '/src' }],
    ['fd on the config', { fdPaths: [P.configPath] }],
    ['fd inside the state root', { fdPaths: ['/x', P.stateRoot + '/state/openclaw.sqlite'] }]
  ]
  for (const [name, shape] of HOLDERS) {
    const r = verifier(table([
      Object.assign({ pid: 4242, uid: UID, status: 'ok', environ: 'ok', cwd: 'ok', fds: 'ok' }, shape)
    ])).evaluate(ID)
    assert.strictEqual(r.verdict, VERDICT.LIVE, name)
    assert.match(r.reason, /still hold the instance/, name)
  }
})

test('V8b. a path that merely SHARES A PREFIX is not a holder', () => {
  const r = verifier(table([
    { pid: 4242, uid: UID, status: 'ok', environ: 'ok', cwd: 'ok', fds: 'ok', cwdPath: P.envelopeRoot + '-other' }
  ])).evaluate(ID)
  assert.strictEqual(r.verdict, VERDICT.RETIRED, r.reason)
})

test('V9. a successor unit, or a restart policy, is LIVE', () => {
  const a = verifier({ readUnit: () => ({ exists: true, successor: false, restart: 'always', activeState: 'active' }) }).evaluate(ID)
  assert.strictEqual(a.verdict, VERDICT.LIVE)
  const b = verifier({ readUnit: () => ({ exists: true, successor: true, restart: 'no' }) }).evaluate(ID)
  assert.strictEqual(b.verdict, VERDICT.LIVE)
  assert.match(b.reason, /successor/)
})

test('V10. ⛔ a missing envelope or repo is REFUSED — retirement is never proven by deletion', () => {
  for (const which of [P.envelopeRoot, P.repoRoot]) {
    const r = verifier({
      statPath: (p) => (p === which ? { exists: false }
        : { exists: true, dev: '2096', ino: p === P.envelopeRoot ? '126262' : '126263' })
    }).evaluate(ID)
    assert.strictEqual(r.ok, false, which)
    assert.match(r.reason, /never be proven by deletion/, which)
  }
})

test('V11. ⛔ a REPLACED envelope or repo is refused, by exact string object identity', () => {
  for (const which of [P.envelopeRoot, P.repoRoot]) {
    const r = verifier({
      statPath: (p) => (
        p === which ? { exists: true, dev: '2096', ino: '999999' }
          : p === P.envelopeRoot ? { exists: true, dev: '2096', ino: '126262' }
            : { exists: true, dev: '2096', ino: '126263' }
      )
    }).evaluate(ID)
    assert.strictEqual(r.ok, false, which)
    assert.match(r.reason, /is not the prepared object/, which)
  }
})

test('V11b. ⛔ a 2^53-neighbour inode is NOT mistaken for the prepared object', () => {
  // The F2 defect made concrete: as Numbers these compare equal.
  const m = createOpenClawInstanceManager({ store: memStore() })
  m.prepare(APPROVAL, Object.assign({}, SPEC, { envelopeObject: { dev: '0', ino: '9007199254740992' } }))
  m.launchAttempted(APPROVAL); m.observeControlGroup(APPROVAL, CG); m.requestStop(APPROVAL)

  const r = createOpenClawRetirementVerifier(Object.assign({ instances: m, executorUid: UID }, world({
    statPath: (p) => (p === P.envelopeRoot ? { exists: true, dev: '0', ino: '9007199254740993' }
      : { exists: true, dev: '2096', ino: '126263' })
  }))).evaluate(ID)
  assert.strictEqual(r.ok, false)
  assert.match(r.reason, /is not the prepared object/)
})

test('V11c. a non-canonical stat identity is UNKNOWN, not silently coerced', () => {
  for (const bad of [{ dev: 2096, ino: 126262 }, { dev: '2096', ino: '0126262' }, { dev: '2096', ino: '1e5' }]) {
    const r = verifier({ statPath: () => Object.assign({ exists: true }, bad) }).evaluate(ID)
    assert.strictEqual(r.verdict, VERDICT.UNKNOWN, JSON.stringify(bad))
    assert.match(r.reason, /does not satisfy its contract/)
  }
})

test('V12. the protected-instance safety gate can refuse on its own', () => {
  const r = verifier({ protectedInstancesOk: () => false }).evaluate(ID)
  assert.strictEqual(r.ok, false)
  assert.match(r.reason, /protected or unrelated executor/)
})

/* ══════════════ per-facet /proc coverage ══════════════ */

test('V13. ⛔ an unreadable SAME-UID facet is UNKNOWN — one per facet', () => {
  // The F7 fix: status, environ, cwd and fd each answer for themselves. Any one of them being
  // unreadable on an executor-uid process is a hole in the scan we depend on.
  for (const [facet, shape] of [
    ['status', { status: 'unreadable' }],
    ['environ', { environ: 'unreadable' }],
    ['cwd', { cwd: 'unreadable' }],
    ['fd', { fds: 'unreadable' }]
  ]) {
    const r = verifier(table([
      Object.assign({ pid: 5150, uid: UID, status: 'ok', environ: 'ok', cwd: 'ok', fds: 'ok' }, shape)
    ])).evaluate(ID)
    assert.strictEqual(r.verdict, VERDICT.UNKNOWN, facet)
    assert.strictEqual(r.evidence.uninspectablePid, 5150, facet)
    assert.strictEqual(r.evidence.facet, facet, facet)
    // ⛔ AND THE REASON MUST SAY WHICH KIND OF FAILURE IT WAS.
    // "the reader could not read it" and "the reader answered nonsense" need different fixes —
    // one is a permission problem, the other a contract violation. Collapsing them would leave
    // an operator with UNKNOWN and no idea which.
    assert.match(r.reason, /is unreadable/, facet + ': reported as unreadable, not as a bad shape')
  }
})

test('V13b. ⛔ an unreadable STATUS is UNKNOWN even though the uid is not yet known', () => {
  // We cannot classify it, so we cannot decide it is irrelevant. Permission denied is not
  // permission to ignore.
  const r = verifier(table([{ pid: 7777, uid: 0, status: 'unreadable' }])).evaluate(ID)
  assert.strictEqual(r.verdict, VERDICT.UNKNOWN)
  assert.match(r.reason, /uid is unknown and it cannot be classified/)
})

test('V13c. an explicitly VANISHED pid is handled safely, and is not "unreadable"', () => {
  // (7) gone means the PID disappeared between listing and reading. A process that no longer
  // exists holds nothing and carries nothing.
  const gone = verifier(table([{ pid: 8888, uid: UID, status: 'gone' }])).evaluate(ID)
  assert.strictEqual(gone.verdict, VERDICT.RETIRED, gone.reason)

  // vanishing part-way through the facets is equally safe
  for (const facet of ['environ', 'cwd', 'fds']) {
    const r = verifier(table([
      Object.assign({ pid: 8889, uid: UID, status: 'ok', environ: 'ok', cwd: 'ok', fds: 'ok' }, { [facet]: 'gone' })
    ])).evaluate(ID)
    assert.strictEqual(r.verdict, VERDICT.RETIRED, facet)
  }
})

test('V13d. ⛔ permission-denied is NEVER treated as vanished', () => {
  // The two must not be conflated: one is a fact about the world, the other is a hole in our
  // view of it. Same pid, same uid, different reader answer, opposite verdicts.
  const vanished = verifier(table([{ pid: 9001, uid: UID, status: 'gone' }])).evaluate(ID)
  const denied = verifier(table([{ pid: 9001, uid: UID, status: 'ok', environ: 'unreadable', cwd: 'ok', fds: 'ok' }])).evaluate(ID)
  assert.strictEqual(vanished.verdict, VERDICT.RETIRED)
  assert.strictEqual(denied.verdict, VERDICT.UNKNOWN)
})

test('V14. ⛔ a missing observedControlGroup is UNKNOWN — a predicted path is not a measured one', () => {
  const r = verifier({}, instances({ noControlGroup: true })).evaluate(ID)
  assert.strictEqual(r.verdict, VERDICT.UNKNOWN)
  assert.match(r.reason, /never observed a control group/)
})

test('V15. an unreadable source of any kind is UNKNOWN', () => {
  const CASES = [
    ['cgroup unreadable', { readControlGroup: () => ({ unreadable: true }) }],
    ['cgroup throws', { readControlGroup: () => { throw new Error('EACCES') } }],
    ['cgroup members unreadable', { readControlGroup: () => ({ exists: true }) }],
    ['pid list unreadable', { listPids: () => ({ unreadable: true }) }],
    ['pid list throws', { listPids: () => { throw new Error('EACCES') } }],
    ['pid list malformed', { listPids: () => ({}) }],
    ['status throws', { readStatus: () => { throw new Error('EACCES') } }],
    ['environ throws', { readEnviron: () => { throw new Error('EACCES') } }],
    ['stat unreadable', { statPath: () => ({ unreadable: true }) }],
    ['stat throws', { statPath: () => { throw new Error('EIO') } }],
    ['unit unreadable', { readUnit: () => ({ unreadable: true }) }],
    ['unit throws', { readUnit: () => { throw new Error('no dbus') } }],
    ['safety gate throws', { protectedInstancesOk: () => { throw new Error('x') } }]
  ]
  for (const [name, over] of CASES) {
    const r = verifier(over).evaluate(ID)
    assert.strictEqual(r.verdict, VERDICT.UNKNOWN, name)
    assert.strictEqual(r.ok, false, name)
  }
})

test('V16. ⛔ a missing evidence source is UNKNOWN, never "assume clean"', () => {
  for (const missing of ['readControlGroup', 'listPids', 'readStatus', 'readEnviron', 'readCwd',
    'readFds', 'statPath', 'readUnit', 'protectedInstancesOk']) {
    const deps = Object.assign({ instances: instances(), executorUid: UID }, world())
    delete deps[missing]
    const r = createOpenClawRetirementVerifier(deps).evaluate(ID)
    assert.strictEqual(r.verdict, VERDICT.UNKNOWN, missing)
    assert.match(r.reason, /evidence source is not available/, missing)
  }
})

test('V17. wrong identity is UNKNOWN', () => {
  const v = verifier()
  assert.strictEqual(v.evaluate({ approvalId: 'appr_other', instanceId: 'appr_other' }).verdict, VERDICT.UNKNOWN)
  assert.strictEqual(v.evaluate({ approvalId: APPROVAL, instanceId: 'appr_other' }).verdict, VERDICT.UNKNOWN)
  assert.strictEqual(v.evaluate({}).verdict, VERDICT.UNKNOWN)
  assert.match(v.evaluate({ approvalId: APPROVAL, instanceId: 'appr_other' }).reason, /does not match the record/)
})

test('V18. an unreadable instance store is UNKNOWN', () => {
  const broken = { record: () => { throw new Error('store unreadable') } }
  const v = createOpenClawRetirementVerifier(Object.assign({ instances: broken, executorUid: UID }, world()))
  const r = v.evaluate(ID)
  assert.strictEqual(r.verdict, VERDICT.UNKNOWN)
  assert.match(r.reason, /instance store could not be read/)
})

/* ══════════════ the port is corroboration only ══════════════ */

test('V19. ⛔ the port can neither create nor destroy a verdict on its own', () => {
  const free = verifier({ listListeners: () => [] }).evaluate(ID)
  assert.strictEqual(free.verdict, VERDICT.RETIRED)
  assert.strictEqual(free.evidence.portListeners, 0)

  // a listener owned by an unrelated later tenant must NOT flip a clean world to LIVE
  const reused = verifier({ listListeners: () => [{ pid: 55555 }] }).evaluate(ID)
  assert.strictEqual(reused.verdict, VERDICT.RETIRED, reused.reason)
  assert.strictEqual(reused.evidence.portListeners, 1)

  const broken = verifier({ listListeners: () => { throw new Error('ss failed') } }).evaluate(ID)
  assert.strictEqual(broken.verdict, VERDICT.RETIRED)
})

/* ══════════════ the boolean seam ══════════════ */

test('B1. ⛔ {ok:false} CANNOT become truthy authority', () => {
  for (const [name, over, m] of [
    ['LIVE (cgroup populated)', { readControlGroup: () => ({ exists: true, procs: [1] }) }, undefined],
    ['UNKNOWN (no control group)', {}, instances({ noControlGroup: true })],
    ['UNKNOWN (unreadable same-uid facet)', table([{ pid: 7, uid: UID, status: 'ok', environ: 'unreadable', cwd: 'ok', fds: 'ok' }]), undefined],
    ['refused (envelope gone)', { statPath: () => ({ exists: false }) }, undefined]
  ]) {
    const v = verifier(over, m)
    const evaluated = v.evaluate(ID)
    assert.strictEqual(evaluated.ok, false, name)
    assert.ok(evaluated, name + ': the object itself is truthy — that is the trap')

    const bool = v.verifyForQuarantine({ approvalId: APPROVAL, instanceId: APPROVAL }, { approvalId: APPROVAL })
    assert.strictEqual(bool, false, name + ': the seam must return literal false')
    assert.strictEqual(typeof bool, 'boolean', name + ': and a real boolean')
  }
})

test('B2. only ok===true AND verdict===RETIRED returns literal true', () => {
  const bool = verifier().verifyForQuarantine({ approvalId: APPROVAL, instanceId: APPROVAL }, { approvalId: APPROVAL })
  assert.strictEqual(bool, true)
  assert.strictEqual(typeof bool, 'boolean')
})

test('B3. ⛔ forged caller booleans are never read', () => {
  const v = verifier({ readControlGroup: () => ({ exists: true, procs: [93018] }) })
  const forged = {
    approvalId: APPROVAL, instanceId: APPROVAL,
    cgroupEmpty: true, processGone: true, workspaceIntact: true, ok: true, verdict: 'RETIRED'
  }
  assert.strictEqual(v.verifyForQuarantine(forged, { approvalId: APPROVAL }), false)
  assert.strictEqual(v.evaluate(forged).verdict, VERDICT.LIVE, 'the world still decides')
})

test('B4. a malformed evaluation or a thrown error is literal false', () => {
  const v = createOpenClawRetirementVerifier(Object.assign(
    { instances: { record: () => { throw new Error('boom') } }, executorUid: UID }, world()))
  assert.strictEqual(v.verifyForQuarantine({ approvalId: APPROVAL }, { approvalId: APPROVAL }), false)

  const v2 = createOpenClawRetirementVerifier(Object.assign({ instances: { record: () => null } }, world()))
  assert.strictEqual(v2.verifyForQuarantine({ approvalId: APPROVAL }, { approvalId: APPROVAL }), false)
})

test('B5. the ledger approvalId outranks the one in the proof', () => {
  const v = verifier()
  assert.strictEqual(
    v.verifyForQuarantine({ approvalId: 'appr_somewhere_else', instanceId: APPROVAL }, { approvalId: APPROVAL }),
    true, 'evaluated against the ledger key')
  assert.strictEqual(
    v.verifyForQuarantine({ approvalId: APPROVAL, instanceId: APPROVAL }, { approvalId: 'appr_other' }),
    false, 'a ledger key with no record cannot be rescued by the proof')
})

test('B6. ⛔ the authority predicate requires ok AND verdict to agree', () => {
  // Reached directly, because it cannot be reached through the public API: inside evaluate()
  // ok and verdict never disagree, so a mutant that dropped the verdict check survived the
  // whole suite. The seam is the last thing between a refusal and the global lock.
  assert.strictEqual(isRetirementAuthority({ ok: true, verdict: VERDICT.RETIRED }), true)
  for (const [name, value] of [
    ['ok true but LIVE', { ok: true, verdict: VERDICT.LIVE }],
    ['ok true but UNKNOWN', { ok: true, verdict: VERDICT.UNKNOWN }],
    ['ok true, no verdict', { ok: true }],
    ['ok true, forged verdict string', { ok: true, verdict: 'retired' }],
    ['RETIRED but ok false', { ok: false, verdict: VERDICT.RETIRED }],
    ['RETIRED but ok truthy-not-true', { ok: 1, verdict: VERDICT.RETIRED }],
    ['empty object', {}],
    ['null', null],
    ['undefined', undefined],
    ['a truthy non-object', 'RETIRED'],
    ['an array', [{ ok: true, verdict: VERDICT.RETIRED }]]
  ]) {
    const out = isRetirementAuthority(value)
    assert.strictEqual(out, false, name)
    assert.strictEqual(typeof out, 'boolean', name + ': and a literal boolean')
  }
})

/* ══════════════ inertness ══════════════ */

test('I1. ⛔ the verifier can reach no operating system by default', () => {
  const src = fs.readFileSync(path.join(__dirname, 'openClawRetirementVerifier.js'), 'utf8')
  const code = src.split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l)).join('\n')
  for (const re of [/child_process/, /\bspawn\w*\s*\(/, /\bexecSync\b/, /wsl\.exe/, /systemctl\s/, /readFileSync/]) {
    assert.ok(!re.test(code), `verifier must not contain ${re}`)
  }
  // ⛔ EXACTLY ONE IMPORT, AND IT IS THE PARSING BOUNDARY.
  // The verifier may reach its own contract module and nothing else — no OS, no runtime, and
  // no second dependency that could quietly grow one later.
  const requires = code.match(/require\s*\([^)]*\)/g) || []
  assert.deepStrictEqual(requires, ["require('./openClawReaderContracts')"],
    'the verifier imports the contracts module and nothing else')
  const bare = createOpenClawRetirementVerifier({ instances: instances() })
  assert.strictEqual(bare.evaluate(ID).verdict, VERDICT.UNKNOWN)
})

test('I2. the V1 threat model is recorded in the source, not just in a report', () => {
  const src = fs.readFileSync(path.join(__dirname, 'openClawRetirementVerifier.js'), 'utf8')
  for (const phrase of ['COOPERATIVE', 'EXPIRES', 'cgroupfs', 'sibling cgroup']) {
    assert.ok(src.includes(phrase), `the source must state: ${phrase}`)
  }
})

test('I3. ⛔ the verifier is the ONLY module that reaches a retirement verdict', () => {
  // F3: the instance manager used to have markRetired(). Semantic retirement lives here and
  // nowhere else; governance retirement remains quarantine.retire() -> EXECUTOR_RETIRED.
  const m = instances()
  for (const forbidden of ['markRetired', 'retire', 'setRetired', 'isRetired']) {
    assert.strictEqual(m[forbidden], undefined, `the instance manager must not expose ${forbidden}`)
  }
  const imSrc = fs.readFileSync(path.join(__dirname, 'openClawInstanceManager.js'), 'utf8')
  const imCode = imSrc.split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l)).join('\n')
  assert.ok(!/markRetired|RETIRED:|retiredAt|isRetired/.test(imCode),
    'the instance manager source must contain no retirement concept')
})

/* ══════════════ FIX B — the cgroup must SAY which it is ══════════════ */

test('V20. ⛔ a cgroup reader that does not state exists is UNKNOWN, never "absent"', () => {
  // Testing only `exists === true` meant every shape that failed to answer fell through to the
  // absent branch — and "the cgroup is gone" is the answer that lets a record be retired.
  for (const [name, shape] of [
    ['empty object', {}],
    ['exists null', { exists: null }],
    ['exists undefined', { exists: undefined }],
    ['exists the STRING false', { exists: 'false' }],
    ['exists the string true', { exists: 'true' }],
    ['exists 0', { exists: 0 }],
    ['exists 1', { exists: 1 }],
    ['procs but no exists', { procs: [] }]
  ]) {
    const r = verifier({ readControlGroup: () => shape }).evaluate(ID)
    assert.strictEqual(r.verdict, VERDICT.UNKNOWN, name)
    assert.match(r.reason, /does not satisfy its contract/, name)
  }
})

test('V21. an explicit exists:true with no procs is UNKNOWN; with [] it is clean', () => {
  const noProcs = verifier({ readControlGroup: () => ({ exists: true }) }).evaluate(ID)
  assert.strictEqual(noProcs.verdict, VERDICT.UNKNOWN)
  assert.match(noProcs.reason, /does not satisfy its contract/)

  const empty = verifier({ readControlGroup: () => ({ exists: true, procs: [] }) }).evaluate(ID)
  assert.strictEqual(empty.verdict, VERDICT.RETIRED, empty.reason)

  const absent = verifier({ readControlGroup: () => ({ exists: false }) }).evaluate(ID)
  assert.strictEqual(absent.verdict, VERDICT.RETIRED, absent.reason)
})

/* ══════════════ FIX C — authoritative reader shapes ══════════════ */

test('V22. ⛔ a malformed pid list is UNKNOWN, not partially usable', () => {
  // Skipping the bad entries would scan a SUBSET while reporting on the whole table, and the
  // entry skipped is exactly where a survivor would hide.
  for (const [name, pids] of [
    ['negative', [1, -2]],
    ['zero', [0]],
    ['string', ['93017']],
    ['float', [1.5]],
    ['NaN', [NaN]],
    ['null entry', [1, null]],
    ['object entry', [{}]]
  ]) {
    const r = verifier(Object.assign({}, table([]), { listPids: () => ({ pids }) })).evaluate(ID)
    assert.strictEqual(r.verdict, VERDICT.UNKNOWN, name)
    assert.match(r.reason, /does not satisfy its contract/, name)
  }
})

test('V23. ⛔ an "ok" facet that carries no answer is UNKNOWN', () => {
  // A reader returning ok:true with no marker, no cwd, or a malformed fd list has told us
  // nothing — and treating that as "nothing of ours here" is the same error as treating
  // permission-denied as vanished.
  const base = { pid: 5150, uid: UID, status: 'ok', environ: 'ok', cwd: 'ok', fds: 'ok' }
  const CASES = [
    ['marker is a number', { readEnviron: () => ({ ok: true, marker: 42 }) }, 'environ'],
    ['marker is an object', { readEnviron: () => ({ ok: true, marker: {} }) }, 'environ'],
    ['marker missing entirely', { readEnviron: () => ({ ok: true }) }, 'environ'],
    ['cwd is not a string', { readCwd: () => ({ ok: true, cwd: 42 }) }, 'cwd'],
    ['cwd missing', { readCwd: () => ({ ok: true }) }, 'cwd'],
    ['fds not an array', { readFds: () => ({ ok: true, fds: '/x' }) }, 'fd'],
    ['fds missing', { readFds: () => ({ ok: true }) }, 'fd'],
    ['fd entry not a string', { readFds: () => ({ ok: true, fds: ['/x', 42] }) }, 'fd'],
    ['fd entry null', { readFds: () => ({ ok: true, fds: [null] }) }, 'fd']
  ]
  for (const [name, over, facet] of CASES) {
    const r = verifier(Object.assign({}, table([base]), over)).evaluate(ID)
    assert.strictEqual(r.verdict, VERDICT.UNKNOWN, name)
    assert.strictEqual(r.evidence.facet, facet, name)
    assert.strictEqual(r.evidence.uninspectablePid, 5150, name)
  }

  // marker === null is a legitimate answer: "this process carries no marker"
  const clean = verifier(Object.assign({}, table([base]),
    { readEnviron: () => ({ ok: true, marker: null }) })).evaluate(ID)
  assert.strictEqual(clean.verdict, VERDICT.RETIRED, clean.reason)
})

test('V24. ⛔ the unit must state exists AND successor as explicit booleans', () => {
  for (const [name, unit] of [
    ['no exists', { successor: false, restart: 'no' }],
    ['exists null', { exists: null, successor: false, restart: 'no' }],
    ['exists string', { exists: 'false', successor: false, restart: 'no' }],
    ['no successor', { exists: false, restart: 'no' }],
    ['successor null', { exists: false, successor: null, restart: 'no' }],
    ['successor string', { exists: false, successor: 'false', restart: 'no' }]
  ]) {
    const r = verifier({ readUnit: () => unit }).evaluate(ID)
    assert.strictEqual(r.verdict, VERDICT.UNKNOWN, name)
    assert.match(r.reason, /does not satisfy its contract/, name)
  }
})

test('V25. an existing unit must state a readable restart policy', () => {
  const missing = verifier({ readUnit: () => ({ exists: true, successor: false }) }).evaluate(ID)
  assert.strictEqual(missing.verdict, VERDICT.UNKNOWN)
  assert.match(missing.reason, /does not satisfy its contract/)

  const empty = verifier({ readUnit: () => ({ exists: true, successor: false, restart: '' }) }).evaluate(ID)
  assert.strictEqual(empty.verdict, VERDICT.UNKNOWN)

  const onFailure = verifier({ readUnit: () => ({ exists: true, successor: false, restart: 'on-failure' }) }).evaluate(ID)
  assert.strictEqual(onFailure.verdict, VERDICT.LIVE)
  assert.match(onFailure.reason, /would restart/)

  const no = verifier({ readUnit: () => ({ exists: true, successor: false, restart: 'no' }) }).evaluate(ID)
  assert.strictEqual(no.verdict, VERDICT.RETIRED, no.reason)
})

test('V26. ⛔ unit.exists === false proves NOTHING on its own', () => {
  // The unit being gone is not retirement. With the unit absent but a marked survivor alive,
  // the verdict must still be LIVE — decided by the OS facts, never by the unit's absence.
  const r = verifier(Object.assign(
    { readUnit: () => ({ exists: false, successor: false }) },
    table([{ pid: 4242, uid: UID, status: 'ok', environ: 'ok', cwd: 'ok', fds: 'ok', marker: APPROVAL }])
  )).evaluate(ID)
  assert.strictEqual(r.verdict, VERDICT.LIVE)
  assert.match(r.reason, /instance marker/)

  // and an absent unit needs no restart policy, because there is no unit to restart
  const clean = verifier({ readUnit: () => ({ exists: false, successor: false }) }).evaluate(ID)
  assert.strictEqual(clean.verdict, VERDICT.RETIRED, clean.reason)
})

test('V27. a successor is LIVE even when the unit itself is gone', () => {
  const r = verifier({ readUnit: () => ({ exists: false, successor: true }) }).evaluate(ID)
  assert.strictEqual(r.verdict, VERDICT.LIVE)
  assert.match(r.reason, /successor/)
})

/* ══════════════ X3-C3 — a facet result is EXACTLY ONE variant ══════════════ */

test('V28. ⛔ classifyFacet accepts exactly one variant, and nothing else', () => {
  // Reached directly, because the contradictory shapes it exists to catch would otherwise have
  // to be smuggled through a reader fixture for every single call site.
  assert.strictEqual(classifyFacet({ ok: true, uid: 0 }), 'ok')
  assert.strictEqual(classifyFacet({ gone: true }), 'gone')
  assert.strictEqual(classifyFacet({ unreadable: true }), 'unreadable')

  for (const [name, r] of [
    // ⛔ THE DEFECT: gone used to win first, so this classified as GONE and a LIVE executor
    // process would have been skipped on the way to RETIRED.
    ['gone + ok', { gone: true, ok: true, uid: 1000 }],
    ['gone + unreadable', { gone: true, unreadable: true }],
    ['ok + unreadable', { ok: true, unreadable: true, uid: 1000 }],
    ['all three', { ok: true, gone: true, unreadable: true }],
    ['no variant at all', {}],
    ['ok false only', { ok: false }],
    ['gone false only', { gone: false }],
    ['truthy but not true', { ok: 1 }],
    ['string variant', { gone: 'true' }],
    ['null', null],
    ['undefined', undefined],
    ['an array', [{ ok: true }]],
    ['a string', 'ok'],
    ['a number', 1]
  ]) {
    assert.strictEqual(classifyFacet(r), null, name)
  }
})

test('V29. ⛔ a contradictory STATUS is UNKNOWN, never GONE', () => {
  for (const [name, st] of [
    ['gone + ok + uid', { gone: true, ok: true, uid: UID }],
    ['gone + unreadable', { gone: true, unreadable: true }],
    ['ok + unreadable', { ok: true, unreadable: true, uid: UID }],
    ['no variant', { uid: UID }]
  ]) {
    const r = verifier(Object.assign({}, table([]), {
      listPids: () => ({ pids: [4242] }),
      readStatus: () => st
    })).evaluate(ID)
    assert.strictEqual(r.verdict, VERDICT.UNKNOWN, name)
    assert.match(r.reason, /does not satisfy its contract/, name)
    assert.strictEqual(r.evidence.facet, 'status', name)
  }
})

test('V30. ⛔ an impossible uid is UNKNOWN', () => {
  for (const [name, uid] of [
    ['negative', -1],
    ['very negative', -1000],
    ['float', 1.5],
    ['string', '1000'],
    ['null', null],
    ['missing', undefined],
    ['NaN', NaN]
  ]) {
    const r = verifier(Object.assign({}, table([]), {
      listPids: () => ({ pids: [4242] }),
      readStatus: () => ({ ok: true, uid })
    })).evaluate(ID)
    assert.strictEqual(r.verdict, VERDICT.UNKNOWN, name)
    assert.strictEqual(r.evidence.facet, 'status', name)
  }

  // uid 0 is root and perfectly legal — it is simply not ours
  const rootOnly = verifier(Object.assign({}, table([]), {
    listPids: () => ({ pids: [1] }),
    readStatus: () => ({ ok: true, uid: 0 })
  })).evaluate(ID)
  assert.strictEqual(rootOnly.verdict, VERDICT.RETIRED, rootOnly.reason)
})

test('V31. ⛔ a contradictory ENVIRON / CWD / FD is UNKNOWN, never GONE', () => {
  // Each of these would previously have been read as "the process vanished", discarding the
  // very evidence it was carrying — a marker naming our instance, or a held path.
  const CASES = [
    ['environ', { readEnviron: () => ({ gone: true, ok: true, marker: APPROVAL }) }],
    ['cwd', { readCwd: () => ({ gone: true, ok: true, cwd: P.repoRoot }) }],
    ['fd', { readFds: () => ({ gone: true, ok: true, fds: [P.repoRoot] }) }]
  ]
  for (const [facet, over] of CASES) {
    const r = verifier(Object.assign({},
      table([{ pid: 4242, uid: UID, status: 'ok', environ: 'ok', cwd: 'ok', fds: 'ok' }]), over)).evaluate(ID)
    assert.strictEqual(r.verdict, VERDICT.UNKNOWN, facet)
    assert.match(r.reason, /does not satisfy its contract/, facet)
    assert.strictEqual(r.evidence.facet, facet, facet)
    assert.strictEqual(r.evidence.uninspectablePid, 4242, facet)
  }
})

test('V32. ⛔ unreadable combined with ok is UNKNOWN for every facet', () => {
  const CASES = [
    ['status', { readStatus: () => ({ ok: true, unreadable: true, uid: UID }) }],
    ['environ', { readEnviron: () => ({ ok: true, unreadable: true, marker: null }) }],
    ['cwd', { readCwd: () => ({ ok: true, unreadable: true, cwd: '/x' }) }],
    ['fd', { readFds: () => ({ ok: true, unreadable: true, fds: [] }) }]
  ]
  for (const [facet, over] of CASES) {
    const r = verifier(Object.assign({},
      table([{ pid: 4242, uid: UID, status: 'ok', environ: 'ok', cwd: 'ok', fds: 'ok' }]), over)).evaluate(ID)
    assert.strictEqual(r.verdict, VERDICT.UNKNOWN, facet)
    assert.strictEqual(r.evidence.facet, facet, facet)
  }
})

/* ══════════════ X3-C3 — the reads are SEQUENTIAL ══════════════ */

test('V33. ⛔ a genuine vanish mid-scan stops that pid, and the later reader is NEVER called', () => {
  // The legitimate race: status OK, environ OK, then the process exits before cwd is read.
  // That is safe — a process that no longer exists holds nothing — but the fd reader must not
  // be called at all, because there is nothing left to read and calling it would invite a
  // fourth answer about a process we already know is gone.
  const called = []
  const r = verifier(Object.assign({}, table([]), {
    listPids: () => ({ pids: [4242] }),
    readStatus: (pid) => { called.push('status'); return { ok: true, uid: UID } },
    readEnviron: (pid) => { called.push('environ'); return { ok: true, marker: null } },
    readCwd: (pid) => { called.push('cwd'); return { gone: true } },
    readFds: (pid) => { called.push('fd'); return { ok: true, fds: [] } }
  })).evaluate(ID)

  assert.strictEqual(r.verdict, VERDICT.RETIRED, r.reason)
  assert.deepStrictEqual(called, ['status', 'environ', 'cwd'], 'the fd reader was never called')
})

test('V34. ⛔ a status GONE stops the pid before any other facet is touched', () => {
  const called = []
  const r = verifier(Object.assign({}, table([]), {
    listPids: () => ({ pids: [4242] }),
    readStatus: () => { called.push('status'); return { gone: true } },
    readEnviron: () => { called.push('environ'); return { ok: true, marker: APPROVAL } },
    readCwd: () => { called.push('cwd'); return { ok: true, cwd: P.repoRoot } },
    readFds: () => { called.push('fd'); return { ok: true, fds: [] } }
  })).evaluate(ID)

  assert.strictEqual(r.verdict, VERDICT.RETIRED, r.reason)
  assert.deepStrictEqual(called, ['status'], 'no other facet was read for a vanished pid')
})

test('V35. evidence from an EARLIER facet is not erased by a LATER vanish', () => {
  // environ already told us this process carries our marker. Reading all three first and then
  // asking "did any say gone" would have thrown that away and returned RETIRED.
  const r = verifier(Object.assign({}, table([]), {
    listPids: () => ({ pids: [4242] }),
    readStatus: () => ({ ok: true, uid: UID }),
    readEnviron: () => ({ ok: true, marker: APPROVAL }),
    readCwd: () => ({ gone: true }),
    readFds: () => ({ ok: true, fds: [] })
  })).evaluate(ID)

  // The pid is skipped from the point of the vanish, which is the agreed race rule — but the
  // skip happens AFTER environ was classified, so nothing contradictory was collapsed.
  assert.strictEqual(r.verdict, VERDICT.RETIRED, r.reason)

  // ...and the contradictory form of the same situation is refused rather than skipped
  const contradictory = verifier(Object.assign({}, table([]), {
    listPids: () => ({ pids: [4242] }),
    readStatus: () => ({ ok: true, uid: UID }),
    readEnviron: () => ({ ok: true, gone: true, marker: APPROVAL })
  })).evaluate(ID)
  assert.strictEqual(contradictory.verdict, VERDICT.UNKNOWN)
  assert.strictEqual(contradictory.evidence.facet, 'environ')
})

/* ══════════════ X3-C4 — a variant TAG must be a boolean ══════════════ */

test('V36. ⛔ a present variant tag that is not a boolean is malformed', () => {
  // Counting only `=== true` made a non-boolean tag INVISIBLE rather than invalid, so
  // { gone:true, ok:'true' } counted exactly one true and classified as GONE. A reader that
  // puts a string, number or object in a variant tag is not making an odd claim — it is not
  // speaking the contract, and an unparseable answer is not an answer.
  for (const [name, r] of [
    ['ok is the STRING true', { gone: true, ok: 'true' }],
    ['unreadable is 1', { gone: true, unreadable: 1 }],
    ['gone is the string false', { ok: true, gone: 'false' }],
    ['ok is an object', { unreadable: true, ok: {} }],
    ['ok is an array', { gone: true, ok: [] }],
    ['gone is null', { ok: true, gone: null }],
    ['unreadable is 0', { ok: true, unreadable: 0 }],
    ['gone is an empty string', { ok: true, gone: '' }],
    ['ok explicitly undefined', { ok: undefined, gone: true }],
    ['every tag a string', { ok: 'false', gone: 'true', unreadable: 'false' }]
  ]) {
    assert.strictEqual(classifyFacet(r), null, name)
  }

  // ...and the legitimate shapes still classify, including explicit false siblings
  assert.strictEqual(classifyFacet({ ok: true }), 'ok')
  assert.strictEqual(classifyFacet({ ok: true, gone: false, unreadable: false }), 'ok')
  assert.strictEqual(classifyFacet({ gone: true }), 'gone')
  assert.strictEqual(classifyFacet({ gone: true, ok: false, unreadable: false }), 'gone')
  assert.strictEqual(classifyFacet({ unreadable: true }), 'unreadable')
  assert.strictEqual(classifyFacet({ unreadable: true, ok: false }), 'unreadable')
})

test('V37. ⛔ the reported fail-open case: a live executor pid is NEVER skipped', () => {
  // The exact shape from the review. Before the fix this produced ok:true / RETIRED while a
  // real executor-uid process was still alive.
  const r = verifier(Object.assign({}, table([]), {
    listPids: () => ({ pids: [93018] }),
    readStatus: () => ({ gone: true, ok: 'true', uid: 1000 })
  })).evaluate(ID)

  assert.strictEqual(r.verdict, VERDICT.UNKNOWN)
  assert.strictEqual(r.ok, false, 'and never ok:true')
  assert.notStrictEqual(r.verdict, VERDICT.RETIRED)
  assert.match(r.reason, /does not satisfy its contract/)
  assert.strictEqual(r.evidence.facet, 'status')
})

test('V38. ⛔ a malformed secondary tag on ANY executor facet fails closed', () => {
  const CASES = [
    ['environ', { readEnviron: () => ({ gone: true, ok: 'true', marker: APPROVAL }) }],
    ['environ unreadable numeric', { readEnviron: () => ({ ok: true, unreadable: 1, marker: null }) }],
    ['cwd', { readCwd: () => ({ gone: true, ok: 'true', cwd: P.repoRoot }) }],
    ['cwd gone stringly', { readCwd: () => ({ ok: true, gone: 'false', cwd: '/x' }) }],
    ['fd', { readFds: () => ({ gone: true, ok: 'true', fds: [P.repoRoot] }) }],
    ['fd ok objectly', { readFds: () => ({ unreadable: true, ok: {}, fds: [] }) }]
  ]
  for (const [name, over] of CASES) {
    const r = verifier(Object.assign({},
      table([{ pid: 4242, uid: UID, status: 'ok', environ: 'ok', cwd: 'ok', fds: 'ok' }]), over)).evaluate(ID)
    assert.strictEqual(r.verdict, VERDICT.UNKNOWN, name)
    assert.strictEqual(r.ok, false, name)
    assert.strictEqual(r.evidence.uninspectablePid, 4242, name)
  }
})

/* ══════════════ X3-D — malformed raw evidence can never reach RETIRED ══════════════ */

test('V39. ⛔ a malformed SECONDARY tag on any single-tag reader is UNKNOWN, never RETIRED', () => {
  // Each of these is an otherwise-perfect clean world with one reader carrying a non-boolean
  // `unreadable`. Before the boundary existed, the tag was simply invisible and the world read
  // as clean — the C2/C3/C4 family, one per reader this time.
  const CASES = [
    ['control group', { readControlGroup: () => ({ exists: false, unreadable: 'true' }) }],
    ['pid list', { listPids: () => ({ pids: [], unreadable: 'true' }) }],
    ['stat', { statPath: () => ({ exists: true, dev: '2096', ino: '126262', unreadable: 'true' }) }],
    ['unit', { readUnit: () => ({ exists: false, successor: false, unreadable: 'true' }) }]
  ]
  for (const [name, over] of CASES) {
    const r = verifier(over).evaluate(ID)
    assert.strictEqual(r.verdict, VERDICT.UNKNOWN, name)
    assert.strictEqual(r.ok, false, name)
    assert.notStrictEqual(r.verdict, VERDICT.RETIRED, name)
    assert.match(r.reason, /does not satisfy its contract/, name)
  }
})

test('V40. ⛔ INHERITED authority fields cannot produce RETIRED', () => {
  // An object built on a prototype carrying the answer would otherwise let a borrowed property
  // decide a retirement. Every authoritative field is read as an OWN property.
  const CASES = [
    ['control group', { readControlGroup: () => Object.create({ exists: false }) }],
    ['pid list', { listPids: () => Object.create({ pids: [] }) }],
    ['stat', { statPath: () => Object.create({ exists: true, dev: '2096', ino: '126262' }) }],
    ['unit', { readUnit: () => Object.create({ exists: false, successor: false }) }],
    ['status', Object.assign({}, table([]), {
      listPids: () => ({ pids: [4242] }),
      readStatus: () => Object.create({ ok: true, uid: 0 })
    })]
  ]
  for (const [name, over] of CASES) {
    const r = verifier(over).evaluate(ID)
    assert.strictEqual(r.verdict, VERDICT.UNKNOWN, name)
    assert.notStrictEqual(r.verdict, VERDICT.RETIRED, name)
  }
})

test('V41. ⛔ the protected gate accepts only a literal boolean', () => {
  for (const [name, v] of [
    ['the string true', 'true'], ['1', 1], ['an object', {}], ['an array', []],
    ['null', null], ['undefined', undefined]
  ]) {
    const r = verifier({ protectedInstancesOk: () => v }).evaluate(ID)
    assert.strictEqual(r.verdict, VERDICT.UNKNOWN, name)
    assert.match(r.reason, /literal boolean/, name)
  }
  // false is a real answer: the gate refuses, and that is LIVE rather than UNKNOWN
  const refused = verifier({ protectedInstancesOk: () => false }).evaluate(ID)
  assert.strictEqual(refused.verdict, VERDICT.LIVE)
})

test('V42. ⛔ the C4 regression still holds through the boundary', () => {
  // status: { gone:true, ok:'true', uid:1000 } — the shape that produced ok:true / RETIRED
  // with a real executor-uid process alive.
  const r = verifier(Object.assign({}, table([]), {
    listPids: () => ({ pids: [93018] }),
    readStatus: () => ({ gone: true, ok: 'true', uid: 1000 })
  })).evaluate(ID)
  assert.strictEqual(r.verdict, VERDICT.UNKNOWN)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.evidence.facet, 'status')
})

test('V43. the verifier reads no raw variant tags of its own', () => {
  // Section 9 of the brief: raw .ok/.gone/.unreadable interpretation belongs to the contract
  // module. What remains in the verifier are reads of CANONICAL parsed values (cg.exists,
  // unit.exists), which the parsers have already validated.
  const src = fs.readFileSync(path.join(__dirname, 'openClawRetirementVerifier.js'), 'utf8')
  const code = src.split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l)).join('\n')
  for (const re of [/\braw\.(ok|gone|unreadable)\b/, /\.unreadable === true/, /\.gone === true/]) {
    assert.ok(!re.test(code), 'the verifier must not interpret raw reader tags: ' + re)
  }
})

/* ══════════════ X3-D2 — authority ownership ══════════════ */

test('V44. ⛔ prototype pollution cannot produce RETIRED through a full evaluation', () => {
  // A live executor-uid process whose raw results carry payloads but NO own variant tag. With
  // Object.prototype.ok = true every one of them used to read as a clean OK.
  try {
    Object.prototype.ok = true
    const r = verifier(Object.assign({}, table([]), {
      listPids: () => ({ pids: [93018] }),
      readStatus: () => ({ uid: UID }),
      readEnviron: () => ({ marker: null }),
      readCwd: () => ({ cwd: '/home/openclaw' }),
      readFds: () => ({ fds: [] })
    })).evaluate(ID)

    assert.strictEqual(r.verdict, VERDICT.UNKNOWN)
    assert.strictEqual(r.ok, false)
    assert.notStrictEqual(r.verdict, VERDICT.RETIRED)
  } finally {
    delete Object.prototype.ok
  }
  assert.strictEqual(Object.prototype.ok, undefined, 'the prototype was restored')
})

test('V45. ⛔ executorUid must be a real uid, refused at construction', () => {
  // Number.isInteger(-1) is true, so -1 was accepted — and then NO process could ever match
  // it, every executor-uid process was classified as unrelated, and a clean-looking RETIRED
  // came back with the executor still running.
  const build = (executorUid) => createOpenClawRetirementVerifier(
    Object.assign({ instances: instances(), executorUid }, world()))

  for (const [name, bad] of [
    ['negative', -1], ['very negative', -1000], ['float', 1.5], ['string', '1000'],
    ['null', null], ['undefined', undefined], ['NaN', NaN], ['Infinity', Infinity],
    ['boolean', true], ['object', {}]
  ]) {
    assert.throws(() => build(bad), TypeError, name)
    assert.throws(() => build(bad), /executorUid to be an integer >= 0/, name)
  }

  assert.doesNotThrow(() => build(0), 'uid 0 is root, and legal')
  assert.doesNotThrow(() => build(1000), 'the ordinary case')

  // omitted entirely -> the default, and the clean world still retires
  const omitted = createOpenClawRetirementVerifier(Object.assign({ instances: instances() }, world()))
  assert.strictEqual(omitted.evaluate(ID).verdict, VERDICT.RETIRED)
})

test('V46. ⛔ a misconfigured uid can never yield RETIRED — it cannot be built at all', () => {
  // The regression this protects: a live uid-1000 executor with executorUid:-1 configured.
  // Before the fix that produced RETIRED; now the verifier does not exist to be asked.
  const live = Object.assign({}, table([
    { pid: 93018, uid: 1000, status: 'ok', environ: 'ok', cwd: 'ok', fds: 'ok', marker: APPROVAL }
  ]))
  assert.throws(
    () => createOpenClawRetirementVerifier(Object.assign({ instances: instances(), executorUid: -1 }, world(live))),
    /executorUid to be an integer >= 0/)

  // and with the uid configured correctly the same world is LIVE, as it must be
  const correct = createOpenClawRetirementVerifier(
    Object.assign({ instances: instances(), executorUid: 1000 }, world(live)))
  assert.strictEqual(correct.evaluate(ID).verdict, VERDICT.LIVE)
})

test('V47. ⛔ the authority predicate requires OWN ok and verdict', () => {
  // The last thing between a refusal and the global lock being released does not get to assume
  // its input came from evaluate().
  assert.strictEqual(isRetirementAuthority({ ok: true, verdict: VERDICT.RETIRED }), true, 'the normal case')

  const bothInherited = Object.create({ ok: true, verdict: VERDICT.RETIRED })
  const ownOk = Object.create({ verdict: VERDICT.RETIRED }); ownOk.ok = true
  const ownVerdict = Object.create({ ok: true }); ownVerdict.verdict = VERDICT.RETIRED

  assert.strictEqual(isRetirementAuthority(bothInherited), false, 'both inherited')
  assert.strictEqual(isRetirementAuthority(ownOk), false, 'own ok, inherited verdict')
  assert.strictEqual(isRetirementAuthority(ownVerdict), false, 'own verdict, inherited ok')

  try {
    Object.prototype.verdict = VERDICT.RETIRED
    assert.strictEqual(isRetirementAuthority({ ok: true }), false, 'verdict via a polluted prototype')
  } finally {
    delete Object.prototype.verdict
  }
  try {
    Object.prototype.ok = true
    assert.strictEqual(isRetirementAuthority({ verdict: VERDICT.RETIRED }), false, 'ok via a polluted prototype')
  } finally {
    delete Object.prototype.ok
  }

  // ⛔ AND IT MUST BE A GENUINE DATA OBJECT, NOT MERELY typeof 'object'.
  // Own properties alone are not enough: an array or a class instance can carry own ok and
  // verdict quite happily. The data-object rule is what refuses them.
  const arr = []; arr.ok = true; arr.verdict = VERDICT.RETIRED
  assert.strictEqual(isRetirementAuthority(arr), false, 'an array with own ok/verdict')

  class Fake { constructor () { this.ok = true; this.verdict = VERDICT.RETIRED } }
  assert.strictEqual(isRetirementAuthority(new Fake()), false, 'a class instance with own ok/verdict')

  const dateish = new Date(); dateish.ok = true; dateish.verdict = VERDICT.RETIRED
  assert.strictEqual(isRetirementAuthority(dateish), false, 'a Date with own ok/verdict')

  // a null-prototype object carrying own fields is legitimate: it inherits nothing at all
  assert.strictEqual(
    isRetirementAuthority(Object.assign(Object.create(null), { ok: true, verdict: VERDICT.RETIRED })),
    true, 'a null-prototype result is still a genuine data object')
})
