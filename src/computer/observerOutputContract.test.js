'use strict'

/**
 * E0-W1 OBSERVER OUTPUT CONTRACT.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE PRODUCER IS PINNED; THE CONTRACT IS WHAT WAS WRONG.
 *
 * `scripts/computer/observer.ps1` is the exact historical blob ac0a39b, pinned by the
 * registered Scheduled Task by SHA-256 and matched byte-for-byte by the staged machine copy.
 * It emits three fields this validator did not declare — `nonBlackRatio`, `measuredBy`,
 * `measuredSid` — so a real, canonical, correct observation was rejected as undeclared.
 *
 * The fix is one-directional: the Node contract aligns to the pinned producer. Editing the
 * producer to fit the schema would break the integrity chain that took three tranches to
 * establish, which is the entire reason it is not touched here.
 *
 * ⛔ AND ALIGNMENT IS NOT ACCEPTANCE. Two of the three fields are IDENTITY STRINGS the
 * producer writes about ITSELF. They are provenance — a note of who the producer believed it
 * was — and nothing more. They are never an approval, never compared against an expected
 * identity, never a session binding. That work is a separate tranche and is NOT done here.
 * The one thing worse than missing session binding is something that looks like it.
 *
 * ⛔ THE THIRD FIELD IS THE OPPOSITE: IT IS EVIDENCE, SO IT IS MANDATORY WHERE IT APPLIES.
 * `nonBlackRatio` is how a capture proves it photographed a screen rather than a black
 * rectangle. A successful capture that carries no ratio is a pass with nothing behind it —
 * the vacuous pass in its purest form — so it is refused at the schema and again at
 * adjudication. The same hole exists on the other action, wearing different clothes: a
 * successful `list_windows` with no count enumerated nothing and said so quietly.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const O = require('./observation')

/**
 * The canonical PowerShell result shape, INCLUDING the fields the producer sets to null when
 * they do not apply — `$result` is one ordered hashtable initialised with every key, so a
 * capture genuinely carries `titles = $null` and `windowCount = $null`.
 *
 * ⛔ THE IDENTITY STRINGS HERE ARE FIXTURES, NOT AUTHORISATION FACTS.
 */
const capture = (over = {}) => Object.assign({
  ok: true,
  action: 'capture_screen',
  refusal: null,
  sessionId: 5,
  windowStation: 'WinSta0',
  desktop: 'Default',
  sessionState: 'Active',
  evidenceSha256: 'a'.repeat(64),
  evidenceBytes: 91234,
  imageWidth: 1920,
  imageHeight: 1080,
  nonBlackRatio: 0.42,
  windowCount: null,
  nodeCount: null,
  nodeReadFailures: null,
  titles: null,
  measuredBy: 'AROMABRAIN\\AromaOperator',
  measuredSid: 'S-1-5-21-example-1009',
  dpiAwareness: 'PerMonitorV2',
  dpiX: 96,
  scalingFactor: 1,
  logicalWidth: 1920,
  logicalHeight: 1080,
  physicalWidth: 1920,
  physicalHeight: 1080,
  primaryScreen: true,
  sentinelScreen: null,
  elapsedMs: 812,
  at: '2026-08-15T00:00:00.0000000-05:00'
}, over)

/** The same producer, the other action: a count, no image, and titles it may or may not release. */
const listWindows = (over = {}) => Object.assign({
  ok: true,
  action: 'list_windows',
  refusal: null,
  sessionId: 5,
  windowStation: 'WinSta0',
  desktop: 'Default',
  sessionState: 'Active',
  evidenceSha256: null,
  evidenceBytes: null,
  imageWidth: null,
  imageHeight: null,
  nonBlackRatio: null,
  windowCount: 12,
  nodeCount: null,
  nodeReadFailures: null,
  titles: null,
  measuredBy: 'AROMABRAIN\\AromaOperator',
  measuredSid: 'S-1-5-21-example-1009',
  dpiAwareness: 'PerMonitorV2',
  dpiX: 96,
  scalingFactor: 1,
  logicalWidth: 1920,
  logicalHeight: 1080,
  physicalWidth: 1920,
  physicalHeight: 1080,
  primaryScreen: true,
  sentinelScreen: null,
  elapsedMs: 44,
  at: '2026-08-15T00:00:00.0000000-05:00'
}, over)

