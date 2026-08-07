'use strict'
/**
 * errandConclusion.test.js — 首頁 says the CONCLUSION, not the execution history.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「an errand log does not belong on 首頁. What I want is the CONCLUSION — 「六樣查過,
 * > 冇相關回收」 or 「蘑菇一單,08-04」 — not thirty lines of execution history.」**
 *
 * A row is one execution of one query. That is the wrong grain for a briefing. The registry
 * already carries 「how fresh this should be」; it should also carry 「what it found」.
 *
 * ⛔ TWO RULES ARE STRUCTURAL HERE, NOT REMEMBERED.
 *
 * ② 查唔到 GETS ITS OWN FIELD. `gap` is a separate named property, not a sentence appended to
 *    the calm summary — so folding it in requires DELETING a field, not just concatenating
 *    differently. 「the through-line of the entire week, and the one that will be tempting to
 *    fold in when five of six are clean.」
 *
 * ① 「新」 IS NEVER A FILTER. An ingredient with nothing to compare against reports
 *    `uncomparable`, never 「冇新嘢」. First run especially — that is when every ingredient is
 *    uncomparable and the calm sentence would be maximally wrong.
 * ══════════════════════════════════════════════════════════════════════════════
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const { conclusionFor, CONCLUSION } = require('./errandConclusion')
/**
 * ⛔ ASSERT ON THE KEY WHERE THE TEST GUARDED WHICH STATEMENT IS MADE; KEEP THE PHRASE WHERE IT
 * GUARDED A PHRASE. Each converted line says which it was, at the line. A test converted to
 * assert-key when it was really guarding a specific phrase is a guard quietly removed.
 */
const { t } = require('../i18n/t')

const DAY = 24 * 3600 * 1000
const NOW = new Date('2026-08-07T12:00:00Z').getTime()
const KIND = { id: 'recall', title: '回收檢查', prefix: 'recall-' }

const row = (ing, dayOffset, over) => Object.assign({
  id: 'recall-' + ing + '-' + new Date(NOW - dayOffset * DAY).toISOString().slice(0, 10),
  title: '回收檢查 — ' + ing,
  outcome: 'ANSWERED',
  at: NOW - dayOffset * DAY,
  items: []
}, over || {})

const item = (when, title) => ({ when, title })

describe('the calm day is ONE line', () => {
  test('every ingredient checked, nothing new → NOTHING_NEW with a count', () => {
    const rows = ['mushrooms', 'chicken'].flatMap((i) => [
      row(i, 1, { items: [item('2026-01-01', 'old thing')] }),
      row(i, 0, { items: [item('2026-01-01', 'old thing')] })
    ])
    const c = conclusionFor(KIND, rows, NOW)
    assert.strictEqual(c.state, CONCLUSION.NOTHING_NEW)
    // CONVERTED (both): they guarded the COUNT and that the sentence is the calm one.
    // Exact equality pins the key AND the number, which the two regexes did between them.
    assert.strictEqual(c.calm, t('conclusion.calm', { n: 2 }))
    assert.strictEqual(c.gap, null)
    assert.strictEqual(c.unknown, null)
    assert.strictEqual(c.alert, null)
  })

  test('a NEW recall is named with its ingredient and date', () => {
    const rows = [
      row('mushrooms', 1, { items: [item('2026-01-01', 'old thing')] }),
      row('mushrooms', 0, { items: [item('2026-08-04', 'Highline brand Organic Mini Bella Mushrooms Sliced recalled'), item('2026-01-01', 'old thing')] })
    ]
    const c = conclusionFor(KIND, rows, NOW)
    assert.strictEqual(c.state, CONCLUSION.NEW_FINDINGS)
    assert.match(c.alert, /mushrooms/)
    assert.match(c.alert, /2026-08-04/)
    assert.match(c.alert, /Highline/)
  })
})

/**
 * ⛔ RULE ② — THE ONE THAT WILL BE TEMPTING TO FOLD IN.
 */
