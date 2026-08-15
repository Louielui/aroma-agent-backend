'use strict'

/**
 * E0-W1 SERVICE COORDINATOR — THE STRUCTURAL FIX.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE HOLE WAS IN THE SIGNATURE, NOT IN THE CHECKS.
 *
 * `observationBinding.prepare()` takes `expectedSession` as a parameter. Every check inside
 * it is sound — but a parameter is something a CALLER supplies, so the honest description of
 * the guarantee was 「the result must match whatever the caller said to expect」. Hand it a
 * session read out of the SessionGate JSON that AromaOperator wrote, and it binds beautifully
 * to a lie.
 *
 * The fix is not another validation. It is that this coordinator's `prepare` HAS NO
 * `expectedSession` PARAMETER AT ALL. It asks its own fixed authority. A caller cannot pass
 * the expected side because there is nowhere to put it, and an attempt to smuggle one in is
 * refused as unknown input rather than ignored — silently dropping it would leave the caller
 * believing it had been honoured.
 *
 * ⛔ AND IT DOES NOT REIMPLEMENT THE BINDING. Nonce burning, approved-step matching and
 * result correlation stay where they already are and are already proven. A second
 * implementation of single-use would be a second opinion about what「once」means.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const C = require('./observationServiceCoordinator')
const A = require('./expectedSessionAuthority')
const { createOrderRegistry } = require('./orderRegistry')
const { ROLE_SERVICE, ROLE_COMPANION } = require('./sessionBoundary')

const SID = 'S-1-5-21-1111111111-2222222222-3333333333-1009'
const APPROVAL = 'appr_coord_0001'
const SESSION = 7
const AT = 1_700_000_000_000
const REF_A = { refId: 'companion-ref-A' }
const REF_B = { refId: 'companion-ref-B' }

const resolved = (over = {}) => Object.assign({
  ok: true,
  independence: true,
  expectedSid: SID,
  sessionId: SESSION,
  windowStation: 'WinSta0',
  desktop: 'Default',
  proofId: 'proof-A'
}, over)

function authority (resolver) {
  return A.createExpectedSessionAuthority({
    resolveIndependentForCompanion: resolver || (() => resolved()),
    now: () => AT
  })
}

function fixture (resolver) {
  const registry = createOrderRegistry({ now: () => 1_000_000 })
  const admitted = registry.admit({ approvalId: APPROVAL, workOrderHash: 'hash-abc', stepCount: 3, timeoutSec: 600 })
  assert.equal(admitted.ok, true)
  const coordinator = C.createObservationServiceCoordinator({ registry, expectedSessionAuthority: authority(resolver) })
  return { registry, coordinator, nonces: admitted.stepNonces }
}

const approvedStep = (nonce, over = {}) => Object.assign({
  approvalId: APPROVAL, stepIndex: 0, stepNonce: nonce, action: 'list_windows', workOrderHash: 'hash-abc'
}, over)

const request = (nonce, over = {}) => Object.assign({
  approvalId: APPROVAL, stepIndex: 0, stepNonce: nonce, action: 'list_windows'
}, over)

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

/* ═══ THE STRUCTURAL FIX ═══════════════════════════════════════════════════ */

test('*** ⛔ THERE IS NOWHERE FOR A CALLER TO PUT AN EXPECTED SESSION ***', () => {
  /**
   * ⛔ THE WHOLE POINT. Not「we validate the caller's expectedSession harder」— the parameter
   * does not exist, and anything that looks like it is refused rather than dropped. Silently
   * ignoring it would leave a caller believing its expectation had been honoured.
   */
  const { coordinator, nonces } = fixture()
  const smuggles = [
    { expectedSession: { expectedSid: 'S-1-5-21-9-9-9-500', sessionId: 99, windowStation: 'WinSta0', desktop: 'Default' } },
    { evidencePath: 'C:\\Aroma\\ComputerOperator-Evidence\\session-identity-task.json' },
    { sessionGateJson: { Sid: SID, SessionId: 7 } },
    { expectedSid: SID },
    { sessionId: 7 }
  ]
  for (const extra of smuggles) {
    const r = coordinator.prepare(Object.assign({
      approvedStep: approvedStep(nonces[0]), request: request(nonces[0]), companionRef: REF_A
    }, extra))
    assert.equal(r.ok, false, '⛔ smuggled input was accepted: ' + Object.keys(extra)[0])
    assert.equal(r.reason, 'unknown-input')
  }
})

