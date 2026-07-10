'use strict'

/**
 * proposal.js — the conversation → Proposal → Run bridge for the Aroma OS
 * backend. This is the minimal path from talking to doing. It is NOT a planner.
 *
 * The bridge has exactly two acts, and they are deliberately separate:
 *
 *   1. propose — classify one message (via intent.js and an injected llm). Only
 *      a 'develop' intent produces a Proposal: a stored, inert description of
 *      EXACTLY what would be sent to a worker. Proposing NEVER creates a Run and
 *      NEVER dispatches anything.
 *
 *   2. confirmProposal — the ONE and ONLY path from a Proposal to a Run. It is a
 *      structured action taken by the server, never a language model reading
 *      agreement out of free text. Confirming a pending Proposal calls
 *      runStore.startRun; nothing else in this file does.
 *
 * Provenance mirrors run/store.js: `owner`, `confirmedBy` and `cancelledBy` are
 * resolved SERVER-side (via the injected owner resolver / the value the server
 * hands in), never read from caller input and never set by a language model. A
 * language model can never set owner, confirmedBy, or a targetProject of
 * 'production', and can never trigger a confirmation.
 *
 * Everything is in-memory: no file I/O, no network, no real LLM in this file.
 */

const { randomUUID } = require('node:crypto')
const { classifyIntent } = require('./intent')

// Every Proposal (and the Run it may become) is a Develop@1. These are fixed
// here, server-side — a caller or model can never choose the capability.
const CAPABILITY_ID = 'Develop'
const CAPABILITY_VERSION = 1

// The single authenticated local owner for M1, matching run/store.js. A real
// deployment resolves this from an auth context; the constant stands in until
// then and is intentionally a SERVER-side value a client can never influence.
const LOCAL_OWNER = 'louie'

/** Build an Error carrying an HTTP-appropriate statusCode for the router. */
function fail (statusCode, message) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

/** True when a value is a present, non-blank string. */
function isNonEmptyString (value) {
  return typeof value === 'string' && value.trim().length > 0
}

/** Deep-freeze an object graph so a returned snapshot cannot be mutated. */
function deepFreeze (value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value)) deepFreeze(value[key])
  }
  return value
}

/**
 * Create a Proposal Store.
 *
 * @param {{ runStore: { startRun: function }, resolveOwner?: function }} options
 *   runStore — the injected Run Store. Its startRun is called ONLY by
 *     confirmProposal, and receives a fully server-fixed request. Tests inject a
 *     fake so the real Claude Code adapter is never invoked.
 *   resolveOwner — optional function returning the authenticated owner. Defaults
 *     to the single local owner. NEVER derives the owner from caller input.
 * @returns {{ propose, confirmProposal, cancelProposal, getProposal,
 *             listProposals }}
 */
