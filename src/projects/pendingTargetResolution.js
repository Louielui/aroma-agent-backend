'use strict'

/**
 * pendingTargetResolution.js — THE SERVER REMEMBERS THE CHOICES; THE BROWSER RETURNS A TICKET.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY THIS EXISTS AT ALL. When the Owner is shown two files or two pages to choose between,
 * something has to carry 「he picked the first one」 back to the server. The obvious way — send
 * the path — hands target selection to the browser, and the whole chain from work request to
 * sealed Work Order exists to prevent exactly that. So the candidates stay HERE, and the page
 * gets an opaque ticket that means nothing anywhere else.
 *
 * ⛔ A TICKET IS NOT A CREDENTIAL. resolutionId and candidateId authorise nothing on their own:
 * a selection is accepted only when the Owner's own login session and the conversation match
 * too, and even then the server re-reads the target from the current catalogue rather than
 * trusting the snapshot the browser was shown. Approval nonces are a different thing entirely —
 * they mean 「execute this approved Work Order」 — and are deliberately not reused here.
 *
 * ⛔ MEMORY ONLY, AND THAT IS THE RIGHT DURABILITY. This is a choice in a conversation, not an
 * authorisation: it should not survive a restart, should not reach disk, and should expire on
 * its own. Anything longer-lived would let a stale card complete a request the Owner made much
 * later.
 *
 * ⛔ ONE ABSTRACTION FOR BOTH KINDS. A trusted registry target and an explicitly-named file are
 * the same shape of question — 「which of these did you mean?」 — so they share one store, one
 * ticket format and one set of checks. Two mechanisms would mean two places to forget a check.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const crypto = require('node:crypto')

/** Closed. What a candidate stands for. */
const KIND = Object.freeze({
  TARGET: 'target',
  FILE: 'file'
})

/** Closed. Why a selection was refused, or that it worked. Log-safe: no content, ever. */
const OUTCOME = Object.freeze({
  SELECTED: 'selected',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  CONSUMED: 'consumed',
  SUPERSEDED: 'superseded',
  UNKNOWN: 'unknown',
  WRONG_SESSION: 'wrong_session',
  WRONG_CONVERSATION: 'wrong_conversation',
  INVALID: 'invalid'
})

const DEFAULT_TTL_MS = 10 * 60 * 1000

/**
 * @param {{ ttlMs?:number, now?:function, newId?:function }} [options] injection seam for tests
 */
