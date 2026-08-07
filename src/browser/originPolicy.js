'use strict'

/**
 * originPolicy.js — the government block. **An override on top of the allowlist, not a
 * replacement for it.**
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THIS IS THE ONE PLACE A DENYLIST EARNS ITS KEEP.
 *
 * This project's rule is *allowlist, never denylist* — an allowlist requires someone to have
 * intended the good case. That rule is unchanged, and `navigate` still refuses any origin the
 * sealed order did not name.
 *
 * This defends a DIFFERENT threat:
 *
 *   the allowlist  protects against an origin NOBODY NAMED
 *   this list      protects against an origin SOMEONE NAMED BY MISTAKE
 *                  — a future order author, including a future me
 *
 * It runs AFTER the allowlist and refuses regardless. **An order cannot turn it off**, because
 * the thing it guards against is an order.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── SCOPED TO SUBMISSION SURFACES, NOT TO GOVERNMENT ────────────────────────
 * A pattern like `*.gc.ca` would take the CFIA recall register with it — and that is
 * ERRAND-003, **the only errand that has ever produced an answer.** So this is an explicit
 * list of places where something can be FILED, reviewed by the Owner, and every entry says
 * what can be submitted there.
 *
 * ── AND WHY IT IS COMPLETE WHERE THE PAYMENT LAYERS ARE NOT ─────────────────
 * There is no 「no payment method」 equivalent for a CRA form. But an origin that appears in no
 * sealed order is unreachable, and one that is additionally blocked here is unreachable even
 * if an order names it. **Measured: `ORIGIN_NOT_IN_ORDER` refuses in 0 ms.**
 */

/** Each entry: a host suffix, and what can be FILED there. Public information sites are
 *  deliberately absent — reading is not filing. */
const BLOCKED = Object.freeze([
  { host: 'cra-arc.gc.ca', files: 'tax returns, remittances, payroll filings' },
  { host: 'apps.cra-arc.gc.ca', files: 'My Business Account submissions' },
  { host: 'canada.ca/en/revenue-agency', files: 'CRA account services' },
  { host: 'gst-tps.gc.ca', files: 'GST/HST returns' },
  { host: 'businessregistration-inscriptionentreprise.gc.ca', files: 'business number registration' },
  { host: 'ceridian.ca', files: 'payroll submissions' },
  { host: 'companiesoffice.gov.mb.ca', files: 'Manitoba corporate filings' },
  { host: 'taxcentre.gov.mb.ca', files: 'Manitoba tax filings' },
  { host: 'mbll.ca', files: 'Manitoba liquor licensing submissions' },
  { host: 'wcb.mb.ca', files: 'Workers Compensation filings' },
  { host: 'servicecanada.gc.ca', files: 'Service Canada submissions' },
  { host: 'ircc.canada.ca', files: 'immigration filings' }
])

const POLICY = Object.freeze({ ALLOWED: 'ALLOWED', BLOCKED: 'BLOCKED_SUBMISSION_SURFACE' })

/**
 * @param {string} url
 * @returns {{verdict:string, host?:string, files?:string, reason?:string}}
 */
function checkOriginPolicy (url) {
  let u
  try { u = new URL(String(url)) } catch (_) {
    // Unparsable is not this check's business — `navigate` already refuses it. Do not
    // invent a second opinion about a URL nobody can read.
    return { verdict: POLICY.ALLOWED }
  }
  const host = u.hostname.toLowerCase()
  const full = host + u.pathname.toLowerCase()
  for (const b of BLOCKED) {
    const needle = b.host.toLowerCase()
    // Host-suffix match on a DOT boundary, or a host+path prefix for the canada.ca case.
    const hostMatch = host === needle || host.endsWith('.' + needle)
    const pathMatch = needle.includes('/') && full.startsWith(needle)
    if (hostMatch || pathMatch) {
      return {
        verdict: POLICY.BLOCKED,
        host: b.host,
        files: b.files,
        reason: 'a government submission surface (' + b.files + '). ' +
          'Filing is irreversible — it can only be amended, never cancelled — so this is ' +
          'blocked regardless of what any order says, and you file it yourself.'
      }
    }
  }
  return { verdict: POLICY.ALLOWED }
}

module.exports = { checkOriginPolicy, POLICY, BLOCKED }
