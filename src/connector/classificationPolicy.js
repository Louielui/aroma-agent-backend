'use strict'

/**
 * classificationPolicy.js — Phase 2 Gate 1 (MCP connector). AUTHORITATIVE,
 * deterministic, versioned classification of one return-ready item as
 * SAFE_NON_SENSITIVE / SENSITIVE / UNCLASSIFIED.
 *
 * Backend-authoritative: it classifies ONLY from backend-known fields and IGNORES
 * any external ("this item is safe") claim a worker / MCP / ChatGPT might attach.
 * Pure: no I/O, no state, deterministic. Fail-closed: anything not provably safe
 * is UNCLASSIFIED or SENSITIVE (both suppressed downstream).
 */

const CLASSIFICATION_POLICY_VERSION = 'clf-1'

// Outward source-field allowlist — the ONLY fields that may ever be projected for
// a SAFE_NON_SENSITIVE item. Owner decision C-04: sourceTaskId is deliberately
// EXCLUDED here (kept internal for audit/correlation only); resultSummary / error /
// cost / relay / exitCode are excluded as potential sensitive carriers. Outward
// unique identification is the connectorResultId, never sourceTaskId.
const SAFE_FIELD_ALLOWLIST = ['proposalId', 'executionId', 'status', 'finishedAt']

const TERMINAL_STATUSES = new Set(['succeeded', 'failed'])

// Versioned sensitive ruleset (bump CLASSIFICATION_POLICY_VERSION on change). If
// ANY string value anywhere in the item matches, the whole item is SENSITIVE.
const SENSITIVE_PATTERNS = [
  // finance
  /\bfinance\b/i, /\bsalar(?:y|ies)\b/i, /\bpayroll\b/i, /\binvoice\b/i, /\bbank\b/i,
  // HR
  /\btermination\b/i, /\bpayslip\b/i, /\bssn\b/i,
  // PII
  /\bpassport\b/i, /\bcredit\s?card\b/i, /\b\d{3}-\d{2}-\d{4}\b/,
  // governance / secrets
  /\bgovernance\b/i, /\baisl\b/i, /\bpermission model\b/i, /\bsecret\b/i,
  /\bhub_token\b/i, /\bapi[_-]?key\b/i, /\bpassword\b/i, /\btoken\b/i, /-----BEGIN/
]

/** Recursively scan every string value; return the first matched pattern source, or null. */
function scanSensitive (value, depth) {
  if (depth > 5 || value == null) return null
  if (typeof value === 'string') {
    for (const re of SENSITIVE_PATTERNS) if (re.test(value)) return re.source
    return null
  }
  if (typeof value === 'object') {
    for (const k of Object.keys(value)) {
      const hit = scanSensitive(value[k], depth + 1)
      if (hit) return hit
    }
  }
  return null
}

/**
 * Classify one return-ready item.
 * @param {object} item — a buildReturnReadyList projection (+ internal sourceTaskId)
 * @returns {{ classification: 'SAFE_NON_SENSITIVE'|'SENSITIVE'|'UNCLASSIFIED',
 *   policyVersion: string, allowedFields: string[], reasons: string[] }}
 */
function classify (item) {
  if (!item || typeof item !== 'object') {
    return { classification: 'UNCLASSIFIED', policyVersion: CLASSIFICATION_POLICY_VERSION, allowedFields: [], reasons: ['item missing or not an object'] }
  }

  // Required, well-formed, terminal — else UNCLASSIFIED (fail-closed).
  const missing = []
  if (typeof item.proposalId !== 'string' || item.proposalId === '') missing.push('proposalId')
  if (typeof item.executionId !== 'string' || item.executionId === '') missing.push('executionId')
  if (typeof item.finishedAt !== 'string' || item.finishedAt === '') missing.push('finishedAt')
  if (!TERMINAL_STATUSES.has(item.status)) missing.push('status(terminal)')
  if (missing.length) {
    return { classification: 'UNCLASSIFIED', policyVersion: CLASSIFICATION_POLICY_VERSION, allowedFields: [], reasons: ['missing/invalid: ' + missing.join(', ')] }
  }

  // Authoritative sensitive scan over ALL fields (ignores any external safe-claim).
  const hit = scanSensitive(item, 0)
  if (hit) {
    return { classification: 'SENSITIVE', policyVersion: CLASSIFICATION_POLICY_VERSION, allowedFields: [], reasons: ['sensitive pattern matched'] }
  }

  return {
    classification: 'SAFE_NON_SENSITIVE',
    policyVersion: CLASSIFICATION_POLICY_VERSION,
    allowedFields: [...SAFE_FIELD_ALLOWLIST],
    reasons: ['terminal status, no sensitive markers']
  }
}

module.exports = { classify, CLASSIFICATION_POLICY_VERSION, SAFE_FIELD_ALLOWLIST }
