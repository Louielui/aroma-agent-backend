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
    // ── AN ORDER MAY NOT CARRY A RUNTIME BINDING AT ALL ────────────────────
    // This block used to REQUIRE one, which made the approved canary unrunnable: the values do
    // not exist until open_app has run, and `bind` was inside the seal, so filling them in would
    // have invalidated the approval.
    //
    // Refused rather than ignored. An order shaped like the old one was written against the old
    // rules, and silently dropping the field would let it run under an approval that meant
    // something different from what it says.
    if (s.bind !== undefined) {
      return refusal('unexpected_field', `step ${s.n} carries a runtime binding; bind is established by open_app, never approved`)
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
  // The registry is a REQUIRED collaborator, not an option. An executor without one has
  // no replay protection and no single-live-order guarantee, so it refuses to act.
  const orderRegistry = deps.orderRegistry || null
  /**
   * What open_app must hand back, checked before anything is allowed to use it.
   *
   * ── WHY THIS IS AS STRICT AS THE ORDER SCHEMA ──────────────────────────────
   * The binding is now the ONLY thing that says which window the next two steps act on. It used
   * to be in the sealed order, where the gate checked it; taking it out of the seal means the
   * checking has to come with it, or the strictness was simply deleted.
   *
   * Exactly four fields. A missing one, a null, an empty string, or an extra one is a refusal —
   * an extra field is how a second meaning gets attached to a binding, and a null is how
   * "we could not determine the window" becomes "no window constraint".
   *
   * The session is checked against the Companion's OWN attested session. A binding to a window
   * in another session is either a bug or the beginning of one: the whole containment argument
   * rests on the canary acting inside the session whose identity was attested.
   *
   * The result is frozen and is a COPY. The adapter's object is never held: if the adapter kept
   * a reference and later mutated it, the run's idea of what it bound to would change under it.
   */
  function validateRuntimeBinding (bind, attestedSessionId) {
    if (!bind || typeof bind !== 'object' || Array.isArray(bind)) {
      return { ok: false, refusal: 'missing_binding', reason: 'open_app returned no binding' }
    }
    const keys = Object.keys(bind)
    for (const k of keys) {
      if (!BIND_FIELDS.includes(k)) {
        return { ok: false, refusal: 'unexpected_field', reason: 'binding carries an unknown field: ' + k }
      }
    }
    for (const f of BIND_FIELDS) {
      const v = bind[f]
      if (v === undefined || v === null || v === '') {
        return { ok: false, refusal: 'missing_binding', reason: 'binding.' + f + ' is missing' }
      }
    }
    // Types and plausible values, not merely presence. A processId of 0 or a negative one is not
    // a process; a blank handle is not a handle.
    if (!Number.isInteger(bind.processId) || bind.processId <= 0) {
      return { ok: false, refusal: 'bad_binding', reason: 'binding.processId is not a process id' }
    }
    if (!Number.isInteger(bind.sessionId) || bind.sessionId < 0) {
      return { ok: false, refusal: 'bad_binding', reason: 'binding.sessionId is not a session id' }
    }
    for (const f of ['windowHandle', 'uiaControlId']) {
      if (typeof bind[f] !== 'string' || bind[f].trim() === '') {
        return { ok: false, refusal: 'bad_binding', reason: 'binding.' + f + ' is not a handle' }
      }
    }
    if (attestedSessionId !== undefined && attestedSessionId !== null) {
      if (bind.sessionId !== attestedSessionId) {
        return {
          ok: false,
          refusal: 'wrong_session',
          reason: 'open_app bound to session ' + bind.sessionId + ', attested session is ' + attestedSessionId
        }
      }
    }
    return {
      ok: true,
      bind: Object.freeze({
        processId: bind.processId,
        sessionId: bind.sessionId,
        windowHandle: bind.windowHandle,
        uiaControlId: bind.uiaControlId
      })
    }
  }

  const now = typeof deps.now === 'function' ? deps.now : () => Date.now()
  const clock = () => new Date(now()).toISOString()
  const newId = typeof deps.newId === 'function' ? deps.newId : () => 'cexec_' + crypto.randomBytes(6).toString('hex')

  /** Durable write. Throws on failure — every caller treats that as a stop. */
  function auditOrThrow (kind, record) {
    if (!artifactStore || typeof artifactStore.write !== 'function') {
      const e = new Error('audit_not_configured'); e.kind = kind; throw e
    }
    try {
      // ── id AND createdAt ARE REQUIRED BY THE STORE ────────────────────────
      // This wrote `{ kind, at, ...record }` and the store demands `id` and `createdAt`. It
      // threw TypeError before touching the filesystem, on every audit write, on any machine
      // and as any user — so the whole audit chain was broken and the first attempt to use it
      // reported "the identity check could not be recorded", which reads as a disk or
      // permission problem and was neither.
      //
      // Generated HERE rather than inside the store: the store's contract is that the caller
      // supplies both, so that a test can reproduce a run exactly. Moving the clock into the
      // store would make every record depend on wall time and cost that property.
      //
      // `at` is kept as well as `createdAt`. They are the same instant, and `at` is what the
      // existing records and tests read; dropping it to tidy up would rewrite history that is
      // already on disk from earlier phases.
      const createdAt = clock()
      artifactStore.write('computer-audit', Object.assign({ kind, at: createdAt, id: newId(), createdAt }, record))
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

    // ── REGISTRY ADMISSION. BEFORE THE AUDIT, BEFORE EVERYTHING. ────────────
    // The registry answers the questions the gate cannot: has this approval been spent,
    // is another order already live, and what are this order's one-shot step nonces.
    // It runs first because it is the cheapest way to refuse a replay, and because an
    // order that will not be admitted must not even generate an admission record.
    if (!orderRegistry) return refusal('registry_not_configured', 'no order registry — refusing to act unrecorded')
    const admitted = orderRegistry.admit({
      approvalId: order.approvalId,
      workOrderHash: order.orderHash,
      stepCount: order.steps.length,
      timeoutSec: order.timeoutSec
    })
    if (!admitted.ok) {
      return Object.assign(refusal(admitted.reason, admitted.priorReason || null), { runId, desktopActions: 0 })
    }
    const stepNonces = admitted.stepNonces

    // From here the order is LIVE. Every exit below must close or invalidate it, or the
    // slot stays occupied and nothing can ever run again.

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
      // Admitted but unrecordable. The approval is burnt: an order nobody can audit does
      // not get a second attempt under the same authorisation.
      orderRegistry.invalidate(order.approvalId, 'admission_audit_failed')
      return Object.assign(refusal('audit_write_failed', err.cause || err.message), { runId, phase: 'admission', desktopActions: 0 })
    }

    // The adapter is the ONLY way to reach a desktop, and PREPARE ships without one.
    if (!desktop) {
      try { auditOrThrow('aborted', { runId, reason: 'no_desktop_adapter' }) } catch (_) { /* already recorded above */ }
      orderRegistry.invalidate(order.approvalId, 'no_desktop_adapter')
      return Object.assign(refusal('no_desktop_adapter', 'execution path is assembled but has no adapter'), { runId })
    }

    const done = []
    let desktopActions = 0
    let bindingFromOpen = null

    for (let idx = 0; idx < order.steps.length; idx++) {
      const step = order.steps[idx]

      // ── STEP-START. DURABLE, BEFORE THE STEP. ─────────────────────────────
      try {
        auditOrThrow('step-start', { runId, n: step.n, action: step.action })
      } catch (err) {
        return finishFailed('audit_write_failed', err.cause || err.message, 'step-start', step.n)
      }

      // ── BURN THE NONCE. AFTER THE AUDIT, BEFORE THE ACTION. ───────────────
      // The Owner's ruling, and the ordering is the whole of it: if the process dies
      // between the audit landing and the action starting, the nonce is ALREADY SPENT.
      // The alternative — consume after the action — leaves a window where a crash looks
      // identical to "never ran", and the only way to resolve it is to guess. A step whose
      // outcome is unknown must not be retryable; recovery is a new approval and a new
      // work order, which puts that judgement back with the Owner.
      const burn = orderRegistry.consumeStep({ approvalId: order.approvalId, stepIndex: idx, stepNonce: stepNonces[idx] })
      if (!burn.ok) {
        return finishFailed('nonce_' + burn.reason, 'step nonce refused: ' + burn.reason, 'nonce', step.n)
      }

      // ── EVERY STEP AFTER open_app ACTS ON THE RUNTIME BINDING ─────────────
      // Not on anything in the order — the order carries no binding, and cannot. The binding is
      // the one open_app produced, held in this run's local state, and verified live before each
      // action. Stale identity is a refusal, never a re-bind: no fallback to the focused window,
      // no search for another window, no re-binding. A handle that no longer names the thing we
      // opened is the one situation where "try anyway" acts on someone else's window.
      if (step.action !== 'open_app') {
        if (!bindingFromOpen) {
          return finishFailed('missing_binding', 'no open_app produced a usable binding', 'bind', step.n)
        }
        const live = desktop.verifyBinding ? desktop.verifyBinding(bindingFromOpen) : null
        if (!live || live.ok !== true) {
          return finishFailed('stale_binding', (live && live.reason) || 'binding no longer valid', 'bind', step.n)
        }
        // The live check must be about THE SAME thing we hold, not merely "something is there".
        for (const f of BIND_FIELDS) {
          if (live[f] !== undefined && String(live[f]) !== String(bindingFromOpen[f])) {
            return finishFailed('stale_binding', `${f} changed since open_app`, 'bind', step.n)
          }
        }
      }

      let outcome
      try {
        outcome = runStep(step)
        desktopActions++
      } catch (err) {
        return finishFailed('step_failed', err && err.message, 'action', step.n)
      }

      if (step.action === 'open_app') {
        const b = validateRuntimeBinding(outcome && outcome.bind, opts.attestedSessionId)
        if (!b.ok) return finishFailed(b.refusal, b.reason, 'bind', step.n)
        // FROZEN, and a copy. Nothing downstream can alter what open_app established, and
        // nothing that alters it can reach the order, the receipt or the request — all three
        // are inputs to this run and none of them is written to.
        bindingFromOpen = b.bind
      }

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
    // A PASS exists only once the whole chain is on disk AND the order is closed. Closing
    // is what frees the single live slot, so it happens on the success path too.
    orderRegistry.close(order.approvalId)
    return { ok: true, runId, stepsRun: done.length, steps: done, desktopActions, auditChainComplete: true, orderClosed: true }

    function runStep (step) {
      // The binding passed to the adapter is ALWAYS the runtime one. It used to be `step.bind`,
      // read straight out of the sealed order — a value that could not have been there.
      if (step.action === 'open_app') return desktop.openApp({ appId: step.appId })
      if (step.action === 'type_text') return desktop.typeTextIntoControl({ bind: bindingFromOpen, text: step.text })
      if (step.action === 'save') {
        // Built from the ORDER's allowedPath, which the gate has already proven equal to
        // ALLOWED_PATH and which the hash covers — so the directory that was approved is
        // literally the directory that gets used.
        const target = order.allowedPath + '\\' + step.fileName
        if (deps.fsProbe && deps.fsProbe.exists && deps.fsProbe.exists(target)) {
          throw new Error('refuse_overwrite: ' + target)
        }
        return desktop.saveAsViaUi({ bind: bindingFromOpen, dir: order.allowedPath + '\\', fileName: step.fileName })
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
      // TERMINAL. Cleanup tidies a desktop; it does NOT reopen an order. Invalidate runs
      // after cleanup precisely so that no cleanup path can be mistaken for a resume.
      orderRegistry.invalidate(order.approvalId, reason)
      return { ok: false, runId, refusal: reason, reason: detail || null, phase, failedStep: n, stepsRun: done.length, steps: done, desktopActions, cleanup, auditChainComplete: false, orderClosed: true }
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
