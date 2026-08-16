'use strict'

/**
 * THE ERROR MESSAGE CONTRACT — WHAT THE OWNER ACTUALLY READS WHEN SOMETHING FAILS.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THREE DIFFERENT TRUTHS ARRIVED AS ONE SENTENCE, FOR EIGHT DAYS.
 *
 * `SAFE_MESSAGES` became thunks on 2026-08-08 (commit 0514caa). `intakeDiagnostics.js`
 * still put `SAFE_MESSAGES[code]` — the FUNCTION — into the response body. A function does
 * not survive `JSON.stringify`, so `message` was simply absent on the wire and the browser
 * fell back to one generic sentence for every failure of every kind, on both intake routes.
 *
 * ⛔ AND THE TEST THAT SHOULD HAVE CAUGHT IT WAS GREEN THE WHOLE TIME.
 *
 * `intakeDiagnostics.test.js:43` compares the IN-MEMORY body against an expectation holding
 * the SAME function reference on both sides. deepEqual is satisfied; nothing is serialised;
 * the wire is never examined. So these tests do the one thing that one did not: they run the
 * body through a real `JSON.stringify` → `JSON.parse` round trip and read what comes out.
 *
 * ⛔ SECOND, SEPARATE DEFECT: the front end never read `error.retryable` at all. The retry
 * suffix was attached to every error, so the Owner was told he could re-send requests the
 * server had already declared un-retryable. Being told to retry something that can never
 * succeed is worse than being told nothing.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const { handleIntakeError, SAFE_MESSAGES, RETRYABLE, STATUS } = require('./intakeDiagnostics')
const { t } = require('../i18n/t')

const { DistillParseError } = require('../intake/distillPrompt')
const { IntakeUpstreamError } = require('../intake/intakeErrors')

const APP_JS = fs.readFileSync(path.resolve(__dirname, '../demo/assets/app.js'), 'utf8')

/** The error each code is actually produced by, so the boundary is exercised, not simulated. */
const CASES = [
  { code: 'invalid_llm_output', err: () => new DistillParseError('duplicate_keys', { rawSample: '{}' }), key: 'diag.invalidOutput' },
  { code: 'llm_unavailable', err: () => new IntakeUpstreamError({ correlationId: 'cid' }), key: 'diag.unavailable' },
  { code: 'internal_error', err: () => new Error('boom'), key: 'diag.internal' }
]

/**
 * ⛔ THE WIRE, NOT THE OBJECT. This is the entire point of the file: `handleIntakeError`
 * returns an object, but the Owner receives BYTES. Anything asserted before this round trip
 * is a claim about a value the browser never sees.
 */
const overTheWire = (body) => JSON.parse(JSON.stringify(body))

/* ═══ 1. THE SERVER SIDE — the message must survive serialisation ══════════ */

test('*** ⛔ EVERY ERROR CODE KEEPS ITS OWN MESSAGE ACROSS A REAL SERIALISATION ***', () => {
  for (const c of CASES) {
    const mapped = handleIntakeError(c.err(), { correlationId: 'cid-' + c.code }, { sink () {} })
    const wire = overTheWire(mapped.body)

    assert.ok(Object.prototype.hasOwnProperty.call(wire.error, 'message'),
      '⛔ ' + c.code + ': `message` VANISHED on the wire — this is the eight-day defect')
    assert.equal(typeof wire.error.message, 'string', '⛔ ' + c.code + ': message is not a string on the wire')
    assert.equal(wire.error.message, t(c.key),
      '⛔ ' + c.code + ': the Owner receives the wrong sentence')
    assert.equal(wire.error.code, c.code)
    assert.equal(mapped.status, STATUS[c.code], 'the status for ' + c.code + ' is unchanged')
    assert.equal(wire.error.retryable, RETRYABLE[c.code], 'retryable travels for ' + c.code)
  }
})

test('*** ⛔ THE THREE MESSAGES ARE DISTINCT — one sentence for everything is the bug ***', () => {
  const seen = CASES.map((c) => overTheWire(handleIntakeError(c.err(), { correlationId: 'x' }, { sink () {} }).body).error.message)
  assert.equal(new Set(seen).size, 3, '⛔ two codes render the same sentence: ' + JSON.stringify(seen))
  for (const s of seen) assert.ok(s && s.length > 0, '⛔ an empty message is the same failure with extra steps')
})

