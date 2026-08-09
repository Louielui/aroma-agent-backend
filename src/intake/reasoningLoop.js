'use strict'

/**
 * reasoningLoop.js — ONE bounded Reason → Read → Observe → Reason → Final loop.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「Louie must NOT need to manually carry information between steps.」**
 *
 * Before this, a turn was: build context → ONE model call → answer. If the model needed
 * something it had not been given, the Owner fetched it and pasted it back. This closes that
 * loop inside a single user turn, three decisions at most.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── WHAT IT IS NOT ───────────────────────────────────────────────────────────
 * Not an agent framework, not a planner language, not a workflow engine. It is a `for` loop
 * with a hard bound, an allowlist, and a fail-closed default.
 *
 * ── PROVIDER NEUTRALITY IS STRUCTURAL, NOT A PROMISE ─────────────────────────
 * This module is handed `callModel` and never learns what is behind it. There is no provider
 * name, no branch, no adapter import — a test greps this file for provider tokens with the
 * comments stripped. Everything provider-specific stays behind the existing LLMAdapter.
 *
 * ── NO CHAIN OF THOUGHT ──────────────────────────────────────────────────────
 * The model returns an ACTION DECISION — `{type:'final'}` or `{type:'read', capability}` —
 * never its reasoning. Nothing here stores, forwards or logs private deliberation, because
 * nothing here ever receives any.
 *
 * ── FAIL CLOSED, EVERY TIME ──────────────────────────────────────────────────
 * An unknown capability, a write-shaped capability, an unrecognised decision type or a read
 * that throws all become the SAME thing: a refused observation handed back to the model. The
 * model is told what did not happen; nothing is executed, and nothing is retried.
 */

/**
 * ⛔ THE BOUND. One constant, no configuration system, no environment variable.
 * Three model DECISIONS — so at most two reads before the final answer.
 *
 * ⛔ AND IT REMAINS THE DEFAULT FOR EVERY TURN. A caller may pass `maxSteps` to raise it for
 * ONE turn that has a structural reason (see `beforeFinal`), but there is deliberately no env
 * var, no config file and no global. Unset means 3, today and after this change.
 */
const MAX_REASONING_STEPS = 3

/**
 * The ceiling on any caller-supplied `maxSteps`. A bound a caller can set to anything is not
 * a bound; this one costs at most one extra paid call beyond the default.
 */
const MAX_REASONING_STEPS_CEILING = 4

const STOP = Object.freeze({
  FINAL: 'final',
  STEP_LIMIT: 'step_limit',
  // A caller-supplied pre-read hook ended the turn before the reader was touched. The loop
  // does not know why — that is the caller's business, and keeping it that way is what lets
  // this module stay domain-neutral.
  BEFORE_READ: 'before_read',
  // A caller-supplied pre-FINAL hook would not release the answer, and did not hand back a
  // usable refusal either. No result and nothing invented: the caller renders its own
  // deterministic fallback, exactly as it does at the step limit.
  BEFORE_FINAL: 'before_final'
})

/**
 * Capability names that are read-shaped and nothing else.
 *
 * ⛔ THE ALLOWLIST IS PASSED IN, NOT DECLARED HERE. It is derived by the caller from the
 * sources the runtime has ALREADY authorised for this turn — the same flag-gated,
 * provider-filtered set the one-shot path reads. A model cannot widen it by naming something,
 * and this module cannot widen it by knowing a name.
 *
 * This second check is belt-and-braces: even if an allowlist were ever built wrongly, a
 * write-shaped name cannot pass. Mirrors readConnector's WRITE_RE, deliberately.
 */
const WRITE_SHAPED = /(send|create|draft|update|delete|remove|write|post|put|patch|approve|execute|run|merge|deploy|cancel|pay|order)/i

function refusal (capability, error) {
  return { capability: capability == null ? null : String(capability).slice(0, 64), ok: false, error, summary: null }
}

/**
 * @param {object} input
 * @param {string[]} input.capabilities        READ capabilities already authorised this turn
 * @param {function} input.callModel           ({step, observations}) => decision
 * @param {function} input.executeRead         ({capability, args}) => observation
 * @param {function} [input.onModelCall]       accounting hook — called for EVERY invocation
 * @param {function} [input.onEvent]           structural telemetry only
 * @returns {{result: object|null, steps: number, stopReason: string, observations: object[]}}
 */
