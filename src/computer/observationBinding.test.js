'use strict'

/**
 * E0-W1 SESSION / GOVERNANCE BINDING FOUNDATION.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE QUESTION EVERY EARLIER TRANCHE LEFT OPEN.
 *
 * Commit G can end the right process. The output contract can describe a real observation.
 * Neither says WHOSE observation it is or WHO authorised it — so `validateResult()` has been
 * a schema check with nobody's authority behind it, and the Companion has been sending
 * `{ action }` into the dark.
 *
 * The chain this foundation pins:
 *   Owner-approved step → single-use nonce → the exact request → the exact response →
 *   an INDEPENDENTLY supplied expected Windows session → the Observer result → validateResult
 *
 * ⛔ AND THE TWO THINGS IT REFUSES TO PRETEND. It does not verify Owner approval — the
 * approved step is a trusted Service input, and a module that merely LOOKED like it checked
 * approval would be worse than one that admits it does not. It does not discover the session
 * either: no quser, no process list, no 「session 5, because that is what we measured once」,
 * and never the producer's own `measuredSid` as its own authority. The comparison is worth
 * something only because the expected side arrives from somewhere else.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')

const B = require('./observationBinding')
const O = require('./observation')
const { createOrderRegistry } = require('./orderRegistry')
const { createCompanion, CAPABILITIES, anyCapabilityEnabled } = require('./companion')
const { validateEnvelope, ROLE_SERVICE, ROLE_COMPANION } = require('./sessionBoundary')

/** A synthetic account SID. Shaped like the real thing, and belonging to nobody. */
const SID = 'S-1-5-21-1111111111-2222222222-3333333333-1009'
const OTHER_SID = 'S-1-5-21-1111111111-2222222222-3333333333-1500'
const APPROVAL = 'appr_bind_0001'
/**
 * ⛔ SEVEN, NOT FIVE. The historical measurement found the operator in session 5; that is
 * evidence from one morning, not a constant. Every fixture here uses a different number so a
 * hard-coded 5 anywhere would fail rather than quietly agree.
 */
const SESSION = 7

const expected = (over = {}) => Object.assign({
  expectedSid: SID,
  sessionId: SESSION,
  windowStation: 'WinSta0',
  desktop: 'Default',
  proofId: 'proof-0001'
}, over)

/** A live registry holding one approved order with three steps. */
function authority () {
  const r = createOrderRegistry({ now: () => 1_000_000 })
  const a = r.admit({ approvalId: APPROVAL, workOrderHash: 'hash-abc', stepCount: 3, timeoutSec: 600 })
  assert.equal(a.ok, true, 'the fixture order must be admitted: ' + JSON.stringify(a))
  return { registry: r, nonces: a.stepNonces }
}

const approvedStep = (nonce, over = {}) => Object.assign({
  approvalId: APPROVAL,
  stepIndex: 0,
  stepNonce: nonce,
  action: 'list_windows',
  workOrderHash: 'hash-abc'
}, over)

const request = (nonce, over = {}) => Object.assign({
  approvalId: APPROVAL,
  stepIndex: 0,
  stepNonce: nonce,
  action: 'list_windows'
}, over)

/** A canonical successful observation, as it would arrive over IPC. */
const response = (nonce, over = {}) => Object.assign({
  from: ROLE_COMPANION,
  to: ROLE_SERVICE,
  type: 'step_result',
  approvalId: APPROVAL,
  stepIndex: 0,
  stepNonce: nonce,
  ok: true,
  action: 'list_windows',
  refusal: null,
  sessionId: SESSION,
  windowStation: 'WinSta0',
  desktop: 'Default',
  sessionState: 'Active',
  windowCount: 12,
  titles: null,
  nonBlackRatio: null,
  measuredBy: 'AROMABRAIN\\AromaOperator',
  measuredSid: SID,
  at: '2026-08-15T00:00:00.0000000-05:00'
}, over)

/** prepare() with everything valid, returning the binding and the live registry. */
function authorised (over = {}) {
  const { registry, nonces } = authority()
  const n = nonces[0]
  const p = B.createObservationBinding({ registry })
  const r = p.prepare(Object.assign({
    approvedStep: approvedStep(n),
    request: request(n),
    expectedSession: expected()
  }, over))
  return { binder: p, registry, nonce: n, nonces, prep: r }
}

/* ═══ IPC CORRELATION — the repair in companion.js ═════════════════════════ */

