'use strict'

/**
 * executeRequestStore.js — durable requests, written atomically, claimed exactly once.
 *
 * ── WHY ATOMIC MATTERS HERE ────────────────────────────────────────────────
 * The Owner writes a request in one process; a Companion in another session reads it. There is
 * no lock between them and no shared memory — only the filesystem. So a partially-written file
 * is not a theoretical concern: a reader can genuinely observe half a request, and half a
 * request that happens to parse is worse than one that does not.
 *
 * Write to a temp name, flush to disk, then rename. Rename within a directory is atomic on
 * NTFS, so a reader sees the whole request or no request. Never an intermediate.
 *
 * ── WHY THE CLAIM IS A RENAME AND NOT A FLAG ───────────────────────────────
 * "Read the state, decide, write the new state" has a window between the read and the write
 * where a second Companion can do the same. Both would see `pending`, both would proceed, and
 * two runs would fight over one desktop.
 *
 * `fs.renameSync` cannot half-succeed and cannot succeed twice: the file is either still at the
 * pending name or it is not. The loser gets ENOENT and loses cleanly. The mutual exclusion is
 * the filesystem's, not ours, which is the only kind worth trusting across processes.
 *
 * ── ONE-WAY, ALWAYS ────────────────────────────────────────────────────────
 * CREATED -> CLAIMED -> RUNNING -> SUCCEEDED | FAILED | ABORTED, plus EXPIRED from the
 * unclaimed states. Nothing returns to CREATED. A crashed run leaves a claimed request that
 * stays claimed — recovery is a new approval, because nobody can evidence what a crashed run
 * did and a retry would be a guess dressed as a recovery.
 */

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const SCHEMA_VERSION = 1
const MESSAGE_TYPE = 'computer.canary.execute.v1'
const CANARY_TYPE = 'notepad-canary'

/** Exactly these fields. An extra one is a refusal — that is how an instruction would arrive. */
const REQUEST_FIELDS = Object.freeze([
  'schemaVersion', 'messageType', 'requestId', 'approvalId', 'approvedOrderHash',
  'executionPackageManifestHash', 'receiptHash', 'canaryType', 'createdAt', 'expiresAt'
])

/** Names that must NEVER appear, however the schema grows. Checked by name, not by shape. */
const FORBIDDEN_FIELDS = Object.freeze([
  'actions', 'action', 'text', 'fileName', 'filename', 'path', 'targetPath', 'command',
  'executable', 'exe', 'scriptPath', 'script', 'args', 'arguments', 'module', 'moduleName',
  'adapter', 'adapterName', 'env', 'environment', 'powershell', 'ps', 'payload'
])

const STATES = Object.freeze(['CREATED', 'CLAIMED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'ABORTED', 'EXPIRED'])
const TERMINAL = Object.freeze(['SUCCEEDED', 'FAILED', 'ABORTED', 'EXPIRED'])

/** Legal transitions. Absent from this table means impossible, not merely discouraged. */
const TRANSITIONS = Object.freeze({
  CREATED: Object.freeze(['CLAIMED', 'EXPIRED']),
  CLAIMED: Object.freeze(['RUNNING', 'FAILED', 'ABORTED']),
  RUNNING: Object.freeze(['SUCCEEDED', 'FAILED', 'ABORTED']),
  SUCCEEDED: Object.freeze([]),
  FAILED: Object.freeze([]),
  ABORTED: Object.freeze([]),
  EXPIRED: Object.freeze([])
})

const DEFAULT_TTL_MS = 10 * 60 * 1000

const no = (refusal, reason, detail) => ({ ok: false, refusal, reason, detail: detail === undefined ? null : detail })

/** Build from a VERIFIED receipt and nothing else. */
function buildRequest (receipt, opts = {}) {
  if (!receipt || !receipt.approvalId) throw new Error('a request may only be built from a verified receipt')
  if (!receipt.workOrderHash || !receipt.executionPackageManifestHash) {
    throw new Error('the receipt is missing its bindings')
  }
  const now = opts.now ? opts.now() : Date.now()
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    messageType: MESSAGE_TYPE,
    requestId: opts.requestId || 'req_' + crypto.randomBytes(12).toString('hex'),
    approvalId: receipt.approvalId,
    approvedOrderHash: receipt.workOrderHash,
    executionPackageManifestHash: receipt.executionPackageManifestHash,
    receiptHash: opts.receiptHash || receipt.receiptHash || null,
    canaryType: CANARY_TYPE,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + (opts.ttlMs || DEFAULT_TTL_MS)).toISOString()
  })
}

