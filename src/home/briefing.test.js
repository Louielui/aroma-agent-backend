'use strict'
/**
 * briefing.test.js — 首頁's content, and the three rulings the Owner has already made.
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const { buildBriefing, AGE } = require('./briefing')
const { OUTCOME } = require('./errandStore')

const NOW = new Date('2026-08-07T15:00:00Z').getTime()
const hoursAgo = (h) => NOW - h * 3600 * 1000

const stopAt = (h, amount) => ({
  id: 'c' + h,
  title: 'Costco 落單',
  outcome: OUTCOME.STOPPED_FOR_YOU,
  at: hoursAgo(h),
  stop: {
    where: 'https://www.costco.ca/checkout',
    account: 'louie@aromabistro741.com',
    filled: ['6 件貨落車'],
    notPressed: { role: 'button', name: 'Place Your Order', ref: 'r4f2a9c1b' },
    amount,
    amountReadAt: hoursAgo(h),
    whichLayer: 'L1'
  }
})

const store = (rows, state) => ({
  readState: () => ({ state: state || (rows.length ? 'OK' : 'EMPTY'), count: rows.length, checkedAt: NOW }),
  list: () => { if (state === 'UNREADABLE') { const e = new Error('unreadable'); throw e } return rows },
  waiting: () => { if (state === 'UNREADABLE') { const e = new Error('unreadable'); throw e } return rows.filter((r) => r.outcome === OUTCOME.STOPPED_FOR_YOU && !r.resolvedAt) }
})

describe('⛔ NEVER BLANK, and the two emptinesses never collapse', () => {
  test('nothing waiting says so, and says when it looked', () => {
    const b = buildBriefing({ store: store([]), backlog: null, now: NOW })
    assert.strictEqual(b.waiting.state, 'NOTHING_WAITING')
    assert.ok(b.waiting.checkedAt, 'a claim without a time is not a claim')
    assert.match(b.waiting.line, /冇嘢等你/)
  })

  test('⛔ an unreadable record is NOT 「nothing waiting」', () => {
    const b = buildBriefing({ store: store([], 'UNREADABLE'), backlog: null, now: NOW })
    assert.strictEqual(b.waiting.state, 'CANNOT_READ')
    assert.match(b.waiting.line, /睇唔到差事紀錄/)
    assert.doesNotMatch(b.waiting.line, /冇嘢等你/)
  })

  test('the errand list distinguishes 「none ran」 from 「cannot read」', () => {
    assert.strictEqual(buildBriefing({ store: store([]), now: NOW }).errands.state, 'NONE_RAN')
    assert.strictEqual(buildBriefing({ store: store([], 'UNREADABLE'), now: NOW }).errands.state, 'CANNOT_READ')
  })

  test('a section that DID read carries a time; one that did not, does not', () => {
    // This test previously asserted that EVERY section carries a checkedAt. That encoded
    // the defect: it forced a time onto 「我未睇過 Drive」. DEFECT-011 reversed the rule.
    const b = buildBriefing({ store: store([]), backlog: { line: 'x', checkedAt: NOW }, now: NOW })
    for (const k of ['errands', 'waiting', 'backlog']) {
      assert.ok(b[k].checkedAt, k + ' read, so it must say when')
    }
    const none = buildBriefing({ store: store([]), backlog: null, now: NOW })
    assert.strictEqual(none.backlog.checkedAt, undefined, 'no read, no time')
  })
})

describe('the three outcomes reach the surface unmerged', () => {
  test('each errand keeps its own outcome', () => {
    const rows = [
      { id: 'a', title: '回收檢查', outcome: OUTCOME.ANSWERED, at: hoursAgo(6) },
      stopAt(3, '$284.61'),
      { id: 'c', title: '供應商入口', outcome: OUTCOME.BLOCKED_BY_SITE, at: hoursAgo(1) }
    ]
    const b = buildBriefing({ store: store(rows), now: NOW })
    assert.deepStrictEqual(b.errands.rows.map((r) => r.outcome),
      [OUTCOME.ANSWERED, OUTCOME.STOPPED_FOR_YOU, OUTCOME.BLOCKED_BY_SITE])
  })
})

describe('the stop report is INLINE — not a link to a report', () => {
  test('the waiting card carries all five fields', () => {
    const b = buildBriefing({ store: store([stopAt(1, '$284.61')]), now: NOW })
    const c = b.waiting.cards[0]
    assert.deepStrictEqual(c.filled, ['6 件貨落車'])
    assert.strictEqual(c.notPressed.name, 'Place Your Order')
    assert.strictEqual(c.whichLayer, 'L1')
    assert.strictEqual(c.where, 'https://www.costco.ca/checkout')
    assert.ok(c.openHref, 'and a way to open it')
  })

  test('⛔ no typed value ever reaches the surface', () => {
    const b = buildBriefing({ store: store([stopAt(1, '$284.61')]), now: NOW })
    assert.ok(!JSON.stringify(b).includes('hunter2'))
  })
})

describe('amounts age out — 過期嘅係主張，唔係 access', () => {
  test('under 2 hours: shown plainly', () => {
    const c = buildBriefing({ store: store([stopAt(1, '$284.61')]), now: NOW }).waiting.cards[0]
    assert.strictEqual(c.amountAge, AGE.FRESH)
    assert.strictEqual(c.amount, '$284.61')
    assert.strictEqual(c.amountStruck, false)
  })

  test('2 to 24 hours: struck through, and it says why', () => {
    const c = buildBriefing({ store: store([stopAt(5, '$284.61')]), now: NOW }).waiting.cards[0]
    assert.strictEqual(c.amountAge, AGE.STALE)
    assert.strictEqual(c.amountStruck, true)
    assert.strictEqual(c.amount, '$284.61', 'still shown, but marked')
    assert.match(c.amountNote, /可能唔同咗/)
  })

  test('⛔ over 24 hours: the amount is GONE, not struck', () => {
    const c = buildBriefing({ store: store([stopAt(30, '$284.61')]), now: NOW }).waiting.cards[0]
    assert.strictEqual(c.amountAge, AGE.EXPIRED)
    assert.strictEqual(c.amount, null, 'a number we can no longer support is removed, not decorated')
    assert.match(c.amountNote, /重新/)
  })

  test('⛔ THE LINK STAYS OPEN AT EVERY AGE', () => {
    for (const h of [0.5, 5, 30, 200]) {
      const c = buildBriefing({ store: store([stopAt(h, '$1.00')]), now: NOW }).waiting.cards[0]
      assert.ok(c.openHref, 'refusing to open his own cart would be the system overreaching (' + h + 'h)')
    }
  })
})

describe('the Franco backlog is its own row, off the greeting', () => {
  test('it appears as a section, not attached to a greeting', () => {
    const b = buildBriefing({ store: store([]), backlog: { line: '64 個檔案,最舊 53 日', checkedAt: NOW }, now: NOW })
    assert.strictEqual(b.backlog.state, 'PRESENT')
    assert.match(b.backlog.line, /64/)
    assert.ok(!('greeting' in b.backlog))
  })

  test('when Drive did not answer it says so — silence is not 「nothing waiting」', () => {
    const b = buildBriefing({ store: store([]), backlog: { error: 'timeout' }, now: NOW })
    assert.strictEqual(b.backlog.state, 'CANNOT_READ')
    assert.match(b.backlog.line, /睇唔到/)
  })

  test('genuinely nothing waiting in Drive is its own state', () => {
    const b = buildBriefing({ store: store([]), backlog: { line: '', empty: true, checkedAt: NOW }, now: NOW })
    assert.strictEqual(b.backlog.state, 'NOTHING')
  })
})

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * DEFECT-011 — 「一個非聲稱配一個時間，衰過冇時間。」
 *
 * A timestamp on 「I have not looked」 is a claim about an event that did not happen, and the
 * time manufactures credibility for a check that never ran. The `|| t` fallback put the
 * briefing's own build time under any section whose reader supplied none — invisibly,
 * because the result is a plausible clock either way.
 * ══════════════════════════════════════════════════════════════════════════════
 */
