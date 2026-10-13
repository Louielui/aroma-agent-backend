'use strict'

/**
 * openClawLedgerCoordinator.js — THE CROSS-PROCESS MUTUAL EXCLUSION FOR BOTH OPENCLAW LEDGERS.
 *
 * openClawQuarantine and openClawInstanceManager are whole-document read-modify-write stores
 * with no compare-and-swap. Two processes that read, edit and rewrite them concurrently lose
 * each other's updates — and the update most worth losing is a retirement, because the record
 * that comes back is the one that still holds the global execution lock. The composition root
 * therefore runs every mutating operation, and the cross-ledger status() snapshot, inside ONE
 * critical section under ONE fixed scope. This module is the thing that actually makes that
 * section exclusive across processes.
 *
 * ── HOW: ONE ATOMIC mkdir, AND NOTHING CLEVERER ─────────────────────────────
 * Acquisition is a single `mkdir` of a fixed directory. mkdir is atomic on every filesystem we
 * care about: it either creates the directory or fails with EEXIST, and exactly one racing
 * process can win. There is no spinning, no queue, no sleep, no timeout retry — a busy lock is
 * an immediate, synchronous refusal, and the caller decides what to do about it.
 *
 * ⛔ AND AN ORPHANED LOCK IS NEVER RECLAIMED AUTOMATICALLY.
 * If a process dies holding the lock, the directory stays. That is deliberate: nothing this
 * module can observe distinguishes "the holder crashed" from "the holder is in the middle of a
 * retirement". A dead PID does not prove it — PIDs are reused, and the ledgers may already be
 * half-written. An age threshold does not prove it either; it just picks a number after which
 * we are willing to corrupt state. So a stale lock keeps the system FAIL CLOSED and waits for a
 * separate, deliberate human recovery gate. Refusing to start is recoverable. Two processes
 * rewriting the retirement ledger is not.
 *
 * ── OWNERSHIP IS PROVEN BEFORE ANYTHING IS DELETED ──────────────────────────
 * The winner writes an owner record inside the directory it just created, carrying an
 * unpredictable token. Release re-reads that record and removes the lock ONLY if the token is
 * still exactly the one this call generated. If the record is missing, unreadable, malformed or
 * carries someone else's token, the lock is LEFT IN PLACE and the failure is reported. Deleting
 * a lock we cannot prove we own is how one process silently unlocks another's critical section.
 *
 * Removal is `unlink` of one exact file then `rmdir` of one exact directory. Never recursive,
 * never a glob, never a path derived from a caller's argument.
 *
 * ── WHAT THIS MODULE IS NOT ─────────────────────────────────────────────────
 * Importing it builds nothing and locks nothing; it exports a factory. Constructing takes no
 * lock. There is no store, filesystem root or lock path input — the directory is the same fixed
 * resolveDataDir() the ledgers use, so no caller can point the lock somewhere the ledgers are
 * not. It holds no secret and puts none in any result or error.
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { resolveDataDir } = require('../store/dataDir')

/** The ONE scope this coordinator serves. Both ledgers are one shared critical section. */
const LEDGER_SCOPE = 'openclaw-ledgers-v1'

/**
 * ⛔ SCOPE IS A KEY, NEVER A PATH FRAGMENT.
 * Building a path by concatenating a caller's string is how a scope becomes a traversal. The
 * lock directory name is looked up from this frozen table AFTER the scope has been matched by
 * strict identity, so no caller value ever reaches path.join.
 */
const LOCK_DIRS = Object.freeze(Object.assign(Object.create(null), {
  [LEDGER_SCOPE]: 'openclaw-ledgers-v1.lock'
}))
const OWNER_FILE = 'owner.json'
const FORMAT = 'openclaw-ledger-lock/1'
const TOKEN_BYTES = 32
const TOKEN_HEX = TOKEN_BYTES * 2

const refuse = (why) => new Error('refuse: ' + why)
const isDataObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** A thenable answer means the work is still in flight when we are about to release. */
function isThenable (v) {
  try {
    if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return false
    return typeof v.then === 'function'
  } catch (_) {
    // an answer we cannot even inspect is not a value we will call synchronous
    return true
  }
}

/** Total and non-throwing: describing a failure must never become a second failure. */
function describe (e) {
  try {
    if (e === null) return 'null'
    if (e === undefined) return 'undefined'
    const t = typeof e
    if (t === 'string') return e.slice(0, 200)
    if (t === 'number' || t === 'boolean' || t === 'bigint') return String(e).slice(0, 200)
    if (t === 'symbol') { try { return String(e).slice(0, 200) } catch (_) { return 'unknown' } }
    if (t === 'function') return 'function'
    let m
    try { m = e.message } catch (_) { m = undefined }
    if (typeof m === 'string' && m !== '') return m.slice(0, 200)
    try { const s = String(e); return typeof s === 'string' && s !== '' ? s.slice(0, 200) : 'unknown' } catch (_) { return 'unknown' }
  } catch (_) { return 'unknown' }
}

