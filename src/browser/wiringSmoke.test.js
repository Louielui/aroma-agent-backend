'use strict'
/**
 * wiringSmoke.test.js — ⛔ THESE TESTS FAIL WHEN THE WIRING IS REMOVED, NOT THE COMPONENT.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS.
 *
 * L1, L3, the profile probes and the government block were each **built, tested, and called by
 * nothing.** Every unit test passed the whole time, because a unit test proves a component
 * BEHAVES and cannot prove it is REACHED.
 *
 * > **Owner: 「A wiring smoke test for each, in the shape that already worked — red when the
 * > WIRING is removed, not when the component is. Prove each one red before you trust it.」**
 *
 * The shape is `routeTableSmoke.test.js`, which was built after the unmounted enquiry router
 * and was proven to go red when the mount was deleted. **Each test below was likewise proven
 * red by deleting its call site — see docs/AUDIT-DESIGN-VS-CODE.md for the evidence.**
 * ══════════════════════════════════════════════════════════════════════════════
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const { buildClick, REFUSAL } = require('./click')
const { checkNavigation, NAV } = require('./navigate')
const { openBrowserSession, OPEN_REFUSED } = require('./browserSession')

const order = { allowedOrigins: ['https://www.costco.ca'] }
const fakeCdp = () => ({ async send () { return { object: { objectId: 'o1' } } } })
const fakePage = (url = 'https://www.costco.ca/checkout') => ({
  calls: [],
  locator () {
    return {
      count: async () => 1,
      click: async (o) => { fakePage.lastClick = o },
      innerText: async () => 'Place Your Order'
    }
  },
  url: () => url,
  evaluate: async () => null
})

describe('L1 IS LIVE INSIDE click() — not merely present in a file', () => {
  test('a payment-named control is REFUSED by click itself', async () => {
    const page = fakePage()
    const r = await buildClick({ page, cdp: fakeCdp(), order })({
      ref: 'r1', domId: 1, expectRole: 'button', expectName: 'Place Your Order'
    })
    assert.strictEqual(r.outcome, 'STOPPED_FOR_YOU',
      'if this passes as CLICKED, checkPaymentStop is no longer called by click()')
    assert.strictEqual(r.reason, REFUSAL.PAYMENT)
    assert.match(r.detail, /you/i, 'and it says the Owner presses it')
  })

  test('and an ordinary control still goes through — the stop is not a blanket refusal', async () => {
    const page = fakePage('https://www.costco.ca/search')
    page.locator = () => ({ count: async () => 1, click: async () => {}, innerText: async () => 'Search' })
    const r = await buildClick({ page, cdp: fakeCdp(), order })({
      ref: 'r1', domId: 1, expectRole: 'button', expectName: 'Search'
    })
    assert.strictEqual(r.outcome, 'CLICKED')
  })
})

describe('THE GOVERNMENT BLOCK IS LIVE INSIDE navigate() — and an order cannot lift it', () => {
  test('a CRA origin is refused even when the order explicitly names it', () => {
    const r = checkNavigation('https://www.cra-arc.gc.ca/myaccount', {
      allowedOrigins: ['https://www.cra-arc.gc.ca']     // deliberately permitted by the order
    })
    assert.strictEqual(r.verdict, NAV.BLOCKED,
      'if this passes, checkOriginPolicy is no longer called by checkNavigation')
    assert.strictEqual(r.governmentBlock, true)
    assert.match(r.reason, /irreversible/)
  })

  test('⛔ and it is checked BEFORE the allowlist, so naming it changes nothing', () => {
    const named = checkNavigation('https://apps.cra-arc.gc.ca/x', { allowedOrigins: ['https://apps.cra-arc.gc.ca'] })
    const unnamed = checkNavigation('https://apps.cra-arc.gc.ca/x', { allowedOrigins: ['https://www.costco.ca'] })
    assert.strictEqual(named.verdict, NAV.BLOCKED)
    assert.strictEqual(unnamed.verdict, NAV.BLOCKED)
    assert.strictEqual(named.governmentBlock, true, 'named must be blocked for the SAME reason')
  })

  test('the CFIA recall register is NOT blocked — reading is not filing', () => {
    const r = checkNavigation('https://recalls-rappels.canada.ca/en/search', {
      allowedOrigins: ['https://recalls-rappels.canada.ca']
    })
    assert.strictEqual(r.verdict, NAV.ALLOWED,
      'a *.gc.ca pattern would kill ERRAND-003, the only errand that ever worked')
  })
})

describe('THE PROBES ARE LIVE IN THE SESSION — it refuses to OPEN, not to warn', () => {
  const clean = {
    payment: () => ({ clean: true, state: 'CLEAN', saying: 'clean' }),
    cardSaving: () => ({ ok: true, state: 'DISABLED', saying: 'off' }),
    signIn: () => ({ ok: true, state: 'BLOCKED', saying: 'blocked' }),
    lock: () => ({ held: false, state: 'FREE', saying: 'free' })
  }
  const chromium = { launchPersistentContext: async () => { throw new Error('A BROWSER WAS LAUNCHED') } }

  test('a card in the profile means NO BROWSER IS STARTED', async () => {
    const r = await openBrowserSession({
      profileDir: 'C:\\nowhere', order, chromium,
      probes: { ...clean, payment: () => ({ clean: false, state: 'PAYMENT_METHOD_PRESENT', saying: 'a card is here' }) }
    })
    assert.strictEqual(r.opened, false, 'if a browser launched, the probes are not wired')
    assert.strictEqual(r.reason, OPEN_REFUSED.PROFILE_DIRTY)
    assert.match(r.detail, /card/)
  })

  test('an UNREADABLE probe is unclean too — blind is not clean (HR-23)', async () => {
    const r = await openBrowserSession({
      profileDir: 'C:\\nowhere', order, chromium,
      probes: { ...clean, cardSaving: () => ({ ok: false, state: 'UNREADABLE', saying: 'cannot read' }) }
    })
    assert.strictEqual(r.opened, false)
  })

  test('Chrome signed into Google blocks the session', async () => {
    const r = await openBrowserSession({
      profileDir: 'C:\\nowhere', order, chromium,
      probes: { ...clean, signIn: () => ({ ok: false, state: 'SIGNED_IN', saying: 'signed in' }) }
    })
    assert.strictEqual(r.opened, false)
  })

  test('a held lock blocks it, and nothing is deleted', async () => {
    const r = await openBrowserSession({
      profileDir: 'C:\\nowhere', order, chromium,
      probes: { ...clean, lock: () => ({ held: true, state: 'LOCKED', saying: 'locked' }) }
    })
    assert.strictEqual(r.opened, false)
  })

  test('⛔ an order that NAMES a blocked origin is refused before any browser exists', async () => {
    const r = await openBrowserSession({
      profileDir: 'C:\\nowhere',
      order: { allowedOrigins: ['https://www.cra-arc.gc.ca'] },
      chromium, probes: clean
    })
    assert.strictEqual(r.opened, false)
    assert.strictEqual(r.reason, OPEN_REFUSED.ORDER_NAMES_A_BLOCKED_ORIGIN)
  })

  test('an absent order refuses too — an absent fence is not an open one', async () => {
    const r = await openBrowserSession({ profileDir: 'C:\\nowhere', order: undefined, chromium, probes: clean })
    assert.strictEqual(r.reason, OPEN_REFUSED.NO_ORDER)
  })
})

describe('L3 IS LIVE ON THE PAGE — the session installs it', () => {
  test('opening a session routes every request through the fence', async () => {
    let routed = null
    const chromium = {
      launchPersistentContext: async () => ({
        pages: () => [{
          route: async (glob, handler) => { routed = { glob, handler } },
          url: () => 'https://www.costco.ca/'
        }],
        newCDPSession: async () => ({ send: async () => ({ nodes: [] }) }),
        close: async () => {}
      })
    }
    const probes = {
      payment: () => ({ clean: true }), cardSaving: () => ({ ok: true }),
      signIn: () => ({ ok: true }), lock: () => ({ held: false })
    }
    const s = await openBrowserSession({ profileDir: 'C:\\nowhere', order, chromium, probes })
    assert.strictEqual(s.opened, true)
    assert.ok(routed, 'if this is null, page.route() is never called and L3 is not installed')
    assert.strictEqual(routed.glob, '**/*', 'the fence must cover EVERY request, not a subset')

    // And the installed handler must actually refuse a write.
    let aborted = false
    await routed.handler({
      request: () => ({ method: () => 'POST', url: () => 'https://www.costco.ca/placeOrder', resourceType: () => 'xhr' }),
      continue: async () => { aborted = false },
      abort: async () => { aborted = true }
    })
    assert.strictEqual(aborted, true, 'the installed handler must be the real fence, not a pass-through')
  })

  test('the session can say which layers are live, from itself', async () => {
    const chromium = {
      launchPersistentContext: async () => ({
        pages: () => [{ route: async () => {}, url: () => 'https://www.costco.ca/' }],
        newCDPSession: async () => ({ send: async () => ({ nodes: [] }) }),
        close: async () => {}
      })
    }
    const probes = {
      payment: () => ({ clean: true }), cardSaving: () => ({ ok: true }),
      signIn: () => ({ ok: true }), lock: () => ({ held: false })
    }
    const s = await openBrowserSession({ profileDir: 'C:\\nowhere', order, chromium, probes })
    const live = s.liveLayers()
    for (const k of ['L1_paymentStop', 'L3_requestFence', 'governmentBlock', 'profileProbes']) {
      assert.ok(live[k], k + ' must be reported live')
    }
  })
})