test('*** ⛔ EVERY COMPANION RESPONSE ECHOES THE EXACT REQUEST NONCE ***', () => {
  /**
   * ⛔ WITHOUT THIS, SINGLE-USE PROTECTION STOPPED AT THE DOOR. Requests carried a nonce and
   * responses did not, so a reply could be correlated only by (approvalId, stepIndex) — the
   * same pair a replayed or stale response carries. 「The answer to THIS request」 and 「an
   * answer to that step」 were indistinguishable.
   */
  const c = createCompanion({ now: () => 1 })
  const n = crypto.randomBytes(16).toString('hex')
  const base = { from: ROLE_SERVICE, to: ROLE_COMPANION, approvalId: APPROVAL, stepIndex: 0, stepNonce: n }

  const ping = c.handle(Object.assign({}, base, { type: 'ping' }))
  assert.equal(ping.type, 'pong')
  assert.equal(ping.stepNonce, n, '⛔ pong did not echo the nonce')
  assert.equal(validateEnvelope(ping).ok, true, JSON.stringify(validateEnvelope(ping).errors))

  const step = c.handle(Object.assign({}, base, { type: 'execute_step', step: { action: 'list_windows' } }))
  assert.equal(step.type, 'step_result')
  assert.equal(step.stepNonce, n, '⛔ step_result did not echo the nonce')
  assert.equal(validateEnvelope(step).ok, true, JSON.stringify(validateEnvelope(step).errors))

  const stopped = c.handle(Object.assign({}, base, { type: 'abort' }))
  assert.equal(stopped.type, 'aborted')
  assert.equal(stopped.stepNonce, n, '⛔ aborted did not echo the nonce')
  assert.equal(validateEnvelope(stopped).ok, true, JSON.stringify(validateEnvelope(stopped).errors))
})

test('*** ⛔ THE NONCE IS COPIED, NEVER MANUFACTURED ***', () => {
  // ⛔ A Companion able to invent a correlation token is a Companion able to answer a request
  //    nobody made. A request with no nonce must not produce a reply that looks correlated.
  const c = createCompanion({ now: () => 1 })
  const reply = c.handle({ from: ROLE_SERVICE, to: ROLE_COMPANION, type: 'execute_step', approvalId: APPROVAL, stepIndex: 0 })
  assert.equal(reply.stepNonce, undefined, '⛔ a nonce was invented for a request that had none')
  assert.equal(validateEnvelope(reply).ok, false, 'and such a reply cannot pass the envelope check')
})

/* ═══ APPROVED-STEP BINDING ════════════════════════════════════════════════ */

test('*** ⛔ AN APPROVAL FOR list_windows DOES NOT AUTHORISE A SCREENSHOT ***', () => {
  /**
   * ⛔ THE SUBSTITUTION. A valid approvalId and a live, unspent nonce prove the Owner approved
   * A step. They say nothing about WHICH action — so without the comparison, approval for a
   * window list authorises a capture of the screen.
   */
  const { registry, nonces } = authority()
  const b = B.createObservationBinding({ registry })
  const r = b.prepare({
    approvedStep: approvedStep(nonces[0]),
    request: request(nonces[0], { action: 'capture_screen' }),
    expectedSession: expected()
  })
  assert.equal(r.ok, false, '⛔ an action substitution was authorised')
  assert.equal(r.reason, 'action-mismatch')

  // ⛔ and the nonce is still unspent, because nothing legitimate was ever presented
  const after = registry.consumeStep({ approvalId: APPROVAL, stepIndex: 0, stepNonce: nonces[0] })
  assert.equal(after.ok, true, 'a refused substitution must not spend the Owner approved step')
})

test('*** ⛔ THE REQUEST MUST MATCH THE APPROVED STEP FIELD FOR FIELD ***', () => {
  const cases = [
    ['approvalId-mismatch', { approvalId: 'appr_other' }],
    ['stepIndex-mismatch', { stepIndex: 1 }],
    ['stepNonce-mismatch', { stepNonce: 'x'.repeat(32) }]
  ]
  for (const [reason, over] of cases) {
    const { registry, nonces } = authority()
    const b = B.createObservationBinding({ registry })
    const r = b.prepare({ approvedStep: approvedStep(nonces[0]), request: request(nonces[0], over), expectedSession: expected() })
    assert.equal(r.ok, false, reason)
    assert.equal(r.reason, reason)
  }

  // no approved step at all, and a non-observation action
  const { registry, nonces } = authority()
  const b = B.createObservationBinding({ registry })
  assert.equal(b.prepare({ request: request(nonces[0]), expectedSession: expected() }).reason, 'approved-step-missing')
  const gated = b.prepare({
    approvedStep: approvedStep(nonces[0], { action: 'open_app' }),
    request: request(nonces[0], { action: 'open_app' }),
    expectedSession: expected()
  })
  assert.equal(gated.reason, 'action-not-observation', '⛔ a gated action was treated as an observation')
})