function createProposalStore (options = {}) {
  const opts = options || {}
  const runStore = opts.runStore
  if (!runStore || typeof runStore.startRun !== 'function') {
    throw new TypeError('createProposalStore requires a runStore with startRun')
  }
  const resolveOwner = typeof opts.resolveOwner === 'function'
    ? opts.resolveOwner
    : () => LOCAL_OWNER

  // The proposals this store owns, keyed by id, in creation order.
  const proposals = new Map()
  const order = []

  /** Return a deeply-frozen deep copy of a stored proposal, so callers cannot
   *  mutate the store's truth. */
  function snapshot (proposal) {
    return deepFreeze(JSON.parse(JSON.stringify(proposal)))
  }

  /**
   * Classify a message and, ONLY for a develop intent, create and store a
   * Proposal. This never calls runStore and never dispatches anything.
   *
   * @param {{ conversationId: string, message: string, llm: function }} input
   * @returns {Promise<{ intent: 'chat', reply?: string, explanation?: string,
   *   proposal: null } | { intent: 'develop', proposal: object }>}
   */
  async function propose (input = {}) {
    const src = input || {}
    const conversationId = src.conversationId
    const classification = await classifyIntent(src.message, src.llm)

    // Conversation stays conversation: no Proposal, and above all no Run.
    if (classification.intent !== 'develop') {
      return {
        intent: 'chat',
        reply: classification.reply,
        explanation: classification.explanation,
        proposal: null
      }
    }

    // A validated development request becomes an inert Proposal. The task is
    // stored VERBATIM — exactly the string that would later be sent to a worker.
    const now = new Date().toISOString()
    const proposal = {
      id: 'prop_' + randomUUID().slice(0, 8),
      conversationId: conversationId == null ? null : conversationId,
      task: classification.task,
      targetProject: classification.targetProject,
      capabilityId: CAPABILITY_ID,
      version: CAPABILITY_VERSION,
      status: 'pending',
      // owner is stamped server-side, never from the model or the caller.
      owner: resolveOwner(),
      confirmedBy: null,
      cancelledBy: null,
      createdAt: now
    }

    proposals.set(proposal.id, proposal)
    order.push(proposal.id)

    return { intent: 'develop', proposal: snapshot(proposal) }
  }

  /**
   * Confirm a pending Proposal — the ONE and ONLY path to a Run.
   *
   * A structured action, never free-text agreement: a caller invokes this
   * explicitly; a message that merely "says yes" cannot reach here. `confirmedBy`
   * is supplied by the SERVER (via the value handed in or resolveOwner), exactly
   * as run/store.js governs `owner`, and can never be set by a caller or model.
   *
   *   - rejects unless the Proposal's status is exactly 'pending' (a cancelled or
   *     already-confirmed Proposal can never be confirmed again);
   *   - rejects a targetProject of 'production' (defence in depth — propose can
   *     never store one, but confirm refuses it regardless);
   *   - marks the Proposal 'confirmed', then calls runStore.startRun with the
   *     verbatim task, targetProject, capabilityId Develop, version 1 and the
   *     conversationId, and returns the created run id.
   *
   * @param {string} proposalId
   * @param {string} [confirmedBy] the authenticated confirmer, supplied by the
   *   server; defaults to resolveOwner(). Never sourced from caller input.
   * @returns {string} the created run id
   */
  function confirmProposal (proposalId, confirmedBy) {
    const proposal = proposals.get(proposalId)
    if (!proposal) throw fail(404, `unknown proposal: ${proposalId}`)

    if (proposal.status !== 'pending') {
      throw fail(409, `proposal ${proposalId} is not pending (status: ${proposal.status}); ` +
        'only a pending proposal can be confirmed')
    }

    // A Proposal can never target production. propose already refuses it; confirm
    // refuses it again so this privileged path is safe on its own.
    if (proposal.targetProject === 'production') {
      throw fail(422, 'a proposal targeting production can never be confirmed')
    }

    // The confirmer is resolved server-side — a caller can never supply it.
    const confirmer = isNonEmptyString(confirmedBy) ? confirmedBy : resolveOwner()

    proposal.status = 'confirmed'
    proposal.confirmedBy = confirmer
    proposal.confirmedAt = new Date().toISOString()

    // The single privileged act: create the Run from the Proposal's own,
    // server-fixed fields. The conversationId is passed through to the Run.
    const runId = runStore.startRun({
      task: proposal.task,
      targetProject: proposal.targetProject,
      capabilityId: CAPABILITY_ID,
      version: CAPABILITY_VERSION,
      conversationId: proposal.conversationId
    })

    proposal.runId = runId
    return runId
  }

  /**
   * Cancel a pending Proposal. Terminal, and creates NO Run — Louie declined, so
   * no worker is ever asked to do the work.
   *
   * @param {string} proposalId
   * @param {string} [cancelledBy] the authenticated canceller, supplied by the
   *   server; defaults to resolveOwner().
   * @returns {object} the updated Proposal snapshot
   */
  function cancelProposal (proposalId, cancelledBy) {
    const proposal = proposals.get(proposalId)
    if (!proposal) throw fail(404, `unknown proposal: ${proposalId}`)

    if (proposal.status !== 'pending') {
      throw fail(409, `proposal ${proposalId} is not pending (status: ${proposal.status}); ` +
        'only a pending proposal can be cancelled')
    }

    proposal.status = 'cancelled'
    proposal.cancelledBy = isNonEmptyString(cancelledBy) ? cancelledBy : resolveOwner()
    proposal.cancelledAt = new Date().toISOString()
    return snapshot(proposal)
  }

  /** Return one Proposal snapshot by id, or null. */
  function getProposal (proposalId) {
    const proposal = proposals.get(proposalId)
    return proposal ? snapshot(proposal) : null
  }

  /** List every Proposal, most-recent-first, as frozen snapshots. */
  function listProposals () {
    return order.map(id => snapshot(proposals.get(id))).reverse()
  }

  return { propose, confirmProposal, cancelProposal, getProposal, listProposals }
}

module.exports = { createProposalStore, LOCAL_OWNER }
