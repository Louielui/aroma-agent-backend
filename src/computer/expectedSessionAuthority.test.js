'use strict'

/**
 * E0-W1 EXPECTED-SESSION AUTHORITY CONTRACT.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE DEGENERATE COMPARISON THIS EXISTS TO MAKE IMPOSSIBLE.
 *
 * `observationBinding` compares an expected SID against the Observer's `measuredSid`, and
 * that comparison is only worth something if the two sides come from DIFFERENT places. The
 * obvious source for the expected side was the registered `AromaComputerOperator-SessionGate`
 * task — which runs `session-identity.ps1` AS AromaOperator, reading its own token and
 * writing its own JSON.
 *
 * Wire that in and the check collapses:
 *     AromaOperator process A: I am SID X in session Y
 *     AromaOperator process B: I am SID X in session Y
 *     Service: they agree, therefore proven
 * Two self-reports from one security principal, compared against each other and called
 * independent. It would look exactly like a binding and verify nothing — the same shape as
 * `measuredSid` being trusted on its own, one level further out.
 *
 * ⛔ SO INDEPENDENCE IS A PRECONDITION, NOT A PROPERTY OF THE DATA. A structurally perfect
 * expected session that came from the target's own principal is REFUSED here, however
 * well-formed it is.
 *
 * ⛔ AND WHAT THIS FILE CANNOT DO. These are deterministic fakes. They prove the CONTRACT —
 * shape, refusals, ordering, isolation, privacy — and they prove nothing whatever about
 * Windows. Whether the real resolver actually runs under a principal AromaOperator cannot
 * control is a machine question, answerable only by a machine tranche that does not exist.
 * Nothing here may be read as evidence that it does.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const A = require('./expectedSessionAuthority')

const SID = 'S-1-5-21-1111111111-2222222222-3333333333-1009'
const REF = { refId: 'companion-ref-0001' }
const AT = 1_700_000_000_000

/** What an independent Service-side resolver is contracted to return. */
const resolved = (over = {}) => Object.assign({
  ok: true,
  independence: true,
  expectedSid: SID,
  sessionId: 7,
  windowStation: 'WinSta0',
  desktop: 'Default',
  proofId: 'proof-auth-0001'
}, over)

const authorityWith = (result, opts = {}) => A.createExpectedSessionAuthority(Object.assign({
  resolveIndependentForCompanion: typeof result === 'function' ? result : () => result,
  now: () => AT
}, opts))

/* ═══ THE SUCCESS SHAPE ════════════════════════════════════════════════════ */

test('*** AN INDEPENDENT RESOLUTION YIELDS EXACTLY THE expectedSession SHAPE ***', () => {
  const r = authorityWith(resolved()).resolveForCompanion(REF)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.deepEqual(Object.keys(r.expectedSession).sort(),
    ['desktop', 'expectedSid', 'proofId', 'sessionId', 'windowStation'])
  assert.equal(r.expectedSession.expectedSid, SID)
  assert.equal(r.expectedSession.sessionId, 7)
  assert.equal(r.expectedSession.windowStation, 'WinSta0')
  assert.equal(r.expectedSession.desktop, 'Default')
  // 12A: when the authority was established, so a future freshness policy has something to act on
  assert.equal(r.resolvedAt, AT)
})

/* ═══ INDEPENDENCE — the rule the whole tranche exists for ═════════════════ */

test('*** ⛔ A STRUCTURALLY PERFECT NON-INDEPENDENT RESULT IS REFUSED ***', () => {
  /**
   * ⛔ THE ONE TEST THAT MATTERS MOST. Everything about this payload is valid: real SID shape,
   * real session, the policy window station and desktop. The only thing wrong is that the
   * resolver told us it could not establish independence from the target — and a wrapper that
   * "upgrades" that because the data looks fine is the degenerate comparison, restored.
   */
  const r = authorityWith(resolved({ independence: false })).resolveForCompanion(REF)
  assert.equal(r.ok, false, '⛔ a self-attested-equivalent result was accepted')
  assert.equal(r.reason, 'authority-not-independent')
  assert.equal('expectedSession' in r, false, 'and nothing usable came out of it')
})

test('*** ⛔ INDEPENDENCE MUST BE ASSERTED, NOT ASSUMED FROM ABSENCE ***', () => {
  // ⛔ A resolver that forgot to say is not a resolver that said yes.
  for (const missing of [undefined, null, 'true', 1, {}]) {
    const r = authorityWith(resolved({ independence: missing })).resolveForCompanion(REF)
    assert.equal(r.ok, false, '⛔ independence ' + JSON.stringify(missing) + ' was treated as proven')
    assert.equal(r.reason, 'authority-not-independent')
  }
})

/* ═══ RESOLVER FAILURES ════════════════════════════════════════════════════ */

test('*** EVERY RESOLVER FAILURE FAILS CLOSED, WITH A COARSE STABLE REASON ***', () => {
  const cases = [
    ['authority-unavailable', { ok: false, reason: 'authority-unavailable' }],
    ['target-not-found', { ok: false, reason: 'target-not-found' }],
    ['target-ambiguous', { ok: false, reason: 'target-ambiguous' }],
    ['authority-not-independent', { ok: false, reason: 'authority-not-independent' }],
    ['invalid-authority-result', { ok: false, reason: 'something-nobody-declared' }],
    ['invalid-authority-result', { ok: false }],
    ['invalid-authority-result', null],
    ['invalid-authority-result', 'nope'],
    ['invalid-authority-result', []]
  ]
  for (const [reason, result] of cases) {
    const r = authorityWith(result).resolveForCompanion(REF)
    assert.equal(r.ok, false, JSON.stringify(result))
    assert.equal(r.reason, reason, JSON.stringify(result))
  }
})

