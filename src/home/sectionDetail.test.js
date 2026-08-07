'use strict'
/**
 * sectionDetail.test.js — what is behind the door.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **DESIGN-HOME-SECTIONS §3: the inside is the SAME CONCLUSION AT HIGHER RESOLUTION. It is
 * > not the execution history.**
 *
 * The briefing caps rows at six and shows one line per kind. Opening the section shows every
 * ingredient with its own result, both witnesses, and — the part that is actually new —
 * **what CHANGED on which day**, using the same diff that computes 「新」.
 *
 * ⛔ What it must NOT contain is the step log. 「今日行過 7 次」 was already the wrong grain for
 * 首頁; a per-run transcript is the wrong grain for anywhere.
 * ══════════════════════════════════════════════════════════════════════════════
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const { detailFor } = require('./sectionDetail')
const { KINDS } = require('./errandKinds')

const DAY = 24 * 3600 * 1000
const NOW = new Date('2026-08-07T12:00:00Z').getTime()
const KIND = KINDS.find((k) => k.id === 'recall')

const row = (ing, daysAgo, over) => Object.assign({
  id: 'recall-' + ing + '-' + new Date(NOW - daysAgo * DAY).toISOString().slice(0, 10),
  title: '回收檢查 — ' + ing,
  outcome: 'ANSWERED',
  at: NOW - daysAgo * DAY,
  found: 2,
  items: []
}, over || {})

const it2 = (when, title) => ({ when, title })

describe('per ingredient, today', () => {
  test('each ingredient appears once, with what the site returned', () => {
    const rows = [
      row('mushrooms', 0, { found: 51, items: [it2('2026-08-04', 'Highline brand Organic Mini Bella')] }),
      row('chicken', 0, { found: 98, items: [it2('2026-08-06', 'Compliments brand Smashed')] })
    ]
    const d = detailFor(KIND, rows, NOW)
    assert.strictEqual(d.ingredients.length, 2)
    const m = d.ingredients.find((x) => x.ingredient === 'mushrooms')
    assert.strictEqual(m.found, 51)
    assert.strictEqual(m.items[0].when, '2026-08-04')
  })

  test('⛔ a blocked ingredient carries WHY, and is not shown as a zero', () => {
    // A zero and a failure look identical as a number and mean opposite things.
    const rows = [row('green onion', 0, { outcome: 'BLOCKED_BY_SITE', detail: 'timeout', items: undefined, found: undefined })]
    const d = detailFor(KIND, rows, NOW)
    const g = d.ingredients[0]
    assert.strictEqual(g.state, 'BLOCKED')
    assert.match(g.why, /timeout/)
    assert.notStrictEqual(g.found, 0, 'a site that would not answer is not a site with no recalls')
  })

  test('⛔ every row for the kind is returned — the detail is NOT capped at six', () => {
    const rows = Array.from({ length: 9 }, (_, i) => row('ing' + i, 0))
    const d = detailFor(KIND, rows, NOW)
    assert.strictEqual(d.ingredients.length, 9, 'the six-row cap belongs to the briefing, not here')
  })

  test('rows belonging to another kind are not included', () => {
    const d = detailFor(KIND, [row('mushrooms', 0), { id: 'e-costco', title: 'x', outcome: 'ANSWERED', at: NOW }], NOW)
    assert.strictEqual(d.ingredients.length, 1)
  })
})

describe('history is CHANGE, not occurrence', () => {
  test('a day where something new appeared names it', () => {
    const rows = [
      row('mushrooms', 1, { items: [it2('2026-01-01', 'old one')] }),
      row('mushrooms', 0, { items: [it2('2026-08-04', 'NEW recall'), it2('2026-01-01', 'old one')] })
    ]
    const d = detailFor(KIND, rows, NOW)
    const today = d.history[0]
    assert.match(today.line, /mushrooms/)
    assert.match(today.line, /NEW recall/)
  })

  test('⛔ a day with nothing new says 冇變 — it does not repeat the same list', () => {
    const rows = [
      row('mushrooms', 1, { items: [it2('2026-01-01', 'same')] }),
      row('mushrooms', 0, { items: [it2('2026-01-01', 'same')] })
    ]
    const d = detailFor(KIND, rows, NOW)
    assert.match(d.history[0].line, /冇變|冇新/)
    assert.doesNotMatch(d.history[0].line, /same/, 'repeating the unchanged list is the log, not the history')
  })

  test('the earliest day has nothing to compare against and says so', () => {
    const d = detailFor(KIND, [row('mushrooms', 0, { items: [it2('2026-08-04', 'a')] })], NOW)
    assert.match(d.history[d.history.length - 1].line, /未有得比|第一次/)
  })

  test('history is newest first', () => {
    const rows = [row('mushrooms', 2), row('mushrooms', 1), row('mushrooms', 0)]
    const d = detailFor(KIND, rows, NOW)
    assert.ok(d.history[0].at > d.history[1].at)
  })
})

describe('⛔ the transcript nobody reads is absent', () => {
  test('no per-step execution trace anywhere in the payload', () => {
    const rows = [row('mushrooms', 0, { steps: [{ verb: 'navigate' }, { verb: 'click' }], nodesRead: 156 })]
    const d = detailFor(KIND, rows, NOW)
    const raw = JSON.stringify(d)
    for (const junk of ['navigate', 'nodesRead', 'steps']) {
      assert.ok(!raw.includes(junk), junk + ' is execution trace — the wrong grain for any screen')
    }
  })

  test('the run count is a number, not a list of runs', () => {
    const d = detailFor(KIND, [row('mushrooms', 0, { runCount: 7 })], NOW)
    assert.strictEqual(d.ingredients[0].runsToday, 7)
    assert.ok(!Array.isArray(d.ingredients[0].runs))
  })
})

describe('both witnesses reach the detail, separately', () => {
  test('the freshness entry is carried whole', () => {
    const w = { state: 'INSTALLED', scheduled: true, healthy: true, saying: '個 task 裝咗,行緊。' }
    const d = detailFor(KIND, [row('mushrooms', 0)], NOW, w)
    assert.ok(d.freshness)
    assert.ok(d.freshness.witnesses.registry)
    assert.ok(d.freshness.witnesses.windows)
  })

  test('with no witness supplied it says nobody looked, rather than claiming a state', () => {
    const d = detailFor(KIND, [row('mushrooms', 0)], NOW)
    assert.strictEqual(d.freshness.witnesses.windows.state, 'NOT_CHECKED')
  })
})

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ 「冇記低搵到啲乜」 IS NOT 「冇搵到」. Found on the live screen, not by the suite.
 *
 * Rows written before the `items` field existed have no `items` at all. The first version of
 * detailFor did `Array.isArray(latest.items) ? latest.items : []` — collapsing UNRECORDED into
 * EMPTY. Every one of eight ingredients then rendered 「冇搵到相關回收」: **a false all-clear,
 * live, produced by an absent field rather than an absent recall.**
 *
 * `conclusionFor` already got this right (it reports `uncomparable`). The detail view, written
 * later by the same hand, threw the distinction away.
 * ══════════════════════════════════════════════════════════════════════════════
 */
