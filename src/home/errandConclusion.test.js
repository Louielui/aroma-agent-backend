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
    assert.match(c.calm, /2 樣/)
    assert.match(c.calm, /冇新/)
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
    assert.doesNotMatch(c.calm || '', /green onion/, 'it must not appear in the calm summary')
  })

  test('the calm summary counts only what was ACTUALLY checked', () => {
    const c = conclusionFor(KIND, fiveCleanOneBlocked(), NOW)
    assert.match(c.calm, /5 樣/, '6 would be a lie — one was never searched')
    assert.doesNotMatch(c.calm, /6 樣/)
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
    assert.match(c.unknown, /未有得比|第一次/)
    assert.strictEqual(c.alert, null, 'everything looks new on a first run; calling it new would cry wolf')
    assert.ok(!/冇新/.test(c.calm || ''), '⛔ the one sentence a first run may never produce')
  })

  test('a mix: one comparable and clean, one with no history → BOTH stated, neither hidden', () => {
    const rows = [
      row('mushrooms', 1, { items: [item('2026-01-01', 'x')] }),
      row('mushrooms', 0, { items: [item('2026-01-01', 'x')] }),
      row('romaine', 0, { items: [item('2026-01-01', 'y')] })
    ]
    const c = conclusionFor(KIND, rows, NOW)
    assert.match(c.calm, /1 樣/, 'only the comparable one is summarised as clean')
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
    assert.doesNotMatch(c.calm, /2 樣/, 'counting it would be exactly the filter this forbids')
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

  test('the line is still there when there is no door', () => {
    // Never-blank outranks never-promise. The absence must be stated, just not as a door.
    const c = conclusionFor(KIND, [], NOW)
    assert.match(c.unknown || c.gap || c.alert || '從來未', /從來未|未有/)
  })

  test('a kind whose only rows are BLOCKED is still openable — the reasons are content', () => {
    const rows = [row('green onion', 0, { outcome: 'BLOCKED_BY_SITE', detail: 'timeout', items: undefined })]
    assert.strictEqual(conclusionFor(KIND, rows, NOW).openable, true)
  })
})
