'use strict'

/**
 * openClawInstanceManager.test.js — IDENTITY MUST EXIST BEFORE THE THING IT NAMES.
 *
 * Every assertion is about one of three failures: a process nobody can name; an identity
 * somebody could rewrite after the fact; or a path a caller could choose, which would send the
 * retirement scan looking in the wrong place.
 */

const os = require('os')
const fs = require('fs')
const path = require('path')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-x3b-im-'))

const test = require('node:test')
const assert = require('node:assert')

const {
  createOpenClawInstanceManager, instanceIdFor, unitNameFor, instanceMarkerFor,
  derivedPathsFor, buildInstanceRecord, assertBaselineUnchanged, isCanonicalUint,
  STATES, INSTANCE_ROOT, SANDBOX_ROOT
} = require('../agent/openClawInstanceManager')

const APPROVAL = 'appr_x3b'

/** An isolated in-memory store. No unit test touches a real one. */
function memStore (seed = {}) {
  let data = JSON.parse(JSON.stringify(seed))
  return {
    read: () => JSON.parse(JSON.stringify(data)),
    write: (all) => { data = JSON.parse(JSON.stringify(all)) },
    peek: () => data
  }
}

const mk = (seed) => {
  const store = memStore(seed)
  return { m: createOpenClawInstanceManager({ store, now: () => '2026-09-01T00:00:00.000Z' }), store }
}

/** Measurements only — the spec carries no paths at all any more. */
const SPEC = Object.freeze({
  gatewayPort: 18901,
  envelopeObject: { dev: '2096', ino: '126262' },
  repoObject: { dev: '2096', ino: '126263' }
})

const prepared = () => { const h = mk(); h.m.prepare(APPROVAL, SPEC); return h }

/* ══════════════ identity is derived, never invented ══════════════ */

test('IM1. instanceId IS the approvalId, and every derived name follows from it', () => {
  for (const id of ['a', 'appr_x3b', 'A9-_z', 'a'.repeat(64)]) {
    assert.strictEqual(instanceIdFor(id), id)
    assert.strictEqual(unitNameFor(id), `aroma-oc-${id}.service`)
    assert.strictEqual(instanceMarkerFor(id), id)
  }
})

test('IM1b. ⛔ every security-relevant path is DERIVED from fixed roots', () => {
  assert.strictEqual(INSTANCE_ROOT, '/home/openclaw/.aroma/instances')
  assert.strictEqual(SANDBOX_ROOT, '/home/openclaw/.aroma/sandboxes')
  assert.deepStrictEqual(derivedPathsFor(APPROVAL), {
    stateRoot: '/home/openclaw/.aroma/instances/appr_x3b/state',
    configPath: '/home/openclaw/.aroma/instances/appr_x3b/config/openclaw.json',
    envelopeRoot: '/home/openclaw/.aroma/sandboxes/appr_x3b',
    repoRoot: '/home/openclaw/.aroma/sandboxes/appr_x3b/repo'
  })
})

test('IM1c. ⛔ a caller CANNOT nominate any scanned path', () => {
  // These four strings are exactly what the retirement verifier scans for holders and stats
  // for object identity. A caller able to choose them could aim the scan at an empty directory
  // and still be told RETIRED.
  for (const key of ['stateRoot', 'configPath', 'envelopeRoot', 'repoRoot']) {
    const { m, store } = mk()
    assert.throws(
      () => m.prepare(APPROVAL, Object.assign({}, SPEC, { [key]: '/tmp/somewhere-else' })),
      new RegExp("'" + key + "' is authoritative"), key
    )
    assert.deepStrictEqual(store.peek(), {}, key + ': and nothing was written')
  }

  // and what IS recorded is always the derivation, whatever the caller passed as metadata
  const { m } = mk()
  m.prepare(APPROVAL, SPEC, { note: 'ok' })
  const rec = m.record(APPROVAL)
  const derived = derivedPathsFor(APPROVAL)
  for (const key of ['stateRoot', 'configPath', 'envelopeRoot', 'repoRoot']) {
    assert.strictEqual(rec[key], derived[key], key)
  }
})

test('IM2. ⛔ the durable record exists BEFORE a launch may be attempted', () => {
  const { m, store } = mk()
  assert.throws(() => m.launchAttempted(APPROVAL), /has no instance record/)
  assert.deepStrictEqual(store.peek(), {}, 'and nothing was written by the refusal')

  const rec = m.prepare(APPROVAL, SPEC)
  assert.strictEqual(rec.state, STATES.PREPARED)
  assert.strictEqual(rec.unitName, 'aroma-oc-appr_x3b.service', 'the unit that will later be stopped is known NOW')
  assert.strictEqual(store.peek()[APPROVAL].unitName, rec.unitName, 'and it is durable, not just returned')

  m.launchAttempted(APPROVAL)
  assert.strictEqual(m.record(APPROVAL).state, STATES.LAUNCH_ATTEMPTED)
})

test('IM3. ⛔ an unsafe approvalId is refused before anything is recorded', () => {
  for (const bad of ['', 'a'.repeat(65), 'a b', 'a/b', '../x', 'a.b', null, undefined, 42]) {
    const { m, store } = mk()
    assert.throws(() => m.prepare(bad, SPEC), /unsafe approvalId/, JSON.stringify(String(bad).slice(0, 12)))
    assert.deepStrictEqual(store.peek(), {})
  }
})

test('IM4. ⛔ a second prepare for the same approval is refused, always', () => {
  const { m } = prepared()
  assert.throws(() => m.prepare(APPROVAL, SPEC), /identity is never reused/)
  m.launchAttempted(APPROVAL)
  m.observeControlGroup(APPROVAL, '/user.slice/x/aroma-oc-appr_x3b.service')
  m.requestStop(APPROVAL)
  assert.throws(() => m.prepare(APPROVAL, SPEC), /identity is never reused/, 'even after a stop was requested')
})

test('IM5. a launch may be attempted exactly once', () => {
  const { m } = prepared()
  m.launchAttempted(APPROVAL)
  assert.throws(() => m.launchAttempted(APPROVAL), /a launch may be attempted exactly once/)
})

/* ══════════════ dev/inode identity is exact ══════════════ */

test('IM20. ⛔ dev and ino are canonical decimal STRINGS, never Numbers', () => {
  assert.strictEqual(isCanonicalUint('0'), true)
  assert.strictEqual(isCanonicalUint('2096'), true)
  assert.strictEqual(isCanonicalUint('9007199254740993'), true)
  assert.strictEqual(isCanonicalUint('18446744073709551615'), true)

  for (const bad of [0, 2096, -1, '-1', '', ' 1', '1 ', '01', '1e3', '1.0', '0x10', 'abc', null, undefined, {}, NaN, Infinity]) {
    assert.strictEqual(isCanonicalUint(bad), false, JSON.stringify(String(bad)))
  }

  // and prepare() refuses every one of them
  for (const bad of [{ dev: 2096, ino: '1' }, { dev: '2096', ino: 1 }, { dev: '01', ino: '1' }, { dev: '1', ino: '1.0' }, { dev: '1' }]) {
    const { m, store } = mk()
    assert.throws(() => m.prepare(APPROVAL, Object.assign({}, SPEC, { envelopeObject: bad })),
      /canonical decimal strings/, JSON.stringify(bad))
    assert.deepStrictEqual(store.peek(), {})
  }
})

test('IM21. ⛔ inodes beyond 2^53 stay DISTINCT', () => {
  // As Numbers these two are the same value — which is why they are never Numbers. This is the
  // one check whose entire purpose is exactness.
  const A = '9007199254740992'
  const B = '9007199254740993'
  assert.strictEqual(Number(A) === Number(B), true, 'as Numbers they collapse — the defect being fixed')
  assert.notStrictEqual(A, B, 'as canonical strings they do not')

  const { m } = mk()
  m.prepare(APPROVAL, Object.assign({}, SPEC, { envelopeObject: { dev: '0', ino: A } }))
  assert.strictEqual(m.record(APPROVAL).envelopeObject.ino, A)
  assert.notStrictEqual(m.record(APPROVAL).envelopeObject.ino, B, 'and the stored value is not the neighbour')
})

