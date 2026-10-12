'use strict'

/**
 * openClawReaderContracts.test.js — THE BOUNDARY WHERE EXTERNAL EVIDENCE STOPS BEING RAW.
 *
 * Three consecutive review rounds found the same class of defect in field-by-field
 * interpretation of reader results:
 *   C2  {} and {exists:null} read as "the cgroup is absent"
 *   C3  {gone:true, ok:true, uid:1000} read as GONE, skipping a live executor
 *   C4  {gone:true, ok:'true', uid:1000} read as GONE — ok:true / RETIRED with a live process
 *
 * Each table below is a list of shapes that must NOT parse. Behaviour first: these are real
 * calls with real inputs, not a scan for the presence of a validator.
 */

const os = require('os')
const fs = require('fs')
const path = require('path')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-x3d-rc-'))

const test = require('node:test')
const assert = require('node:assert')

const C = require('../agent/openClawReaderContracts')

/** An object whose authority fields are INHERITED, never own. */
const inherited = (props) => Object.create(props)

/* ══════════════ the common object rule ══════════════ */

test('RC1. ⛔ only a genuine data object may speak the contract', () => {
  for (const [name, v] of [
    ['null', null],
    ['undefined', undefined],
    ['a number', 1],
    ['a string', 'ok'],
    ['a boolean', true],
    ['an array', []],
    ['an array of results', [{ ok: true }]],
    ['a function', () => ({ ok: true })],
    ['a Date', new Date()],
    ['a Map', new Map()],
    ['a class instance', new (class { constructor () { this.ok = true } })()]
  ]) {
    assert.strictEqual(C.isDataObject(v), false, name)
  }
  assert.strictEqual(C.isDataObject({}), true, 'an object literal')
  assert.strictEqual(C.isDataObject(Object.create(null)), true, 'a null-prototype object carries nothing')

  // ⛔ AN ARRAY WEARING Object.prototype IS STILL AN ARRAY.
  // The prototype rule alone would admit this one: its proto genuinely IS Object.prototype.
  // Array.isArray is what makes the array check load-bearing rather than redundant.
  const disguised = []
  Object.setPrototypeOf(disguised, Object.prototype)
  assert.strictEqual(Object.getPrototypeOf(disguised), Object.prototype, 'the disguise works')
  assert.strictEqual(C.isDataObject(disguised), false, 'and it is still refused')

  // the same disguise carried into a real parser
  const asStatus = []
  Object.setPrototypeOf(asStatus, Object.prototype)
  asStatus.ok = true
  asStatus.uid = 1000
  assert.strictEqual(C.parseStatusResult(asStatus), null, 'a disguised array cannot answer for a status')
})

test('RC2. ⛔ INHERITED properties are never authority', () => {
  // An object built on a prototype carrying ok:true would otherwise let a borrowed property
  // decide a retirement.
  assert.strictEqual(C.classifyFacet(inherited({ ok: true })), null, 'inherited ok')
  assert.strictEqual(C.classifyFacet(inherited({ gone: true })), null, 'inherited gone')
  assert.strictEqual(C.parseStatusResult(inherited({ ok: true, uid: 1000 })), null, 'inherited status')
  assert.strictEqual(C.parseControlGroupResult(inherited({ exists: false })), null, 'inherited cgroup')
  assert.strictEqual(C.parsePidListResult(inherited({ pids: [] })), null, 'inherited pids')
  assert.strictEqual(C.parseStatResult(inherited({ exists: false })), null, 'inherited stat')
  assert.strictEqual(C.parseUnitResult(inherited({ exists: false, successor: false })), null, 'inherited unit')

  // and a payload inherited onto an otherwise-own tag is still refused
  const halfInherited = Object.create({ uid: 1000 })
  halfInherited.ok = true
  assert.strictEqual(C.parseStatusResult(halfInherited), null, 'own tag, inherited payload')
})

/* ══════════════ the three-variant proc union ══════════════ */

