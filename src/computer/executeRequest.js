'use strict'

/**
 * executeRequest.js — the ONE thing the Owner's side is allowed to hand across the boundary.
 *
 * ── WHY A REQUEST AND NOT A CALL ───────────────────────────────────────────
 * The Owner presses E in his own session, as himself. The canary must run as AromaOperator in
 * its own session. Nothing can bridge those two by calling a function: they are different
 * tokens, different desktops, different processes. So the Owner's side WRITES A REQUEST and
 * stops. Whether anything happens next is the Companion's decision, made with its own identity.
 *
 * ── THE SHAPE IS CLOSED, AND CARRIES NO INSTRUCTIONS ───────────────────────
 * A request contains BINDINGS ONLY — which approval, which order hash, which package hash, when
 * it dies. It carries no command, no text, no filename, no path, no arguments, no module name.
 * That is the whole point: if the request could describe the work, the Owner's side would be
 * choosing the work, and a compromised Owner path could choose different work. Instead the work
 * lives in the receipt, which the Companion reads for itself and re-verifies.
 *
 * A request is therefore NOT an authorisation. It is a pointer to one, plus an expiry.
 *
 * ── ONE CLAIM, EVER ────────────────────────────────────────────────────────
 * claim() is the single-writer transition. It succeeds once. A crash after claiming leaves the
 * request claimed and unusable — recovery is a new approval, never a resumed run, because a
 * request whose outcome nobody can evidence must not be retryable.
 */

const crypto = require('node:crypto')

/** Exactly these fields. An extra one is a refusal, not an ignored key. */
const REQUEST_FIELDS = Object.freeze([
  'kind', 'requestId', 'approvalId', 'approvedOrderHash', 'executionPackageManifestHash',
  'receiptSha256', 'canaryType', 'canaryVersion', 'createdAt', 'expiresAt'
])

const KIND = 'canary-execute-request'
const CANARY_TYPE = 'notepad-canary'
const CANARY_VERSION = 1

/** Short on purpose: a request is a doorbell, not a standing invitation. */
const DEFAULT_TTL_MS = 10 * 60 * 1000

/** The states a request can be in. There is no path back to 'pending'. */
const STATES = Object.freeze(['pending', 'claimed', 'completed', 'failed', 'expired'])

const no = (refusal, reason, detail) => ({ ok: false, refusal, reason, detail: detail || null })

/**
 * Build a request. Called ONLY on the Owner's side, from a verified receipt — never from the
 * draft, and never from anything a caller passes in.
 */
function buildRequest (receipt, opts = {}) {
  if (!receipt || !receipt.approvalId) throw new Error('a request must be built from a verified receipt')
  const now = opts.now ? opts.now() : Date.now()
  const req = {
    kind: KIND,
    requestId: opts.requestId || 'req_' + crypto.randomBytes(12).toString('hex'),
    approvalId: receipt.approvalId,
    approvedOrderHash: receipt.workOrderHash,
    executionPackageManifestHash: receipt.executionPackageManifestHash,
    receiptSha256: opts.receiptSha256 || null,
    canaryType: CANARY_TYPE,
    canaryVersion: CANARY_VERSION,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + (opts.ttlMs || DEFAULT_TTL_MS)).toISOString()
  }
  // Frozen at birth. The Owner's side cannot revise a request after writing it, and neither can
  // anything downstream — a mutable request is a request that can be edited between the writing
  // and the reading.
  return Object.freeze(req)
}

/** Static shape check. No I/O, no state. */
function validateRequest (req) {
  if (!req || typeof req !== 'object') return no('no_request', 'nothing was submitted')
  if (req.kind !== KIND) return no('bad_request', 'not a canary execute request')

  for (const k of Object.keys(req)) {
    if (!REQUEST_FIELDS.includes(k)) {
      // An extra field is how instructions smuggle themselves in: a `text`, a `path`, a
      // `command`. There is no shape in which one is tolerated.
      return no('unexpected_field', 'a request may carry bindings only', k)
    }
  }
  for (const k of REQUEST_FIELDS) {
    if (req[k] === undefined || (req[k] === null && k !== 'receiptSha256')) {
      return no('incomplete_request', 'a binding is missing', k)
    }
  }
  if (req.canaryType !== CANARY_TYPE) return no('wrong_canary_type', 'not this canary', String(req.canaryType))
  if (req.canaryVersion !== CANARY_VERSION) return no('wrong_canary_version', 'built for a different version', String(req.canaryVersion))
  if (!/^req_[0-9a-f]{24}$/.test(String(req.requestId))) return no('bad_request_id', 'malformed request id')
  if (!/^appr_[0-9a-f]{32}$/.test(String(req.approvalId))) return no('bad_approval_id', 'malformed approval id')
  for (const h of ['approvedOrderHash', 'executionPackageManifestHash']) {
    if (!/^[0-9a-f]{64}$/.test(String(req[h]))) return no('bad_hash', 'malformed hash', h)
  }
  return { ok: true }
}

