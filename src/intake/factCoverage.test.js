'use strict'

/**
 * factCoverage.test.js — the five remaining causes of a permanent omission note.
 *
 *   1 CALENDAR   `content` was never indexed, so anything she read out of an event
 *                DESCRIPTION could never be verified in any format. The only safe calendar
 *                answer was a title. The description is already IN the prompt — not indexing
 *                it meant she could read it but never cite it.
 *
 *   2 單位        SETTLED BY READING ONE LIVE ROW: the rows DO carry `unit`, with values
 *                ea / cs / pal / box / bag / bottle / pack. She writes 件 and 箱. She is
 *                TRANSLATING — exactly the `active → 啟用中` case STATUS_LABELS already
 *                handles, and there was no unit table.
 *
 *   3 LIMITATIONS were filtered with NO counter. Four times this week a drop with no counter
 *                has been the defect; this was the fifth, still in place.
 *
 *   4 THE CAP    maxFactsPerItem is 4 and she spent all four on ordinary fields, so the
 *                declared derivation competed with 分類 for a slot. Owner ruling: derivations
 *                get their own allowance.
 *
 *   5 THE RULE   The only Cantonese left in the whole system string is inside the language
 *                policy — the mapping examples in the rule that bans them. THIS IS A
 *                HYPOTHESIS BEING TESTED, NOT A DIAGNOSIS. I asserted a mechanism last round
 *                and was wrong; this one is being changed so we can find out.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { validatePlan, matchValue, evidenceIndex, translate, LIMITS } = require('./answerPlan')

/* ═══ 1. CALENDAR — content is evidence ════════════════════════════════════ */

const calIndex = () => evidenceIndex(
  [{ source: 'calendar', trust: 'live', matchingTotal: 1, shownCount: 1, scope: {}, metrics: {} }],
  [{
    source: 'calendar',
    items: [{
      source: 'calendar',
      sourceId: 'e1',
      title: '眼科檢查（Dr. Phangureh）',
      originalDate: '2026-08-11T10:00:00-05:00',
      content: 'Dr. Phangureh · 204-555-1234 · 確認郵件、提供保險資料',
      fields: { summary: '眼科檢查（Dr. Phangureh）', start: '2026-08-11T10:00:00-05:00' }
    }]
  }]
)

test('*** a phone number from the event DESCRIPTION is now verifiable ***', () => {
  const i = calIndex()
  assert.equal(matchValue('204-555-1234', i).ok, true, 'THE DEFECT: content was never indexed')
  assert.equal(matchValue('(204) 555 1234', i).ok, true, 'and Class C normalisation reaches it')
})

test('*** a to-do from the description is verifiable, whole or in parts ***', () => {
  const i = calIndex()
  assert.equal(matchValue('確認郵件、提供保險資料', i).ok, true, 'the whole segment')
  assert.equal(matchValue('確認郵件', i).ok, true, 'and each part of it')
})

test('*** a name that is NOT in the description is still rejected ***', () => {
  const i = calIndex()
  assert.equal(matchValue('Dr. Nguyen', i).ok, false, 'indexing content is not a licence to invent')
  assert.equal(matchValue('204-555-9999', i).ok, false)
  assert.equal(matchValue('取消預約', i).ok, false)
})

test('the date on the row still verifies', () => {
  assert.equal(matchValue('2026-08-11', calIndex()).ok, true)
})

/* ═══ 2. 單位 — a declared table, applied server-side ══════════════════════ */

test('*** the unit codes the live rows actually carry are declared ***', () => {
  // Measured 2026-08-05 by reading one live inventory page, read-only:
  //   ea · cs · pal · box · bag · bottle · pack
  const { UNIT_LABELS } = require('./answerPlan')
  for (const code of ['ea', 'cs', 'pal', 'box', 'bag', 'bottle', 'pack']) {
    assert.ok(UNIT_LABELS[code], 'no label declared for the live code: ' + code)
  }
})

