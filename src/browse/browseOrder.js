'use strict'

/**
 * browseOrder.js — the sealed order for a public read, built on the SERVER from a site KEY.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE CALLER NEVER SUPPLIES AN ORIGIN, AND CANNOT WIDEN ONE.
 *
 * This function's input is a registry KEY and the Owner's search words. There is no parameter
 * through which an origin, a host, a scheme, an extra allowed write or a bigger budget can
 * arrive — not from the model, not from the browser, not from the request body. Reach is a
 * property of the reviewed table, and the only way to widen it is to edit that table.
 *
 * ⛔ AND `allowedWrites` IS ALWAYS EMPTY. Not 「empty by default」 — there is no argument that
 * fills it. The request fence reads this field to decide whether a non-GET may proceed, so an
 * empty list is what makes 「read-only」 structural instead of intended.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { SITES, isRegisteredOrigin, searchUrlFor } = require('./siteRegistry')
const { checkOriginPolicy, POLICY } = require('../governance/originPolicy')

/**
 * ⛔ SMALL ON PURPOSE. A public price lookup is: open search, read, maybe refine once, read.
 * A budget large enough to wander is a budget large enough to wander somewhere expensive.
 */
const BROWSE_BUDGET = Object.freeze({ maxActions: 12, maxSeconds: 120 })

const REFUSED = Object.freeze({
  UNKNOWN_SITE: 'SITE_NOT_IN_REGISTRY',
  BLOCKED_ORIGIN: 'ORIGIN_BLOCKED_BY_POLICY',
  NO_QUERY: 'NO_SEARCH_SUBJECT',
  CALLER_SUPPLIED_REACH: 'CALLER_TRIED_TO_SUPPLY_REACH'
})

/** Keys a caller might hope to smuggle reach through. Their presence is the defect, not their value. */
const FORBIDDEN_INPUT_KEYS = Object.freeze([
  'origin', 'origins', 'allowedOrigins', 'url', 'host', 'hostname', 'allowedWrites',
  'maxActions', 'maxSeconds', 'profileDir', 'permissions'
])

/**
 * Build the sealed order for one public read.
 *
 * @param {{siteKey:string, query:string, requestId?:string}} input
 * @returns {{ok:true, order:object} | {ok:false, reason:string, detail?:string}}
 */
function buildBrowseOrder (input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: REFUSED.UNKNOWN_SITE, detail: 'no input' }
  }

  // ⛔ A CALLER THAT TRIED IS A CALLER THAT IS REFUSED. Ignoring the extra key silently would
  // leave the attempt invisible, and the next version of that caller would try harder.
  const smuggled = FORBIDDEN_INPUT_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(input, k))
  if (smuggled.length) {
    return {
      ok: false,
      reason: REFUSED.CALLER_SUPPLIED_REACH,
      detail: 'reach comes from the registry, never from the caller: ' + smuggled.sort().join(', ')
    }
  }

  const site = SITES[input.siteKey]
  if (!site) return { ok: false, reason: REFUSED.UNKNOWN_SITE, detail: String(input.siteKey) }

  const query = typeof input.query === 'string' ? input.query.trim() : ''
  if (!query) return { ok: false, reason: REFUSED.NO_QUERY }

  // ⛔ THE GOVERNMENT BLOCK APPLIES TO THE REGISTRY TOO. A reviewed table is still written by a
  // person, and this is the check a mistaken entry meets before a browser exists.
  const policy = checkOriginPolicy(site.origin)
  if (policy.verdict !== POLICY.ALLOWED) {
    return { ok: false, reason: REFUSED.BLOCKED_ORIGIN, detail: site.origin + ' — ' + policy.reason }
  }
  if (!isRegisteredOrigin(site.origin)) {
    return { ok: false, reason: REFUSED.UNKNOWN_SITE, detail: 'origin is not published by the registry' }
  }

  return {
    ok: true,
    order: Object.freeze({
      kind: 'public_read',
      siteKey: site.key,
      siteLabel: site.label,
      // ⛔ EXACTLY ONE ORIGIN, FROM THE REGISTRY. `navigate` and the fence both read this.
      allowedOrigins: Object.freeze([site.origin]),
      // ⛔ EMPTY, ALWAYS. The fence turns this into: every POST/PUT/PATCH/DELETE is aborted.
      allowedWrites: Object.freeze([]),
      entryUrl: searchUrlFor(site, query),
      query,
      locationDependent: site.locationDependent === true,
      maxActions: BROWSE_BUDGET.maxActions,
      maxSeconds: BROWSE_BUDGET.maxSeconds,
      requestId: typeof input.requestId === 'string' ? input.requestId : null
    })
  }
}

module.exports = { buildBrowseOrder, BROWSE_BUDGET, REFUSED, FORBIDDEN_INPUT_KEYS }