function validateRequest (req) {
  if (!req || typeof req !== 'object') return no('no_request', 'nothing was submitted')
  if (req.messageType !== MESSAGE_TYPE) return no('unknown_message_type', 'not a canary execute request', String(req.messageType))
  if (req.schemaVersion !== SCHEMA_VERSION) return no('wrong_schema_version', 'built for a different schema', String(req.schemaVersion))

  for (const k of Object.keys(req)) {
    if (FORBIDDEN_FIELDS.includes(k)) return no('forbidden_field', 'a request may never carry instructions', k)
    if (!REQUEST_FIELDS.includes(k)) return no('unexpected_field', 'a request carries bindings only', k)
  }
  for (const k of REQUEST_FIELDS) {
    if (req[k] === undefined) return no('missing_field', 'a binding is absent', k)
    if (req[k] === null && k !== 'receiptHash') return no('missing_field', 'a binding is null', k)
  }
  if (req.canaryType !== CANARY_TYPE) return no('wrong_canary_type', 'not this canary', String(req.canaryType))
  if (!/^req_[0-9a-f]{24}$/.test(String(req.requestId))) return no('bad_request_id', 'malformed request id')
  if (!/^appr_[0-9a-f]{32}$/.test(String(req.approvalId))) return no('bad_approval_id', 'malformed approval id')
  for (const h of ['approvedOrderHash', 'executionPackageManifestHash']) {
    if (!/^[0-9a-f]{64}$/.test(String(req[h]))) return no('bad_hash', 'malformed hash', h)
  }
  if (!Number.isFinite(Date.parse(req.createdAt)) || !Number.isFinite(Date.parse(req.expiresAt))) {
    return no('bad_timestamps', 'createdAt or expiresAt is not a time')
  }
  if (Date.parse(req.expiresAt) <= Date.parse(req.createdAt)) return no('bad_timestamps', 'it expires before it exists')
  return { ok: true }
}

/**
 * The Companion's check. A well-formed request authorises NOTHING on its own — it points at an
 * approval, and the approval still has to be verified independently.
 */
function verifyAgainst (req, ctx = {}) {
  const shape = validateRequest(req)
  if (!shape.ok) return shape
  const now = ctx.now ? ctx.now() : Date.now()
  if (Date.parse(req.createdAt) > now + 60000) return no('request_from_the_future', 'clocks disagree')
  if (now >= Date.parse(req.expiresAt)) return no('request_expired', 'too old to use', req.expiresAt)

  if (ctx.receipt) {
    if (req.approvalId !== ctx.receipt.approvalId) return no('approval_mismatch', 'points at a different approval')
    if (req.approvedOrderHash !== ctx.receipt.workOrderHash) return no('order_hash_mismatch', 'not the approved order')
    if (req.executionPackageManifestHash !== ctx.receipt.executionPackageManifestHash) {
      return no('package_hash_mismatch', 'made against a different execution package')
    }
    if (req.receiptHash && ctx.receipt.receiptHash && req.receiptHash !== ctx.receipt.receiptHash) {
      return no('receipt_mismatch', 'the receipt on disk is not the one this was made from')
    }
  }
  if (ctx.currentPackageHash && req.executionPackageManifestHash !== ctx.currentPackageHash) {
    return no('package_hash_mismatch', 'the code on disk is not the code this was made against')
  }
  return { ok: true }
}

/**
 * Durable store. `dir` holds one file per request; the FILENAME carries the state, so the claim
 * is a rename and mutual exclusion belongs to the filesystem.
 */