test('RC3. classifyFacet: exactly one boolean tag true', () => {
  const VALID = [
    [{ ok: true }, 'ok'],
    [{ ok: true, gone: false, unreadable: false }, 'ok'],
    [{ gone: true }, 'gone'],
    [{ gone: true, ok: false }, 'gone'],
    [{ unreadable: true }, 'unreadable'],
    [{ unreadable: true, ok: false, gone: false }, 'unreadable']
  ]
  for (const [raw, want] of VALID) assert.strictEqual(C.classifyFacet(raw), want, JSON.stringify(raw))

  const INVALID = [
    ['C3 — gone plus ok', { gone: true, ok: true }],
    ['C4 — ok is the STRING true', { gone: true, ok: 'true' }],
    ['C4 — unreadable is 1', { gone: true, unreadable: 1 }],
    ['C4 — gone is the string false', { ok: true, gone: 'false' }],
    ['C4 — ok is an object', { unreadable: true, ok: {} }],
    ['gone is null', { ok: true, gone: null }],
    ['ok explicitly undefined', { ok: undefined, gone: true }],
    ['all three true', { ok: true, gone: true, unreadable: true }],
    ['no tag at all', {}],
    ['only false tags', { ok: false, gone: false, unreadable: false }],
    ['payload but no tag', { uid: 1000 }],
    ['truthy non-boolean only', { ok: 1 }]
  ]
  for (const [name, raw] of INVALID) assert.strictEqual(C.classifyFacet(raw), null, name)
})

test('RC4. parseStatusResult: uid is an integer >= 0', () => {
  assert.deepStrictEqual(C.parseStatusResult({ ok: true, uid: 0 }), { kind: 'ok', uid: 0 })
  assert.deepStrictEqual(C.parseStatusResult({ ok: true, uid: 1000 }), { kind: 'ok', uid: 1000 })
  assert.deepStrictEqual(C.parseStatusResult({ gone: true }), { kind: 'gone' })
  assert.deepStrictEqual(C.parseStatusResult({ unreadable: true }), { kind: 'unreadable' })

  for (const [name, raw] of [
    ['negative', { ok: true, uid: -1 }],
    ['float', { ok: true, uid: 1.5 }],
    ['string', { ok: true, uid: '1000' }],
    ['null', { ok: true, uid: null }],
    ['NaN', { ok: true, uid: NaN }],
    ['Infinity', { ok: true, uid: Infinity }],
    ['missing', { ok: true }],
    ['C4 fail-open shape', { gone: true, ok: 'true', uid: 1000 }]
  ]) {
    assert.strictEqual(C.parseStatusResult(raw), null, name)
  }
})

test('RC5. parseEnvironResult: marker is a string or null', () => {
  assert.deepStrictEqual(C.parseEnvironResult({ ok: true, marker: null }), { kind: 'ok', marker: null })
  assert.deepStrictEqual(C.parseEnvironResult({ ok: true, marker: 'appr_x' }), { kind: 'ok', marker: 'appr_x' })
  assert.deepStrictEqual(C.parseEnvironResult({ gone: true }), { kind: 'gone' })

  for (const [name, raw] of [
    ['missing marker', { ok: true }],
    ['number', { ok: true, marker: 42 }],
    ['object', { ok: true, marker: {} }],
    ['array', { ok: true, marker: [] }],
    ['undefined marker', { ok: true, marker: undefined }],
    ['contradictory', { gone: true, ok: true, marker: 'x' }]
  ]) {
    assert.strictEqual(C.parseEnvironResult(raw), null, name)
  }
})

