'use strict'
/**
 * computerExecutor.js — the CANARY execution path. Separate from computerSupervisor by design.
 *
 * ── WHY THIS IS NOT A METHOD ON THE SUPERVISOR ──────────────────────────────
 * The supervisor is asserted inert: `capabilities.execute === false`,
 * `capabilities.touchesDesktop === false`, and tests lock that. Adding execute() there would
 * delete the only structural guarantee that a dry-run planner cannot act. So the ability to act
 * lives here, in a file that must be reached deliberately, and the supervisor keeps its promise.
 *
 * ── WHAT IT ACCEPTS ────────────────────────────────────────────────────────
 * A SEALED work order and nothing else. Not natural language, not an arbitrary action list, not
 * an action with extra fields. Three actions exist, each with a closed parameter set, and any
 * departure is a refusal rather than a best effort.
 *
 * ── THE ORDERING RULE THAT MATTERS MOST ────────────────────────────────────
 * The Owner named it exactly: "a failed audit at the END cannot make a completed action never
 * have happened". So refusing on a write failure after the fact is not fail-closed, it is
 * regret. Every irreversible thing is therefore preceded by a DURABLE record of the intent to
 * do it:
 *
 *     admission audit   -> lands BEFORE any desktop action is attempted at all
 *     step-start audit  -> lands BEFORE each individual step
 *     step-outcome audit-> lands AFTER each step; failure stops the run and cleans up
 *
 * If the admission record cannot be written, zero desktop actions occur. If a step-start record
 * cannot be written, that step does not run. If an outcome record cannot be written, the run
 * stops there and enters cleanup rather than continuing and reporting success it can no longer
 * evidence.
 *
 * ── NOTHING HERE TOUCHES A DESKTOP BY ITSELF ───────────────────────────────
 * All real interaction goes through an injected `desktop` adapter. This module imports no
 * automation library, spawns nothing and opens nothing. With no adapter supplied it refuses.
 * During PREPARE no adapter exists, which is why preparing this file cannot move a mouse.
 */

const crypto = require('node:crypto')
const gate = require('./sealedOrderGate')

const { ACTION_FIELDS, BIND_FIELDS, LIMITS, ALLOWED_PATH, computeOrderHash } = gate

/** The only actions that exist. Anything else is a refusal, not an extension point. */
const ACTIONS = Object.freeze(['open_app', 'type_text', 'save'])

/** The only app that may be opened. An id, never a path or an executable. */
const ALLOWED_APP_IDS = Object.freeze(['notepad'])

/**
 * The only directory a save may target. Derived from the gate's constant rather than written
 * out again, so there is one string to change and one string to approve.
 */
const ALLOWED_SAVE_DIR = ALLOWED_PATH + '\\'

function refusal (reason, detail) {
  return { ok: false, refusal: reason, reason: detail || null, stepsRun: 0, steps: [], desktopActions: 0 }
}

function assertNoExtraKeys (obj, allowed, where) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) throw new Error(`unexpected field "${k}" in ${where}`)
  }
}

/**
 * Static validation. Runs before ANY audit or action, and never touches a desktop.
 *
 * The seal, the approval, the hash, the allowed path and the two limits are NOT checked here —
 * they are checked by sealedOrderGate, which is also what the Companion and the observer ask.
 * Three files asking one question is the only way the answer cannot drift.
 */