/* ═══ SINGLE-USE NONCE, AND THE 6A ORDERING DECISION ═══════════════════════ */

test('*** A VALID STEP AUTHORISES ONCE ***', () => {
  const { prep } = authorised()
  assert.equal(prep.ok, true, JSON.stringify(prep))
  assert.equal(prep.verdict, 'AUTHORISED')
  assert.equal(prep.action, 'list_windows')
  assert.equal(prep.proofId, 'proof-0001')
  assert.ok(typeof prep.bindingId === 'string' && prep.bindingId.length > 0)
})

test('*** ⛔ REPLAY, WRONG STEP AND WRONG APPROVAL ARE ALL REFUSED ***', () => {
  const { binder, registry, nonce, nonces } = authorised()

  const replay = binder.prepare({ approvedStep: approvedStep(nonce), request: request(nonce), expectedSession: expected() })
  assert.equal(replay.ok, false, '⛔ the same nonce authorised twice')
  assert.match(replay.reason, /nonce-refused/)

  // a nonce belonging to another step, presented for step 0
  const wrongStep = binder.prepare({
    approvedStep: approvedStep(nonces[1]),
    request: request(nonces[1]),
    expectedSession: expected()
  })
  assert.equal(wrongStep.ok, false, '⛔ a nonce from another step authorised step 0')

  // a nonce presented under another approval id
  const other = binder.prepare({
    approvedStep: approvedStep(nonces[2], { approvalId: 'appr_other' }),
    request: request(nonces[2], { approvalId: 'appr_other' }),
    expectedSession: expected()
  })
  assert.equal(other.ok, false, '⛔ a nonce authorised under a different approval')
  assert.ok(registry.isLive(APPROVAL), 'the original order is untouched by these attempts')
})

test('*** ⛔ 6A — THE BURN HAPPENS LAST, AND A BURNT STEP IS DEAD ***', () => {
  /**
   * ⛔ THE DECISION, RECORDED. The nonce is consumed only after every pre-dispatch check has
   * passed. Burning on first sight would turn any Service-side bug — a malformed proof object,
   * a typo in a field — into a permanent denial of the Owner's own decision: an approved step
   * spent without ever being dispatched, requiring fresh approval because of a defect on our
   * side. A refusal that never reached dispatch is not a USE of the authorisation.
   *
   * ⛔ AND THE OTHER HALF, WHICH IS NOT A LOOPHOLE. Once consumed, the step is dead — whatever
   * happens next. There is no retry path after the burn, and nothing below it can fail.
   */
  const { registry, nonces } = authority()
  const b = B.createObservationBinding({ registry })

  // a malformed expected session fails AFTER the request matched — and must not spend it
  const bad = b.prepare({
    approvedStep: approvedStep(nonces[0]),
    request: request(nonces[0]),
    expectedSession: expected({ expectedSid: 'not-a-sid' })
  })
  assert.equal(bad.ok, false)
  assert.match(bad.reason, /expected-session-malformed/)

  // ⛔ the Owner's step survived our own bug, and the corrected attempt works
  const good = b.prepare({ approvedStep: approvedStep(nonces[0]), request: request(nonces[0]), expectedSession: expected() })
  assert.equal(good.ok, true, '⛔ a Service-side defect permanently destroyed an approved step')

  // and now it is spent, permanently, with no second attempt available
  const again = b.prepare({ approvedStep: approvedStep(nonces[0]), request: request(nonces[0]), expectedSession: expected() })
  assert.equal(again.ok, false, '⛔ a spent step was authorised a second time')
  assert.match(again.reason, /nonce-refused/)
})

/* ═══ EXPECTED SESSION — injected, never discovered ════════════════════════ */

