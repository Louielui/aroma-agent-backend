'use strict'

/**
 * evidenceSymmetry.test.js — tell her what she is allowed to say.
 *
 * ── THE ASYMMETRY ────────────────────────────────────────────────────────────
 * Earlier this week the EvidenceSet judged her against a total she was never shown. This is
 * the mirror image: DERIVATIONS_OF reaches the VALIDATOR and never reaches the PROMPT, so
 * 缺口 is computed correctly by a server she has no way of knowing will compute it. She named
 * it once, was rejected, and stopped. The fix is to publish it, not to coax her into using it.
 *
 * ── AND ONE LABEL THAT WAS MINE, NOT HERS ────────────────────────────────────
 * 「來源 drive」 is a TRUE fact: the invoice record carries `source = "drive"`, meaning the
 * document arrived via Drive. It reads as connector attribution only because every section
 * heading on that page IS a connector name. The row's own column collided with my display
 * vocabulary.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { renderScopeLine } = require('../context/readContext')
const { validatePlan, matchValue, evidenceIndex } = require('./answerPlan')
const { DERIVATIONS_OF, FIELD_LABELS_OF } = require('../context/adapters/aromaSystemRead')

/* ═══ 1. THE SCOPE BLOCK PUBLISHES DERIVATIONS ════════════════════════════ */

const invEvidence = () => ({
  source: 'aroma_system',
  trust: 'live',
  totalCount: 199,
  shownCount: 4,
  completeness: 'sample',
  rankedBy: null,
  scope: { hasLocation: false, hasAsOf: false, note: null },
  metrics: { currentStock: { label: '現有存量', meaning: 'x' }, parLevel: { label: '安全存量', meaning: 'y' } },
  derivations: DERIVATIONS_OF.inventory
})

test('*** the model is TOLD 缺口 exists, and how it is computed ***', () => {
  const line = renderScopeLine(invEvidence())
  assert.ok(/缺口/.test(line), 'THE ASYMMETRY: the validator knew and the prompt did not — ' + line)
  assert.ok(/安全存量/.test(line) && /現有存量/.test(line), 'and which two fields it comes from')
})

test('*** it is published as SERVER-COMPUTED, not as something she may write ***', () => {
  // She names it; the server does the arithmetic. The line must not read as an invitation to
  // supply a number, or it undoes the guarantee that a wrong subtraction is impossible.
  const line = renderScopeLine(invEvidence())
  assert.ok(/系統計算|由系統/.test(line), 'the line says who computes it: ' + line)
})

test('a source with no declared derivations gains no line', () => {
  const e = Object.assign(invEvidence(), { derivations: {} })
  assert.equal(/缺口/.test(renderScopeLine(e)), false)
  const e2 = Object.assign(invEvidence(), { derivations: undefined })
  assert.doesNotThrow(() => renderScopeLine(e2))
})

/* ═══ 2. 來源 → 文件來源, AND THE VALUE READS AS SOMETHING ════════════════ */

test('*** the invoice source field is DECLARED with an Owner-facing label ***', () => {
  const f = FIELD_LABELS_OF.invoices && FIELD_LABELS_OF.invoices.source
  assert.ok(f, 'the invoice `source` column is declared')
  assert.equal(f.label, '文件來源', 'it cannot read as connector attribution')
  assert.equal(f.values.drive, 'Drive 上載', 'and the bare code means something')
})

test('*** she may write either label, and the rendered one is the Owner-facing one ***', () => {
  const c = {
    evidenceSets: [{
      source: 'aroma_system',
      trust: 'live',
      totalCount: 1,
      shownCount: 1,
      scope: {},
      metrics: {},
      fieldLabels: FIELD_LABELS_OF.invoices
    }],
    itemsBySource: [{ source: 'aroma_system', items: [{ source: 'aroma_system', sourceId: '1', title: 'A-1', fields: { source: 'drive', total: '191.10' } }] }],
    message: ''
  }
  const plan = (field, value) => ({ citesEvidence: true, directAnswer: 'x。', sections: [{ heading: 'y', items: [{ sourceId: '1', title: 'A-1', facts: [{ field, value }] }] }], limitations: [], followUp: null })
  for (const [field, value] of [['來源', 'drive'], ['文件來源', 'drive'], ['文件來源', 'Drive 上載']]) {
    const r = validatePlan(plan(field, value), c)
    assert.equal(r.droppedFacts, 0, field + '=' + value + ' must not drop')
    const f = r.plan.sections[0].items[0].facts[0]
    assert.equal(f.field, '文件來源', 'the label is normalised')
    assert.equal(f.value, 'Drive 上載', 'and the value is legible')
  }
})