test('RC6. parseCwdResult / parseFdsResult: string, and array of strings', () => {
  assert.deepStrictEqual(C.parseCwdResult({ ok: true, cwd: '/x' }), { kind: 'ok', cwd: '/x' })
  assert.deepStrictEqual(C.parseFdsResult({ ok: true, fds: [] }), { kind: 'ok', fds: [] })
  assert.deepStrictEqual(C.parseFdsResult({ ok: true, fds: ['/a', '/b'] }), { kind: 'ok', fds: ['/a', '/b'] })

  for (const [name, raw] of [
    ['cwd missing', { ok: true }],
    ['cwd a number', { ok: true, cwd: 42 }],
    ['cwd null', { ok: true, cwd: null }]
  ]) {
    assert.strictEqual(C.parseCwdResult(raw), null, name)
  }
  for (const [name, raw] of [
    ['fds missing', { ok: true }],
    ['fds a string', { ok: true, fds: '/x' }],
    ['fds with a number', { ok: true, fds: ['/a', 42] }],
    ['fds with null', { ok: true, fds: [null] }],
    ['fds an object', { ok: true, fds: {} }]
  ]) {
    assert.strictEqual(C.parseFdsResult(raw), null, name)
  }

  // the returned array is a copy: a reader cannot mutate what we validated
  const live = ['/a']
  const parsed = C.parseFdsResult({ ok: true, fds: live })
  live.push('/injected')
  assert.deepStrictEqual(parsed.fds, ['/a'], 'the parsed copy is not the caller array')
})

/* ══════════════ control group ══════════════ */

test('RC7. parseControlGroupResult', () => {
  assert.deepStrictEqual(C.parseControlGroupResult({ exists: false }), { kind: 'ok', exists: false })
  assert.deepStrictEqual(C.parseControlGroupResult({ exists: true, procs: [] }), { kind: 'ok', exists: true, procs: [] })
  assert.deepStrictEqual(C.parseControlGroupResult({ exists: true, procs: [7] }), { kind: 'ok', exists: true, procs: [7] })
  assert.deepStrictEqual(C.parseControlGroupResult({ unreadable: true }), { kind: 'unreadable' })
  assert.deepStrictEqual(C.parseControlGroupResult({ exists: false, unreadable: false }), { kind: 'ok', exists: false })

  for (const [name, raw] of [
    ['C2 — empty object', {}],
    ['C2 — exists null', { exists: null }],
    ['exists the string false', { exists: 'false' }],
    ['exists 0', { exists: 0 }],
    ['exists true, no procs', { exists: true }],
    ['exists true, procs not an array', { exists: true, procs: 'x' }],
    ['procs with a zero', { exists: true, procs: [0] }],
    ['procs with a negative', { exists: true, procs: [-1] }],
    ['procs with a string', { exists: true, procs: ['7'] }],
    ['exists false but procs present', { exists: false, procs: [] }],
    ['spec — exists false + unreadable string', { exists: false, unreadable: 'true' }],
    ['spec — exists true + unreadable 1', { exists: true, procs: [], unreadable: 1 }],
    ['spec — unreadable true carrying a payload', { unreadable: true, exists: false }],
    ['procs only', { procs: [] }]
  ]) {
    assert.strictEqual(C.parseControlGroupResult(raw), null, name)
  }
})

/* ══════════════ pid list ══════════════ */

test('RC8. parsePidListResult — no partial filtering', () => {
  assert.deepStrictEqual(C.parsePidListResult({ pids: [] }), { kind: 'ok', pids: [] })
  assert.deepStrictEqual(C.parsePidListResult({ pids: [1, 2] }), { kind: 'ok', pids: [1, 2] })
  assert.deepStrictEqual(C.parsePidListResult({ unreadable: true }), { kind: 'unreadable' })

  for (const [name, raw] of [
    ['spec — pids + unreadable string', { pids: [], unreadable: 'true' }],
    ['spec — a stringly pid', { pids: [1, '2'] }],
    ['spec — unreadable true carrying pids', { unreadable: true, pids: [] }],
    ['missing pids', {}],
    ['pids not an array', { pids: 'x' }],
    ['zero pid', { pids: [0] }],
    ['negative pid', { pids: [-1] }],
    ['float pid', { pids: [1.5] }],
    ['null entry', { pids: [1, null] }]
  ]) {
    assert.strictEqual(C.parsePidListResult(raw), null, name)
  }
})