/* ═══ A — the canonical producer is accepted ═══════════════════════════════ */

test('*** ⛔ A CANONICAL CAPTURE FROM THE PINNED PRODUCER VALIDATES ***', () => {
  /**
   * ⛔ THE DEFECT THIS TRANCHE EXISTS FOR. Before it, this exact shape returned
   * `undeclared field(s): nonBlackRatio, measuredBy, measuredSid` — the contract rejecting
   * the very artefact it was written to receive.
   */
  const v = O.validateResult(capture())
  assert.equal(v.ok, true, 'the canonical capture was rejected: ' + JSON.stringify(v.errors))
  assert.deepEqual(v.errors, [])

  const l = O.validateResult(listWindows())
  assert.equal(l.ok, true, 'the canonical list_windows was rejected: ' + JSON.stringify(l.errors))
})

/* ═══ B/C — null is「not applicable」, and it buys nothing ═══════════════════ */

test('*** ⛔ titles:null IS NOT-APPLICABLE, AND A REAL TITLE LIST IS NO EASIER THAN BEFORE ***', () => {
  /**
   * ⛔ THE ONE PLACE THIS COULD HAVE GONE WRONG. Accepting `titles: null` must not become
   * accepting titles. `null` means the producer had no titles to report; every protection
   * Commit D established still applies the moment the field carries anything at all.
   */
  assert.equal(O.validateResult(capture({ titles: null })).ok, true, 'null titles are not a payload')

  // and with no ownSessionId supplied, exactly as before
  const noProof = O.validateResult(listWindows({ titles: ['Inbox'] }))
  assert.equal(noProof.ok, false, '⛔ a real title array passed without session proof')
  assert.match(noProof.errors[0], /ownSessionId/)

  // a foreign session is still a containment failure, not a mismatch to be resolved
  const foreign = O.validateResult(listWindows({ titles: ['Inbox'], sessionId: 9 }), { ownSessionId: 5 })
  assert.equal(foreign.ok, false)
  assert.match(foreign.errors[0], /CONTAINMENT-FAILURE/)

  // still not a free-text string wearing the field name
  const notArray = O.validateResult(listWindows({ titles: 'Inbox - Gmail' }), { ownSessionId: 5 })
  assert.equal(notArray.ok, false)
  assert.match(notArray.errors[0], /array/)

  // and the legitimate case still works
  assert.equal(O.validateResult(listWindows({ titles: ['Inbox'] }), { ownSessionId: 5 }).ok, true)
})

test('*** nonBlackRatio:null IS PERMITTED WHERE IT DOES NOT APPLY ***', () => {
  // A window enumeration has no image to measure; so does a refused capture.
  assert.equal(O.validateResult(listWindows({ nonBlackRatio: null })).ok, true)
  assert.equal(O.validateResult(capture({ ok: false, refusal: 'no_capability_enabled', nonBlackRatio: null })).ok, true)
  // absent entirely is the same claim as null
  const noKey = capture(); delete noKey.nonBlackRatio
  assert.equal(O.validateResult(Object.assign(noKey, { ok: false, refusal: 'no_capability_enabled' })).ok, true)
})

/* ═══ D/E/F — the ratio is evidence, so a success must carry it ════════════ */

test('*** ⛔ A SUCCESSFUL CAPTURE WITH NO RATIO IS REFUSED ***', () => {
  /**
   * ⛔ A PASS WITH NOTHING BEHIND IT. `ok: true` and no measurement is indistinguishable
   * from a capture of a black rectangle — and the difference is the whole point of the
   * field. Refused at the schema, so it cannot reach adjudication looking complete.
   */
  const missing = capture(); delete missing.nonBlackRatio
  const v = O.validateResult(missing)
  assert.equal(v.ok, false, '⛔ a successful capture passed with no ratio at all')
  assert.match(v.errors[0], /nonBlackRatio/)

  const nulled = O.validateResult(capture({ nonBlackRatio: null }))
  assert.equal(nulled.ok, false, '⛔ null passed as a measurement on a successful capture')
  assert.match(nulled.errors[0], /nonBlackRatio/)
})