test('*** ⛔ WITHOUT AN INDEPENDENT SESSION PROOF NOTHING IS AUTHORISED ***', () => {
  const cases = [
    ['expected-session-missing', undefined],
    ['expected-session-missing', null],
    ['expected-session-malformed:sid', expected({ expectedSid: 'AROMABRAIN\\AromaOperator' })],
    ['expected-session-malformed:sid', expected({ expectedSid: '' })],
    ['expected-session-malformed:sessionId', expected({ sessionId: -1 })],
    ['expected-session-malformed:sessionId', expected({ sessionId: '7' })],
    ['expected-session-malformed:sessionId', expected({ sessionId: 1.5 })],
    ['expected-session-malformed:windowStation', expected({ windowStation: 'Service-0x0-3e7$' })],
    ['expected-session-malformed:desktop', expected({ desktop: 'Winlogon' })]
  ]
  for (const [reason, session] of cases) {
    const { registry, nonces } = authority()
    const b = B.createObservationBinding({ registry })
    const r = b.prepare({ approvedStep: approvedStep(nonces[0]), request: request(nonces[0]), expectedSession: session })
    assert.equal(r.ok, false, reason + ' must refuse')
    assert.equal(r.reason, reason)
  }
})

test('*** SESSION 5 IS NOT HARD-CODED ANYWHERE ***', () => {
  // ⛔ The historical measurement is evidence, not authority. The whole suite runs on 7, and
  //    an arbitrary session proves it is the injected number that is honoured.
  const { registry, nonces } = authority()
  const b = B.createObservationBinding({ registry })
  const p = b.prepare({
    approvedStep: approvedStep(nonces[0]),
    request: request(nonces[0]),
    expectedSession: expected({ sessionId: 41 })
  })
  assert.equal(p.ok, true)
  const v = b.verifyResult(p.bindingId, response(nonces[0], { sessionId: 41 }))
  assert.equal(v.verdict, 'OBSERVED_AND_BOUND', JSON.stringify(v))
})

/* ═══ RESULT CORRELATION ═══════════════════════════════════════════════════ */

test('*** AN EXACTLY CORRELATED RESULT IN THE PROVEN SESSION IS BOUND ***', () => {
  const { binder, nonce, prep } = authorised()
  const v = binder.verifyResult(prep.bindingId, response(nonce))
  assert.equal(v.ok, true, JSON.stringify(v))
  assert.equal(v.verdict, 'OBSERVED_AND_BOUND')
  assert.equal(v.sessionMatched, true)
  assert.equal(v.sidMatched, true)
  assert.equal(v.windowStationMatched, true)
  assert.equal(v.desktopMatched, true)
  assert.equal(v.action, 'list_windows')
  assert.equal(v.proofId, 'proof-0001')
  // ⛔ and it carries no identity strings out with it
  assert.equal('expectedSid' in v, false, '⛔ an expected SID left the module')
  assert.equal('measuredSid' in v, false, '⛔ a measured SID left the module')
})

test('*** ⛔ A RESPONSE THAT IS NOT THE ANSWER TO THIS REQUEST IS REFUSED ***', () => {
  const cases = [
    ['approvalId-mismatch', { approvalId: 'appr_other' }],
    ['stepIndex-mismatch', { stepIndex: 2 }],
    ['stepNonce-mismatch', { stepNonce: 'y'.repeat(32) }],
    ['stepNonce-missing', { stepNonce: undefined }],
    ['not-from-companion', { from: ROLE_SERVICE }],
    ['not-to-service', { to: ROLE_COMPANION }],
    ['wrong-type', { type: 'pong' }]
  ]
  for (const [reason, over] of cases) {
    const { binder, nonce, prep } = authorised()
    const v = binder.verifyResult(prep.bindingId, response(nonce, over))
    assert.equal(v.ok, false, reason + ' must refuse')
    assert.equal(v.reason, reason)
  }
})

test('*** ⛔ A VALID NONCE BELONGING TO A DIFFERENT PREPARED REQUEST IS REFUSED ***', () => {
  // ⛔ Both nonces are real, live and correctly issued. The only thing wrong is that this
  //    answer belongs to the other question.
  const { registry, nonces } = authority()
  const b = B.createObservationBinding({ registry })
  const first = b.prepare({ approvedStep: approvedStep(nonces[0]), request: request(nonces[0]), expectedSession: expected() })
  const second = b.prepare({
    approvedStep: approvedStep(nonces[1], { stepIndex: 1 }),
    request: request(nonces[1], { stepIndex: 1 }),
    expectedSession: expected()
  })
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)

  const v = b.verifyResult(first.bindingId, response(nonces[1], { stepIndex: 1 }))
  assert.equal(v.ok, false, '⛔ a response for another prepared request was accepted')
})