function validateOrder (order, opts = {}) {
  if (!order || typeof order !== 'object') return refusal('malformed_order', 'no order object')

  const steps = Array.isArray(order.steps) ? order.steps : null
  if (!steps || steps.length === 0) return refusal('malformed_order', 'no steps')

  for (const s of steps) {
    if (!s || typeof s !== 'object') return refusal('malformed_step', 'step is not an object')
    if (!ACTIONS.includes(s.action)) return refusal('unknown_action', String(s && s.action))
    try {
      assertNoExtraKeys(s, ACTION_FIELDS[s.action], `step ${s.n} (${s.action})`)
    } catch (e) { return refusal('unexpected_field', e.message) }

    if (s.action === 'open_app') {
      if (!ALLOWED_APP_IDS.includes(s.appId)) return refusal('app_not_allowed', String(s.appId))
    }
    if (s.action === 'type_text') {
      if (typeof s.text !== 'string' || s.text.length === 0) return refusal('malformed_step', 'text must be a non-empty string')
      // The text is fixed by the seal; it is not composed, templated or user-supplied at run time.
      if (order.sealedText !== undefined && s.text !== order.sealedText) {
        return refusal('text_not_sealed', 'text does not match the sealed string')
      }
    }
    if (s.action === 'save') {
      const bad = fileNameProblem(s.fileName)
      if (bad) return refusal('bad_filename', bad)
    }
    if (s.action === 'type_text' || s.action === 'save') {
      if (!s.bind || typeof s.bind !== 'object') return refusal('missing_binding', `step ${s.n} must bind to the opened app`)
      try { assertNoExtraKeys(s.bind, BIND_FIELDS, `step ${s.n} bind`) } catch (e) { return refusal('unexpected_field', e.message) }
      for (const f of BIND_FIELDS) {
        if (s.bind[f] === undefined || s.bind[f] === null || s.bind[f] === '') {
          return refusal('missing_binding', `step ${s.n} bind.${f} is required`)
        }
      }
    }
  }

  // Every step must be individually unlocked by THIS order, through the shared gate. That is
  // where the seal, the hash, the approval, the path, the limits, the kill switch and the flag
  // are all checked — and where "the flag is on" is refused as insufficient.
  const flag = opts.flagOn === true ? 'on' : 'off'
  for (const s of steps) {
    const unlocked = gate.verifyUnlock({ action: s.action, order, flag, killSwitch: opts.killSwitch })
    if (!unlocked.ok) return refusal(unlocked.refusal, unlocked.reason)
  }
  return { ok: true }
}

/**
 * A save target must be a NEW file, directly inside the allowed directory, named only.
 * No separators, no traversal, no absolute path, no overwrite.
 */
function fileNameProblem (name) {
  if (typeof name !== 'string' || name.length === 0) return 'fileName must be a non-empty string'
  if (/[\\/]/.test(name)) return 'fileName must be a bare name, not a path'
  if (name.includes('..')) return 'fileName must not traverse'
  if (/^[A-Za-z]:/.test(name)) return 'fileName must not be absolute'
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return 'fileName has characters outside [A-Za-z0-9._-]'
  return null
}

/**
 * @param {object} deps
 * @param {{write:Function}} deps.artifactStore  durable audit sink — REQUIRED
 * @param {object} [deps.desktop]  the only route to a real desktop. Absent -> refuses.
 * @param {object} [deps.fsProbe]  read-only existence check for the overwrite guard
 */