/* ══════════════ stat ══════════════ */

test('RC9. parseStatResult — canonical strings, never Numbers', () => {
  assert.deepStrictEqual(C.parseStatResult({ exists: false }), { kind: 'ok', exists: false })
  assert.deepStrictEqual(C.parseStatResult({ exists: true, dev: '2096', ino: '126262' }),
    { kind: 'ok', exists: true, dev: '2096', ino: '126262' })
  assert.deepStrictEqual(C.parseStatResult({ exists: true, dev: '0', ino: '9007199254740993' }),
    { kind: 'ok', exists: true, dev: '0', ino: '9007199254740993' })
  assert.deepStrictEqual(C.parseStatResult({ unreadable: true }), { kind: 'unreadable' })

  for (const [name, raw] of [
    ['spec — payload + unreadable string', { exists: true, dev: '2096', ino: '1', unreadable: 'true' }],
    ['spec — exists false + unreadable 1', { exists: false, unreadable: 1 }],
    ['spec — unreadable true carrying a payload', { unreadable: true, exists: true, dev: '1', ino: '1' }],
    ['numeric dev', { exists: true, dev: 2096, ino: '1' }],
    ['numeric ino', { exists: true, dev: '2096', ino: 126262 }],
    ['leading zero', { exists: true, dev: '02096', ino: '1' }],
    ['exponent', { exists: true, dev: '1e3', ino: '1' }],
    ['negative', { exists: true, dev: '-1', ino: '1' }],
    ['missing ino', { exists: true, dev: '1' }],
    ['exists false but dev present', { exists: false, dev: '1' }],
    ['no exists', { dev: '1', ino: '1' }],
    ['exists null', { exists: null }]
  ]) {
    assert.strictEqual(C.parseStatResult(raw), null, name)
  }
})

/* ══════════════ unit ══════════════ */

test('RC10. parseUnitResult — explicit booleans; restart is authority only when it exists', () => {
  const gone = C.parseUnitResult({ exists: false, successor: false, activeState: 'failed', subState: 'failed', result: 'timeout' })
  assert.strictEqual(gone.kind, 'ok')
  assert.strictEqual(gone.exists, false)
  assert.strictEqual(gone.successor, false)
  assert.strictEqual(gone.restart, null, 'an absent unit has no restart authority')
  assert.strictEqual(gone.activeState, 'failed', 'diagnostics carried through untouched')
  assert.strictEqual(gone.result, 'timeout')

  const alive = C.parseUnitResult({ exists: true, successor: false, restart: 'no' })
  assert.strictEqual(alive.restart, 'no')
  assert.strictEqual(C.parseUnitResult({ exists: true, successor: false, restart: 'always' }).restart, 'always')
  assert.deepStrictEqual(C.parseUnitResult({ unreadable: true }), { kind: 'unreadable' })

  // an absent unit may still carry a restart string; it is simply not authority
  assert.strictEqual(C.parseUnitResult({ exists: false, successor: false, restart: 'always' }).restart, null)

  for (const [name, raw] of [
    ['spec — the exact non-retiring case', { exists: false, successor: false, unreadable: 'true' }],
    ['no exists', { successor: false }],
    ['no successor', { exists: false }],
    ['exists null', { exists: null, successor: false }],
    ['successor the string false', { exists: false, successor: 'false' }],
    ['exists true, no restart', { exists: true, successor: false }],
    ['exists true, empty restart', { exists: true, successor: false, restart: '' }],
    ['exists true, restart not a string', { exists: true, successor: false, restart: 1 }],
    ['unreadable true carrying a payload', { unreadable: true, exists: false, successor: false }]
  ]) {
    assert.strictEqual(C.parseUnitResult(raw), null, name)
  }
})

/* ══════════════ the protected gate ══════════════ */

