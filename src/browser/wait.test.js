'use strict'
/**
 * wait.test.js — against ACCEPTANCE-TYPE-WAIT.json (W1-W3, S1-S2), frozen before this file.
 *
 * The baseline measured that the library's own waits bound and refuse correctly. What is
 * tested here is that a timeout is an OUTCOME, that no caller-supplied code can run in the
 * page, and that a screenshot never claims to be the record.
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const { buildWaitFor, buildScreenshot, WAIT, MAX_WAIT_MS } = require('./wait')

const fakePage = (opts = {}) => ({
  calls: [],
  locator (sel) {
    return {
      async waitFor (o) { opts.calls && opts.calls.push({ sel, o }); if (opts.throws) throw new Error('Timeout') },
      async screenshot () { return Buffer.alloc(opts.bytes === undefined ? 1234 : opts.bytes) }
    }
  },
  async waitForLoadState (s, o) { opts.calls && opts.calls.push({ state: s, o }); if (opts.throws) throw new Error('Timeout') },
  async screenshot () { return Buffer.alloc(opts.bytes === undefined ? 4321 : opts.bytes) }
})

describe('W1 — always bounded', () => {
  test('a caller cannot ask for an unbounded wait', async () => {
    const calls = []
    const w = buildWaitFor({ page: fakePage({ calls }) })
    const r = await w({ condition: WAIT.NETWORK_IDLE, timeoutMs: 60 * 60 * 1000 })
    assert.strictEqual(calls[0].o.timeout, MAX_WAIT_MS)
    assert.strictEqual(r.capped, true, 'and the caller is TOLD the ceiling was applied')
  })
  test('every path passes a timeout to the library', async () => {
    const calls = []
    const w = buildWaitFor({ page: fakePage({ calls }) })
    await w({ condition: WAIT.VISIBLE, ref: 'r1' })
    await w({ condition: WAIT.DOM_READY })
    assert.ok(calls.every((c) => c.o && Number.isFinite(c.o.timeout)), JSON.stringify(calls))
  })
})

describe('W2 — a timeout is an OUTCOME, never a silent pass', () => {
  test('it does not resolve as though the condition were met', async () => {
    const w = buildWaitFor({ page: fakePage({ throws: true }) })
    const r = await w({ condition: WAIT.VISIBLE, ref: 'r1', timeoutMs: 500 })
    assert.strictEqual(r.outcome, 'TIMED_OUT')
    assert.notStrictEqual(r.outcome, 'HAPPENED')
    assert.strictEqual(r.condition, WAIT.VISIBLE, 'and it says WHAT was never met')
    assert.match(r.detail, /never met/)
  })
  test('a met condition and a timed-out one are distinguishable outcomes', async () => {
    const ok = await buildWaitFor({ page: fakePage() })({ condition: WAIT.DOM_READY })
    const no = await buildWaitFor({ page: fakePage({ throws: true }) })({ condition: WAIT.DOM_READY })
    assert.strictEqual(ok.outcome, 'HAPPENED')
    assert.strictEqual(no.outcome, 'TIMED_OUT')
  })
})

describe('W3 — named conditions only; no caller code reaches the page', () => {
  test('an unknown condition is REFUSED, never defaulted', async () => {
    const calls = []
    const r = await buildWaitFor({ page: fakePage({ calls }) })({ condition: 'netwrok_idle' })
    assert.strictEqual(r.outcome, 'REFUSED')
    assert.strictEqual(r.reason, 'UNKNOWN_CONDITION')
    assert.strictEqual(calls.length, 0, 'a typo must not become a wait nobody asked for')
  })
  test('a predicate cannot be smuggled in — there is no code path for it', async () => {
    const calls = []
    const w = buildWaitFor({ page: fakePage({ calls }) })
    const r = await w({ condition: () => true })
    assert.strictEqual(r.outcome, 'REFUSED')
    const r2 = await w({ condition: WAIT.VISIBLE, ref: 'r1', predicate: '() => { fetch("//evil") }' })
    assert.ok(!JSON.stringify(calls).includes('evil'), 'nothing caller-supplied reached the page')
    assert.strictEqual(r2.outcome, 'HAPPENED')
  })
  test('a visibility wait without a ref is refused rather than widened', async () => {
    const r = await buildWaitFor({ page: fakePage() })({ condition: WAIT.VISIBLE })
    assert.strictEqual(r.reason, 'REF_REQUIRED')
  })
})

describe('S1 / S2 — a screenshot is bounded and is NEVER the record', () => {
  test('it says so about itself', async () => {
    const r = await buildScreenshot({ page: fakePage() })({})
    assert.strictEqual(r.outcome, 'CAPTURED')
    assert.strictEqual(r.isPrimaryRecord, false)
  })
  test('exceeding the bound is STATED, not silently accepted', async () => {
    const r = await buildScreenshot({ page: fakePage({ bytes: 5000 }), maxBytes: 1000 })({})
    assert.strictEqual(r.overBound, true)
    assert.match(r.note, /exceeds the bound/)
  })
  test('within the bound there is no warning — one that always fires is ignored', async () => {
    const r = await buildScreenshot({ page: fakePage({ bytes: 500 }), maxBytes: 1000 })({})
    assert.strictEqual(r.overBound, false)
    assert.strictEqual(r.note, '')
  })
  test('an element scope is reported as such', async () => {
    assert.strictEqual((await buildScreenshot({ page: fakePage() })({ ref: 'r1' })).scope, 'element')
    assert.strictEqual((await buildScreenshot({ page: fakePage() })({})).scope, 'page')
  })
})
