'use strict'

/**
 * offerVisibility.test.js — the offer was computed, sent, and thrown away.
 *
 * The Owner hard-reloaded, typed the phrasing that has always been refused, and got the
 * same refusal with no button. Measured afterwards, the server side was entirely correct:
 *
 *   isChangeRequest  { ok: true }
 *   refusesChange    false
 *   inferWorkRequest file + intent, question: null
 *   offerFor         { file, intent, source: 'deterministic' }
 *
 * The offer reached the browser and my own dispatch order discarded it:
 *
 *   if (res.demoOutcome === 'clarification') return renderProposal(...)   // returns first
 *   if (res.workRequestOffer) return renderOffer(...)                     // dead code
 *
 * `clarification` IS the outcome of the turn the offer exists to rescue — the model
 * declining to produce a task. Placing the offer after it meant the offer could only ever
 * render on turns that did not need it.
 *
 * ── AND IT LEFT NO TRACE, WHICH IS WHY THIS TOOK REASONING RATHER THAN READING ──
 * The offer logged nothing when it fired and nothing when it declined. The classifier's
 * verdict was in the log for that exact turn (mode:'ask', clarificationReason:
 * 'not_a_commit_intent'); the offer's was not. That is the same shape removed five times
 * this week, reintroduced in the new code by the same person who removed it.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const CLIENT = fs.readFileSync(path.join(__dirname, '..', 'demo', 'assets', 'app.js'), 'utf8')
const ROUTER = fs.readFileSync(path.join(__dirname, 'demoRouter.js'), 'utf8')
const { explainOffer, offerFor } = require('./workRequestOffer')
const { FIELDS } = require('../utils/intakeOutcomeLog')

const MSG = '幫我改 docs/canary/agent-canary.md，第二行改成 line 3'

/* ═══ 1. THE ORDER — the offer must be reached on the turn it exists for ══ */

test('*** the offer is checked BEFORE the clarification branch ***', () => {
  const offerAt = CLIENT.indexOf('res.workRequestOffer')
  const clarAt = CLIENT.indexOf("res.demoOutcome === 'clarification'")
  assert.ok(offerAt > 0 && clarAt > 0, 'branches not found')
  assert.ok(offerAt < clarAt,
    'the clarification branch returns first, so the offer is dead code on exactly the turn it is for')
})

test('*** the offer still yields to a turn that produced a real proposal ***', () => {
  // execution_proposal means the model path worked and a card is coming. The offer must not
  // pre-empt that — offerFor already declines when hasProposal is true, and the client must
  // agree rather than relying on it alone.
  const offerAt = CLIENT.indexOf('res.workRequestOffer')
  const execAt = CLIENT.indexOf("res.demoOutcome === 'execution_proposal'")
  assert.ok(execAt > 0)
  assert.ok(execAt < offerAt, 'the offer would pre-empt a real proposal')
})

/* ═══ 2. THE TRACE — a decision that leaves no record is not observable ══ */

test('*** the offer explains itself, firing or declining ***', () => {
  const fired = explainOffer({ message: MSG, hasProposal: false })
  assert.ok(fired.offer, 'should fire')
  assert.equal(fired.reason, null)

  for (const [m, want] of [
    ['唔好改 docs/notes.md', 'negated'],
    ['我啱啱改咗 docs/notes.md 第三行', 'reported'],
    ['你好呀', 'no_verb'],
    ['幫我改 docs/notes.md', 'incomplete'],
    ['幫我改 .env，加一個 key', 'incomplete']
  ]) {
    const d = explainOffer({ message: m, hasProposal: false })
    assert.equal(d.offer, null, m)
    assert.equal(d.reason, want, m + ' → ' + d.reason)
  }
})

test('a turn that already has a proposal declines with its own reason', () => {
  const d = explainOffer({ message: MSG, hasProposal: true })
  assert.equal(d.offer, null)
  assert.equal(d.reason, 'model_path_owns_turn')
})

test('offerFor is unchanged — the thin wrapper the callers already use', () => {
  assert.deepEqual(offerFor({ message: MSG, hasProposal: false }), explainOffer({ message: MSG, hasProposal: false }).offer)
  assert.equal(offerFor({ message: '你好呀', hasProposal: false }), null)
})

/* ═══ 3. AND THE TRACE REACHES THE LOG ═══════════════════════════════════ */

test('*** the outcome line carries whether the offer fired, and why not ***', () => {
  for (const f of ['workRequestOffer', 'offerDeclined']) {
    assert.ok(FIELDS.includes(f), 'not in the allowlist: ' + f)
  }
})

test('*** demoRouter records the decision — it is not computed and forgotten ***', () => {
  const at = ROUTER.indexOf('explainOffer(')
  assert.ok(at > 0, 'the router still calls the silent form')
  const body = ROUTER.slice(at, at + 900)
  assert.ok(/telemetry\.workRequestOffer/.test(body), 'the firing is not recorded')
  assert.ok(/telemetry\.offerDeclined/.test(body), 'the reason is not recorded')
})

test('the reason is a short enum — never the message, never a path', () => {
  const d = explainOffer({ message: '幫我改 C:/secret/private.md，第二行改成 x', hasProposal: false })
  const json = JSON.stringify(d.reason)
  assert.equal(/private|secret|幫我/.test(json), false, 'content rode in the reason: ' + json)
  assert.ok(d.reason === null || d.reason.length <= 32)
})

/* ═══ 4. THE RECORD MUST BE WRITTEN BEFORE THE LINE IS EMITTED ═══════════ */

test('*** the offer telemetry is set BEFORE emit() writes the line ***', () => {
  // The second instance of HR-8, inside the fix for the first. The fields were on the
  // allowlist and correctly named, and set at line 364 while emit() wrote the record at
  // line 260 — so they could never appear. Correct instrumentation, written after the thing
  // that reads it, is not instrumentation; it is a variable.
  const setAt = ROUTER.indexOf('telemetry.workRequestOffer')
  const emitAt = ROUTER.indexOf("emit('success'")
  assert.ok(setAt > 0 && emitAt > 0, 'markers not found')
  assert.ok(setAt < emitAt,
    'the offer decision is recorded after the outcome line is written — it can never appear')
})

test('the decision is computed from the result the turn actually produced', () => {
  // Moving it earlier must not change WHAT it decides: a turn that already carries a
  // proposal still declines with model_path_owns_turn.
  const at = ROUTER.indexOf('explainOffer(')
  const body = ROUTER.slice(at, at + 300)
  assert.ok(/hasProposal:/.test(body), 'the proposal check was dropped in the move')
})