test('RC11. parseProtectedResult — a literal boolean, never truthiness', () => {
  assert.deepStrictEqual(C.parseProtectedResult(true), { kind: 'ok', clean: true })
  assert.deepStrictEqual(C.parseProtectedResult(false), { kind: 'ok', clean: false })

  for (const [name, v] of [
    ['the string true', 'true'],
    ['the string false', 'false'],
    ['1', 1],
    ['0', 0],
    ['an empty object', {}],
    ['an object claiming ok', { ok: true }],
    ['null', null],
    ['undefined', undefined],
    ['an array', []]
  ]) {
    assert.strictEqual(C.parseProtectedResult(v), null, name)
  }
})

/* ══════════════ the whole surface fails closed on junk ══════════════ */

test('RC12. ⛔ every parser refuses every non-object, without exception', () => {
  const PARSERS = [
    'parseStatusResult', 'parseEnvironResult', 'parseCwdResult', 'parseFdsResult',
    'parseControlGroupResult', 'parsePidListResult', 'parseStatResult', 'parseUnitResult'
  ]
  const JUNK = [null, undefined, 0, 1, '', 'ok', true, false, [], [{ ok: true }], new Date()]
  for (const name of PARSERS) {
    for (const raw of JUNK) {
      assert.strictEqual(C[name](raw), null, name + ' <- ' + JSON.stringify(String(raw)))
    }
  }
})

/* ══════════════ X3-D2 — Object.prototype pollution is not authority ══════════════ */

test('RC13. ⛔ an INHERITED variant tag can never claim a variant', () => {
  // Object.prototype is an ALLOWED prototype, so the prototype rule cannot catch this. The
  // type check looked only at own tags while the COUNT read raw[tag] — so with
  // Object.prototype.ok = true, a payload-only object classified as OK and a live
  // executor-uid process could be read as a clean status.
  try {
    Object.prototype.ok = true

    assert.strictEqual(C.classifyFacet({ uid: 1000 }), null, 'classifyFacet')
    assert.strictEqual(C.parseStatusResult({ uid: 1000 }), null, 'status')
    assert.strictEqual(C.parseEnvironResult({ marker: null }), null, 'environ')
    assert.strictEqual(C.parseCwdResult({ cwd: '/x' }), null, 'cwd')
    assert.strictEqual(C.parseFdsResult({ fds: [] }), null, 'fds')

    // an OWN tag still works while the prototype is polluted
    assert.deepStrictEqual(C.parseStatusResult({ ok: true, uid: 1000 }), { kind: 'ok', uid: 1000 })
    // and an own tag that CONTRADICTS the inherited one is still refused
    assert.strictEqual(C.classifyFacet({ gone: true, uid: 1 }), 'gone', 'own gone wins over inherited ok')
  } finally {
    delete Object.prototype.ok
  }
  assert.strictEqual(Object.prototype.ok, undefined, 'the prototype was restored')
})

test('RC14. ⛔ an INHERITED payload can never be authority either', () => {
  // This is why the own(raw,'marker') presence check is load-bearing rather than redundant:
  // without it, raw.marker resolves through Object.prototype and a polluted prototype supplies
  // the instance marker for every process at once.
  try {
    Object.prototype.marker = 'appr_x3b'
    assert.strictEqual(C.parseEnvironResult({ ok: true }), null,
      'a marker that exists only on the prototype is not an answer')
    assert.deepStrictEqual(C.parseEnvironResult({ ok: true, marker: null }), { kind: 'ok', marker: null },
      'an own marker still parses while the prototype is polluted')
  } finally {
    delete Object.prototype.marker
  }

  try {
    Object.prototype.cwd = '/home/openclaw/.aroma/sandboxes/appr_x3b'
    assert.strictEqual(C.parseCwdResult({ ok: true }), null, 'inherited cwd')
  } finally {
    delete Object.prototype.cwd
  }

  try {
    Object.prototype.uid = 1000
    assert.strictEqual(C.parseStatusResult({ ok: true }), null, 'inherited uid')
  } finally {
    delete Object.prototype.uid
  }

  try {
    Object.prototype.exists = false
    assert.strictEqual(C.parseControlGroupResult({}), null, 'inherited cgroup exists')
    assert.strictEqual(C.parseStatResult({}), null, 'inherited stat exists')
  } finally {
    delete Object.prototype.exists
  }
})