test('*** A RESOLVER THAT THROWS IS UNAVAILABLE, NOT A CRASH ***', () => {
  // ⛔ A caller must not have to proceed by catching. The whole point is a value it can refuse on.
  const boom = () => { throw new Error('C:\\some\\path\\session-identity.ps1 exploded: SID S-1-5-21-9') }
  const r = authorityWith(boom).resolveForCompanion(REF)
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'authority-unavailable')
  // ⛔ and the OS error text does not travel — it carries a path and a SID
  assert.equal(JSON.stringify(r).includes('S-1-5-21-9'), false, '⛔ a SID leaked through an error')
  assert.equal(JSON.stringify(r).includes('.ps1'), false, '⛔ a file path leaked through an error')
})

test('*** A MISSING OR NON-FUNCTION RESOLVER IS MISCONFIGURED, NOT PERMISSIVE ***', () => {
  for (const bad of [undefined, null, 'resolver', {}]) {
    const r = A.createExpectedSessionAuthority({ resolveIndependentForCompanion: bad, now: () => AT }).resolveForCompanion(REF)
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'authority-misconfigured')
  }
  // and without an injected clock there is no honest resolvedAt to record
  const noClock = A.createExpectedSessionAuthority({ resolveIndependentForCompanion: () => resolved() }).resolveForCompanion(REF)
  assert.equal(noClock.ok, false)
  assert.equal(noClock.reason, 'authority-misconfigured')
})

/* ═══ SHAPE AND POLICY ═════════════════════════════════════════════════════ */

test('*** ⛔ THE SESSION FIELDS ARE CHECKED, AND THE STATION AND DESKTOP ARE POLICY ***', () => {
  /**
   * ⛔ WinSta0 AND Default ARE REQUIREMENTS, NOT MEASUREMENTS. They say 「an interactive
   * desktop is what we will accept」. Taking them from whatever the target reported would turn
   * a policy into an echo — the target choosing the standard it is judged against.
   */
  const cases = [
    ['expectedSid', 'AROMABRAIN\\AromaOperator'],
    ['expectedSid', ''],
    ['expectedSid', 12345],
    ['sessionId', -1],
    ['sessionId', '7'],
    ['sessionId', 1.5],
    ['windowStation', 'Service-0x0-3e7$'],
    ['windowStation', undefined],
    ['desktop', 'Winlogon'],
    ['desktop', undefined]
  ]
  for (const [field, value] of cases) {
    const r = authorityWith(resolved({ [field]: value })).resolveForCompanion(REF)
    assert.equal(r.ok, false, '⛔ accepted ' + field + '=' + JSON.stringify(value))
    assert.equal(r.reason, 'invalid-authority-result')
  }
})

test('*** ⛔ SELF-ATTESTED PAYLOAD SHAPES ARE REFUSED AT THE BOUNDARY ***', () => {
  /**
   * ⛔ IF IT ARRIVES CARRYING THE TARGET'S OWN REPORT, IT CAME FROM THE WRONG PLACE. A
   * resolver handing over `measuredSid`, raw SessionGate JSON or an evidence path is telling
   * us how it decided — and the answer is the source this contract exists to exclude.
   */
  for (const key of ['measuredSid', 'measuredBy', 'evidencePath', 'sessionGateJson', 'taskPrincipal', 'serviceSid', 'userName', 'processList']) {
    const r = authorityWith(resolved({ [key]: 'anything' })).resolveForCompanion(REF)
    assert.equal(r.ok, false, '⛔ a self-attestation carrier was accepted: ' + key)
    assert.equal(r.reason, 'invalid-authority-result')
  }
})

test('*** ⛔ NOTHING ABOUT THE SERVICE OR THE MACHINE LEAVES THE BOUNDARY ***', () => {
  // ⛔ Implementation metadata stays behind the adapter. The caller gets the expected session
  //    and a correlation id, and learns nothing about who asked or how.
  const rich = resolved()
  const r = authorityWith(() => rich).resolveForCompanion(REF)
  const text = JSON.stringify(r)
  for (const forbidden of ['serviceSid', 'measuredSid', 'measuredBy', 'userName', 'taskPrincipal', 'evidencePath']) {
    assert.equal(text.includes(forbidden), false, '⛔ ' + forbidden + ' escaped')
  }
  assert.deepEqual(Object.keys(r).sort(), ['expectedSession', 'ok', 'resolvedAt'])
})

test('*** THE COMPANION REFERENCE IS PASSED THROUGH UNREAD ***', () => {
  // ⛔ Opaque means opaque: the authority must not infer a pid, a session or an account from it.
  let seen = null
  const auth = authorityWith((ref) => { seen = ref; return resolved() })
  auth.resolveForCompanion(REF)
  assert.deepEqual(seen, REF, 'the reference reached the resolver unchanged')
})

test('*** ⛔ NO SESSION NUMBER AND NO MACHINE SID IS BAKED IN ***', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'expectedSessionAuthority.js'), 'utf8')
  assert.equal(src.includes('S-1-5-21-'), false, '⛔ a real SID is hard-coded')
  assert.equal(/sessionId === 5|sessionId: 5|sessionId === 7|sessionId: 7/.test(src), false, '⛔ a session number is hard-coded')
  // ⛔ imports inspected, not prose searched — the earlier false positive was a comment
  const imports = src.split('require(').slice(1).map((c) => c.slice(1, c.indexOf(c[0], 1))).sort()
  assert.deepEqual(imports, [], '⛔ the authority contract imported something: ' + imports.join(', '))
})