function createOpenClawLedgerCoordinator () {
  // resolved once; the caller has no say in where the lock lives
  const dir = resolveDataDir()

  /**
   * Run `fn` while holding the cross-process lock for `scope`.
   *
   * Returns whatever `fn` returned. Throws — synchronously, always — when the lock is busy,
   * when the scope or callback is unusable, when the lock could not be safely taken, when the
   * callback answered asynchronously, or when release could not prove ownership. A throw that
   * came from `fn` itself is rethrown VERBATIM, but ONLY after a release that actually
   * succeeded: an ownership or release failure is reported in preference to it, because a lock
   * that is still held and cannot be proven ours is the more dangerous fact.
   */
  function runExclusive (scope, fn) {
    // ⛔ Strict identity, so nothing about a hostile scope is ever read: no coercion, no
    // property access, no trap. A revoked Proxy simply is not this string.
    if (scope !== LEDGER_SCOPE) {
      throw refuse('unknown ledger coordination scope; the only scope is ' + JSON.stringify(LEDGER_SCOPE))
    }
    if (typeof fn !== 'function') {
      throw refuse('the critical section must be a function')
    }

    const lockPath = path.join(dir, LOCK_DIRS[scope])
    const ownerPath = path.join(lockPath, OWNER_FILE)

    // ── 1. acquisition: ONE atomic mkdir, no retry, no reclaim ──
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch (e) {
      throw refuse('the data directory could not be prepared (' + describe(e) + ')')
    }
    try {
      fs.mkdirSync(lockPath)
    } catch (e) {
      if (e && e.code === 'EEXIST') {
        // ⛔ BUSY. The lock is NOT inspected, NOT aged out and NOT removed. The callback does
        // not run, and nothing has been read or written.
        throw refuse('the OpenClaw ledgers are locked by another holder; no work was performed')
      }
      throw refuse('the ledger lock could not be created (' + describe(e) + ')')
    }

    // ── 2. ownership record, exclusively created inside the directory we just won ──
    const token = crypto.randomBytes(TOKEN_BYTES).toString('hex')
    try {
      const record = JSON.stringify({
        format: FORMAT,
        scope: LEDGER_SCOPE,
        token,
        pid: process.pid,
        createdAt: new Date().toISOString()
      })
      const fd = fs.openSync(ownerPath, 'wx', 0o600)
      try {
        const bytes = Buffer.from(record, 'utf8')
        let off = 0
        while (off < bytes.length) off += fs.writeSync(fd, bytes, off, bytes.length - off)
        if (typeof fs.fsyncSync === 'function') fs.fsyncSync(fd)
      } finally {
        fs.closeSync(fd)
      }
    } catch (e) {
      // We created this directory and no owner record exists in it, so removing it is safe and
      // is the only case where the lock is removed without a token check.
      try { fs.rmdirSync(lockPath) } catch (_) {}
      throw refuse('the ledger lock ownership record could not be written (' + describe(e) + ')')
    }

    // ── 3. the critical section: AT MOST ONCE ──
    let calls = 0
    let value
    let callbackFailed = false
    let callbackError
    try {
      calls += 1
      value = fn()
    } catch (e) {
      callbackFailed = true
      callbackError = e
    }

    /**
     * ⛔ 4. THE ASYNCHRONY CHECK COMES BEFORE ANY RELEASE, AND KEEPS THE LOCK.
     *
     * A thenable answer means the work is still running. Releasing first and complaining second
     * would hand the lock to another process while that work is still touching the ledgers —
     * the exact race this module exists to prevent, dressed up as an error message. So the lock
     * and its owner record are LEFT IN PLACE, deliberately orphaned, and only a separate human
     * recovery gate clears them. An answer we cannot even inspect is treated the same way.
     */
    if (!callbackFailed && isThenable(value)) {
      throw refuse('the critical section answered asynchronously; this coordinator is synchronous, the work is not accounted for, and the lock was deliberately NOT released')
    }

    // ── 5. release, only what we can prove we own ──
    let releaseError = null
    try {
      releaseOwned(lockPath, ownerPath, token)
    } catch (e) {
      releaseError = e
    }

    /**
     * ⛔ 6. A RELEASE OR OWNERSHIP FAILURE OUTRANKS THE CALLBACK'S OWN FAILURE.
     *
     * If both happened, reporting only the callback error would hide the fact that a lock is
     * still held and cannot be proven ours — the more dangerous of the two, and the one that
     * blocks every later acquisition. The callback's value is rethrown VERBATIM only after a
     * release that actually succeeded.
     */
    if (releaseError !== null) throw releaseError
    if (callbackFailed) throw callbackError

    if (calls !== 1) throw refuse('the critical section did not run exactly once')

    return value
  }

  /**
   * Remove the lock ONLY on proof of ownership. Every failure leaves the lock in place, which
   * keeps the system fail closed rather than unlocking a section we do not own.
   */
  function releaseOwned (lockPath, ownerPath, token) {
    let raw
    try {
      raw = fs.readFileSync(ownerPath, 'utf8')
    } catch (e) {
      throw refuse('the ledger lock ownership record is missing or unreadable; the lock was NOT removed (' + describe(e) + ')')
    }
    let record
    try {
      record = JSON.parse(raw)
    } catch (e) {
      throw refuse('the ledger lock ownership record is malformed; the lock was NOT removed')
    }
    if (!isDataObject(record) ||
        record.format !== FORMAT ||
        record.scope !== LEDGER_SCOPE ||
        typeof record.token !== 'string' ||
        record.token.length !== TOKEN_HEX ||
        record.token !== token) {
      throw refuse('the ledger lock is held by a different owner; the lock was NOT removed')
    }
    // one exact file, then one exact directory — never recursive, never a pattern
    fs.unlinkSync(ownerPath)
    fs.rmdirSync(lockPath)
  }

  return Object.freeze({ runExclusive })
}

module.exports = { createOpenClawLedgerCoordinator, LEDGER_SCOPE }
