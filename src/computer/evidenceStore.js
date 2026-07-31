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

/* ── LOCK 3, CORRECTED 2026-07-29 ──────────────────────────────────────────
 * The sweep matched `ev_*.png` only. Every artefact that actually holds raw content is
 * named otherwise — `stage3-capture-*.png`, `stage3-owner-reference-*.png`, `obs-*.png`,
 * `obs-*.uia.txt` — so NONE of them was ever swept. The retention test passed and was
 * honest about what it tested: the store's own sweep, over files the store itself wrote.
 * It simply did not cover the files being produced. An earlier green report on Lock 3 was
 * withdrawn on that basis.
 *
 * THE SPLIT THAT MAKES THIS SAFE TO WIDEN
 * Widening a deletion path is the one change here that can destroy evidence, so the store
 * now classifies every name into exactly one of three sets, by declaration:
 *
 *   RAW_CONTENT   pixels and UI text. Deleted at 7 days. This is what Lock 3 is FOR.
 *   RECORD        adjudication and provenance — manifests, results, STARTED/COMPLETED
 *                 markers, attestations. NEVER swept. Deleting these would destroy the
 *                 audit trail that proves what the raw content once showed, which is the
 *                 opposite of the intent.
 *   unclassified  anything else. NEVER swept, and REPORTED BY NAME, so a new artefact type
 *                 shows up as a question instead of silently accumulating forever or
 *                 silently being deleted. Absence of a rule is not permission either way.
 */
const RAW_CONTENT_PATTERNS = Object.freeze([
  { id: 'store-own', pattern: /^ev_[A-Za-z0-9_-]*\.png$/, why: 'the evidence store writes these itself' },
  { id: 'stage3-capture', pattern: /^stage3-capture-.+\.png$/i, why: 'whole-screen captures taken by the Part B harness' },
  { id: 'stage3-owner-reference', pattern: /^stage3-owner-reference-.+\.png$/i, why: 'owner-side reference captures' },
  { id: 'stage3-sentinel-shot', pattern: /^stage3-sentinel-.+\.png$/i, why: 'sentinel self-verification captures' },
  { id: 'observer-capture', pattern: /^obs-.+\.png$/i, why: 'captures written by observer.ps1' },
  { id: 'observer-uia-text', pattern: /^obs-.+\.uia\.txt$/i, why: 'UIA NODE TEXT — the only artefact here that is literally UI text' }
])

/**
 * Never swept, and each says why. A record is not raw content: it carries hashes, counts and
 * verdicts, which is exactly what has to outlive the pixels.
 */
const RECORD_PATTERNS = Object.freeze([
  { id: 'manifest', pattern: /^stage3-manifest\.json$/i, why: 'the nonce chain; deleting it would make a past run unadjudicable' },
  { id: 'results', pattern: /^stage3-(results|topup-results-.+)\.json$/i, why: 'the rows themselves' },
  { id: 'markers', pattern: /^stage3-(topup-)?(STARTED|COMPLETED)-.+\.json$/i, why: 'proof the run started and finished' },
  { id: 'attestations', pattern: /^stage3-(sentinel-owner|clip-owner)-.+\.json$/i, why: 'owner-side attestations that make negatives non-vacuous' },
  { id: 'uia-result', pattern: /^stage3-uia\.json$/i, why: 'counts and a hash, not node text — the text is in the .uia.txt' },
  { id: 'gate-backup', pattern: /^sessiongate-backup-.+\.xml$/i, why: 'the restore source for C4; losing it turns a measurement into an outage' },
  { id: 'tierA', pattern: /^tierA-(probe\.out|INCIDENT-.+\.json)$/i, why: 'Tier A rows and incidents' },
  // DECIDED 2026-07-31, because "unclassified" was not an answer. The 2026-07-30 sweep reported
  // 48 of 97 files unclassified and every one was a companion log — roughly half the store
  // sitting outside the control's declared coverage. The classifier failed safe (an undeclared
  // name is never deleted, only reported), but a permanent open question is a decision nobody
  // made, and the Owner asked for one.
  //
  // THEY ARE RECORDS. deploy-companion.ps1 writes companion-<round>-<stamp>.log as the stdout
  // and stderr of a Companion launch, and those rounds ARE the Lock 5 kill bindings. The log is
  // the only artefact showing a binding was actually exercised rather than merely claimed, so
  // deleting it on a timer would quietly destroy Lock 5's audit trail while leaving Lock 5's
  // verdict standing — evidence gone, conclusion kept, which is the exact shape this phase
  // exists to prevent.
  //
  // WHY NOT `raw`: retention bounds how long CAPTURED CONTENT is kept. These carry process
  // output — pids, exit codes, status lines — not screen pixels, window text or UIA nodes.
  // IF THAT EVER CHANGES, this classification must change with it: a companion log that starts
  // carrying observation content is raw material and belongs on the deletion path.
  { id: 'companion-log', pattern: /^companion-.+\.log(\.err)?$/i, why: 'stdout/stderr of a Companion launch — the only proof a Lock 5 kill binding was exercised' },
  // Found 2026-07-29 while tracing the observer SHA pin: both of these were falling through
  // as `unclassified`. Never deleted — the classifier fails safe — but reported every sweep
  // as an open question, which is noise where a decision belongs. They are records: the
  // baseline is the only thing that could ever show the observer task's POINTER being
  // changed (the hole C4 exists to close), and the result file carries counts and
  // own-session titles, not raw content.
  { id: 'observer-task-baseline', pattern: /^observer-task-baseline(-.+)?\.xml$/i, why: 'the C4-style pointer baseline for the Observer task, including dated pre-change copies' },
  { id: 'observer-result', pattern: /^observer-result\.json$/i, why: 'counts and own-session titles from the task-launched observer, not raw content' }
])

/** Which set does a name fall into? Exactly one, or none. */
function classify (name) {
  for (const r of RAW_CONTENT_PATTERNS) if (r.pattern.test(name)) return { kind: 'raw', rule: r.id }
  for (const r of RECORD_PATTERNS) if (r.pattern.test(name)) return { kind: 'record', rule: r.id }
  return { kind: 'unclassified', rule: null }
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
      const retained = []
      const unclassified = []
      let kept = 0
      for (const name of fs.readdirSync(baseDir)) {
        const full = path.join(baseDir, name)
        let st
        try { st = fs.statSync(full) } catch (_) { continue }
        if (!st.isFile()) continue

        const c = classify(name)
        // A record is never deleted, and an unclassified name is never deleted either —
        // reported instead, because deleting something nobody declared is how a control
        // becomes an incident.
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
    },

    /** Every raw-content artefact the sweep is responsible for, whatever wrote it. */
    listRawContent () {
      if (!fs.existsSync(baseDir)) return []
      return fs.readdirSync(baseDir).filter((n) => classify(n).kind === 'raw')
    },

    /** What the sweep WOULD do, without doing it. For a runbook, and for a test. */
    classify
  }
}

module.exports = {
  createEvidenceStore,
  RETENTION_DAYS,
  RETENTION_MS,
  EVIDENCE_PREFIX,
  EVIDENCE_EXT,
  RAW_CONTENT_PATTERNS,
  RECORD_PATTERNS,
  classify
}
