'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { enforceInternalSystemAnswer, asksInternalVsPublic } = require('./internalSystemAnswer')
const { ensureNonEmptyReply, EMPTY_REPLY_DEFECT } = require('./nonEmptyReply')
const { selfDescription } = require('./selfDescription')

const URL = selfDescription({ env: {} }).aromaSystem.baseUrl
const ASK_URL = 'aroma system的網址我沒有了, 給我一下'

/**
 * ⛔ VERBATIM, 17:18 local, real UI, empty history, on the merged supply path. The URL was
 * delivered AND the same internal-vs-public question was appended — because 「我哋現有」 is not
 * 「我哋自己」. The worst available shape: she answers correctly, then says she does not know.
 */
const LEAKED = '你嘅 Aroma System 網址係 https://system.aromabistro741.com。\n\n你係想要我哋現有 Aroma System 嘅網址，定係公開網站網址？'

test('*** ⛔ TURN 1 — the URL ships and NO internal-vs-public question survives ***', () => {
  const out = enforceInternalSystemAnswer({ reply: LEAKED, message: ASK_URL })
  assert.ok(out.reply.includes(URL), 'the URL is present')
  assert.equal(out.reply.includes('定係公開網站'), false, '⛔ the appended question shipped: ' + out.reply)
  assert.equal(out.composed, true, 'this turn is composed, not filtered')
})

test('*** ⛔ 「我哋現有」 — the exact phrasing that leaked — cannot survive ***', () => {
  // It leaked because INTERNAL_REF has 「我哋自己」 and not 「我哋現有」. Composition does not
  // care: nothing the model wrote reaches the Owner on a covered turn, so no vocabulary needs
  // to anticipate it.
  assert.equal(asksInternalVsPublic(LEAKED), false, 'the FILTER still cannot see it — that is the point')
  const out = enforceInternalSystemAnswer({ reply: LEAKED, message: ASK_URL })
  assert.equal(/我哋現有/.test(out.reply), false, '⛔ it survived: ' + out.reply)
})

test('*** ⛔ ANY model output on a covered turn is discarded, however phrased ***', () => {
  // The guarantee is by construction. These are inventions no vocabulary would catch.
  const wild = [
    '你指嘅係 our current one 定係 the public-facing one?',
    '想問下你講緊邊個 —— 舖頭嗰個，定係出面嗰個？',
    '',
    'Aroma System 冇網址。'
  ]
  for (const reply of wild) {
    const out = enforceInternalSystemAnswer({ reply, message: ASK_URL })
    assert.ok(out.reply.includes(URL), '⛔ URL missing for ' + JSON.stringify(reply))
    assert.equal(out.reply.includes(reply.trim()) && reply.trim().length > 0, false,
      '⛔ model text leaked through: ' + JSON.stringify(reply))
  }
})

test('*** ⛔ NOT-COVERED questions are untouched — composition is narrow ***', () => {
  const refusal = '我讀到 public_knowledge 1 項記錄。資料讀取成功，但這一次我組不出一個可靠的答案，所以不會亂說。'
  for (const m of ['aroma system 有幾多張發票？', '公開網站網址是什麼?', '今日天氣點？', 'aroma system 內部有幾多張發票？']) {
    const out = enforceInternalSystemAnswer({ reply: refusal, message: m })
    assert.equal(out.reply, refusal, '⛔ touched a not-covered turn: ' + m)
    assert.equal(out.composed, false)
  }
})

/* ═══ THE EMPTY REPLY ═════════════════════════════════════════════════════ */

test('*** ⛔ AN EMPTY REPLY IS A DEFECT STATE, NEVER SILENCE ***', () => {
  // 17:18 turn 2 shipped content:"" with servedBy set — a completed call that said nothing.
  // An empty reply is worse than a wrong one because it carries no signal at all.
  for (const v of ['', '   ', '\n\n', null, undefined]) {
    const out = ensureNonEmptyReply(v)
    assert.equal(out.wasEmpty, true, 'flagged for ' + JSON.stringify(v))
    assert.ok(out.reply.trim().length > 0, '⛔ shipped empty for ' + JSON.stringify(v))
    assert.equal(out.reply, EMPTY_REPLY_DEFECT, 'and it is the one defined sentence')
  }
})

test('*** a real reply passes through byte-identical ***', () => {
  for (const r of ['你好。', LEAKED, '倉存有 199 項。']) {
    const out = ensureNonEmptyReply(r)
    assert.equal(out.wasEmpty, false)
    assert.equal(out.reply, r)
  }
})

test('*** ⛔ the defect sentence SAYS it is a defect — it must not read as an answer ***', () => {
  // A placeholder that reads like content would reproduce the silence one layer up.
  assert.ok(/故障|出錯|冇產生|系統/.test(EMPTY_REPLY_DEFECT), EMPTY_REPLY_DEFECT)
  assert.equal(EMPTY_REPLY_DEFECT.trim().length > 10, true)
})

test('*** ⛔ removal emptying the text cannot ship: composition + non-empty compose safely ***', () => {
  // The exact hazard named in the work order: if every sentence were removed, the result must
  // still be a defined non-empty outcome.
  const onlyQuestion = '你講嘅 aroma system 係我哋內部系統，定係公開網站？'
  const out = ensureNonEmptyReply(enforceInternalSystemAnswer({ reply: onlyQuestion, message: ASK_URL }).reply)
  assert.equal(out.wasEmpty, false, 'composition already supplied a fact, so nothing was empty')
  assert.ok(out.reply.includes(URL))
})
