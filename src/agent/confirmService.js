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

/**
 * @param {{ proposalStore, authorize, agentRunner, scheduleWorker, owner, auditFn }} deps
 *   authorize()      -> the three-flag authorization object
 *   agentRunner       -> null unless AGENT_BRIDGE === 'on' (never constructed otherwise)
 *   scheduleWorker    -> existing B2-1 sandbox-worker scheduler (unchanged)
 *   auditFn(entry)    -> approval-attempt audit sink (numbers/enums only)
 */
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

    const runId = proposalStore.confirmProposal(proposalId, owner)

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
      const approvalId = input.workOrder.approvalId || null
      auditFn({ approvalId, outcome: 'handed_off', reason: null, entryPoint })
      recordExecutionStart(approvalId, {
        allowedFiles: input.workOrder.allowedFiles,
        timeoutSec: input.workOrder.timeoutSec,
        costCapUsd: input.workOrder.costCapUsd,
        allowedTestCommand: input.workOrder.allowedTestCommand,
        branch: input.workOrder.branch
      })
      Promise.resolve()
        .then(() => agentRunner.run({ workOrder: input.workOrder, approvedHash: input.approvedHash, who: owner }))
        // LAYER 2: record what the runner reported so the Owner can be SHOWN the outcome.
        // Recording is inert — it authorizes nothing and never re-runs anything.
        .then((result) => { recordResult(approvalId, result || null) })
        .catch((e) => {
          console.warn('[agent-bridge] run failed: ' + ((e && e.message) || String(e)))
          recordResult(approvalId, { ok: false, reason: 'runner_error' })
        })
    } else if (agentExecuteRequested) {
      auditFn({ approvalId: (input.workOrder && input.workOrder.approvalId) || null, outcome: 'refused', reason: dispatchStatus, entryPoint })
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