describe('⛔ a section that did not read carries NO TIME AT ALL', () => {
  test('NOT_CHECKED has no checkedAt and no label', () => {
    const b = buildBriefing({ store: store([]), backlog: null, now: NOW })
    assert.strictEqual(b.backlog.state, 'NOT_CHECKED')
    assert.strictEqual(b.backlog.checkedAt, undefined, 'a non-claim must not carry a time')
    assert.strictEqual(b.backlog.checkedAtLabel, undefined)
  })

  test('⛔ NOT_WIRED is its own state, distinct from NOT_CHECKED, and also timeless', () => {
    const b = buildBriefing({ store: null, backlog: null, now: NOW })
    assert.strictEqual(b.errands.state, 'NOT_WIRED')
    assert.strictEqual(b.waiting.state, 'NOT_WIRED')
    assert.strictEqual(b.errands.checkedAt, undefined)
    assert.match(b.errands.line, /未接線|接唔到/, 'it must name itself a defect, not a condition')
  })

  test('⛔ a MISSING store must NOT read as 「I cannot read the record」', () => {
    // The equivalent of NOT_CHECKED for errands: a wiring failure swallowed by the same
    // catch that reports a corrupt file. They are different problems and one is a defect.
    const missing = buildBriefing({ store: null, now: NOW })
    const corrupt = buildBriefing({ store: store([], 'UNREADABLE'), now: NOW })
    assert.notStrictEqual(missing.errands.state, corrupt.errands.state)
    assert.strictEqual(corrupt.errands.state, 'CANNOT_READ')
  })

  test('⛔ THE `|| t` FALLBACK IS GONE — a read with no time of its own gets no time', () => {
    const b = buildBriefing({ store: store([]), backlog: { line: '64 個檔案', empty: false }, now: NOW })
    assert.strictEqual(b.backlog.state, 'PRESENT')
    assert.strictEqual(b.backlog.checkedAt, undefined,
      'the reader supplied no time, so the briefing must not lend it one')
    assert.strictEqual(b.backlog.line, '64 個檔案')
  })

  test('a read that DOES carry its own time keeps it, unchanged', () => {
    const readAt = NOW - 90 * 1000
    const b = buildBriefing({ store: store([]), backlog: { line: 'x', checkedAt: readAt }, now: NOW })
    assert.strictEqual(b.backlog.checkedAt, readAt, 'the time comes FROM THE READ')
    assert.ok(b.backlog.checkedAtLabel)
  })

  test('errands and waiting keep a time only because the store was ACTUALLY read', () => {
    const b = buildBriefing({ store: store([]), now: NOW })
    assert.strictEqual(b.errands.checkedAt, NOW, 'read at NOW, so stamped NOW — not by luck of ordering')
    assert.ok(b.errands.checkedAtLabel)
  })
})

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「時間戳唔係新鮮度 —— and it is the reason the scheduler alone would have made
 * > the briefing more confidently wrong. A row that knows how stale it is allowed to be is
 * > honest with or without a scheduler; a row that only knows when it ran is not.」**
 *
 * The section rendered `07:14` and stopped there. Below, it must also carry what that age is
 * ALLOWED to be — and, crucially, it must be built from the KIND REGISTRY rather than from the
 * rows, or an errand that never ran once renders as nothing and nothing reads as calm.
 * ══════════════════════════════════════════════════════════════════════════════
 */
