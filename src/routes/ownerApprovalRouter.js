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

/**
 * THE READ-SIDE TRANSPORT CHECK.
 *
 * transportRefusal() opens by refusing any method that is not POST, because it was written
 * for a surface
 * that only writes. Reusing it on a GET refuses every request — my first version of the
 * execution-state route 403d on every call, which would have made an observability route
 * observably nothing.
 *
 * WHAT IS KEPT: the peer must be loopback, and the Host must be one this service answers
 * to. Those are the actual protection, and they are the same rules.
 *
 * WHAT IS DROPPED, AND WHY: Origin and Sec-Fetch-Site. Both exist only on
 * BROWSER-originated requests, and requiring them would mean the Owner could not ask this
 * question from a terminal — which is the situation the route exists to end. They defend
 * against cross-site WRITES; this returns one boolean and changes nothing, so there is
 * nothing to forge.
 *
 * RESIDUAL EXPOSURE, stated rather than waved away: a page open in a browser on this
 * machine could read it. What it would learn is whether agent execution writes an audit
 * record. No path, no token, no state.
 *
 * transportRefusal itself is UNTOUCHED — a test pins that the write surface still refuses
 * anything that is not a POST.
 */
function readTransportRefusal (req) {
  if (req.method !== 'GET') return 'method_not_allowed'
  const host = req.headers.host
  if (!EXPECTED_HOSTS.includes(host)) return 'bad_host'
  const peer = (req.socket && (req.socket.remoteAddress || '')) || ''
  if (!LOOPBACK.includes(peer)) return 'not_loopback'
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
  // The proposal store's own mutator, injected — this router never reaches into the store.
  const cancelProposalFn = typeof deps.cancelProposal === 'function' ? deps.cancelProposal : () => { throw new Error('cancelProposal not injected') }
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

  // ── THE GATE, OBSERVABLE FROM THE PROCESS THAT IS ACTUALLY RUNNING ────────
  //
  // After the first canary the audit store was not wired in real assembly, the one real
  // execution left no record, and the defect was invisible because the only way to check
  // was to READ app.js — where it looked correct. The execution gate is open today, and
  // its last cell could still only be checked that way.
  //
  // AN ENDPOINT, NOT A STARTUP LOG LINE. A log line survives a restart but is a
  // point-in-time claim in a file that rotates; it says what was true at boot, not what is
  // true now. This can be asked at any moment.
  //
  // CANNOT DRIFT is a property of WHAT is read, not of the shape. It FORWARDS a value the
  // composition root already computed from the runner's own answer — it never recomputes
  // the question, which is the thing that drifts. A test fails if this handler derives
  // anything itself.
  //
  // NULL IS NOT FALSE. 「nothing was constructed」 and 「it was constructed without an audit」
  // are different states and collapsing them is the fault this exists to prevent.
  //
  // IT LIVES HERE, NOT ON THE CHAT SURFACE. The first version sat in demoRouter and turned
  // the bridge-isolation invariant red — demo/context/intake must remain unaware of the
  // bridge. That invariant is right, so the route moved to the surface that already owns
  // approval and execution, rather than the invariant being weakened to fit it.
  //
  // MEASUREMENT, NOT REPAIR: it changes no execution behaviour and fixes nothing. Read-only,
  // GET-only, and behind the same loopback + owner-session transport check as its siblings.
  router.get('/api/v1/owner/execution-state', (req, res) => {
    const bad = readTransportRefusal(req)
    if (bad) return refuse(res, 403, bad, null, 'owner_local')
    ensureSession(req, res)
    const v = (req.app || {}).agentAuditConfigured
    res.json({ agentAuditConfigured: typeof v === 'boolean' ? v : null })
  })

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

    // 心燈 PROPOSES; the SYSTEM validates and seals. Candidate content only.
    // `intendedChange` is 心燈's stated intent for the card's after-side; it is echoed
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
    const exec = typeof store.getExecution === 'function' ? store.getExecution(approvalId) : { ok: false }

    // A hand-off that has started but not finished is REPORTED, not hidden behind a 404.
    // The old bare 404 is exactly why an approved run looked like nothing happened: the
    // page asked once, milliseconds after approving, and was told there was nothing.
    const running = !got.ok && phases.length > 0
    if (!got.ok && !running) return res.status(404).json({ error: 'no_result', approvalId, reason: got.reason })

    // FACTS COME FROM THE SNAPSHOT taken at hand-off — never from the sealed order, which
    // expires after 10 minutes and used to make a finished, in-scope run read as
    // 「越界…這份結果不應採用」 with caps of US$0.00 / null once it had.
    const facts = got.ok ? got.record.facts : (exec.ok ? exec.record.facts : null)
    const startedAt = got.ok ? got.record.startedAt : (exec.ok ? exec.record.startedAt : (phases.length ? phases[0].at : null))
    // A FINISHED run reports its MEASURED duration, recorded once at completion. Only a
    // run still in flight is measured against the clock.
    const durationMs = got.ok
      ? got.record.durationMs
      : (startedAt == null ? null : (Date.now() - startedAt))

    const view = buildAgentResultView({
      approvalId,
      facts,
      durationMs: got.ok ? durationMs : undefined,
      result: got.ok ? got.record.result : null,
      running
    })
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
      elapsedMs: durationMs,
      capSec: facts && Number.isFinite(facts.timeoutSec) ? facts.timeoutSec : null,
      finished: got.ok
    })
  })

  // ── REJECT ────────────────────────────────────────────────────────────────
  //
  // The 拒絕 button used to disable three controls and print 「你拒絕了這張工作單。甚麼都沒
  // 有執行。」 — and call nothing. The second sentence was true. The FIRST was not recorded
  // anywhere: no request, no cancel, no audit line. The sealed order and its nonce expire on
  // their own after APPROVAL_TTL_MS, but the PROPOSAL stayed pending forever. Three such
  // proposals were sitting in the live store when this was written, the oldest from
  // 2026-07-24.
  //
  // Owner ruling, 2026-08-05: 「A reject button that only greys out the screen while the
  // proposal stays pending forever is a lie about a governance action, and it is the same
  // class as everything else this week: the record and the reality disagreeing.」
  //
  // AUTHORITY SOURCE IS THE SEALED RECORD. The proposalId is read from the record the
  // approvalId identifies, NEVER from the request body — otherwise reject becomes a way to
  // cancel any proposal by id.
  //
  // The nonce is consumed exactly as approve consumes it, so a rejection is not replayable
  // and cannot be followed by an approval of the same card.
  router.all('/api/v1/owner/reject', (req, res) => {
    const b = req.body || {}
    const approvalId = typeof b.approvalId === 'string' ? b.approvalId : null

    const bad = transportRefusal(req)
    if (bad) return refuse(res, 403, bad, approvalId, 'owner_local')

    const extras = FORBIDDEN_BODY_FIELDS.filter((k) => Object.prototype.hasOwnProperty.call(b, k))
    if (extras.length) return refuse(res, 400, 'forbidden_body_fields', approvalId, 'owner_local')

    const sid = readCookie(req, SESSION_COOKIE)
    if (!store.validSession(sid)) return refuse(res, 403, 'no_session', approvalId, 'owner_local')

    const n = store.consumeNonce({ nonce: b.nonce, approvalId, displayedHash: b.workOrderHash, sessionId: sid })
    if (!n.ok) return refuse(res, 403, n.reason, approvalId, 'owner_local')

    const loaded = store.loadSealed(approvalId)
    if (!loaded.ok) return refuse(res, 409, loaded.reason, approvalId, 'owner_local')

    // NOTHING RAN, AND NOW THAT IS RECORDED. cancelProposal is the store's own mutator; a
    // failure to cancel is reported rather than swallowed, because a rejection the Owner
    // believes happened and the record does not is the exact fault being fixed.
    let cancelled = null
    try {
      cancelled = cancelProposalFn(loaded.record.proposalId)
    } catch (err) {
      auditFn({ approvalId, outcome: 'refused', reason: 'cancel_failed', entryPoint: 'owner_local' })
      return res.status(409).json({ error: 'reject_failed', reason: 'cancel_failed' })
    }

    auditFn({ approvalId, outcome: 'rejected', reason: 'owner_rejected', entryPoint: 'owner_local', proposalId: loaded.record.proposalId, workOrderHash: loaded.record.workOrderHash || null })
    return res.status(200).json({
      ok: true,
      approvalId,
      proposalId: loaded.record.proposalId,
      proposalStatus: (cancelled && cancelled.status) || 'cancelled'
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
    // The HASH travels with the decision — the old audit line carried ids and enums but
    // never said WHICH work order was approved. It is the recomputed one, so the record
    // names exactly what the Owner was looking at.
    auditFn({ approvalId, outcome: out.agentHandedOff ? 'approved' : 'approved_not_dispatched', reason: out.body.dispatchStatus, entryPoint: 'owner_local', proposalId: loaded.record.proposalId, workOrderHash: recomputed })
    return res.status(out.status).json(out.body)
  })

  return router
}

module.exports = { createOwnerApprovalRouter, TYPED_CONFIRMATION, SESSION_COOKIE, FORBIDDEN_BODY_FIELDS, EXPECTED_ORIGIN, transportRefusal }
