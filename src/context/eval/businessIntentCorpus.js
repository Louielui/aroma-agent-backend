'use strict'
/**
 * businessIntentCorpus.js — HOW FAR DOES THE DETERMINISTIC MATCHER ACTUALLY GENERALISE?
 *
 * 「今日邊啲貨要補？」 was closed by adding one literal. That fixed one sentence. This corpus
 * exists to find out what the NEXT hundred sentences do, before anyone adds a hundred more
 * literals.
 *
 * RULE OF CONSTRUCTION: these are not paraphrases of the intent table. Rows were written from
 * the business question a chef actually has, and only then checked against the vocabulary.
 * Writing them the other way round measures the table against itself and always scores well.
 *
 * cls:
 *   A direct canonical    - uses table vocabulary; the control group
 *   B natural colloquial  - same meaning, no table word
 *   C topicalised         - object fronted, verb after
 *   D implied domain      - business meaning clear, canonical noun absent
 *   E date/time modified
 *   F comparison / ranking
 *   G negative / empty-state
 *   H adversarial         - nearby meaning that must NOT match
 */

const AS = 'aroma_system'
const R = (q, cls, intent, source, note) => ({
  q, cls, note: note || null,
  expect: {
    kind: intent ? 'BUSINESS' : 'NON_BUSINESS',
    intent, source, mode: 'READ', clarifyOk: !!note
  }
})
const ACT = (q) => ({
  q, cls: 'H', note: null,
  expect: { kind: 'BUSINESS', intent: null, source: null, mode: 'ACTION', clarifyOk: true }
})

const CORPUS = [
  R('今日有咩要訂貨？', 'A', 'order_planning', AS),
  R('睇下補貨建議', 'A', 'order_planning', AS),
  R('今日邊啲貨要補？', 'C', 'order_planning', AS),
  R('啲貨邊樣要訂？', 'C', 'order_planning', AS),
  R('有咩貨唔夠要入返？', 'B', 'order_planning', AS),
  R('有啲咩要買返嚟？', 'B', 'order_planning', AS),
  R('今日要入啲乜？', 'B', 'order_planning', AS),
  R('聽日要訂啲乜？', 'E', 'order_planning', AS),
  R('邊樣要訂最多？', 'F', 'order_planning', AS),
  R('今日有冇嘢要訂？', 'G', 'order_planning', AS),
  R('幫我訂枱兩位', 'H', null, null),
  R('幫我訂機票去台北', 'H', null, null),

  R('而家庫存仲有幾多？', 'A', 'inventory', AS),
  R('睇下存量', 'A', 'inventory', AS),
  R('仲有幾多貨？', 'B', 'inventory', AS),
  R('啲貨夠唔夠？', 'B', 'inventory', AS),
  R('雪櫃仲有幾多？', 'B', 'inventory', AS),
  R('存量邊樣最低？', 'F', 'inventory', AS),
  R('邊樣存貨最少？', 'F', 'inventory', AS),
  R('有冇嘢斷咗貨？', 'G', 'inventory', AS),
  R('今日存量點？', 'E', 'inventory', AS),
  R('倉庫租金幾多錢？', 'H', null, null),

  R('睇下發票', 'A', 'invoice', AS),
  R('今日張發票幾號到期', 'E', 'invoice', AS),
  R('有邊幾張單未找？', 'B', 'invoice', AS),
  R('今個月啲單幾多錢？', 'B', 'invoice', AS),
  R('邊張單金額最大？', 'F', 'invoice', AS),
  R('有冇未付嘅單？', 'G', 'invoice', AS),
  R('張發票幾時到期？', 'C', 'invoice', AS),

  R('睇下採購單', 'A', 'purchase_order', AS),
  R('有咩仲未到？', 'B', 'purchase_order', AS),
  R('叫咗嘅貨到咗未？', 'B', 'purchase_order', AS),
  R('採購單邊張未收？', 'C', 'purchase_order', AS),
  R('有冇未到貨嘅單？', 'G', 'purchase_order', AS),
  R('上星期落咗幾多張單？', 'E', 'purchase_order', AS),

  R('今日盤點結果點？', 'A', 'daily_count', AS),
  R('今日數貨數成點？', 'B', 'daily_count', AS),
  R('今日點貨有冇問題？', 'B', 'daily_count', AS),
  R('今日盤點有冇異常？', 'D', 'daily_count', AS),
  R('今日啲貨要點算？', 'H', null, null),
  R('啲貨要點處理好？', 'H', null, null),

  R('邊個供應商供呢樣？', 'A', 'supplier', AS),
  R('呢樣嘢我哋同邊個買？', 'B', 'supplier', AS),
  R('邊間出呢隻貨？', 'B', 'supplier', AS),
  R('供應商邊間最平？', 'F', 'supplier', AS),

  R('今日有咩要跟進？', 'D', null, null, 'genuinely ambiguous - clarification is the right answer'),
  R('今日廚房有咩要留意？', 'D', null, null, 'ambiguous across inventory/order_planning/daily_count'),
  R('有咩嘢就快唔夠？', 'D', 'inventory', AS),
  R('有咩要我而家決定？', 'D', null, null, 'ambiguous'),

  R('聽日有咩安排？', 'A', 'schedule', 'calendar'),
  R('聽日搞乜？', 'B', 'schedule', 'calendar'),
  R('有冇新郵件？', 'A', 'mail', 'gmail'),
  R('有冇人覆咗我？', 'B', 'mail', 'gmail'),
  R('份 spec 喺邊？', 'B', 'document', 'drive'),
  R('睇下嗰份文件', 'A', 'document', 'drive'),
  R('最近有咩改動？', 'A', 'code', 'github'),

  R('今日幾月幾號', 'H', null, null),
  R('而家幾點？', 'H', null, null),
  R('12 加 8 等於幾多', 'H', null, null),
  R('你好嗎？', 'H', null, null),
  R('多謝晒', 'H', null, null),

  R('呢份報告要補充說明', 'H', null, null),
  R('需要補多啲背景', 'H', null, null),
  R('我要補返個假期申請', 'H', null, null),

  ACT('幫我落單訂 10 箱菜'),
  ACT('幫我寄封信畀供應商'),
  ACT('幫我改個檔案名'),
  ACT('幫我開張發票畀客')
]

module.exports = { CORPUS }
