'use strict'

/**
 * openClawInstanceStore.js — THE DURABLE HOME OF EXECUTOR IDENTITY.
 *
 * openClawInstanceManager owns WHAT an instance record is and refuses anything it cannot
 * account for; this module owns only WHERE those records live and HOW bytes reach disk. It
 * validates nothing, repairs nothing and salvages nothing: whatever is on disk is handed to
 * the manager exactly as parsed, and the manager decides.
 *
 * ── THE FILE IS FIXED ────────────────────────────────────────────────────────
 *   <resolveDataDir()>/openclaw-instances.json
 * The directory comes from the ONE data-dir resolver (src/store/dataDir.js), which redirects
 * test processes away from production unless AROMA_DATA_DIR says otherwise. No option names a
 * path, so no composition site can point the instance ledger somewhere the verifier is not
 * looking.
 *
 * ── READ ─────────────────────────────────────────────────────────────────────
 * ENOENT is the only condition that means "no instances yet", and it yields a fresh
 * null-prototype object. Every other read failure throws, and malformed JSON throws. A ledger
 * that cannot be read is not an empty ledger: "no instances" is the one answer that lets a
 * second launch proceed, so it is never manufactured from a failure.
 *
 * ── WRITE: ATOMIC REPLACEMENT ────────────────────────────────────────────────
 * The complete document is serialized FIRST; only then is a uniquely named temp file created
 * beside the final file, the bytes written, the descriptor fsync'd and closed, and the temp
 * renamed over the final path. The rename is the commit point: a failure anywhere before it
 * leaves the previous final file byte-for-byte untouched. Temp files are removed on a best
 * effort basis after failure, and cleanup failing is never mistaken for persistence
 * succeeding.
 *
 * This is atomic replacement with synchronous completion. It is NOT a claim of full
 * power-loss transactional durability for the directory entry — that would need a directory
 * fsync this runtime does not expose portably, and the claim is left unmade.
 *
 * No child_process, no WSL, no OpenClaw, no model.
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { resolveDataDir } = require('../store/dataDir')

const FILE_NAME = 'openclaw-instances.json'

/**
 * @param {{ fsImpl?: object }} mechanics
 *   `fsImpl` lets a test inject failure at a specific syscall. It is a MECHANIC: it cannot
 *   change which file is written, only how the bytes get there.
 */
function createOpenClawInstanceStore (mechanics = {}) {
  const io = mechanics && mechanics.fsImpl && typeof mechanics.fsImpl === 'object' ? mechanics.fsImpl : fs
  const dir = resolveDataDir()
  const file = path.join(dir, FILE_NAME)

  function read () {
    let raw
    try {
      raw = io.readFileSync(file, 'utf8')
    } catch (e) {
      if (e && e.code === 'ENOENT') return Object.create(null)
      throw new Error(`refuse: instance store unreadable (${(e && e.message) || 'unknown'})`)
    }
    try {
      // returned exactly as parsed — arrays, null and scalars included. The manager refuses them.
      return JSON.parse(raw)
    } catch (e) {
      throw new Error(`refuse: instance store is not valid JSON (${(e && e.message) || 'unknown'})`)
    }
  }

  function write (all) {
    // 1. serialize completely, before anything on disk is touched
    const text = JSON.stringify(all, null, 2)
    if (typeof text !== 'string') throw new TypeError('refuse: instance store cannot serialize this value')
    const bytes = Buffer.from(text, 'utf8')

    io.mkdirSync(dir, { recursive: true })

    // 2. a unique temp file beside the final file (same directory, so rename is a same-fs move)
    const tmp = path.join(dir, FILE_NAME + '.' + process.pid + '.' + crypto.randomBytes(8).toString('hex') + '.tmp')
    let fd = null
    try {
      fd = io.openSync(tmp, 'wx', 0o600)
      // 3. write the complete bytes
      let off = 0
      while (off < bytes.length) off += io.writeSync(fd, bytes, off, bytes.length - off)
      // 4. fsync the temp file where the runtime supports it
      if (typeof io.fsyncSync === 'function') io.fsyncSync(fd)
      // 5. close
      io.closeSync(fd)
      fd = null
      // 6. rename is the commit point
      io.renameSync(tmp, file)
    } catch (e) {
      // best-effort cleanup; its outcome is never reported as persistence
      if (fd !== null) { try { io.closeSync(fd) } catch (_) {} }
      try { io.unlinkSync(tmp) } catch (_) {}
      throw new Error(`refuse: instance store write failed before commit (${(e && e.message) || 'unknown'})`)
    }
  }

  return Object.freeze({ read, write, file })
}

module.exports = { createOpenClawInstanceStore, FILE_NAME }
