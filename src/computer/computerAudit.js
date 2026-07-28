'use strict'

/**
 * computerAudit.js — Computer Operator v0, PHASE 1. The `computer-audit` record shape.
 *
 * ── WHY THIS EXISTS AT ALL ────────────────────────────────────────────────────
 * 心燈 has already been caught mis-describing what she read: the calendar reported
 * trust:"live" while she told the Owner she could not read it. That was caught by
 * comparing her words against telemetry the SYSTEM recorded — detection, not
 * prevention. A desktop operator has no such luxury, because if the outcome comes from
 * her, there is nothing to compare against.
 *
 * So the rule here is stronger: EVERY FACTUAL FIELD IS WRITTEN BY THE SUPERVISOR AND
 * THE MODEL TOUCHES NONE OF THEM. `project()` builds each record field by field from a
 * fixed allowlist, so a field the model invented cannot appear even if it is handed in.
 * Her narration is stored, when stored at all, in a clearly separate place — never in
 * the fields that say what happened.
 *
 * ── WHAT MUST NEVER BE IN HERE ────────────────────────────────────────────────
 * Never image content. Never screen text. Never OCR output. Never a window's contents,
 * a credential, a token, or a typed value. Screenshots live ONLY on the Companion
 * account's local disk and are deleted after 7 days (Owner decision); the audit keeps a
 * SHA-256 and non-sensitive metadata, which is enough to prove an image existed and was
 * not altered, and not enough to reconstruct anything from.
 *
 * Pure module: no I/O. It builds records; a caller persists them.
 */

// Owner decision: Companion-account local storage only, auto-deleted after 7 days.
const EVIDENCE_RETENTION_DAYS = 7

// The ONLY outcomes a step may have. Closed, like the action enum.
const OUTCOMES = Object.freeze(['ok', 'failed', 'refused', 'aborted'])
const OUTCOME_SET = new Set(OUTCOMES)

// Every field the Supervisor may write into a step record. Anything not on this list
// cannot enter, by construction.
const STEP_FIELDS = Object.freeze([
  'n', 'action', 'targetApp', 'startedAt', 'durationMs', 'outcome', 'refusalReason'
])

// Evidence is metadata ABOUT content, never content. These are the only keys allowed
// inside a before/after block.
const EVIDENCE_FIELDS = Object.freeze(['screenshotSha256', 'fileSha256', 'fileBytes', 'windowTitle', 'exists'])

// Keys that must never appear anywhere in a record, at any depth. If one is present the
// record is refused outright rather than silently stripped — a caller trying to write
// screen text into the audit is a bug worth failing on, not tidying away.
const BANNED_KEYS = Object.freeze([
  'screenshot', 'image', 'imageData', 'png', 'jpeg', 'base64',
  'text', 'screenText', 'ocr', 'content', 'body', 'clipboard',
  'password', 'secret', 'token', 'credential', 'cookie', 'apiKey'
])

// The model may write NOTHING. Kept as an explicit, empty, exported constant so the
// claim is checkable in a test rather than only stated in a comment.
const MODEL_WRITABLE_FIELDS = Object.freeze([])

function isSha256 (v) { return typeof v === 'string' && /^[a-f0-9]{64}$/.test(v) }

/** Recursively look for a banned key. Returns the first one found, or null. */
function findBannedKey (value, depth = 0) {
  if (depth > 6 || !value || typeof value !== 'object') return null
  for (const k of Object.keys(value)) {
    if (BANNED_KEYS.includes(k)) return k
    const found = findBannedKey(value[k], depth + 1)
    if (found) return found
  }
  return null
}

/** Project one evidence block through the allowlist. Unknown keys simply do not survive. */
function projectEvidence (input) {
  const src = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {}
  const out = {}
  for (const k of EVIDENCE_FIELDS) {
    const v = src[k]
    if (v === undefined || v === null) { out[k] = null; continue }
    if (k === 'screenshotSha256' || k === 'fileSha256') { out[k] = isSha256(v) ? v : null; continue }
    if (k === 'fileBytes') { out[k] = Number.isFinite(v) ? v : null; continue }
    if (k === 'exists') { out[k] = v === true; continue }
    // windowTitle is the one free-text field. It is a WINDOW TITLE, not window content —
    // capped so a pathological title cannot become a content channel.
    out[k] = (typeof v === 'string' && v.length <= 120) ? v : null
  }
  return out
}

/** Project one step outcome. Supervisor-written fields only. */
function projectStep (input) {
  const src = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {}
  const out = {}
  for (const k of STEP_FIELDS) {
    const v = src[k]
    if (v === undefined || v === null) { out[k] = null; continue }
    if (k === 'n') { out[k] = Number.isInteger(v) && v > 0 ? v : null; continue }
    if (k === 'durationMs') { out[k] = Number.isFinite(v) ? v : null; continue }
    if (k === 'outcome') { out[k] = OUTCOME_SET.has(v) ? v : null; continue }
    out[k] = (typeof v === 'string' && v.length <= 120) ? v : null
  }
  out.before = projectEvidence(src.before)
  out.after = projectEvidence(src.after)
  return out
}

/**
 * Build a complete computer-audit record.
 *
 * @throws if any banned key appears anywhere in the input — content must never reach
 *         the audit, and a caller attempting it is failing loudly on purpose.
 */
function buildComputerAuditRecord (input = {}) {
  const banned = findBannedKey(input)
  if (banned) throw new Error(`computer-audit refuses content: banned key '${banned}'`)

  const steps = Array.isArray(input.steps) ? input.steps.map(projectStep) : []
  return {
    id: typeof input.id === 'string' ? input.id : null,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : null,
    kind: 'computer-audit',
    approvalId: typeof input.approvalId === 'string' ? input.approvalId : null,
    workOrderHash: isSha256(input.workOrderHash) ? input.workOrderHash : null,
    who: typeof input.who === 'string' ? input.who : null,
    steps,
    ok: steps.length > 0 && steps.every((s) => s.outcome === 'ok'),
    abortReason: typeof input.abortReason === 'string' ? input.abortReason : null,
    risks: Array.isArray(input.risks) ? input.risks.filter((r) => typeof r === 'string') : [],
    evidenceRetentionDays: EVIDENCE_RETENTION_DAYS
  }
}

module.exports = {
  EVIDENCE_RETENTION_DAYS,
  OUTCOMES,
  STEP_FIELDS,
  EVIDENCE_FIELDS,
  BANNED_KEYS,
  MODEL_WRITABLE_FIELDS,
  projectStep,
  projectEvidence,
  findBannedKey,
  buildComputerAuditRecord
}