test('*** she may write either the code or the Owner-facing word ***', () => {
  const i = evidenceIndex(
    [{ source: 'aroma_system', trust: 'live', matchingTotal: 1, shownCount: 1, scope: {}, metrics: {} }],
    [{ source: 'aroma_system', items: [{ source: 'aroma_system', sourceId: '1', title: 'Beef Plate', fields: { unit: 'cs', currentStock: '0.000' } }] }]
  )
  assert.equal(matchValue('cs', i).ok, true, 'the raw code the row carries')
  assert.equal(matchValue(translate('cs'), i).ok, true, 'and the word she actually writes')
})

test('*** whichever she writes, the RENDERED value is the Owner-facing one ***', () => {
  const c = {
    evidenceSets: [{ source: 'aroma_system', trust: 'live', matchingTotal: 1, shownCount: 1, scope: {}, metrics: {} }],
    itemsBySource: [{ source: 'aroma_system', items: [{ source: 'aroma_system', sourceId: '1', title: 'Beef Plate', fields: { unit: 'cs' } }] }],
    message: ''
  }
  const plan = (v) => ({ citesEvidence: true, directAnswer: 'x。', sections: [{ heading: 'y', items: [{ sourceId: '1', title: 'Beef Plate', facts: [{ field: '單位', value: v }] }] }], limitations: [], followUp: null })
  for (const written of ['cs', translate('cs')]) {
    const r = validatePlan(plan(written), c)
    assert.equal(r.droppedFacts, 0, written + ' must not drop')
    assert.equal(r.plan.sections[0].items[0].facts[0].value, translate('cs'))
  }
})

test('a unit code with no declared label renders as itself, never guessed', () => {
  assert.equal(translate('zzz'), 'zzz')
})

/* ═══ 3. LIMITATIONS — filtered means COUNTED ═════════════════════════════ */

const limCtx = () => ({
  evidenceSets: [{ source: 'aroma_system', trust: 'live', matchingTotal: 199, shownCount: 1, scope: {}, metrics: {} }],
  itemsBySource: [{ source: 'aroma_system', items: [{ source: 'aroma_system', sourceId: '1', title: 'Beef Plate', fields: { currentStock: '0.000' } }] }],
  message: ''
})
const limPlan = (limitations) => ({ citesEvidence: true, directAnswer: 'x。', sections: [{ heading: 'y', items: [{ sourceId: '1', title: 'Beef Plate', facts: [] }] }], limitations, followUp: null })

test('*** a filtered limitation is COUNTED and RECORDED ***', () => {
  // 500 is not a number this turn measured, so the sentence is unsupported and removed.
  // Until now it vanished with no counter of any kind — the fifth silent drop this week.
  const r = validatePlan(limPlan(['另外 500 項未核對。']), limCtx())
  assert.deepEqual(r.plan.limitations, [], 'still removed')
  assert.equal(r.droppedLimitations, 1, 'and now counted')
  const d = r.drops.find((x) => x.kind === 'limitation')
  assert.ok(d, 'and recorded: ' + JSON.stringify(r.drops))
  assert.ok(d.why, 'with a reason')
  assert.ok(d.shape, 'and the same scrubbed shape a fact drop carries')
})

test('*** a long limitation is shaped, never reproduced ***', () => {
  const long = '另外 500 項未核對，包括所有冷凍櫃與中央廚房的存貨記錄以及供應商目錄'
  const r = validatePlan(limPlan([long]), limCtx())
  const d = r.drops.find((x) => x.kind === 'limitation')
  assert.equal(d.value, undefined, 'content does not travel')
  assert.equal(d.shape, 'text')
})

test('a limitation that survives is not counted', () => {
  const r = validatePlan(limPlan(['系統記錄沒有地點標籤。']), limCtx())
  assert.equal(r.plan.limitations.length, 1)
  assert.equal(r.droppedLimitations, 0)
})

test('the count reaches the log line', () => {
  const { logAnswerPlan } = require('./answerPlan')
  const l = logAnswerPlan({ outcome: 'degraded', droppedLimitations: 2 }, () => {})
  assert.equal(l.droppedLimitations, 2)
})

