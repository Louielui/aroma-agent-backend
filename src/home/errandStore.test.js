'use strict'
/**
 * errandStore.test.js — the thing that was missing, and that made the errand list decoration.
 *
 * Every errand this week ran as a hand-started script and NOTHING RECORDED IT. The audit found
 * `errandStore` at 0 hits. Without this, 首頁's list is empty forever and a tired reader cannot
 * tell that from a broken feature.
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { openErrandStore, OUTCOME } = require('./errandStore')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'errand-'))
const at = (iso) => new Date(iso).getTime()

describe('the three outcomes are never merged', () => {
  test('answered, stopped-for-you and blocked-by-site are distinct states', () => {
    assert.deepStrictEqual(
      Object.values(OUTCOME).sort(),
      ['ANSWERED', 'BLOCKED_BY_SITE', 'STOPPED_FOR_YOU'].sort()
    )
  })

  test('each round-trips through the store unchanged', () => {
    const d = tmp()
    const s = openErrandStore(d)
    s.record({ id: 'a', title: 'recall check', outcome: OUTCOME.ANSWERED, at: at('2026-08-07T09:12:00Z') })
    // A stopped errand REQUIRES its stop report — my first version of this test omitted it and
    // the store correctly refused. The test was wrong, not the code.
    s.record({
      id: 'b',
      title: 'costco order',
      outcome: OUTCOME.STOPPED_FOR_YOU,
      at: at('2026-08-07T11:40:00Z'),
      stop: { where: 'https://www.costco.ca/checkout', notPressed: { role: 'button', name: 'Place Your Order', ref: 'r1' } }
    })
    s.record({ id: 'c', title: 'supplier portal', outcome: OUTCOME.BLOCKED_BY_SITE, at: at('2026-08-07T14:03:00Z') })
    const all = openErrandStore(d).list()
    assert.deepStrictEqual(all.map((e) => e.outcome), [OUTCOME.BLOCKED_BY_SITE, OUTCOME.STOPPED_FOR_YOU, OUTCOME.ANSWERED])
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('⛔ an unknown outcome is REFUSED, not coerced to a default', () => {
    const d = tmp()
    const s = openErrandStore(d)
    assert.throws(() => s.record({ id: 'x', title: 't', outcome: 'FINISHED', at: Date.now() }), /outcome/)
    assert.strictEqual(s.list().length, 0)
    fs.rmSync(d, { recursive: true, force: true })
  })
})

describe('a stopped errand carries the five fields the Owner acts on', () => {
  const stopped = {
    id: 'c1',
    title: 'Costco 落單 — 紙巾 ×6',
    outcome: OUTCOME.STOPPED_FOR_YOU,
    at: at('2026-08-07T11:40:00Z'),
    stop: {
      where: 'https://www.costco.ca/checkout',
      account: 'louie@aromabistro741.com',
      filled: ['6 件貨落車', 'Winnipeg 門市取貨'],
      notPressed: { role: 'button', name: 'Place Your Order', ref: 'r4f2a9c1b' },
      amount: '$284.61',
      amountReadAt: at('2026-08-07T11:40:00Z'),
      whichLayer: 'L1'
    }
  }

  test('it stores and returns all five', () => {
    const d = tmp()
    const s = openErrandStore(d)
    s.record(stopped)
    const e = openErrandStore(d).list()[0]
    assert.deepStrictEqual(e.stop.filled, ['6 件貨落車', 'Winnipeg 門市取貨'])
    assert.strictEqual(e.stop.notPressed.name, 'Place Your Order')
    assert.strictEqual(e.stop.amount, '$284.61')
    assert.strictEqual(e.stop.whichLayer, 'L1')
    assert.strictEqual(e.stop.where, 'https://www.costco.ca/checkout')
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('⛔ a stopped errand WITHOUT a stop report is refused — it is the whole point of the state', () => {
    const d = tmp()
    const s = openErrandStore(d)
    assert.throws(() => s.record({ id: 'z', title: 't', outcome: OUTCOME.STOPPED_FOR_YOU, at: Date.now() }), /stop/)
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('⛔ no typed VALUE may be stored — filled carries field names, never contents', () => {
    const d = tmp()
    const s = openErrandStore(d)
    assert.throws(() => s.record({
      ...stopped,
      stop: { ...stopped.stop, typed: 'hunter2' }
    }), /never/)
    fs.rmSync(d, { recursive: true, force: true })
  })
})

describe('waiting is a query, not a scan the caller has to remember to do', () => {
  test('only STOPPED_FOR_YOU is waiting', () => {
    const d = tmp()
    const s = openErrandStore(d)
    s.record({ id: 'a', title: 'x', outcome: OUTCOME.ANSWERED, at: 1 })
    s.record({ id: 'b', title: 'y', outcome: OUTCOME.BLOCKED_BY_SITE, at: 2 })
    s.record({ id: 'c', title: 'z', outcome: OUTCOME.STOPPED_FOR_YOU, at: 3, stop: { where: 'u', notPressed: { role: 'button', name: 'n', ref: 'r' } } })
    assert.deepStrictEqual(s.waiting().map((e) => e.id), ['c'])
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('resolving one removes it from waiting but NOT from history', () => {
    const d = tmp()
    const s = openErrandStore(d)
    s.record({ id: 'c', title: 'z', outcome: OUTCOME.STOPPED_FOR_YOU, at: 3, stop: { where: 'u', notPressed: { role: 'button', name: 'n', ref: 'r' } } })
    s.resolve('c', at('2026-08-07T12:00:00Z'))
    assert.strictEqual(s.waiting().length, 0)
    assert.strictEqual(s.list().length, 1, 'history is not rewritten')
    assert.ok(s.list()[0].resolvedAt)
    fs.rmSync(d, { recursive: true, force: true })
  })
})

describe('⛔ NEVER BLANK — an unreadable store is not an empty one', () => {
  test('a fresh store reports EMPTY with a reason', () => {
    const d = tmp()
    const r = openErrandStore(d).readState()
    assert.strictEqual(r.state, 'EMPTY')
    assert.ok(r.checkedAt > 0, 'and it says when it looked')
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('a CORRUPT store reports UNREADABLE — never EMPTY', () => {
    const d = tmp()
    fs.writeFileSync(path.join(d, 'errands.json'), '{ not json')
    const r = openErrandStore(d).readState()
    assert.strictEqual(r.state, 'UNREADABLE')
    assert.notStrictEqual(r.state, 'EMPTY',
      '「我睇唔到差事紀錄」 must never collapse into 「冇嘢等你」')
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('and list() throws rather than returning [] when it cannot read', () => {
    const d = tmp()
    fs.writeFileSync(path.join(d, 'errands.json'), '{ not json')
    assert.throws(() => openErrandStore(d).list(), /unreadable/i)
    fs.rmSync(d, { recursive: true, force: true })
  })
})

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ IDEMPOTENCY. THE COMMENT CLAIMED IT; THE CODE NEVER DID IT.
 *
 * `runRecallErrand.js` said, in a comment: 「One id per ingredient per day: re-running today
 * updates today's row instead of stacking duplicates.」 `record()` did `rows.push(...)`
 * unconditionally — no key, no lookup. Measured: **44 rows, 10 distinct ids**, and the briefing
 * grew until it pushed the composer off the screen.
 *
 * The design section requiring idempotency for scheduled work (DESIGN-SCHEDULED-SURFACE §4)
 * was written by the same author in the same week.
 * ══════════════════════════════════════════════════════════════════════════════
 */