describe('⛔ 查唔到 always has its own field, even when everything else is clean', () => {
  const fiveCleanOneBlocked = () => [
    ...['mushrooms', 'chicken', 'cheese', 'beef', 'romaine'].flatMap((i) => [
      row(i, 1, { items: [item('2026-01-01', 'x')] }),
      row(i, 0, { items: [item('2026-01-01', 'x')] })
    ]),
    row('green onion', 1, { items: [item('2026-01-01', 'x')] }),
    row('green onion', 0, { outcome: 'BLOCKED_BY_SITE', detail: 'timeout', items: undefined })
  ]

  test('5 of 6 clean → the blocked one is NOT absorbed into the calm sentence', () => {
    const c = conclusionFor(KIND, fiveCleanOneBlocked(), NOW)
    assert.ok(c.gap, 'the unchecked ingredient must have its own line')
    assert.match(c.gap, /green onion/)
    // ⛔ The calm sentence must EXIST here (five ingredients are clean) before 「green onion is
    // not in it」 says anything. Defaulted to '', a regression that dropped the sentence
    // entirely would have passed this line.
    assert.ok(c.calm, 'five are clean, so there is a calm sentence')
    assert.doesNotMatch(c.calm, /green onion/, 'it must not appear in the calm summary')
  })

  test('the calm summary counts only what was ACTUALLY checked', () => {
    const c = conclusionFor(KIND, fiveCleanOneBlocked(), NOW)
    // CONVERTED. 6 would be a lie — one was never searched. Exact equality on n:5 SUBSUMES
    // the old /6 樣/ check: no other number can appear in a string that equals this one.
    assert.strictEqual(c.calm, t('conclusion.calm', { n: 5 }))
  })

  test('⛔ the state is PARTIAL, not NOTHING_NEW — the summary word itself must not read clean', () => {
    const c = conclusionFor(KIND, fiveCleanOneBlocked(), NOW)
    assert.strictEqual(c.state, CONCLUSION.PARTIAL)
    assert.notStrictEqual(c.state, CONCLUSION.NOTHING_NEW)
  })

  test('gap and alert coexist — a new finding does not hide an unchecked ingredient', () => {
    const rows = [
      row('mushrooms', 1, { items: [] }),
      row('mushrooms', 0, { items: [item('2026-08-04', 'new recall here')] }),
      row('beef', 1, { items: [] }),
      row('beef', 0, { outcome: 'BLOCKED_BY_SITE', detail: 'timeout' })
    ]
    const c = conclusionFor(KIND, rows, NOW)
    assert.ok(c.alert, 'the new finding')
    assert.ok(c.gap, 'AND the gap — two separate facts, two separate fields')
  })
})

/**
 * ⛔ RULE ① — 「新」 MUST NEVER BECOME A FILTER.
 */
describe('⛔ nothing to compare against is 「未有得比」, never 「冇新嘢」', () => {
  test('FIRST RUN: every ingredient uncomparable, and the calm sentence is absent', () => {
    const rows = ['mushrooms', 'chicken'].map((i) => row(i, 0, { items: [item('2026-08-04', 'a recall')] }))
    const c = conclusionFor(KIND, rows, NOW)
    assert.strictEqual(c.state, CONCLUSION.CANNOT_COMPARE)
    assert.ok(c.unknown, 'it must say it cannot compare')
    // CONVERTED, and stronger: the slots pin WHICH ingredients and WHY, which the regex
    // never looked at.
    assert.strictEqual(c.unknown, t('conclusion.cannotCompare', {
      ingredients: 'mushrooms、chicken', why: t('conclusion.whyNoPriorRun')
    }))
    assert.strictEqual(c.alert, null, 'everything looks new on a first run; calling it new would cry wolf')
    // CONVERTED, and STRONGER rather than equal: the guard was 「the calm sentence must never
    // appear on a first run」, and absence of the whole field says that without depending on
    // any phrase surviving. Any non-null calm now fails, not merely one containing 「冇新」.
    assert.strictEqual(c.calm, null, '⛔ the one sentence a first run may never produce')
  })

  test('a mix: one comparable and clean, one with no history → BOTH stated, neither hidden', () => {
    const rows = [
      row('mushrooms', 1, { items: [item('2026-01-01', 'x')] }),
      row('mushrooms', 0, { items: [item('2026-01-01', 'x')] }),
      row('romaine', 0, { items: [item('2026-01-01', 'y')] })
    ]
    const c = conclusionFor(KIND, rows, NOW)
    // CONVERTED: only the comparable one is summarised as clean.
    assert.strictEqual(c.calm, t('conclusion.calm', { n: 1 }))
    assert.ok(c.unknown)
    assert.match(c.unknown, /romaine/)
  })

  test('⛔ an uncomparable ingredient is never counted in the clean total', () => {
    const rows = [
      row('mushrooms', 1, { items: [] }),
      row('mushrooms', 0, { items: [] }),
      row('romaine', 0, { items: [] })
    ]
    const c = conclusionFor(KIND, rows, NOW)
    // CONVERTED. Counting the uncomparable one would be exactly the filter this forbids;
    // exact equality on n:1 subsumes the old 「must not say 2」 check.
    assert.strictEqual(c.calm, t('conclusion.calm', { n: 1 }))
  })

  test('nothing ever run at all → NEVER_RUN, and no calm sentence exists', () => {
    const c = conclusionFor(KIND, [], NOW)
    assert.strictEqual(c.state, CONCLUSION.NEVER_RUN)
    assert.strictEqual(c.calm, null)
    assert.strictEqual(c.alert, null)
  })
})

