'use strict'

/**
 * dispatcher.js — the Dispatcher for the Aroma OS backend.
 *
 * The Dispatcher is the single place where a routing request is actually turned
 * into work. It stitches together the pieces the other modules already own and
 * adds nothing of its own policy:
 *
 *   policy.js    → decides allow / require_approval / deny (runs FIRST, always).
 *   agents.js    → who provides the capability, how to rank them, health folding.
 *   adapter.js   → the worker boundary contract (validate + normalized result).
 *   registry.js  → the authoritative typed contract for an (id, version).
 *
 * The control flow is deliberately rigid and MUST NOT deviate:
 *
 *   1. Evaluate policy BEFORE anything else — before any agent is selected or any
 *      adapter is touched.
 *   2. 'deny'            → return immediately, record an Event, never route.
 *   3. 'require_approval' without an explicit approved approval → return
 *      'pending_approval', record an Event, never route. The Dispatcher NEVER
 *      grants approval itself; approval can only arrive as an argument.
 *   4. 'require_approval' with approval.approved === true → proceed.
 *   5. 'allow'           → proceed.
 *   6..11 → select an agent, invoke its adapter, fold the result into health,
 *           and fall back to the next ranked agent on failure.
 *
 * Everything is in-memory: Events go to a per-dispatcher array plus an optional
 * injectable sink. No file I/O, no network, no persistence.
 */

const { agentsProviding, rankByHealth, updateHealthFromEvent, getHealth } = require('./agents')
const { evaluate } = require('./policy')
const { validateAdapter, createResult } = require('./adapter')
const { getCapability, isRoutable } = require('./registry')

/**
 * Create a Dispatcher instance. Each instance owns its own in-memory Event log,
 * so dispatchers are independent and safe to create per caller / per test.
 *
 * @param {{ adapters?: Object<string, object>, eventSink?: function,
 *           runContext?: { appendStage: function } }} [options]
 *   adapters — map from agent id to a Worker Adapter object.
 *   eventSink — optional function called with every Event as it is recorded.
 *   runContext — optional Run Timeline sink exposing appendStage(stage, facts).
 *     When supplied, the Dispatcher records each governance and routing milestone
 *     it ACTUALLY observes as a timeline stage, at the exact moment it happens.
 *     When absent, the Dispatcher behaves byte-for-byte as it did before the
 *     timeline existed — this backward compatibility is a hard requirement, so
 *     proof-run.js keeps working unchanged.
 * @returns {{ dispatch: function, getEvents: function }}
 */