test('*** THE COORDINATOR ASKS ITS OWN AUTHORITY, AND USES ONLY THAT ***', () => {
  let asked = 0
  const { coordinator, nonces } = fixture((ref) => { asked++; return resolved() })
  const r = coordinator.prepare({ approvedStep: approvedStep(nonces[0]), request: request(nonces[0]), companionRef: REF_A })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(asked, 1, 'the coordinator resolved the expected session itself')
  assert.equal(r.verdict, 'AUTHORISED')
  assert.equal(r.proofId, 'proof-A')
  assert.equal(r.resolvedAt, AT, '12A: the moment authority was established is carried forward')
  assert.equal(r.refId, 'companion-ref-A')
})

/* ═══ INPUT VALIDATION ═════════════════════════════════════════════════════ */

test('*** MISSING OR MALFORMED INPUT REFUSES BEFORE ANYTHING IS ASKED ***', () => {
  const { coordinator, nonces } = fixture()
  const base = { approvedStep: approvedStep(nonces[0]), request: request(nonces[0]), companionRef: REF_A }
  for (const [reason, over] of [
    ['approved-step-missing', { approvedStep: undefined }],
    ['request-missing', { request: undefined }],
    ['companion-ref-invalid', { companionRef: undefined }],
    ['companion-ref-invalid', { companionRef: {} }],
    ['companion-ref-invalid', { companionRef: { refId: '' } }],
    ['companion-ref-invalid', { companionRef: 'companion-ref-A' }],
    ['companion-ref-invalid', { companionRef: { refId: 'ok', pid: 4242 } }],
    ['companion-ref-invalid', { companionRef: { refId: 'ok', sessionId: 7 } }]
  ]) {
    const r = coordinator.prepare(Object.assign({}, base, over))
    assert.equal(r.ok, false, reason + ' :: ' + JSON.stringify(over))
    assert.equal(r.reason, reason, JSON.stringify(over))
  }
})

test('*** ⛔ THE COMPANION REFERENCE STAYS OPAQUE — NO PID, NO SESSION, NO ACCOUNT ***', () => {
  // ⛔ Accepting a pid or a session on the reference would put the target's own identity back
  //    into the domain contract through the side door.
  const { coordinator, nonces } = fixture()
  const r = coordinator.prepare({
    approvedStep: approvedStep(nonces[0]),
    request: request(nonces[0]),
    companionRef: { refId: 'ok', account: 'AROMABRAIN\\AromaOperator' }
  })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'companion-ref-invalid')
})

/* ═══ AUTHORITY BEFORE THE BURN ════════════════════════════════════════════ */

test('*** ⛔ EVERY AUTHORITY FAILURE LEAVES THE OWNER APPROVAL UNSPENT ***', () => {
  /**
   * ⛔ NOTHING WAS DISPATCHED, SO NOTHING WAS USED. If Windows authority cannot establish an
   * independent target, the step never left — and spending the Owner's approval on our own
   * inability would be a self-inflicted denial of work he authorised.
   */
  const failures = [
    { ok: false, reason: 'authority-unavailable' },
    { ok: false, reason: 'target-not-found' },
    { ok: false, reason: 'target-ambiguous' },
    resolved({ independence: false })
  ]
  for (const result of failures) {
    const { coordinator, registry, nonces } = fixture(() => result)
    const r = coordinator.prepare({ approvedStep: approvedStep(nonces[0]), request: request(nonces[0]), companionRef: REF_A })
    assert.equal(r.ok, false, JSON.stringify(result))
    // ⛔ the nonce is still there to be spent by a later, legitimate attempt
    const burn = registry.consumeStep({ approvalId: APPROVAL, stepIndex: 0, stepNonce: nonces[0] })
    assert.equal(burn.ok, true, '⛔ an authority failure spent the Owner approved step: ' + r.reason)
  }
})

test('*** A VALID PATH BURNS THE NONCE EXACTLY ONCE, INSIDE THE BINDING ***', () => {
  const { coordinator, registry, nonces } = fixture()
  const r = coordinator.prepare({ approvedStep: approvedStep(nonces[0]), request: request(nonces[0]), companionRef: REF_A })
  assert.equal(r.ok, true)
  // spent exactly once: the registry now refuses it
  const burn = registry.consumeStep({ approvalId: APPROVAL, stepIndex: 0, stepNonce: nonces[0] })
  assert.equal(burn.ok, false, '⛔ the nonce was never burned')
  assert.equal(burn.reason, 'nonce_already_used')

  // and a replay through the coordinator is refused
  const replay = coordinator.prepare({ approvedStep: approvedStep(nonces[0]), request: request(nonces[0]), companionRef: REF_A })
  assert.equal(replay.ok, false, '⛔ a spent step was authorised again')
})

/* ═══ TARGET ISOLATION ═════════════════════════════════════════════════════ */

