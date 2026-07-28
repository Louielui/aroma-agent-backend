'use strict'

/**
 * computerWorkOrder.js — Computer Operator v0, PHASE 1. The locked Work Order schema
 * and its fail-closed validator.
 *
 * ── THIS FILE CANNOT DO ANYTHING ──────────────────────────────────────────────
 * It is pure: no I/O, no process, no spawn, no network, no filesystem, no model. It
 * validates and hashes a description of intended work. Nothing here can open an app,
 * move a mouse, read a screen or touch a file — including the paths it validates,
 * which it treats as strings and never resolves against a real disk. Phase 1 has ZERO
 * action capability by construction, not by configuration.
 *
 * ── THE ONE INVARIANT THAT MATTERS MOST ───────────────────────────────────────
 * FREE TEXT CAN NEVER BECOME AN ACTION NAME. `action` is checked against a frozen,
 * closed enum by identity — not by pattern, not by prefix, not by coercion. Anything
 * that is not exactly one of the listed strings is refused, including objects with a
 * toString, boxed strings, and lookalikes with whitespace or different case. This is
 * the structural answer to prompt injection: text scraped off a screen cannot name an
 * action, because action names are not free text.
 *
 * ── SCOPE IS THE OWNER'S, NOT THE MODEL'S ─────────────────────────────────────
 * Mirrors the discipline in src/agent/workOrder.js: an order is refused unless it
 * declares its own prohibitions, every path is inside the single approved root, and
 * every execution-shaped action is explicitly forbidden. Fail-closed throughout —
 * anything not explicitly permitted is rejected.
 */

const crypto = require('node:crypto')

// ── THE CLOSED ACTION ENUM ────────────────────────────────────────────────────
// Owner-approved v0 capability, and NOTHING else: read, create a NEW file, copy.
//
// OWNER RULING 2026-07-28 — THIS ENUM STAYS FILE-ONLY. open_app / type_text / click are
// NOT to be added here. They arrive with the canary RED GO, and when they do they get
// their OWN order type — a desktop order — rather than being mixed into the
// file-operation schema. The two have different preconditions, different evidence and
// different blast radius; one schema covering both would have to be validated for the
// weaker of the two. Anyone tempted to add a desktop action to this list should build
// the second order type instead.
const ACTIONS = Object.freeze(['read_file', 'create_file', 'copy_file'])
const ACTION_SET = new Set(ACTIONS)

// ── PROHIBITIONS THE ORDER MUST DECLARE ───────────────────────────────────────
// Owner-specified for v0, plus the standing v0 bans. An order that fails to declare
// EVERY one of these is invalid — the same MUST_FORBID discipline the code agent uses,
// so an order can never be silent about what it may not do.
const FORBIDDEN_ACTIONS = Object.freeze([
  'move', 'rename', 'overwrite', 'delete', 'path_escape',
  'admin_elevation', 'send_email', 'purchase', 'password_or_security_settings',
  'production_deploy', 'unrestricted_shell', 'network_access'
])
const MUST_FORBID = FORBIDDEN_ACTIONS // v0: all of them, always

// ── THE SINGLE APPROVED ROOT ──────────────────────────────────────────────────
// Owner decision: v0 allowedPath is exactly this folder. Phase 1 does NOT create it and
// never touches the disk — the constant exists to validate against, nothing more.
const ALLOWED_ROOT = 'C:\\Aroma\\ComputerOperator-Test'

// Desktop applications are a LATER phase. The allowlist is empty on purpose, so the
// only value `targetApp` can take today is null: a file action needs no app, and no
// app has been approved. An empty allowlist is fail-closed, not an oversight.
const ALLOWED_APPS = Object.freeze([])

// Hard ceilings the Owner's order cannot raise — a bound on the bound.
// Owner ruling 2026-07-28: lowered from 20. A v0 file-operation order that needs more
// than ten steps is not a v0 order.
const HARD_MAX_STEPS = 10
const HARD_MAX_TIMEOUT_SEC = 300