test('*** ⛔ THE RATIO IS A FINITE NUMBER IN [0,1] — NO COERCION, NO CLAMPING ***', () => {
  // ⛔ '0.42' is the shape a JSON round-trip through a careless layer produces. A string that
  //    looks like a number is not a measurement, and coercing it would invent one.
  for (const bad of ['0.42', NaN, Infinity, -Infinity, -0.01, 1.01, true, {}, []]) {
    const v = O.validateResult(capture({ nonBlackRatio: bad }))
    assert.equal(v.ok, false, '⛔ accepted as a ratio: ' + JSON.stringify(bad))
    assert.match(v.errors[0], /nonBlackRatio/, JSON.stringify(bad))
  }
})

test('*** THE WHOLE VALID RANGE IS SCHEMA-VALID — 0 INCLUDED, AND STILL BLACK AT ADJUDICATION ***', () => {
  /**
   * ⛔ TWO DIFFERENT CLAIMS, KEPT APART. 「no measurement was taken」 and 「a measurement was
   * taken and the screen was black」 are not the same finding and must not share a reason.
   * Zero is a perfectly well-formed measurement; it is the adjudicator, not the schema, that
   * decides it proves nothing.
   */
  for (const good of [0, O.MIN_NON_BLACK_RATIO, 0.42, 1]) {
    assert.equal(O.validateResult(capture({ nonBlackRatio: good })).ok, true, 'rejected: ' + good)
  }

  const context = {
    action: 'capture_screen',
    ownSentinelCreated: true,
    ownerSentinelCreated: true,
    windowCount: 12,
    evidenceBytes: 1024,
    nonBlackRatio: 0,
    sessionState: 'Active',
    timedOut: false,
    permitted: true,
    expectedPermitted: true,
    mechanism: 'PERMITTED',
    sameRoundBaseline: true,
    baselineOwnHits: 0,
    baselineOwnerHits: 0,
    baselineDpiMatchesGate: true
  }
  const black = O.adjudicate(context)
  assert.equal(black.verdict, 'INVALID')
  const ids = black.reasons.map((r) => r.id)
  assert.ok(ids.includes('black-frame'), 'a measured black frame is a black frame: ' + ids.join(', '))
  assert.equal(ids.includes('capture-ratio-missing-or-invalid'), false,
    '⛔ a measured zero was reported as a missing measurement — the two findings must not merge')

  // and the missing case fires the OTHER rule, not this one
  const noRatio = Object.assign({}, context); delete noRatio.nonBlackRatio
  const gone = O.adjudicate(noRatio)
  assert.equal(gone.verdict, 'INVALID')
  const goneIds = gone.reasons.map((r) => r.id)
  assert.ok(goneIds.includes('capture-ratio-missing-or-invalid'), goneIds.join(', '))
  assert.equal(goneIds.includes('black-frame'), false, 'nothing was measured, so nothing was black')

  // NaN is a measurement that failed, not a low one
  const nan = O.adjudicate(Object.assign({}, context, { nonBlackRatio: NaN }))
  assert.ok(nan.reasons.map((r) => r.id).includes('capture-ratio-missing-or-invalid'))
})

/* ═══ 3.7 — the same hole on the other action ══════════════════════════════ */

