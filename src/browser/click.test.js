'use strict'
/**
 * click.test.js — written against ACCEPTANCE-CLICK.json, which was frozen BEFORE this file.
 *
 * The baseline (docs/BASELINE-CLICK.md) measured that playwright already refuses covered,
 * moving and disabled elements, and already scrolls, frames and dispatches trusted events.
 * NONE of that is re-implemented or re-tested here. What is tested is the three measured
 * gaps — force, staleness, opaque refusals — and the stop.
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const { buildClick, REFUSAL } = require('./click')

/** A fake page/CDP pair. The library's own behaviour is the baseline's subject, not this
 *  file's; here we test OUR adapter. */
function fakePage (opts = {}) {
  const calls = []
  const page = {
    calls,
    locator (sel) {
      return {
        async count () { return opts.count === undefined ? 1 : opts.count },
        async click (o) {
          calls.push({ sel, o })
          if (opts.clickError) throw new Error(opts.clickError)
        },
        async innerText () { return opts.name === undefined ? 'Add to Cart' : opts.name }
      }
    },
    url: () => opts.url || 'https://www.costco.ca/x',
    // ⚠ THE CONTRACT IS ASSERTED, NOT ASSUMED. The first fake accepted anything, so it
    // agreed with an implementation that passed the probe as a STRING — which the real
    // page.evaluate does not bind arguments to. Every reason came back UNKNOWN live while
    // all 17 unit tests were green. A fake that accepts what the real thing rejects is a
    // measurement instrument that confirms the author. See HR-15 / HR-17.
    async evaluate (fn, arg) {
      assert.strictEqual(typeof fn, 'function',
        'page.evaluate must be given a FUNCTION — a string does not receive the argument')
      assert.strictEqual(typeof arg, 'string', 'and the selector must actually be passed')
      return opts.state || null
    }
  }
  return page
}
const fakeCdp = (opts = {}) => ({
  async send (method) {
    if (method === 'DOM.resolveNode') {
      if (opts.resolveThrows) throw new Error('No node with given id found')
      return { object: { objectId: 'obj-1', className: 'HTMLButtonElement' } }
    }
    return { result: {} }
  }
})

const order = { allowedOrigins: ['https://www.costco.ca'] }
const target = { ref: 'r4f2a9c1b', domId: 12, expectRole: 'button', expectName: 'Add to Cart' }

describe('C1 — a ref resolves to the element read_page named', () => {
  test('it clicks via the tagged locator, never via a raw node handle', async () => {
    const page = fakePage()
    const r = await buildClick({ page, cdp: fakeCdp(), order })(target)
    assert.strictEqual(r.outcome, 'CLICKED')
    assert.match(page.calls[0].sel, /data-aroma-ref/,
      'the click must go through the attribute tag — that path IS the staleness check')
  })

  test('it verifies the element is the one that was READ, by name', async () => {
    const page = fakePage({ name: 'Something Else' })
    const r = await buildClick({ page, cdp: fakeCdp(), order })(target)
    assert.strictEqual(r.outcome, 'REFUSED')
    assert.strictEqual(r.reason, REFUSAL.CHANGED)
    assert.strictEqual(page.calls.length, 0, 'and it did not click first and check after')
  })
})

describe('C2 — staleness refuses, and never acts on a detached node', () => {
  test('a ref whose element left the DOM is refused', async () => {
    const page = fakePage({ count: 0 })
    const r = await buildClick({ page, cdp: fakeCdp(), order })(target)
    assert.strictEqual(r.outcome, 'REFUSED')
    assert.strictEqual(r.reason, REFUSAL.GONE)
    assert.strictEqual(page.calls.length, 0, 'nothing was clicked')
  })

  test('DOM.resolveNode failing is refused too — measured: it can also SUCCEED on a removed node', async () => {
    const page = fakePage()
    const r = await buildClick({ page, cdp: fakeCdp({ resolveThrows: true }), order })(target)
    assert.strictEqual(r.outcome, 'REFUSED')
    assert.strictEqual(r.reason, REFUSAL.GONE)
  })
})

describe('C3 — force is STRUCTURALLY absent', () => {
  test('no click call ever carries force', async () => {
    const page = fakePage()
    await buildClick({ page, cdp: fakeCdp(), order })(target)
    assert.strictEqual(page.calls[0].o.force, undefined)
  })

  test('asking for force THROWS — measured: force:true on a covered button reports success and clicks nothing', async () => {
    const click = buildClick({ page: fakePage(), cdp: fakeCdp(), order })
    await assert.rejects(() => click({ ...target, force: true }), /force is refused/)
  })
})