/* ══════════════ the control group: append-once, measured only ══════════════ */

test('IM6. ⛔ observedControlGroup starts absent and is never predicted', () => {
  const { m } = prepared()
  assert.strictEqual(m.record(APPROVAL).observedControlGroup, null,
    'the path is predictable, which is exactly why it is not recorded before it is measured')
  assert.throws(() => m.observeControlGroup(APPROVAL, '/some/cgroup'), /has not attempted a launch/)
})

test('IM7. ⛔ the control group is append-ONCE', () => {
  const CG = '/user.slice/user-1000.slice/user@1000.service/app.slice/aroma-oc-appr_x3b.service'
  const { m } = prepared()
  m.launchAttempted(APPROVAL)
  m.observeControlGroup(APPROVAL, CG)
  assert.strictEqual(m.record(APPROVAL).observedControlGroup, CG)
  assert.strictEqual(m.record(APPROVAL).state, STATES.OBSERVED)

  assert.doesNotThrow(() => m.observeControlGroup(APPROVAL, CG), 'idempotent for the same value')
  assert.throws(() => m.observeControlGroup(APPROVAL, CG + '-other'), /append-once/)
  assert.strictEqual(m.record(APPROVAL).observedControlGroup, CG)
})

/* ══════════════ observed pids: corroboration, append-only ══════════════ */

test('IM9. observed pids are append-only and de-duplicated', () => {
  const { m } = prepared()
  m.launchAttempted(APPROVAL)
  m.observePids(APPROVAL, [93017, 93018])
  m.observePids(APPROVAL, [93018, 93109])
  m.observePids(APPROVAL, 93017)
  assert.deepStrictEqual(m.record(APPROVAL).observedPids, [93017, 93018, 93109])
  assert.strictEqual(m.record(APPROVAL).mainPid, 93017, 'the first observed pid is the main one')

  // X2-B watched short-lived `sleep` children appear and vanish between samples, so this set
  // can never be complete — it corroborates, and the cgroup stays the boundary.
})

test('IM9b. ⛔ a malformed pid REFUSES the whole observation and writes nothing', () => {
  // Silently filtering junk recorded a PARTIAL observation as though it were complete, and this
  // set is exactly what the verifier later checks for survivors. The entry we dropped is where
  // a survivor would hide.
  for (const junk of [-1, 0, 'x', null, undefined, 1.5, NaN, Infinity, {}, []]) {
    const { m, store } = mk()
    m.prepare(APPROVAL, SPEC)
    m.launchAttempted(APPROVAL)
    m.observePids(APPROVAL, [93017])
    const before = JSON.stringify(store.peek())

    assert.throws(() => m.observePids(APPROVAL, [93018, junk]),
      /positive integer pids/, JSON.stringify(String(junk)))
    assert.strictEqual(JSON.stringify(store.peek()), before,
      JSON.stringify(String(junk)) + ': nothing at all was written')
    assert.deepStrictEqual(m.record(APPROVAL).observedPids, [93017],
      JSON.stringify(String(junk)) + ': not even the good pid in the same call')
  }
})

test('IM10. a record that never launched can have no processes', () => {
  const { m } = prepared()
  assert.throws(() => m.observePids(APPROVAL, [1]), /has not attempted a launch/)
})

/* ══════════════ authority ══════════════ */

test('IM11. ⛔ a caller cannot supply any field this module authors', () => {
  const RESERVED = ['approvalId', 'instanceId', 'unitName', 'instanceMarker', 'state', 'updatedAt',
    'observedControlGroup', 'mainPid', 'observedPids', 'restartPolicy',
    'stateRoot', 'configPath', 'envelopeRoot', 'repoRoot']
  for (const key of RESERVED) {
    const { m, store } = mk()
    assert.throws(() => m.prepare(APPROVAL, SPEC, { [key]: 'forged' }),
      new RegExp("'" + key + "' is authoritative"), key)
    assert.deepStrictEqual(store.peek(), {}, key + ': and nothing was written')
  }
})

test('IM12. the launch contract is recorded by the module, not asserted by the caller', () => {
  const { m } = prepared()
  assert.strictEqual(m.record(APPROVAL).restartPolicy, 'no',
    'the verifier reads Restart=no from the record rather than trusting whoever calls it')
})

test('IM13. ordinary metadata still lands', () => {
  const { m } = mk()
  m.prepare(APPROVAL, SPEC, { note: 'x3b probe' })
  assert.strictEqual(m.record(APPROVAL).note, 'x3b probe')
})

/* ══════════════ the manager cannot claim retirement ══════════════ */

test('IM18. ⛔ there is NO retirement concept in this module at all', () => {
  const { m } = prepared()
  m.launchAttempted(APPROVAL)
  m.observeControlGroup(APPROVAL, '/cg')
  m.requestStop(APPROVAL)

  // STOP_REQUESTED is the last thing this module knows. What happened afterwards is a question
  // only the retirement verifier may answer, from the operating system.
  assert.deepStrictEqual(Object.keys(STATES), ['PREPARED', 'LAUNCH_ATTEMPTED', 'OBSERVED', 'STOP_REQUESTED'])
  assert.strictEqual(STATES.RETIRED, undefined)
  assert.strictEqual(m.record(APPROVAL).state, STATES.STOP_REQUESTED)

  for (const forbidden of ['markRetired', 'retire', 'setRetired', 'isRetired',
    'evaluate', 'verify', 'verifyForQuarantine', 'stop', 'launch']) {
    assert.strictEqual(m[forbidden], undefined, `the manager must not expose ${forbidden}`)
  }
  for (const field of ['retired', 'isRetired', 'retiredAt']) {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(m.record(APPROVAL), field), false,
      `the record must not carry ${field}`)
  }
})

test('IM17. the lifecycle is monotonic through to STOP_REQUESTED', () => {
  const { m } = prepared()
  assert.throws(() => m.requestStop(APPROVAL), /nothing was launched to stop/)
  m.launchAttempted(APPROVAL)
  m.observeControlGroup(APPROVAL, '/cg')
  m.observePids(APPROVAL, [1])
  m.requestStop(APPROVAL)
  assert.strictEqual(m.record(APPROVAL).state, STATES.STOP_REQUESTED)
})

/* ══════════════ the store fails closed ══════════════ */

test('IM14. ⛔ a store we cannot account for is NOT an empty store', () => {
  for (const [name, seed] of [['array', []], ['null', null], ['string', 'abc'], ['number', 123]]) {
    const m = createOpenClawInstanceManager({ store: { read: () => seed, write: () => {} } })
    assert.throws(() => m.all(), /instance store is not a data object/, name)
  }
})