async function runReasoningLoop (input = {}) {
  const capabilities = new Set(Array.isArray(input.capabilities) ? input.capabilities.map(String) : [])
  const callModel = input.callModel
  const executeRead = input.executeRead
  const onModelCall = typeof input.onModelCall === 'function' ? input.onModelCall : null
  const onEvent = typeof input.onEvent === 'function' ? input.onEvent : null

  const observations = []
  const emit = (step, decisionType, extra) => {
    if (!onEvent) return
    // ⛔ STRUCTURAL ONLY. A capability NAME is a fixed identifier from the allowlist, never
    // content. No claim text, no row values, no summary, no model prose, no prompt.
    try {
      onEvent(Object.assign({
        event: 'REASONING_STEP',
        reasoningStep: step,
        decisionType: decisionType == null ? null : String(decisionType).slice(0, 32)
      }, extra || {}))
    } catch (_) { /* telemetry must never break a turn */ }
  }

  // ⛔ THE BOUND IS PER-TURN, CLAMPED, AND DEFAULTS TO TODAY'S. Unset — which is every
  // existing caller — is 3, unchanged. A caller with a structural reason may ask for one more
  // decision and no further: a bound the caller picks freely is not a bound.
  const requested = Number.isFinite(input.maxSteps) ? Math.floor(input.maxSteps) : MAX_REASONING_STEPS
  const maxSteps = Math.max(1, Math.min(requested, MAX_REASONING_STEPS_CEILING))

  for (let step = 1; step <= maxSteps; step++) {
    // Accounting is reported for EVERY invocation, before the call is made, so a call that
    // throws is still counted — a turn that billed and then failed must not look free.
    if (onModelCall) { try { onModelCall({ step }) } catch (_) {} }

    const decision = await callModel({ step, observations: observations.slice() })
    const type = decision && typeof decision === 'object' ? decision.type : null

    if (type === 'final') {
      // ══════════════════════════════════════════════════════════════════════
      // ⛔ THE OPTIONAL beforeFinal HOOK — AND THIS LOOP DOES NOT KNOW WHY.
      //
      // A caller may have a STRUCTURAL reason why an answer is not finishable yet: something
      // the turn was required to do has not happened. The model cannot be trusted to remember
      // such a condition — measured, it read one world, found the other missing, and wrote an
      // honest apology instead of going to get it.
      //
      // So the caller gets one chance to refuse the final. What it may hand back is an
      // OBSERVATION, on exactly the same terms as a refused read: structural, enum-shaped, and
      // fed to the next model call. This module learns nothing about worlds, sources, domains
      // or the reason — it forwards an opaque record and continues the loop.
      //
      // ⛔ NO HOOK, NO CHANGE. Every existing caller passes none, `gate` is undefined, and the
      // branch is a single falsy check before the identical return.
      //
      // ⛔ AND IT FAILS CLOSED AGAINST A PREMATURE FINAL. A hook that throws, or returns
      // something unrecognised, does NOT release the answer — the same discipline as
      // beforeRead. A guard whose failure mode is 「carry on」 is not a guard; and here
      // carrying on means publishing the very answer the caller said was incomplete.
      // ══════════════════════════════════════════════════════════════════════
      if (typeof input.beforeFinal === 'function') {
        let gate
        try {
          gate = await input.beforeFinal({ step, decision, observations: observations.slice() })
        } catch (_) {
          gate = null // a throw is a refusal, never a release
        }
        if (gate && gate.type === 'refuse') {
          // The refusal becomes an ordinary observation and the loop continues, so the model
          // can act on it inside the same bound. `observation` is passed through untouched:
          // the caller owns its shape, and this module must not learn to read it.
          if (gate.observation && typeof gate.observation === 'object') observations.push(gate.observation)
          emit(step, 'refused', { refusal: 'before_final' })
          continue
        }
        if (!gate || gate.type !== 'allow') {
          // Unrecognised: not an allow, so not released. The turn stops here with no result and
          // the caller renders its deterministic fallback, exactly as at the step limit.
          emit(step, null, { stopReason: STOP.BEFORE_FINAL })
          return { result: null, steps: step, stopReason: STOP.BEFORE_FINAL, observations }
        }
      }
      emit(step, 'final', { stopReason: STOP.FINAL })
      return { result: decision.result || null, steps: step, stopReason: STOP.FINAL, observations }
    }

    if (type !== 'read') {
      // Not final, not a read. Refused as an observation rather than thrown: the model gets
      // one chance to correct itself within the same bound, and the turn still completes.
      observations.push(refusal(decision && decision.capability, 'unknown_decision_type'))
      emit(step, 'refused', { refusal: 'unknown_decision_type' })
      continue
    }

    const capability = decision.capability == null ? '' : String(decision.capability)

    // ⛔ ALLOWLIST FIRST. An invented name never reaches the reader.
    if (!capabilities.has(capability)) {
      observations.push(refusal(capability, 'capability_not_allowed'))
      emit(step, 'read', { refusal: 'capability_not_allowed' })
      continue
    }
    // ⛔ AND A WRITE-SHAPED NAME NEVER RUNS, even if it somehow reached the allowlist.
    if (WRITE_SHAPED.test(capability)) {
      observations.push(refusal(capability, 'write_not_permitted_here'))
      emit(step, 'read', { refusal: 'write_not_permitted_here' })
      continue
    }

    // ⛔ AN OPTIONAL PRE-READ HOOK, AND IT KNOWS NOTHING ABOUT WHAT IT IS GUARDING.
    //
    // It runs AFTER the allowlist and the write-shape guard — a capability that was never
    // permitted must be refused without consulting anything — and BEFORE executeRead, so a
    // hook that stops the turn costs zero connector calls.
    //
    // This module still understands exactly two outcomes: proceed, or stop with a final
    // result. It has no notion of sources, worlds, ambiguity or Aroma, and a test greps this
    // file for such tokens. The caller owns the meaning; the loop owns the bound.
    //
    // ⛔ FAIL CLOSED. A hook that throws, or returns anything that is not a recognised
    // instruction, STOPS the read. A guard whose failure mode is 「carry on」 is not a guard —
    // and the loop cannot tell a broken hook from a permissive one, so it must not try.
    if (typeof input.beforeRead === 'function') {
      let gate
      try {
        gate = await input.beforeRead({ capability, args: decision.args || {}, step, observations: observations.slice() })
      } catch (_) {
        emit(step, 'read', { refusal: 'before_read_failed' })
        return { result: null, steps: step, stopReason: STOP.BEFORE_READ, observations }
      }
      if (gate && gate.type === 'final') {
        emit(step, 'final', { stopReason: STOP.BEFORE_READ })
        return { result: gate.result || null, steps: step, stopReason: STOP.BEFORE_READ, observations }
      }
      if (gate !== null && gate !== undefined && !(gate && gate.type === 'allow')) {
        // Not an allow, not a final — unrecognised. The read does not happen.
        emit(step, 'read', { refusal: 'before_read_invalid' })
        return { result: null, steps: step, stopReason: STOP.BEFORE_READ, observations }
      }
    }

    let observation
    try {
      observation = await executeRead({ capability, args: decision.args || {} })
    } catch (_) {
      // ⛔ ONE ATTEMPT. No retry — a retry loop inside a bounded loop is how a bound stops
      // meaning anything. And the thrown message is DISCARDED: an upstream error can carry a
      // supplier name or a row value, and this observation goes back into a prompt.
      observation = refusal(capability, 'read_failed')
    }
    if (!observation || typeof observation !== 'object') observation = refusal(capability, 'read_failed')
    if (observation.capability == null) observation.capability = capability

    observations.push(observation)
    emit(step, 'read', { capability, ok: observation.ok === true })
  }

  // ⛔ THE STEP LIMIT IS NOT AN ANSWER. No fourth call, and nothing invented. The caller
  // renders a deterministic fallback from whatever WAS gathered, which is returned here.
  // ⛔ THE BOUND THAT ACTUALLY APPLIED, not the constant. On a turn granted a fourth decision
  // these differ, and reporting 3 would make the log state a step count that never happened.
  emit(maxSteps, null, { stopReason: STOP.STEP_LIMIT })
  return { result: null, steps: maxSteps, stopReason: STOP.STEP_LIMIT, observations }
}

module.exports = { runReasoningLoop, MAX_REASONING_STEPS, MAX_REASONING_STEPS_CEILING, STOP, WRITE_SHAPED }
