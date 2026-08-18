'use strict'

/**
 * A SUCCESSFUL READ MAY NOT END IN A HYPHEN.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE LIVE TURN, requestId aed4f643-b139-452b-88c0-327e6e6cb857, 2026-08-18 22:11Z.
 *
 * 「你可以幫我看看costco要訂什麼貨, 之後幫我把東西放到購物車嗎?」
 *
 *   TURN_ROUTE   BUSINESS_QUERY / intent_order_planning
 *   REASONING    3 reads — replenishment (via the recovery worker) and inventory, ok
 *   ANSWER_PLAN  outcome:"validated"  modelItemCount:0  keptItemCount:0
 *   persisted    "-"
 *
 * The reads worked. The model then returned a plan with NO items and NO facts, and a
 * directAnswer of one hyphen. The Owner read a hyphen.
 *
 * ⛔ WHY EVERY EXISTING GUARD LET IT THROUGH — and none of them was wrong.
 *
 *   contentLost = modelItemCount > 0 && keptItemCount === 0   ← 0 > 0 is false
 *
 * That guard means 「it offered rows and every one died」. This turn offered NOTHING, so
 * nothing was lost, so nothing fell back. `answerSurvived` was true because a hyphen makes no
 * claim that could fail. `outcome: validated` was honest: there was nothing to invalidate.
 *
 * The gap is not a broken check. It is a state no check was written for: reads succeeded, the
 * plan was structurally empty, and the sentence carried nothing.
 *
 * ⛔ THE FLOOR IS STRUCTURAL, NOT A QUALITY JUDGEMENT. It asks one question — does the
 * directAnswer contain a single Unicode letter or number? 「4」, 「冇」, 「A」 and 「庫存」 all do,
 * and all pass through untouched. A hyphen, an em dash, an ellipsis, a full stop and an emoji
 * do not. There is no minimum length, no prose scoring, no word list and no model call: a
 * short true answer must never be deleted for being short.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { buildReadResultReply } = require('./readResultView')
const { minimalAnswer } = require('./answerPlan')

const REPL = 'aroma_system.replenishment'
const INV = 'aroma_system.inventory'
const PO = 'aroma_system.purchasing'

const ev = (readKey, entityType, n, trust = 'live') => ({
  source: 'aroma_system',
  readKey,
  endpoint: 'x',
  trust,
  entityType,
  shownCount: n,
  matchingTotal: n,
  sourceTotal: null,
  queryScope: { field: null, window: null, declaredBy: 'reader' },
  rowShape: { hasLocation: false, hasAsOf: false, note: null },
  metrics: {},
  derivations: {},
  fieldLabels: {},
  completeness: 'complete'
})

const row = (readKey, id, title, entityType) => ({
  source: 'aroma_system',
  readKey,
  sourceId: id,
  title,
  entityType,
  content: 'status=confirmed',
  fields: { id },
  trust: 'live'
})

/** The two operations the incident actually read. */
const EVIDENCE = [ev(REPL, 'order_suggestion', 4), ev(INV, 'inventory_item', 4)]
const GROUPS = [
  { source: 'aroma_system', readKey: REPL, operation: REPL, items: [row(REPL, '1', 'A', 'order_suggestion')] },
  { source: 'aroma_system', readKey: INV, operation: INV, items: [row(INV, '2', 'B', 'inventory_item')] }
]

/** The Owner's real words, from the persisted conversation store. */
const MSG = '你可以幫我看看costco要訂什麼貨, 之後幫我把東西放到購物車嗎?'

const plan = (directAnswer, sections, limitations) => ({
  directAnswer, citesEvidence: true, unanswerable: false, limitations: limitations || [], followUp: null, sections: sections || []
})

function render (input) {
  const lines = []
  const real = console.log
  console.log = (...a) => {
    if (typeof a[0] === 'string' && a[0].includes('ANSWER-PLAN')) { lines.push(JSON.parse(a[1])); return }
    real.apply(console, a)
  }
  let out
  try { out = buildReadResultReply(input) } finally { console.log = real }
  return { reply: out.reply, plan: lines[0] }
}

const incident = (directAnswer) => render({
  reply: '',
  message: MSG,
  provider: 'claude',
  requestId: 'floor',
  answerPlan: plan(directAnswer),
  evidenceSets: EVIDENCE,
  itemsBySource: GROUPS
})

/**
 * ⛔ MEASURED FROM THE UNCHANGED CODE, not composed here. `minimalAnswer` is the server's own
 * sentence and this tranche does not touch its semantics; the literal is pinned so a change to
 * it has to be deliberate.
 */
