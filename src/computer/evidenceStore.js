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

/* ── WHAT MAY BE DELETED, AND WHAT MAY NEVER BE — CORRECTED 2026-07-29 ──────
 *
 * ⛔ THE SWEEP MATCHED `ev_*.png` ONLY, AND THAT WAS NOT WHAT LOCK 3 IS FOR.
 *
 * Every artefact that actually holds raw content is withdrawn on that basis. A screenshot
 * written by a harness under a different name is the same pixels as one written by this
 * store, and the prefix check kept it forever. Two sets, and a name falls in exactly one:
 *
 *   RAW_CONTENT   pixels and UI text. Deleted at the retention. This is what Lock 3 is FOR.
 *   RECORD        hashes, counts, nonces, markers. Never swept — a record is not content,
 *                 and deleting it would make a past run unadjudicable.
 *
 * ⛔ AND A THIRD OUTCOME, WHICH IS THE FAIL-SAFE. A name matching neither is `unclassified`:
 * it is NOT swept (deleting something nobody declared is a destructive guess) and it is NOT
 * treated as a record (keeping content forever because nobody named it is the original bug
 * with a different mask). It is left, and it is nameable — see BACKLOG-004.
 */
const RAW_CONTENT_PATTERNS = Object.freeze([
  { id: 'store-own', pattern: /^ev_[A-Za-z0-9_-]*\.png$/, why: 'the evidence store writes these itself' },
  { id: 'stage3-capture', pattern: /^stage3-capture-.+\.png$/i, why: 'whole-screen captures taken by the Part B harness' },
  { id: 'stage3-owner-reference', pattern: /^stage3-owner-reference-.+\.png$/i, why: 'owner-side reference captures' },
  { id: 'stage3-sentinel-shot', pattern: /^stage3-sentinel-.+\.png$/i, why: 'sentinel self-verification captures' },
  { id: 'observer-capture', pattern: /^obs-.+\.png$/i, why: 'captures written by observer.ps1' },
  { id: 'observer-uia-text', pattern: /^obs-.+\.uia\.txt$/i, why: 'UIA NODE TEXT — the only artefact here that is literally UI text' },
  /**
   * ⛔ RECLASSIFIED FROM record TO raw FOR E0-W1, AND THIS IS THE WHOLE REASON.
   *
   * The reference branch allow-lists this as never-swept, on the rationale that it carries
   * 「counts and own-session titles ... not raw content」. That rationale is the ruling of
   * 2026-07-31, superseded on 2026-08-05: a window title can carry a customer name or an
   * email subject, and this directory is mirrored offsite. An artefact that MAY hold titles
   * cannot be the one thing exempt from deletion.
   *
   * The conservative shape is not 「strip the titles and keep the file」 — that would be a
   * redaction nobody verifies, and a low-entropy hash of a title is not redaction either.
   * It ages out with the raw content it may contain. The counts that mattered belong in the
   * audit record, which is allow-listed and carries no titles.
   */
  { id: 'observer-result', pattern: /^observer-result\.json$/i, why: 'may carry window titles; ages out rather than being kept forever' }
])

/**
 * Never swept, and each says why. A record is not raw content: it carries hashes, counts and
 * markers, and losing one destroys the ability to adjudicate a run that already happened.
 */
const RECORD_PATTERNS = Object.freeze([
  { id: 'manifest', pattern: /^stage3-manifest\.json$/i, why: 'the nonce chain; deleting it would make a past run unadjudicable' },
  { id: 'results', pattern: /^stage3-(results|topup-results-.+)\.json$/i, why: 'the rows themselves' },
  { id: 'markers', pattern: /^stage3-(topup-)?(STARTED|COMPLETED)-.+\.json$/i, why: 'proof the run started and finished' },
  { id: 'attestations', pattern: /^stage3-(sentinel-owner|clip-owner)-.+\.json$/i, why: 'owner-side attestations that make negatives non-vacuous' },
  { id: 'uia-result', pattern: /^stage3-uia\.json$/i, why: 'counts and a hash, not node text — the text is in the .uia.txt' },
  { id: 'gate-backup', pattern: /^sessiongate-backup-.+\.xml$/i, why: 'the restore source for C4; losing it turns a measurement into an outage' },
  { id: 'tierA', pattern: /^tierA-(probe\.out|INCIDENT-.+\.json)$/i, why: 'Tier A rows and incidents' },
  { id: 'companion-log', pattern: /^companion-.+\.log(\.err)?$/i, why: 'stdout/stderr of a Companion launch — the only proof a Lock 5 kill binding was exercised' },
  { id: 'observer-task-baseline', pattern: /^observer-task-baseline(-.+)?\.xml$/i, why: 'the C4-style pointer baseline for the Observer task' }
])

/** Which set does a name fall into? Exactly one, or neither. */
function classify (name) {
  const n = String(name || '')
  for (const r of RAW_CONTENT_PATTERNS) if (r.pattern.test(n)) return { kind: 'raw', rule: r.id, why: r.why }
  for (const r of RECORD_PATTERNS) if (r.pattern.test(n)) return { kind: 'record', rule: r.id, why: r.why }
  return { kind: 'unclassified', rule: null, why: null }
}

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
      if (!fs.existsSync(baseDir)) {
        return { deleted: [], kept: 0, retained: [], unclassified: [], retentionDays: RETENTION_DAYS }
      }
      const cutoff = now() - RETENTION_MS
      const deleted = []
      /**
       * ⛔ WHAT WAS NOT DELETED IS REPORTED, AND FOR TWO DIFFERENT REASONS.
       * A record is kept deliberately. An UNCLASSIFIED name is kept because deleting something
       * nobody declared is how a control becomes an incident — but it is named, so it cannot sit
       * there forever unnoticed. Silence would make the two look identical.
       */
      const retained = []
      const unclassified = []
      let kept = 0
      for (const name of fs.readdirSync(baseDir)) {
        /**
         * ⛔ CLASSIFIED, NOT PREFIX-MATCHED. The prefix check kept every harness capture and
         * every observer artefact forever, which is the defect corrected on 2026-07-29.
         * `record` and `unclassified` are both left alone, for opposite reasons.
         */
        const full = path.join(baseDir, name)
        let st
        try { st = fs.statSync(full) } catch (_) { continue }
        if (!st.isFile()) continue
        const c = classify(name)
        if (c.kind === 'record') { retained.push(name); continue }
        if (c.kind === 'unclassified') { unclassified.push(name); continue }
        if (st.mtimeMs <= cutoff) {
          try { fs.unlinkSync(full); deleted.push(name) } catch (_) {}
        } else kept++
      }
      return { deleted, kept, retained, unclassified, retentionDays: RETENTION_DAYS }
    },

    /** Names only — never contents. Diagnostics, not a read channel. */
    list () {
      if (!fs.existsSync(baseDir)) return []
      return fs.readdirSync(baseDir).filter((n) => n.startsWith(EVIDENCE_PREFIX) && n.endsWith(EVIDENCE_EXT))
    }
  }
}

module.exports = { createEvidenceStore, classify, RAW_CONTENT_PATTERNS, RECORD_PATTERNS, RETENTION_DAYS, RETENTION_MS, EVIDENCE_PREFIX, EVIDENCE_EXT }