describe('C4 — a refusal states WHICH reason', () => {
  const withState = (state, err = 'locator.click: Timeout 4000ms exceeded.') => {
    const page = fakePage({ clickError: err, state })
    return { page, click: buildClick({ page, cdp: fakeCdp(), order }) }
  }

  test('an opaque timeout becomes a named cause, and says what covered it', async () => {
    const { click } = withState({ connected: true, disabled: false, covered: true, coveredBy: 'DIV#overlay', stable: true })
    const r = await click(target)
    assert.strictEqual(r.outcome, 'REFUSED')
    assert.strictEqual(r.reason, REFUSAL.COVERED)
    assert.match(r.detail, /overlay/i)
  })

  test('disabled is named disabled', async () => {
    const { click } = withState({ connected: true, disabled: true, covered: false, stable: true })
    assert.strictEqual((await click(target)).reason, REFUSAL.DISABLED)
  })

  test('an unstable element is named unstable, not covered', async () => {
    const { click } = withState({ connected: true, disabled: false, covered: false, stable: false })
    assert.strictEqual((await click(target)).reason, REFUSAL.UNSTABLE)
  })

  test('every reason is a named constant, never a raw library string', async () => {
    const { click } = withState({ connected: true, disabled: true, covered: false, stable: true })
    const r = await click(target)
    assert.ok(Object.values(REFUSAL).includes(r.reason))
    assert.doesNotMatch(r.reason, /Timeout/)
  })

  test('when the probe itself cannot say, the reason is UNKNOWN — not a guess', async () => {
    const { click } = withState(null)
    const r = await click(target)
    assert.strictEqual(r.reason, REFUSAL.UNKNOWN)
    assert.match(r.detail, /Timeout/, 'the raw library message is carried as detail, not as the reason')
  })
})

describe('C6 — the same sealed order as navigate; an unnamed origin is a HALT', () => {
  test('an origin the order did not name is blocked', async () => {
    const page = fakePage({ url: 'https://evil.example.com/x' })
    const r = await buildClick({ page, cdp: fakeCdp(), order })(target)
    assert.strictEqual(r.outcome, 'BLOCKED')
    assert.strictEqual(r.reason, REFUSAL.ORIGIN)
    assert.strictEqual(page.calls.length, 0)
  })

  test('a prefix match does not pass — costco.ca.evil.com is blocked', async () => {
    const page = fakePage({ url: 'https://www.costco.ca.evil.com/x' })
    assert.strictEqual((await buildClick({ page, cdp: fakeCdp(), order })(target)).outcome, 'BLOCKED')
  })

  test('an ABSENT order blocks everything — an absent fence is not an open one', async () => {
    const page = fakePage()
    assert.strictEqual((await buildClick({ page, cdp: fakeCdp(), order: undefined })(target)).outcome, 'BLOCKED')
  })
})

describe('C8 / C9 — the record, and one action only', () => {
  test('the record carries role and name and NO coordinates', async () => {
    const r = await buildClick({ page: fakePage(), cdp: fakeCdp(), order })(target)
    assert.strictEqual(r.record.role, 'button')
    assert.strictEqual(r.record.name, 'Add to Cart')
    assert.strictEqual(r.record.ref, 'r4f2a9c1b')
    assert.ok(!/"x":|"y":|clientX|boundingBox/.test(JSON.stringify(r)))
  })

  test('one call clicks at most once — no retry, no fallback', async () => {
    const page = fakePage({
      clickError: 'locator.click: Timeout 4000ms exceeded.',
      state: { connected: true, disabled: false, covered: true, coveredBy: 'DIV', stable: true }
    })
    await buildClick({ page, cdp: fakeCdp(), order })(target)
    assert.strictEqual(page.calls.length, 1, 'exactly one attempt')
  })

  test('an ambiguous tag is refused rather than resolved by picking', async () => {
    const page = fakePage({ count: 2 })
    const r = await buildClick({ page, cdp: fakeCdp(), order })(target)
    assert.strictEqual(r.outcome, 'REFUSED')
    assert.strictEqual(r.reason, REFUSAL.AMBIGUOUS)
    assert.strictEqual(page.calls.length, 0)
  })
})
