'use strict'
/**
 * envelopeUnreadable.test.js — a failure at the loop boundary must not look like a completion.
 *
 * ⛔ NO NETWORK, NO MODEL. The adapter is a fake that returns unparseable text.
 *
 * HR-67. For a month `catch (_) { return { type: 'final' } }` reported an unreadable envelope
 * as a finished answer, and every layer downstream reasoned correctly from that false premise.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

/**
 * Executable lines only. The fix's own comment QUOTES the defective pattern verbatim — 「this
 * was `catch (_) { return { type: 'final' } }`」 — so a naive search finds the documentation and
 * reports the defect still present. The first version of this test did exactly that.
 */
function codeOnly (src) {
  return src.split('\n')
    .filter((l) => { const t = l.trim(); return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) })
    .join('\n')
}

test('*** ⛔ the bare catch is gone from the loop boundary ***', () => {
  const src = fs.readFileSync(path.resolve(__dirname, 'intakeService.js'), 'utf8')

  // ⛔ THE EXACT SHAPE THAT CAUSED IT, asserted absent from CODE. A bare catch that returns a
  // decision is the defect; a catch that inspects the error and says so is not.
  assert.equal(/catch \(_\) \{ return \{ type: 'final'/.test(codeOnly(src)), false,
    '⛔ a bare catch returning final is how a failure became a completion')

  // And the failure is announced under its own event name, not as a field on the success line.
  assert.ok(src.includes("event: 'ENVELOPE_UNREADABLE'"),
    'the failure has its own log event — a reader greps for what went wrong')
  assert.ok(/tel\.envelopeUnreadable = true/.test(src), 'and it reaches telemetry')
})

test('*** ⛔ the success line and the failure line are not the same line ***', () => {
  const src = fs.readFileSync(path.resolve(__dirname, 'intakeService.js'), 'utf8')
  const i = src.indexOf("event: 'ENVELOPE_UNREADABLE'")
  assert.ok(i > 0)
  const block = src.slice(i - 400, i + 400)

  // ⛔ THIS IS THE WHOLE POINT OF THE FIX. They printed identically before, which is what let
  // it survive a month of being read: 'decisionType: final, stopReason: final' for both.
  assert.equal(/decisionType: 'final'/.test(block), false,
    'the unreadable case must not reuse the completion vocabulary')
  assert.ok(/NOT a completed answer/.test(block), 'and it says so in the line itself')
})

test('*** the decision still carries the marker downstream ***', () => {
  const src = fs.readFileSync(path.resolve(__dirname, 'intakeService.js'), 'utf8')
  assert.ok(/return \{ type: 'final', result: null, unreadable: true \}/.test(src),
    'a caller that reads the decision can tell too, not only a log reader')
})

test('*** ⛔ the OTHER guard on this boundary reports the same way (routeEvidenceGuard) ***', () => {
  // The sweep found a second instance of the shape: a routing failure returned the guard's
  // `none` object, whose `violated: false` reads as "the guard checked and found nothing
  // wrong". Recorded here so the next reader of that file finds this assertion first.
  const g = fs.readFileSync(path.resolve(__dirname, 'routeEvidenceGuard.js'), 'utf8')
  const hasBareCatch = /catch \(_\) \{ return none \}/.test(g)
  assert.equal(hasBareCatch, true,
    'STILL PRESENT and deliberately not changed in this round — see HR-67 §sweep. ' +
    'If this assertion fails, the guard was fixed and this test should become the assertion ' +
    'that it stays fixed.')
})
