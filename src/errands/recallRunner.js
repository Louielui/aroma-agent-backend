'use strict'

/**
 * recallRunner.js — opens a browser, runs the recall check for each ingredient, closes it.
 *
 * ONE copy of the setup, used by BOTH the hand-run script and the scheduled route. When these
 * were two copies, the scheduled path could have drifted into a browser with different fences —
 * and it is the path that runs while nobody is watching.
 *
 * ⛔ EVERY FENCE IS HERE, AND THIS IS THE READ-ONLY CAPABILITY HANDLE.
 *
 * DESIGN-SCHEDULED-SURFACE §4 asked for the scheduled runner to be HANDED something that cannot
 * write, rather than told not to. That is not a new mechanism — it already exists:
 *
 *   L3 request fence  → non-GET is DENIED unless the sealed order named it, and this order
 *                       names none. So the browser handed out below is physically incapable of
 *                       a POST, a PUT or a DELETE, on any origin.
 *   origin policy     → one allowed host; government submission surfaces blocked by name.
 *   L1 payment stop   → inside click().
 *   composition rule  → read → act → read, enforced by the session.
 *   no profile        → ephemeral browser, no credential (HR-29).
 *
 * 「唔可能」,唔係「唔准」.
 */

const { chromium } = require('playwright-core')
const { launchOptions } = require('../browser/launch')
const { readPage } = require('../browser/axTree')
const { checkNavigation, NAV } = require('../browser/navigate')
const { buildClick } = require('../browser/click')
const { buildType } = require('../browser/type')
const { buildWaitFor } = require('../browser/wait')
const { buildSession } = require('../browser/session')
const { buildRequestFence } = require('../governance/requestFence')
const { checkRecall, HOST, SEARCH_PATH } = require('./recallCheck')

const ORDER = { allowedOrigins: [HOST] }

/**
 * What she checks every morning.
 *
 * ⛔ THE OWNER'S ACTUAL STOCK, NAMED BY HIM ON 2026-08-07. Not a guess, and not a placeholder.
 *
 * > 「What I actually stock and would act on a recall for: mushrooms · chicken · cheese · beef ·
 * > romaine · green onion.」
 *
 * The previous list was mine — six items chosen because six felt like a list, which is not a
 * reason (HR-28). A placeholder in something that runs unattended every morning is worse than
 * a placeholder anywhere else: it produces a confident daily answer about the wrong question.
 */
const DEFAULT_INGREDIENTS = ['mushrooms', 'chicken', 'cheese', 'beef', 'romaine', 'green onion']

/**
 * ⛔ MEASURED, NOT POLITE-BY-GUESS: six back-to-back searches BROKE the register.
 *
 * The first scheduled run answered 2 of 6. Ingredient 3 timed out on the search button and
 * 4–6 failed to navigate at all. The site throttles a rapid sequence from one session — which
 * a single hand-run of one ingredient would never have shown, and which the scheduled path
 * would have hit every morning while nobody watched.
 *
 * A pause is the correct fix rather than a retry: retrying harder against something that is
 * slowing you down is how a read-only errand starts to look like abuse.
 */
const PAUSE_BETWEEN_MS = 5000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * @param {string[]=} ingredients
 * @returns {Promise<Array<{suffix, title, result}>>} one entry per ingredient, in the shape
 *   `runScheduledErrands` records. It NEVER throws for an errand-level failure — a site that
 *   fell over is a recorded BLOCKED_BY_SITE, not a lost run.
 */
async function runRecallForIngredients (ingredients) {
  const list = (ingredients && ingredients.length) ? ingredients : DEFAULT_INGREDIENTS
  const b = await chromium.launch(launchOptions())
  try {
    const page = await b.newPage()
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('DOM.enable')
    await cdp.send('Accessibility.enable')

    const fence = buildRequestFence({ order: ORDER })
    await page.route('**/*', fence.handle)

    const session = buildSession({
      read: async () => {
        const { nodes } = await cdp.send('Accessibility.getFullAXTree')
        return readPage(nodes, { maxNodes: 500, maxChars: 40000 })
      },
      click: buildClick({ page, cdp, order: ORDER }),
      type: buildType({ page, cdp, order: ORDER }),
      waitFor: buildWaitFor({ page }),
      screenshot: async () => ({ outcome: 'CAPTURED' })
    })

    const goto = async (url) => {
      const nav = checkNavigation(url, ORDER)
      if (nav.verdict !== NAV.ALLOWED) return { ok: false, reason: nav.reason }
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
      return { ok: true }
    }

    const out = []
    for (const q of list) {
      if (out.length) await sleep(PAUSE_BETWEEN_MS)
      let result
      try {
        result = await checkRecall({ session, goto, query: q, url: HOST + SEARCH_PATH })
      } catch (e) {
        result = { outcome: 'BLOCKED_BY_SITE', detail: '查「' + q + '」嗰陣爆咗:' + String(e && e.message).split('\n')[0].slice(0, 100) }
      }
      out.push({ suffix: q, title: '回收檢查 — ' + q, result })
    }
    out.fenceReport = fence.report()
    return out
  } finally {
    // Always. A scheduled run that leaks a Chrome every morning is a slow failure that would
    // show up a week later as something else entirely.
    await b.close().catch(() => {})
  }
}

module.exports = { runRecallForIngredients, DEFAULT_INGREDIENTS, ORDER }
