'use strict'

/**
 * activationUnknown.test.js — an unanswered helper must produce "unknown", never "nothing happened".
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────
 * desktopAdapter's activation block wrote `sendCount: 0, activated: false` into its transport-
 * failure and catch paths, then returned `save_refused` with the words "refused before sending".
 *
 * That path is reachable exactly when the runner TIMES OUT, which kills the helper process. A
 * helper killed after posting BM_CLICK is indistinguishable, from the caller's side, from one
 * killed before. So the adapter asserted that nothing had happened to the machine at the one
 * moment it could not possibly know — a truncation that had become a false claim, in the
 * dangerous direction.
 *
 * BM_CLICK is the single native message this system is allowed to send. "It was not sent" is a
 * claim about the outside world. It may only be made from a measurement.
 *
 * The rule these tests enforce: when the helper does not answer, the result carries NO count, NO
 * activated flag, and NO refusal — it is `activation_outcome_unknown`, which the executor already
 * treats as terminal and unrecoverable without a fresh approval.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { createDesktopAdapter } = require('./desktopAdapter')
const { createComputerExecutor } = require('./computerExecutor')
const { createOrderRegistry } = require('./orderRegistry')
const { computeOrderHash } = require('./sealedOrderGate')

const TEXT = 'Aroma Computer Operator canary. Three steps with save. Round 1.'
const ALLOWED = 'C:\\Aroma\\ComputerOperator-Test'

const BIND = Object.freeze({
  processId: 4242, sessionId: 1, windowHandle: '0x9001',
  uiaRuntimeId: '42.66904', uiaControlType: 'ControlType.Document',
  uiaClassName: 'RichEditD2DPT', uiaAutomationId: ''
})

const PREPARED = { ok: true, method: 'SaveAsDialogPrepared', prepared: true, path: ALLOWED + '\\canary-save-1.txt' }

/**
 * `activate` decides what the activation helper does:
 *   { throws: <Error> }   the runner throws — a timeout kills the helper this way
 *   { env: <envelope> }   the runner returns something
 */
function adapterWith (activate, fileExists) {
  const runner = {
    run (scriptId, payload) {
      if (scriptId === 'native-save-activation') {
        if (activate.throws) throw activate.throws
        return activate.env
      }
      if (payload.op === 'open_app') return { ok: true, result: Object.assign({ ok: true }, BIND) }
      if (payload.op === 'verify_binding') return { ok: true, result: Object.assign({ ok: true }, BIND, { uiaControlPresent: true }) }
      if (payload.op === 'type_text') return { ok: true, result: { ok: true, method: 'ValuePattern', chars: TEXT.length } }
      if (payload.op === 'save_as') return { ok: true, result: PREPARED }
      if (payload.op === 'save_outcome') return { ok: true, result: { ok: true, dialogPresent: false, errorTextSeen: null } }
      if (payload.op === 'cleanup') return { ok: true, result: { ok: true, processExited: true, notepadWindowsAfter: 0, notepadProcessesAfter: 0, forced: true, method: 'm' } }
      return { ok: true, result: { ok: true } }
    }
  }
  return { adapter: createDesktopAdapter({ runner, fsProbe: { exists: () => fileExists === true } }), runner }
}

function save (activate, fileExists) {
  const { adapter } = adapterWith(activate, fileExists)
  return adapter.saveAsViaUi({ bind: BIND, dir: ALLOWED + '\\', fileName: 'canary-save-1.txt' })
}

/** Every way this result could claim "nothing was sent". */
function assertClaimsNothingSent (sv, why) {
  assert.notEqual(sv.sendCount, 0, why + ': sendCount must NOT be 0 — that is a measurement we do not have')
  assert.equal(sv.sendCount, null, why + ': sendCount must be null, the value that means unknown')
  assert.notEqual(sv.activated, false, why + ': activated must NOT be false — we cannot see that it did not happen')
  assert.equal(sv.outcome, 'activation_outcome_unknown', why + ': the outcome is the terminal unknown')
  assert.equal(sv.refusal, null, why + ': an unknown is not a refusal and must not be dressed as one')
  assert.equal(/refused before sending|not sent|nothing was sent/i.test(String(sv.detail)), false,
    why + ': the wording must not assert that nothing was sent — got: ' + sv.detail)
  assert.match(String(sv.detail), /UNKNOWN/, why + ': and it must say so in as many words')
}

/* ── 1. the helper does not answer ────────────────────────────────────────── */

test('*** a helper TIMEOUT yields unknown — no sendCount, no "refused before sending" ***', () => {
  const err = new Error('timeout'); err.reason = 'timeout'
  assertClaimsNothingSent(save({ throws: err }), 'runner threw timeout')
})

test('*** a runner that throws anything at all yields unknown ***', () => {
  assertClaimsNothingSent(save({ throws: new Error('spawn ENOENT') }), 'runner threw')
})

test('*** a transport failure (no envelope, or ok:false) yields unknown ***', () => {
  assertClaimsNothingSent(save({ env: { ok: false, refusal: 'timeout' } }), 'transport refused')
  assertClaimsNothingSent(save({ env: null }), 'no envelope at all')
  assertClaimsNothingSent(save({ env: { ok: true, result: null } }), 'envelope with no result')
})