test('*** ⛔ 8A — ONE PREPARED STEP ACCEPTS EXACTLY ONE RESULT ***', () => {
  /**
   * ⛔ SINGLE-USE ON THE WAY OUT AND UNLIMITED ON THE WAY BACK IS NOT SINGLE-USE. Without
   * this, one authorisation could be satisfied twice by replaying a byte-identical response —
   * the request nonce is spent, but the acceptance was not.
   */
  const { binder, nonce, prep } = authorised()
  const first = binder.verifyResult(prep.bindingId, response(nonce))
  assert.equal(first.verdict, 'OBSERVED_AND_BOUND')

  const again = binder.verifyResult(prep.bindingId, response(nonce))
  assert.equal(again.ok, false, '⛔ one authorisation was satisfied twice')
  assert.equal(again.reason, 'binding-already-verified')
})

/* ═══ IDENTITY BINDING ═════════════════════════════════════════════════════ */

test('*** ⛔ EVERY IDENTITY DIFFERENCE IS A BINDING FAILURE, NOT AN ORDINARY REFUSAL ***', () => {
  /**
   * ⛔ AND THIS IS THE ONLY REASON `measuredSid` IS WORTH ANYTHING. On its own it is a string
   * the producer wrote about itself. Compared against a SID that arrived independently, it
   * becomes a claim that can be wrong — and a difference means the thing that answered is not
   * the thing we authorised.
   */
  const cases = [
    ['action-mismatch', { action: 'capture_screen', windowCount: null, nonBlackRatio: 0.42 }],
    ['session-id-mismatch', { sessionId: SESSION + 1 }],
    ['sid-mismatch', { measuredSid: OTHER_SID }],
    ['window-station-mismatch', { windowStation: 'Service-0x0-3e7$' }],
    ['desktop-mismatch', { desktop: 'Winlogon' }]
  ]
  for (const [reason, over] of cases) {
    const { binder, nonce, prep } = authorised()
    const v = binder.verifyResult(prep.bindingId, response(nonce, over))
    assert.equal(v.ok, false, reason + ' must fail')
    assert.equal(v.verdict, 'BINDING-FAILURE', reason + ' is a containment finding, not a refusal')
    assert.equal(v.reason, reason)
  }
})

test('*** THE ACCOUNT NAME IS NOT THE ACCOUNT — ONLY THE SID IS COMPARED ***', () => {
  // ⛔ `measuredBy` is a label: renameable, localisable, and trivially written by anything.
  //    A different label with the right SID binds; the reverse must not.
  const { binder, nonce, prep } = authorised()
  const v = binder.verifyResult(prep.bindingId, response(nonce, { measuredBy: 'SOMEWHERE\\SomebodyElse' }))
  assert.equal(v.verdict, 'OBSERVED_AND_BOUND', 'the SID is the identity, not the label')
})

/* ═══ PAYLOAD EXTRACTION — inverse, not allowlist ══════════════════════════ */

test('*** ⛔ AN UNKNOWN FIELD SURVIVES EXTRACTION AND IS THEN REFUSED ***', () => {
  /**
   * ⛔ THE SILENT SHREDDER THIS AVOIDS. 「Keep only the known RESULT_FIELDS」 would quietly trim
   * a leaked `secretText` into something that validates, destroying the evidence that a leak
   * was attempted with the very step meant to catch it. Extraction removes exactly the six IPC
   * keys and hands everything else to validateResult, which fails closed.
   */
  for (const leak of [{ secretText: 'the owner mailbox' }, { foo: 1 }, { pixels: 'AAAA' }, { uiaText: 'x' }]) {
    const { binder, nonce, prep } = authorised()
    const v = binder.verifyResult(prep.bindingId, response(nonce, leak))
    assert.equal(v.ok, false, '⛔ a leaked field was trimmed away instead of refused: ' + JSON.stringify(leak))
    assert.match(v.reason, /^result-invalid:/)
  }
  assert.deepEqual([...B.IPC_KEYS], ['from', 'to', 'type', 'approvalId', 'stepIndex', 'stepNonce'])
})

