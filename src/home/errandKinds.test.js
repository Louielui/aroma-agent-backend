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
    // (The sentence used the English word when this was written; it now says 排程. The rule
    // being asserted is unchanged — only the wording it looks for.)
    assert.match(f.line, /排程|scheduler/i,
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

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WITNESS #2 — THE REGISTRY HALF, AND WHY IT IS THE ONE THAT MATTERS MOST.
 *
 * > **Owner: 「DID_NOT_RUN needs both witnesses — the task failing in Windows, and the registry
 * > noticing the gap via nextRunAt. One is not enough, and the registry half is the one that
 * > catches a trigger that never fired.」**
 *
 * A trigger that never fires leaves Windows PERFECTLY HEALTHY: no error, no non-zero result,
 * nothing to report. The only trace it leaves anywhere is a row that should exist and does not.
 * ══════════════════════════════════════════════════════════════════════════════
 */
describe('⛔ scheduled is MEASURED, and the DUE sentence changes with it', () => {
  const k = () => KINDS.find((x) => x.id === 'recall')
  const late = [row('recall-a-1', 3 * DAY)]
  const W = {
    none: { state: 'NOT_INSTALLED', scheduled: false, healthy: null, saying: '冇裝過排程 task。' },
    ok: { state: 'INSTALLED', scheduled: true, healthy: true, saying: '個 task 裝咗,行緊。' },
    failing: { state: 'INSTALLED', scheduled: true, healthy: false, lastTaskResult: 1, saying: '上次行嗰次 Windows 報失敗,退出碼 1(0x1)。' },
    blind: { state: 'UNREADABLE', scheduled: null, healthy: null, saying: '問唔到 Windows 排程。' }
  }

  test('no task installed → DUE still reads as manual, because it IS manual', () => {
    const f = freshnessOf(k(), late, NOW, W.none)
    assert.strictEqual(f.scheduled, false)
    assert.match(f.line, /手動|人手/)
    assert.doesNotMatch(f.line, /scheduler|排程.*停|死/)
  })

  test('⛔ task installed + overdue → the trigger NEVER FIRED. Windows is silent; only this notices.', () => {
    const f = freshnessOf(k(), late, NOW, W.ok)
    assert.strictEqual(f.scheduled, true)
    assert.strictEqual(f.state, FRESHNESS.DUE)
    assert.match(f.line, /排程|scheduler/i, 'the sentence must change meaning the moment the meaning changes')
    assert.doesNotMatch(f.line, /手動行嘅,冇人行就冇新嘅/, 'that sentence is now false and must be gone')
  })

  test('⛔ the two witnesses are BOTH reported, and they are distinguishable', () => {
    const f = freshnessOf(k(), late, NOW, W.failing)
    assert.ok(f.witnesses, 'one witness is not enough — the object must carry both')
    assert.strictEqual(f.witnesses.registry.gap, true, 'the registry saw a row that should exist and does not')
    assert.strictEqual(f.witnesses.windows.healthy, false, 'and Windows saw the task fail')
    assert.match(f.line, /退出碼|0x1/, 'a failing task must surface its code, not just 「overdue」')
  })

  test('⛔ Windows healthy + registry gap is the DANGEROUS case and must SAY it is dangerous', () => {
    // Windows: task fine, no errors. Registry: no row for three days. This combination is a
    // trigger that never fired — the quietest possible failure, and the reason for two witnesses.
    const f = freshnessOf(k(), late, NOW, W.ok)
    assert.strictEqual(f.witnesses.registry.gap, true)
    assert.notStrictEqual(f.witnesses.windows.healthy, false, 'Windows reports nothing wrong')
    assert.match(f.line, /冇行|未行|冇新/, 'the sentence must not be reassured by a healthy Windows')
  })

  test('an unreadable witness claims NEITHER — 「I could not look」 is its own state', () => {
    const f = freshnessOf(k(), late, NOW, W.blind)
    assert.strictEqual(f.scheduled, null)
    assert.match(f.line, /唔知|睇唔到|問唔到/)
    assert.doesNotMatch(f.line, /手動行嘅,冇人行就冇新嘅/, 'it must not fall back to a confident manual claim')
  })

  test('FRESH does not depend on the witness — a recent row is recent either way', () => {
    for (const w of [W.none, W.ok, W.blind]) {
      assert.strictEqual(freshnessOf(k(), [row('recall-a-1', 2 * HOUR)], NOW, w).state, FRESHNESS.FRESH)
    }
  })
})

describe('nextRunAt — the number the gap is measured against', () => {
  const k = () => KINDS.find((x) => x.id === 'recall')

  test('a row carrying its own nextRunAt is judged against THAT, not against a recomputed one', () => {
    // Per DESIGN-SCHEDULED-SURFACE §2 it is stored on every run, so a cadence change does not
    // retroactively rewrite whether past runs were on time.
    //
    // The row ran 2 hours ago — well inside a daily cadence — but DECLARED it would run again
    // 8 hours ago. Judged by age it is fresh; judged by its own promise it is overdue, and the
    // promise is the thing witness #2 measures.
    const w = { state: 'INSTALLED', scheduled: true, healthy: true, saying: '' }
    const r = { id: 'recall-a-1', at: NOW - 2 * HOUR, nextRunAt: NOW - 8 * HOUR }
    const f = freshnessOf(k(), [r], NOW, w)
    assert.strictEqual(f.state, FRESHNESS.DUE, 'it said it would run again 8 hours ago, and did not')
    assert.strictEqual(f.nextRunAt, NOW - 8 * HOUR)
    assert.strictEqual(f.nextRunAtSource, 'STORED')
  })

  test('⛔ the grace period applies to a STORED nextRunAt too — and that is deliberate', () => {
    // The task runs ONLY when he is logged on (8090 exists only then), with StartWhenAvailable
    // catching up a missed 07:00. If he logs on at noon, the run genuinely happens hours late
    // and nothing is wrong. A tight grace would cry wolf every morning he slept in — which is
    // the same failure as styling DUE red, arriving through a number instead of a colour.
    const w = { state: 'INSTALLED', scheduled: true, healthy: true, saying: '' }
    const inGrace = { id: 'recall-a-1', at: NOW - 2 * HOUR, nextRunAt: NOW - 1 * HOUR }
    assert.strictEqual(freshnessOf(k(), [inGrace], NOW, w).state, FRESHNESS.FRESH)
  })

  test('with no stored nextRunAt it falls back to lastAt + cadence, and says which it used', () => {
    const f = freshnessOf(k(), [row('recall-a-1', 2 * HOUR)], NOW, null)
    assert.strictEqual(f.nextRunAt, NOW - 2 * HOUR + DAY)
    assert.strictEqual(f.nextRunAtSource, 'DERIVED')
  })

  test('⛔ the recall kind is declared READ-ONLY — the timer may run nothing else', () => {
    assert.strictEqual(k().readOnly, true,
      'the scheduled route runs only kinds declared read-only; an undeclared kind must be unrunnable')
  })
})

/**
 * ⛔ A DISABLED TASK IS NOT AN ABSENT TASK.
 *
 * > **Owner: 「tell me what the DUE line actually says in both states — I want to read the
 * > scheduled version before I rely on it, not after a scheduler has been dead for three days.」**
 *
 * Printing every branch found this: a DISABLED task has `scheduled: false` (correctly — it
 * cannot fire), and the first version routed that into the 「手動行嘅」 sentence. So 「a schedule
 * exists and somebody switched it off」 rendered IDENTICALLY to 「no schedule was ever set up」.
 * The quietest failure mode wearing the calmest sentence. Nothing was testing it, because
 * nothing had read it.
 */
describe('⛔ 「installed but off」 must never read as 「never installed」', () => {
  const k = () => KINDS.find((x) => x.id === 'recall')
  const late = [row('recall-a-1', 3 * DAY)]
  const disabled = { state: 'DISABLED', scheduled: false, healthy: null, saying: '個 task 裝咗但係俾人停用咗。' }
  const absent = { state: 'NOT_INSTALLED', scheduled: false, healthy: null, saying: '冇裝過排程 task。' }

  test('the two produce DIFFERENT sentences', () => {
    const a = freshnessOf(k(), late, NOW, disabled).line
    const b = freshnessOf(k(), late, NOW, absent).line
    assert.notStrictEqual(a, b, 'these mean opposite things about whether anything is set up')
  })

  test('the disabled sentence says it was set up AND switched off', () => {
    const f = freshnessOf(k(), late, NOW, disabled)
    assert.match(f.line, /停用|熄/)
    assert.doesNotMatch(f.line, /仲係手動行嘅/, 'that sentence claims nothing is wired, which is false here')
  })

  test('the absent sentence still reads as the calm, normal, manual state', () => {
    assert.match(freshnessOf(k(), late, NOW, absent).line, /手動/)
  })
})