const EXPECTED = '我讀到 餐廳系統 4 項訂貨建議、餐廳系統 4 項存貨記錄。資料讀取成功，但這一次我組不出一個可靠的答案，所以不會亂說。'

/* ═══ A — THE INCIDENT ══════════════════════════════════════════════════════ */

test('*** ⛔ THE COSTCO TURN — a successful read may not render as "-" ***', () => {
  const r = incident('-')
  // The premises, asserted rather than assumed: this really is the incident state.
  assert.equal(r.plan.modelItemCount, 0, 'the plan must be structurally empty')
  assert.equal(r.plan.keptItemCount, 0)

  assert.notEqual(r.reply, '-', '⛔ the Owner read a hyphen again')
  assert.equal(r.reply, EXPECTED, '⛔ the floor did not produce the server-owned sentence')
  assert.equal(r.reply, minimalAnswer(EVIDENCE), 'and it must BE minimalAnswer, not a copy of its words')
})

/* ═══ B — every meaningless shape, same state ═══════════════════════════════ */

test('*** ⛔ PUNCTUATION AND EMOJI ARE NOT ANSWERS ***', () => {
  for (const d of ['-', '—', '...', '。', '　　', '🙂', '‧‧‧', '?', '？']) {
    const r = incident(d)
    assert.equal(r.reply, EXPECTED, '⛔ a meaningless directAnswer survived: ' + JSON.stringify(d))
  }
})

/* ═══ C — a short TRUE answer must never be deleted for being short ═════════ */

test('*** ⛔ REAL CONTENT PASSES THROUGH, HOWEVER SHORT ***', () => {
  /**
   * ⛔ THIS IS THE TEST THAT FORBIDS THE EASY VERSION. A 「reply shorter than N characters」
   * rule would pass every case in B and delete 「4」 — a true, complete answer to 「幾多項？」.
   * The floor may only ask whether a letter or a number is present.
   */
  for (const d of ['4', '冇', 'A', '庫存', '有']) {
    const r = incident(d)
    assert.equal(r.reply, d, '⛔ a real short answer was replaced: ' + JSON.stringify(d))
  }

  /**
   * ⛔ 「0」 IS DELIBERATELY NOT IN THAT LIST, and the reason matters. It already falls back
   * today — `number_not_in_evidence`, because 0 is a NUMBER and this evidence carries 4.
   * That is the value-grounding rule doing its job, not the floor. Keeping it above would be
   * a fixture that passes for a reason it does not name, which is the defect this repository
   * keeps finding. Asserted here so the distinction is recorded rather than lost.
   */
  const zero = incident('0')
  assert.equal(zero.plan.droppedSentences, 1, '0 is dropped by value grounding, not by the floor')
  assert.equal(zero.plan.reason, 'answer_unsupported')
})

/* ═══ D-F — the neighbouring states must not move ═══════════════════════════ */

test('*** THE EXISTING contentLost PATH IS UNCHANGED — offered rows, all died ***', () => {
  // sourceIds that are not in evidence: the items are offered and every one is dropped.
  const r = render({
    reply: '',
    message: MSG,
    provider: 'claude',
    requestId: 'floor-d',
    answerPlan: plan('這是我的答案。', [{ heading: '', rankingClaim: null, items: [{ sourceId: 'ghost#9', title: 'X', facts: [] }] }]),
    evidenceSets: EVIDENCE,
    itemsBySource: GROUPS
  })
  assert.ok(r.plan.modelItemCount > 0, 'this fixture must OFFER items')
  assert.equal(r.plan.keptItemCount, 0, 'and lose all of them')
  assert.equal(r.plan.outcome, 'fallback')
  assert.equal(r.plan.reason, 'items_unsupported', 'the pre-existing reason, not the new floor')
  assert.equal(r.reply.includes(EXPECTED), true, 'it already ends in minimalAnswer, as before')
})

test('*** A SUCCESSFUL READ WITH ZERO ROWS IS A DIFFERENT TRUTH, AND IS UNCHANGED ***', () => {
  const empty = [ev(REPL, 'order_suggestion', 0)]
  const r = render({
    reply: '',
    message: MSG,
    provider: 'claude',
    requestId: 'floor-e',
    answerPlan: plan('冇符合嘅記錄。'),
    evidenceSets: empty,
    itemsBySource: []
  })
  assert.equal(r.reply, '冇符合嘅記錄。', '⛔ a truthful zero-row answer was replaced')
})

