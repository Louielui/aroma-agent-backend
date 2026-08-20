'use strict'

/**
 * confirmService.js — THE single confirm domain service.
 *
 * Both entry points call this and nothing else:
 *   1. POST /proposals/:id/confirm      — Bearer HUB_TOKEN (machine / script entry)
 *   2. POST /api/v1/owner/approve       — local Owner approval card (loopback + session
 *                                         + CSRF nonce + typed EXECUTE)
 *
 * There is deliberately ONE implementation of: the authorization gate read, the Proposal
 * confirm, the dispatchStatus decision, the sandbox-worker schedule, and the agent
 * hand-off (including its hash check). The Owner endpoint does NOT re-implement any of
 * it and the server NEVER makes an HTTP call to itself with HUB_TOKEN.
 *
 * The agent hand-off lives here — this module holds the ONLY `agentRunner.run(` call
 * site in the repo.
 */

const { hashWorkOrder } = require('./workOrder')
// ONE definition of the executor identity, imported rather than restated. The claim,
// the milestones and the success terminal all name the same executor; two literals in
// two files is how those three quietly stop agreeing.
const { AGENT_EXECUTOR } = require('../run/store')

/**
 * @param {{ proposalStore, authorize, agentRunner, scheduleWorker, owner, auditFn }} deps
 *   authorize()      -> the three-flag authorization object
 *   agentRunner       -> null unless AGENT_BRIDGE === 'on' (never constructed otherwise)
 *   scheduleWorker    -> existing B2-1 sandbox-worker scheduler (unchanged)
 *   auditFn(entry)    -> approval-attempt audit sink (numbers/enums only)
 */
/**
 * P1-C1c. Claim outcomes → the dispatchStatus the Owner is told. Closed, and
 * deliberately NOT collapsed into one word: "we could not claim it" and "someone
 * already claimed it" are different facts, and reporting either as
 * `agent_execute_accepted` would be the service claiming an execution it never
 * started.
 */
const CLAIM_DISPATCH_STATUS = Object.freeze({
  already_dispatched: 'agent_execute_already_claimed',
  already_completed: 'agent_execute_already_completed',
  needs_review: 'agent_execute_needs_review',
  dispatch_claim_failed: 'agent_execute_claim_failed'
})

