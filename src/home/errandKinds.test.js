'use strict'
/**
 * errandKinds.test.js — how stale a row is ALLOWED to be.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「時間戳唔係新鮮度。A row that knows how stale it is allowed to be is honest with
 * > or without a scheduler; a row that only knows when it ran is not.」**
 *
 * The briefing showed `07:14` and thought it had said something. A timestamp is a fact about
 * the past; **freshness is a claim about the present**, and it needs a second number — the
 * cadence the row is expected to keep — before it can be made at all.
 *
 * ⛔ AND THE PART ROWS CAN NEVER DO.
 *
 * A briefing built by walking the ROWS can only ever report things that happened. An errand
 * that has never run once contributes no row, so it renders as nothing — and nothing reads as
 * calm. **The registry drives the section, not the store**, so 「呢樣從來未查過」 is sayable.
 *
 * This is `DID_NOT_RUN` from DESIGN-SCHEDULED-SURFACE.md §2, arriving a step earlier than
 * planned: the absence of a row IS the signal, and something has to interpret absence.
 * ══════════════════════════════════════════════════════════════════════════════
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const { KINDS, FRESHNESS, freshnessOf, kindOfRow } = require('./errandKinds')

const HOUR = 3600 * 1000
const DAY = 24 * HOUR
const NOW = new Date('2026-08-07T12:00:00Z').getTime()
const row = (id, agoMs) => ({ id, title: 't', outcome: 'ANSWERED', at: NOW - agoMs })

describe('a kind knows its own cadence', () => {
  test('the recall check is declared, daily, and NOT scheduled', () => {
    const k = KINDS.find((x) => x.id === 'recall')
    assert.ok(k, 'the one errand that produces real work must be declared')
    assert.strictEqual(k.everyMs, DAY)
    assert.strictEqual(k.scheduled, false, 'she has no scheduler; declaring one would be a lie')
  })

  test('rows are matched to their kind by id, not by title', () => {
    // Titles are human text and will be reworded. The id prefix is the contract.
    assert.strictEqual(kindOfRow({ id: 'recall-mushrooms-2026-08-07' }).id, 'recall')
    assert.strictEqual(kindOfRow({ id: 'e-costco' }), null, 'an unregistered row has no cadence to be judged against')
  })
})

describe('⛔ the three freshness states, and none of them is a timestamp', () => {
  test('within the cadence → FRESH', () => {
    const f = freshnessOf(KINDS.find((k) => k.id === 'recall'), [row('recall-a-1', 2 * HOUR)], NOW)
    assert.strictEqual(f.state, FRESHNESS.FRESH)
    assert.match(f.line, /2 個鐘/, 'it still says how old — freshness replaces nothing')
  })

  test('past the cadence → DUE, saying both the age AND what it should be', () => {
    const f = freshnessOf(KINDS.find((k) => k.id === 'recall'), [row('recall-a-1', 3 * DAY)], NOW)
    assert.strictEqual(f.state, FRESHNESS.DUE)
    assert.match(f.line, /3 日/, 'how old it is')
    assert.match(f.line, /每日/, 'and how old it is ALLOWED to be — a number alone judges nothing')
  })

  test('⛔ never run at all → NEVER_RUN, which no row could ever have said', () => {
    const f = freshnessOf(KINDS.find((k) => k.id === 'recall'), [], NOW)
    assert.strictEqual(f.state, FRESHNESS.NEVER_RUN)
    assert.match(f.line, /從來未/)
    assert.ok(!/undefined|NaN|1970/.test(f.line), 'no invented time for a run that never happened')
  })

  test('freshness comes from the NEWEST matching row, not the first in the file', () => {
    const f = freshnessOf(KINDS.find((k) => k.id === 'recall'),
      [row('recall-a-1', 9 * DAY), row('recall-b-1', 1 * HOUR), row('recall-c-1', 4 * DAY)], NOW)
    assert.strictEqual(f.state, FRESHNESS.FRESH)
  })
})

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE SENTENCE MUST NOT CRY WOLF.
 *
 * With no scheduler, EVERY kind is DUE most of the time — that is the normal, expected state
 * of a thing he runs by hand. If DUE reads as an alarm, he learns within a week to skip the
 * line, and the day it means something he will skip it then too.
 *
 * So DUE must name its own cause, and today the cause is always 「冇 scheduler」. The day a
 * scheduler exists, the same state with `scheduled: true` means something entirely different —
 * it may have died — and the sentence changes with it.
 * ══════════════════════════════════════════════════════════════════════════════
 */
describe('DUE says WHY, and the why changes when a scheduler exists', () => {
  test('unscheduled + DUE reads as a standing fact, not a fault', () => {
    const f = freshnessOf({ id: 'x', title: 'x', everyMs: DAY, graceMs: 0, prefix: 'x-', scheduled: false }, [row('x-1', 2 * DAY)], NOW)
    assert.strictEqual(f.state, FRESHNESS.DUE)
    assert.match(f.line, /手動|人手/, 'the cause today is that nobody ran it')
    assert.doesNotMatch(f.line, /scheduler 死|停咗/, 'there is no scheduler to have died')
  })

  test('⛔ scheduled + DUE is a DIFFERENT sentence — the scheduler may have stopped', () => {
    const f = freshnessOf({ id: 'y', title: 'y', everyMs: DAY, graceMs: 0, prefix: 'y-', scheduled: true }, [row('y-1', 2 * DAY)], NOW)
    assert.strictEqual(f.state, FRESHNESS.DUE)
    assert.match(f.line, /scheduler/i,
      'a scheduled task past its time is the DID_NOT_RUN case — silence that must not read as calm')
  })

  test('the grace period stops a run a few minutes late from reading as overdue', () => {
    const k = { id: 'z', title: 'z', everyMs: DAY, graceMs: 6 * HOUR, prefix: 'z-', scheduled: false }
    assert.strictEqual(freshnessOf(k, [row('z-1', DAY + HOUR)], NOW).state, FRESHNESS.FRESH)
    assert.strictEqual(freshnessOf(k, [row('z-1', DAY + 7 * HOUR)], NOW).state, FRESHNESS.DUE)
  })
})

describe('it is honest about what it cannot judge', () => {
  test('⛔ a row belonging to no kind is not silently called fresh', () => {
    // e-costco has no declared cadence. Judging it would be inventing a standard; hiding it
    // would be losing a row. It keeps its timestamp and gains no freshness claim.
    assert.strictEqual(kindOfRow({ id: 'e-costco' }), null)
  })

  test('a row with no usable time cannot be judged, and says so instead of reading as ancient', () => {
    const f = freshnessOf(KINDS.find((k) => k.id === 'recall'), [{ id: 'recall-x-1', at: null }], NOW)
    assert.notStrictEqual(f.state, FRESHNESS.FRESH)
    assert.ok(!/1970|NaN/.test(f.line))
  })
})