test('IM15. ⛔ a semantically corrupt record fails closed on every read', () => {
  const D = derivedPathsFor(APPROVAL)
  const good = () => ({
    approvalId: APPROVAL, instanceId: APPROVAL, unitName: unitNameFor(APPROVAL),
    instanceMarker: APPROVAL, state: STATES.OBSERVED,
    stateRoot: D.stateRoot, configPath: D.configPath, envelopeRoot: D.envelopeRoot, repoRoot: D.repoRoot,
    envelopeObject: { dev: '2096', ino: '126262' }, repoObject: { dev: '2096', ino: '126263' },
    gatewayPort: 18901, observedPids: [], observedControlGroup: '/cg', restartPolicy: 'no'
  })
  const CORRUPT = [
    ['unsafe key', { 'bad key': good() }],
    ['approvalId mismatch', { [APPROVAL]: Object.assign(good(), { approvalId: 'other' }) }],
    ['non-derived instanceId', { [APPROVAL]: Object.assign(good(), { instanceId: 'other' }) }],
    ['non-derived unitName', { [APPROVAL]: Object.assign(good(), { unitName: 'aroma-oc-other.service' }) }],
    ['non-derived marker', { [APPROVAL]: Object.assign(good(), { instanceMarker: 'other' }) }],
    // ⛔ the F1 fix, enforced on READ as well: a hand-edited path is refused, not obeyed
    ['redirected stateRoot', { [APPROVAL]: Object.assign(good(), { stateRoot: '/tmp/elsewhere' }) }],
    ['redirected configPath', { [APPROVAL]: Object.assign(good(), { configPath: '/tmp/x.json' }) }],
    ['redirected envelopeRoot', { [APPROVAL]: Object.assign(good(), { envelopeRoot: '/tmp/env' }) }],
    ['redirected repoRoot', { [APPROVAL]: Object.assign(good(), { repoRoot: '/tmp/env/repo' }) }],
    ['unknown state', { [APPROVAL]: Object.assign(good(), { state: 'WHATEVER' }) }],
    ['RETIRED is not a state', { [APPROVAL]: Object.assign(good(), { state: 'RETIRED' }) }],
    ['numeric dev', { [APPROVAL]: Object.assign(good(), { envelopeObject: { dev: 2096, ino: '1' } }) }],
    ['numeric ino', { [APPROVAL]: Object.assign(good(), { repoObject: { dev: '1', ino: 126263 } }) }],
    ['non-canonical dev', { [APPROVAL]: Object.assign(good(), { envelopeObject: { dev: '02096', ino: '1' } }) }],
    ['port not an integer', { [APPROVAL]: Object.assign(good(), { gatewayPort: '18901' }) }],
    ['observedPids not an array', { [APPROVAL]: Object.assign(good(), { observedPids: {} }) }],
    ['cgroup on a PREPARED record', { [APPROVAL]: Object.assign(good(), { state: STATES.PREPARED }) }],
    ['record is not an object', { [APPROVAL]: 'nope' }]
  ]
  for (const [name, seed] of CORRUPT) {
    const { m } = mk(seed)
    assert.throws(() => m.all(), /refuse:/, name)
    assert.throws(() => m.record(APPROVAL), /refuse:/, name + ' (via record)')
  }
})

test('IM16. the port is bound to the record, and is NOT a global identity', () => {
  const { m } = prepared()
  assert.strictEqual(m.record(APPROVAL).gatewayPort, 18901)

  // ⛔ A PORT IS A NUMBER THE OS RE-ISSUES. Another approval may legitimately be prepared on
  // the same number later; only the approvalId is never reused.
  const second = mk()
  assert.doesNotThrow(() => second.m.prepare('appr_other', SPEC))
  assert.strictEqual(second.m.record('appr_other').gatewayPort, 18901)
  assert.strictEqual(second.m.record('appr_other').envelopeRoot, '/home/openclaw/.aroma/sandboxes/appr_other',
    'and its paths are its own, derived from its own approvalId')
})

