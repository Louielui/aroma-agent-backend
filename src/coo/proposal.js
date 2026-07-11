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
 * Persistence (B2-6): the store is durable. It loads its records from a JSON
 * file at construction and flushes the whole envelope (via a safe temp+rename
 * write) after every mutation, so a Proposal — and its confirm/cancel state —
 * survives a restart. A corrupt file fails LOUDLY at construct rather than
 * starting on silently-empty state. Persistence is injectable: `persistence:
 * false` keeps the pre-B2-6 in-memory-only behaviour (used by tests for
 * isolation). No network and no real LLM in this file.
 */

const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { classifyIntent } = require('./intent')
const { load: loadStoreFile, save: saveStoreFile } = require('./proposalPersistence')

// The durable store file, mirroring store.js's data dir (and its AROMA_DATA_DIR
// override) so both truth files live together. `data/` is gitignored.
const DATA_DIR = process.env.AROMA_DATA_DIR || path.resolve(__dirname, '../../data')
const DEFAULT_PROPOSALS_FILE = path.join(DATA_DIR, 'aroma-proposals.json')

// Every Proposal (and the Run it may become) is a Develop@1. These are fixed
// here, server-side — a caller or model can never choose the capability.
const CAPABILITY_ID = 'Develop'
const CAPABILITY_VERSION = 1

// B2-7 bridge lifecycle. This is a SEPARATE field from proposal.status (which
// keeps its pending/confirmed/cancelled values) — the bridge never adds a status
// value. A promoted proposal moves linking → ready on a successful Task bind, or
// linking → linking_failed if the bind write fails (resumable, never duplicated).
const VALID_LINK_STATES = new Set(['linking', 'ready', 'linking_failed'])

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
 * Resolve the injectable persistence config into a bound { load, save } backend,
 * or null for in-memory-only. `false`/`null` → in-memory (no disk). A string →
 * that file path. `{ path }` → that file path. `undefined` → the default file.
 */
function resolvePersistence (config) {
  if (config === false || config === null) return null
  const filePath = typeof config === 'string'
    ? config
    : (config && typeof config.path === 'string' ? config.path : DEFAULT_PROPOSALS_FILE)
  return {
    path: filePath,
    load: () => loadStoreFile(filePath),
    save: (data) => saveStoreFile(filePath, data)
  }
}

/**
 * Normalize a record read from disk WITHOUT fabricating state. A missing or
 * blank status becomes the controlled sentinel 'unknown' — NEVER defaulted to
 * 'pending', so a broken record can never be confirmed. A genuinely absent
 * confirmedBy/cancelledBy becomes null (it is absent, not invented). Records we
 * wrote ourselves already carry these fields, so a clean round-trip is untouched
 * (confirmedAt/cancelledAt/runId are intentionally NOT defaulted — their absence
 * is the legitimate "not yet confirmed/cancelled" state, not missing data).
 */
function normalizeLoaded (rec) {
  const out = { ...rec }
  if (!(typeof out.status === 'string' && out.status.trim().length > 0)) out.status = 'unknown'
  if (!('confirmedBy' in out)) out.confirmedBy = null
  if (!('cancelledBy' in out)) out.cancelledBy = null
  return out
}