test('*** THE SCHEMA IS STILL THE SCHEMA — validateResult IS NOT BYPASSED ***', () => {
  // malformed measurement
  const bad = authorised()
  const r1 = bad.binder.verifyResult(bad.prep.bindingId, response(bad.nonce, { action: 'capture_screen', windowCount: null, nonBlackRatio: 'nearly' }))
  assert.equal(r1.ok, false)
  assert.match(r1.reason, /^result-invalid:/)

  // ⛔ titles still require containment proof, and the expected sessionId is what proves it
  const foreign = authorised()
  const r2 = foreign.binder.verifyResult(foreign.prep.bindingId, response(foreign.nonce, { titles: ['Inbox'], sessionId: SESSION + 3 }))
  assert.equal(r2.ok, false)
  assert.match(r2.reason, /CONTAINMENT-FAILURE/)

  // and a legitimate title list in the proven session passes both the schema and the binding
  const okCase = authorised()
  const r3 = okCase.binder.verifyResult(okCase.prep.bindingId, response(okCase.nonce, { titles: ['Inbox'] }))
  assert.equal(r3.verdict, 'OBSERVED_AND_BOUND', JSON.stringify(r3))

  // 'at' is a result field and must survive extraction rather than being stripped as metadata
  const kept = authorised()
  const r4 = kept.binder.verifyResult(kept.prep.bindingId, response(kept.nonce, { at: 1 }))
  assert.equal(r4.verdict, 'OBSERVED_AND_BOUND')
})

/* ═══ REFUSALS ═════════════════════════════════════════════════════════════ */

test('*** ⛔ A CORRELATED REFUSAL IS NEVER RELABELLED AS AN OBSERVATION ***', () => {
  /**
   * ⛔ NOTHING WAS OBSERVED, SO NOTHING ABOUT THE SESSION WAS PROVEN. The refusal still has to
   * be the answer to THIS request and still has to be schema-clean — but every match flag stays
   * false, rather than being omitted and left to read as 「fine」.
   */
  const { binder, nonce, prep } = authorised()
  const refusal = response(nonce, { ok: false, refusal: 'no_capability_enabled', windowCount: null, sessionId: undefined, measuredSid: undefined, measuredBy: undefined, windowStation: undefined, desktop: undefined, sessionState: undefined, titles: undefined, nonBlackRatio: undefined })
  const v = binder.verifyResult(prep.bindingId, refusal)
  assert.equal(v.ok, true, JSON.stringify(v))
  assert.equal(v.verdict, 'CORRELATED_REFUSAL')
  assert.equal(v.reason, 'no_capability_enabled')
  assert.equal(v.sessionMatched, false, '⛔ a refusal claimed a proven session')
  assert.equal(v.sidMatched, false)
  assert.equal(v.windowStationMatched, false)
  assert.equal(v.desktopMatched, false)
  assert.notEqual(v.verdict, 'OBSERVED_AND_BOUND')
})

/* ═══ INERTNESS ════════════════════════════════════════════════════════════ */

test('*** ⛔ A BINDING SEAM IS NOT AN ENABLED CAPABILITY, AND IT IS WIRED TO NOTHING ***', () => {
  assert.deepEqual({ ...O.OBSERVATION_CAPABILITIES }, { list_windows: false, read_uia_tree: false, capture_screen: false })
  assert.equal(O.anyObservationEnabled(), false)
  assert.equal(CAPABILITIES.list_windows, false)
  assert.equal(anyCapabilityEnabled(), false)

  /**
   * ⛔ PURE, AND PROVEN BY WHAT IT IMPORTS RATHER THAN BY WHAT IT SAYS.
   *
   * The first version of this assertion searched the source TEXT for 'quser', 'node:fs' and
   * the like — and went red on the module's own documentation, which promises NOT to call
   * quser. A check that a paragraph explaining a guarantee can break is a check on prose, not
   * on behaviour. What it imports is the actual claim: two pure sibling modules, nothing else.
   */
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'observationBinding.js'), 'utf8')
  const imports = src.split('require(').slice(1).map((chunk) => chunk.slice(1, chunk.indexOf(chunk[0], 1))).sort()
  assert.deepEqual(imports, ['./observation', './sessionBoundary'],
    '⛔ the binding module reached beyond its two pure siblings: ' + imports.join(', '))
  // and nothing about a machine is baked in as a literal
  assert.equal(/'S-1-5-21-/.test(src), false, '⛔ a real SID is baked into the module')
  assert.equal(/sessionId === 5|sessionId: 5/.test(src), false, '⛔ session 5 is hard-coded')
})
