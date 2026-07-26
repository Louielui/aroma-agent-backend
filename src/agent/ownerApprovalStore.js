'use strict'

/**
 * ownerApprovalStore.js — the SERVER-AUTHORITATIVE state behind the Owner approval card.
 *
 * Owner's core principle, implemented literally: the browser expresses INTENT; it is never
 * the authority source for a Work Order. Execution content is loaded from THIS store, by
 * approvalId, and never from the request body.
 *
 * Three things live here, all in memory (a restart invalidates everything, which is the
 * safe direction) and all fail-closed:
 *
 *   1. SEALED WORK ORDERS — WRITE-ONCE. seal() refuses a second write for the same
 *      approvalId; there is no update/patch/amend function, so no code path (chat lane
 *      included) can mutate a sealed order.
 *   2. NONCES — one per surfaced Work Order, BOUND to (approvalId, workOrderHash,
 *      sessionId). consumeNonce() is single-use and consumes on success OR failure, so a
 *      replay, a double-click and a page reload can never produce a second outcome.
 *   3. SESSIONS — server-created, opaque, short-lived; the browser only ever holds the id.
 *
 * TTL: a sealed record and its nonce EXPIRE TOGETHER after APPROVAL_TTL_MS (10 minutes).
 * Long enough to read a Work Order carefully; short enough that an abandoned tab cannot be
 * approved later. Sessions live SESSION_TTL_MS (30 minutes) — longer than one approval, so
 * a slow reader is not logged out mid-review, but still bounded.
 */

const crypto = require('node:crypto')

const APPROVAL_TTL_MS = 10 * 60 * 1000 // sealed order + its nonce, together
const SESSION_TTL_MS = 30 * 60 * 1000

function createOwnerApprovalStore (options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const rand = typeof options.rand === 'function' ? options.rand : () => crypto.randomBytes(24).toString('hex')
  const approvalTtlMs = Number.isFinite(options.approvalTtlMs) ? options.approvalTtlMs : APPROVAL_TTL_MS
  const sessionTtlMs = Number.isFinite(options.sessionTtlMs) ? options.sessionTtlMs : SESSION_TTL_MS

  const sealed = new Map()   // approvalId -> { workOrder (frozen), proposalId, sealedAt, expiresAt }
  const nonces = new Map()   // nonceValue -> { approvalId, workOrderHash, sessionId, expiresAt, consumed }
  const sessions = new Map() // sessionId  -> { createdAt, expiresAt }

  const expired = (rec) => !rec || rec.expiresAt <= now()

  // ── sessions ──────────────────────────────────────────────────────────────
  function createSession () {
    const id = rand()
    sessions.set(id, { createdAt: now(), expiresAt: now() + sessionTtlMs })
    return id
  }
  function validSession (sessionId) {
    if (typeof sessionId !== 'string' || !sessionId) return false
    const s = sessions.get(sessionId)
    if (expired(s)) { sessions.delete(sessionId); return false }
    return true
  }

  // ── sealed work orders (WRITE-ONCE) ───────────────────────────────────────
  /** @returns {{ ok:true, record }|{ ok:false, reason }} */
  function seal ({ workOrder, proposalId }) {
    if (!workOrder || typeof workOrder.approvalId !== 'string' || !workOrder.approvalId) return { ok: false, reason: 'invalid_work_order' }
    if (sealed.has(workOrder.approvalId)) return { ok: false, reason: 'already_sealed' } // WRITE-ONCE
    const record = Object.freeze({
      workOrder: Object.freeze(JSON.parse(JSON.stringify(workOrder))), // deep, detached copy
      proposalId: proposalId || null,
      sealedAt: now(),
      expiresAt: now() + approvalTtlMs
    })
    sealed.set(workOrder.approvalId, record)
    return { ok: true, record }
  }
  /** @returns {{ ok:true, record }|{ ok:false, reason:'unknown'|'expired' }} */
  function loadSealed (approvalId) {
    const rec = sealed.get(approvalId)
    if (!rec) return { ok: false, reason: 'unknown_approval_id' }
    if (expired(rec)) { sealed.delete(approvalId); return { ok: false, reason: 'expired' } }
    return { ok: true, record: rec }
  }

  // ── nonces (bound + single-use) ───────────────────────────────────────────
  function issueNonce ({ approvalId, workOrderHash, sessionId }) {
    const value = rand()
    nonces.set(value, { approvalId, workOrderHash, sessionId, expiresAt: now() + approvalTtlMs, consumed: false })
    return value
  }
  /**
   * Consume a nonce. It is consumed on EVERY outcome (valid or not) so nothing is
   * replayable — a double-click's second request finds it already consumed.
   * @returns {{ ok:true }|{ ok:false, reason }}
   */
  function consumeNonce ({ nonce, approvalId, displayedHash, sessionId }) {
    if (typeof nonce !== 'string' || !nonce) return { ok: false, reason: 'nonce_missing' }
    const rec = nonces.get(nonce)
    if (!rec) return { ok: false, reason: 'nonce_unknown' }
    if (rec.consumed) return { ok: false, reason: 'nonce_already_used' }
    rec.consumed = true // consume FIRST, then judge — never replayable
    if (rec.expiresAt <= now()) return { ok: false, reason: 'nonce_expired' }
    if (rec.approvalId !== approvalId) return { ok: false, reason: 'nonce_approval_mismatch' }
    if (rec.workOrderHash !== displayedHash) return { ok: false, reason: 'nonce_hash_mismatch' }
    if (rec.sessionId !== sessionId) return { ok: false, reason: 'nonce_session_mismatch' }
    return { ok: true }
  }

  // ── Layer 2 results (READ-ONLY surface, write-once per approval) ───────────
  // What the runner reported for an approval, so the Owner can be shown what actually
  // happened. Write-once for the same reason a sealed order is: a result the Owner has
  // read must not be quietly replaced. Recording a result is NOT an authorization and
  // grants nothing — adopting a result will be its own gate when 香香 can touch the real
  // repo. Results outlive the approval TTL (an expired card's result is still evidence).
  const results = new Map() // approvalId -> { result, recordedAt }
  function recordResult (approvalId, result) {
    if (typeof approvalId !== 'string' || !approvalId) return { ok: false, reason: 'invalid_approval_id' }
    if (results.has(approvalId)) return { ok: false, reason: 'already_recorded' }
    results.set(approvalId, Object.freeze({ result: Object.freeze(result), recordedAt: now() }))
    return { ok: true }
  }
  function getResult (approvalId) {
    const rec = results.get(approvalId)
    return rec ? { ok: true, record: rec } : { ok: false, reason: 'no_result' }
  }

  function stats () { return { sealed: sealed.size, nonces: nonces.size, sessions: sessions.size, results: results.size } }

  return {
    createSession, validSession, seal, loadSealed, issueNonce, consumeNonce,
    recordResult, getResult, stats,
    APPROVAL_TTL_MS: approvalTtlMs, SESSION_TTL_MS: sessionTtlMs
  }
}

module.exports = { createOwnerApprovalStore, APPROVAL_TTL_MS, SESSION_TTL_MS }