/**
 * The Companion's check: is this request usable, and does it point at THIS receipt and THIS
 * package? A request that merely looks well-formed authorises nothing.
 */
function verifyRequest (req, ctx = {}) {
  const shape = validateRequest(req)
  if (!shape.ok) return shape

  const now = ctx.now ? ctx.now() : Date.now()
  const expires = Date.parse(req.expiresAt)
  const created = Date.parse(req.createdAt)
  if (!(created <= now)) return no('request_from_the_future', 'created after now — clocks disagree')
  if (!(now < expires)) return no('request_expired', 'this request is too old to use', req.expiresAt)

  if (ctx.receipt) {
    if (req.approvalId !== ctx.receipt.approvalId) return no('approval_mismatch', 'the request points at a different approval')
    if (req.approvedOrderHash !== ctx.receipt.workOrderHash) return no('order_hash_mismatch', 'the approved order is not the one in the receipt')
    if (req.executionPackageManifestHash !== ctx.receipt.executionPackageManifestHash) {
      return no('package_hash_mismatch', 'the request was made against a different execution package')
    }
    if (req.receiptSha256 && ctx.receiptSha256 && req.receiptSha256 !== ctx.receiptSha256) {
      return no('receipt_mismatch', 'the receipt on disk is not the one the request was made from')
    }
  }
  if (ctx.currentPackageHash && req.executionPackageManifestHash !== ctx.currentPackageHash) {
    return no('package_hash_mismatch', 'the code on disk is not the code this request was made against')
  }
  return { ok: true }
}

/**
 * The claim ledger. Single-writer, one-way.
 *
 * `store` is injected so the durable form can be a file, and tests can be a Map — but the
 * TRANSITION RULES live here, once, so a file-backed store cannot quietly disagree with an
 * in-memory one about what "already claimed" means.
 */
function createRequestLedger (deps = {}) {
  const store = deps.store || new Map()
  const now = () => (deps.now ? deps.now() : Date.now())

  const read = (id) => (store.get ? store.get(id) : store.read(id)) || null
  const write = (id, rec) => (store.set ? store.set(id, rec) : store.write(id, rec))

  return {
    /** Record a pending request. Refused if the id was ever seen — ids are not reusable. */
    submit (req) {
      const v = validateRequest(req)
      if (!v.ok) return v
      if (read(req.requestId)) return no('request_already_exists', 'this request id has been used')
      write(req.requestId, { state: 'pending', request: req, submittedAt: new Date(now()).toISOString() })
      return { ok: true, state: 'pending' }
    },

    /**
     * Take the request. Exactly one caller can succeed, and a claim is irreversible: a crash
     * after this point leaves it claimed and dead, which is correct — nobody can evidence what
     * a crashed run did, so nobody may retry it.
     */
    claim (requestId, by) {
      const rec = read(requestId)
      if (!rec) return no('unknown_request', 'no such request')
      if (rec.state !== 'pending') return no('request_already_' + rec.state, 'a request may be claimed once', rec.state)
      const expires = Date.parse(rec.request.expiresAt)
      if (!(now() < expires)) {
        write(requestId, Object.assign({}, rec, { state: 'expired', expiredAt: new Date(now()).toISOString() }))
        return no('request_expired', 'it expired before it was claimed')
      }
      write(requestId, Object.assign({}, rec, { state: 'claimed', claimedBy: by || null, claimedAt: new Date(now()).toISOString() }))
      return { ok: true, request: rec.request }
    },

    /** Terminal. Both outcomes consume the request; neither reopens it. */
    settle (requestId, outcome) {
      const rec = read(requestId)
      if (!rec) return no('unknown_request', 'no such request')
      if (rec.state !== 'claimed') return no('not_claimed', 'only a claimed request can be settled', rec.state)
      const state = outcome && outcome.ok ? 'completed' : 'failed'
      write(requestId, Object.assign({}, rec, { state, outcome: outcome || null, settledAt: new Date(now()).toISOString() }))
      return { ok: true, state }
    },

    stateOf (requestId) { const r = read(requestId); return r ? r.state : null },
    recordOf (requestId) { return read(requestId) }
  }
}

module.exports = {
  buildRequest, validateRequest, verifyRequest, createRequestLedger,
  REQUEST_FIELDS, KIND, CANARY_TYPE, CANARY_VERSION, STATES, DEFAULT_TTL_MS
}