test('*** ⛔ A SUCCESSFUL list_windows WITH NO COUNT IS THE SAME VACUOUS PASS ***', () => {
  /**
   * ⛔ THE SYMMETRIC RULE. If a capture must show it photographed something, an enumeration
   * must show it enumerated something. `ok: true` with no count says 「I looked」 and refuses
   * to say what it saw.
   */
  const missing = listWindows(); delete missing.windowCount
  const v = O.validateResult(missing)
  assert.equal(v.ok, false, '⛔ a successful enumeration passed with no count')
  assert.match(v.errors[0], /windowCount/)

  assert.equal(O.validateResult(listWindows({ windowCount: null })).ok, false, '⛔ null count accepted')
  for (const bad of ['12', -1, 1.5, NaN, Infinity, true]) {
    const r = O.validateResult(listWindows({ windowCount: bad }))
    assert.equal(r.ok, false, '⛔ accepted as a count: ' + JSON.stringify(bad))
    assert.match(r.errors[0], /windowCount/)
  }

  // zero is a real answer — a desktop with no windows — and must remain expressible
  assert.equal(O.validateResult(listWindows({ windowCount: 0 })).ok, true)

  // ⛔ titles:null WITH a count means「counted, titles not released」— never「nothing measured」
  assert.equal(O.validateResult(listWindows({ windowCount: 3, titles: null })).ok, true)

  // a refused enumeration is not a successful one, so it owes no count
  const refused = listWindows({ ok: false, refusal: 'no_capability_enabled' })
  delete refused.windowCount
  assert.equal(O.validateResult(refused).ok, true)
})

test('*** ⛔ THE MISSING COUNT HAS ITS OWN ADJUDICATION REASON, NOT THE RATIO ONE ***', () => {
  const context = {
    action: 'list_windows',
    ownSentinelCreated: true,
    ownerSentinelCreated: true,
    evidenceBytes: 1024,
    nonBlackRatio: null,
    sessionState: 'Active',
    timedOut: false,
    permitted: true,
    expectedPermitted: true,
    mechanism: 'PERMITTED',
    sameRoundBaseline: true,
    baselineOwnHits: 0,
    baselineOwnerHits: 0,
    baselineDpiMatchesGate: true
  }
  const r = O.adjudicate(context)
  assert.equal(r.verdict, 'INVALID')
  const ids = r.reasons.map((x) => x.id)
  assert.ok(ids.includes('list-count-missing-or-invalid'), ids.join(', '))
  /**
   * ⛔ THE SEPARATION THAT MATTERS IS FROM THE CAPTURE RULE, NOT FROM zero-windows.
   * A missing count also satisfies the long-standing zero-windows predicate, and that overlap
   * is deliberate: this adjudicator reports EVERY rule that fired. Requiring zero-windows to
   * be ABSENT here would have forced a semantic change to an existing rule to satisfy a new
   * test — the tail wagging the dog — so the expectation was withdrawn rather than the rule
   * altered. What must never merge is a missing measurement with a measured one.
   */
  assert.equal(ids.includes('capture-ratio-missing-or-invalid'), false,
    '⛔ a missing window count was reported as a missing capture ratio')

  // a real count of zero is a measurement, and zero-windows is its finding
  const zero = O.adjudicate(Object.assign({}, context, { windowCount: 0 }))
  const zeroIds = zero.reasons.map((x) => x.id)
  assert.ok(zeroIds.includes('zero-windows'), zeroIds.join(', '))
  assert.equal(zeroIds.includes('list-count-missing-or-invalid'), false,
    '⛔ a measured zero was reported as an absent measurement')
})

/* ═══ G — the identity strings are provenance, and only that ═══════════════ */

test('*** ⛔ measuredBy AND measuredSid ARE PROVENANCE — PRESENCE IS NOT AUTHORISATION ***', () => {
  /**
   * ⛔ THE FIELD A READER WILL MISTAKE FOR A SESSION BINDING. `measuredBy` is a string the
   * producer writes about itself; anything that can write the result can write it. So it is
   * shape-checked and NEVER interpreted: a foreign identity validates exactly as the expected
   * one does, because this contract makes no identity claim at all. Independent identity and
   * session binding are a later tranche, and pretending they exist here would be worse than
   * their absence.
   */
  assert.equal(O.validateResult(capture({ measuredBy: 'AROMABRAIN\\SomeoneElse', measuredSid: 'S-1-5-21-other-500' })).ok, true,
    'a different identity still validates — this contract does not adjudicate identity')

  // shape only: present means a non-empty string
  for (const bad of ['', '   ', 5, true, {}, [], null]) {
    const a = O.validateResult(capture({ measuredBy: bad }))
    assert.equal(a.ok, false, '⛔ accepted as measuredBy: ' + JSON.stringify(bad))
    assert.match(a.errors[0], /measuredBy/)
    const b = O.validateResult(capture({ measuredSid: bad }))
    assert.equal(b.ok, false, '⛔ accepted as measuredSid: ' + JSON.stringify(bad))
    assert.match(b.errors[0], /measuredSid/)
  }

  // absent entirely is fine — the in-process stage-1 observer has no Windows identity source
  const anon = capture(); delete anon.measuredBy; delete anon.measuredSid
  assert.equal(O.validateResult(anon).ok, true, 'the in-process observer must not be forced to attest an identity')
})