test('*** ⛔ A DIFFERENT COMPANION FORCES A FRESH RESOLUTION — NO CACHING ***', () => {
  /**
   * ⛔ ONE AUTHORITY ANSWER BELONGS TO ONE TARGET. Reusing A's expected session for B would
   * authorise an observation in a session nobody looked up — a cache turning into a claim.
   */
  const seen = []
  const { coordinator, nonces } = fixture((ref) => {
    seen.push(ref.refId)
    return resolved(ref.refId === 'companion-ref-B' ? { sessionId: 9, proofId: 'proof-B' } : {})
  })
  const a = coordinator.prepare({ approvedStep: approvedStep(nonces[0]), request: request(nonces[0]), companionRef: REF_A })
  const b = coordinator.prepare({
    approvedStep: approvedStep(nonces[1], { stepIndex: 1 }),
    request: request(nonces[1], { stepIndex: 1 }),
    companionRef: REF_B
  })
  assert.equal(a.ok, true)
  assert.equal(b.ok, true)
  assert.deepEqual(seen, ['companion-ref-A', 'companion-ref-B'], '⛔ the second target reused the first answer')
  assert.equal(a.proofId, 'proof-A')
  assert.equal(b.proofId, 'proof-B')

  // and B really is bound to B's session, not A's
  const wrongSession = coordinator.verifyResult(b.dispatchId, response(nonces[1], { stepIndex: 1, sessionId: SESSION }))
  assert.equal(wrongSession.ok, false, '⛔ B accepted A session')
  assert.equal(wrongSession.reason, 'session-id-mismatch')
})

/* ═══ FROZEN AUTHORITY ═════════════════════════════════════════════════════ */

test('*** ⛔ THE EXPECTED SIDE IS FROZEN AT PREPARE AND NEVER RE-QUERIED ***', () => {
  /**
   * ⛔ RE-ASKING AT VERIFY WOULD LET THE MACHINE MOVE UNDER THE DECISION. The observation was
   * authorised against the session that existed when it was authorised; asking again afterwards
   * would quietly accept a result from wherever the machine happens to be now.
   *
   * ⛔ KNOWN OPEN, RECORDED NOT SOLVED: freezing means an old preparation can be verified long
   * after the machine has changed. There is NO freshness bound yet, deliberately — inventing
   * one would be a guess wearing a policy's clothes. `resolvedAt` is carried so a future policy
   * has something to act on.
   */
  let calls = 0
  const { coordinator, nonces } = fixture(() => {
    calls++
    return calls === 1 ? resolved() : resolved({ sessionId: 999, proofId: 'proof-LATER' })
  })
  const p = coordinator.prepare({ approvedStep: approvedStep(nonces[0]), request: request(nonces[0]), companionRef: REF_A })
  assert.equal(p.ok, true)
  const v = coordinator.verifyResult(p.dispatchId, response(nonces[0]))
  assert.equal(calls, 1, '⛔ the authority was asked again at verify')
  assert.equal(v.verdict, 'OBSERVED_AND_BOUND', JSON.stringify(v))
  assert.equal(v.resolvedAt, AT, 'the recorded moment travels with the verification')
})

/* ═══ VERIFY DELEGATES, AND PRESERVES THE EXISTING SEMANTICS ═══════════════ */

test('*** THE BINDING VERDICTS SURVIVE THE COORDINATOR UNCHANGED ***', () => {
  const ok = fixture()
  const p1 = ok.coordinator.prepare({ approvedStep: approvedStep(ok.nonces[0]), request: request(ok.nonces[0]), companionRef: REF_A })
  assert.equal(ok.coordinator.verifyResult(p1.dispatchId, response(ok.nonces[0])).verdict, 'OBSERVED_AND_BOUND')

  const ref = fixture()
  const p2 = ref.coordinator.prepare({ approvedStep: approvedStep(ref.nonces[0]), request: request(ref.nonces[0]), companionRef: REF_A })
  const refusal = response(ref.nonces[0], {
    ok: false,
    refusal: 'no_capability_enabled',
    windowCount: null,
    sessionId: undefined,
    measuredSid: undefined,
    measuredBy: undefined,
    windowStation: undefined,
    desktop: undefined,
    sessionState: undefined,
    titles: undefined,
    nonBlackRatio: undefined
  })
  const v2 = ref.coordinator.verifyResult(p2.dispatchId, refusal)
  assert.equal(v2.verdict, 'CORRELATED_REFUSAL')
  assert.equal(v2.sessionMatched, false, '⛔ a refusal claimed a proven session')

  const bad = fixture()
  const p3 = bad.coordinator.prepare({ approvedStep: approvedStep(bad.nonces[0]), request: request(bad.nonces[0]), companionRef: REF_A })
  const v3 = bad.coordinator.verifyResult(p3.dispatchId, response(bad.nonces[0], { measuredSid: 'S-1-5-21-9-9-9-500' }))
  assert.equal(v3.verdict, 'BINDING-FAILURE')
  assert.equal(v3.reason, 'sid-mismatch')

  // one prepared dispatch, one result — the existing single-use rule still applies
  const twice = bad.coordinator.verifyResult(p3.dispatchId, response(bad.nonces[0]))
  assert.equal(twice.ok, false)

  // and an unknown dispatch id is refused
  assert.equal(bad.coordinator.verifyResult('no-such-dispatch', response(bad.nonces[0])).ok, false)
})

