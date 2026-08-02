'use strict'

/**
 * coverageError.js — why a source could not be read, said in a fixed vocabulary.
 *
 * ── WHY A PROJECTION AND NOT THE MESSAGE ──────────────────────────────────
 * `perSource.error` is whatever the adapter or the Google/GitHub client produced. Those
 * messages are written for developers: they cheerfully carry the endpoint URL, the query,
 * a Windows path, an account address, or an opaque token-shaped id. The brief was putting
 * that string straight into Data Coverage, which is rendered in the browser.
 *
 * A reader needs to know WHICH KIND of failure it was — is it a credential to fix, a
 * permission to grant, or a network blip to ignore? That is six answers, not a free-text
 * field, so it is an enum. A short scrubbed detail rides along for the cases where the
 * enum is not enough, but the enum is what the UI keys on and the detail is stripped of
 * URLs, paths, addresses and opaque ids before it exists at all.
 *
 * The audit stores neither — `sourceStatuses` rows carry source/state/count only.
 */

const { scrubReason } = require('../utils/readContextLog')

/** The complete set. A reason that matches nothing is `read_failed`, never a raw string. */
const CODES = Object.freeze([
  'configured_off', // the flag is off, or there is deliberately no connector
  'credential_unavailable', // no token / no refresh token / auth not set up
  'permission_denied', // reached the service, was refused
  'timeout', // took too long
  'read_failed', // reached the service, it failed for another reason
  'source_unavailable' // no adapter registered / nothing to read from
])

const MAX_DETAIL_CHARS = 80

/**
 * Ordered patterns — FIRST match wins, so the specific ones precede the generic. Matching
 * is done on the lower-cased raw message, and its result is a code, never a substring of
 * the message.
 */
const RULES = Object.freeze([
  [/read access disabled|flag off|not configured|no source configured/, 'configured_off'],
  // `token` deliberately without \b: the real message is `GITHUB_READ_TOKEN not set`, and
  // an underscore is a word character, so a boundary would never match there.
  [/credential|no google credentials|token|unauthorized|401|invalid_grant|expired/, 'credential_unavailable'],
  [/permission|forbidden|403|insufficient|access denied|not found|404/, 'permission_denied'],
  [/timeout|timed out|etimedout|deadline/, 'timeout'],
  [/no adapter registered|unavailable|service unavailable|enotfound|econnrefused/, 'source_unavailable']
])

/**
 * Project a raw reason into { code, detail }.
 * `detail` is scrubbed and bounded, and is null when there is nothing safe left to say.
 */
function projectCoverageError (raw) {
  if (raw === null || raw === undefined || raw === '') return { code: null, detail: null }
  const text = String(raw)
  const low = text.toLowerCase()

  let code = 'read_failed'
  for (const [re, c] of RULES) { if (re.test(low)) { code = c; break } }

  // scrubReason removes URLs, Windows and POSIX paths, e-mail addresses and any opaque
  // 24+ character run (ids, keys, handles), then collapses whitespace.
  let detail = scrubReason(text)
  if (detail) {
    // A query can survive outside a URL — `q="supplier" newer_than:90d`. The enum is what
    // the UI needs; anything that looks like a query fragment goes.
    detail = detail.replace(/\bq=\S*/gi, '<query>').replace(/"[^"]*"/g, '<query>')
    if (detail.length > MAX_DETAIL_CHARS) detail = detail.slice(0, MAX_DETAIL_CHARS) + '…'
    detail = detail.trim() || null
  }

  return { code, detail: detail || null }
}

module.exports = { projectCoverageError, CODES, MAX_DETAIL_CHARS }
