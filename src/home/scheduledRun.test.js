'use strict'
/**
 * scheduledRun.test.js — what a TIMER is allowed to make her do.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「Scheduled tasks read only. That ruling stands unchanged: no writes, no dispatch,
 * > no paid calls, no acting as me. The recall check qualifies; nothing else gets added to the
 * > timer without a separate GO.」**
 *
 * > **And from DESIGN-SCHEDULED-SURFACE §4: 「everything on a schedule runs without me watching,
 * > which is exactly the condition the approval gates exist for.」**
 *
 * ⛔ THE GATE IS STRUCTURAL, NOT DECLARED. 「唔可能」,唔係「唔准」.
 *
 * This endpoint takes NO parameter naming what to run. There is no field in the request that
 * could name an action, so a caller — including a rewritten task definition, including anything
 * that talks its way past the token — cannot reach a write path by asking for one. What runs is
 * the intersection of (declared in the registry) AND (readOnly) AND (a runner was wired in).
 * ══════════════════════════════════════════════════════════════════════════════
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { openErrandStore, OUTCOME } = require('./errandStore')
const { runScheduledErrands } = require('./scheduledRun')

const NOW = new Date('2026-08-07T12:00:00Z').getTime()
const DAY = 24 * 3600 * 1000
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sched-'))
const okRunner = async () => [{ suffix: 'mushrooms', title: '回收檢查 — mushrooms', result: { outcome: 'ANSWERED', answer: '冇搵到相關回收。' } }]

describe('it runs the read-only errands and records them', () => {
  test('a healthy run records a row and reports what it did', async () => {
    const d = tmp(); const store = openErrandStore(d)
    const r = await runScheduledErrands({ store, runners: { recall: okRunner }, now: () => NOW })
    assert.strictEqual(r.ran, 1)
    assert.strictEqual(r.recorded, true)
    assert.strictEqual(store.list().length, 1)
    assert.strictEqual(store.list()[0].outcome, OUTCOME.ANSWERED)
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('⛔ every row it writes carries nextRunAt — witness #2 has nothing to measure without it', async () => {
    const d = tmp(); const store = openErrandStore(d)
    const r = await runScheduledErrands({ store, runners: { recall: okRunner }, now: () => NOW })
    assert.strictEqual(r.nextRunAt, NOW + DAY)
    assert.strictEqual(store.list()[0].nextRunAt, NOW + DAY,
      'stored on the ROW, so a later cadence change cannot rewrite whether past runs were on time')
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('⛔ a row records the DOOR it came through, never a cause it cannot know', async () => {
    const d = tmp(); const store = openErrandStore(d)
    await runScheduledErrands({ store, runners: { recall: okRunner }, now: () => NOW })
    assert.strictEqual(store.list()[0].via, 'SCHEDULED_ENDPOINT',
      'the field names the DOOR the request came through — not who caused it, which this endpoint cannot know')
    fs.rmSync(d, { recursive: true, force: true })
  })
})

describe('⛔ the read-only gate is made of ABSENCE, not of a rule', () => {
  test('the request cannot name an action — runScheduledErrands takes no action parameter', () => {
    const src = fs.readFileSync(path.join(__dirname, 'scheduledRun.js'), 'utf8')
    assert.doesNotMatch(src, /req\.body|req\.query|req\.params/,
      'the runner must not read anything the caller supplied; that is the whole gate')
  })

  test('⛔ a runner wired for a kind that is NOT declared read-only is REFUSED, not run', async () => {
    const d = tmp(); const store = openErrandStore(d)
    let called = false
    // `invoices` is not in the registry at all. Wiring a runner for it must not make it runnable.
    const r = await runScheduledErrands({
      store,
      runners: { invoices: async () => { called = true; return [] } },
      now: () => NOW
    })
    assert.strictEqual(called, false, 'an undeclared kind must be unreachable from the timer')
    assert.strictEqual(r.ran, 0)
    assert.ok(r.refused.includes('invoices'), 'and the refusal must be reported, not silent')
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('⛔ a declared kind with readOnly:false is REFUSED even with a runner wired', async () => {
    const d = tmp(); const store = openErrandStore(d)
    let called = false
    const r = await runScheduledErrands({
      store,
      runners: { writey: async () => { called = true; return [] } },
      kinds: [{ id: 'writey', title: 'w', prefix: 'writey-', everyMs: DAY, readOnly: false }],
      now: () => NOW
    })
    assert.strictEqual(called, false)
    assert.ok(r.refused.includes('writey'))
    fs.rmSync(d, { recursive: true, force: true })
  })
})

describe('⛔ failure is LOUD, because the exit code is witness #1', () => {
  test('nothing wired → ran 0 and ok false, so the task records a failure', async () => {
    const d = tmp(); const store = openErrandStore(d)
    const r = await runScheduledErrands({ store, runners: {}, now: () => NOW })
    assert.strictEqual(r.ran, 0)
    assert.strictEqual(r.ok, false,
      'a schedule that runs nothing must not report success — that is a healthy-looking dead timer')
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('an errand that throws is still recorded, and ok is false', async () => {
    const d = tmp(); const store = openErrandStore(d)
    const r = await runScheduledErrands({
      store,
      runners: { recall: async () => { throw new Error('the site fell over') } },
      now: () => NOW
    })
    assert.strictEqual(r.ok, false)
    assert.strictEqual(store.list().length, 1, 'it ran and failed — that is a row, not a silence')
    assert.match(store.list()[0].detail, /fell over/)
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('⛔ 「it ran」 is not 「it was recorded」 — an unwritable store makes ok false', async () => {
    const store = { list: () => [], record: () => { throw new Error('disk full') }, waiting: () => [] }
    const r = await runScheduledErrands({ store, runners: { recall: okRunner }, now: () => NOW })
    assert.strictEqual(r.recorded, false)
    assert.strictEqual(r.ok, false,
      'an answer nobody could write down shows the Owner nothing; the timer must report failure')
  })
})

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ CRYING WOLF, ONE LEVEL DOWN.
 *
 * The first version of `ok` required EVERY errand to answer. Measured against the real
 * register: one ingredient in six gets throttled on a normal day. So the Windows task would
 * have reported FAILURE every single morning, and 「the task is failing」 would have become
 * background noise inside a week — leaving nothing to say the day it meant something.
 *
 * Exactly the failure that a red DUE line would have been, arriving at the exit code instead
 * of in the sentence. Found by RUNNING it, not by reading it.
 * ══════════════════════════════════════════════════════════════════════════════
 */