test('*** ⛔ VERIFY ACCEPTS NO CALLER EXPECTATION EITHER ***', () => {
  const { coordinator, nonces } = fixture()
  const p = coordinator.prepare({ approvedStep: approvedStep(nonces[0]), request: request(nonces[0]), companionRef: REF_A })
  // a third argument must not become a back door; the response itself is the only input
  const v = coordinator.verifyResult(p.dispatchId, response(nonces[0]), { expectedSession: { expectedSid: 'S-1-5-21-9-9-9-500', sessionId: 99 } })
  assert.equal(v.verdict, 'OBSERVED_AND_BOUND', 'the extra argument changed nothing: ' + JSON.stringify(v))
})

/* ═══ PRIVACY AND PURITY ═══════════════════════════════════════════════════ */

test('*** ⛔ NO IDENTITY EVER LEAVES THE COORDINATOR ***', () => {
  const { coordinator, nonces } = fixture()
  const p = coordinator.prepare({ approvedStep: approvedStep(nonces[0]), request: request(nonces[0]), companionRef: REF_A })
  const v = coordinator.verifyResult(p.dispatchId, response(nonces[0]))
  for (const out of [p, v]) {
    const text = JSON.stringify(out)
    assert.equal(text.includes(SID), false, '⛔ a SID left the coordinator')
    assert.equal(text.includes('expectedSession'), false, '⛔ the raw expected session left the coordinator')
    assert.equal(text.includes('measuredSid'), false)
    assert.equal(text.includes('AromaOperator'), false, '⛔ an account name left the coordinator')
  }
})

test('*** ⛔ BOTH NEW MODULES ARE PURE, AND TOUCH NO MACHINE MACHINERY ***', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const importsOf = (f) => {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8')
    return src.split('require(').slice(1).map((c) => c.slice(1, c.indexOf(c[0], 1))).sort()
  }
  // ⛔ INSPECTED, NOT GREPPED FOR PROSE. An earlier version of this kind of check went red on a
  //    comment promising not to call quser — a test of paragraphs, not of behaviour.
  assert.deepEqual(importsOf('expectedSessionAuthority.js'), [])
  assert.deepEqual(importsOf('observationServiceCoordinator.js'), ['./observationBinding'])

  /**
   * ⛔ COMMENTS STRIPPED FIRST. Both modules DOCUMENT the machinery they refuse to touch —
   * naming session-identity.ps1 is how the reasoning is recorded. Searching raw text would go
   * red on the explanation of the guarantee itself: a check on prose, not on behaviour. That
   * mistake has already been made once in this project and is not to be repeated.
   */
  const NL = String.fromCharCode(10)
  const stripBlocks = (src) => src.split('/' + '*').map((c, n) => n === 0 ? c : c.slice(c.indexOf('*' + '/') + 2)).join(' ')
  const stripLines = (src) => src.split(NL).map((l) => { const at = l.indexOf('/' + '/'); return at < 0 ? l : l.slice(0, at) }).join(NL)
  const stripComments = (src) => stripLines(stripBlocks(src))
  const both = ['expectedSessionAuthority.js', 'observationServiceCoordinator.js']
    .map((f) => stripComments(fs.readFileSync(path.join(__dirname, f), 'utf8'))).join(NL)
  for (const machinery of ['session-identity.ps1', 'verify-session-gate.ps1', 'register-session-gate-task.ps1', 'session-identity-task.json', 'ComputerOperator-Evidence']) {
    assert.equal(both.includes(machinery), false, '⛔ a path to session-gate machinery is encoded: ' + machinery)
  }

  const O = require('./observation')
  assert.deepEqual({ ...O.OBSERVATION_CAPABILITIES }, { list_windows: false, read_uia_tree: false, capture_screen: false })
  assert.equal(O.anyObservationEnabled(), false)
})
