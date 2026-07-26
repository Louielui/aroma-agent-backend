'use strict'

/**
 * ownerApprovalRouter.js — the LOCAL Owner approval card surface.
 *
 *   POST /api/v1/owner/work-orders   — seal a candidate Work Order and surface it for
 *                                      review (returns the WYSIWYA view + a bound nonce)
 *   POST /api/v1/owner/approve       — the Owner's approval. Carries ONLY four fields.
 *
 * SECURITY BAR — every check below is REQUIRED and fail-closed:
 *   POST only (no GET/HEAD approval) · exact Origin http://127.0.0.1:8090 · exact Host
 *   127.0.0.1:8090 · the socket peer must be loopback · Sec-Fetch-Site: same-origin
 *   (ABSENT ⇒ refuse) · a valid server-created session cookie · a one-time nonce bound to
 *   (approvalId, displayedHash, sessionId), consumed on success OR failure · the typed
 *   confirmation verified SERVER-SIDE, exact match.
 * No CORS headers are ever set here. HUB_TOKEN is never read, never sent, never logged,
 * and the server never calls itself over HTTP.
 *
 * The browser supplies INTENT ONLY. The Work Order that executes is loaded from the sealed
 * store by approvalId — any workOrder / allowedFiles / caps / branch / forbiddenActions in
 * the request body is IGNORED and reported as rejected extra fields.
 */

const express = require('express')

const EXPECTED_ORIGIN = 'http://127.0.0.1:8090'
const EXPECTED_HOSTS = Object.freeze(['127.0.0.1:8090'])
const LOOPBACK = Object.freeze(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const TYPED_CONFIRMATION = 'EXECUTE'
const SESSION_COOKIE = 'aroma_owner_sid'
// Fields the browser must NEVER be able to influence. Their presence is a protocol error.
const FORBIDDEN_BODY_FIELDS = Object.freeze(['workOrder', 'allowedFiles', 'allowedFile', 'timeoutSec', 'costCapUsd', 'branch', 'forbiddenActions', 'allowedTestCommand', 'goal', 'approvedHash', 'approvedWorkOrderHash', 'who', 'owner'])

function readCookie (req, name) {
  const raw = req.headers && req.headers.cookie
  if (typeof raw !== 'string') return null
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
  }
  return null
}

/** All transport-level guards. Returns null when OK, else a refusal reason. */
function transportRefusal (req) {
  if (req.method !== 'POST') return 'method_not_allowed'
  const origin = req.headers.origin
  if (origin !== EXPECTED_ORIGIN) return 'bad_origin'
  const host = req.headers.host
  if (!EXPECTED_HOSTS.includes(host)) return 'bad_host'
  const peer = (req.socket && (req.socket.remoteAddress || '')) || ''
  if (!LOOPBACK.includes(peer)) return 'not_loopback'
  const sfs = req.headers['sec-fetch-site']
  if (sfs !== 'same-origin') return 'bad_sec_fetch_site' // absent ⇒ refuse
  return null
}

