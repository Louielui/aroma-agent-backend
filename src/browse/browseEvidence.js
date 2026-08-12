'use strict'

/**
 * browseEvidence.js — a browse run described in A1's vocabulary, not a second one.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THIS FILE REPLACES `browseResult.js`, WHICH WAS DELETED RATHER THAN REFACTORED.
 *
 * That file invented `STATUS`, `SOURCE` and `REASON` to say things A1 already says. Its four
 * statuses were not even four of a kind — they were two different A1 concepts wearing one enum,
 * which is why they never fitted:
 *
 *   BLOCKED     -> READ_FAILED: <reason>        we did not finish
 *   INCOMPLETE  -> checkEvidence {ok:false}     we did not finish
 *   NOT_FOUND   -> NO_RELEVANT_RESULTS          WE FINISHED. The answer is 「none」.
 *   COMPLETED   -> RESULTS_FOUND + {ok:true}    we finished and can support a claim
 *
 * And A1 carries a rule the deleted file never had: `NO_RELEVANT_RESULTS` supports 「沒有找到」
 * and NEVER 「沒有」. One is a fact about our search; the other is a claim about the world.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── ⛔ A MERGED #37 DOES NOT TURN THE EVIDENCE GATE ON ───────────────────────
 *
 * This module speaks A1's vocabulary and calls `checkEvidence`. Neither fact activates A1.
 *
 * `checkEvidence` has ZERO production call sites and had zero before this existed. E0-B1 is
 * itself unwired — an isolation test asserts no production file imports it. So this is unwired
 * code depending on unwired code, which is legitimate and is NOT activation.
 *
 * ⛔ WRITTEN HERE BECAUSE THIS IS WHERE SOMEONE WOULD READ IT BACKWARDS. Six weeks from now the
 * imports, the descriptor and the gate call all look like a live evidence path. They are not.
 * Turning A1 on is a separate, measured phase with its own plan (docs/A1-SHADOW-WIRING-PLAN.md)
 * and it has not happened.
 *
 * ── ⛔ A SEARCH RESULTS PAGE IS A SAMPLE, AND THAT IS THE WHOLE REASON THIS WAITED FOR A1 ──
 *
 * > **Owner: 「It must never render as 『Superstore 賣 $4.99』 — it is one row from a page we
 * > could not count.」**
 *
 * The deleted version would have said a price as though it were THE price. Here the descriptor
 * makes that impossible to state honestly:
 *
 *   completeness   'sample'    always — a results page is page one of an unknown number
 *   truncated      true        always — there is more we did not read
 *   matchingTotal  null        UNLESS the page literally printed 「1-24 of 87」
 *   sourceTotal    null        always. No shop tells us its catalogue size.
 *   filtersApplied null        NOT []. The site applies a store predicate we cannot enumerate,
 *                              so it is UNKNOWN, never 「known to be none」. (Owner correction 3
 *                              on A1, and the reason the hand-written Chinese caveat is gone.)
 */

const { READ_STATE } = require('../context/adapters/aromaSystemRead')
const { isRegisteredOrigin } = require('./siteRegistry')

/** What a browse observation must carry before it is allowed to be evidence of anything. */
const OBSERVATION_REFUSED = Object.freeze({
  NOT_AN_OBJECT: 'observation_is_not_an_object',
  NO_PRODUCT: 'observation_names_no_product',
  ORIGIN_NOT_IN_ORDER: 'observation_origin_is_not_in_the_sealed_order',
  ORIGIN_NOT_REGISTERED: 'observation_origin_was_never_published_by_the_registry',
  NO_OBSERVED_AT: 'observation_carries_no_timestamp'
})

/** A displayed price, as a string the page actually showed. */
const PRICE_SHAPE = /^\$?\s*\d{1,4}(?:[.,]\d{2})?\s*$/

/**
 * ⛔ BOUND TO THE SEALED ORDER — NOT TO A `source: 'browser'` FIELD THE CALLER SET.
 *
 * This is the independent review's finding, and the one that mattered. The deleted file trusted
 * `obs.source === 'browser'` and regex-checked that `sourceOrigin` merely LOOKED like a URL, so
 * a caller could mint a COMPLETED from an origin the request fence would have refused.
 *
 * The order is now the authority. An observation whose origin is not in `order.allowedOrigins`
 * is not weak evidence — it is not evidence, and it cannot be made into any by a field it
 * carries about itself. Self-declared provenance is what A1 removed when it deleted
 * `totalCount`.
 */
