'use strict'

/**
 * audit.js — append-only audit record for every Agent Bridge execution (Cap 7).
 *
 * One immutable JSON file per run under the `agent-audit` artifact kind (one file
 * per record = append-only; existing records are never mutated or overwritten). It
 * records who authorized it, when, the approved Work Order's hash, and the honest
 * result outcome. It NEVER stores the prompt, the sandbox path, env, secrets, or a
 * raw diff — only the outcome metadata 守燈 needs to report to Louie.
 *
 * This file is itself structurally un-allowlistable (see workOrder FORBIDDEN
 * patterns), so an agent run can never edit its own audit trail.
 */

const crypto = require('node:crypto')

function createAuditLog (options = {}) {
  const artifactStore = options.artifactStore
  if (!artifactStore || typeof artifactStore.write !== 'function') {
    throw new TypeError('createAuditLog requires an artifactStore with write()')
  }
  const clock = typeof options.clock === 'function' ? options.clock : () => new Date().toISOString()
  const newId = typeof options.newId === 'function' ? options.newId : () => `audit_${crypto.randomUUID().slice(0, 8)}`

  /**
   * Append one audit record. @returns the written record.
   * @param {{ approvalId, workOrderHash, who, result }} entry
   */
  function append (entry = {}) {
    const result = entry.result || null
    const out = (result && result.output) || {}
    const record = {
      id: newId(),
      createdAt: clock(),
      kind: 'agent-audit',
      approvalId: entry.approvalId || null,
      workOrderHash: entry.workOrderHash || null,
      who: entry.who || null,
      ok: result ? result.ok === true : null,
      exit: (out.exit === undefined) ? null : out.exit,
      branch: (out.branch === undefined) ? null : out.branch,
      filesChanged: Array.isArray(out.filesChanged) ? out.filesChanged : null,
      risks: Array.isArray(out.risks) ? out.risks : null,
      cost: result && Number.isFinite(result.cost) ? result.cost : null,
      // How long it actually took. The record used to carry only createdAt, so the audit
      // could not answer 'how long did this run' without the (expiring) result view.
      // durationMs is the runner's measured wall time for the whole run; workerLatencyMs
      // is the worker's own spawn-to-return figure, kept because they answer different
      // questions (clone + verification is in one and not the other).
      durationMs: Number.isFinite(entry.durationMs) ? entry.durationMs : null,
      workerLatencyMs: result && Number.isFinite(result.latencyMs) ? result.latencyMs : null
    }
    artifactStore.write('agent-audit', record)
    return record
  }

  function list () { return typeof artifactStore.list === 'function' ? artifactStore.list('agent-audit') : [] }

  return { append, list }
}

module.exports = { createAuditLog }
