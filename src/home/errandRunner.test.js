'use strict'
/**
 * errandRunner.test.js — the thing that runs errands and records them.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * Until this exists the waiting section can only ever be empty, and 首頁 is a frame rather
 * than a briefing. Every errand this week ran as a hand-started script and nothing wrote it
 * down — which is why the errand list said 「每單都係手動跑,冇記低」.
 *
 * ⛔ THE RUNNER'S JOB IS TO RECORD, INCLUDING WHEN THE ERRAND FAILS.
 * An errand that blows up and leaves no trace is indistinguishable from one that never ran,
 * and 首頁 would show 「未有差事紀錄」 — a lie with a reason attached.
 * ══════════════════════════════════════════════════════════════════════════════
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { openErrandStore, OUTCOME } = require('./errandStore')
const { runErrand } = require('./errandRunner')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'runner-'))

describe('every run is recorded, whatever happens', () => {
  test('an answer is recorded as ANSWERED, with the answer', async () => {
    const d = tmp(); const store = openErrandStore(d)
    const r = await runErrand({
      store,
      id: 'e1',
      title: '回收檢查',
      run: async () => ({ outcome: 'ANSWERED', answer: '4 條回收' })
    })
    assert.strictEqual(r.outcome, OUTCOME.ANSWERED)
    const row = store.list()[0]
    assert.strictEqual(row.outcome, OUTCOME.ANSWERED)
    assert.strictEqual(row.answer, '4 條回收')
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('⛔ a THROWN errand is still recorded — it must not vanish', async () => {
    const d = tmp(); const store = openErrandStore(d)
    const r = await runErrand({ store, id: 'e2', title: 'x', run: async () => { throw new Error('boom') } })
    assert.strictEqual(r.outcome, OUTCOME.BLOCKED_BY_SITE)
    const row = store.list()[0]
    assert.strictEqual(row.outcome, OUTCOME.BLOCKED_BY_SITE)
    assert.match(row.detail, /boom/)
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('a stop is recorded as STOPPED_FOR_YOU, carrying its stop report', async () => {
    const d = tmp(); const store = openErrandStore(d)
    await runErrand({
      store,
      id: 'e3',
      title: 'Costco',
      run: async () => ({
        outcome: 'STOPPED_FOR_YOU',
        stop: { where: 'https://x/checkout', notPressed: { role: 'button', name: 'Place Your Order', ref: 'r1' }, whichLayer: 'L1' }
      })
    })
    const row = store.list()[0]
    assert.strictEqual(row.outcome, OUTCOME.STOPPED_FOR_YOU)
    assert.strictEqual(row.stop.notPressed.name, 'Place Your Order')
    assert.strictEqual(store.waiting().length, 1, 'and it reaches the waiting query')
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('⛔ a stop with NO stop report is refused, and recorded as a defect rather than lost', async () => {
    const d = tmp(); const store = openErrandStore(d)
    const r = await runErrand({ store, id: 'e4', title: 'x', run: async () => ({ outcome: 'STOPPED_FOR_YOU' }) })
    assert.strictEqual(r.outcome, OUTCOME.BLOCKED_BY_SITE, 'it cannot be stored as a stop, so it is not silently dropped')
    assert.strictEqual(store.list().length, 1)
    assert.match(store.list()[0].detail, /stop/i)
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('an unknown outcome from the errand becomes a recorded defect, not a crash', async () => {
    const d = tmp(); const store = openErrandStore(d)
    const r = await runErrand({ store, id: 'e5', title: 'x', run: async () => ({ outcome: 'FINISHED' }) })
    assert.strictEqual(r.outcome, OUTCOME.BLOCKED_BY_SITE)
    assert.match(store.list()[0].detail, /FINISHED/)
    fs.rmSync(d, { recursive: true, force: true })
  })
})

describe('⛔ it never invents a time, and never records a typed value', () => {
  test('the recorded time is when the run FINISHED, supplied by the caller\'s clock', async () => {
    const d = tmp(); const store = openErrandStore(d)
    const at = new Date('2026-08-07T09:00:00Z').getTime()
    await runErrand({ store, id: 'e6', title: 'x', now: () => at, run: async () => ({ outcome: 'ANSWERED' }) })
    assert.strictEqual(store.list()[0].at, at)
    fs.rmSync(d, { recursive: true, force: true })
  })

  test('a stop carrying a typed value is refused by the store and recorded as a defect', async () => {
    const d = tmp(); const store = openErrandStore(d)
    const r = await runErrand({
      store,
      id: 'e7',
      title: 'x',
      run: async () => ({ outcome: 'STOPPED_FOR_YOU', stop: { where: 'u', notPressed: { role: 'b', name: 'n', ref: 'r' }, typed: 'hunter2' } })
    })
    assert.strictEqual(r.outcome, OUTCOME.BLOCKED_BY_SITE)
    assert.ok(!JSON.stringify(store.list()).includes('hunter2'))
    fs.rmSync(d, { recursive: true, force: true })
  })
})

describe('a store that cannot be written does not swallow the run', () => {
  test('the run still returns its outcome, and says the record failed', async () => {
    const store = { list: () => [], record: () => { throw new Error('disk full') }, waiting: () => [] }
    const r = await runErrand({ store, id: 'e8', title: 'x', run: async () => ({ outcome: 'ANSWERED', answer: 'ok' }) })
    assert.strictEqual(r.outcome, OUTCOME.ANSWERED, 'the errand DID answer')
    assert.strictEqual(r.recorded, false, 'and the caller is told it was not written down')
    assert.match(r.recordError, /disk full/)
  })
})