/**
 * Create a Proposal Store.
 *
 * @param {{ runStore: { startRun: function }, resolveOwner?: function,
 *           persistence?: (string|false|{path?:string}) }} options
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

  // Durable backend, or null for in-memory-only. Repopulate from disk at
  // construct: a corrupt file THROWS here (ProposalStoreCorruptError) so the
  // store fails loudly rather than starting on silently-empty or fabricated
  // state; a missing file loads as empty (first mutation creates it).
  const persistence = resolvePersistence(opts.persistence)
  if (persistence) {
    const disk = persistence.load()
    for (const id of disk.order) {
      proposals.set(id, normalizeLoaded(disk.proposals[id]))
      order.push(id)
    }
  }

  /** Persist the whole { order, proposals } envelope after a mutation via the
   *  safe temp+rename write. No-op in memory-only mode. One synchronous write
   *  per mutation makes this store the single writer of its file — no
   *  read-modify-write race and no partially-written file is ever observed. */
  function flush () {
    if (!persistence) return
    persistence.save({ order: [...order], proposals: Object.fromEntries(proposals) })
  }

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
    flush() // persist the newly-created Proposal

    return { intent: 'develop', proposal: snapshot(proposal) }
  }

  /**
   * Create a bridge Proposal from an intake Task — B2-7 PROMOTE path. Unlike
   * propose(), this NEVER calls an LLM: the `task` string is the deterministic
   * brief the caller already serialized. The Proposal is created status:'pending'
   * and linkState:'linking' (inert — no Run, no worker). The endpoint binds it to
   * the Task and then flips linkState to 'ready'; only then may confirm authorise
   * it. targetProject is server-fixed to 'backend' for M1 (never 'production').
   *
   * @param {{ task: string, sourceTaskId: string, sourceDecisionId?: string|null,
   *   briefSerializationVersion?: string, sourceTaskProvenance?: object }} input
   * @returns {object} the created Proposal snapshot (linkState:'linking')
   */
  function createBridgeProposal (input = {}) {
    const src = input || {}
    if (typeof src.task !== 'string' || src.task.trim() === '') {
      throw fail(422, 'createBridgeProposal requires a non-empty task brief')
    }
    if (!isNonEmptyString(src.sourceTaskId)) {
      throw fail(422, 'createBridgeProposal requires a sourceTaskId')
    }
    const now = new Date().toISOString()
    const proposal = {
      id: 'prop_' + randomUUID().slice(0, 8),
      conversationId: null,
      task: src.task,
      // Server-fixed execution target for M1; a task-derived proposal is never
      // 'production' (confirm refuses that regardless).
      targetProject: 'backend',
      capabilityId: CAPABILITY_ID,
      version: CAPABILITY_VERSION,
      status: 'pending',
      owner: resolveOwner(),
      confirmedBy: null,
      cancelledBy: null,
      createdAt: now,
      // ── bridge provenance (persisted by the B2-6 whole-record flush) ──
      sourceTaskId: src.sourceTaskId,
      sourceDecisionId: src.sourceDecisionId == null ? null : src.sourceDecisionId,
      linkState: 'linking',
      briefSerializationVersion: isNonEmptyString(src.briefSerializationVersion) ? src.briefSerializationVersion : 'v1',
      sourceTaskProvenance: src.sourceTaskProvenance == null ? null : src.sourceTaskProvenance
    }
    proposals.set(proposal.id, proposal)
    order.push(proposal.id)
    flush()
    return snapshot(proposal)
  }

  /**
   * Set the bridge linkState of a Proposal ('linking' | 'ready' |
   * 'linking_failed') and persist. The ONLY mutator of linkState.
   * @returns {object} the updated Proposal snapshot
   */
  function setLinkState (proposalId, linkState) {
    const proposal = proposals.get(proposalId)
    if (!proposal) throw fail(404, `unknown proposal: ${proposalId}`)
    if (!VALID_LINK_STATES.has(linkState)) {
      throw fail(422, `invalid linkState: ${linkState}`)
    }
    proposal.linkState = linkState
    flush()
    return snapshot(proposal)
  }

  /**
   * Find the bridge Proposal for a source Task, or null. Used for idempotency and
   * for safe non-duplicating RESUME of an orphaned 'linking'/'linking_failed'
   * proposal after a failed bind — durable across restart via B2-6.
   * @returns {object|null}
   */
  function findBySourceTaskId (taskId) {
    for (const id of order) {
      const p = proposals.get(id)
      if (p && p.sourceTaskId === taskId) return snapshot(p)
    }
    return null
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

    // B2-7 bridge-only integrity guard (ADDITIVE — the status==='pending' rule
    // above is untouched and remains the ONLY gate for non-bridge proposals). A
    // promoted proposal carries a sourceTaskId; it may be confirmed ONLY once its
    // Task→Proposal bind reached linkState 'ready'. Fail-closed: 'linking',
    // 'linking_failed', a missing linkState, or any other value is REJECTED, so a
    // half-linked promotion can never be authorised for execution. Proposals
    // without a sourceTaskId are entirely unaffected.
    if (proposal.sourceTaskId != null && proposal.linkState !== 'ready') {
      throw fail(409, `bridge proposal ${proposalId} is not ready to confirm ` +
        `(linkState: ${proposal.linkState == null ? 'none' : proposal.linkState}); ` +
        'a promoted task-proposal must reach linkState "ready" before it can be confirmed')
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
    flush() // persist the confirmed status + confirmedBy/At + runId
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
    flush() // persist the cancelled status + cancelledBy/At
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

  return {
    propose,
    createBridgeProposal,
    setLinkState,
    findBySourceTaskId,
    confirmProposal,
    cancelProposal,
    getProposal,
    listProposals
  }
}

module.exports = { createProposalStore, LOCAL_OWNER }
