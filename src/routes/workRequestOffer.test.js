'use strict'

/**
 * workRequestOffer.test.js — the deterministic entrance to a Work Order.
 *
 * The card needed the model to classify the turn as `commit` AND return exactly one task.
 * Measured against the real model: an explicit change request returns `ask`, and the
 * prompt's OWN commit example returns `commit` with zero tasks. Two different failures, one
 * unreachable approval surface.
 *
 * Owner ruling: route it deterministically, the way UTILITY is routed. If he names a file
 * and a change, that is not a judgement call — and `inferWorkRequest` already reads both
 * with no model call.
 *
 * ── TWO ENTRANCES, ONE BEHAVIOUR ────────────────────────────────────────────
 * Both produce the SAME {file, intent} from the SAME function. Nothing downstream changes:
 * proposeWorkOrder, the seal, the hash, forbiddenActions, the TTL and the typed EXECUTE are
 * untouched. The only difference is WHO decided a request existed — the model or the
 * deterministic test — and that is recorded so the Owner can see it.
 *
 * ── AN OFFER, NOT A CARD ────────────────────────────────────────────────────
 * Owner condition, treated as necessary rather than optional: a false trigger must render
 * one sentence and a button, never a filled-in card. A filled-in card invites a reflex
 * approval, and he has said plainly that he has been approving from memory.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { offerFor } = require('./workRequestOffer')
const { inferWorkRequest } = require('../agent/requestInference')

const MSG = '幫我改 docs/canary/agent-canary.md，第二行改成 line 3'

/* ═══ 1. IT FIRES ON THE TURN THAT COULD NOT REACH A CARD ════════════════ */

test('*** the request that produced nothing now produces an offer ***', () => {
  const o = offerFor({ message: MSG, conversation: '', hasProposal: false })
  assert.ok(o, 'no offer: ' + JSON.stringify(o))
  assert.equal(o.file, 'docs/canary/agent-canary.md')
  assert.ok(o.intent && o.intent.length > 0)
})

test('*** the offer is built from inferWorkRequest — not a second reading ***', () => {
  // ONE BEHAVIOUR. If this ever diverges, two entrances would produce two different work
  // orders from the same sentence, which is the whole failure mode being avoided.
  const o = offerFor({ message: MSG, conversation: '', hasProposal: false })
  const direct = inferWorkRequest({ message: MSG, conversation: '' })
  assert.equal(o.file, direct.file)
  assert.equal(o.intent, direct.intent)
})

test('*** the offer records HOW it got there ***', () => {
  const o = offerFor({ message: MSG, conversation: '', hasProposal: false })
  assert.equal(o.source, 'deterministic', 'the Owner must be able to see which entrance was used')
})

/* ═══ 2. IT DOES NOT FIRE — every measured false trigger ═════════════════ */

test('*** none of the false triggers produce an offer ***', () => {
  for (const m of [
    '唔好改 docs/notes.md',
    '我啱啱改咗 docs/notes.md 第三行',
    'Codex 改咗 docs/notes.md 個標題',
    '如果改 docs/notes.md 第三行會點？',
    '要唔要改 docs/notes.md 第三行？',
    '我今日睇咗 docs/notes.md，幾好'
  ]) {
    assert.equal(offerFor({ message: m, conversation: '', hasProposal: false }), null, m)
  }
})

test('an incomplete request does NOT offer — it is not the offer\'s job to ask', () => {
  // 「幫我改 X」 with no WHAT: inferWorkRequest already returns a question for this, and the
  // existing conversational path is where that question belongs. The offer appears only
  // when there is nothing left to ask.
  assert.equal(offerFor({ message: '幫我改 docs/notes.md', conversation: '', hasProposal: false }), null)
  assert.equal(offerFor({ message: '幫我改一改個標題', conversation: '', hasProposal: false }), null)
})

test('*** a protected path never offers ***', () => {
  assert.equal(offerFor({ message: '幫我改 .env，加一個 key', conversation: '', hasProposal: false }), null)
  assert.equal(offerFor({ message: '幫我改 src/app.js，第二行改成 x', conversation: '', hasProposal: false }), null)
})

test('*** the deterministic entrance stands down when the model path already worked ***', () => {
  // Not two offers for one turn. When a proposal exists the existing `inferred` path owns it.
  assert.equal(offerFor({ message: MSG, conversation: '', hasProposal: true }), null)
})

test('the file must come from THIS message, not from anywhere in the conversation', () => {
  // A path mentioned three turns ago is not what he just asked to change. The conversation
  // is a fallback for the existing path; the deterministic entrance requires the sentence
  // in front of it to name the file itself.
  assert.equal(offerFor({ message: '幫我改第二行為 line 3', conversation: 'docs/notes.md', hasProposal: false }), null)
})

/* ═══ 3. THE ENVELOPE IS UNTOUCHED WHEN NOTHING FIRES ════════════════════ */

test('*** offerFor returns null, never an empty object — no field appears for nothing ***', () => {
  const out = offerFor({ message: '你好呀', conversation: '', hasProposal: false })
  assert.equal(out, null, 'a consumer must not gain a field because a greeting was typed')
})