describe('the execution history is REACHABLE, not displayed', () => {
  test('it reports how many runs are behind the conclusion, without listing them', () => {
    const rows = [
      row('mushrooms', 1, { items: [], runCount: 3 }),
      row('mushrooms', 0, { items: [], runCount: 6 })
    ]
    const c = conclusionFor(KIND, rows, NOW)
    assert.strictEqual(typeof c.runsToday, 'number')
    assert.strictEqual(c.runsToday, 6, 'the run count comes from the row, which is now upserted')
    assert.ok(!Array.isArray(c.rows), 'the conclusion must not carry the history it replaces')
  })

  test('the ingredients behind the conclusion are named, so a drill-down has a key', () => {
    const rows = [row('mushrooms', 1, { items: [] }), row('mushrooms', 0, { items: [] })]
    const c = conclusionFor(KIND, rows, NOW)
    assert.deepStrictEqual(c.checkedIngredients, ['mushrooms'])
  })
})

/**
 * ⛔ 冇門好過一道假門 — Owner, 2026-08-07.
 *
 * A grey unclickable card PROMISES something is there and then has nothing. So clickability
 * follows CONTENT, not category: a kind that has run has a door; a kind that never has, has a
 * line and no affordance at all — and the missing door is the honest statement.
 */
describe('⛔ openable follows content, not category', () => {
  test('a kind that has run is openable', () => {
    const rows = [row('mushrooms', 0, { items: [item('2026-01-01', 'x')] })]
    assert.strictEqual(conclusionFor(KIND, rows, NOW).openable, true)
  })

  test('⛔ NEVER_RUN is NOT openable — no door rather than an empty room', () => {
    const c = conclusionFor(KIND, [], NOW)
    assert.strictEqual(c.state, CONCLUSION.NEVER_RUN)
    assert.strictEqual(c.openable, false)
    assert.ok(c.calm === null)
  })

  test('NEVER_RUN makes no claim in any of the four fields', () => {
    /**
     * ⛔ FOUND WHILE CLASSIFYING THIS FILE: THE PREVIOUS ASSERTION HERE COULD NOT FAIL.
     *
     *     assert.match(c.unknown || c.gap || c.alert || '從來未', /從來未|未有/)
     *
     * On NEVER_RUN all three fields are null, so the chain fell through to the LITERAL
     * '從來未' and matched itself. It was green from the day it was written and would have
     * stayed green if every field had been filled with the wrong sentence.
     *
     * It was not converted to assert-key, because there was no guard to convert — inventing
     * one out of a vacuous test would be worse than leaving it. What is asserted instead is
     * the invariant that is actually true and actually matters: NEVER_RUN states nothing in
     * any of the four fields. The 「從來未查過」 LINE the old test was reaching for is not
     * produced here at all — it comes from `freshnessReport` in errandKinds.js, and it is
     * covered there.
     */
    const c = conclusionFor(KIND, [], NOW)
    assert.strictEqual(c.state, CONCLUSION.NEVER_RUN)
    for (const f of ['alert', 'gap', 'unknown', 'calm']) {
      assert.strictEqual(c[f], null, f + ' must make no claim when nothing has ever run')
    }
  })

  test('a kind whose only rows are BLOCKED is still openable — the reasons are content', () => {
    const rows = [row('green onion', 0, { outcome: 'BLOCKED_BY_SITE', detail: 'timeout', items: undefined })]
    assert.strictEqual(conclusionFor(KIND, rows, NOW).openable, true)
  })
})
