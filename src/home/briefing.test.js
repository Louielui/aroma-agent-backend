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

  test('every section carries a checkedAt — no section may be silently stale', () => {
    const b = buildBriefing({ store: store([]), backlog: null, now: NOW })
    for (const k of ['errands', 'waiting', 'backlog']) {
      assert.ok(b[k].checkedAt, k + ' must say when it looked')
    }
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
