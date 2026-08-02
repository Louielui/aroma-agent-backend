'use strict'

/**
 * executeRequestStore.js — durable requests, written atomically, claimed exactly once.
 *
 * ── WHAT THIS TRANSPORT IS, STATED CORRECTLY ───────────────────────────────
 * It is an INDEPENDENT DIRECTORY TRANSPORT. It is not an extension of the SessionGate pipe
 * protocol, and earlier comments in this repo that said otherwise were wrong.
 *
 * What it shares with the pipe is governance vocabulary — the message-type name is registered in
 * the same closed list so two things cannot claim the same name. It shares no transport, no
 * framing, no endpoint and no code path. `canary_execute` and `canary_outcome` appear in
 * sessionBoundary.js as RESERVED names with no producer and no consumer; tests assert those
 * counts are zero, so the registration cannot quietly become a second channel.
 *
 * ── WHY A DIRECTORY AND NOT THE PIPE ───────────────────────────────────────
 * Because the property the canary needs is single-claim mutual exclusion ACROSS PROCESSES that
 * share nothing, and `rename` on NTFS provides exactly that: it cannot half-succeed and cannot
 * succeed twice. A pipe would have given us a message and left the mutual exclusion to be
 * invented in application code, which is where it would have been got wrong.
 *
 * There is exactly ONE request channel in canary production. No pipe fallback, no secondary
 * path, nothing to fail over to. A fallback is a second implementation of the rule, and the
 * second implementation is the one nobody re-reads.
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

/**
 * THE SCHEMA IS NOT DEFINED HERE.
 *
 * It lives in executeRequestSchema.js, and the Owner's producer and the Companion's consumer
 * both import that same file. Defining it in the store would put the definition on the side
 * that stores requests rather than the side that agrees on them - which is how this repo ended
 * up with two schemas, each green against its own fixture and unable to read the other's output.
 */
const SCHEMA = require('./executeRequestSchema')
const {
  SCHEMA_VERSION, MESSAGE_TYPE, CANARY_TYPE, REQUEST_FIELDS, FORBIDDEN_FIELDS,
  STATES, TERMINAL, TRANSITIONS, MIN_TTL_MS, DEFAULT_TTL_MS, validateRequest, no
} = SCHEMA

/**
 * Build a request from a VERIFIED receipt and nothing else.
 *
 * Every field is copied out of the receipt or generated here. Not one of them comes from a
 * caller, from argv, from stdin or from the draft order file on disk — the Owner did not approve
 * a file, he approved a specific document, and that document is what the receipt carries.
 */
