'use strict'

/**
 * paymentStop.js — LAYER 1. The soft stop, and the one whose coverage is UNKNOWN until measured.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ READ THIS BEFORE TRUSTING IT.
 *
 * > **Owner: 「a payment button is indistinguishable from a search button in an accessibility
 * > tree. Both are `button`. Recognition depends on the site's naming, which the site
 * > controls.」**
 *
 * That is not a worry, it is a measurement: yesterday a run that expected to stop at
 * submission pressed `button "Search"` because nothing distinguished it.
 *
 * **This layer is a convenience for normal operation. It is NOT the fence.** The fence is L3
 * — deny non-GET by default — because a site chooses its button names and does not choose
 * whether a purchase is a POST.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── AND L2 IS NOT THE FENCE EITHER ──────────────────────────────────────────
 * 「空 profile 剷走嘅係自動填表，剷唔走你張卡喺 Costco 個資料庫入面。」 An empty browser
 * profile removes autofill; the merchant still holds the card. See DESIGN-LOGGED-IN-BROWSING.
 */

/**
 * Names that commit money. Ordered from least to most ambiguous so the reason can say which
 * rule fired — a stop the Owner cannot explain is a stop he will learn to override.
 */
const COMMIT_NAME = [
  // unambiguous: the word 「pay」 or a processor, as an action
  { re: /\b(pay|paye[rz]|payment)\b.*\b(card|credit|debit|now|order|paypal)\b|\bpay with\b|\bpay now\b/i, why: 'names paying' },
  { re: /\b(place (your )?order|complete (my )?(purchase|order|payment)|confirm (and )?(pay|order|purchase)|submit (payment|order))\b/i, why: 'names placing or confirming an order' },
  { re: /\b(apple pay|google ?pay|paypal|shop ?pay|amazon pay|interac)\b/i, why: 'is a payment processor' },
  { re: /(付款|立即購買|下單|結帳|結算|確認付款)/, why: 'names paying (zh)' },
  // donation and subscription commits, where the amount is already fixed in the name
  { re: /\b(donate|give)\b.*\$\s?\d|\$\s?\d.*\b(donate|give)\b/i, why: 'commits a stated amount' },
  { re: /\b(donate|donner)\b.*\b(card|credit|debit|monthly|now)\b/i, why: 'names donating by a method' },
  { re: /^\s*(donate|donate donate|faire un don)\s*$/i, why: 'is a bare donate control' }
]

/**
 * ⚠ EXCLUSIONS ARE NOT AN AFTERTHOUGHT — they are half the measurement.
 *
 * Measured on the frozen corpus: 「AGREE & PROCEED」 is a COOKIE BANNER, 「Next」 ×8 are carousel
 * arrows, 「Buy」 on a pricing page opens a store page, 「Add to cart」 is a cart. A recogniser
 * that flags those stops her on ordinary browsing, and **a soft stop that fires constantly is
 * a soft stop the Owner learns to ignore** — which converts L1 from a safeguard into noise.
 */
const NOT_COMMIT = [
  /\b(add to (cart|basket|bag)|view (your )?cart|your cart|cart)\b/i,
  /\b(agree|accept|allow|consent|cookie|privacy|proceed)\b/i,   // consent banners
  /^\s*(next|previous|prev|back|continue|more|learn more|details)\s*$/i,
  /\b(terms|policy|agreement|licen[cs]e|faq|help|about|contact|shop|donate cryptocurrency)\b/i,
  /\b(other ways|compare|pricing|plans)\b/i,
  /^\s*buy\s*$/i                                                 // bare 「Buy」 is navigational
]

const PAGE_SIGNAL = [
  { re: /\/(checkout|payment|placeorder|order\/confirm|cart\/checkout|billing)\b/i, why: 'the URL is a checkout path' }
]

/**
 * @param {{role:string,name:string}} target the element about to be clicked
 * @param {{url?:string, text?:string}} [context] the page around it
 * @returns {{stop:boolean, why?:string, signal?:string}}
 */
function checkPaymentStop (target, context = {}) {
  const name = String((target && target.name) || '').replace(/\s+/g, ' ').trim()
  if (!name) return { stop: false }

  for (const ex of NOT_COMMIT) {
    if (ex.test(name)) return { stop: false, why: 'excluded: ' + ex.source.slice(0, 30) }
  }
  for (const rule of COMMIT_NAME) {
    if (rule.re.test(name)) return { stop: true, why: rule.why, signal: 'name' }
  }
  // A commit-shaped word on a page whose URL is a checkout path. Weaker, and it only fires
  // when the name alone did not — never as the sole reason on an ordinary page.
  const url = String(context.url || '')
  for (const p of PAGE_SIGNAL) {
    if (p.re.test(url) && /\b(continue|next|proceed|submit|confirm|complete|finish)\b/i.test(name)) {
      return { stop: true, why: p.why + ', and the control advances it', signal: 'url+name' }
    }
  }
  return { stop: false }
}

module.exports = { checkPaymentStop, COMMIT_NAME, NOT_COMMIT }
