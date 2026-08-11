'use strict'

/**
 * siteRegistry.js — the ONLY place a browse target origin can come from.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE MODEL NEVER NAMES A DESTINATION.
 *
 * The Owner types 「superstore」. That word is a TOKEN, not an address. Resolving it is a
 * server-side lookup against this reviewed table, and there is no other path: nothing in
 * E0-B1 accepts a URL, an origin, a hostname or a scheme from the model, from the browser,
 * or from the request body.
 *
 * A model that can name an origin has been handed egress. It would only take one confidently
 * hallucinated 「superstore.com」 — a domain somebody else owns — for 香香 to drive a real
 * browser into it on the Owner's machine. So the capability does not exist to be misused:
 * `resolveSite()` takes a token and REFUSES anything that looks like an address.
 *
 * ⛔ ADDING A SITE IS A CODE CHANGE, REVIEWED AS ONE. There is no config file, no env var and
 * no runtime registration — those are all ways for an origin to arrive without a reviewer.
 * ══════════════════════════════════════════════════════════════════════════════
 */

/**
 * ⛔ ONE ENTRY. E0-B1 is a public READ canary, not a shopping capability.
 *
 * `locationDependent` is not decoration: this retailer prices per store, so an answer that
 * does not say which store — or that no store was chosen — is describing a number as more
 * universal than it is. The result contract reads this flag.
 */
const SITES = Object.freeze({
  superstore: Object.freeze({
    key: 'superstore',
    label: 'Real Canadian Superstore',
    origin: 'https://www.realcanadiansuperstore.ca',
    /** Where a public product search lives on this site. Server-authored, never model-authored. */
    searchPath: '/search',
    searchParam: 'search-bar',
    /** ⛔ Prices differ by store here, so a price with no store is not a universal price. */
    locationDependent: true
  })
})

/**
 * Owner-facing words that mean one registry key.
 *
 * ⛔ ALIASES ARE FOR THE OWNER'S VOCABULARY, NOT FOR REACH. Every alias resolves to a key that
 * already exists above; an alias can never introduce an origin of its own.
 */
const ALIASES = Object.freeze({
  superstore: 'superstore',
  'super store': 'superstore',
  'real canadian superstore': 'superstore',
  realcanadiansuperstore: 'superstore',
  rcss: 'superstore',
  /**
   * ⛔ 超市 IS NOT HERE, AND ITS ABSENCE IS THE POINT.
   *
   * It used to map to `superstore`. 超市 is the generic word for ANY supermarket — Costco,
   * Save-On, the shop on the corner — and binding it to one specific vendor meant
   * 「幫我去超市查下花生醬幾錢」 silently chose Real Canadian Superstore on the Owner's behalf
   * and reported its prices as though he had named it.
   *
   * That is exactly the capability this file's own header says it refuses to have: 「inventing
   * one is exactly the capability this module refuses to have」. The header claimed a guarantee
   * the table did not provide — the pattern the reviewers have caught repeatedly.
   *
   * With it gone, 「去超市查嘢」 resolves to NO_SITE and no browse is offered. That is correct:
   * we do not know which shop he means, and asking is cheap while guessing is not.
   */
})

/** Anything that even looks like an address is refused outright, not parsed. */
const LOOKS_LIKE_AN_ADDRESS = /:\/\/|^\s*\/\/|\.[a-z]{2,}(\/|$|\?)|^[a-z]+:/i

const REFUSED = Object.freeze({
  NOT_A_TOKEN: 'NOT_A_SITE_TOKEN',
  UNKNOWN_SITE: 'SITE_NOT_IN_REGISTRY'
})

/**
 * Resolve an Owner-typed token to a reviewed site.
 *
 * @param {string} token  a word the Owner used — NEVER a URL
 * @returns {{ok:true, site:object} | {ok:false, reason:string, token:string|null}}
 */
function resolveSite (token) {
  if (typeof token !== 'string' || token.trim() === '') {
    return { ok: false, reason: REFUSED.NOT_A_TOKEN, token: null }
  }
  const raw = token.trim()

  // ⛔ REFUSED BEFORE IT IS INTERPRETED. If a caller hands this function an address, the
  // interesting fact is that a caller tried — not which site it happened to point at.
  if (LOOKS_LIKE_AN_ADDRESS.test(raw)) {
    return { ok: false, reason: REFUSED.NOT_A_TOKEN, token: null }
  }

  const key = ALIASES[raw.toLowerCase().replace(/\s+/g, ' ')]
  if (!key || !SITES[key]) return { ok: false, reason: REFUSED.UNKNOWN_SITE, token: raw }
  return { ok: true, site: SITES[key] }
}

/** Is this exact origin one the registry published? Used as a second fence on order building. */
function isRegisteredOrigin (origin) {
  if (typeof origin !== 'string') return false
  return Object.values(SITES).some((s) => s.origin === origin)
}

/** The Owner-typed tokens the entrance may recognise. Longest first, so 「real canadian
 *  superstore」 wins over 「superstore」 and the label the Owner sees is the specific one. */
function knownTokens () {
  return Object.keys(ALIASES).sort((a, b) => b.length - a.length)
}

/**
 * Build the public search URL for a site.
 * ⛔ THE PATH IS THE REGISTRY'S; ONLY THE QUERY TEXT COMES FROM THE OWNER, and it travels as an
 * encoded query parameter, so it cannot become a path, a host or a second URL.
 */
function searchUrlFor (site, query) {
  if (!site || !isRegisteredOrigin(site.origin)) throw new Error('searchUrlFor: unregistered site')
  const u = new URL(site.searchPath, site.origin)
  u.searchParams.set(site.searchParam, String(query == null ? '' : query))
  return u.toString()
}

module.exports = { SITES, ALIASES, REFUSED, resolveSite, isRegisteredOrigin, knownTokens, searchUrlFor }