function createRequestStore (deps = {}) {
  const dir = deps.dir
  if (!dir) throw new Error('a request store needs a directory')
  const now = () => (deps.now ? deps.now() : Date.now())
  const fsx = deps.fs || fs

  const nameFor = (state, id) => path.join(dir, state + '__' + id + '.json')
  const ensure = () => fsx.mkdirSync(dir, { recursive: true })

  function findFile (requestId) {
    ensure()
    for (const state of STATES) {
      const p = nameFor(state, requestId)
      if (fsx.existsSync(p)) return { state, file: p }
    }
    return null
  }

  function readRecord (file) {
    try { return JSON.parse(fsx.readFileSync(file, 'utf8')) } catch (_) { return null }
  }

  /** temp write -> flush -> atomic rename. A reader sees all of it or none of it. */
  function writeAtomic (target, record) {
    ensure()
    const tmp = target + '.tmp-' + crypto.randomBytes(6).toString('hex')
    const fd = fsx.openSync(tmp, 'wx')
    try {
      fsx.writeFileSync(fd, JSON.stringify(record, null, 2) + '\n', 'utf8')
      try { fsx.fsyncSync(fd) } catch (_) { /* a store without fsync is still atomic on rename */ }
    } finally { fsx.closeSync(fd) }
    fsx.renameSync(tmp, target)
  }

  return {
    STATES,
    TRANSITIONS,

    /** One live request per approval, and per id. Both are refusals, not overwrites. */
    submit (req) {
      const v = validateRequest(req)
      if (!v.ok) return v
      ensure()
      if (findFile(req.requestId)) return no('duplicate_request_id', 'this request id has been used')

      for (const f of fsx.readdirSync(dir)) {
        if (!f.endsWith('.json')) continue
        const rec = readRecord(path.join(dir, f))
        if (!rec || !rec.request) continue
        if (rec.request.approvalId !== req.approvalId) continue
        const state = f.split('__')[0]
        if (!TERMINAL.includes(state)) {
          return no('approval_already_live', 'this approval already has a live request', rec.request.requestId)
        }
        return no('approval_already_used', 'this approval has already been through a request', state)
      }

      writeAtomic(nameFor('CREATED', req.requestId), { state: 'CREATED', request: req, createdAt: new Date(now()).toISOString() })
      return { ok: true, state: 'CREATED' }
    },

    /**
     * THE ATOMIC CLAIM. Rename cannot half-succeed and cannot succeed twice, so two Companions
     * racing produce exactly one winner and one clean ENOENT.
     */
    claim (requestId, by) {
      const found = findFile(requestId)
      if (!found) return no('unknown_request', 'no such request')
      if (found.state !== 'CREATED') return no('request_already_' + found.state.toLowerCase(), 'a request is claimed once', found.state)

      const rec = readRecord(found.file)
      if (!rec || !rec.request) return no('unreadable_request', 'the request could not be read')
      if (now() >= Date.parse(rec.request.expiresAt)) {
        try { fsx.renameSync(found.file, nameFor('EXPIRED', requestId)) } catch (_) { }
        return no('request_expired', 'it expired before it was claimed')
      }

      const target = nameFor('CLAIMED', requestId)
      try {
        fsx.renameSync(found.file, target)
      } catch (e) {
        // Lost the race, or it moved underneath us. Either way somebody else owns it now.
        return no('claim_lost', 'another Companion claimed it first', e.code || e.message)
      }
      const claimed = Object.assign({}, rec, { state: 'CLAIMED', claimedBy: by || null, claimedAt: new Date(now()).toISOString() })
      writeAtomic(target, claimed)
      return { ok: true, request: rec.request }
    },

    /** Move along the one-way table. An illegal transition is refused, never coerced. */
    transition (requestId, to, detail) {
      const found = findFile(requestId)
      if (!found) return no('unknown_request', 'no such request')
      const allowed = TRANSITIONS[found.state] || []
      if (!allowed.includes(to)) return no('illegal_transition', found.state + ' -> ' + to + ' is not a transition')

      const rec = readRecord(found.file) || {}
      const target = nameFor(to, requestId)
      writeAtomic(target, Object.assign({}, rec, { state: to, detail: detail || null, at: new Date(now()).toISOString() }))
      try { fsx.unlinkSync(found.file) } catch (_) { }
      return { ok: true, state: to }
    },

    stateOf (requestId) { const f = findFile(requestId); return f ? f.state : null },
    recordOf (requestId) { const f = findFile(requestId); return f ? readRecord(f.file) : null }
  }
}

module.exports = {
  buildRequest, validateRequest, verifyAgainst, createRequestStore,
  SCHEMA_VERSION, MESSAGE_TYPE, CANARY_TYPE, REQUEST_FIELDS, FORBIDDEN_FIELDS,
  STATES, TERMINAL, TRANSITIONS, DEFAULT_TTL_MS
}
