'use strict'

/**
 * READ-STATE ATTRIBUTION — A SOURCE THAT WAS READ IS NOT PROOF THAT A FIELD EXISTS IN IT.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE LIVE DEFECT, requestId c45a65a2-f52a-4410-9a1f-37193b7d2d81.
 *
 * She wrote: 「不過無法判斷還要唔要再訂，因為系統內睇唔到已下單貨物的交期與進度」 — a
 * FIELD-level limitation inside data that was read perfectly well. inventory, replenishment
 * and purchasing were all live, four rows each, and not one of them proves that incoming
 * progress, delivery ETA or shipment status exists anywhere in the payload.
 *
 * The guard contradicted her: 「系統」 is a source alias, 「睇唔到」 is an unreadable phrase, and
 * the alias sat before it, so a live source was taken as proof the sentence was false. That is
 * the capability defect one level deeper — source-live read as FIELD-present.
 *
 * ⛔ THE RULE, AND ITS BOUNDARY, ARE BOTH DELIBERATELY SMALL.
 *
 * When the alias comes BEFORE the failure phrase and substantive content FOLLOWS that phrase,
 * the sentence is about whatever follows, not about the source — attribution is ambiguous and
 * fails toward silence. Nothing here parses grammar, and no field, shipment or ETA vocabulary
 * is introduced; the test is only 「is there substantive text after the matched phrase」.
 *
 * ⛔ AND 「AFTER」 IS BOUNDED BY THE CLAUSE, WHICH ALREADY EXISTS IN PRODUCTION.
 * `clausesOf` splits on 。！？；\n and after 「，」. That boundary is what keeps this rule from
 * gutting the guard: 「餐廳系統讀唔到，所以我無法回答你」 is TWO clauses, so the failure clause
 * has nothing substantive after it and is still corrected. Were the span the whole reply,
 * almost every real sentence would fall silent and the protection would be gone.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { enforceReadState, detectFalseReadClaim, UNREADABLE_CLAIM } = require('./readStateGuard')

/** The three reads of the live turn, in the shape production emitted. */
const LIVE_THREE = ['aroma_system.inventory', 'aroma_system.replenishment', 'aroma_system.purchasing']
  .map((operation) => ({ source: 'aroma_system', readKey: 'aroma_system', operation, trust: 'live', count: 4, usedFallback: false, error: null }))

const OWNER_MESSAGE = '有冇貨已經有 incoming，所以唔應該再訂咁多？'

/** Verbatim from the conversation store — 睇 is U+7747, verified by codepoint. */
const LIVE_CLAUSE = '根據目前讀到的資料，New Orleans Roast Marinade 同 Dark Soy Sauce 存量確實偏低，不過無法判斷還要唔要再訂，因為系統內睇唔到已下單貨物的交期與進度。'

/* ═══ RED — the live defect ════════════════════════════════════════════════ */

test('*** ⛔ A FIELD-LEVEL LIMITATION IS NOT CONTRADICTED BY A LIVE SOURCE ***', () => {
  const found = detectFalseReadClaim(LIVE_CLAUSE, LIVE_THREE, OWNER_MESSAGE)
  assert.equal(found.violated, false, '⛔ the server contradicted a TRUE field-level statement')
  assert.deepEqual(found.sources, [])
  assert.equal(found.kind, null)

  const out = enforceReadState(LIVE_CLAUSE, LIVE_THREE, OWNER_MESSAGE)
  assert.equal(out.corrected, false)
  assert.equal(out.reply, LIVE_CLAUSE, '⛔ her reply must come back byte-identical')
  assert.equal(out.reply.includes('系統更正'), false)
})