function createDispatcher (options = {}) {
  const adapters = (options && options.adapters) || {}
  const eventSink = options && typeof options.eventSink === 'function' ? options.eventSink : null
  const runContext = options && options.runContext &&
    typeof options.runContext.appendStage === 'function' ? options.runContext : null

  // The in-memory Event log for this dispatcher.
  const events = []

  /**
   * Append a Run Timeline stage IFF a runContext was supplied — a no-op
   * otherwise, so the no-runContext path stays byte-for-byte identical to the
   * legacy behaviour. The Dispatcher only ever records what it itself observed,
   * and never derives a stage from language-model output.
   */
  function stage (name, facts) {
    if (runContext) runContext.appendStage(name, facts)
  }

  /** Build a normalized Event record. */
  function buildEvent ({ agentId, capabilityId, version, verdict, success, latencyMs, cost }) {
    return {
      agentId: agentId == null ? null : agentId,
      capabilityId,
      version,
      verdict: verdict.verdict,
      rule_id: verdict.rule_id,
      success: success === true,
      latencyMs: Number.isFinite(latencyMs) ? latencyMs : 0,
      cost: Number.isFinite(cost) ? cost : 0,
      timestamp: Date.now()
    }
  }

  /**
   * Append an Event to the log and hand it to the sink. Agent-bound Events (a
   * real adapter attempt) additionally fold into rolling health; control Events
   * (denied / pending_approval / no_agent) carry no agent and never touch health.
   */
  function record (event) {
    events.push(event)
    if (eventSink) eventSink(event)
    if (event.agentId != null) updateHealthFromEvent(event)
    return event
  }

  /**
   * Route one request.
   *
   * @param {{ capabilityId: string, version?: number, target?: string,
   *           input?: object, context?: object }} request
   * @param {{ approved: boolean, approvedBy: string }|null} [approval=null]
   * @returns {Promise<object>} one of:
   *   { status: 'denied', reason, rule_id }
   *   { status: 'pending_approval', reason, rule_id }
   *   { status: 'no_agent' }
   *   { status: 'failed', agentId, cost, latencyMs, error, attempts }
   *   { status: 'ok', agentId, output, cost, latencyMs }
   */
  async function dispatch (request, approval = null) {
    // No implicit "latest": mirror policy.js — callers name a version.
    const version = request && request.version == null ? 1 : request.version
    const capabilityId = request && request.capabilityId
    const input = request ? request.input : undefined

    // (1) Policy runs FIRST — before any agent is selected or adapter touched.
    const verdict = evaluate(request)
    // (timeline) The verdict is now an observed fact — record it immediately.
    stage('POLICY_EVALUATED', { verdict: verdict.verdict, rule_id: verdict.rule_id })

    // (2) Hard deny: return immediately, record an Event, never route.
    if (verdict.verdict === 'deny') {
      record(buildEvent({ agentId: null, capabilityId, version, verdict, success: false }))
      // (timeline) Denied: no agent selected, no adapter touched.
      stage('DENIED', { reason: verdict.reason, rule_id: verdict.rule_id })
      return { status: 'denied', reason: verdict.reason, rule_id: verdict.rule_id }
    }

    // (3) Approval required but not explicitly granted: the Dispatcher never
    // grants approval itself — it can only arrive as approval.approved === true.
    if (verdict.verdict === 'require_approval' && !(approval && approval.approved === true)) {
      record(buildEvent({ agentId: null, capabilityId, version, verdict, success: false }))
      // (timeline) Paused for a human: no agent selected, no adapter touched.
      stage('PENDING_APPROVAL', { reason: verdict.reason, rule_id: verdict.rule_id })
      return { status: 'pending_approval', reason: verdict.reason, rule_id: verdict.rule_id }
    }

    // (4)/(5) Proceeding: verdict is 'allow', or 'require_approval' with approval.

    // Defensive re-check: policy.evaluate already throws on non-routable work,
    // but we re-assert directly against the registry so the Dispatcher can never
    // select an agent for a contract the OS is unable to route.
    if (!isRoutable(capabilityId, version)) {
      throw new RangeError(`not routable: ${capabilityId}@${version}`)
    }
    // The registry is authoritative for the contract; read the canonical version
    // so the Events we emit record the registry's view, not a caller-supplied one.
    const canonicalVersion = getCapability(capabilityId, version).version

    // (6) Select candidate agents. None available → no_agent (still an Event).
    const candidates = agentsProviding(capabilityId, canonicalVersion)
    if (candidates.length === 0) {
      record(buildEvent({ agentId: null, capabilityId, version: canonicalVersion, verdict, success: false }))
      return { status: 'no_agent' }
    }

    // (7) Rank best-first.
    const ranked = rankByHealth(candidates, capabilityId, canonicalVersion)

    // (timeline) An agent has been chosen. healthBasis records whether the live
    // rolling health decided the ranking, or the manifest seed values did (no
    // samples yet) — a fact the Dispatcher observes directly from the health log.
    if (runContext) {
      const selected = ranked[0]
      const liveHealth = getHealth(selected.id, capabilityId, canonicalVersion)
      const healthBasis = liveHealth && liveHealth.sample_count > 0 ? 'live' : 'seed'
      stage('AGENT_SELECTED', { agentId: selected.id, healthBasis })
    }

    // (8)/(10)/(11) Try each candidate in order; fall back on failure. We keep
    // the facts of the LAST attempt (agent, cost, latency, error) and a record of
    // EVERY attempt, so an honest failure can carry the same facts as an honest
    // success instead of discarding what the Dispatcher already knows.
    let lastError = null
    let lastAgentId = null
    let lastCost = null
    let lastLatencyMs = null
    const attempts = []
    for (const agent of ranked) {
      const agentId = agent.id
      const adapter = adapters[agentId]
      // Did we actually reach adapter.invoke? Only an attempt that reached the
      // worker has a run to finish; a rejected adapter contract observed nothing,
      // so it must not emit an AGENT_FINISHED it did not witness.
      let invoked = false

      try {
        // Enforce the Worker Adapter contract before invoking.
        validateAdapter(adapter)

        const startedAt = Date.now()
        // (timeline) About to hand work to the adapter — record it, then invoke.
        stage('AGENT_RUNNING', { agentId })
        invoked = true
        const raw = await adapter.invoke(capabilityId, canonicalVersion, input)
        const result = createResult(raw)
        const latencyMs = result.latencyMs || (Date.now() - startedAt)
        // Cost is a fact only when the adapter actually proved one. A missing or
        // non-numeric cost is recorded as null, never silently coerced to zero.
        const provenCost = raw && Number.isFinite(raw.cost) ? raw.cost : null

        if (!result.ok) {
          // Adapter reported failure: record a failing Event, fold health, fall back.
          lastError = result.error || 'adapter reported failure'
          lastAgentId = agentId
          lastCost = result.cost
          lastLatencyMs = latencyMs
          attempts.push({ agentId, error: lastError })
          record(buildEvent({
            agentId, capabilityId, version: canonicalVersion, verdict,
            success: false, latencyMs, cost: result.cost
          }))
          // (timeline) This attempt finished, unsuccessfully.
          stage('AGENT_FINISHED', { agentId, success: false, cost: provenCost, latencyMs })
          continue
        }

        // (9)/(11) Success: record, fold health, return.
        record(buildEvent({
          agentId, capabilityId, version: canonicalVersion, verdict,
          success: true, latencyMs, cost: result.cost
        }))
        // (timeline) This attempt finished, successfully.
        stage('AGENT_FINISHED', { agentId, success: true, cost: provenCost, latencyMs })
        // (timeline) A successful Develop that produced a patch path yields a
        // concrete artifact — the one routing success worth its own stage.
        if (capabilityId === 'Develop' && result.output &&
            typeof result.output.patchPath === 'string' && result.output.patchPath.length > 0) {
          stage('PATCH_READY', { patchPath: result.output.patchPath })
        }
        return { status: 'ok', agentId, output: result.output, cost: result.cost, latencyMs }
      } catch (err) {
        // Thrown error (bad/missing adapter or invoke threw): record, fold, fall back.
        lastError = (err && err.message) || String(err)
        lastAgentId = agentId
        lastCost = 0
        lastLatencyMs = 0
        attempts.push({ agentId, error: lastError })
        record(buildEvent({
          agentId, capabilityId, version: canonicalVersion, verdict,
          success: false, latencyMs: 0, cost: 0
        }))
        // (timeline) Only claim an AGENT_FINISHED if we truly reached invoke; a
        // thrown invoke proved no cost, so cost is null.
        if (invoked) stage('AGENT_FINISHED', { agentId, success: false, cost: null, latencyMs: 0 })
        continue
      }
    }

    // Every candidate failed. Report the failure honestly, carrying the facts of
    // the last agent attempted plus the full list of attempts.
    // (timeline) Every candidate failed — record the terminal failure with the
    // same facts the Dispatcher returns to its caller.
    stage('FAILED', {
      error: lastError, agentId: lastAgentId,
      cost: lastCost, latencyMs: lastLatencyMs, attempts
    })
    return {
      status: 'failed',
      agentId: lastAgentId,
      cost: lastCost,
      latencyMs: lastLatencyMs,
      error: lastError,
      attempts
    }
  }

  /**
   * Return a shallow copy of every Event recorded by this dispatcher, in order —
   * including denied, pending_approval and no_agent control Events.
   *
   * @returns {object[]}
   */
  function getEvents () {
    return events.slice()
  }

  return { dispatch, getEvents }
}

module.exports = { createDispatcher }
