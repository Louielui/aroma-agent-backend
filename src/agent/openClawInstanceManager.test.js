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
    assert.throws(() => m.all(), /instance store is not an object/, name)
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
  assert.deepStrictEqual(rec.envelopeObject, { dev: '2096', ino: '126262' })
  assert.deepStrictEqual(rec.repoObject, { dev: '2096', ino: '126263' })
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