test('*** ⛔ THE SAME SHAPE IN ENGLISH AND IN OTHER WORDINGS ***', () => {
  // ⛔ NO ENGLISH VOCABULARY WAS ADDED. 'cannot read' is already in UNREADABLE_CLAIM; what
  //    changes is only that something substantive follows it.
  for (const clause of [
    'Aroma System 中看不到 shipment ETA',
    '餐廳系統讀唔到資料',
    '餐廳系統讀唔到目前資料',
    'Aroma System cannot read shipment ETA'
  ]) {
    const out = enforceReadState(clause, LIVE_THREE, OWNER_MESSAGE)
    assert.equal(out.corrected, false, '⛔ corrected a sentence that is about its OBJECT, not the source: ' + clause)
  }
})

/* ═══ PRESERVATION — the three that killed the previous rule ═══════════════ */

test('*** THE THREE THAT KILLED THE ADJACENCY RULE STILL CORRECT ***', () => {
  /**
   * ⛔ NAMED, BECAUSE THEY ARE WHY THE LAST ATTEMPT STOPPED. The withdrawn rule required the
   * alias to touch the failure phrase, and these three have a word in between — 資料, 我暫時,
   * 我. Under a suffix rule they are untouched: nothing substantive follows the verb.
   */
  const rows = [
    { source: 'gmail', trust: 'live', count: 4, usedFallback: true },
    { source: 'calendar', trust: 'live', count: 2, usedFallback: false },
    { source: 'aroma_system', readKey: 'aroma_system', operation: 'aroma_system.inventory', trust: 'live', count: 1, usedFallback: false }
  ]
  for (const [claim, source] of [['系統資料讀唔到', 'aroma_system'], ['Gmail 我暫時讀唔到。', 'gmail'], ['日曆我讀唔到。', 'calendar']]) {
    const out = enforceReadState(claim, rows)
    assert.equal(out.corrected, true, '⛔ LOST a correction that the previous attempt was rejected for losing: ' + claim)
    assert.ok(out.sources.includes(source), claim + ' must still name ' + source)
  }
})

test('*** ADJACENCY AND SOURCE-AFTER-FAILURE ARE UNCHANGED ***', () => {
  const rows = [{ source: 'aroma_system', readKey: 'aroma_system', operation: 'aroma_system.inventory', trust: 'live', count: 4, usedFallback: false }]
  for (const claim of ['餐廳系統讀唔到', '讀唔到餐廳系統']) {
    assert.equal(enforceReadState(claim, rows).corrected, true, '⛔ ' + claim + ' stopped being corrected')
  }
})

test('*** ⛔ A FALSE CLAIM WITH AN ORDINARY CONTINUATION STILL CORRECTS ***', () => {
  /**
   * ⛔ THE RULE'S WHOLE RISK, PINNED. If 「after」 spanned the reply rather than the clause,
   * this sentence would fall silent — and so would nearly every real one, which would delete
   * the protection instead of narrowing it. `clausesOf` splits after 「，」, so the failure
   * clause ends there and nothing substantive follows it.
   */
  const rows = [{ source: 'aroma_system', readKey: 'aroma_system', operation: 'aroma_system.inventory', trust: 'live', count: 4, usedFallback: false }]
  for (const claim of [
    '餐廳系統讀唔到，所以我無法回答你',
    '餐廳系統讀唔到。我建議你自己開個 app 睇睇',
    '餐廳系統讀唔到；今日只可以靠記憶'
  ]) {
    const out = enforceReadState(claim, rows)
    assert.equal(out.corrected, true, '⛔ an ordinary continuation silenced a real correction: ' + claim)
  }
})

test('*** PUNCTUATION AND WHITESPACE ALONE ARE NOT SUBSTANTIVE ***', () => {
  const rows = [{ source: 'aroma_system', readKey: 'aroma_system', operation: 'aroma_system.inventory', trust: 'live', count: 4, usedFallback: false }]
  for (const claim of ['餐廳系統讀唔到。', '餐廳系統讀唔到 ', '餐廳系統讀唔到，', '餐廳系統讀唔到；']) {
    assert.equal(enforceReadState(claim, rows).corrected, true, '⛔ punctuation was treated as an object: ' + JSON.stringify(claim))
  }
})

/* ═══ THE RULE IS AROMA-ONLY — for every other source it was pure loss ═════ */

