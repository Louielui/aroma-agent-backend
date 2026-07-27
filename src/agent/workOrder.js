'use strict'

/**
 * workOrder.js — the structured Work Order that 守燈 produces and Louie approves,
 * plus its STRUCTURAL validation. Agent Bridge v0 (built behind AGENT_BRIDGE, OFF).
 *
 * The Work Order is the ONLY thing that authorizes an agent run, and validation is
 * fail-closed: anything it does not explicitly permit is rejected. In particular
 * the allowedFiles allowlist can NEVER include the files that hold 守燈's own
 * permission / approval / audit / flag / credential code — those are structurally
 * un-allowlistable here (Cap 5), so an approved Work Order can never point the
 * agent at the machinery that would let it expand its own authority.
 *
 * Pure module: no I/O, no process, no model. Deterministic hash for the audit log.
 */

const crypto = require('node:crypto')

// The forbidden-action constants a Work Order must declare. Execution actions must
// ALWAYS be forbidden (defense in depth alongside the no-remote workspace).
const FORBIDDEN_ACTIONS = Object.freeze([
  'commit', 'push', 'PR', 'merge', 'deploy', 'cred-edit', 'env-edit', 'gate-edit', 'audit-edit'
])
const MUST_FORBID = Object.freeze(['commit', 'push', 'PR', 'merge', 'deploy'])

// Files/dirs the agent may NEVER be allowed to edit — 守燈's own permission,
// approval, audit, flag, credential and truth machinery. Matched (Cap 5) against a
// normalized relative path (posix separators, lowercased). If a Work Order's
// allowedFiles names any of these, validation FAILS — they are un-allowlistable.
const FORBIDDEN_FILE_PATTERNS = Object.freeze([
  /(^|\/)\.env(\.[^/]*)?$/, // .env, .env.*
  /(^|\/)\.git(\/|$)/, // git internals
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)secrets?(\/|$)/,
  /(^|\/)credentials?(\/|$)/,
  /(^|\/)\.aroma(\/|$)/, // artifact + audit store
  /^ecosystem\.config\.c?js$/, // process/deploy config
  /^src\/app\.js$/, // the execution-authorization gate, flags, confirm handler
  /^src\/agent\/agentauthorization\.js$/, // the flag/two-of-three gate
  /^src\/agent\/audit\.js$/, // the audit log
  /^src\/agent\/workorder\.js$/, // this validator itself
  /^src\/agent\/featurebranchworkspace\.js$/, // the isolation brake
  /^src\/agent\/agentbridgeworker\.js$/, // the bounded runner
  /^src\/intake\/proposalbridge\.js$/, // the approval/promote path
  /^src\/store\/store\.js$/, // the truth store
  /^src\/store\/artifactstore\.js$/ // the artifact/audit persistence
])

