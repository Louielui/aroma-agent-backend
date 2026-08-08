'use strict'

/**
 * noReadClaimGuard.test.js — a turn that read NOTHING may not leave a claim about what it
 * can read standing on its own.
 *
 * > **Owner's rule, verbatim: 「冇讀過就只准講『我冇去睇』，唔准講『我冇權限』」**
 * >
 * > 「A turn that read nothing cannot make claims about what it can read, and that is
 * > enforceable without any vocabulary at all.」
 *
 * ── THE TURN THIS COMES FROM, 2026-08-08 ─────────────────────────────────────
 * 「香香, 到aroma system, 看看今天要向costco訂什麼貨」 routed CONVERSATION/question with
 * `sourcesRead: []` and `rowsRetrieved: 0` — the production log confirms it. She answered
 * 「我目前沒有直接連接到 Aroma System 的讀取權限」, which is false: CONTEXT_AROMA_SYSTEM is on
 * and six endpoints work. Nothing was read, so nothing could contradict her.
 *
 * ⛔ WHY THIS DOES NOT LOOK AT HER WORDS. `readStateGuard` matches phrasings, and that is
 * exactly how it missed this: its pattern holds 「沒有權限」 and she wrote 「沒有直接連接到
 * Aroma System 的讀取權限」. Widening the pattern is the next round (fix 2); it would still be
 * a list of ways to say a thing. THIS guard reads only the TURN RECORD — did anything get
 * read, and did he ask for a look — so no phrasing can slip past it, including phrasings
 * nobody has thought of yet.
 *
 * ⚠ WHAT IT CANNOT DO: it does not stop her saying it. It appends the record beside it, the
 * same choice `readStateGuard` made and for the same reason — a rewrite changes meaning
 * silently and a refusal loses a good answer over one clause.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { CATALOGUE } = require('../i18n/catalogue')
const { enforceNoReadClaim } = require('./readStateGuard')

const ASKED = '香香, 到aroma system, 看看今天要向costco訂什麼貨'
const HER_REPLY = '我目前沒有直接連接到 Aroma System 的讀取權限'

test('*** ⛔ THE REAL TURN: nothing read, he asked for a look → the record is appended ***', () => {
  const out = enforceNoReadClaim(HER_REPLY, [], ASKED)
  assert.equal(out.flagged, true)
  assert.ok(out.reply.startsWith(HER_REPLY), 'her words are kept intact, never edited')
  assert.ok(out.reply.includes(CATALOGUE['rsg.nothingRead'].zh),
    'the turn record is stated beside the claim')
})

test('*** it does not read her phrasing — an invented denial is caught too ***', () => {
  // Deliberately a sentence no pattern anywhere in this repo contains.
  const invented = '我跟餐廳系統之間目前並未建立任何可用的資料通道'
  const out = enforceNoReadClaim(invented, [], ASKED)
  assert.equal(out.flagged, true,
    'the trigger is the turn record, so a phrasing nobody listed is still covered')
})

test('*** a turn that DID read is left alone — this guard owns only the empty case ***', () => {
  const out = enforceNoReadClaim(HER_REPLY, [{ source: 'aroma_system', trust: 'live', count: 4 }], ASKED)
  assert.equal(out.flagged, false)
  assert.equal(out.reply, HER_REPLY, 'readStateGuard owns that case, and must not be doubled up on')
})

test('*** ordinary conversation is NOT annotated — the control must stay quiet to stay trusted ***', () => {
  // He did not ask her to look at anything. Appending a read-record note here would be
  // noise, and a control that fires on correct work gets switched off (HR-47).
  const out = enforceNoReadClaim('好，我知道了。', [], '今晚打算早點收工')
  assert.equal(out.flagged, false)
})

test('*** a lookup he asked for that legitimately found nothing to say still gets the record ***', () => {
  // She may answer honestly 「我沒有去看」 — the note is then redundant but TRUE, and
  // redundant-and-true is the safe side of this trade.
  const out = enforceNoReadClaim('我沒有去看，要我現在去看嗎？', [], ASKED)
  assert.equal(out.flagged, true)
})

test('*** the note names WHY nothing was read when the reason is known ***', () => {
  const out = enforceNoReadClaim(HER_REPLY, [], ASKED, { reason: 'question' })
  assert.ok(out.note.length > 0)
  assert.ok(!out.note.includes('undefined'))
})