function createPendingTargetResolutions (options = {}) {
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : DEFAULT_TTL_MS
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  // Opaque and unguessable. Not an array index, not a path, not a targetId: a selection
  // identifier that carries meaning is one a caller can forge or reason about.
  const newId = typeof options.newId === 'function' ? options.newId : () => crypto.randomBytes(18).toString('base64url')

  const byId = new Map()

  const isLive = (r) => r.state === 'pending' && r.expiresAt > now()

  /**
   * ⛔ A NEW REQUEST RETIRES THE OLD ONE. Without this, a card left on screen from a request
   * two minutes ago could still be pressed and would complete — against the ORIGINAL message
   * stored with it, not the one the Owner has since typed. The stale button must fail closed,
   * so every new turn in the same session+conversation supersedes what came before.
   */
  function supersede (ownerSessionId, conversationId) {
    let n = 0
    for (const r of byId.values()) {
      if (r.state === 'pending' && r.ownerSessionId === ownerSessionId && r.conversationId === conversationId) {
        r.state = 'superseded'
        n++
      }
    }
    return n
  }

  /**
   * @param {{ownerSessionId, conversationId, originalOwnerMessage, originalIntent, source,
   *          candidates: Array<{kind, targetId?, file?}>}} input
   * @returns {{resolutionId, expiresAt, candidates: Array<{candidateId, kind, targetId?, file?}>}}
   */
  function create (input) {
    const ownerSessionId = String(input.ownerSessionId || '')
    const conversationId = String(input.conversationId || '')
    if (ownerSessionId === '' || conversationId === '') throw new TypeError('a pending resolution must be bound to an Owner session and a conversation')
    const list = Array.isArray(input.candidates) ? input.candidates : []
    if (list.length === 0) throw new TypeError('a pending resolution needs candidates')

    supersede(ownerSessionId, conversationId)

    const resolutionId = newId()
    const candidates = list.map((c) => {
      const rec = { candidateId: newId(), kind: c.kind }
      if (c.kind === KIND.TARGET) rec.targetId = c.targetId
      else if (c.kind === KIND.FILE) rec.file = c.file
      else throw new TypeError('unknown candidate kind: ' + String(c.kind))
      return rec
    })

    byId.set(resolutionId, {
      resolutionId,
      ownerSessionId,
      conversationId,
      // The Owner's OWN words, kept server-side so completion never depends on the browser
      // reconstructing a sentence. See the selection path.
      originalOwnerMessage: String(input.originalOwnerMessage || ''),
      originalIntent: String(input.originalIntent || ''),
      source: input.source || null,
      candidates,
      state: 'pending',
      createdAt: now(),
      expiresAt: now() + ttlMs
    })

    return { resolutionId, expiresAt: now() + ttlMs, candidates: candidates.map((c) => Object.assign({}, c)) }
  }

  /**
   * ⛔ ALL THREE MUST MATCH, AND THE ORDER OF CHECKS IS THE ORDER OF HONESTY. An unknown ticket,
   * a different Owner session, a different conversation, an expired or already-used
   * resolution: each gets its own outcome so a refusal says which rule stopped it.
   *
   * conversationId alone is NOT authentication — the browser mints it. The Owner's login
   * session is what proves who is asking.
   */
  function select ({ resolutionId, ownerSessionId, conversationId, candidateId }) {
    const r = byId.get(String(resolutionId || ''))
    if (!r) return { ok: false, outcome: OUTCOME.UNKNOWN }
    if (r.ownerSessionId !== String(ownerSessionId || '')) return { ok: false, outcome: OUTCOME.WRONG_SESSION }
    if (r.conversationId !== String(conversationId || '')) return { ok: false, outcome: OUTCOME.WRONG_CONVERSATION }
    if (r.state === 'superseded') return { ok: false, outcome: OUTCOME.SUPERSEDED }
    if (r.state === 'consumed' || r.state === 'cancelled') return { ok: false, outcome: OUTCOME.CONSUMED }
    if (!isLive(r)) return { ok: false, outcome: OUTCOME.EXPIRED }

    const candidate = r.candidates.find((c) => c.candidateId === String(candidateId || ''))
    // ⛔ MEMBERSHIP IS THE WHOLE POINT. A candidateId that was never in THIS set is not a
    //    choice, it is a guess — and the value it would map to is not one the Owner was shown.
    if (!candidate) return { ok: false, outcome: OUTCOME.INVALID }

    r.state = 'consumed'
    return {
      ok: true,
      outcome: OUTCOME.SELECTED,
      candidate: Object.assign({}, candidate),
      originalOwnerMessage: r.originalOwnerMessage,
      originalIntent: r.originalIntent
    }
  }

  /** The Owner changed his mind. One-time, same bindings, nothing created. */
  function cancel ({ resolutionId, ownerSessionId, conversationId }) {
    const r = byId.get(String(resolutionId || ''))
    if (!r) return { ok: false, outcome: OUTCOME.UNKNOWN }
    if (r.ownerSessionId !== String(ownerSessionId || '')) return { ok: false, outcome: OUTCOME.WRONG_SESSION }
    if (r.conversationId !== String(conversationId || '')) return { ok: false, outcome: OUTCOME.WRONG_CONVERSATION }
    if (r.state !== 'pending') return { ok: false, outcome: r.state === 'superseded' ? OUTCOME.SUPERSEDED : OUTCOME.CONSUMED }
    r.state = 'cancelled'
    return { ok: true, outcome: OUTCOME.CANCELLED }
  }

  /** Test/diagnostic visibility only — never used to make a decision. */
  function size () { return byId.size }
  function stateOf (resolutionId) { const r = byId.get(String(resolutionId || '')); return r ? r.state : null }

  return { create, select, cancel, supersede, size, stateOf, TTL_MS: ttlMs }
}

module.exports = { createPendingTargetResolutions, KIND, OUTCOME, DEFAULT_TTL_MS }