describe('⛔ a flaky site is not a failed schedule', () => {
  const mixed = async () => [
    { suffix: 'a', title: 'a', result: { outcome: 'ANSWERED', answer: '冇回收' } },
    { suffix: 'b', title: 'b', result: { outcome: 'BLOCKED_BY_SITE', detail: 'timeout' } }
  ]

  test('partly answered → ok TRUE. The rows exist; the briefing tells the story.', async () => {
    const d = tmp(); const store = openErrandStore(d)
    const r = await runScheduledErrands({ store, runners: { recall: mixed }, now: () => NOW })
    assert.strictEqual(r.ok, true, 'one throttled ingredient must not paint the task red every morning')
    assert.strictEqual(r.answered, 1)
    assert.strictEqual(store.list().length, 2, 'and BOTH are recorded, including the blocked one')
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('⛔ ALL blocked → ok FALSE. Nothing usable was produced, and that IS the schedule failing.', async () => {
    const d = tmp(); const store = openErrandStore(d)
    const allBlocked = async () => [{ suffix: 'a', title: 'a', result: { outcome: 'BLOCKED_BY_SITE', detail: 'down' } }]
    const r = await runScheduledErrands({ store, runners: { recall: allBlocked }, now: () => NOW })
    assert.strictEqual(r.ok, false)
    assert.strictEqual(r.why.everythingBlocked, true, 'and it must say WHICH failure, not just fail')
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('the four failure reasons are reported separately, never as one boolean', async () => {
    const d = tmp(); const store = openErrandStore(d)
    const r = await runScheduledErrands({ store, runners: {}, now: () => NOW })
    assert.deepStrictEqual(Object.keys(r.why).sort(),
      ['everythingBlocked', 'nothingRan', 'nothingRecorded', 'somethingRefused'])
    assert.strictEqual(r.why.nothingRan, true)
    fs.rmSync(d, { recursive: true, force: true })
  })
})
