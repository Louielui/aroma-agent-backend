'use strict'

/**
 * intentSeparable.test.js — 訂…貨 with something in the middle is still 訂貨.
 *
 * > **Owner: 「fix the mechanism rather than adding words. 訂…貨 with something in the middle
 * > will recur in every intent, and adding 訂什麼貨 to a list is the 「improve the matching」
 * > shape we removed from the recall check.」**
 *
 * ── WHY A TWO-CHARACTER KEYWORD AND NOT ALL OF THEM ──────────────────────────
 * 訂貨, 補貨, 落單, 叫貨 are verb-object compounds, and in Chinese those SEPARATE: the object
 * stays put and a question word lands between the halves — 訂什麼貨, 叫幾多貨, 落邊張單.
 * 採購單 and 供應商 are lexical nouns and do not behave that way. So the gap is allowed only
 * between the two halves of a TWO-character term, which is where the phenomenon actually is.
 *
 * ── THE BOUND WAS MEASURED, NOT CHOSEN ───────────────────────────────────────
 * Against a 15-phrase corpus of realistic messages, allowing N characters between the halves:
 *
 *     N=1  →  0 changes  (does not even fix the real case: 什麼 is two characters)
 *     N=2  →  1 change   (the real case, and NOTHING else moved)
 *     N=3  →  3 changes  (「我訂咗一批貨」 and 「訂位嗰啲貨物資料」 become order_planning —
 *                         the second is a TABLE BOOKING and has nothing to do with stock)
 *
 * N=2 is therefore the largest bound that introduces no false positive, and the number is
 * not arbitrary: 什麼 / 咩嘢 / 幾多 / 邊啲 are all one or two characters. Three or more
 * between the halves usually means they belong to different words.
 *
 * ⚠ WHAT THIS CANNOT SEE: the corpus is fifteen phrases I wrote, not a record of what the
 * Owner types. It shows the change is safe for the shapes tested; it cannot show it is safe
 * for the shapes nobody thought of. The NO_READ_CLAIM_NOTED counter added alongside this is
 * what will eventually answer that with real turns.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { intentFor } = require('./readContext')

test('*** ⛔ THE REAL MESSAGE, 2026-08-08 ***', () => {
  const hit = intentFor('香香, 到aroma system, 看看今天要向costco訂什麼貨')
  assert.ok(hit, 'a separable compound with a question word inside it is still the compound')
  assert.equal(hit.key, 'order_planning')
})

test('*** other separable forms of the same compounds ***', () => {
  for (const [msg, key] of [
    ['今日要訂咩貨', 'order_planning'],
    ['要叫幾多貨', 'order_planning'],
    ['今個星期要補啲咩貨', 'order_planning']
  ]) {
    const hit = intentFor(msg)
    assert.ok(hit, 'no match for: ' + msg)
    assert.equal(hit.key, key, msg)
  }
})

test('*** ⛔ the false positives the measurement rejected stay rejected ***', () => {
  // 訂位 is booking a table. If this ever matches order_planning the bound has been widened
  // past what was measured, and this test is the reason not to.
  assert.equal(intentFor('訂位嗰啲貨物資料'), null)
})

test('*** every phrasing that worked before still routes exactly where it did ***', () => {
  for (const [msg, key] of [
    ['今日要訂貨嗎', 'order_planning'],
    ['睇下要補貨乜嘢', 'order_planning'],
    ['訂單幾時到', 'purchase_order'],
    ['呢張採購單入咗貨未', 'purchase_order'],
    ['我要落一張訂單', 'purchase_order'],
    ['睇下倉存', 'inventory'],
    ['存貨夠唔夠', 'inventory'],
    ['邊個供應商最貴', 'supplier'],
    ['發票有幾多張未批', 'invoice'],
    ['今日盤點做咗未', 'daily_count']
  ]) {
    const hit = intentFor(msg)
    assert.ok(hit, 'REGRESSION — no longer matches: ' + msg)
    assert.equal(hit.key, key, 'REGRESSION — ' + msg + ' moved intent')
  }
})

test('*** a three-character term is NOT separated — the phenomenon is specific to pairs ***', () => {
  // ⛔ THE FIRST FIXTURE HERE WAS 「採了購物單」 AND IT PROVED NOTHING. It matched — but via
  // 採購, which IS a two-character keyword in the same list, so the test would have passed
  // or failed for a reason unrelated to its own name. Caught by running it, not by writing it.
  // 供應商 / 入貨單 / 批發商 are three-character keywords containing no two-character keyword.
  assert.equal(intentFor('供了應商'), null)
  assert.equal(intentFor('入了貨單'), null)
  assert.equal(intentFor('批了發商'), null)
})

test('*** the gap may not cross clause punctuation ***', () => {
  // 訂 at the end of one clause and 貨 at the start of the next are two different statements.
  assert.equal(intentFor('今日唔使訂。貨都夠晒'), null)
})