function createOwnerApprovalRouter (deps = {}) {
  const store = deps.store
  const confirmService = deps.confirmService
  const proposeWorkOrder = deps.proposeWorkOrder
  const buildApprovalView = deps.buildApprovalView
  const phaseLabel = deps.phaseLabel || (() => null)
  const buildAgentResultView = deps.buildAgentResultView || (() => ({ status: 'pending', headline: '', sections: [], lines: [] }))
  const sealedHashOf = deps.sealedHashOf
  const getProposal = typeof deps.getProposal === 'function' ? deps.getProposal : () => null
  const auditFn = typeof deps.auditFn === 'function' ? deps.auditFn : () => {}
  const router = express.Router()

  const refuse = (res, status, reason, approvalId, entryPoint) => {
    auditFn({ approvalId: approvalId || null, outcome: 'refused', reason, entryPoint })
    return res.status(status).json({ error: 'approval_refused', reason })
  }

  /** Issue/refresh the opaque session cookie. Loopback-only, httpOnly, SameSite=Strict. */
  function ensureSession (req, res) {
    let sid = readCookie(req, SESSION_COOKIE)
    if (!store.validSession(sid)) {
      sid = store.createSession()
      res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(store.SESSION_TTL_MS / 1000)}`)
    }
    return sid
  }

  // ── SEAL + SURFACE ────────────────────────────────────────────────────────
  // router.all, not router.post: a GET/HEAD/PUT must produce an EXPLICIT, audited
  // method refusal rather than falling through to the generic 404, so "POST only" is
  // an enforced property of this surface and not an accident of routing.
  router.all('/api/v1/owner/work-orders', (req, res) => {
    const bad = transportRefusal(req)
    if (bad) return refuse(res, 403, bad, null, 'owner_local')
    const sid = ensureSession(req, res)
    const b = req.body || {}

    // A Work Order only exists to execute an APPROVED Proposal. Bind it to a real,
    // still-pending Proposal HERE — refusing at seal time means no card is ever shown
    // for something that could not be confirmed anyway.
    const proposal = typeof b.proposalId === 'string' && b.proposalId ? getProposal(b.proposalId) : null
    if (!proposal) return refuse(res, 404, 'unknown_proposal', null, 'owner_local')
    if (proposal.status !== 'pending') return refuse(res, 409, 'proposal_not_pending', null, 'owner_local')

    // 香香 PROPOSES; the SYSTEM validates and seals. Candidate content only.
    // `intendedChange` is 香香's stated intent for the card's after-side; it is echoed
    // verbatim, labelled as intent, and grants nothing. The TTL that will actually be
    // enforced is passed in so the number the Owner reads on the card is the real one
    // (and is therefore inside the hash).
    const produced = proposeWorkOrder({
      proposal: {
        goal: b.goal,
        candidateFile: b.candidateFile,
        allowedTestCommand: b.allowedTestCommand,
        intendedChange: b.intendedChange
      },
      conversation: Array.isArray(b.conversation) ? b.conversation : [String(b.conversation || '')],
      defaults: { approvalTtlSec: Math.floor(store.APPROVAL_TTL_MS / 1000) }
    })
    if (!produced.ok) {
      auditFn({ approvalId: null, outcome: 'refused', reason: 'work_order_rejected', entryPoint: 'owner_local' })
      return res.status(422).json({ error: 'work_order_rejected', errors: produced.errors, reasonForOwner: produced.reasonForOwner })
    }

    const sealResult = store.seal({ workOrder: produced.workOrder, proposalId: proposal.id })
    if (!sealResult.ok) return refuse(res, 409, sealResult.reason, produced.workOrder.approvalId, 'owner_local')

    const view = buildApprovalView(sealResult.record.workOrder)
    const nonce = store.issueNonce({ approvalId: produced.workOrder.approvalId, workOrderHash: view.hash, sessionId: sid })
    auditFn({ approvalId: produced.workOrder.approvalId, outcome: 'sealed', reason: null, entryPoint: 'owner_local' })

    // The card gets the display + hash + nonce. Never HUB_TOKEN, never a secret.
    // `card` / `technical` are the v2 Owner-facing projection; both come from
    // buildApprovalView, i.e. from the canonical object the hash covers.
    return res.status(201).json({
      approvalId: produced.workOrder.approvalId,
      card: view.card,
      technicalLines: view.technicalLines,
      display: view.display,
      lines: view.lines,
      workOrderHash: view.hash,
      nonce,
      typedConfirmationRequired: TYPED_CONFIRMATION,
      expiresInSec: Math.floor(store.APPROVAL_TTL_MS / 1000)
    })
  })

  // ── LAYER 2: the result view (READ-ONLY) ──────────────────────────────────
  // A GET that reports what the runner returned for an approval. It changes nothing,
  // authorizes nothing, and consumes no nonce. Still loopback + same-origin bound so a
  // foreign page cannot read what happened. 404 `no_result` while nothing has run — with
  // AGENT_BRIDGE off that is the only answer this route can ever give.
  router.get('/api/v1/owner/results/:approvalId', (req, res) => {
    const peer = (req.socket && (req.socket.remoteAddress || '')) || ''
    if (!LOOPBACK.includes(peer)) return res.status(403).json({ error: 'approval_refused', reason: 'not_loopback' })
    const sfs = req.headers['sec-fetch-site']
    if (sfs !== undefined && sfs !== 'same-origin') return res.status(403).json({ error: 'approval_refused', reason: 'bad_sec_fetch_site' })

    const approvalId = req.params.approvalId
    const got = store.getResult(approvalId)
    const phases = typeof store.getPhases === 'function' ? store.getPhases(approvalId) : []
    const sealedRec = store.loadSealed(approvalId)
    const workOrder = sealedRec.ok ? sealedRec.record.workOrder : null

    // A hand-off that has started but not finished is REPORTED, not hidden behind a 404.
    // The old bare 404 is exactly why an approved run looked like nothing happened: the
    // page asked once, milliseconds after approving, and was told there was nothing.
    const running = !got.ok && phases.length > 0
    if (!got.ok && !running) return res.status(404).json({ error: 'no_result', approvalId, reason: got.reason })

    const view = buildAgentResultView({ approvalId, workOrder, result: got.ok ? got.record.result : null, running })
    const startedAt = phases.length ? phases[0].at : null
    return res.status(200).json({
      approvalId,
      status: view.status,
      headline: view.headline,
      sections: view.sections,
      lines: view.lines,
      // Progress: fixed phase NAMES + their labels + timestamps. Nothing else crosses.
      phases: phases.map((p) => ({ phase: p.phase, label: phaseLabel(p.phase), at: p.at })),
      currentPhase: phases.length ? phases[phases.length - 1].phase : null,
      startedAt,
      elapsedMs: startedAt == null ? null : (Date.now() - startedAt),
      capSec: workOrder && Number.isFinite(workOrder.timeoutSec) ? workOrder.timeoutSec : null,
      finished: got.ok
    })
  })

  // ── APPROVE (four fields only) ────────────────────────────────────────────
  // router.all for the same reason as above: a GET approval must be REFUSED explicitly.
  router.all('/api/v1/owner/approve', (req, res) => {
    const b = req.body || {}
    const approvalId = typeof b.approvalId === 'string' ? b.approvalId : null

    const bad = transportRefusal(req)
    if (bad) return refuse(res, 403, bad, approvalId, 'owner_local')

    // The browser may not supply ANY Work Order field. Presence is a protocol error, so a
    // tampered page fails loudly instead of silently having its values ignored.
    const extras = FORBIDDEN_BODY_FIELDS.filter((k) => Object.prototype.hasOwnProperty.call(b, k))
    if (extras.length) return refuse(res, 400, 'forbidden_body_fields', approvalId, 'owner_local')

    const sid = readCookie(req, SESSION_COOKIE)
    if (!store.validSession(sid)) return refuse(res, 403, 'no_session', approvalId, 'owner_local')

    // The nonce is consumed FIRST — every outcome burns it, so nothing is replayable.
    const n = store.consumeNonce({ nonce: b.nonce, approvalId, displayedHash: b.workOrderHash, sessionId: sid })
    if (!n.ok) return refuse(res, 403, n.reason, approvalId, 'owner_local')

    // Typed confirmation verified SERVER-SIDE (a browser-only check would be a misclick
    // guard, not a control).
    if (b.typedConfirmation !== TYPED_CONFIRMATION) return refuse(res, 400, 'typed_confirmation_mismatch', approvalId, 'owner_local')

    // AUTHORITY SOURCE: the sealed record, never the request.
    const loaded = store.loadSealed(approvalId)
    if (!loaded.ok) return refuse(res, 409, loaded.reason, approvalId, 'owner_local')
    const sealedOrder = loaded.record.workOrder

    // Recompute from the sealed order and compare with what the Owner was LOOKING at.
    const recomputed = sealedHashOf(sealedOrder)
    if (recomputed !== b.workOrderHash) return refuse(res, 409, 'displayed_hash_mismatch', approvalId, 'owner_local')

    // ONE shared domain service — no duplicated confirm logic, no self-HTTP, no HUB_TOKEN.
    let out
    try {
      out = confirmService.confirmProposalAction({
        proposalId: loaded.record.proposalId,
        agentExecute: true,
        workOrder: sealedOrder,
        approvedHash: recomputed,
        entryPoint: 'owner_local'
      })
    } catch (err) {
      return refuse(res, 400, 'confirm_failed', approvalId, 'owner_local')
    }
    auditFn({ approvalId, outcome: out.agentHandedOff ? 'approved' : 'approved_not_dispatched', reason: out.body.dispatchStatus, entryPoint: 'owner_local' })
    return res.status(out.status).json(out.body)
  })

  return router
}

module.exports = { createOwnerApprovalRouter, TYPED_CONFIRMATION, SESSION_COOKIE, FORBIDDEN_BODY_FIELDS, EXPECTED_ORIGIN, transportRefusal }
