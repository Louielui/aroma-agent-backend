'use strict'

/**
 * browseResult.js — WHEN A BROWSER TASK IS ACTUALLY FINISHED.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ FINDING RELATED TEXT IS NOT COMPLETING THE TASK.
 *
 * The Owner asked 「peanut butter 幾多錢？」. The field he wants is a PRICE. A run that comes back
 * with 「Superstore 有好多花生醬，價格因品牌同容量而異」 has found related text and answered
 * nothing — and the dangerous part is that it READS like success. It is fluent, it is true,
 * and the Owner still does not know what the peanut butter costs.
 *
 * So completion is not a feeling about the prose. It is a claim about EVIDENCE, and this module
 * is where that claim is checked:
 *
 *   COMPLETED    at least one product with a browser-observed price
 *   INCOMPLETE   products found, no trustworthy price
 *   BLOCKED      the site or a fence stopped us getting there
 *   NOT_FOUND    the bounded search found no matching product
 *
 * ⛔ ONLY `COMPLETED` IS SUCCESS. The other three are outcomes to report, never to dress up.
 *
 * ⛔ AND MODEL TEXT IS NOT EVIDENCE. A plausible number in a summary, a fallback sentence or a
 * remembered price is not something the browser saw. Every observation carries where it came
 * from, and anything that is not `source: 'browser'` cannot raise the status — not even when it
 * looks exactly like the right answer. That is the whole point: a hallucinated $4.99 is
 * indistinguishable from a real one at the moment you most want it to be true.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const STATUS = Object.freeze({
  COMPLETED: 'COMPLETED',
  BLOCKED: 'BLOCKED',
  NOT_FOUND: 'NOT_FOUND',
  INCOMPLETE: 'INCOMPLETE'
})

/** ⛔ Exactly one of these means the Owner's question was answered. */
const SUCCESS_STATUSES = Object.freeze([STATUS.COMPLETED])

/** Where an observation came from. Only the first can support a claim about the world. */
const SOURCE = Object.freeze({
  BROWSER: 'browser',
  MODEL_TEXT: 'model_text',
  FALLBACK: 'fallback',
  SEARCH_SUMMARY: 'search_summary'
})

const REASON = Object.freeze({
  NO_PRICE: 'products_found_without_a_verifiable_price',
  NO_PRODUCT: 'no_matching_product_within_the_bounded_search',
  NAVIGATION_BLOCKED: 'navigation_or_fence_blocked_the_page',
  ONLY_UNVERIFIED_TEXT: 'only_unverified_text_offered_a_price'
})

/** A displayed price, as a string the page actually showed. */
const PRICE_SHAPE = /^\$?\s*\d{1,4}(?:[.,]\d{2})?\s*$/

/**
 * Is this a usable price observation?
 *
 * ⛔ THE SOURCE CHECK COMES FIRST AND CANNOT BE ARGUED WITH. A well-formed price from model
 * text is still not a price the browser saw.
 */