test('an undeclared source code renders as itself, never guessed', () => {
  const c = {
    evidenceSets: [{ source: 'aroma_system', trust: 'live', totalCount: 1, shownCount: 1, scope: {}, metrics: {}, fieldLabels: FIELD_LABELS_OF.invoices }],
    itemsBySource: [{ source: 'aroma_system', items: [{ source: 'aroma_system', sourceId: '1', title: 'A-1', fields: { source: 'fax' } }] }],
    message: ''
  }
  const r = validatePlan({ citesEvidence: true, directAnswer: 'x。', sections: [{ heading: 'y', items: [{ sourceId: '1', title: 'A-1', facts: [{ field: '文件來源', value: 'fax' }] }] }], limitations: [], followUp: null }, c)
  assert.equal(r.plan.sections[0].items[0].facts[0].value, 'fax')
})

/* ═══ 3. A NUMBER EMBEDDED IN PROSE ═══════════════════════════════════════ */

const proseIndex = () => evidenceIndex(
  [{ source: 'calendar', trust: 'live', totalCount: 1, shownCount: 1, scope: {}, metrics: {} }],
  [{ source: 'calendar', items: [{ source: 'calendar', sourceId: 'e1', title: '眼科檢查', originalDate: '2026-08-11T16:00:00-05:00', content: '電話：204-555-1234 請提前十分鐘到達', fields: {} }] }]
)

test('*** a phone number INSIDE a segment is now indexed ***', () => {
  // digitsKeyOf only accepted a segment that was ENTIRELY digits and separators, so
  // 「電話：204-555-1234」 indexed nothing and the number could never be cited.
  const i = proseIndex()
  assert.equal(matchValue('204-555-1234', i).ok, true, 'THE GAP: embedded numbers were invisible')
  assert.equal(matchValue('(204) 555 1234', i).ok, true, 'and separator style still does not matter')
})

test('*** a PARTIAL number still fails — exact equality is not relaxed ***', () => {
  const i = proseIndex()
  for (const wrong of ['204', '555-1234', '204-555-1235', '2045551234000']) {
    assert.equal(matchValue(wrong, i).ok, false, 'must not match: ' + wrong)
  }
})

test('*** a SUBSTRING of prose still does not match — only the digit run is extracted ***', () => {
  // MY ASSUMPTION WAS WRONG and the code is right. The description has no separators, so it
  // is ONE segment; 十分鐘 is a substring of it, not a segment, and substring matching is the
  // thing this file refuses. Only the DIGIT RUN is pulled out of the middle of prose — the
  // narrow widening the Owner asked for, and nothing else.
  const i = proseIndex()
  assert.equal(matchValue('十分鐘', i).ok, false, 'a fragment of a sentence is not a value')
  assert.equal(matchValue('二十分鐘', i).ok, false)
  assert.equal(matchValue('電話：204-555-1234 請提前十分鐘到達', i).ok, true, 'the whole segment is')
})

/* ═══ 5. THE ONE-VARIABLE EXPERIMENT ══════════════════════════════════════ */

test('*** the rule is concrete again, and still spells no banned form ***', () => {
  // ONE VARIABLE. Last round I changed two things at once — the examples went AND the rule
  // became a class description. This restores the specificity and leaves the banned
  // characters out, so a surviving 冇 means the model's prior, not a vague instruction.
  const { CONVERSATION_CONTRACT: C } = require('../persona/conversationContract')
  const lang = C.split('\n').filter((l) => /廣東話|書面繁體中文|口語|一律寫/.test(l)).join('\n')

  for (const banned of ['而家', '冇', '搵', '啲', '喺', '咩', '嘅', '嘢']) {
    assert.equal(lang.includes(banned), false, 'the rule must not spell: ' + banned)
  }
  assert.ok(/否定詞一律寫「沒有」/.test(C), 'concrete, not a class description')
  assert.ok(/一律寫「目前」/.test(C) && /一律寫「什麼」/.test(C) && /一律寫「在」/.test(C))
  // NOT a blanket ban on 改用: 「不要因為出現英文字就整段改用英文」 legitimately uses it. What
  // matters is that the NEGATION rule is absolute rather than advisory.
  assert.equal(/否定詞.{0,4}改用/.test(C), false, 'the negation rule is 一律寫, not 改用')
})