/** Normalize a Windows path for comparison: backslashes, no trailing slash, lowercased. */
function normPath (p) {
  return String(p == null ? '' : p)
    .replace(/\//g, '\\')
    .replace(/\\+$/, '')
    .toLowerCase()
}

/**
 * Is this path INSIDE the single approved root?
 *
 * Rejects, in order: empty, any '..' segment, UNC (\\server), drive-relative (C:foo),
 * a different drive or folder, and the classic prefix trap where
 * `C:\Aroma\ComputerOperator-Test-evil` starts with the root string but is not inside
 * it. The root itself is allowed; anything above it is not.
 */
function isPathAllowed (p) {
  if (typeof p !== 'string' || p.trim() === '') return false
  const raw = p.replace(/\//g, '\\')
  if (raw.startsWith('\\\\')) return false // UNC
  if (/^[A-Za-z]:(?![\\/])/.test(raw)) return false // drive-relative: C:foo
  if (!/^[A-Za-z]:\\/.test(raw)) return false // must be a rooted absolute Windows path
  if (raw.split('\\').includes('..')) return false // no traversal, before normalization
  if (raw.includes('\0')) return false
  const n = normPath(raw)
  const root = normPath(ALLOWED_ROOT)
  return n === root || n.startsWith(root + '\\')
}

/** True only for an exact member of the closed enum — never a coercion or a lookalike. */
function isAllowedAction (a) {
  return typeof a === 'string' && ACTION_SET.has(a)
}

/**
 * Validate a Computer Work Order. Fail-closed: { ok, errors[] }.
 * Pure — it reads no disk, resolves no path, and contacts nothing.
 */
function validateComputerWorkOrder (wo) {
  const errors = []
  if (!wo || typeof wo !== 'object' || Array.isArray(wo)) {
    return { ok: false, errors: ['work order must be an object'] }
  }

  if (typeof wo.approvalId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(wo.approvalId)) {
    errors.push('approvalId must be a safe id token ([A-Za-z0-9_-]{1,64})')
  }
  if (typeof wo.goal !== 'string' || wo.goal.trim() === '') errors.push('goal must be a non-empty string')

  // targetApp: null, or a member of the (currently empty) approved list.
  if (wo.targetApp !== null && wo.targetApp !== undefined) {
    if (typeof wo.targetApp !== 'string' || !ALLOWED_APPS.includes(wo.targetApp)) {
      errors.push('targetApp must be null — no desktop application is approved yet')
    }
  }

  // allowedPaths: non-empty, every entry inside the one approved root.
  if (!Array.isArray(wo.allowedPaths) || wo.allowedPaths.length === 0) {
    errors.push('allowedPaths must be a non-empty array')
  } else {
    for (const p of wo.allowedPaths) {
      if (!isPathAllowed(p)) errors.push(`path is outside the approved root or malformed: ${String(p)}`)
    }
  }

  // Bounds first, so steps can be checked against a trustworthy maxSteps.
  if (!Number.isInteger(wo.maxSteps) || wo.maxSteps <= 0 || wo.maxSteps > HARD_MAX_STEPS) {
    errors.push(`maxSteps must be an integer in 1..${HARD_MAX_STEPS}`)
  }
  if (!Number.isFinite(wo.timeoutSec) || wo.timeoutSec <= 0 || wo.timeoutSec > HARD_MAX_TIMEOUT_SEC) {
    errors.push(`timeoutSec must be a positive number <= ${HARD_MAX_TIMEOUT_SEC}`)
  }

  // steps: every action from the closed enum; every path parameter inside the root.
  if (!Array.isArray(wo.steps) || wo.steps.length === 0) {
    errors.push('steps must be a non-empty array')
  } else {
    if (Number.isInteger(wo.maxSteps) && wo.steps.length > wo.maxSteps) {
      errors.push(`steps (${wo.steps.length}) exceeds maxSteps (${wo.maxSteps})`)
    }
    wo.steps.forEach((s, i) => {
      if (!s || typeof s !== 'object' || Array.isArray(s)) { errors.push(`step ${i}: must be an object`); return }
      if (!isAllowedAction(s.action)) {
        // The message never echoes the offending value — a rejected action name may be
        // attacker-controlled text and does not belong in a log or an error string.
        errors.push(`step ${i}: action is not one of the approved actions`)
        return
      }
      const params = (s.params && typeof s.params === 'object' && !Array.isArray(s.params)) ? s.params : null
      if (!params) { errors.push(`step ${i}: params must be an object`); return }
      // Every path-shaped parameter must also be inside the root. Declaring a path in
      // allowedPaths is necessary but not sufficient — the step must name one too.
      for (const key of ['path', 'sourcePath', 'destPath']) {
        if (params[key] === undefined) continue
        if (!isPathAllowed(params[key])) errors.push(`step ${i}: ${key} is outside the approved root or malformed`)
        else if (Array.isArray(wo.allowedPaths) && !wo.allowedPaths.some((a) => isWithin(params[key], a))) {
          errors.push(`step ${i}: ${key} is not covered by allowedPaths`)
        }
      }
      if (s.action === 'copy_file' && (params.sourcePath === undefined || params.destPath === undefined)) {
        errors.push(`step ${i}: copy_file requires sourcePath and destPath`)
      }
      if ((s.action === 'read_file' || s.action === 'create_file') && params.path === undefined) {
        errors.push(`step ${i}: ${s.action} requires path`)
      }
    })
  }

  // The order must declare its own prohibitions — all of them.
  if (!Array.isArray(wo.forbiddenActions)) {
    errors.push('forbiddenActions must be an array')
  } else {
    for (const a of wo.forbiddenActions) {
      if (!FORBIDDEN_ACTIONS.includes(a)) errors.push(`unknown forbiddenAction: ${String(a)}`)
    }
    for (const m of MUST_FORBID) {
      if (!wo.forbiddenActions.includes(m)) errors.push(`forbiddenActions must include '${m}'`)
    }
  }

  // Evidence is not optional in v0. An action with no evidence is an action nobody can
  // check afterwards, which is the failure mode this whole design exists to prevent.
  if (wo.requiresEvidence !== true) errors.push('requiresEvidence must be exactly true')

  return { ok: errors.length === 0, errors }
}

/** Is `p` inside `base` (or equal to it)? Both are treated as strings; no disk access. */
function isWithin (p, base) {
  const n = normPath(p)
  const b = normPath(base)
  return n === b || n.startsWith(b + '\\')
}

/**
 * THE canonical form — the single serialization used BOTH for the Owner-facing card and
 * for the hash, exactly as the code agent's Work Order does. If the Owner saw a field it
 * is inside the hash, and if it is inside the hash the Owner saw it. Never build a second
 * projection for display.
 */
function canonicalComputerWorkOrder (wo) {
  const o = wo || {}
  return {
    approvalId: o.approvalId || null,
    goal: o.goal || null,
    targetApp: o.targetApp != null ? o.targetApp : null,
    allowedPaths: [...(o.allowedPaths || [])].sort(),
    steps: (o.steps || []).map((s) => ({
      action: (s && s.action) || null,
      params: sortedParams(s && s.params)
    })),
    maxSteps: o.maxSteps != null ? o.maxSteps : null,
    timeoutSec: o.timeoutSec != null ? o.timeoutSec : null,
    forbiddenActions: [...(o.forbiddenActions || [])].sort(),
    requiresEvidence: o.requiresEvidence === true
  }
}

/** Params with keys in a stable order, so the hash cannot change with key order alone. */
function sortedParams (params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return {}
  const out = {}
  for (const k of Object.keys(params).sort()) out[k] = params[k]
  return out
}

/** Deterministic sha256 over the canonical form (system-computed; never model-supplied). */
function hashComputerWorkOrder (wo) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalComputerWorkOrder(wo)), 'utf8').digest('hex')
}

module.exports = {
  ACTIONS,
  FORBIDDEN_ACTIONS,
  MUST_FORBID,
  ALLOWED_ROOT,
  ALLOWED_APPS,
  HARD_MAX_STEPS,
  HARD_MAX_TIMEOUT_SEC,
  isAllowedAction,
  isPathAllowed,
  isWithin,
  validateComputerWorkOrder,
  canonicalComputerWorkOrder,
  hashComputerWorkOrder
}