function createConfirmService (deps = {}) {
  const proposalStore = deps.proposalStore
  const authorize = typeof deps.authorize === 'function' ? deps.authorize : () => ({ status: 'not_authorized', workerAuthorized: false, developAuthorized: false, agentBridgeAuthorized: false })
  const agentRunner = deps.agentRunner || null
  const scheduleWorker = typeof deps.scheduleWorker === 'function' ? deps.scheduleWorker : () => {}
  const owner = deps.owner || 'louie'
  const auditFn = typeof deps.auditFn === 'function' ? deps.auditFn : () => {}
  // Layer 2 sink. Optional and inert: if nothing is wired, the hand-off behaves exactly as
  // before and the Owner simply has no result view to read.
  // Snapshot the scope + caps at HAND-OFF, before anything runs. The result view reads
  // these instead of rebuilding them from the sealed order, which expires.
  const recordExecutionStart = typeof deps.recordExecutionStart === 'function'
    ? (id, facts) => { try { deps.recordExecutionStart(id, facts) } catch (e) { console.warn('[agent-bridge] start not recorded: ' + ((e && e.message) || String(e))) } }
    : () => {}
  const recordResult = typeof deps.recordResult === 'function'
    ? (id, r) => { try { deps.recordResult(id, r) } catch (e) { console.warn('[agent-bridge] result not recorded: ' + ((e && e.message) || String(e))) } }
    : () => {}

  // ── P1-C1c: THE CANONICAL LEDGER ────────────────────────────────────────────
  // Two narrow Run-store functions, not the whole store: this service may claim the
  // Run for the Agent lane and record the milestones that lane observes, and nothing
  // else. Absent (older callers, most tests) → claimAgent reports 'unavailable' and
  // NO agent hand-off happens, because an execution that cannot be durably claimed is
  // exactly the unrecorded attempt this tranche exists to abolish.
  const claimAgent = typeof deps.claimAgent === 'function'
    ? deps.claimAgent
    : () => ({ status: 'unavailable' })
  const appendAgentStage = typeof deps.appendAgentStage === 'function'
    ? (runId, stage, facts) => {
        try { return deps.appendAgentStage(runId, stage, facts) } catch (e) {
          console.warn('[agent-bridge] ' + stage + ' not recorded: ' + ((e && e.message) || String(e)))
          return { ok: false, reason: 'append_threw' }
        }
      }
    : () => ({ ok: false, reason: 'unavailable' })

  /** A bounded, log-safe reason string for a FAILED terminal. Never Owner text. */
  function failureReason (result) {
    if (result && typeof result.error === 'string' && result.error) return result.error.slice(0, 200)
    if (result && result.ok === false) return 'runner_reported_failure'
    return 'runner_error'
  }

  /**
   * Record the outcome on the CANONICAL ledger, in the order that makes the crash
   * window recoverable: AGENT_FINISHED (with the boolean the recovery fold reads) is
   * flushed FIRST, then exactly one terminal. If the process dies between them, the
   * Run still carries enough to settle itself at the next startup.
   */
  function recordCanonicalOutcome (runId, approvalId, result) {
    const ok = !!(result && result.ok === true)
    appendAgentStage(runId, 'AGENT_FINISHED', { ok, approvalId, executor: AGENT_EXECUTOR })
    if (ok) {
      appendAgentStage(runId, 'SUCCEEDED', { executor: AGENT_EXECUTOR, approvalId })
    } else {
      // FAILED, never COMPLETED: COMPLETED means "applied, with a backup to roll back
      // to", and this lane makes no backup. Its required backupRef is not a formality
      // to satisfy with a branch name.
      appendAgentStage(runId, 'FAILED', { error: failureReason(result), executor: AGENT_EXECUTOR, approvalId })
    }
  }

  /**
   * Confirm a Proposal, and (only when explicitly requested AND authorized) hand a
   * SEALED Work Order to the agent runner.
   *
   * @param {{ proposalId, agentExecute?, workOrder?, approvedHash?, entryPoint }} input
   *   `workOrder` MUST already be the server's sealed record — this service never accepts
   *   a browser-supplied order (the Owner endpoint loads it from the sealed store; the
   *   Bearer endpoint is a trusted machine caller).
   * @returns {{ status:number, body:object, agentHandedOff:boolean }}
   */
  function confirmProposalAction (input = {}) {
    const proposalId = input.proposalId
    const entryPoint = input.entryPoint || 'unknown'
    const auth = authorize()

    // Agent execution requires ALL THREE, explicitly. An ordinary confirm carries none
    // of them, so approving a normal Proposal is structurally incapable of starting the
    // agent — regardless of entry point.
    const agentExecuteRequested = (input.agentExecute === true) && !!input.workOrder && typeof input.approvedHash === 'string' && input.approvedHash.length > 0
    const agentEligible = agentExecuteRequested && auth.agentBridgeAuthorized && agentRunner !== null

    // P1-C1c. Read the approval identity BEFORE the Run exists, because the Run is
    // about to be created and must carry it from birth. Both values are server-owned:
    // the approvalId comes off the SEALED order the router loaded, and the hash is
    // recomputed here rather than taken from input.
    const approvalId = (input.workOrder && input.workOrder.approvalId) || null
    const workOrderHash = input.workOrder ? hashWorkOrder(input.workOrder) : null

    const runId = proposalStore.confirmProposal(proposalId, owner, { approvalId })

    let dispatchStatus
    if (auth.status === 'configuration_conflict') dispatchStatus = 'configuration_conflict'
    else if (agentEligible) dispatchStatus = 'agent_execute_accepted'
    else if (agentExecuteRequested) dispatchStatus = 'agent_execute_not_authorized'
    else if (auth.developAuthorized) dispatchStatus = 'develop_dispatched'
    else if (auth.workerAuthorized) dispatchStatus = 'worker_scheduled'
    else dispatchStatus = 'not_authorized'

    // Sandbox worker (B2-1) — unchanged, fire-and-forget by the caller's convention.
    if (auth.workerAuthorized) scheduleWorker(proposalId, runId)

    // AGENT HAND-OFF — the only call site. The runner independently recomputes the hash
    // from the order it is about to run and refuses on mismatch (no amend path); we also
    // record what we handed over so an attempt is never silent.
    if (agentEligible) {
      // ⛔ THE CLAIM COMES FIRST, AND IT IS DURABLE BEFORE ANYTHING RUNS. This is the
      //    ordering the whole tranche turns on: until AGENT_CLAIMED is on disk, nothing
      //    anywhere records that this approval is being attempted — so a second attempt
      //    could not be refused and a crash could not be distinguished from "never
      //    started". claimAgent is synchronous and flushes before it returns.
      const claim = claimAgent(runId, { approvalId, workOrderHash, executor: AGENT_EXECUTOR })
      if (claim.status !== 'dispatched') {
        // No claim, no execution. Not a fallback to Develop, not a retry, not a second
        // attempt — and NOT reported as accepted, because nothing was accepted.
        dispatchStatus = CLAIM_DISPATCH_STATUS[claim.status] || 'agent_execute_needs_review'
        auditFn({ approvalId, outcome: 'refused', reason: dispatchStatus, entryPoint })
        return { status: 201, body: { proposalStatus: 'confirmed', dispatchStatus, runId }, agentHandedOff: false }
      }

      appendAgentStage(runId, 'AGENT_SELECTED', { agentId: AGENT_EXECUTOR, approvalId })
      auditFn({ approvalId, outcome: 'handed_off', reason: null, entryPoint })
      recordExecutionStart(approvalId, {
        allowedFiles: input.workOrder.allowedFiles,
        timeoutSec: input.workOrder.timeoutSec,
        costCapUsd: input.workOrder.costCapUsd,
        allowedTestCommand: input.workOrder.allowedTestCommand,
        branch: input.workOrder.branch
      })
      Promise.resolve()
        .then(() => agentRunner.run({ runId, workOrder: input.workOrder, approvedHash: input.approvedHash, who: owner }))
        .then((result) => {
          // CANONICAL FIRST, cache second. The Run must be able to answer "did this
          // finish?" on its own, without ownerApprovalStore having survived.
          recordCanonicalOutcome(runId, approvalId, result || null)
          // LAYER 2: record what the runner reported so the Owner can be SHOWN the
          // outcome. Recording is inert — it authorizes nothing and re-runs nothing.
          recordResult(approvalId, result || null)
        })
        .catch((e) => {
          console.warn('[agent-bridge] run failed: ' + ((e && e.message) || String(e)))
          recordCanonicalOutcome(runId, approvalId, { ok: false, error: 'runner_error' })
          recordResult(approvalId, { ok: false, reason: 'runner_error' })
        })
    } else if (agentExecuteRequested) {
      auditFn({ approvalId, outcome: 'refused', reason: dispatchStatus, entryPoint })
    }

    return {
      status: 201,
      body: { proposalStatus: 'confirmed', dispatchStatus, runId },
      agentHandedOff: agentEligible
    }
  }

  /** Recompute the authoritative hash of a sealed order (never trusts a supplied one). */
  function sealedHashOf (workOrder) { return hashWorkOrder(workOrder) }

  return { confirmProposalAction, sealedHashOf }
}

module.exports = { createConfirmService }