/* ══════════════ X3-D3 — evidence must be STABLE DATA, not property access ══════════════ */

/** An object with one own ACCESSOR whose value changes on each read. */
function unstable (base, key, values) {
  const o = Object.assign({}, base)
  let i = 0
  Object.defineProperty(o, key, {
    get () { const v = values[Math.min(i, values.length - 1)]; i++; return v },
    enumerable: true,
    configurable: true
  })
  return o
}

test('RC15. ⛔ stableOwnData refuses ANY own accessor, without invoking it', () => {
  let touched = 0
  const trap = {}
  Object.defineProperty(trap, 'ok', {
    get () { touched++; return true },
    enumerable: true,
    configurable: true
  })
  assert.strictEqual(C.stableOwnData(trap), null, 'an accessor makes the object malformed')
  assert.strictEqual(touched, 0, 'and the getter was NEVER called — descriptors were inspected')

  // a setter-only property is equally malformed
  const setterOnly = {}
  Object.defineProperty(setterOnly, 'ok', { set (v) {}, enumerable: true, configurable: true })
  assert.strictEqual(C.stableOwnData(setterOnly), null, 'setter')

  // ordinary data objects snapshot cleanly, with a null prototype
  const snap = C.stableOwnData({ ok: true, uid: 1000 })
  assert.deepStrictEqual({ ok: snap.ok, uid: snap.uid }, { ok: true, uid: 1000 })
  assert.strictEqual(Object.getPrototypeOf(snap), null, 'the snapshot inherits nothing')
})

test('RC16. ⛔ A — an unstable cgroup unreadable-getter is refused', () => {
  // Reproduced against the committed code: it validated "not unreadable" on the first read and
  // canonicalised { kind:'ok', exists:false } — the cgroup reported ABSENT while the reader was
  // telling us it could not read it.
  const raw = unstable({ exists: false }, 'unreadable', [true, false, false])
  assert.strictEqual(C.parseControlGroupResult(raw), null)
})

test('RC17. ⛔ B — an unstable environ marker-getter is refused', () => {
  // Reproduced: validated as the instance marker string, canonicalised as null — hiding a
  // surviving process that was carrying our marker.
  const raw = unstable({ ok: true }, 'marker', ['appr_x3b', 'appr_x3b', null])
  assert.strictEqual(C.parseEnvironResult(raw), null)
})

test('RC18. ⛔ C — an unstable cwd getter never validates one value and returns another', () => {
  const raw = unstable({ ok: true }, 'cwd', ['/home/openclaw/.aroma/sandboxes/appr_x3b/repo', '/tmp/elsewhere'])
  assert.strictEqual(C.parseCwdResult(raw), null, 'refused outright')
})

test('RC19. ⛔ D — an unstable unit exists-getter is refused', () => {
  // Reproduced: canonicalised the unit as ABSENT and discarded restart:'always'.
  const raw = unstable({ successor: false, restart: 'always' }, 'exists', [true, false, false])
  assert.strictEqual(C.parseUnitResult(raw), null)
})

test('RC20. ⛔ E — unstable stat dev/ino getters are refused', () => {
  const devUnstable = unstable({ exists: true, ino: '126262' }, 'dev', ['2096', '9999'])
  assert.strictEqual(C.parseStatResult(devUnstable), null, 'dev')
  const inoUnstable = unstable({ exists: true, dev: '2096' }, 'ino', ['126262', '9999'])
  assert.strictEqual(C.parseStatResult(inoUnstable), null, 'ino')
  const existsUnstable = unstable({ dev: '2096', ino: '126262' }, 'exists', [true, false])
  assert.strictEqual(C.parseStatResult(existsUnstable), null, 'exists')
})

