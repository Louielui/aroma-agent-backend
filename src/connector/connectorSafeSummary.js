'use strict'

/**
 * connectorSafeSummary.js — Phase 2 Gate 1 (MCP connector). Build a DETERMINISTIC,
 * fixed-template safe summary from ONLY the allowlisted source fields of a
 * SAFE_NON_SENSITIVE item. NO LLM, no free-text from unbounded fields. Enforces a
 * source-field allowlist, a max length (suppress, never truncate), and a versioned
 * prohibited-content check (withhold entirely, never partial). Fixed error codes.
 * Pure and deterministic.
 */

const SUMMARY_TEMPLATE_VERSION = 'sum-1'
const MAX_SUMMARY_LEN = 256

// The exact fields the fixed template consumes — each MUST be in the caller's
// allowedFields (the classification's outward allowlist) or the build is refused.
const TEMPLATE_FIELDS = ['executionId', 'proposalId', 'status', 'finishedAt']

// Versioned defense-in-depth patterns checked against the RENDERED summary.
const PROHIBITED_PATTERNS = [
  /hub_token/i, /api[_-]?key/i, /secret/i, /password/i, /token/i, /-----BEGIN/i,
  /[A-Za-z]:\\/, // windows path
  /\/(?:home|Users|etc|var|root)\//, // unix-ish path
  /[0-9a-f]{32,}/i // long hex blob (possible secret/hash) — no word boundary, so an
  // embedded run like `task_<32hex>` is still caught (underscore is a \w char)
]

function fail (code) {
  return { ok: false, summary: null, code, templateVersion: SUMMARY_TEMPLATE_VERSION }
}

/**
 * Build the safe summary.
 * @param {object} item — the SAFE_NON_SENSITIVE item
 * @param {{ allowedFields: string[], maxLength?: number }} opts
 * @returns {{ ok: boolean, summary: string|null,
 *   code: 'OK'|'NOT_SAFE'|'MISSING_FIELD'|'OVERLENGTH'|'PROHIBITED_CONTENT',
 *   templateVersion: string }}
 */
function buildSafeSummary (item, opts = {}) {
  const allowedFields = Array.isArray(opts.allowedFields) ? opts.allowedFields : []
  const maxLength = Number.isInteger(opts.maxLength) && opts.maxLength > 0 ? opts.maxLength : MAX_SUMMARY_LEN

  // Every template field must be (a) authorised for egress and (b) present & string.
  for (const f of TEMPLATE_FIELDS) {
    if (!allowedFields.includes(f)) return fail('NOT_SAFE') // field not authorised to leave
  }
  for (const f of TEMPLATE_FIELDS) {
    if (item == null || typeof item[f] !== 'string' || item[f] === '') return fail('MISSING_FIELD')
  }

  const summary = `Execution ${item.executionId} for proposal ${item.proposalId}: ${item.status}, finished ${item.finishedAt}`

  if (summary.length > maxLength) return fail('OVERLENGTH') // suppress — never truncate
  for (const re of PROHIBITED_PATTERNS) if (re.test(summary)) return fail('PROHIBITED_CONTENT') // withhold entirely

  return { ok: true, summary, code: 'OK', templateVersion: SUMMARY_TEMPLATE_VERSION }
}

module.exports = { buildSafeSummary, SUMMARY_TEMPLATE_VERSION, MAX_SUMMARY_LEN, TEMPLATE_FIELDS, PROHIBITED_PATTERNS }