function createComputerExecutor (deps = {}) {
  const artifactStore = deps.artifactStore
  const desktop = deps.desktop || null
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now()
  const clock = () => new Date(now()).toISOString()
  const newId = typeof deps.newId === 'function' ? deps.newId : () => 'cexec_' + crypto.randomBytes(6).toString('hex')

  /** Durable write. Throws on failure — every caller treats that as a stop. */
  function auditOrThrow (kind, record) {
    if (!artifactStore || typeof artifactStore.write !== 'function') {
      const e = new Error('audit_not_configured'); e.kind = kind; throw e
    }
    try {
      artifactStore.write('computer-audit', Object.assign({ kind, at: clock() }, record))
    } catch (err) {
      const e = new Error('audit_write_failed')
      e.kind = kind
      e.cause = err && err.message ? err.message : String(err)
      throw e
    }
  }

  function execute (order, opts = {}) {
    const v = validateOrder(order, opts)
    if (!v.ok) return v

    const runId = newId()

    // ── ADMISSION. DURABLE, AND BEFORE ANYTHING ELSE. ───────────────────────
    // This is the record that makes "we refuse to act unrecorded" true rather than aspirational.
    // If it does not land, not one desktop action is attempted.
    try {
      auditOrThrow('admission', {
        runId,
        orderId: order.orderId,
        approvalId: order.approvalId,
        orderHash: order.orderHash,
        plannedSteps: order.steps.map((s) => ({ n: s.n, action: s.action })),
        limits: LIMITS
      })
    } catch (err) {
      return Object.assign(refusal('audit_write_failed', err.cause || err.message), { phase: 'admission', desktopActions: 0 })
    }

    // The adapter is the ONLY way to reach a desktop, and PREPARE ships without one.
    if (!desktop) {
      try { auditOrThrow('aborted', { runId, reason: 'no_desktop_adapter' }) } catch (_) { /* already recorded above */ }
      return Object.assign(refusal('no_desktop_adapter', 'execution path is assembled but has no adapter'), { runId })
    }

    const done = []
    let desktopActions = 0
    let bindingFromOpen = null

    for (const step of order.steps) {
      // ── STEP-START. DURABLE, BEFORE THE STEP. ─────────────────────────────
      try {
        auditOrThrow('step-start', { runId, n: step.n, action: step.action })
      } catch (err) {
        return finishFailed('audit_write_failed', err.cause || err.message, 'step-start', step.n)
      }

      // Stale identity is a refusal, never a re-bind. A handle that no longer names the thing we
      // opened is the one situation where "try anyway" could act on someone else's window.
      if (step.bind) {
        if (!bindingFromOpen) return finishFailed('missing_binding', 'no open_app produced a binding', 'bind', step.n)
        for (const f of BIND_FIELDS) {
          if (String(step.bind[f]) !== String(bindingFromOpen[f])) {
            return finishFailed('stale_binding', `bind.${f} does not match the opened app`, 'bind', step.n)
          }
        }
        const live = desktop.verifyBinding ? desktop.verifyBinding(bindingFromOpen) : null
        if (!live || live.ok !== true) {
          return finishFailed('stale_binding', (live && live.reason) || 'binding no longer valid', 'bind', step.n)
        }
      }

      let outcome
      try {
        outcome = runStep(step)
        desktopActions++
      } catch (err) {
        return finishFailed('step_failed', err && err.message, 'action', step.n)
      }
      if (step.action === 'open_app') bindingFromOpen = outcome.bind

      // ── STEP-OUTCOME. Failure stops the run and cleans up. ────────────────
      try {
        auditOrThrow('step-outcome', { runId, n: step.n, action: step.action, outcome: 'ok', detail: outcome.detail || null })
      } catch (err) {
        return finishFailed('audit_write_failed', err.cause || err.message, 'step-outcome', step.n)
      }
      done.push({ n: step.n, action: step.action })
    }

    try {
      auditOrThrow('completed', { runId, stepsRun: done.length, steps: done })
    } catch (err) {
      return finishFailed('audit_write_failed', err.cause || err.message, 'completed', null)
    }
    // A PASS exists only once the whole chain is on disk.
    return { ok: true, runId, stepsRun: done.length, steps: done, desktopActions, auditChainComplete: true }

    function runStep (step) {
      if (step.action === 'open_app') return desktop.openApp({ appId: step.appId })
      if (step.action === 'type_text') return desktop.typeTextIntoControl({ bind: step.bind, text: step.text })
      if (step.action === 'save') {
        // Built from the ORDER's allowedPath, which the gate has already proven equal to
        // ALLOWED_PATH and which the hash covers — so the directory that was approved is
        // literally the directory that gets used.
        const target = order.allowedPath + '\\' + step.fileName
        if (deps.fsProbe && deps.fsProbe.exists && deps.fsProbe.exists(target)) {
          throw new Error('refuse_overwrite: ' + target)
        }
        return desktop.saveAsViaUi({ bind: step.bind, dir: order.allowedPath + '\\', fileName: step.fileName })
      }
      throw new Error('unknown_action')
    }

    function finishFailed (reason, detail, phase, n) {
      let cleanup = 'not_attempted'
      try {
        if (desktop && typeof desktop.cleanup === 'function') { desktop.cleanup({ runId, bind: bindingFromOpen }); cleanup = 'attempted' }
      } catch (_) { cleanup = 'failed' }
      // Best-effort: the run is already failing, and a second audit failure must not mask the first.
      try { auditOrThrow('aborted', { runId, reason, detail, phase, n, cleanup, stepsRun: done.length }) } catch (_) { }
      return { ok: false, runId, refusal: reason, reason: detail || null, phase, failedStep: n, stepsRun: done.length, steps: done, desktopActions, cleanup, auditChainComplete: false }
    }
  }

  return {
    execute,
    validateOrder,
    computeOrderHash,
    ACTIONS,
    ALLOWED_APP_IDS,
    ALLOWED_SAVE_DIR,
    LIMITS,
    // Deliberately mirrors the supervisor's shape so the difference is legible at a glance.
    capabilities: Object.freeze({ dryRun: false, execute: true, touchesDesktop: !!desktop })
  }
}

module.exports = {
  createComputerExecutor,
  computeOrderHash,
  validateOrder,
  fileNameProblem,
  ACTIONS,
  ALLOWED_APP_IDS,
  ALLOWED_SAVE_DIR,
  ALLOWED_PATH,
  ACTION_FIELDS,
  BIND_FIELDS,
  LIMITS
}