test('RC21. ⛔ F — an ARRAY with an accessor element is refused, never validate-then-recopy', () => {
  // The array form of the same defect: validate one view, copy another.
  const makeShifty = (good, bad) => {
    const a = []
    let i = 0
    Object.defineProperty(a, 0, {
      get () { const v = i === 0 ? good : bad; i++; return v },
      enumerable: true,
      configurable: true
    })
    a.length = 1
    return a
  }

  assert.strictEqual(C.stableArray(makeShifty(1, 'x')), null, 'stableArray refuses accessor elements')
  assert.strictEqual(C.parsePidListResult({ pids: makeShifty(1, -1) }), null, 'pids')
  assert.strictEqual(C.parseControlGroupResult({ exists: true, procs: makeShifty(1, -1) }), null, 'procs')
  assert.strictEqual(C.parseFdsResult({ ok: true, fds: makeShifty('/a', 42) }), null, 'fds')

  // and an ordinary array is snapshotted: later mutation cannot reach the parsed value
  const live = [7]
  const parsed = C.parsePidListResult({ pids: live })
  live.push(999)
  assert.deepStrictEqual(parsed.pids, [7], 'the parsed array is the validated snapshot')
})

test('RC22. G — ordinary literal reader results still parse identically', () => {
  assert.deepStrictEqual(C.parseStatusResult({ ok: true, uid: 1000 }), { kind: 'ok', uid: 1000 })
  assert.deepStrictEqual(C.parseEnvironResult({ ok: true, marker: null }), { kind: 'ok', marker: null })
  assert.deepStrictEqual(C.parseCwdResult({ ok: true, cwd: '/x' }), { kind: 'ok', cwd: '/x' })
  assert.deepStrictEqual(C.parseFdsResult({ ok: true, fds: ['/a'] }), { kind: 'ok', fds: ['/a'] })
  assert.deepStrictEqual(C.parseControlGroupResult({ exists: false }), { kind: 'ok', exists: false })
  assert.deepStrictEqual(C.parseControlGroupResult({ exists: true, procs: [7] }), { kind: 'ok', exists: true, procs: [7] })
  assert.deepStrictEqual(C.parsePidListResult({ pids: [1, 2] }), { kind: 'ok', pids: [1, 2] })
  assert.deepStrictEqual(C.parseStatResult({ exists: true, dev: '2096', ino: '126262' }),
    { kind: 'ok', exists: true, dev: '2096', ino: '126262' })
  const unit = C.parseUnitResult({ exists: false, successor: false, result: 'timeout' })
  assert.strictEqual(unit.kind, 'ok'); assert.strictEqual(unit.exists, false); assert.strictEqual(unit.result, 'timeout')
  assert.deepStrictEqual(C.parseStatusResult({ gone: true }), { kind: 'gone' })
  assert.deepStrictEqual(C.parseStatusResult({ unreadable: true }), { kind: 'unreadable' })
})

test('RC23. ⛔ a SYMBOL accessor is screened too, not just string keys', () => {
  // A symbol-keyed getter is never copied into the snapshot, so it cannot change a parsed
  // value today — but nothing about the parsers guarantees that stays true, and an object
  // that runs code when looked at is not evidence. It is refused with the rest.
  const withSym = (base, desc) => {
    const o = Object.assign({}, base)
    Object.defineProperty(o, Symbol('probe'), desc)
    return o
  }
  const payload = { ok: true, uid: 1, marker: null, cwd: '/x', fds: [], exists: false, successor: false, pids: [] }

  let touched = 0
  const getter = withSym(payload, { get () { touched++; return 1 }, configurable: true })
  assert.strictEqual(C.parseStatusResult(getter), null, 'getter')
  assert.strictEqual(C.parseEnvironResult(getter), null, 'getter')
  assert.strictEqual(touched, 0, 'and it was never invoked')

  const setter = withSym(payload, { set (v) {}, configurable: true })
  assert.strictEqual(C.parseStatusResult(setter), null, 'setter')

  assert.strictEqual(C.parseStatusResult(withSym({ gone: true }, { get () { return 1 }, configurable: true })), null, 'even a bare gone tag')

  // a symbol DATA property is inert, and is left alone
  const data = withSym(payload, { value: 1, configurable: true })
  assert.deepStrictEqual(C.parseStatusResult(data), { kind: 'ok', uid: 1 })
})