function buildRequest (receipt, opts = {}) {
  if (!receipt || !receipt.approvalId) throw new Error('a request may only be built from a verified receipt')
  if (!receipt.workOrderHash || !receipt.executionPackageManifestHash) {
    throw new Error('the receipt is missing its bindings')
  }
  const now = opts.now ? opts.now() : Date.now()
  const ttlMs = opts.ttlMs || DEFAULT_TTL_MS
  // A caller may lengthen the window; it may not shorten it below the switch floor. Refused
  // rather than clamped: silently substituting a different number is how a caller comes to
  // believe a value it never got.
  if (ttlMs < MIN_TTL_MS) throw new Error('ttl_below_floor: a request must stay claimable for at least ' + (MIN_TTL_MS / 60000) + ' minutes')

  // FROZEN AT BIRTH. Nothing downstream decorates a request; a mutable one could be widened
  // between validation and use, which is the oldest trick there is.
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
    expiresAt: new Date(now + ttlMs).toISOString()
  })
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
    recordOf (requestId) { const f = findFile(requestId); return f ? readRecord(f.file) : null },

    /**
     * WHICH REQUEST A COMPANION SHOULD PICK UP — and the retirement of the ones it should not.
     *
     * ── THE DEFECT THIS REPLACES ──────────────────────────────────────────
     * The Companion used to do `readdirSync(dir).filter(CREATED__).sort()[0]`. Filenames are
     * `CREATED__req_<random hex>.json`, so that sorted on RANDOMNESS, not on time. It read like
     * "take the oldest" and was "take whichever random id happens to sort first".
     *
     * On the Owner's machine that was `req_1edf3e52…` from the previous day, expired for 20.6
     * hours. It won every sort ('1' < 'b' < 'f'), so every fresh approval was shadowed by one
     * dead file and failed with "too old to use" — deterministically, not intermittently, and
     * for as long as that file stayed on disk.
     *
     * ── THE RULE, STATED ONCE ─────────────────────────────────────────────
     *   1. expired requests are RETIRED and never considered;
     *   2. among what remains, the one with the NEWEST request.createdAt wins;
     *   3. exact ties break on requestId, ascending, so the choice is total and repeatable.
     *
     * NEWEST, because a request records an intention the Owner has just expressed. If two are
     * live, the later one is what he most recently asked for; picking the older would act on a
     * decision he has already replaced. One at a time stays the design — this only makes WHICH
     * one an answer instead of an accident.
     *
     * Ordering uses `request.createdAt`, the same field `request.expiresAt` is derived from, so
     * "newest" and "still alive" are measured against the same clock and cannot disagree.
     *
     * ── RETIREMENT MUST NOT BECOME A NEW WAY TO FAIL ──────────────────────
     * Every rename is individually caught. A retirement that fails is COUNTED and reported, and
     * the scan carries on: a valid request must not be held hostage by a stale file that cannot
     * be renamed because something else has it open. Nothing is deleted — the record keeps its
     * content and only the state prefix changes, which is the same move `claim()` makes and
     * leaves the history readable.
     */
    selectPending () {
      ensure()
      let names = []
      try { names = fsx.readdirSync(dir) } catch (_) { return { ok: false, reason: 'no_request_dir', candidates: 0, expiredRetired: 0, retireFailures: 0 } }

      const t = now()
      const live = []
      let expiredSeen = 0
      let retired = 0
      let retireFailures = 0
      let unreadable = 0

      for (const n of names) {
        if (!n.startsWith('CREATED__') || !n.endsWith('.json')) continue
        const file = path.join(dir, n)
        const rec = readRecord(file)
        // A file that cannot be parsed is not silently skipped into oblivion: it is counted and
        // reported, so "nothing to do" can never mean "everything here is broken".
        if (!rec || !rec.request || !rec.request.requestId) { unreadable++; continue }

        const exp = Date.parse(rec.request.expiresAt)
        if (!Number.isFinite(exp) || t >= exp) {
          expiredSeen++
          try {
            fsx.renameSync(file, nameFor('EXPIRED', rec.request.requestId))
            retired++
          } catch (_) {
            // Best effort, by design. It stays CREATED and will be skipped again next time.
            retireFailures++
          }
          continue
        }
        live.push({ file, record: rec, createdAt: Date.parse(rec.request.createdAt), requestId: rec.request.requestId })
      }

      live.sort((a, b) => (b.createdAt - a.createdAt) || (a.requestId < b.requestId ? -1 : a.requestId > b.requestId ? 1 : 0))

      const base = { candidates: live.length, expiredSeen, expiredRetired: retired, retireFailures, unreadable }
      if (live.length === 0) {
        // Deliberately NOT 'too old to use'. That sentence describes a request; this is the
        // absence of one, and telling the Owner his fresh approval expired when it did not is
        // exactly how four rounds were spent looking at the wrong thing.
        return Object.assign({ ok: false, reason: 'no_pending_request' }, base)
      }
      return Object.assign({ ok: true, file: live[0].file, record: live[0].record, requestId: live[0].requestId }, base)
    }
  }
}

module.exports = {
  buildRequest, validateRequest, verifyAgainst, createRequestStore,
  SCHEMA_VERSION, MESSAGE_TYPE, CANARY_TYPE, REQUEST_FIELDS, FORBIDDEN_FIELDS,
  STATES, TERMINAL, TRANSITIONS, DEFAULT_TTL_MS, MIN_TTL_MS
}
