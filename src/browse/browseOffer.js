'use strict'

/**
 * browseOffer.js — free text becomes an OFFER, never an action.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ A SENTENCE IS NOT A DISPATCH.
 *
 * The Owner typing 「幫我去superstore網站查下peanut butter多少錢？」 produces a described errand he
 * can look at: which site, which words will be searched, what is permitted, what is refused.
 * It does not open a browser, and there is no argument to this function that makes it.
 *
 * This mirrors the offer pattern the repo already uses for work requests and settings: the
 * deterministic entrance produces a proposal, and a separate, explicitly governed step acts on
 * it. Free text reaching a low-level browser verb directly is the shape this exists to prevent.
 *
 * ⛔ E0-B1 IS BUILT AND UNWIRED. Nothing in the intake path imports this; a test asserts it.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { detectBrowseRequest, OUTCOME } = require('./browseIntent')
const { SITES } = require('./siteRegistry')
const { buildBrowseOrder } = require('./browseOrder')

/**
 * Turn the Owner's sentence into a governed offer.
 *
 * @param {{message:string, requestId?:string}} input
 * @returns {{offered:boolean, outcome:string, offer?:object, reason?:string}}
 */
function browseOfferFor (input = {}) {
  const detected = detectBrowseRequest(input && input.message)
  if (!detected.isBrowse) {
    return { offered: false, outcome: detected.outcome, reason: detected.outcome }
  }

  const built = buildBrowseOrder({ siteKey: detected.siteKey, query: detected.query, requestId: input.requestId })
  if (!built.ok) return { offered: false, outcome: OUTCOME.NOT_BROWSE, reason: built.reason }

  const site = SITES[detected.siteKey]
  return {
    offered: true,
    outcome: OUTCOME.BROWSE,
    offer: Object.freeze({
      kind: 'public_read_offer',
      siteKey: site.key,
      siteLabel: site.label,
      query: detected.query,
      field: detected.field,
      // ⛔ THE ORDER TRAVELS WITH THE OFFER SO THE OWNER SEES THE REACH HE IS APPROVING —
      // one origin, no writes, a small budget — rather than approving a sentence.
      order: built.order,
      /** Said plainly, because 「read-only」 is a promise he should be able to check. */
      permits: Object.freeze([
        'open ' + site.label + ' and read pages',
        'type in the site search box and click results, within that one site'
      ]),
      refuses: Object.freeze([
        'sign in, or use any saved profile — the browser has no profile at all',
        'add to cart, checkout, or pay',
        'any POST/PUT/PATCH/DELETE — the order carries no write permits',
        'leaving ' + site.origin
      ])
    })
  }
}

module.exports = { browseOfferFor }