test('RC24. \u26d4 an Array.prototype numeric setter cannot intercept a snapshot', () => {
  // stableArray built its output with out.push(v) — an ordinary assignment, which an
  // inherited numeric setter swallows. Every reader array then came back with the right
  // LENGTH and no own elements, so a real pid list evaporated into holes. Elements are now
  // DEFINED as own data properties, which no inherited setter can intercept.
  let touched = 0
  let pids, procs, fds, snap
  try {
    Object.defineProperty(Array.prototype, 0, {
      set (v) { touched++ },
      get () { return undefined },
      configurable: true
    })
    pids = C.parsePidListResult({ pids: [93018] })
    procs = C.parseControlGroupResult({ exists: true, procs: [93018] })
    fds = C.parseFdsResult({ ok: true, fds: ['/x'] })
    snap = C.stableArray([93018, 4242])
  } finally {
    delete Array.prototype[0]
  }
  assert.strictEqual(Object.getOwnPropertyDescriptor(Array.prototype, 0), undefined, 'Array.prototype restored')
  assert.strictEqual(touched, 0, 'the inherited setter was never invoked')

  assert.ok(pids, 'the pid list still parses')
  assert.ok(Object.prototype.hasOwnProperty.call(pids.pids, 0), 'pids[0] is an OWN element')
  assert.strictEqual(pids.pids[0], 93018)

  assert.ok(Object.prototype.hasOwnProperty.call(procs.procs, 0), 'procs[0] is an OWN element')
  assert.strictEqual(procs.procs[0], 93018)

  assert.ok(Object.prototype.hasOwnProperty.call(fds.fds, 0), 'fds[0] is an OWN element')
  assert.strictEqual(fds.fds[0], '/x')

  assert.deepStrictEqual(snap, [93018, 4242])
  assert.ok(Object.prototype.hasOwnProperty.call(snap, 0) && Object.prototype.hasOwnProperty.call(snap, 1), 'no holes')
})

test('RC25. \u26d4 element validation walks OWN descriptors, never Array.prototype.every', () => {
  // `every` SKIPS holes, so a holed snapshot would validate vacuously; with an inherited
  // numeric property installed it stops skipping and reads the INHERITED value instead.
  // Either answer is about the prototype rather than the measurement.
  const holed = [93018]
  holed.length = 2
  assert.strictEqual(C.parsePidListResult({ pids: holed }), null, 'a hole is a missing measurement')
  assert.strictEqual(C.stableArray(holed), null, 'stableArray refuses it outright')

  // and an inherited element can never fill that hole
  let touched = 0
  try {
    Object.defineProperty(Array.prototype, 1, {
      get () { touched++; return 4242 },
      configurable: true
    })
    assert.strictEqual(C.parsePidListResult({ pids: holed }), null)
    assert.strictEqual(C.parseControlGroupResult({ exists: true, procs: holed }), null)
  } finally {
    delete Array.prototype[1]
  }
  assert.strictEqual(Object.getOwnPropertyDescriptor(Array.prototype, 1), undefined, 'Array.prototype restored')
  assert.strictEqual(touched, 0, 'the inherited getter was never invoked')

  // a fully-populated array is still accepted
  assert.deepStrictEqual(C.parsePidListResult({ pids: [1, 2, 3] }), { kind: 'ok', pids: [1, 2, 3] })
})