/* ── 2. a MEASURED zero is still a refusal — we did not make everything unknown ─ */

test('*** POSITIVE CONTROL — a helper that MEASURED sendCount 0 is still save_refused ***', () => {
  // If this went unknown too, the fix would have destroyed the distinction rather than protected
  // it: a helper that refused before sending has genuinely observed that nothing went out.
  const sv = save({ env: { ok: true, result: { ok: false, reason: 'filename_field_altered', sendCount: 0, activated: false } } })
  assert.equal(sv.outcome, 'save_refused', 'a measured zero is an ordinary refusal')
  assert.equal(sv.sendCount, 0)
  assert.equal(sv.activated, false)
  assert.equal(sv.refusal, 'filename_field_altered', 'and the helper\'s own code is kept')
  assert.match(String(sv.detail), /refused before sending/, 'here the words are earned')
})

test('*** a helper refusal that reports sendCount > 0, or none at all, is unknown ***', () => {
  // The helper reports sendCount on every outcome including its own catch. A refusal claiming a
  // send is a contradiction, and the safe reading of a contradiction is "we do not know".
  assertClaimsNothingSent(
    save({ env: { ok: true, result: { ok: false, reason: 'activation_threw', sendCount: null, activated: false } } }),
    'refusal with no count')

  const sent = save({ env: { ok: true, result: { ok: false, reason: 'activation_threw', sendCount: 1, activated: true } } })
  assert.equal(sent.outcome, 'activation_outcome_unknown', 'a refusal that sent something is not a refusal')
  assert.equal(sent.sendCount, 1, 'and the count it DID report is kept, not zeroed')
  assert.notEqual(sent.refusal, 'activation_threw', 'it must not be presented as a clean refusal')
})

/* ── 3. success still works ───────────────────────────────────────────────── */

test('*** POSITIVE CONTROL — a normal activation still reaches save_verified ***', () => {
  const sv = save({ env: { ok: true, result: { ok: true, sendCount: 1, activated: true } } }, true)
  assert.equal(sv.outcome, 'save_verified', 'the ordinary path is untouched')
  assert.equal(sv.sendCount, 1)
})

/* ── 4. the unknown survives into the audit, and is not flattened to false ── */

test('*** the executor records activated as null, not false, when it is unknown ***', () => {
  const err = new Error('timeout'); err.reason = 'timeout'
  const { adapter } = adapterWith({ throws: err }, false)

  const o = {
    orderId: 'wo_unknown', approvalId: 'appr_' + 'u'.repeat(32), sealed: true, sealedText: TEXT,
    allowedPath: ALLOWED, maxSteps: 3, timeoutSec: 300,
    steps: [
      { n: 1, action: 'open_app', appId: 'notepad' },
      { n: 2, action: 'type_text', text: TEXT },
      { n: 3, action: 'save', fileName: 'canary-save-1.txt' }
    ]
  }
  o.orderHash = computeOrderHash(o)

  const records = []
  const ex = createComputerExecutor({
    artifactStore: { write: (c, r) => { records.push(r); return { ok: true, id: r.id } } },
    desktop: adapter,
    orderRegistry: createOrderRegistry({ singleUse: true }),
    fsProbe: { exists: () => false }
  })
  const res = ex.execute(o, { flagOn: true, attestedSessionId: 1 })
  assert.equal(res.ok, false, 'an unknown activation is not a success')

  const attempted = records.find((r) => r.kind === 'activation_attempted')
  assert.ok(attempted, 'the attempt is recorded — a message may have gone out')
  assert.equal(attempted.activated, null, 'activated is UNKNOWN, not false')
  assert.equal(attempted.sendCount, null, 'and no count is invented')

  const unknown = records.find((r) => r.kind === 'activation_outcome_unknown')
  assert.ok(unknown, 'the outcome record is the terminal unknown, not a refusal')
  assert.equal(records.some((r) => r.kind === 'save_refused'), false, 'nothing claims a clean refusal')
  assert.equal(records.some((r) => r.kind === 'save_verified'), false, 'and nothing claims a save')
})

/* ── 5. the shape that was there before must be detectable ────────────────── */

test('*** POSITIVE CONTROL — the OLD adapter shape fails these assertions ***', () => {
  // Exactly what the code used to build on a thrown runner. If assertClaimsNothingSent could not
  // catch this, it would be proving nothing about the new code either.
  const oldShape = {
    outcome: 'save_refused',
    refusal: 'timeout',
    sendCount: 0,
    activated: false,
    detail: 'refused before sending: timeout'
  }
  assert.throws(() => assertClaimsNothingSent(oldShape, 'old shape'), /sendCount must NOT be 0/)
})

test('*** the source no longer hard-codes a count on the unanswered paths ***', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const src = fs.readFileSync(path.join(__dirname, 'desktopAdapter.js'), 'utf8')
  const block = src.slice(src.indexOf('-- 2. ACTIVATE'), src.indexOf('-- 3. OBSERVE'))

  assert.equal(/reason: [^\n]*sendCount: 0/.test(block), false,
    'no transport/catch path may construct a zero count')
  assert.match(block, /sendCount: null/, 'the unanswered path states unknown explicitly')
  assert.match(block, /outcome: 'activation_outcome_unknown'/, 'and maps to the terminal outcome')
})
