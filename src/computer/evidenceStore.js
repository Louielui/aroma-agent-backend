'use strict'

/**
 * evidenceStore.js — Computer Operator v0, Phase 3a. Companion-local evidence, 7-day life.
 *
 * Owner decision: screenshots live ONLY on the Companion account's own disk and are
 * auto-deleted after 7 days. The audit keeps a SHA-256 and non-sensitive metadata — enough
 * to prove an image existed and was not altered, and not enough to reconstruct anything.
 *
 * ── THE SPLIT THAT MATTERS ────────────────────────────────────────────────────
 * This module writes the FILE. It returns the HASH. It never hands the bytes back to a
 * caller, and computerAudit.js refuses any field that could carry them. So the boundary is
 * enforced twice, in two directions: nothing here emits content, and nothing there accepts
 * it.
 *
 * ── DELETION IS BY AGE, NOT BY BOOKKEEPING ────────────────────────────────────
 * `sweep()` deletes by file mtime against a fixed retention. It needs no index, so a lost
 * or corrupted manifest cannot cause evidence to be retained forever — the failure mode
 * of a bookkeeping approach is exactly the one that matters here.
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const RETENTION_DAYS = 7
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000
// Only evidence files are ever considered for deletion. A sweep that could remove
// anything else would be a destructive tool pointed at a real profile.
const EVIDENCE_EXT = '.png'
const EVIDENCE_PREFIX = 'ev_'

/**
 * @param {{ baseDir: string, now?: Function }} options
 *   baseDir — a directory inside the COMPANION account's own profile. Required; the store
 *   never guesses a location, for the same reason the artifact store never does.
 */
function createEvidenceStore (options = {}) {
  const baseDir = options && options.baseDir
  if (typeof baseDir !== 'string' || baseDir.trim() === '') {
    throw new TypeError('createEvidenceStore requires a non-empty baseDir')
  }
  const now = typeof options.now === 'function' ? options.now : () => Date.now()

  function ensure () { fs.mkdirSync(baseDir, { recursive: true }) }

  /** A name that cannot escape baseDir: generated here, never taken from a caller. */
  function nameFor (id) {
    const safe = String(id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || crypto.randomBytes(8).toString('hex')
    return EVIDENCE_PREFIX + safe + EVIDENCE_EXT
  }

  return {
    baseDir,
    RETENTION_DAYS,

    /**
     * Persist evidence bytes and return ONLY metadata. The bytes are never returned and
     * never logged; the caller gets a hash it can put in the audit.
     * @returns {{ sha256: string, bytes: number, storedAt: number, file: string }}
     */
    put (id, bytes) {
      if (!Buffer.isBuffer(bytes)) throw new TypeError('evidence must be a Buffer')
      ensure()
      const file = nameFor(id)
      const full = path.join(baseDir, file)
      fs.writeFileSync(full, bytes)
      const t = now()
      // Set mtime explicitly so retention is driven by the injected clock and is testable
      // without waiting seven days.
      fs.utimesSync(full, new Date(t), new Date(t))
      return { sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, storedAt: t, file }
    },

    /**
     * Delete evidence older than the retention. Returns what it removed, so the deletion
     * is auditable as a fact rather than assumed to have happened.
     */
    sweep () {
      if (!fs.existsSync(baseDir)) return { deleted: [], kept: 0, retentionDays: RETENTION_DAYS }
      const cutoff = now() - RETENTION_MS
      const deleted = []
      let kept = 0
      for (const name of fs.readdirSync(baseDir)) {
        // Belt and braces: only this store's own files are ever candidates.
        if (!name.startsWith(EVIDENCE_PREFIX) || !name.endsWith(EVIDENCE_EXT)) continue
        const full = path.join(baseDir, name)
        let st
        try { st = fs.statSync(full) } catch (_) { continue }
        if (!st.isFile()) continue
        if (st.mtimeMs <= cutoff) {
          try { fs.unlinkSync(full); deleted.push(name) } catch (_) {}
        } else kept++
      }
      return { deleted, kept, retentionDays: RETENTION_DAYS }
    },

    /** Names only — never contents. Diagnostics, not a read channel. */
    list () {
      if (!fs.existsSync(baseDir)) return []
      return fs.readdirSync(baseDir).filter((n) => n.startsWith(EVIDENCE_PREFIX) && n.endsWith(EVIDENCE_EXT))
    }
  }
}

module.exports = { createEvidenceStore, RETENTION_DAYS, RETENTION_MS, EVIDENCE_PREFIX, EVIDENCE_EXT }