test('IM19. ⛔ the module can reach no operating system at all', () => {
  const src = fs.readFileSync(path.join(__dirname, 'openClawInstanceManager.js'), 'utf8')
  const code = src.split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l)).join('\n')
  for (const re of [/require\s*\(/, /child_process/, /\bspawn\w*\s*\(/, /\bexec\w*\s*\(/, /wsl\.exe/, /systemctl/, /systemd-run/]) {
    assert.ok(!re.test(code), `instance manager must not contain ${re}`)
  }
})

test('IM1d. ⛔ a record that would be refused on READ is never WRITTEN', () => {
  // The second, independent guarantee behind the derivation. A mutant that let the caller
  // spec override the derived paths survived the whole suite, because the reserved-key screen
  // blocked it first — one defence doing the work of two. put() now re-validates what it is
  // about to store, so the derivation is authoritative even if the screen is ever weakened.
  const { m, store } = mk()
  m.prepare(APPROVAL, SPEC)

  // reach past the public API and corrupt the store the way a weakened screen would
  const corrupted = store.read()
  corrupted[APPROVAL].envelopeRoot = '/tmp/elsewhere'
  const raw = {
    read: () => JSON.parse(JSON.stringify(corrupted)),
    write: (d) => { Object.assign(corrupted, d) }
  }
  const m2 = createOpenClawInstanceManager({ store: raw })

  // every path in and out of that store now refuses
  assert.throws(() => m2.record(APPROVAL), /non-derived envelopeRoot/)
  assert.throws(() => m2.launchAttempted(APPROVAL), /non-derived envelopeRoot/)
})

test('IM1e. ⛔ the record builder IGNORES a path-bearing spec, screen or no screen', () => {
  // Reached directly, because prepare() refuses a path-bearing spec long before the builder
  // sees one — so a mutant that merged the spec over the derivation survived the whole suite.
  // The derivation must hold on its own, not only because something upstream said no.
  const forged = Object.assign({}, SPEC, {
    stateRoot: '/tmp/evil/state',
    configPath: '/tmp/evil/openclaw.json',
    envelopeRoot: '/tmp/evil',
    repoRoot: '/tmp/evil/repo',
    unitName: 'aroma-oc-evil.service',
    instanceMarker: 'evil',
    instanceId: 'evil',
    approvalId: 'evil',
    restartPolicy: 'always',
    state: 'RETIRED',
    observedControlGroup: '/tmp/evil/cgroup'
  })
  const rec = buildInstanceRecord(APPROVAL, forged, { note: 'ok' }, 'stamp')
  const derived = derivedPathsFor(APPROVAL)

  for (const key of ['stateRoot', 'configPath', 'envelopeRoot', 'repoRoot']) {
    assert.strictEqual(rec[key], derived[key], key)
  }
  assert.strictEqual(rec.approvalId, APPROVAL)
  assert.strictEqual(rec.instanceId, APPROVAL)
  assert.strictEqual(rec.unitName, 'aroma-oc-appr_x3b.service')
  assert.strictEqual(rec.instanceMarker, APPROVAL)
  assert.strictEqual(rec.restartPolicy, 'no')
  assert.strictEqual(rec.state, STATES.PREPARED)
  assert.strictEqual(rec.observedControlGroup, null)
  assert.strictEqual(rec.note, 'ok', 'ordinary metadata still lands')
})

/* ══════════════ the pre-spawn measurements are immutable ══════════════ */

test('IM22. ⛔ NO mutation method can replace a pre-spawn measurement', () => {
  // The verifier stats the recorded dev/ino to decide whether the workspace in front of it is
  // the one that was prepared. A call able to rewrite that baseline could make ANY directory
  // pass as "the prepared object", which is retirement-by-forgery.
  const FORGED = {
    envelopeObject: { dev: '9', ino: '9' },
    repoObject: { dev: '9', ino: '9' },
    gatewayPort: 22222,
    createdAt: '1999-01-01T00:00:00.000Z'
  }
  const METHODS = [
    ['launchAttempted', (m, meta) => m.launchAttempted(APPROVAL, meta), (m) => {}],
    ['observeControlGroup', (m, meta) => m.observeControlGroup(APPROVAL, '/cg', meta), (m) => m.launchAttempted(APPROVAL)],
    ['observePids', (m, meta) => m.observePids(APPROVAL, [7], meta), (m) => m.launchAttempted(APPROVAL)],
    ['requestStop', (m, meta) => m.requestStop(APPROVAL, meta), (m) => m.launchAttempted(APPROVAL)]
  ]
  for (const [name, call, setup] of METHODS) {
    for (const key of Object.keys(FORGED)) {
      const { m, store } = mk()
      m.prepare(APPROVAL, SPEC)
      setup(m)
      const before = JSON.stringify(store.peek())

      assert.throws(() => call(m, { [key]: FORGED[key] }),
        new RegExp("'" + key + "' is authoritative"), name + ' / ' + key)
      assert.strictEqual(JSON.stringify(store.peek()), before,
        name + ' / ' + key + ': and the record is untouched')
    }
  }
})

test('IM23. ⛔ the baseline is COMPARED, not merely screened', () => {
  // Reached directly: the metadata screen refuses these keys long before the comparison sees
  // them, so the second defence is otherwise untestable — the shape that has now hidden three
  // defects in this project.
  const prev = {
    gatewayPort: 18901,
    envelopeObject: { dev: '2096', ino: '126262' },
    repoObject: { dev: '2096', ino: '126263' },
    createdAt: '2026-09-01T00:00:00.000Z'
  }
  assert.doesNotThrow(() => assertBaselineUnchanged(prev, Object.assign({}, prev, { state: 'OBSERVED' })),
    'an ordinary lifecycle change is fine')

  const CHANGES = [
    ['gatewayPort', { gatewayPort: 18902 }],
    ['envelopeObject dev', { envelopeObject: { dev: '9', ino: '126262' } }],
    ['envelopeObject ino', { envelopeObject: { dev: '2096', ino: '9' } }],
    ['repoObject', { repoObject: { dev: '2096', ino: '9' } }],
    ['createdAt', { createdAt: '1999-01-01T00:00:00.000Z' }],
    ['envelopeObject removed', { envelopeObject: undefined }],
    ['repoObject emptied', { repoObject: {} }]
  ]
  for (const [name, change] of CHANGES) {
    assert.throws(() => assertBaselineUnchanged(prev, Object.assign({}, prev, change)),
      /pre-spawn measurement and can never be changed/, name)
  }
})

test('IM24. the measurements still arrive through the spec, exactly once', () => {
  const { m } = mk()
  m.prepare(APPROVAL, SPEC)
  const rec = m.record(APPROVAL)
  assert.strictEqual(rec.gatewayPort, 18901)
  // null-prototype, like the record snapshot itself: detached authority inherits nothing
  assert.deepStrictEqual({ ...rec.envelopeObject }, { dev: '2096', ino: '126262' })
  assert.deepStrictEqual({ ...rec.repoObject }, { dev: '2096', ino: '126263' })
  assert.strictEqual(Object.getPrototypeOf(rec.envelopeObject), null)
  assert.strictEqual(typeof rec.createdAt, 'string')

  // ...and createdAt is authored here, so it may not be supplied even at prepare time
  const fresh = mk()
  assert.throws(() => fresh.m.prepare(APPROVAL, Object.assign({}, SPEC, { createdAt: 'x' })),
    /'createdAt' is authoritative/)
})

test('IM25. ⛔ the baseline comparison is WIRED INTO the mutation path, not merely defined', () => {
  // A structural assertion, and deliberately so. IM23 proves the comparison WORKS; nothing
  // proves it is CALLED, because the metadata screen refuses every input that would reach it.
  // Deleting the call therefore changes no behaviour any test can observe — the fourth time
  // this project has met that shape. So the wiring itself is asserted.
  const src = fs.readFileSync(path.join(__dirname, 'openClawInstanceManager.js'), 'utf8')
  const body = src.slice(src.indexOf('function mutate ('))
  const end = body.indexOf('\n  }')
  assert.ok(end > 0, 'mutate() was located')
  const mutateBody = body.slice(0, end)

  assert.ok(mutateBody.includes('assertNoReservedKeys(meta)'), 'mutate screens the metadata')
  assert.ok(mutateBody.includes('assertBaselineUnchanged(rec, next)'),
    'mutate compares the pre-spawn baseline before writing')

  // and every post-prepare method goes through mutate rather than writing directly
  for (const fn of ['launchAttempted', 'observeControlGroup', 'observePids', 'requestStop']) {
    const start = src.indexOf('function ' + fn + ' (')
    assert.ok(start > 0, fn + ' exists')
    const section = src.slice(start, src.indexOf('\n  }', start))
    assert.ok(section.includes('mutate(approvalId'), fn + ' writes through mutate()')
    assert.ok(!section.includes('put(approvalId'), fn + ' does not bypass mutate() with a direct put()')
  }
})

/* ══════════════ X3-D3 — store authority must be OWN DATA ══════════════ */

/**
 * ⛔ A RAW STORE, DELIBERATELY.
 * memStore JSON-clones its seed, which STRIPS custom prototypes and accessors — so a
 * prototype/accessor regression written against it would pass without exercising anything.
 * These tests hand back the exact constructed object.
 */
const rawStore = (value) => ({ read: () => value, write: () => {} })

const goodRecord = () => {
  const D = derivedPathsFor(APPROVAL)
  return {
    approvalId: APPROVAL, instanceId: APPROVAL, unitName: unitNameFor(APPROVAL),
    instanceMarker: APPROVAL, state: STATES.OBSERVED,
    stateRoot: D.stateRoot, configPath: D.configPath, envelopeRoot: D.envelopeRoot, repoRoot: D.repoRoot,
    envelopeObject: { dev: '2096', ino: '126262' }, repoObject: { dev: '2096', ino: '126263' },
    gatewayPort: 18901, observedPids: [], observedControlGroup: '/cg', restartPolicy: 'no'
  }
}

test('IM26. ⛔ a record on a CUSTOM prototype is refused, however complete the prototype is', () => {
  // Reproduced against the committed code: every authority field resolved by INHERITANCE while
  // the record owned none of them, and the store accepted it.
  // Refused at the prototype check, before any field is looked at: a record whose prototype is
  // neither Object.prototype nor null is not a record at all.
  const onProto = Object.create(goodRecord())
  const m = createOpenClawInstanceManager({ store: rawStore({ [APPROVAL]: onProto }) })
  assert.throws(() => m.record(APPROVAL), /not a data object/)
  assert.deepStrictEqual(Object.getOwnPropertyNames(onProto), [], 'it owned nothing - every field was inherited')

  class Rec { constructor () { Object.assign(this, goodRecord()) } }
  const asClass = createOpenClawInstanceManager({ store: rawStore({ [APPROVAL]: new Rec() }) })
  assert.throws(() => asClass.record(APPROVAL), /not a data object/)

  const asArray = createOpenClawInstanceManager({ store: rawStore({ [APPROVAL]: [] }) })
  assert.throws(() => asArray.record(APPROVAL), /not a data object/)

  // the store itself must be a data object too
  const storeOnProto = createOpenClawInstanceManager({ store: rawStore(Object.create({ [APPROVAL]: goodRecord() })) })
  assert.throws(() => storeOnProto.all(), /instance store is not a data object/)

  // and a POLLUTED Object.prototype cannot conjure an entry into an empty store
  try {
    Object.prototype[APPROVAL] = goodRecord()
    const empty = createOpenClawInstanceManager({ store: rawStore({}) })
    assert.deepStrictEqual(empty.all(), Object.create(null), 'an inherited entry is not an entry')
  } finally {
    delete Object.prototype[APPROVAL]
  }
  assert.strictEqual(Object.prototype[APPROVAL], undefined, 'prototype restored')
})

test('IM27. ⛔ Object.prototype pollution can never fill a MISSING store field', () => {
  // Reproduced: with observedControlGroup deleted from the record and supplied by the
  // prototype, the store validated and the verifier would have been aimed at a forged cgroup.
  const FIELDS = ['approvalId', 'instanceId', 'unitName', 'instanceMarker', 'state',
    'stateRoot', 'configPath', 'envelopeRoot', 'repoRoot', 'observedControlGroup',
    'envelopeObject', 'repoObject', 'gatewayPort', 'observedPids']

  for (const field of FIELDS) {
    const rec = goodRecord()
    const forged = rec[field]
    delete rec[field]
    try {
      Object.prototype[field] = forged
      const m = createOpenClawInstanceManager({ store: rawStore({ [APPROVAL]: rec }) })
      assert.throws(() => m.record(APPROVAL), /own data property/, field)
    } finally {
      delete Object.prototype[field]
    }
    assert.strictEqual(Object.prototype[field], undefined, field + ': prototype restored')
  }
})

test('IM28. ⛔ an ACCESSOR store field is never authority, and is never invoked', () => {
  let touched = 0
  const rec = goodRecord()
  delete rec.observedControlGroup
  Object.defineProperty(rec, 'observedControlGroup', {
    get () { touched++; return '/forged' },
    enumerable: true,
    configurable: true
  })
  const m = createOpenClawInstanceManager({ store: rawStore({ [APPROVAL]: rec }) })
  assert.throws(() => m.record(APPROVAL), /own data property/)
  assert.strictEqual(touched, 0, 'the getter was never called')
})

test('IM29. ⛔ accessor or inherited dev/ino cannot supply object identity', () => {
  const withAccessorIno = goodRecord()
  withAccessorIno.envelopeObject = {}
  Object.defineProperty(withAccessorIno.envelopeObject, 'dev', { get () { return '2096' }, enumerable: true, configurable: true })
  withAccessorIno.envelopeObject.ino = '126262'
  const m = createOpenClawInstanceManager({ store: rawStore({ [APPROVAL]: withAccessorIno }) })
  assert.throws(() => m.record(APPROVAL), /canonical envelopeObject/)

  const inherited = goodRecord()
  inherited.repoObject = Object.create({ dev: '2096', ino: '126263' })
  const m2 = createOpenClawInstanceManager({ store: rawStore({ [APPROVAL]: inherited }) })
  assert.throws(() => m2.record(APPROVAL), /canonical repoObject/)
})

test('IM30. an ordinary JSON-style record is still accepted', () => {
  const m = createOpenClawInstanceManager({ store: rawStore({ [APPROVAL]: goodRecord() }) })
  const rec = m.record(APPROVAL)
  assert.strictEqual(rec.approvalId, APPROVAL)
  assert.strictEqual(rec.observedControlGroup, '/cg')
  assert.strictEqual(rec.envelopeObject.ino, '126262')
})

test('IM31. ⛔ the store a caller reads back is the VALIDATED SNAPSHOT, not the object we were handed', () => {
  // Reproduced against the X3-D3 working tree: assertStore returned `parsed` itself, still
  // rooted at Object.prototype, and record() reads it as all()[approvalId].
  const A = APPROVAL
  const D = derivedPathsFor(A)
  const forged = {
    approvalId: A, instanceId: A, unitName: unitNameFor(A), instanceMarker: A,
    state: STATES.OBSERVED,
    stateRoot: D.stateRoot, configPath: D.configPath, envelopeRoot: D.envelopeRoot, repoRoot: D.repoRoot,
    envelopeObject: { dev: '1', ino: '1' }, repoObject: { dev: '1', ino: '2' },
    gatewayPort: 1, observedPids: [], observedControlGroup: '/forged/cgroup'
  }

  // (a) READ: a polluted prototype must not become a record. Before the fix this returned the
  // forged record whole, and the verifier would have been aimed at /forged/cgroup.
  const reader = createOpenClawInstanceManager({ store: { read: () => ({}), write: () => {} } })
  try {
    Object.prototype[A] = forged
    assert.strictEqual(reader.record(A), null, 'an inherited key is not a record')
    assert.deepStrictEqual(Object.getOwnPropertyNames(reader.all()), [], 'and the store is empty')
  } finally {
    delete Object.prototype[A]
  }
  assert.strictEqual(Object.prototype[A], undefined, 'prototype restored')

  // (b) WRITE: an inherited SETTER must not swallow the record. Before the fix prepare()
  // reported success while writing {} — losing the record that refuses a second launch.
  let written = null
  const writer = createOpenClawInstanceManager({ store: { read: () => ({}), write: (v) => { written = v } } })
  try {
    Object.defineProperty(Object.prototype, A, { set (v) {}, configurable: true })
    writer.prepare(A, {
      gatewayPort: 1,
      envelopeObject: { dev: '1', ino: '1' },
      repoObject: { dev: '1', ino: '2' }
    })
  } finally {
    delete Object.prototype[A]
  }
  assert.deepStrictEqual(Object.getOwnPropertyNames(written), [A], 'the record was actually written')
  assert.strictEqual(written[A].state, STATES.PREPARED)

  // (c) the container and its records inherit nothing at all
  const store = memStore({ [A]: forged })
  const m = createOpenClawInstanceManager({ store })
  assert.strictEqual(Object.getPrototypeOf(m.all()), null, 'container')
  assert.strictEqual(Object.getPrototypeOf(m.record(A)), null, 'record')
  assert.strictEqual(m.record(A).observedControlGroup, '/forged/cgroup', 'a validated record still reads normally')
})

test('IM32. ⛔ a record field that is inherited or an accessor is refused, authority or not', () => {
  const D = derivedPathsFor(APPROVAL)
  const base = {
    approvalId: APPROVAL, instanceId: APPROVAL, unitName: unitNameFor(APPROVAL), instanceMarker: APPROVAL,
    state: STATES.OBSERVED,
    stateRoot: D.stateRoot, configPath: D.configPath, envelopeRoot: D.envelopeRoot, repoRoot: D.repoRoot,
    envelopeObject: { dev: '1', ino: '1' }, repoObject: { dev: '1', ino: '2' },
    gatewayPort: 1, observedPids: [], observedControlGroup: null
  }
  // 'restartPolicy' is not in RECORD_AUTHORITY, so only the whole-record snapshot catches this.
  const withAccessor = Object.assign({}, base)
  let touched = 0
  Object.defineProperty(withAccessor, 'restartPolicy', {
    get () { touched++; return 'always' },
    enumerable: true,
    configurable: true
  })
  const m = createOpenClawInstanceManager({ store: { read: () => ({ [APPROVAL]: withAccessor }), write: () => {} } })
  assert.throws(() => m.record(APPROVAL), /own data property/)
  assert.strictEqual(touched, 0, 'the getter was never called')

  const withSymbol = Object.assign({}, base)
  withSymbol[Symbol('x')] = 1
  const m2 = createOpenClawInstanceManager({ store: { read: () => ({ [APPROVAL]: withSymbol }), write: () => {} } })
  assert.throws(() => m2.record(APPROVAL), /symbol properties/)
})

test('IM33. ⛔ a NON-ENUMERABLE store entry is still a record, not a hiding place', () => {
  // Object.keys() would not see this. A record that hides is a record that cannot refuse the
  // second launch, so the store must enumerate OWN property names, enumerable or not.
  const D = derivedPathsFor(APPROVAL)
  const rec = {
    approvalId: APPROVAL, instanceId: APPROVAL, unitName: unitNameFor(APPROVAL), instanceMarker: APPROVAL,
    state: STATES.OBSERVED,
    stateRoot: D.stateRoot, configPath: D.configPath, envelopeRoot: D.envelopeRoot, repoRoot: D.repoRoot,
    envelopeObject: { dev: '1', ino: '1' }, repoObject: { dev: '1', ino: '2' },
    gatewayPort: 1, observedPids: [], observedControlGroup: '/cg'
  }
  const hidden = {}
  Object.defineProperty(hidden, APPROVAL, { value: rec, enumerable: false, configurable: true, writable: true })
  assert.deepStrictEqual(Object.keys(hidden), [], 'the entry really is invisible to Object.keys')

  const m = createOpenClawInstanceManager({ store: { read: () => hidden, write: () => {} } })
  assert.strictEqual(m.record(APPROVAL).observedControlGroup, '/cg', 'but the boundary still sees it')
  assert.deepStrictEqual(Object.keys(m.all()), [APPROVAL], 'and the snapshot normalises it to enumerable')

  // and it therefore still refuses a second prepare for that approval
  assert.throws(
    () => m.prepare(APPROVAL, { gatewayPort: 1, envelopeObject: { dev: '1', ino: '1' }, repoObject: { dev: '1', ino: '2' } }),
    /already/i
  )
})

/* ══════════════ X3-D3.1 — the validated snapshot must be DETACHED ══════════════ */

/**
 * ⛔ A STORE THAT RETAINS REFERENCES, DELIBERATELY.
 * memStore JSON-clones, which would hide every aliasing defect in this section. The injected
 * store contract never promised cloning, so these tests hand back the exact object written.
 */
const retainingStore = () => {
  let backing = Object.create(null)
  return { read: () => backing, write: (v) => { backing = v } }
}
const detachManager = () => createOpenClawInstanceManager({ store: retainingStore() })
const detachSpec = () => ({
  gatewayPort: 18901,
  envelopeObject: { dev: '2096', ino: '126262' },
  repoObject: { dev: '2096', ino: '126263' }
})

test('IM34. ⛔ A — mutating prepare()\'s returned identities does not alter the record', () => {
  // Reproduced: the returned envelopeObject WAS the stored one, so this rewrote the identity
  // the retirement verifier later compares dev/ino against.
  const m = detachManager()
  const returned = m.prepare(APPROVAL, detachSpec())
  returned.envelopeObject.dev = '999'
  returned.repoObject.ino = '999'
  returned.observedPids.push(4242)

  const later = m.record(APPROVAL)
  assert.strictEqual(later.envelopeObject.dev, '2096')
  assert.strictEqual(later.repoObject.ino, '126263')
  assert.deepStrictEqual(later.observedPids, [])
})

test('IM35. ⛔ B — mutating observePids()\'s returned array does not lose a pid', () => {
  // Reproduced: `returned.observedPids.length = 0` erased 93018 from the stored record —
  // the survivor list the verifier scans, emptied from outside the manager.
  const m = detachManager()
  m.prepare(APPROVAL, detachSpec())
  m.launchAttempted(APPROVAL)
  const returned = m.observePids(APPROVAL, [93018])
  returned.observedPids.length = 0

  assert.deepStrictEqual(m.record(APPROVAL).observedPids, [93018])
})

test('IM36. ⛔ C — mutating record()\'s nested authority does not alter the next record()', () => {
  const m = detachManager()
  m.prepare(APPROVAL, detachSpec())
  m.launchAttempted(APPROVAL)
  m.observePids(APPROVAL, [93018])

  const r = m.record(APPROVAL)
  r.envelopeObject.dev = '777'
  r.repoObject.ino = '777'
  r.observedPids.push(4242)

  const fresh = m.record(APPROVAL)
  assert.strictEqual(fresh.envelopeObject.dev, '2096')
  assert.strictEqual(fresh.repoObject.ino, '126263')
  assert.deepStrictEqual(fresh.observedPids, [93018])

  // two reads are independent of each other, too
  assert.notStrictEqual(r.envelopeObject, fresh.envelopeObject, 'identities are not shared between reads')
  assert.notStrictEqual(r.observedPids, fresh.observedPids, 'pid arrays are not shared between reads')
})

test('IM37. ⛔ D — mutating all()[approvalId] nested authority does not alter manager state', () => {
  const m = detachManager()
  m.prepare(APPROVAL, detachSpec())
  m.launchAttempted(APPROVAL)
  m.observePids(APPROVAL, [93018])

  const viaAll = m.all()[APPROVAL]
  viaAll.envelopeObject.dev = '555'
  viaAll.repoObject.dev = '555'
  viaAll.observedPids.length = 0
  viaAll.observedControlGroup = '/forged/cgroup'

  const after = m.record(APPROVAL)
  assert.strictEqual(after.envelopeObject.dev, '2096')
  assert.strictEqual(after.repoObject.dev, '2096')
  assert.deepStrictEqual(after.observedPids, [93018])
  assert.strictEqual(after.observedControlGroup, null)
})

test('IM38. ⛔ E — a malformed observedPids array refuses the whole store read', () => {
  const D = derivedPathsFor(APPROVAL)
  const base = () => ({
    approvalId: APPROVAL, instanceId: APPROVAL, unitName: unitNameFor(APPROVAL),
    instanceMarker: APPROVAL, state: STATES.OBSERVED,
    stateRoot: D.stateRoot, configPath: D.configPath, envelopeRoot: D.envelopeRoot, repoRoot: D.repoRoot,
    envelopeObject: { dev: '1', ino: '1' }, repoObject: { dev: '1', ino: '2' },
    gatewayPort: 1, observedPids: [], observedControlGroup: '/cg'
  })

  let touched = 0
  const accessorArr = []
  Object.defineProperty(accessorArr, 0, {
    get () { touched++; return 93018 },
    enumerable: true,
    configurable: true
  })
  accessorArr.length = 1

  const holed = [1]
  holed.length = 3

  const inheritedElement = []
  inheritedElement.length = 1

  const CASES = [
    ['accessor element', accessorArr, /accessor, not a measurement/],
    ['hole', holed, /has a hole at index/],
    ['inherited element (Array.prototype)', inheritedElement, /has a hole at index/],
    ['string', ['93018'], /not a positive integer pid/],
    ['zero', [0], /not a positive integer pid/],
    ['negative', [-1], /not a positive integer pid/],
    ['float', [1.5], /not a positive integer pid/],
    ['null', [null], /not a positive integer pid/],
    ['not an array', {}, /has no observedPids array/]
  ]

  for (const [name, pids, expected] of CASES) {
    const rec = base()
    rec.observedPids = pids
    const m = createOpenClawInstanceManager({ store: { read: () => ({ [APPROVAL]: rec }), write: () => {} } })
    assert.throws(() => m.record(APPROVAL), expected, name)
    assert.throws(() => m.all(), /refuse:/, name)
  }
  assert.strictEqual(touched, 0, 'the accessor was refused without ever being invoked')

  // ⛔ and an inherited element is never quietly promoted into authority
  try {
    Array.prototype[0] = 93018
    const rec = base()
    const arr = []
    arr.length = 1
    rec.observedPids = arr
    const m = createOpenClawInstanceManager({ store: { read: () => ({ [APPROVAL]: rec }), write: () => {} } })
    assert.throws(() => m.record(APPROVAL), /has a hole at index/)
  } finally {
    delete Array.prototype[0]
  }
  assert.strictEqual(Array.prototype[0], undefined, 'Array.prototype restored')
})

test('IM39. F — an ordinary valid record still round-trips through a retaining store', () => {
  const m = detachManager()
  const prepared = m.prepare(APPROVAL, detachSpec())
  assert.strictEqual(prepared.state, STATES.PREPARED)
  assert.strictEqual(prepared.envelopeObject.dev, '2096')

  m.launchAttempted(APPROVAL)
  m.observeControlGroup(APPROVAL, '/user.slice/aroma-openclaw.scope')
  const observed = m.observePids(APPROVAL, [93018, 93017])
  assert.deepStrictEqual(observed.observedPids, [93017, 93018], 'sorted and deduplicated')

  const stopped = m.requestStop(APPROVAL)
  assert.strictEqual(stopped.state, STATES.STOP_REQUESTED)

  const final = m.record(APPROVAL)
  assert.strictEqual(final.observedControlGroup, '/user.slice/aroma-openclaw.scope')
  assert.deepStrictEqual(final.observedPids, [93017, 93018])
  assert.strictEqual(final.envelopeObject.ino, '126262')
  assert.strictEqual(final.repoObject.ino, '126263')
})

test('IM40. ⛔ what put() writes to the store is not what it hands the caller', () => {
  // The returned record must not alias the object given to store.write(), or a caller
  // mutating its own return value rewrites persistent state a second way.
  let written = null
  const m = createOpenClawInstanceManager({
    store: { read: () => (written === null ? Object.create(null) : written), write: (v) => { written = v } }
  })
  const returned = m.prepare(APPROVAL, detachSpec())

  assert.notStrictEqual(returned, written[APPROVAL], 'the record itself is a separate object')
  assert.notStrictEqual(returned.envelopeObject, written[APPROVAL].envelopeObject, 'envelopeObject')
  assert.notStrictEqual(returned.repoObject, written[APPROVAL].repoObject, 'repoObject')
  assert.notStrictEqual(returned.observedPids, written[APPROVAL].observedPids, 'observedPids')

  // and the written record is the CANONICAL one: detached from the caller spec as well
  returned.envelopeObject.dev = '999'
  assert.strictEqual(written[APPROVAL].envelopeObject.dev, '2096')
})

test('IM41. \u26d4 the manager OWNS its copy of the spec: neither the store nor the return value aliases it', () => {
  // The spec carries measurements taken on disk, but the objects carrying them belong to the
  // CALLER. If either the store or the returned record keeps those objects, the caller can
  // rewrite the identity the verifier compares dev/ino against, long after prepare() returned
  // — without touching the manager at all.
  let written = null
  const m = createOpenClawInstanceManager({
    store: {
      read: () => (written === null ? Object.create(null) : written),
      write: (v) => { written = v }
    }
  })

  const env = { dev: '2096', ino: '126262' }
  const repo = { dev: '2096', ino: '126263' }
  const returned = m.prepare(APPROVAL, { gatewayPort: 18901, envelopeObject: env, repoObject: repo })

  assert.notStrictEqual(returned.envelopeObject, env, 'the returned record must not alias the spec')
  assert.notStrictEqual(returned.repoObject, repo, 'the returned record must not alias the spec')
  assert.notStrictEqual(written[APPROVAL].envelopeObject, env, 'the STORE must not alias the spec')
  assert.notStrictEqual(written[APPROVAL].repoObject, repo, 'the STORE must not alias the spec')

  // and the decisive behavioural proof: the caller mutating its OWN spec object afterwards
  // changes nothing the manager will ever hand back.
  env.dev = '999'
  repo.ino = '999'
  assert.strictEqual(m.record(APPROVAL).envelopeObject.dev, '2096')
  assert.strictEqual(m.record(APPROVAL).repoObject.ino, '126263')

  // the same must hold for every later write, not just prepare()
  m.launchAttempted(APPROVAL)
  const observed = m.observePids(APPROVAL, [93018])
  assert.notStrictEqual(observed.observedPids, written[APPROVAL].observedPids, 'observePids return vs store')
  assert.notStrictEqual(observed.envelopeObject, written[APPROVAL].envelopeObject, 'identity: return vs store')
  observed.observedPids.push(4242)
  observed.envelopeObject.dev = '888'
  assert.deepStrictEqual(m.record(APPROVAL).observedPids, [93018])
  assert.strictEqual(m.record(APPROVAL).envelopeObject.dev, '2096')
})

test('IM42. \u26d4 what is PERSISTED is the canonical snapshot, on every write', () => {
  // put() validated the candidate and then wrote it, discarding the canonical form. What
  // landed in the store was Object.prototype-rooted — so a later reader of that store
  // inherits, which is the whole defect class D3 exists to close. The store must receive the
  // same detached, null-prototype form assertStore produces.
  const writes = []
  let backing = Object.create(null)
  const m = createOpenClawInstanceManager({
    store: { read: () => backing, write: (v) => { backing = v; writes.push(v) } }
  })

  m.prepare(APPROVAL, { gatewayPort: 18901, envelopeObject: { dev: '2096', ino: '126262' }, repoObject: { dev: '2096', ino: '126263' } })
  m.launchAttempted(APPROVAL)
  m.observeControlGroup(APPROVAL, '/user.slice/x.scope')
  m.observePids(APPROVAL, [93018])
  m.requestStop(APPROVAL)

  assert.strictEqual(writes.length, 5, 'one write per lifecycle step')
  for (let i = 0; i < writes.length; i++) {
    const w = writes[i]
    assert.strictEqual(Object.getPrototypeOf(w), null, 'write[' + i + '] container inherits nothing')
    assert.strictEqual(Object.getPrototypeOf(w[APPROVAL]), null, 'write[' + i + '] record inherits nothing')
    assert.strictEqual(Object.getPrototypeOf(w[APPROVAL].envelopeObject), null, 'write[' + i + '] envelopeObject')
    assert.strictEqual(Object.getPrototypeOf(w[APPROVAL].repoObject), null, 'write[' + i + '] repoObject')
  }
})

test('IM43. \u26d4 what is RETURNED is canonical too, and shares nothing with the store', () => {
  // The mirror of IM42. A caller handed an Object.prototype-rooted record is a caller whose
  // record can be shaped by pollution it never performed.
  let backing = Object.create(null)
  let written = null
  const m = createOpenClawInstanceManager({
    store: { read: () => backing, write: (v) => { backing = v; written = v } }
  })

  const spec = { gatewayPort: 18901, envelopeObject: { dev: '2096', ino: '126262' }, repoObject: { dev: '2096', ino: '126263' } }
  const returns = []
  returns.push(m.prepare(APPROVAL, spec))
  returns.push(m.launchAttempted(APPROVAL))
  returns.push(m.observeControlGroup(APPROVAL, '/user.slice/x.scope'))
  returns.push(m.observePids(APPROVAL, [93018]))
  returns.push(m.requestStop(APPROVAL))
  returns.push(m.record(APPROVAL))

  for (let i = 0; i < returns.length; i++) {
    const r = returns[i]
    assert.strictEqual(Object.getPrototypeOf(r), null, 'return[' + i + '] record inherits nothing')
    assert.strictEqual(Object.getPrototypeOf(r.envelopeObject), null, 'return[' + i + '] envelopeObject')
    assert.strictEqual(Object.getPrototypeOf(r.repoObject), null, 'return[' + i + '] repoObject')
  }

  // and the last return shares no object at all with what the store is holding
  const last = returns[returns.length - 2]
  assert.notStrictEqual(last, written[APPROVAL], 'record')
  assert.notStrictEqual(last.envelopeObject, written[APPROVAL].envelopeObject, 'envelopeObject')
  assert.notStrictEqual(last.repoObject, written[APPROVAL].repoObject, 'repoObject')
  assert.notStrictEqual(last.observedPids, written[APPROVAL].observedPids, 'observedPids')
})

/* ══════════════ X3-D3.2 — measurements are read ONCE, and arrays are DEFINED ══════════════ */

/** An own ACCESSOR whose value changes after the first read, plus an invocation count. */
const shiftyProp = (obj, key, values) => {
  let i = 0
  const seen = { count: 0 }
  Object.defineProperty(obj, key, {
    get () { seen.count++; const v = values[Math.min(i, values.length - 1)]; i++; return v },
    enumerable: true,
    configurable: true
  })
  return seen
}
const countingStore = () => {
  let backing = Object.create(null)
  const writes = []
  return {
    store: { read: () => backing, write: (v) => { backing = v; writes.push(v) } },
    writes,
    get backing () { return backing }
  }
}

test('IM44. \u26d4 A — a getter on a prepare measurement is refused, and never invoked', () => {
  // Reproduced against D3.1: prepare() validated the FIRST read and buildInstanceRecord took
  // the SECOND, so a getter returning a real identity then a forged one persisted dev 9999 —
  // the identity the retirement verifier later compares against.
  const real = { dev: '2096', ino: '126262' }
  const forged = { dev: '9999', ino: '9999' }

  {
    const h = countingStore()
    const m = createOpenClawInstanceManager({ store: h.store })
    const spec = { gatewayPort: 18901, repoObject: { dev: '2096', ino: '126263' } }
    const seen = shiftyProp(spec, 'envelopeObject', [real, forged, forged])
    assert.throws(() => m.prepare(APPROVAL, spec), /envelopeObject must be an own data property/)
    assert.strictEqual(seen.count, 0, 'the getter was never invoked')
    assert.strictEqual(h.writes.length, 0, 'and nothing was persisted')
  }
  {
    const h = countingStore()
    const m = createOpenClawInstanceManager({ store: h.store })
    const spec = { gatewayPort: 18901, envelopeObject: real }
    const seen = shiftyProp(spec, 'repoObject', [{ dev: '2096', ino: '126263' }, forged, forged])
    assert.throws(() => m.prepare(APPROVAL, spec), /repoObject must be an own data property/)
    assert.strictEqual(seen.count, 0)
    assert.strictEqual(h.writes.length, 0)
  }
  {
    const h = countingStore()
    const m = createOpenClawInstanceManager({ store: h.store })
    const spec = { envelopeObject: real, repoObject: { dev: '2096', ino: '126263' } }
    const seen = shiftyProp(spec, 'gatewayPort', [18901, 31337, 31337])
    assert.throws(() => m.prepare(APPROVAL, spec), /gatewayPort must be an own data property/)
    assert.strictEqual(seen.count, 0)
    assert.strictEqual(h.writes.length, 0)
  }
})

test('IM45. \u26d4 A — an INHERITED or accessor dev/ino on a measurement is refused too', () => {
  const h = countingStore()
  const m = createOpenClawInstanceManager({ store: h.store })

  const inherited = Object.create({ dev: '2096', ino: '126262' })
  assert.throws(
    () => m.prepare(APPROVAL, { gatewayPort: 1, envelopeObject: inherited, repoObject: { dev: '1', ino: '2' } }),
    /canonical decimal strings/
  )

  let touched = 0
  const accessorIno = { dev: '2096' }
  Object.defineProperty(accessorIno, 'ino', { get () { touched++; return '126262' }, enumerable: true, configurable: true })
  assert.throws(
    () => m.prepare(APPROVAL, { gatewayPort: 1, envelopeObject: accessorIno, repoObject: { dev: '1', ino: '2' } }),
    /envelopeObject.ino must be an own data property/
  )
  assert.strictEqual(touched, 0, 'the dev/ino getter was never invoked')
  assert.strictEqual(h.writes.length, 0)
})

test('IM46. A — an ordinary literal spec is unchanged', () => {
  const h = countingStore()
  const m = createOpenClawInstanceManager({ store: h.store })
  const rec = m.prepare(APPROVAL, { gatewayPort: 18901, envelopeObject: { dev: '2096', ino: '126262' }, repoObject: { dev: '2096', ino: '126263' } })
  assert.strictEqual(rec.gatewayPort, 18901)
  assert.strictEqual(rec.envelopeObject.dev, '2096')
  assert.strictEqual(rec.envelopeObject.ino, '126262')
  assert.strictEqual(rec.repoObject.ino, '126263')
  assert.strictEqual(rec.state, STATES.PREPARED)
  assert.strictEqual(h.writes.length, 1, 'exactly one write')
})

test('IM47. \u26d4 B — an accessor pid element is refused before it can be re-read', () => {
  // Reproduced: the element returned 93018 to the validator and 4242 to everything after it,
  // so the record persisted observedPids [4242] / mainPid 4242 — a survivor list built from a
  // value that was never checked.
  const h = countingStore()
  const m = createOpenClawInstanceManager({ store: h.store })
  m.prepare(APPROVAL, { gatewayPort: 18901, envelopeObject: { dev: '2096', ino: '126262' }, repoObject: { dev: '2096', ino: '126263' } })
  m.launchAttempted(APPROVAL)
  const writesBefore = h.writes.length

  const arr = []
  const seen = shiftyProp(arr, 0, [93018, 4242, 4242])
  arr.length = 1

  assert.throws(() => m.observePids(APPROVAL, arr), /accessor, not a measurement/)
  assert.strictEqual(seen.count, 0, 'the getter was never invoked')
  assert.strictEqual(h.writes.length, writesBefore, 'and nothing was persisted')
  assert.deepStrictEqual(m.record(APPROVAL).observedPids, [])
  assert.strictEqual(m.record(APPROVAL).mainPid, null)
})

test('IM48. \u26d4 B — a hole or a bad scalar refuses the whole observation, writing nothing', () => {
  const h = countingStore()
  const m = createOpenClawInstanceManager({ store: h.store })
  m.prepare(APPROVAL, { gatewayPort: 18901, envelopeObject: { dev: '2096', ino: '126262' }, repoObject: { dev: '2096', ino: '126263' } })
  m.launchAttempted(APPROVAL)
  const writesBefore = h.writes.length

  const holed = [93018]
  holed.length = 3
  assert.throws(() => m.observePids(APPROVAL, holed), /hole at index 1/)

  for (const bad of [0, -1, 1.5, '93018', null, undefined]) {
    assert.throws(() => m.observePids(APPROVAL, [bad]), /positive integer pids/, String(bad))
    assert.throws(() => m.observePids(APPROVAL, bad), /positive integer pids/, String(bad) + " (scalar)")
  }

  assert.strictEqual(h.writes.length, writesBefore, 'no refusal ever wrote anything')
  assert.deepStrictEqual(m.record(APPROVAL).observedPids, [])

  // a valid scalar still works
  const ok = m.observePids(APPROVAL, 93018)
  assert.deepStrictEqual(ok.observedPids, [93018])
  assert.strictEqual(ok.mainPid, 93018)
})

test('IM49. \u26d4 C — an Array.prototype numeric setter cannot intercept the pid copy', () => {
  // Reproduced: out.push(pid) is an ordinary assignment, so the inherited setter swallowed it
  // and detachPids produced a length-1 array with NO own index 0. detachPids validates its
  // INPUT, so nothing threw there — put() PERSISTED observedPids [null] and only the second
  // validation, afterwards, rejected it. The store had already kept the malformed record.
  const h = countingStore()
  const m = createOpenClawInstanceManager({ store: h.store })
  m.prepare(APPROVAL, { gatewayPort: 18901, envelopeObject: { dev: '2096', ino: '126262' }, repoObject: { dev: '2096', ino: '126263' } })
  m.launchAttempted(APPROVAL)

  let touched = 0
  try {
    Object.defineProperty(Array.prototype, 0, {
      set (v) { touched++ },
      get () { return undefined },
      configurable: true
    })
    m.observePids(APPROVAL, [93018])
  } finally {
    delete Array.prototype[0]
  }
  assert.strictEqual(Object.getOwnPropertyDescriptor(Array.prototype, 0), undefined, 'Array.prototype restored')
  assert.strictEqual(touched, 0, 'the inherited setter was never invoked')

  const stored = h.backing[APPROVAL].observedPids
  assert.ok(Object.prototype.hasOwnProperty.call(stored, 0), 'the stored pid is an OWN element')
  assert.strictEqual(stored[0], 93018)
  assert.deepStrictEqual(m.record(APPROVAL).observedPids, [93018])
  assert.strictEqual(m.record(APPROVAL).mainPid, 93018)
})

test('IM50. \u26d4 C — NOTHING is persisted until every validation has passed', () => {
  // put() used to write between its two canonical validations, so a canonical snapshot that
  // was itself malformed reached the store and was only rejected afterwards.
  const h = countingStore()
  const m = createOpenClawInstanceManager({ store: h.store })
  const spec = { gatewayPort: 18901, envelopeObject: { dev: '2096', ino: '126262' }, repoObject: { dev: '2096', ino: '126263' } }
  m.prepare(APPROVAL, spec)
  m.launchAttempted(APPROVAL)
  const writesBefore = h.writes.length
  const snapshotBefore = JSON.stringify(m.record(APPROVAL))

  // every refusal path, one after another
  assert.throws(() => m.observePids(APPROVAL, [-1]), /refuse:/)
  assert.throws(() => m.observePids(APPROVAL, [1.5]), /refuse:/)
  assert.throws(() => m.prepare(APPROVAL, spec), /already has an instance record/)
  assert.throws(() => m.observeControlGroup(APPROVAL, 42), /refuse:/)

  assert.strictEqual(h.writes.length, writesBefore, 'not one refusal reached the store')
  assert.strictEqual(JSON.stringify(m.record(APPROVAL)), snapshotBefore, 'and the record is untouched')
})
