'use strict'

/**
 * ephemeralBrowseSession.js — a profile-less browser for public reads, on the EXISTING layers.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THIS IS NOT A SECOND BROWSER ENGINE. It is a different way of STARTING the one we have.
 *
 * Every guarantee comes from a module that already existed and is already tested:
 *
 *   origin policy      governance/originPolicy   — the government block
 *   origin allowlist   browser/navigate          — the order's origins, no wildcard
 *   request fence      governance/requestFence   — GET/HEAD/OPTIONS only, non-GET aborted
 *   payment stop       browser/click             — L1, inside the click verb
 *   composition        browser/session           — read → act → read
 *   launch options     browser/launch            — headed, by construction
 *
 * Nothing here re-implements any of them, and a static test asserts this file contains no
 * navigation, method or payment logic of its own.
 *
 * ⛔ AND IT NEVER TOUCHES A PROFILE. `browserSession.js` opens the Owner's persistent Chrome
 * profile — the one with his sign-in and his saved cards — behind four probes. That path is
 * correct for an errand he authorised and WRONG for a public price check: nothing about
 * reading a shelf price needs to be logged in as him, and a capability that does not need
 * credentials must not be able to reach them.
 *
 * So this file launches a NON-PERSISTENT context. There is no `profileDir` parameter to pass,
 * no `launchPersistentContext` call to make, and no probe to satisfy — because there is no
 * profile to be dirty. A session that cannot sign in cannot buy anything either.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { buildRequestFence } = require('../governance/requestFence')
const { checkOriginPolicy, POLICY } = require('../governance/originPolicy')
const { checkNavigation, NAV } = require('./../browser/navigate')
const { launchOptions } = require('../browser/launch')
const { readPage } = require('../browser/axTree')
const { buildClick } = require('../browser/click')
const { buildType } = require('../browser/type')
const { buildWaitFor, buildScreenshot } = require('../browser/wait')
const { buildSession } = require('../browser/session')
const { isRegisteredOrigin } = require('./siteRegistry')

const OPEN_REFUSED = Object.freeze({
  NO_ORDER: 'NO_SEALED_ORDER',
  NOT_A_PUBLIC_READ: 'ORDER_IS_NOT_A_PUBLIC_READ',
  ORDER_NAMES_A_BLOCKED_ORIGIN: 'ORDER_NAMES_A_BLOCKED_ORIGIN',
  ORIGIN_NOT_IN_REGISTRY: 'ORIGIN_NOT_PUBLISHED_BY_REGISTRY',
  ORDER_ALLOWS_WRITES: 'ORDER_ALLOWS_WRITES'
})

/**
 * Open a profile-less, read-only session for one sealed public-read order.
 *
 * @param {{order:object, chromium?:object}} args  — note the ABSENCE of `profileDir`
 * @returns {Promise<object>} an open session, or `{opened:false, reason, detail}`
 */
async function openEphemeralBrowseSession ({ order, chromium } = {}) {
  if (!order || !Array.isArray(order.allowedOrigins) || !order.allowedOrigins.length) {
    return { opened: false, reason: OPEN_REFUSED.NO_ORDER, detail: 'no sealed order, so nothing is permitted' }
  }
  if (order.kind !== 'public_read') {
    return { opened: false, reason: OPEN_REFUSED.NOT_A_PUBLIC_READ, detail: 'this session only runs public reads' }
  }

  // ⛔ A READ ORDER THAT PERMITS A WRITE IS NOT A READ ORDER. Refused before a browser exists,
  // so the fence never has to be the only thing standing between us and a POST.
  if (Array.isArray(order.allowedWrites) && order.allowedWrites.length > 0) {
    return { opened: false, reason: OPEN_REFUSED.ORDER_ALLOWS_WRITES, detail: 'a public read may not carry write permits' }
  }

  for (const o of order.allowedOrigins) {
    const pol = checkOriginPolicy(o)
    if (pol.verdict !== POLICY.ALLOWED) {
      return { opened: false, reason: OPEN_REFUSED.ORDER_NAMES_A_BLOCKED_ORIGIN, detail: o + ' — ' + pol.reason, host: pol.host }
    }
    // ⛔ THE SECOND FENCE ON REACH: even a well-formed order may only name an origin the
    // reviewed registry published. An order assembled by some future caller cannot invent one.
    if (!isRegisteredOrigin(o)) {
      return { opened: false, reason: OPEN_REFUSED.ORIGIN_NOT_IN_REGISTRY, detail: o }
    }
  }

  // ⛔ NON-PERSISTENT. `launch()` + `newContext()` — no directory, nothing kept, nothing shared
  // with the Owner's own Chrome. Closing it takes the whole profile with it.
  const cr = chromium || require('playwright-core').chromium
  const browser = await cr.launch(launchOptions())
  const ctx = await browser.newContext()
  const page = ctx.pages()[0] || await ctx.newPage()

  // The existing fence, unchanged: GET/HEAD/OPTIONS continue, everything else is aborted
  // because `allowedWrites` is empty.
  const fence = buildRequestFence({ order })
  await page.route('**/*', fence.handle)

  const cdp = await ctx.newCDPSession(page)
  await cdp.send('DOM.enable')
  await cdp.send('Accessibility.enable')

  const s = buildSession({
    read: async () => {
      const { nodes } = await cdp.send('Accessibility.getFullAXTree')
      return readPage(nodes)
    },
    // ⛔ CLICK AND TYPE ARE PERMITTED INSIDE THE FENCED ORIGIN. A public product search needs a
    // search box; refusing to type would make the capability useless while making it no safer,
    // since the fence and the origin allowlist bound where any of it can go.
    click: buildClick({ page, cdp, order }),
    type: buildType({ page, cdp, order }),
    waitFor: buildWaitFor({ page }),
    screenshot: buildScreenshot({ page })
  })

  return {
    opened: true,
    profileless: true,
    page,
    cdp,
    ...s,
    /** ⛔ Navigation still goes through the SHARED check, against this order's origins. */
    navigate: async (url) => {
      const verdict = checkNavigation(url, order)
      if (verdict.verdict !== NAV.ALLOWED) return { ok: false, ...verdict }
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      return { ok: true, origin: verdict.origin }
    },
    liveLayers: () => ({
      governmentBlock: 'checked on the order AND on every navigate',
      originAllowlist: 'browser/navigate, against this order',
      L3_requestFence: 'installed on the page; allowedWrites is empty',
      L1_paymentStop: 'inside click()',
      compositionRule: 'read -> act -> read enforced',
      profile: 'NONE — non-persistent context, no credentials reachable'
    }),
    fenceReport: () => fence.report(),
    close: async () => { await ctx.close(); await browser.close() }
  }
}

module.exports = { openEphemeralBrowseSession, OPEN_REFUSED }