function isBrowserPrice (obs) {
  if (!obs || typeof obs !== 'object') return false
  if (obs.source !== SOURCE.BROWSER) return false
  if (typeof obs.price !== 'string' || !PRICE_SHAPE.test(obs.price.trim())) return false
  if (typeof obs.product !== 'string' || obs.product.trim() === '') return false
  if (typeof obs.sourceOrigin !== 'string' || !/^https?:\/\//.test(obs.sourceOrigin)) return false
  if (typeof obs.observedAt !== 'string' || obs.observedAt.trim() === '') return false
  return true
}

const isBrowserProduct = (obs) =>
  !!obs && typeof obs === 'object' && obs.source === SOURCE.BROWSER &&
  typeof obs.product === 'string' && obs.product.trim() !== ''

/**
 * Decide the outcome of one browse run.
 *
 * @param {object} input
 * @param {object[]} [input.observations]  everything seen, each with its own `source`
 * @param {{blocked:boolean, reason?:string}} [input.navigation]
 * @param {boolean} [input.searchPerformed]
 * @param {boolean} [input.locationDependent]  the registry's flag for this site
 * @param {string|null} [input.storeContext]   the store the prices belong to, if one was chosen
 * @param {string|null} [input.field]          what the Owner asked for; 'price' today
 */
function classifyBrowseResult (input = {}) {
  const observations = Array.isArray(input.observations) ? input.observations : []
  const field = input.field || 'price'

  const base = {
    field,
    observations: observations.length,
    browserObservations: observations.filter(isBrowserProduct).length,
    locationDependent: input.locationDependent === true,
    storeContext: typeof input.storeContext === 'string' && input.storeContext.trim() ? input.storeContext.trim() : null
  }

  // ⛔ BLOCKED OUTRANKS EVERYTHING. If we never got to the page, nothing we hold is an
  // observation of it, however much text came back.
  if (input.navigation && input.navigation.blocked === true) {
    return Object.assign({ status: STATUS.BLOCKED, reason: REASON.NAVIGATION_BLOCKED, detail: input.navigation.reason || null, evidence: [] }, base)
  }

  const priced = observations.filter(isBrowserPrice)
  if (priced.length) {
    return Object.assign({
      status: STATUS.COMPLETED,
      reason: null,
      evidence: priced.map((o) => Object.freeze({
        product: o.product.trim(),
        // Shown only when the page showed it — an invented size is a different product.
        packageSize: typeof o.packageSize === 'string' && o.packageSize.trim() ? o.packageSize.trim() : null,
        price: o.price.trim(),
        sourceOrigin: o.sourceOrigin,
        pageUrl: typeof o.pageUrl === 'string' ? o.pageUrl : null,
        observedAt: o.observedAt
      }))
    }, base)
  }

  const products = observations.filter(isBrowserProduct)
  if (products.length) {
    // ⛔ A PRICE THE BROWSER DID NOT SEE CANNOT RESCUE THIS. If the only number available came
    // from model text, the status is still INCOMPLETE and the reason says exactly why.
    const unverifiedPrice = observations.some((o) => o && o.source !== SOURCE.BROWSER && typeof o.price === 'string' && o.price.trim() !== '')
    return Object.assign({
      status: STATUS.INCOMPLETE,
      reason: unverifiedPrice ? REASON.ONLY_UNVERIFIED_TEXT : REASON.NO_PRICE,
      evidence: [],
      productsSeen: products.map((p) => p.product.trim())
    }, base)
  }

  if (input.searchPerformed === true) {
    return Object.assign({ status: STATUS.NOT_FOUND, reason: REASON.NO_PRODUCT, evidence: [] }, base)
  }

  // Nothing was searched and nothing was blocked: the run did not happen.
  return Object.assign({ status: STATUS.INCOMPLETE, reason: REASON.NO_PRICE, evidence: [] }, base)
}

const isSuccess = (result) => !!result && SUCCESS_STATUSES.includes(result.status)

/**
 * The Owner-facing answer.
 *
 * ⛔ THE FIELD HE ASKED FOR COMES FIRST, IN THE FIRST LINE. Context is allowed after it and
 * never instead of it.
 *
 * ⛔ AND WHEN THERE IS NO PRICE, THE ANSWER SAYS SO IN THOSE WORDS. 「價格因品牌同容量而異」 is
 * true, fluent and useless; it is also indistinguishable from an answer, which is why it is
 * forbidden here rather than discouraged.
 */
function renderOwnerAnswer (result, siteLabel) {
  const label = siteLabel || '網站'
  if (!result || !isSuccess(result)) {
    const why = {
      [REASON.NO_PRICE]: '搵到相關商品，但頁面冇顯示可信價格。',
      [REASON.ONLY_UNVERIFIED_TEXT]: '有文字提過價錢，但唔係瀏覽器實際見到嘅，唔可以當數。',
      [REASON.NO_PRODUCT]: '喺限定範圍內搵唔到相關商品。',
      [REASON.NAVIGATION_BLOCKED]: '去唔到嗰個頁面（被網站或安全圍欄擋住）。'
    }[result && result.reason] || '未有可信嘅頁面證據。'
    // ⛔ THE EXACT PHRASE, so a caller can assert it and a reader cannot miss it.
    return '未能核實價格。' + why + '狀態：' + ((result && result.status) || STATUS.INCOMPLETE) + '。'
  }

  const first = result.evidence[0]
  const size = first.packageSize ? ' ' + first.packageSize : ''
  let out = label + ' 查到：' + first.product + size + ' — ' + first.price

  // ⛔ A PRICE THAT DEPENDS ON A STORE IS NOT A UNIVERSAL PRICE, and saying nothing implies it is.
  if (result.locationDependent) {
    out += result.storeContext
      ? '（' + result.storeContext + '）'
      : '（未揀分店，價格可能因店而異）'
  }

  if (result.evidence.length > 1) {
    const more = result.evidence.slice(1, 3)
      .map((e) => e.product + (e.packageSize ? ' ' + e.packageSize : '') + ' — ' + e.price)
    out += '\n另外見到：' + more.join('；')
  }
  return out
}

module.exports = {
  STATUS, SUCCESS_STATUSES, SOURCE, REASON, PRICE_SHAPE,
  classifyBrowseResult, isSuccess, isBrowserPrice, isBrowserProduct, renderOwnerAnswer
}
