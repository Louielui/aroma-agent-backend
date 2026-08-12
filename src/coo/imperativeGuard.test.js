'use strict'

/**
 * imperativeGuard.test.js — 「給我 X」 must not become a work order.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE DEFECT, MEASURED (HR-75).
 *
 * `routedNotAnAction` required `route.reason !== 'default'`, so:
 *
 *   GUARD ON   CONVERSATION/question   「Aroma System 的 website 是什麼？」
 *   GUARD OFF  CONVERSATION/default    「給我 Aroma System 的 website」
 *
 * The same question phrased as a REQUEST turned the deterministic cover off, the model's
 * `develop` claim stood unchallenged, and the turn came back as the proposal lane's
 * 「尚未建立任何提案」. `reason` is only INTERROGATIVE-or-not (`laneRouter.js:121`), so the
 * override protected questions and not requests — and 「給我 X」 is how the Owner asks for
 * most things.
 *
 * ⛔ AND THE OBVIOUS FIX IS WRONG. Dropping the `!== 'default'` clause was measured first:
 * EVERY genuine work request also routes CONVERSATION/default, because the PROPOSAL lane
 * needs a change verb AND a file object AND no question mark. So a blanket fix would convert
 * every development request into chat — the LOST INSTRUCTION failure `intent.js` already
 * documents as the worse one. The clause is load-bearing.
 *
 * So the guard gets its own signal instead: **a sentence containing no change-ish verb at all
 * is positively not a change request.** That is a statement, not an absence of one.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { proposesAChange } = require('./intent')

const ASKS = [
  '給我 Aroma System 的 website',
  '俾個電話號碼我',
  '今日天氣點',
  '你好'
]

const WORK = [
  '幫我加一個匯出按鈕',
  '改一改個首頁嘅標題',
  '幫我整一個新頁面出嚟',
  '修復登入嗰個 bug',
  '部署最新版本上去',
  '寫個 script 幫我跑數'
]

test('*** ⛔ 「給我 X」 proposes no change, so the guard may reject a develop claim ***', () => {
  for (const m of ASKS) {
    assert.equal(proposesAChange(m), false, '⛔ must read as NO change proposed: ' + m)
  }
})

test('*** ⛔ EVERY genuine work request still proposes a change — none may be lost ***', () => {
  // This is the half that matters more. A lost instruction is worse than a spurious proposal:
  // the Owner asks for work, is told it was a chat, and never learns he asked.
  for (const m of WORK) {
    assert.equal(proposesAChange(m), true, '⛔ WORK REQUEST WOULD BE LOST: ' + m)
  }
})

test('*** the net is deliberately WIDE, and the direction of its error is stated ***', () => {
  // Over-matching means the guard stays out of the way and the model decides — which is the
  // pre-existing behaviour. Under-matching would silently eat work. So when in doubt, match.
  assert.equal(proposesAChange('講吓你可以做咩'), true,
    '「做」 inside 「做咩」 over-matches. Recorded rather than tuned away: the cost is that this ' +
    'one sentence keeps todays behaviour, and the alternative risks eating a real instruction.')
})

test('*** ⛔ empty and non-string inputs propose nothing, and never throw ***', () => {
  for (const v of ['', '   ', null, undefined, 42, {}]) {
    assert.equal(proposesAChange(v), false, 'no input is not a change request: ' + String(v))
  }
})