describe('⛔ freshness: the second number, without which a timestamp judges nothing', () => {
  const recallRow = (h) => ({ id: 'recall-mushrooms-2026-08-07', title: '回收檢查 — mushrooms', outcome: OUTCOME.ANSWERED, at: hoursAgo(h), answer: '冇搵到相關回收。' })

  test('the errands section carries a freshness entry per DECLARED KIND', () => {
    const b = buildBriefing({ store: store([recallRow(2)]), now: NOW })
    assert.ok(Array.isArray(b.errands.freshness), 'without this the section is still just timestamps')
    assert.ok(b.errands.freshness.find((f) => f.kind === 'recall'))
  })

  test('⛔ a kind that has NEVER run still appears — absence is the signal', () => {
    // The whole reason the registry drives this. An empty store used to render 「未有差事紀錄」
    // and say nothing about WHAT was never done.
    const b = buildBriefing({ store: store([]), now: NOW })
    const f = b.errands.freshness.find((x) => x.kind === 'recall')
    assert.strictEqual(f.state, 'NEVER_RUN')
    assert.match(f.line, /從來未/)
  })

  test('a recent run reads FRESH and still says its age', () => {
    const b = buildBriefing({ store: store([recallRow(2)]), now: NOW })
    const f = b.errands.freshness.find((x) => x.kind === 'recall')
    assert.strictEqual(f.state, 'FRESH')
    assert.match(f.line, /個鐘/)
  })

  test('⛔ an overdue UNSCHEDULED run names its cause and does not read as a fault', () => {
    const b = buildBriefing({ store: store([recallRow(72)]), now: NOW })
    const f = b.errands.freshness.find((x) => x.kind === 'recall')
    assert.strictEqual(f.state, 'DUE')
    assert.match(f.line, /手動|人手/, 'today the cause is that nobody ran it — not that anything broke')
    assert.doesNotMatch(f.line, /scheduler/i)
  })

  test('rows belonging to no declared kind keep their timestamp and gain NO freshness claim', () => {
    const b = buildBriefing({ store: store([{ id: 'e-costco', title: 'Costco', outcome: OUTCOME.BLOCKED_BY_SITE, at: hoursAgo(50) }]), now: NOW })
    assert.strictEqual(b.errands.freshness.filter((f) => f.kind === 'e-costco').length, 0,
      'judging it would be inventing a standard it was never given')
    assert.strictEqual(b.errands.rows.length, 1, 'and it must not be dropped either')
  })

  test('⛔ freshness is present even when the store is EMPTY — that is when it matters most', () => {
    const b = buildBriefing({ store: store([]), now: NOW })
    assert.ok(b.errands.freshness.length > 0,
      'an empty store is exactly the case where 「nothing ran」 must be distinguishable from 「nothing to report」')
  })

  test('a store that CANNOT be read makes no freshness claim at all', () => {
    // ⛔ Unreadable is not 「never run」. Claiming NEVER_RUN here would invent a fact from a
    // failure to read one — the same class as HR-27.
    const b = buildBriefing({ store: store([], 'UNREADABLE'), now: NOW })
    assert.strictEqual(b.errands.state, 'CANNOT_READ')
    assert.deepStrictEqual(b.errands.freshness, [])
  })

  test('a NOT_WIRED store makes no freshness claim either', () => {
    const b = buildBriefing({ now: NOW })
    assert.strictEqual(b.errands.state, 'NOT_WIRED')
    assert.deepStrictEqual(b.errands.freshness, [])
  })
})