test('*** ⛔ NON-AROMA SOURCES KEEP THEIR CORRECTION WHEN THE CLAIM CARRIES AN OBJECT ***', () => {
  /**
   * ⛔ THE COST THAT WAS MEASURED, REPORTED, ACCEPTED — AND THEN WITHDRAWN.
   *
   * The suffix rule was written source-neutrally, so 「日曆讀唔到你嘅行程」 and
   * 「Gmail 讀唔到你封信」 stopped being corrected too. For Aroma the rule buys something real:
   * a read can succeed while a FIELD inside it does not exist, which is the defect this whole
   * tranche began with. Calendar, Gmail, Drive and GitHub do not carry that distinction the
   * same way — there the rule bought nothing and cost genuine corrections.
   *
   * So the suffix test now applies ONLY to the Aroma source. Everything else returns to
   * pre-e633e99 behaviour exactly.
   */
  const cases = [
    ['日曆讀唔到你嘅行程', 'calendar'],
    ['Gmail 讀唔到你封信', 'gmail'],
    ['Drive 讀唔到你份文件', 'drive'],
    ['GitHub 讀唔到嗰個 commit', 'github']
  ]
  for (const [claim, source] of cases) {
    const rows = [{ source, trust: 'live', count: 3, usedFallback: false, error: null }]
    const out = enforceReadState(claim, rows)
    assert.equal(out.corrected, true, '⛔ a non-Aroma false claim lost its correction: ' + claim)
    assert.ok(out.sources.includes(source), claim + ' must name ' + source)
  }
})

test('*** ⛔ AND THE AROMA CASE THIS TRANCHE EXISTS FOR IS STILL SILENT ***', () => {
  /**
   * ⛔ PINNED SEPARATELY, BECAUSE NARROWING IS EXACTLY HOW THE ORIGINAL DEFECT COMES BACK.
   * If the Aroma condition is ever mis-wired, requestId c45a65a2's clause starts being
   * contradicted again — quietly, with the server's authority behind it.
   */
  const out = enforceReadState(LIVE_CLAUSE, LIVE_THREE, OWNER_MESSAGE)
  assert.equal(out.corrected, false, '⛔ THE ORIGINAL DEFECT IS BACK')
  assert.equal(out.reply, LIVE_CLAUSE, 'and her reply is still byte-identical')

  // The Aroma-side cost that REMAINS accepted after the narrowing.
  const aroma = [{ source: 'aroma_system', readKey: 'aroma_system', operation: 'aroma_system.inventory', trust: 'live', count: 4, usedFallback: false }]
  assert.equal(enforceReadState('餐廳系統讀唔到資料', aroma).corrected, false,
    'the remaining trade: an Aroma claim with an object in the same clause stays silent')
})

/* ═══ a case the brief listed that the evidence does not support ═══════════ */

test('*** 「看唔到」 IS NOT IN THE VOCABULARY — recorded, not patched ***', () => {
  /**
   * ⛔ THIS ONE IS SILENT FOR A DIFFERENT REASON, AND SAYING SO MATTERS. The brief listed
   * 「餐廳系統看唔到資料」 as a case to silence, but 看唔到 (U+770B) matches nothing in
   * UNREADABLE_CLAIM — only 睇唔到 (U+7747) and 看不到 do. It could never have been corrected,
   * so it is not evidence for this rule. Adding it to the vocabulary is a separate decision
   * with its own risk, and is NOT taken here.
   */
  assert.equal(UNREADABLE_CLAIM.test('看唔到'), false, 'if this ever matches, this tranche needs revisiting')
  assert.equal(UNREADABLE_CLAIM.test('睇唔到'), true)
  const rows = [{ source: 'aroma_system', readKey: 'aroma_system', operation: 'aroma_system.inventory', trust: 'live', count: 4, usedFallback: false }]
  assert.equal(enforceReadState('餐廳系統看唔到資料', rows).corrected, false, 'silent — but for want of a vocabulary match, not by this rule')
})
