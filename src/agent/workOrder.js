'use strict'

/**
 * workOrder.js — the structured Work Order that 心燈 produces and Louie approves,
 * plus its STRUCTURAL validation. Agent Bridge v0 (built behind AGENT_BRIDGE, OFF).
 *
 * The Work Order is the ONLY thing that authorizes an agent run, and validation is
 * fail-closed: anything it does not explicitly permit is rejected. In particular
 * the allowedFiles allowlist can NEVER include the files that hold 心燈's own
 * permission / approval / audit / flag / credential code — those are structurally
 * un-allowlistable here (Cap 5), so an approved Work Order can never point the
 * agent at the machinery that would let it expand its own authority.
 *
 * Pure module: no I/O, no process, no model. Deterministic hash for the audit log.
 */

const crypto = require('node:crypto')
const { isValidProjectId, isValidRepoFullName } = require('../projects/repositoryIdentity')

// The forbidden-action constants a Work Order must declare. Execution actions must
// ALWAYS be forbidden (defense in depth alongside the no-remote workspace).
const FORBIDDEN_ACTIONS = Object.freeze([
  'commit', 'push', 'PR', 'merge', 'deploy', 'cred-edit', 'env-edit', 'gate-edit', 'audit-edit'
])
const MUST_FORBID = Object.freeze(['commit', 'push', 'PR', 'merge', 'deploy'])

/**
 * ⛔ BY LOCATION FIRST, BY NAME ONLY AS AN EXCEPTION SET.
 *
 * ── WHAT THIS LIST USED TO BE, AND WHY IT FAILED ─────────────────────────────
 * Every entry below was added by someone remembering to add it. Measured 2026-08-07:
 * **eleven fences existed and ZERO were on this list.** Five or more were built that week and
 * the list was updated zero times.
 *
 * > **一張要人記得去維護嘅清單，唔係籬笆，係一張 checklist。** A checklist means nothing to a
 * > thing that writes code, because it does not forget — it has simply never been stopped.
 *
 * That is not an argument against the list. **It is evidence the list was never doing the
 * work.** It looked like a fence for as long as nobody tested whether it grew.
 *
 * ── THE CHANGE ──────────────────────────────────────────────────────────────
 * `src/governance/` is forbidden AS A PATH. A new fence placed there is protected because of
 * WHERE IT LIVES; putting one outside becomes a visible decision rather than a silent omission.
 *
 * > **一道由一個陣列砌成嘅籬笆，擋唔住一個改得到嗰個陣列嘅嘢。**
 * > **改代碼嘅能力一旦掂到定義籬笆嗰行，嗰道籬笆就唔係「有規矩嘅能力」，佢根本唔係籬笆。**
 * > **呢個係定義，唔係謹慎。**
 *
 * ── THE RESIDUAL GAP, STATED ────────────────────────────────────────────────
 * Protection is now structural. **The INVENTORY is not.** Whether some new fence was placed
 * outside `src/governance/` is still a judgement, now expressed as a failing test
 * (`governanceMigration.test.js`) rather than as silence. A red test is not a fence either —
 * it is a checklist that shouts. That is an improvement and it is not the same thing.
 *
 * The by-name entries below STAY. Removing them while relocating is how a gap opens in the
 * window between two mechanisms.
 */
const GOVERNANCE_PATH = 'src/governance/'

const FORBIDDEN_FILE_PATTERNS = Object.freeze([
  // ⛔ BY LOCATION — the whole path, so the NEXT fence is protected by default.
  /^src\/governance\//,
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

  // RB1: repository identity is STRUCTURAL, not optional. An order that cannot say which
  // repository it authorizes is not a Work Order — before RB1 there was no such field at
  // all, and a same-named file in the other repo sealed as if it were this one.
  if (!isValidProjectId(wo.projectId)) errors.push('projectId must be a registered project id')
  if (!isValidRepoFullName(wo.repoFullName)) errors.push('repoFullName must be owner/name (never a local path)')

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
    // ── RB1: WHICH REPOSITORY THIS ORDER AUTHORIZES ──────────────────────────
    // Server-derived from the closed Project Registry — never Owner text, browser JSON
    // or model output. They are INSIDE the hash because the Owner reads the repository
    // on his card: before RB1 the card named no repository at all, so 「改 aroma-system
    // 個 README.md」 was indistinguishable from the backend's own README.md.
    // ⛔ THE MACHINE-LOCAL ROOT IS NOT HERE AND MUST NEVER BE. A path in the hash is a
    //    path on the card and in the audit, and it would tie history to one machine.
    projectId: (wo && wo.projectId) || null,
    repoFullName: (wo && wo.repoFullName) || null,
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
  GOVERNANCE_PATH,
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