describe('⛔ an unrecorded result is never shown as a zero', () => {
  test('a row with NO items field reports UNRECORDED, not an empty list', () => {
    const rows = [row('mushrooms', 0, { items: undefined, found: undefined })]
    const d = detailFor(KIND, rows, NOW)
    const g = d.ingredients[0]
    assert.strictEqual(g.state, 'UNRECORDED')
    assert.notStrictEqual(g.state, 'ANSWERED', 'ANSWERED with nothing to show reads as 「冇回收」')
    assert.strictEqual(g.items, null, 'null, not [] — an empty array is a claim that there were none')
  })

  test('a row that genuinely found nothing is still a clean ANSWERED zero', () => {
    const rows = [row('mushrooms', 0, { items: [], found: 0 })]
    const d = detailFor(KIND, rows, NOW)
    assert.strictEqual(d.ingredients[0].state, 'ANSWERED')
    assert.strictEqual(d.ingredients[0].found, 0)
    assert.deepStrictEqual(d.ingredients[0].items, [])
  })

  test('the two render as different things, which is the whole point', () => {
    const d = detailFor(KIND, [
      row('a', 0, { items: undefined, found: undefined }),
      row('b', 0, { items: [], found: 0 })
    ], NOW)
    const a = d.ingredients.find((x) => x.ingredient === 'a')
    const b = d.ingredients.find((x) => x.ingredient === 'b')
    assert.notStrictEqual(a.state, b.state)
  })
})