/* ═══ 4. DERIVATIONS DO NOT COMPETE FOR THE FOUR SLOTS ════════════════════ */

test('*** a derivation is kept even when four ordinary facts already fill the item ***', () => {
  const c = {
    evidenceSets: [{
      source: 'aroma_system',
      trust: 'live',
      matchingTotal: 199,
      shownCount: 1,
      scope: {},
      metrics: { currentStock: { label: '現有存量' }, parLevel: { label: '安全存量' } },
      derivations: { 缺口: { minus: ['parLevel', 'currentStock'] } }
    }],
    itemsBySource: [{ source: 'aroma_system', items: [{ source: 'aroma_system', sourceId: '1', title: 'Beef Plate', fields: { currentStock: '0.000', parLevel: '30.000', unit: 'cs', subCategory: 'Meat' } }] }],
    message: ''
  }
  const r = validatePlan({
    citesEvidence: true,
    directAnswer: 'x。',
    sections: [{
      heading: 'y',
      items: [{
        sourceId: '1',
        title: 'Beef Plate',
        // FOUR ordinary facts — the old cap — plus the derivation. It used to be the
        // derivation or 分類, and 缺口 is the whole reason derivations were approved.
        facts: [
          { field: '現有存量', value: '0.000' },
          { field: '安全存量', value: '30.000' },
          { field: '分類', value: 'Meat' },
          { field: '單位', value: 'cs' },
          { field: '缺口', value: '999' }
        ]
      }]
    }],
    limitations: [],
    followUp: null
  }, c)
  const facts = r.plan.sections[0].items[0].facts
  const gap = facts.find((f) => f.field === '缺口')
  assert.ok(gap, 'the derivation survived alongside four ordinary facts: ' + JSON.stringify(facts.map((f) => f.field)))
  assert.equal(gap.value, '30', 'and the server computed it')
  assert.equal(facts.filter((f) => f.field !== '缺口').length, 4, 'the ordinary cap is unchanged')
})

test('*** derivations have their OWN cap, and it is declared ***', () => {
  assert.ok(Number.isFinite(LIMITS.maxDerivationsPerItem), 'the cap exists as a named limit')
  assert.equal(LIMITS.maxDerivationsPerItem, 2)
  assert.equal(LIMITS.maxFactsPerItem, 4, 'and the ordinary cap did not move')
})

/* ═══ 5. THE RULE CONTAINS NONE OF THE FORMS IT BANS ══════════════════════ */

test('*** the language policy no longer spells the forms it forbids ***', () => {
  // HYPOTHESIS, NOT DIAGNOSIS. The only Cantonese left in the composed system string is
  // inside this rule. Whether a banned form listed as an example is read as example OUTPUT
  // is unproven — I asserted a mechanism last round and was wrong. This changes the one
  // remaining variable so the next 冇 tells us something real.
  const { CONVERSATION_CONTRACT } = require('../persona/conversationContract')
  const lang = CONVERSATION_CONTRACT.split('\n').filter((l) => /廣東話|書面繁體中文|口語/.test(l)).join('\n')
  const banned = ['而家', '冇', '搵', '啲', '喺', '咩', '嘅', '嘢']
  const found = banned.filter((w) => lang.includes(w))
  assert.deepEqual(found, [], 'the rule still writes the forms it bans: ' + found.join(' '))
})

test('*** and the rule still means what it meant ***', () => {
  const { CONVERSATION_CONTRACT: C } = require('../persona/conversationContract')
  // WORDING TIGHTENED 2026-08-05: 「不要使用廣東話口語字」 became 「廣東話口語字一律不用」 when the
  // experiment restored the specificity. The PROHIBITION is what this asserts, not the phrasing.
  assert.ok(/廣東話口語字一律不用|不(要|得)使用廣東話口語/.test(C), 'the prohibition survives')
  assert.ok(/沒有/.test(C) && /目前/.test(C) && /什麼/.test(C), 'the WRITTEN targets are still named')
  assert.ok(C.includes('書面繁體中文'), 'and the default is unchanged')
})