/** Normalize a path to a comparable relative posix key (lowercased). */
function normRel (p) {
  return String(p == null ? '' : p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').toLowerCase()
}

/** True if a path is structurally forbidden (Cap 5) — never allowlistable. */
function isForbiddenFile (p) {
  const n = normRel(p)
  if (n === '' || n.includes('..')) return true
  return FORBIDDEN_FILE_PATTERNS.some((re) => re.test(n))
}

/**
 * Validate a Work Order. Fail-closed: returns { ok, errors[] }. ok only when every
 * field is well-formed AND no allowedFile is absolute / traversing / forbidden AND
 * the execution actions are all declared forbidden AND a positive timeout + cost cap
 * + safe approvalId are present.
 */
function validateWorkOrder (wo) {
  const errors = []
  if (!wo || typeof wo !== 'object') return { ok: false, errors: ['work order must be an object'] }

  if (typeof wo.goal !== 'string' || wo.goal.trim() === '') errors.push('goal must be a non-empty string')

  if (!Array.isArray(wo.allowedFiles) || wo.allowedFiles.length === 0) {
    errors.push('allowedFiles must be a non-empty array')
  } else {
    for (const f of wo.allowedFiles) {
      if (typeof f !== 'string' || f.trim() === '') { errors.push('allowedFiles entries must be non-empty relative paths'); continue }
      const posix = f.replace(/\\/g, '/')
      if (posix.startsWith('/') || /^[A-Za-z]:/.test(posix)) errors.push(`allowedFiles must be relative (not absolute): ${f}`)
      if (posix.includes('..')) errors.push(`allowedFiles must not contain '..': ${f}`)
      if (isForbiddenFile(f)) errors.push(`file is structurally forbidden (permission/approval/audit/flags/creds): ${f}`)
    }
  }

  if (wo.allowedTestCommand != null && typeof wo.allowedTestCommand !== 'string') {
    errors.push('allowedTestCommand must be a string or null')
  }

  if (!Array.isArray(wo.forbiddenActions)) {
    errors.push('forbiddenActions must be an array')
  } else {
    for (const a of wo.forbiddenActions) if (!FORBIDDEN_ACTIONS.includes(a)) errors.push(`unknown forbiddenAction: ${a}`)
    for (const m of MUST_FORBID) if (!wo.forbiddenActions.includes(m)) errors.push(`forbiddenActions must include '${m}'`)
  }

  if (!Number.isFinite(wo.timeoutSec) || wo.timeoutSec <= 0) errors.push('timeoutSec must be a positive number')
  if (!Number.isFinite(wo.costCapUsd) || wo.costCapUsd <= 0) errors.push('costCapUsd must be a positive number')
  if (typeof wo.approvalId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(wo.approvalId)) errors.push('approvalId must be a safe id token ([A-Za-z0-9_-]{1,64})')

  return { ok: errors.length === 0, errors }
}

/** True only if relPath is in the allowlist AND not structurally forbidden. */
function isFileAllowed (wo, relPath) {
  const n = normRel(relPath)
  if (isForbiddenFile(n)) return false
  return Array.isArray(wo && wo.allowedFiles) && wo.allowedFiles.some((f) => normRel(f) === n)
}

/** Deterministic sha256 of the approved Work Order (for the audit record). */
/**
 * THE canonical form of a Work Order — the single serialization used BOTH for the
 * approval display and for the hash. WYSIWYA depends on there being exactly one of
 * these: if the Owner sees a field, it is inside the hash, and if it is inside the
 * hash, the Owner saw it. Never build a second projection for display.
 */
function canonicalWorkOrder (wo) {
  return {
    goal: (wo && wo.goal) || null,
    allowedFiles: [...((wo && wo.allowedFiles) || [])].sort(),
    allowedTestCommand: (wo && wo.allowedTestCommand) != null ? wo.allowedTestCommand : null,
    forbiddenActions: [...((wo && wo.forbiddenActions) || [])].sort(),
    timeoutSec: (wo && wo.timeoutSec) != null ? wo.timeoutSec : null,
    costCapUsd: (wo && wo.costCapUsd) != null ? wo.costCapUsd : null,
    branch: (wo && wo.branch) != null ? wo.branch : null,
    approvalId: (wo && wo.approvalId) || null,
    // ── Owner Decision Card v2 ────────────────────────────────────────────────
    // These three exist so the Owner-facing before/after card is INSIDE the hash.
    // The card is a projection of this object and nothing else, so a value the Owner
    // read cannot be changed without changing the hash the server recomputes at
    // approval. They are display facts, never controls: the runner's scope is still
    // allowedFiles + forbiddenActions alone.
    currentExcerpt: (wo && wo.currentExcerpt) != null ? wo.currentExcerpt : null, // read from the real file at seal time
    currentExcerptTruncated: !!(wo && wo.currentExcerptTruncated),
    intendedChange: (wo && wo.intendedChange) != null ? wo.intendedChange : null, // INTENT — not a result
    approvalTtlSec: (wo && wo.approvalTtlSec) != null ? wo.approvalTtlSec : null
  }
}

/** Deterministic sha256 over the canonical form (system-computed; never model-supplied). */
function canonicalWorkOrderJson (wo) { return JSON.stringify(canonicalWorkOrder(wo)) }

function hashWorkOrder (wo) {
  return crypto.createHash('sha256').update(canonicalWorkOrderJson(wo)).digest('hex')
}

module.exports = {
  FORBIDDEN_ACTIONS,
  MUST_FORBID,
  FORBIDDEN_FILE_PATTERNS,
  validateWorkOrder,
  isFileAllowed,
  isForbiddenFile,
  hashWorkOrder,
  canonicalWorkOrder,
  canonicalWorkOrderJson,
  normRel
}
