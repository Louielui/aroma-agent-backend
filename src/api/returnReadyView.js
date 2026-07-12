'use strict'

/**
 * returnReadyView.js — Human Relay Removal Phase 1 (Claude Code → Aroma
 * auto-return). A PURE READ aggregation that lists FINISHED (terminal)
 * executions as decision-ready summaries, so 香香 can surface "what came back"
 * without Louie copying reports by hand.
 *
 * It is read-only by construction:
 *   - it reads durable artifacts via B2-8's robust scanKind (skip-and-count on a
 *     corrupt file, never a crash) and reuses B2-8's allowlist buildResultView;
 *   - it NEVER writes, NEVER dispatches, and NEVER calls startRun /
 *     confirmProposal / scheduleWorker / claim* / any dispatcher;
 *   - it adds exactly ONE provenance field to each item — sourceTaskId — from the
 *     proposal snapshot; the allowlist is otherwise unchanged, so the prompt
 *     (`task`), sandbox paths, and any other artifact field can never leak.
 *
 * "Terminal" = a Result artifact exists for the execution (buildResultView then
 * derives 'succeeded'/'failed'). Non-terminal executions (running / pending) are
 * excluded by construction. Items are newest-finished-first. Pure read filters
 * (?status, ?since) narrow the list in memory only — no state is ever recorded
 * (there is deliberately NO seen/handled write surface in Phase 1).
 */

const { scanKind, buildResultView } = require('./executionResultView')

const TERMINAL_STATUSES = new Set(['succeeded', 'failed'])

/** ms for a sort/compare key; NaN-safe (unknown timestamps sort last). */
function finishedMs (item) {
  const t = item && typeof item.finishedAt === 'string' ? Date.parse(item.finishedAt) : NaN
  return Number.isFinite(t) ? t : -Infinity
}

/**
 * Build the return-ready list — a pure read over durable artifacts + the proposal
 * store. NO writes, NO dispatch.
 *
 * @param {{ artifactStore: object, proposalStore?: object,
 *           filters?: { status?: string, since?: string } }} deps
 * @returns {{ items: object[], count: number, malformed: number }}
 *   items    — buildResultView projections (+ sourceTaskId), terminal only,
 *              newest-finished-first, after any pure filters.
 *   count    — items.length after filtering.
 *   malformed— total corrupt/unreadable artifact files skipped (tasks + results).
 */
function buildReturnReadyList ({ artifactStore, proposalStore, filters } = {}) {
  const { records: executions, malformed: tasksMalformed } = scanKind(artifactStore, 'tasks')
  const { records: results, malformed: resultsMalformed } = scanKind(artifactStore, 'results')
  const malformed = tasksMalformed + resultsMalformed

  // Index results by the executionId they link back to (taskId).
  const resultByTaskId = new Map()
  for (const r of results) {
    if (r && typeof r.taskId === 'string') resultByTaskId.set(r.taskId, r)
  }

  const getProposal = proposalStore && typeof proposalStore.getProposal === 'function'
    ? (id) => proposalStore.getProposal(id)
    : () => null

  let items = []
  for (const execution of executions) {
    if (!execution || typeof execution.id !== 'string') continue
    const result = resultByTaskId.get(execution.id) || null
    if (!result) continue // TERMINAL-ONLY — no Result artifact ⇒ still running / not finished

    const proposalId = execution.proposalId
    const proposal = proposalId != null ? getProposal(proposalId) : null

    // Reuse the B2-8 allowlist projection verbatim (never spreads the raw artifact).
    const view = buildResultView({ proposalId, execution, result, proposal })
    if (!TERMINAL_STATUSES.has(view.status)) continue // defence in depth (result ⇒ terminal)

    // Provenance-only addition: sourceTaskId from the proposal snapshot. A single
    // already-safe id (also exposed on GET /proposals/:id) — no sensitive field.
    const sourceTaskId = proposal && typeof proposal.sourceTaskId === 'string'
      ? proposal.sourceTaskId
      : null

    items.push({ ...view, sourceTaskId })
  }

  // Newest-finished-first.
  items.sort((a, b) => finishedMs(b) - finishedMs(a))

  // ── pure read filters (in-memory, NO state) ──────────────────────────────────
  const f = filters || {}
  if (f.status === 'succeeded' || f.status === 'failed') {
    items = items.filter(it => it.status === f.status)
  }
  if (typeof f.since === 'string' && f.since.trim() !== '') {
    const sinceMs = Date.parse(f.since)
    if (Number.isFinite(sinceMs)) items = items.filter(it => finishedMs(it) > sinceMs)
  }

  return { items, count: items.length, malformed }
}

module.exports = { buildReturnReadyList, TERMINAL_STATUSES }