test('*** SAFE_MESSAGES ARE THUNKS, AND THE BOUNDARY MUST CALL THEM ***', () => {
  // ⛔ Pinned deliberately. The defect was a CONSUMER that stopped matching its source. If
  //    these ever become plain strings again, this file should be revisited on purpose.
  for (const c of CASES) {
    assert.equal(typeof SAFE_MESSAGES[c.code], 'function', c.code + ' is expected to be a thunk')
  }
})

/* ═══ 2. BOTH ROUTES — one boundary, and both of them go through it ════════ */

test('*** BOTH INTAKE ROUTES DELIVER THROUGH THE SAME REPAIRED BOUNDARY ***', () => {
  /**
   * ⛔ WHY THIS IS ASSERTED AT THE SOURCE. There is exactly ONE place that builds an error
   * body, and both routers call it — so fixing it fixes both. If a router ever grows its own
   * error body, this goes red and that new path needs its own wire test.
   */
  for (const f of ['../routes/demoRouter.js', '../routes/intakeRouter.js']) {
    const src = fs.readFileSync(path.resolve(__dirname, f), 'utf8')
    assert.ok(src.includes('handleIntakeError('), '⛔ ' + f + ' no longer uses the shared boundary')
    assert.equal(/message:\s*SAFE_MESSAGES\[/.test(src), false, '⛔ ' + f + ' builds its own uncalled-thunk body')
  }
})

/* ═══ 3. THE BROWSER — the retry suffix is a claim, not decoration ═════════ */

/**
 * ⛔ THE SHIPPED SOURCE IS EXECUTED, NOT A COPY OF IT. Re-typing the logic here would test
 * this file against itself. `errorLine` is lifted out of app.js by brace matching and run in
 * a sandbox with the real resolver, so what runs in the test is the code that runs in Chrome.
 */
function liftFromApp (name) {
  const start = APP_JS.indexOf('function ' + name + ' (')
  assert.notEqual(start, -1, '⛔ app.js has no `' + name + '` — the UI decision is not isolated or not written yet')
  let depth = 0
  let i = APP_JS.indexOf('{', start)
  const from = i
  for (; i < APP_JS.length; i++) {
    if (APP_JS[i] === '{') depth++
    else if (APP_JS[i] === '}') { depth--; if (depth === 0) break }
  }
  const src = APP_JS.slice(start, i + 1)
  const sandbox = { t, out: null }
  vm.createContext(sandbox)
  vm.runInContext(src + '\nout = ' + name + ';', sandbox)
  assert.ok(from > 0)
  return sandbox.out
}

test('*** ⛔ THE RETRY SUFFIX APPEARS ONLY WHEN THE SERVER SAYS RETRYABLE ***', () => {
  const errorLine = liftFromApp('errorLine')
  const suffixOnly = t('err.retrySuffix', { message: '' }).replace('', '')

  const retryable = errorLine({ error: { code: 'llm_unavailable', message: t('diag.unavailable'), retryable: true } })
  assert.ok(retryable.includes(t('diag.unavailable')), 'the real reason is shown')
  assert.equal(retryable, t('err.retrySuffix', { message: t('diag.unavailable') }),
    'a genuinely transient failure invites a retry')

  const notRetryable = errorLine({ error: { code: 'internal_error', message: t('diag.internal'), retryable: false } })
  assert.equal(notRetryable, t('diag.internal'),
    '⛔ THE MISLEADING PART: the Owner was told to re-send something the server declared un-retryable')
  assert.equal(notRetryable.includes(suffixOnly.trim()) && suffixOnly.trim().length > 0, false,
    '⛔ the suffix survived on a non-retryable error')
})

test('*** ⛔ THE REAL MESSAGE IS PREFERRED; THE GENERIC ONE IS ONLY A FALLBACK ***', () => {
  const errorLine = liftFromApp('errorLine')
  // With a message present it must be used — this is what the wire fix now delivers.
  assert.ok(errorLine({ error: { message: 'SPECIFIC_REASON', retryable: false } }).includes('SPECIFIC_REASON'),
    '⛔ the server-supplied reason was discarded')
  // With no message at all the generic sentence still stands in, rather than a blank turn.
  assert.ok(errorLine({ error: { code: 'internal_error', retryable: false } }).includes(t('err.serverBusy')),
    '⛔ a missing message must degrade to the generic sentence, never to nothing')
})

test('*** THE FRONT END READS retryable AT ALL ***', () => {
  // ⛔ The original finding was literally zero occurrences of the word in app.js.
  assert.ok(/retryable/.test(APP_JS), '⛔ app.js still ignores the field the server sends')
})
