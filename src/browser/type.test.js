'use strict'
/**
 * type.test.js — against ACCEPTANCE-TYPE-WAIT.json, frozen before this file.
 *
 * The baseline measured that the library already replaces existing content, fires real input
 * events, handles contenteditable, and refuses readonly / disabled / wrong-type. None of that
 * is re-tested. What is tested is force, passwords, the record, named reasons, and the stop.
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const { buildType, TYPE_REFUSAL } = require('./type')

function fakePage (opts = {}) {
  const calls = []
  return {
    calls,
    locator () {
      return {
        async count () { return opts.count === undefined ? 1 : opts.count },
        async fill (v, o) { calls.push({ v, o }); if (opts.fillError) throw new Error(opts.fillError) },
        async press (k) { calls.push({ press: k }) },
        async getAttribute (a) { return (opts.attrs || {})[a] === undefined ? null : opts.attrs[a] },
        async inputValue () { return opts.value === undefined ? '' : opts.value }
      }
    },
    url: () => opts.url || 'https://www.costco.ca/x',
    async evaluate (fn, arg) {
      assert.strictEqual(typeof fn, 'function', 'page.evaluate must receive a FUNCTION')
      assert.strictEqual(typeof arg, 'string', 'and the selector must be passed')
      return opts.state || null
    }
  }
}
const fakeCdp = () => ({ async send () { return { object: { objectId: 'o1' } } } })
const order = { allowedOrigins: ['https://www.costco.ca'] }
const target = { ref: 'r1', domId: 5, expectRole: 'textbox', expectName: 'Search' }

describe('T1 — force is structurally absent', () => {
  test('asking for force throws', async () => {
    const t = buildType({ page: fakePage(), cdp: fakeCdp(), order })
    await assert.rejects(() => t({ ...target, text: 'x', force: true }), /force is refused/)
  })
  test('no fill call ever carries force', async () => {
    const page = fakePage()
    await buildType({ page, cdp: fakeCdp(), order })({ ...target, text: 'paper towels' })
    assert.strictEqual(page.calls[0].o && page.calls[0].o.force, undefined)
  })
})

describe('T2 — a password field is REFUSED, not redacted', () => {
  test('input[type=password] is refused before anything is typed', async () => {
    const page = fakePage({ attrs: { type: 'password' } })
    const r = await buildType({ page, cdp: fakeCdp(), order })({ ...target, text: 'hunter2' })
    assert.strictEqual(r.outcome, 'REFUSED')
    assert.strictEqual(r.reason, TYPE_REFUSAL.CREDENTIAL)
    assert.strictEqual(page.calls.length, 0, 'nothing was typed')
  })
  test('a field NAMED like a credential is refused too', async () => {
    for (const name of ['Password', 'Card number', 'CVV', 'Social Insurance Number']) {
      const page = fakePage()
      const r = await buildType({ page, cdp: fakeCdp(), order })({ ...target, expectName: name, text: 'x' })
      assert.strictEqual(r.reason, TYPE_REFUSAL.CREDENTIAL, name)
      assert.strictEqual(page.calls.length, 0)
    }
  })
  test('an ordinary field is not refused', async () => {
    const page = fakePage()
    const r = await buildType({ page, cdp: fakeCdp(), order })({ ...target, expectName: 'Search', text: 'x' })
    assert.strictEqual(r.outcome, 'TYPED')
  })
})

describe('T3 — the typed value NEVER reaches the record', () => {
  test('the record carries length and a shape class, not the text', async () => {
    const r = await buildType({ page: fakePage(), cdp: fakeCdp(), order })({ ...target, text: 'Bounty 12 pack' })
    const s = JSON.stringify(r)
    assert.ok(!s.includes('Bounty'), 'the value leaked into the result: ' + s)
    assert.strictEqual(r.record.length, 14)
    assert.strictEqual(r.record.shape, 'text')
  })
  test('a digit-heavy value is classified without being quoted', async () => {
    const r = await buildType({ page: fakePage(), cdp: fakeCdp(), order })({ ...target, text: '4111111111111111' })
    assert.ok(!JSON.stringify(r).includes('4111'))
    assert.strictEqual(r.record.shape, 'digits')
  })
})

describe('T4 — named refusal reasons, never an opaque timeout', () => {
  const withState = (state) => {
    const page = fakePage({ fillError: 'page.fill: Timeout 2500ms exceeded.', state })
    return { page, t: buildType({ page, cdp: fakeCdp(), order }) }
  }
  test('readonly is named', async () => {
    const { t } = withState({ connected: true, readonly: true, disabled: false })
    assert.strictEqual((await t({ ...target, text: 'x' })).reason, TYPE_REFUSAL.READONLY)
  })
  test('disabled is named', async () => {
    const { t } = withState({ connected: true, readonly: false, disabled: true })
    assert.strictEqual((await t({ ...target, text: 'x' })).reason, TYPE_REFUSAL.DISABLED)
  })
  test('a wrong-type error is carried as its own reason', async () => {
    const page = fakePage({ fillError: 'page.fill: Error: Cannot type text into input[type=number]' })
    const r = await buildType({ page, cdp: fakeCdp(), order })({ ...target, text: 'abc' })
    assert.strictEqual(r.reason, TYPE_REFUSAL.WRONG_TYPE)
  })
  test('when the probe cannot say, the reason is UNKNOWN — not a guess', async () => {
    const { t } = withState(null)
    const r = await t({ ...target, text: 'x' })
    assert.strictEqual(r.reason, TYPE_REFUSAL.UNKNOWN)
    assert.match(r.detail, /Timeout/)
  })
})

describe('T5 / T6 / T7 — verify first, the sealed order, and no submit', () => {
  test('a gone element refuses before typing', async () => {
    const page = fakePage({ count: 0 })
    const r = await buildType({ page, cdp: fakeCdp(), order })({ ...target, text: 'x' })
    assert.strictEqual(r.reason, TYPE_REFUSAL.GONE)
    assert.strictEqual(page.calls.length, 0)
  })
  test('an origin the order did not name is blocked', async () => {
    const page = fakePage({ url: 'https://evil.example.com/' })
    assert.strictEqual((await buildType({ page, cdp: fakeCdp(), order })({ ...target, text: 'x' })).outcome, 'BLOCKED')
    assert.strictEqual(page.calls.length, 0)
  })
  test('an absent order blocks everything', async () => {
    const page = fakePage()
    assert.strictEqual((await buildType({ page, cdp: fakeCdp(), order: undefined })({ ...target, text: 'x' })).outcome, 'BLOCKED')
  })
  test('⛔ it NEVER presses Enter — typing and submitting are different acts', async () => {
    const page = fakePage()
    await buildType({ page, cdp: fakeCdp(), order })({ ...target, text: 'paper towels', submit: true, pressEnter: true })
    assert.ok(page.calls.every((c) => !c.press), 'no key press of any kind: ' + JSON.stringify(page.calls))
  })
})
