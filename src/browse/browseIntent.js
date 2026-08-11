'use strict'

/**
 * browseIntent.js — DETERMINISTIC detection that the Owner asked for a public web lookup.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ NO MODEL DECIDES THIS, AND NO MODEL NAMES THE TARGET.
 *
 * This is a pure function over the Owner's own sentence: same words in, same answer out, every
 * time, with no provider, no prompt and no network. A model asked 「is this a browse request?」
 * gives a different answer on a bad day, and the bad day is the one where it drives a real
 * browser somewhere nobody chose.
 *
 * What it produces is a REQUEST, not an action: a site KEY from the reviewed registry and the
 * Owner's own search words. Turning that into a sealed order is the server's job, and driving
 * it is a later, separately governed step.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── WHY ALL THREE SIGNALS ARE REQUIRED ──────────────────────────────────────
 * 「幫我去superstore網站查下peanut butter多少錢？」 carries a browse verb, a registered site and a
 * subject. Drop any one of them and it is a different sentence:
 *
 *   「superstore 嘅嘢好貴」          — a registered site, and an opinion. Not an errand.
 *   「幫我查下我哋牛肉價」            — a verb and a subject, and NO site: that is an internal
 *                                     question, and A4 already owns it.
 *   「去 superstore 買嘢」            — a shop, not a lookup, and buying is out of scope entirely.
 *
 * Requiring the conjunction is what keeps ordinary conversation out of the browser.
 */

const { resolveSite, knownTokens } = require('./siteRegistry')

/** 「go and look this up」 — in the Owner's actual mixed Cantonese/English. */
const BROWSE_VERB = /(查|睇下|睇睇|search|look\s*up|check|find\s+out|睇吓)/i

/** 「on the web / on their site」 — a strong signal, but not required on its own. */
const WEB_MARKER = /(網站|網頁|官網|網上|online|website|web\s*site|\bsite\b)/i

/**
 * ⛔ BUYING IS NOT LOOKING. A sentence that asks to add to cart, order or pay is refused here
 * rather than downgraded to a read — E0-B1 has no write path and must not appear to have one.
 */
const PURCHASE_VERB = /(買|訂|落單|加入購物車|下單|購買|order\s+(me|us|it)|buy|purchase|\bcart\b|\bbasket\b|checkout|check\s*out|pay\s+for)/i

/** The field the Owner actually asked for. Today only price is answerable end to end. */
const FIELD_PATTERNS = Object.freeze([
  { field: 'price', re: /(幾多錢|幾錢|多少錢|價錢|價格|幾錢呀|price|how\s+much|cost)/i }
])

const OUTCOME = Object.freeze({
  BROWSE: 'browse_request',
  NOT_BROWSE: 'not_a_browse_request',
  NO_SITE: 'no_registered_site',
  PURCHASE_REFUSED: 'purchase_is_not_a_read',
  NO_SUBJECT: 'no_subject_to_look_up'
})

/** Strip the framing so what remains is the thing being asked about. */
const FRAMING = new RegExp(
  '(香香|唔該|幫我|麻煩你|please|can\\s+you|could\\s+you|去|喺|於|嘅|網站|網頁|官網|網上|online|website|' +
  'web\\s*site|\\bsite\\b|查下|查吓|查|睇下|睇吓|睇睇|search\\s+for|search|look\\s*up|check|find\\s+out|' +
  '幾多錢|幾錢|多少錢|價錢|價格|how\\s+much|price|cost|嗎|呀|啊|呢|吖|\\?|？|，|,|。|\\.|!|！)', 'gi')

/** Which registered token the sentence names, if any. Longest match wins. */
function siteTokenIn (text) {
  const lower = text.toLowerCase()
  for (const token of knownTokens()) {
    if (lower.includes(token.toLowerCase())) return token
  }
  return null
}

function subjectFrom (text, token) {
  let s = text
  if (token) s = s.replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ')
  s = s.replace(FRAMING, ' ').replace(/\s+/g, ' ').trim()
  return s
}

/**
 * Detect a browse request in the Owner's own words.
 *
 * @param {string} message
 * @returns {{isBrowse:boolean, outcome:string, siteKey?:string, siteToken?:string, query?:string, field?:string|null}}
 */
function detectBrowseRequest (message) {
  const text = typeof message === 'string' ? message.trim() : ''
  if (!text) return { isBrowse: false, outcome: OUTCOME.NOT_BROWSE }

  const token = siteTokenIn(text)

  // ⛔ PURCHASE IS REFUSED, NOT REINTERPRETED. Quietly turning 「買」 into 「睇下幾錢」 would answer
  // a question the Owner did not ask and teach him that buying words are safe here.
  if (PURCHASE_VERB.test(text)) {
    return { isBrowse: false, outcome: OUTCOME.PURCHASE_REFUSED, siteToken: token || undefined }
  }

  const hasVerb = BROWSE_VERB.test(text)
  const hasWeb = WEB_MARKER.test(text)
  if (!hasVerb && !hasWeb) return { isBrowse: false, outcome: OUTCOME.NOT_BROWSE }

  // ⛔ A REGISTERED SITE IS REQUIRED. Without one there is no destination anybody reviewed, and
  // inventing one is exactly the capability this module refuses to have.
  if (!token) return { isBrowse: false, outcome: OUTCOME.NO_SITE }
  const resolved = resolveSite(token)
  if (!resolved.ok) return { isBrowse: false, outcome: OUTCOME.NO_SITE }

  // A browse VERB is required even when a web marker is present: 「superstore 個網站好慢」 names a
  // site and the web and asks for nothing.
  if (!hasVerb) return { isBrowse: false, outcome: OUTCOME.NOT_BROWSE }

  const query = subjectFrom(text, token)
  if (!query) return { isBrowse: false, outcome: OUTCOME.NO_SUBJECT, siteKey: resolved.site.key }

  const matched = FIELD_PATTERNS.find((f) => f.re.test(text))
  return {
    isBrowse: true,
    outcome: OUTCOME.BROWSE,
    siteKey: resolved.site.key,
    siteToken: token,
    query,
    // ⛔ THE FIELD THE OWNER ASKED FOR, carried through to the result contract so that
    // 「did we answer the question?」 is checkable rather than a matter of opinion.
    field: matched ? matched.field : null
  }
}

module.exports = { detectBrowseRequest, OUTCOME, BROWSE_VERB, PURCHASE_VERB, FIELD_PATTERNS }