/* ═══ H/I — the allowlist still fails closed ═══════════════════════════════ */

test('*** ⛔ A FOURTH UNKNOWN FIELD STILL FAILS CLOSED ***', () => {
  // ⛔ Three fields were added deliberately. The mechanism that admitted them must not have
  //    become a door: no wildcard, no metadata bag, no "extra" key.
  const v = O.validateResult(capture({ measuredHost: 'AROMABRAIN' }))
  assert.equal(v.ok, false, '⛔ an undeclared field was admitted alongside the new ones')
  assert.match(v.errors[0], /undeclared field/)
  assert.match(v.errors[0], /measuredHost/)
})

test('*** ⛔ RAW CONTENT IS STILL REFUSED BY NAME ***', () => {
  for (const k of ['imageBytes', 'buffer', 'pixels', 'uiaText', 'nodes']) {
    const v = O.validateResult(capture({ [k]: 'AAAA' }))
    assert.equal(v.ok, false, '⛔ raw content admitted: ' + k)
  }
})

/* ═══ J — the durable boundary moved for one field only ════════════════════ */

test('*** ⛔ THE AUDIT KEEPS THE MEASUREMENT AND REFUSES BOTH IDENTITY STRINGS ***', () => {
  /**
   * ⛔ ONE OF THE THREE IS DURABLE, AND IT IS THE ONE WITH NO PERSON IN IT. The ratio is a
   * number about pixels; `measuredBy` and `measuredSid` name an account, and a durable record
   * of who was measured is a different category of thing from a record of what was measured.
   * Refused, not silently stripped — dropping them quietly would make an audit that lies by
   * omission look like one that was never offered them.
   */
  assert.ok(O.AUDIT_FIELDS.includes('nonBlackRatio'), 'the measurement is durable')
  assert.equal(O.AUDIT_FIELDS.includes('measuredBy'), false, '⛔ an identity string became durable')
  assert.equal(O.AUDIT_FIELDS.includes('measuredSid'), false, '⛔ an identity string became durable')

  const kept = O.buildAuditRecord({ at: 1, action: 'capture_screen', outcome: 'observed', nonBlackRatio: 0.42, evidenceBytes: 91234 })
  assert.equal(kept.ok, true, JSON.stringify(kept.errors))
  assert.equal(kept.record.nonBlackRatio, 0.42, 'the ratio survives into the durable record')

  for (const k of ['measuredBy', 'measuredSid']) {
    const r = O.buildAuditRecord({ at: 1, action: 'capture_screen', [k]: 'AROMABRAIN\\AromaOperator' })
    assert.equal(r.ok, false, '⛔ ' + k + ' entered a durable audit record')
    assert.match(r.errors[0], /undeclared audit field/)
    assert.match(r.errors[0], new RegExp(k))
  }
})

/* ═══ K — and none of this turned anything on ══════════════════════════════ */

test('*** ⛔ A COHERENT SCHEMA IS NOT AN ENABLED CAPABILITY ***', () => {
  // ⛔ This tranche makes the contract able to describe a real observation. It does not make
  //    one possible, and it wires nothing into the runtime.
  assert.deepEqual({ ...O.OBSERVATION_CAPABILITIES }, { list_windows: false, read_uia_tree: false, capture_screen: false })
  assert.equal(O.anyObservationEnabled(), false)

  const observer = O.createObserver()
  const seen = observer.observe({ action: 'capture_screen' })
  assert.equal(seen.ok, false, '⛔ the stage-1 observer returned a result')
  assert.equal(seen.refusal, 'no_capability_enabled')
  // and its own refusal shape still validates, with no identity attested
  assert.equal(O.validateResult(seen).ok, true, JSON.stringify(O.validateResult(seen).errors))
})
