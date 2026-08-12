'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { asksInternalVsPublic, correctInternalSystemReply } = require('./internalSystemAnswer')

/**
 * ⛔ VERBATIM from data/conversations/07d3fbcf-7f9b-4fad-b952-fd7b1590eabf.json, messages
 * [5] and [9], observed 2026-08-12 21:43:32Z and 21:46:03Z on commit 02e430e through the real
 * UI. Not invented, not paraphrased — two DIFFERENT model-authored phrasings of the same
 * defect, which is why a substring match on either one would be worthless.
 */
const DEFECT_5 = '你講嘅 aroma system 係我哋內部系統，定係公開網站？'
const DEFECT_9 = '你想修改同開發嘅 Aroma System，係指內部使用嘅系統，定係公開網站？'

/** [3] from the same session — the CORRECT answer, which also ends in a question. */
const GOOD_3 = '可以。我能讀取 Aroma System 的六個唯讀端點：倉存、供應商、盤點紀錄、訂貨建議、採購單、發票。不過我讀得到讀不到，要真的去讀一次先知——我不會用設定當答案。你想我查什麼？'

test('*** ⛔ BOTH observed phrasings are caught, and they differ from each other ***', () => {
  assert.equal(asksInternalVsPublic(DEFECT_5), true, 'message [5]')
  assert.equal(asksInternalVsPublic(DEFECT_9), true, 'message [9]')
  // If these two ever share a substring the detector keys on, the detector is brittle.
  assert.notEqual(DEFECT_5, DEFECT_9)
})

test('*** ⛔ THE GOOD ANSWER IS NOT CAUGHT — and it ends in a question too ***', () => {
  // 「你想我查什麼？」 makes 「is it a question」 useless as a signal on its own. This is the
  // false positive that would matter most: suppressing a correct, useful reply.
  assert.equal(asksInternalVsPublic(GOOD_3), false)
  assert.equal(correctInternalSystemReply({ reply: GOOD_3, message: '你能看到aroma system嗎?' }).corrected, false)
})

test('*** ⛔ LEGITIMATE clarification on another axis passes through UNTOUCHED ***', () => {
  // The Owner's constraint: only the internal-vs-public axis is a known fact. Everything else
  // is a real question she is entitled to ask.
  const others = [
    '你想睇邊個端點：倉存定係發票？',                    // which endpoint
    '你想睇今日定係過去七日嘅盤點？',                     // which time range
    '你講嘅係邊個倉？中央倉定係門市？',                   // which location
    'Aroma System 入面你想改邊一版？',                   // which page
    /**
     * ⛔ THE CASE THAT BINDS `PUBLIC_REF`, AND IT WAS MISSING.
     *
     * A mutation run dropped the PUBLIC_REF requirement from the detector and NOTHING went
     * red — none of the cases above mentions 內部, so the condition was unpinned and could
     * have been deleted by anyone tidying up. This sentence names the internal system AND
     * offers a choice AND is a question, and is still perfectly legitimate: the axis is which
     * endpoint, not internal-versus-public.
     */
    '你想睇內部系統嘅倉存定係發票？'
  ]
  for (const r of others) {
    assert.equal(asksInternalVsPublic(r), false, '⛔ suppressed a legitimate question: ' + r)
    const out = correctInternalSystemReply({ reply: r, message: '睇下 aroma system' })
    assert.equal(out.corrected, false)
    assert.equal(out.reply, r, 'byte-identical passthrough')
  }
})

test('*** the precondition holds: no user mention of her system, no correction ***', () => {
  // The check may only fire where the fact is known to apply.
  const out = correctInternalSystemReply({ reply: DEFECT_5, message: '今日天氣點' })
  assert.equal(out.corrected, false, 'nothing about Aroma System was asked')
  assert.equal(out.reply, DEFECT_5)
})

test('*** ⛔ ON DETECTION the disambiguation does not ship, and the FACT does ***', () => {
  const out = correctInternalSystemReply({ reply: DEFECT_5, message: 'aroma system的網址我沒有了, 給我一下' })
  assert.equal(out.corrected, true)
  assert.notEqual(out.reply, DEFECT_5, '⛔ it must not ship as-is')
  assert.equal(asksInternalVsPublic(out.reply), false, 'and the replacement does not ask again')
  assert.ok(/system\.aromabistro741\.com|內部/.test(out.reply), 'it states the fact: ' + out.reply)
})

test('*** ⛔ content that is NOT the disambiguation survives the correction ***', () => {
  // A reply that answers AND then asks the known question must keep its answer. Destroying
  // real content to remove one sentence would be a worse defect than the one being fixed.
  const mixed = '倉存有 199 項。' + DEFECT_5
  const out = correctInternalSystemReply({ reply: mixed, message: '睇下 aroma system 倉存' })
  assert.equal(out.corrected, true)
  assert.ok(out.reply.includes('倉存有 199 項。'), '⛔ the real answer was destroyed: ' + out.reply)
  assert.equal(asksInternalVsPublic(out.reply), false)
})

test('*** rubbish input never throws and never claims a correction ***', () => {
  for (const v of [undefined, null, {}, { reply: null, message: null }, { reply: '', message: 'aroma system' }]) {
    const out = correctInternalSystemReply(v)
    assert.equal(out.corrected, false)
  }
  for (const v of [undefined, null, 42, {}]) assert.equal(asksInternalVsPublic(v), false)
})
