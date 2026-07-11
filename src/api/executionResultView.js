'use strict'

/**
 * executionResultView.js — B2-1d read model for the Result Read Endpoint.
 *
 * Read-only. Turns the durable Execution + Result artifacts (and the live
 * Proposal, when available) into a stable, frontend-shaped response.
 *
 * TWO safety properties live here:
 *
 *   1. ALLOWLIST projection. buildResultView constructs the response from an
 *      explicit set of named fields. The raw artifact is NEVER spread and keys
 *      are NEVER deleted — so a NEW field added to an artifact in the future
 *      (e.g. another prompt or path) can never accidentally leak. Excluded by
 *      construction: the prompt (`task`), sandbox paths, and anything else not
 *      named below.
 *
 *   2. Robust reads. The finders scan a kind directory and parse each file
 *      defensively; a malformed file is counted, not thrown, so one bad file
 *      cannot crash a lookup. Callers turn "a matching record might be in a
 *      malformed file" into a controlled error.
 *
 * `worker`/`provider` are Config-layer static labels (this MVP registers a single
 * worker as claude); they are NOT runtime-queried.
 */

const fs = require('node:fs')
const path = require('node:path')

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const WORKER = 'claude'
const PROVIDER = 'anthropic-claude'
const NO_RELAY = { toUser: 0, fromUser: 0, manual: 0 }

/** True only for a safe id token (no path separators, dots, or traversal). */
function validateProposalId (id) {
  return typeof id === 'string' && ID_RE.test(id)
}

/**
 * Read every JSON record in a kind directory, robustly.
 * @returns {{ records: object[], malformed: number }}
 */
function scanKind (store, kind) {
  let dir
  try { dir = store.dirFor(kind) } catch (_) { return { records: [], malformed: 0 } }
  if (!fs.existsSync(dir)) return { records: [], malformed: 0 }
  const records = []
  let malformed = 0
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    try {
      records.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
    } catch (_) {
      malformed++ // unreadable/corrupt file — skip, never throw
    }
  }
  return { records, malformed }
}

/** Find the Execution Artifact whose proposalId matches. */
function findExecutionByProposalId (store, proposalId) {
  const { records, malformed } = scanKind(store, 'tasks')
  return { execution: records.find(r => r && r.proposalId === proposalId) || null, malformed }
}

/** Find the Result Artifact whose taskId matches. */
function findResultByTaskId (store, taskId) {
  const { records, malformed } = scanKind(store, 'results')
  return { result: records.find(r => r && r.taskId === taskId) || null, malformed }
}

function num (v) { return Number.isFinite(v) ? v : 0 }

/**
 * Build the frontend-shaped view. ALLOWLIST only — every returned key is named
 * explicitly; the raw artifacts are never spread.
 *
 * @param {{ proposalId: string, execution: object|null, result: object|null, proposal: object|null }} input
 * @returns {object} the read model
 */
function buildResultView ({ proposalId, execution, result, proposal }) {
  // Provenance: prefer the live Proposal; else the durable Execution snapshot
  // (so provenance survives a restart that clears the in-memory proposal store).
  let confirmedBy = null
  let confirmedAt = null
  let proposalStatus = null
  if (proposal) {
    confirmedBy = typeof proposal.confirmedBy === 'string' ? proposal.confirmedBy : null
    confirmedAt = typeof proposal.confirmedAt === 'string' ? proposal.confirmedAt : null
    proposalStatus = typeof proposal.status === 'string' ? proposal.status : null
  } else if (execution && execution.approval && typeof execution.approval === 'object') {
    confirmedBy = typeof execution.approval.confirmedBy === 'string' ? execution.approval.confirmedBy : null
    confirmedAt = typeof execution.approval.confirmedAt === 'string' ? execution.approval.confirmedAt : null
    proposalStatus = 'confirmed'
  }

  const startedAt = execution && typeof execution.createdAt === 'string' ? execution.createdAt : null
  const finishedAt = result && typeof result.createdAt === 'string' ? result.createdAt : null
  let elapsedMs = null
  if (startedAt && finishedAt) {
    const a = Date.parse(startedAt)
    const b = Date.parse(finishedAt)
    if (Number.isFinite(a) && Number.isFinite(b)) elapsedMs = b - a
  }

  const status = !execution
    ? 'pending'
    : (!result ? 'running' : (result.ok === true ? 'succeeded' : 'failed'))

  return {
    proposalId,
    executionId: execution && typeof execution.id === 'string' ? execution.id : null,
    status,
    ok: result ? result.ok === true : null,
    worker: WORKER,
    provider: PROVIDER,
    startedAt,
    finishedAt,
    elapsedMs,
    exitCode: result && Number.isInteger(result.exit) ? result.exit : null,
    resultSummary: result && typeof result.result === 'string' ? result.result : null,
    cost: result && Number.isFinite(result.cost) ? result.cost : null,
    error: result && typeof result.error === 'string' ? result.error : null,
    relay: result && result.relay && typeof result.relay === 'object'
      ? { toUser: num(result.relay.toUser), fromUser: num(result.relay.fromUser), manual: num(result.relay.manual) }
      : { ...NO_RELAY },
    proposal: { id: proposalId, status: proposalStatus, confirmedBy, confirmedAt }
  }
}

module.exports = {
  ID_RE,
  WORKER,
  PROVIDER,
  validateProposalId,
  scanKind,
  findExecutionByProposalId,
  findResultByTaskId,
  buildResultView
}