function admitObservation (obs, order) {
  if (!obs || typeof obs !== 'object') return { ok: false, reason: OBSERVATION_REFUSED.NOT_AN_OBJECT }
  if (typeof obs.product !== 'string' || !obs.product.trim()) return { ok: false, reason: OBSERVATION_REFUSED.NO_PRODUCT }
  if (typeof obs.observedAt !== 'string' || !obs.observedAt.trim()) return { ok: false, reason: OBSERVATION_REFUSED.NO_OBSERVED_AT }

  const origin = typeof obs.sourceOrigin === 'string' ? obs.sourceOrigin : ''
  const allowed = (order && Array.isArray(order.allowedOrigins)) ? order.allowedOrigins : []
  if (!allowed.includes(origin)) return { ok: false, reason: OBSERVATION_REFUSED.ORIGIN_NOT_IN_ORDER }
  // Second fence, on the same terms as the session's: even an order that named it must have
  // named something the reviewed registry published.
  if (!isRegisteredOrigin(origin)) return { ok: false, reason: OBSERVATION_REFUSED.ORIGIN_NOT_REGISTERED }

  return { ok: true }
}

const hasDisplayedPrice = (obs) => typeof obs.price === 'string' && PRICE_SHAPE.test(obs.price.trim())

/**
 * Describe one browse run as an A1 EvidenceSet.
 *
 * @param {object} input
 * @param {object} input.order          the sealed public-read order
 * @param {object[]} [input.observations]
 * @param {{blocked:boolean, reason?:string}} [input.navigation]
 * @param {boolean} [input.searchPerformed]
 * @param {number|null} [input.pageStatedTotal]  ONLY when the page printed 「1-24 of 87」
 * @param {string|null} [input.storeContext]     the branch, when one was chosen
 */
function describeBrowseRun (input = {}) {
  const order = input.order || null
  const site = order && order.siteLabel ? order.siteLabel : (order && order.allowedOrigins && order.allowedOrigins[0]) || null

  const admitted = []
  const refused = []
  for (const obs of (Array.isArray(input.observations) ? input.observations : [])) {
    const verdict = admitObservation(obs, order)
    if (verdict.ok) admitted.push(obs)
    else refused.push({ reason: verdict.reason })
  }

  // ⛔ BLOCKED OUTRANKS EVERYTHING, and it is a READ_FAILED — not an empty result. If we never
  // reached the page, nothing we hold is an observation of it.
  const blocked = !!(input.navigation && input.navigation.blocked === true)

  const readState = blocked
    ? READ_STATE.failed(String((input.navigation && input.navigation.reason) || 'navigation blocked'))
    : (admitted.length > 0 ? READ_STATE.FOUND : READ_STATE.NONE)

  return Object.freeze({
    source: 'public_web',
    sourceLabel: site,
    trust: 'live',
    readState,

    // ── HOW MANY, AND OF WHAT ────────────────────────────────────────────────
    returnedRows: admitted.length,
    shownCount: admitted.length,
    /**
     * ⛔ null UNLESS THE PAGE SAID SO. 「1-24 of 87」 printed on the page is the only thing that
     * establishes it; counting the rows we happened to read establishes nothing.
     */
    matchingTotal: Number.isFinite(input.pageStatedTotal) ? input.pageStatedTotal : null,
    /** ⛔ ALWAYS null. No shop publishes its catalogue size, and it has never been asked to. */
    sourceTotal: null,

    // ── WHICH ROWS, AND WHETHER WE GOT THEM ALL ──────────────────────────────
    queryScope: Object.freeze({
      field: (order && order.searchParam) || 'search',
      window: null,
      declaredBy: 'reader'
    }),
    /**
     * ⛔ null, NOT []. An empty array asserts 「known to have NO filters」. The site applies a
     * store/location predicate we did not choose and cannot enumerate, so the honest value is
     * UNKNOWN — and the hand-written Chinese caveat this replaces is gone entirely. (HR-58.)
     */
    filtersApplied: null,
    limit: null,
    limitKnown: false,
    /** ⛔ ALWAYS true on a results page: there is always more we did not read. */
    truncated: !blocked,
    completeWithinScope: false,

    // ── THE SHAPE OF A ROW ───────────────────────────────────────────────────
    rowShape: Object.freeze({
      /** A store was chosen, or it was not. Never a boolean about the SITE. */
      hasLocation: typeof input.storeContext === 'string' && !!input.storeContext.trim(),
      hasAsOf: admitted.length > 0,
      note: null
    }),
    completeness: 'sample',

    // ── THE ROWS THEMSELVES ──────────────────────────────────────────────────
    items: Object.freeze(admitted.map((o) => Object.freeze({
      product: o.product.trim(),
      packageSize: (typeof o.packageSize === 'string' && o.packageSize.trim()) ? o.packageSize.trim() : null,
      price: hasDisplayedPrice(o) ? o.price.trim() : null,
      sourceOrigin: o.sourceOrigin,
      pageUrl: typeof o.pageUrl === 'string' ? o.pageUrl : null,
      observedAt: o.observedAt
    }))),
    storeContext: (typeof input.storeContext === 'string' && input.storeContext.trim()) ? input.storeContext.trim() : null,
    searchPerformed: input.searchPerformed === true,
    /** Observations the order refused, counted so a silent drop is impossible. */
    refusedObservations: Object.freeze(refused)
  })
}

module.exports = { describeBrowseRun, admitObservation, OBSERVATION_REFUSED, PRICE_SHAPE }
