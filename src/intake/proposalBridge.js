'use strict'

/**
 * proposalBridge.js — intake Task → Proposal bridge (B2-7). PROMOTE ONLY.
 *
 * A promote builds a Proposal from a Task's own fields, binds Task.proposalId to
 * it, and flips the Proposal's bridge linkState to 'ready'. It is deliberately
 * INERT with respect to execution:
 *
 *   - it NEVER calls confirmProposal;
 *   - it NEVER starts a worker or writes an Execution/Result artifact;
 *   - confirm remains the SOLE human execution-authorization point.
 *
 * Idempotent and recoverable: a second promote returns the same Proposal; a
 * failed Task bind leaves the Proposal in 'linking_failed' (never a Run) and a
 * later retry RESUMES that same Proposal by sourceTaskId scan — it never creates
 * a duplicate. All state (Task.proposalId, the Proposal) is durable, so this
 * holds across a restart (Task store + B2-6 Proposal persistence).
 *
 * The core is a pure `promoteTaskToProposal({ store, proposalStore, taskId })`
 * returning `{ status, body }`, so tests can drive every branch — including a
 * simulated bind failure — without HTTP. The router is a thin wrapper.
 */

const express = require('express')
const { serializeBriefV1, BRIEF_SERIALIZATION_VERSION } = require('./briefSerializer')

// Grounded in the real Task states in code (todo | in_progress | done). No
// aroma.ts TaskState contract exists, so we invent none: only the terminal
// 'done' state is non-promotable. Unknown/other states are treated as terminal
// too (fail-closed — we never promote a state we don't recognise as active).
const PROMOTABLE_STATES = new Set(['todo', 'in_progress'])

/**
 * Promote an intake Task into a bound, ready bridge Proposal — PROMOTE ONLY.
 * @param {{ store, proposalStore, taskId: string }} deps
 * @returns {Promise<{ status: number, body: object }>}
 */
async function promoteTaskToProposal ({ store, proposalStore, taskId }) {
  const task = store.getTask(taskId)
  if (!task) return { status: 404, body: { error: 'unknown task', taskId } }

  // (b) Already promoted? Idempotent — return the existing bind, never a 2nd.
  if (task.proposalId != null) {
    const existing = proposalStore.getProposal(task.proposalId)
    if (existing) {
      return { status: 200, body: { proposalId: existing.id, linkState: existing.linkState } }
    }
    // Integrity: Task points at a Proposal that no longer exists. Do NOT
    // recreate — surface auditable evidence and stop.
    const evidence = {
      taskId,
      boundProposalId: task.proposalId,
      reason: 'task.proposalId is set but the referenced Proposal does not exist'
    }
    console.warn('[bridge] proposal integrity error:', JSON.stringify(evidence))
    return { status: 409, body: { error: 'proposal integrity error', evidence } }
  }

  // Resume an orphaned Proposal from a prior FAILED bind (durable via B2-6): the
  // Task has no proposalId, but a 'linking'/'linking_failed' Proposal exists for
  // it. Re-bind and finish — NEVER create a second Proposal.
  const orphan = proposalStore.findBySourceTaskId(taskId)
  if (orphan) {
    return bindAndReady({ store, proposalStore, taskId, proposalId: orphan.id, resumed: true })
  }

  // (c) Fresh promote — validate against the Task's own fields (no fabrication).
  const title = typeof task.title === 'string' ? task.title.trim() : ''
  if (!title) return { status: 422, body: { error: 'task has no title; cannot promote' } }
  if (!PROMOTABLE_STATES.has(task.state)) {
    return { status: 409, body: { error: `task state '${task.state}' is not promotable`, taskId } }
  }

  // (d) Deterministic brief + (e) inert Proposal (status pending, linkState linking).
  const brief = serializeBriefV1(task)
  const proposal = proposalStore.createBridgeProposal({
    task: brief,
    sourceTaskId: taskId,
    sourceDecisionId: task.decision_id == null ? null : task.decision_id,
    briefSerializationVersion: BRIEF_SERIALIZATION_VERSION,
    sourceTaskProvenance: {
      taskId,
      title: task.title,
      state: task.state,
      decisionId: task.decision_id == null ? null : task.decision_id,
      createdAt: task.created_at == null ? null : task.created_at
    }
  })

  // (f/g) Bind then flip to ready.
  return bindAndReady({ store, proposalStore, taskId, proposalId: proposal.id, resumed: false })
}

/**
 * Bind Task→Proposal, then set linkState 'ready'. On a bind-write failure, mark
 * the Proposal 'linking_failed' (auditable, resumable) and return 500 — WITHOUT
 * starting anything. Shared by the fresh-promote and resume paths.
 */
function bindAndReady ({ store, proposalStore, taskId, proposalId, resumed }) {
  try {
    store.setTaskProposalId(taskId, proposalId)
  } catch (err) {
    const failed = proposalStore.setLinkState(proposalId, 'linking_failed')
    console.warn('[bridge] bind failed:', JSON.stringify({ taskId, proposalId, resumed, reason: err && err.message ? err.message : String(err) }))
    return {
      status: 500,
      body: { error: 'failed to bind task to proposal', proposalId, linkState: failed.linkState, resumed }
    }
  }
  const ready = proposalStore.setLinkState(proposalId, 'ready')
  return { status: 200, body: { proposalId, linkState: ready.linkState, resumed } }
}

/**
 * Build the promote router. Mounted so its single route resolves to
 * POST /api/v1/intake/tasks/:taskId/proposal.
 * @param {{ store, proposalStore }} deps
 */
function createProposalBridgeRouter ({ store, proposalStore }) {
  const router = express.Router()
  router.post('/:taskId/proposal', async (req, res) => {
    try {
      const { status, body } = await promoteTaskToProposal({ store, proposalStore, taskId: req.params.taskId })
      res.status(status).json(body)
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message })
    }
  })
  return router
}

module.exports = { promoteTaskToProposal, createProposalBridgeRouter, PROMOTABLE_STATES }
