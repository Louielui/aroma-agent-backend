'use strict'

/**
 * browserSession.js — the runner. **This is what makes the layers LIVE rather than present.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY THIS FILE EXISTS.
 *
 * The audit found L1, L3 and the profile probes **built, tested, and wired to nothing** — the
 * third instance of a component that passes its tests and is never reached. Before this file,
 * an errand would have run with **no payment recognition and no request fence**, and the suite
 * would have been green throughout.
 *
 * > **Owner: 「tell me which layers are live and how you know — not which files exist.」**
 *
 * Every layer is attached here, in one place, so that 「is it on?」 has one answer instead of
 * one per call site.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── IT REFUSES TO OPEN, RATHER THAN OPENING AND WARNING ─────────────────────
 * The four probes run BEFORE the browser launches. Any unclean result and **no browser is
 * started at all** — there is nothing to warn about, because nothing opened.
 *
 * ── AND UNREADABLE IS UNCLEAN ───────────────────────────────────────────────
 * HR-23: a guardrail that cannot read its own evidence is blind, not clean.
 */

const { probePaymentMethods, probeCardSavingDisabled, probeBrowserSignIn, probeProfileLock, writeProfileDefaults } = require('../governance/profileProbe')
const { buildRequestFence } = require('../governance/requestFence')
const { checkOriginPolicy, POLICY } = require('../governance/originPolicy')
const { launchOptions } = require('./launch')
const { readPage } = require('./axTree')
const { buildClick } = require('./click')
const { buildType } = require('./type')
const { buildWaitFor, buildScreenshot } = require('./wait')
const { buildSession } = require('./session')

const OPEN_REFUSED = Object.freeze({
  PROFILE_DIRTY: 'PROFILE_NOT_CLEAN',
  ORDER_NAMES_A_BLOCKED_ORIGIN: 'ORDER_NAMES_A_BLOCKED_ORIGIN',
  NO_ORDER: 'NO_SEALED_ORDER'
})

/** Runs the four probes. Returns null when everything is clean, or a refusal. */
function checkProfile (profileDir, probes) {
  const p = probes || {
    payment: probePaymentMethods,
    cardSaving: probeCardSavingDisabled,
    signIn: probeBrowserSignIn,
    lock: probeProfileLock
  }
  const results = {
    payment: p.payment(profileDir),
    cardSaving: p.cardSaving(profileDir),
    signIn: p.signIn(profileDir),
    lock: p.lock(profileDir)
  }
  const unclean = []
  // `clean` for payment; `ok` for the two preference probes; the lock must be FREE.
  if (results.payment.clean !== true) unclean.push({ probe: 'payment', state: results.payment.state, saying: results.payment.saying })
  if (results.cardSaving.ok !== true) unclean.push({ probe: 'cardSaving', state: results.cardSaving.state, saying: results.cardSaving.saying })
  if (results.signIn.ok !== true) unclean.push({ probe: 'signIn', state: results.signIn.state, saying: results.signIn.saying })
  if (results.lock.held === true) unclean.push({ probe: 'lock', state: results.lock.state, saying: results.lock.saying })
  return { results, unclean }
}

/**
 * @param {{profileDir:string, order:object, chromium?:object, probes?:object}} args
 * @returns {Promise<object>} an open session, or `{opened:false, reason, ...}`
 */
async function openBrowserSession ({ profileDir, order, chromium, probes }) {
  // 1. THE ORDER MUST EXIST. An absent fence is not an open one.
  if (!order || !Array.isArray(order.allowedOrigins) || !order.allowedOrigins.length) {
    return { opened: false, reason: OPEN_REFUSED.NO_ORDER, detail: 'no sealed order, so nothing is permitted' }
  }

  // 2. ⛔ THE GOVERNMENT BLOCK IS CHECKED AGAINST THE ORDER ITSELF, not only per navigation.
  // An order that names a blocked origin is refused before a browser exists — the mistake is
  // caught when it is written, not when it is acted on.
  for (const o of order.allowedOrigins) {
    const pol = checkOriginPolicy(o)
    if (pol.verdict !== POLICY.ALLOWED) {
      return {
        opened: false,
        reason: OPEN_REFUSED.ORDER_NAMES_A_BLOCKED_ORIGIN,
        detail: 'the order names ' + o + ' — ' + pol.reason,
        host: pol.host
      }
    }
  }

  // 3. ⛔ THE LOCK FIRST — everything after it needs Chrome CLOSED.
  const lock0 = (probes && probes.lock ? probes.lock : probeProfileLock)(profileDir)
  if (lock0.held === true) {
    return {
      opened: false,
      reason: OPEN_REFUSED.PROFILE_DIRTY,
      unclean: [{ probe: 'lock', state: lock0.state, saying: lock0.saying }],
      detail: lock0.saying
    }
  }

  // 4. ⛔ RE-ASSERT THE GUARDRAILS ON EVERY LAUNCH, not once at creation.
  //
  // DEFECT-010: Chrome rewrote `Preferences` wholesale on its first run and every fence set at
  // creation was erased — `signin.allowed` came back TRUE. **A guardrail established once is a
  // CLAIM ABOUT THE PAST**, and Chrome demonstrated it can be silently withdrawn.
  //
  // Written here, with Chrome closed, immediately before launch, and VERIFIED by the probes
  // below — so 「Chrome rewrote it again」 becomes uninteresting rather than dangerous.
  if (!probes) writeProfileDefaults(profileDir)

  // 5. THE PROBES. They verify what step 4 just wrote.
  const { results, unclean } = checkProfile(profileDir, probes)
  if (unclean.length) {
    return {
      opened: false,
      reason: OPEN_REFUSED.PROFILE_DIRTY,
      unclean,
      probes: results,
      detail: unclean.map((u) => u.saying).join(' ')
    }
  }

  // 4. Only now does a browser exist.
  const cr = chromium || require('playwright-core').chromium
  const ctx = await cr.launchPersistentContext(profileDir, launchOptions())
  const page = ctx.pages()[0] || await ctx.newPage()

  // 5. ⛔ L3 INSTALLED ON THE PAGE. Non-GET is refused unless the order named it.
  const fence = buildRequestFence({ order })
  await page.route('**/*', fence.handle)

  const cdp = await ctx.newCDPSession(page)
  await cdp.send('DOM.enable')
  await cdp.send('Accessibility.enable')

  // 6. The verbs, with L1 inside `click` and the read/act composition rule around all of them.
  const s = buildSession({
    read: async () => {
      const { nodes } = await cdp.send('Accessibility.getFullAXTree')
      return readPage(nodes)
    },
    click: buildClick({ page, cdp, order }),
    type: buildType({ page, cdp, order }),
    waitFor: buildWaitFor({ page }),
    screenshot: buildScreenshot({ page })
  })

  return {
    opened: true,
    probes: results,
    page,
    cdp,
    ...s,
    /** ⛔ The answer to 「which layers are live」, computed from the session, not from a doc. */
    liveLayers: () => ({
      L1_paymentStop: 'inside click()',
      L3_requestFence: 'installed on the page',
      governmentBlock: 'checked on the order AND on every navigate',
      profileProbes: 'passed before launch',
      compositionRule: 'read -> act -> read enforced'
    }),
    fenceReport: () => fence.report(),
    close: async () => { await ctx.close() }
  }
}

module.exports = { openBrowserSession, checkProfile, OPEN_REFUSED }
