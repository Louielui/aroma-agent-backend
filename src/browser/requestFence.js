'use strict'

/**
 * requestFence.js — L3. **The guardrail.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THIS AND NOT L1.
 *
 * L1 — the payment-button recogniser — was measured on 2026-08-06: **100% on the corpus it
 * was written against, 45% on pages it had never seen**, and that 45% is optimistic because
 * the hardest button is the one we cannot reach without doing the thing we are preventing.
 *
 * > **A site chooses what it calls its buttons. It does not choose whether a purchase is a
 * > write.**
 *
 * L1 is a convenience. L2 — an empty browser profile — removes autofill and **does not remove
 * the Owner's card from the merchant's database**. This file is the fence.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── DENY NON-GET BY DEFAULT ─────────────────────────────────────────────────
 * Reading is `GET`. Almost everything irreversible is not. Every `POST`, `PUT`, `PATCH`,
 * `DELETE` — and every method nobody thought of — is **aborted unless the sealed order named
 * it**, by origin, path prefix AND method together.
 *
 * A fence made of absence, like `buildAllowedTools()` and `headless`: there is no flag, and
 * `'*'` is deliberately not honoured.
 *
 * ── ⚠ WHAT IT CANNOT DO, STATED IN THE FILE THAT DOES IT ────────────────────
 * **A `GET` that commits is not caught.** Some sites still perform destructive actions on a
 * link — an unsubscribe, a delete-by-URL, an old-style confirm link. This fence would pass
 * every one of them.
 *
 * It also **does not read bodies**. It is a method-and-destination fence, not a content
 * filter, and pretending otherwise would be the third leaky layer claiming to be a fourth.
 */

const FENCE = Object.freeze({
  ALLOWED_METHODS: Object.freeze(['GET', 'HEAD', 'OPTIONS']),
  REFUSED: 'WRITE_NOT_IN_ORDER'
})

/** Query strings can carry tokens and card numbers. The record keeps the destination, never
 *  the parameters — the same rule as `type` never recording what was typed. */
function safeUrl (u) {
  try { const p = new URL(u); return p.origin + p.pathname } catch (_) { return '(unparsable url)' }
}

/**
 * @param {{order: {allowedOrigins?: string[], allowedWrites?: Array<{origin,pathPrefix,method}>}}} ctx
 */
function buildRequestFence ({ order } = {}) {
  const refused = []
  let allowedWrites = 0

  const permits = (method, url) => {
    const rules = order && Array.isArray(order.allowedWrites) ? order.allowedWrites : null
    if (!rules || !rules.length) return false          // an absent fence is not an open one
    let u
    try { u = new URL(url) } catch (_) { return false }
    for (const r of rules) {
      // No wildcard, anywhere. An allowlist with an escape hatch is a denylist in costume.
      if (!r || r.origin === '*' || r.pathPrefix === '*' || r.method === '*') continue
      let ruleOrigin
      try { ruleOrigin = new URL(String(r.origin)).origin } catch (_) { continue }
      if (ruleOrigin !== u.origin) continue            // ORIGIN EQUALITY, never prefix
      if (!u.pathname.startsWith(String(r.pathPrefix))) continue
      if (String(r.method).toUpperCase() !== method) continue
      return true
    }
    return false
  }

  return {
    /** Install on a page: `await page.route('**\/*', fence.handle)` */
    handle: async (route) => {
      const req = route.request()
      const method = String(req.method() || '').toUpperCase()
      const url = req.url()

      if (FENCE.ALLOWED_METHODS.includes(method)) return route.continue()
      if (permits(method, url)) { allowedWrites++; return route.continue() }

      // A fence that stops silently cannot be reported, and the report is the only remaining
      // review. Cap the record so a page in a retry loop cannot flood it.
      if (refused.length < 200) {
        refused.push({ method, url: safeUrl(url), type: req.resourceType ? req.resourceType() : 'unknown' })
      }
      return route.abort('blockedbyclient')
    },

    report: () => ({
      refused: refused.slice(),
      refusedCount: refused.length,
      allowedWrites
    }),

    /** Said out loud, by the fence, about the fence. */
    limits: () => 'This fence refuses writes by METHOD and DESTINATION. It cannot stop a GET ' +
      'that commits — an unsubscribe link, a delete-by-URL, an old-style confirm link — and it ' +
      'does not read request bodies. It is one of three layers and it is not complete.'
  }
}

module.exports = { buildRequestFence, FENCE }