test('*** AN UNAVAILABLE READ IS A DIFFERENT TRUTH, AND IS UNCHANGED ***', () => {
  const dead = [ev(REPL, 'order_suggestion', 0, 'unavailable')]
  const r = render({
    reply: '',
    message: MSG,
    provider: 'claude',
    requestId: 'floor-f',
    answerPlan: plan('目前讀不到訂貨建議。'),
    evidenceSets: dead,
    itemsBySource: []
  })
  assert.equal(r.reply, '目前讀不到訂貨建議。', '⛔ an unavailable-read answer was replaced')
})

/* ═══ G-H — grounded answers and dropped claims ═════════════════════════════ */

test('*** A VALID GROUNDED ANSWER IS BYTE-IDENTICAL ***', () => {
  const r = render({
    reply: '',
    message: MSG,
    provider: 'claude',
    requestId: 'floor-g',
    answerPlan: plan('以下係訂貨建議。', [{ heading: '訂貨建議', rankingClaim: null, items: [{ sourceId: REPL + '#1', title: 'A', facts: [] }] }]),
    evidenceSets: EVIDENCE,
    itemsBySource: GROUPS
  })
  assert.equal(r.reply, '以下係訂貨建議。\n\n### 訂貨建議\n\n**A**')
})

test('*** ⛔ THE FALLBACK MAY NOT RESURRECT A DROPPED CLAIM ***', () => {
  const secret = '我哋一定要即刻落單買三箱橄欖油'
  const r = incident('-')
  assert.equal(r.reply.includes(secret), false)
  assert.equal(r.reply.includes('costco'), false, 'the floor may not mention Costco')
  assert.equal(r.reply.includes('購物車'), false, 'nor a cart')
  assert.equal(r.reply.includes('提案'), false, 'nor a proposal')
  // Built only from evidence counts — the two numbers it may say are the two it read.
  assert.equal(r.reply, minimalAnswer(EVIDENCE))
})

/* ═══ I-J — turns that never reach this layer, and C1 ══════════════════════ */

test('*** A CONVERSATION TURN WITH NO PLAN IS UNTOUCHED ***', () => {
  const out = buildReadResultReply({ reply: '你好呀。', message: '你好', provider: 'claude', requestId: 'floor-i' })
  assert.equal(out.reply, '你好呀。')
})

test('*** ⛔ C1 NEUTRAL SALVAGE IS BYTE-IDENTICAL ***', () => {
  // The pinned bytes from rankingSalvageTelemetry.test.js — a salvaged section carries NO
  // heading, and the floor must not see 「no heading」 as 「no content」.
  const poEv = [Object.assign(ev(PO, 'purchase_order', 2), { readKey: PO })]
  const poRows = [row(PO, '101', 'PO-20260816-001', 'purchase_order'), row(PO, '102', 'PO-20260814-001', 'purchase_order')]
  const r = render({
    reply: '',
    message: '有冇貨已經有 incoming，所以唔應該再訂咁多？',
    provider: 'openai',
    requestId: 'floor-j',
    answerPlan: plan('', [{ heading: '最近採購單', rankingClaim: null, items: [{ sourceId: PO + '#101', title: 'PO-20260816-001', facts: [] }, { sourceId: PO + '#102', title: 'PO-20260814-001', facts: [] }] }]),
    evidenceSets: poEv,
    itemsBySource: [{ source: 'aroma_system', readKey: PO, operation: PO, items: poRows }]
  })
  assert.equal(r.reply, '**PO-20260816-001**\n\n**PO-20260814-001**',
    '⛔ C1 salvage changed — rows survived a rejected ranking and must still render alone')
})

test('*** A HEADING WITH NO ITEMS DOES NOT TRAIL THE FALLBACK ***', () => {
  /**
   * ⛔ CHECKED BECAUSE IT WAS A REAL RISK, NOT BECAUSE IT FAILED. The floor pushes
   * `minimalAnswer` and the section loop below it is governed by a SEPARATE condition
   * (`fellBack`), so a section carrying a heading and no items could have printed a bare
   * 「### 訂貨建議」 underneath the fallback — two voices in one message. It does not: the
   * validator blanks a heading it will not stand behind. Pinned so that stays true.
   */
  const r = render({
    reply: '',
    message: MSG,
    provider: 'claude',
    requestId: 'floor-edge',
    answerPlan: plan('-', [{ heading: '訂貨建議', rankingClaim: null, items: [] }]),
    evidenceSets: EVIDENCE,
    itemsBySource: GROUPS
  })
  assert.equal(r.reply, EXPECTED)
  assert.equal(r.reply.includes('###'), false, 'a stray heading trailed the fallback')
})