describe('⛔ one id, one row', () => {
  const t0 = new Date('2026-08-07T12:00:00Z').getTime()

  test('recording the same id twice REPLACES, it does not append', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'idem-'))
    const s = openErrandStore(d)
    s.record({ id: 'recall-mushrooms-2026-08-07', title: 'a', outcome: OUTCOME.ANSWERED, at: t0, answer: 'first' })
    s.record({ id: 'recall-mushrooms-2026-08-07', title: 'a', outcome: OUTCOME.ANSWERED, at: t0 + 60000, answer: 'second' })
    assert.strictEqual(s.list().length, 1)
    assert.strictEqual(s.list()[0].answer, 'second', 'the latest run is the truth')
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('⛔ re-running is still VISIBLE — runCount and firstAt survive the replace', () => {
    // Idempotent must not mean amnesiac. Six runs collapsing to one row that claims to be the
    // only run would hide exactly the thing that went wrong this morning.
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'idem-'))
    const s = openErrandStore(d)
    s.record({ id: 'x-1', title: 'a', outcome: OUTCOME.ANSWERED, at: t0 })
    s.record({ id: 'x-1', title: 'a', outcome: OUTCOME.ANSWERED, at: t0 + 60000 })
    s.record({ id: 'x-1', title: 'a', outcome: OUTCOME.ANSWERED, at: t0 + 120000 })
    const r = s.list()[0]
    assert.strictEqual(r.runCount, 3)
    assert.strictEqual(r.firstAt, t0, 'when this id was first written')
    assert.strictEqual(r.at, t0 + 120000, 'and when it was last written')
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('different ids still coexist', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'idem-'))
    const s = openErrandStore(d)
    s.record({ id: 'a-1', title: 'a', outcome: OUTCOME.ANSWERED, at: t0 })
    s.record({ id: 'b-1', title: 'b', outcome: OUTCOME.ANSWERED, at: t0 })
    assert.strictEqual(s.list().length, 2)
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('⛔ a replace cannot resurrect a resolved stop as unresolved', () => {
    // He acted on it; a later run of the same id must not put it back in his queue.
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'idem-'))
    const s = openErrandStore(d)
    const stop = { where: 'u', notPressed: { role: 'button', name: 'Pay', ref: 'r1' } }
    s.record({ id: 's-1', title: 'a', outcome: OUTCOME.STOPPED_FOR_YOU, at: t0, stop })
    s.resolve('s-1', t0 + 10)
    s.record({ id: 's-1', title: 'a', outcome: OUTCOME.STOPPED_FOR_YOU, at: t0 + 60000, stop })
    assert.strictEqual(s.waiting().length, 0, 'a resolved decision stays resolved')
    fs.rmSync(d, { recursive: true, force: true })
  })
})
