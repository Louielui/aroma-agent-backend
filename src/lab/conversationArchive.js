'use strict'

/**
 * conversationArchive.js — Xiangxiang Lab, Conversation Persistence v0.1. WRITE ONLY.
 *
 * ── WHAT THIS IS AND IS NOT ────────────────────────────────────────────────
 * It records what was said, so that a LATER phase can decide whether anything should ever read
 * it back. v0.1 provides NO readback to the model: nothing here is imported by the prompt
 * builder, the persona, Decision Recall or the intake pipeline. The only readers are the Owner's
 * own export and delete commands.
 *
 * That ordering is deliberate. Collecting first and reading later means the read design can be
 * argued about with real data in hand; building the reader first would mean guessing what the
 * data looks like, and this project has spent five sessions paying for guesses about a machine
 * nobody had measured.
 *
 * ── FAIL-OPEN. THE OPPOSITE OF THE COMPUTER OPERATOR AUDIT, ON PURPOSE. ────
 * If a write fails here, THE CONVERSATION STILL COMPLETES. The failure is surfaced, never
 * swallowed, and never allowed to turn into "Xiangxiang could not answer you".
 *
 * The Computer Operator's audit is fail-CLOSED: no record, no action. That is correct there
 * because the record is part of the AUTHORISATION CHAIN — an unrecorded desktop action is an
 * action nobody can evidence afterwards, and the whole containment argument rests on being able
 * to say what happened.
 *
 * This archive authorises nothing. It is an additional feature sitting beside a conversation
 * that was already going to happen. Making it fail-closed would introduce a new single point of
 * failure into talking to Xiangxiang, in exchange for a record whose only purpose is
 * convenience. A full disk would take the assistant away.
 *
 * Different jobs, opposite defaults, and the reason is written down so neither gets "corrected"
 * to match the other.
 *
 * ── APPEND-ONLY, WITH ONE NAMED EXCEPTION ─────────────────────────────────
 * Turns are appended to archive.jsonl and never edited in place. DELETION is the exception, and
 * it is a real deletion: the Owner asked for the ability to remove data, and a tombstone that
 * leaves the text on disk is not that. Deletion rewrites the archive without the removed records
 * and writes an AUDIT record naming what was removed — ids, counts, ranges, never the content.
 * An audit that preserved the deleted text would defeat the deletion it is recording.
 *
 * ── THE ARCHIVE CONTAINS SECRETS. ASSUME IT ALWAYS. ───────────────────────
 * Redaction runs before every write and is best-effort only — see redaction.js. Nothing here
 * may be described as clean, safe to copy, or safe to back up into an existing chain.
 *
 * ── NOT DURABLE STORAGE YET ───────────────────────────────────────────────
 * v0.1 does no backup. Until this archive is in a backup chain AND a restore has been verified,
 * it must not be called durable. The precedent is AromaTruthData-B2Sync: a store is not backed
 * up until a restore has been proven, and calling it backed up before that is how data is lost
 * politely.
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const { redact, saysDoNotRecord } = require('./redaction')

/** Its own place, outside the repo and outside every existing data directory. */
const DEFAULT_ROOT = 'C:\\Aroma\\XiangxiangLab\\conversation-archive'

const ARCHIVE_FILE = 'archive.jsonl'
const AUDIT_FILE = 'audit.jsonl'

const SCHEMA_VERSION = 1

/** Roles a turn may carry. Closed, so a future caller cannot invent one. */
const ROLES = Object.freeze(['user', 'assistant'])

/**
 * @param {object} [opts]
 * @param {string} [opts.root]  archive directory; defaults to the Lab path
 * @param {function} [opts.now] injected clock, so a test can reproduce a run exactly
 */
function createConversationArchive (opts = {}) {
  // An explicit root wins; then XIANGXIANG_ARCHIVE_ROOT, so a test or a dry run can be pointed
  // at a temp directory and can never write into the Owner's real archive by accident; then the
  // Lab default. The env var names a DIRECTORY only — it can redirect where the Lab writes, and
  // it cannot enable the Lab, which is XIANGXIANG_ARCHIVE's job alone.
  const root = opts.root || (opts.env || process.env).XIANGXIANG_ARCHIVE_ROOT || DEFAULT_ROOT
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now()
  const newId = typeof opts.newId === 'function' ? opts.newId : () => crypto.randomBytes(8).toString('hex')

  const archivePath = path.join(root, ARCHIVE_FILE)
  const auditPath = path.join(root, AUDIT_FILE)

  const stamp = () => new Date(now()).toISOString()

  function ensureRoot () { fs.mkdirSync(root, { recursive: true }) }

  /** Append one line. The ONLY way anything enters either file. */
  function appendLine (file, obj) {
    ensureRoot()
    fs.appendFileSync(file, JSON.stringify(obj) + '\n', 'utf8')
  }

  /**
   * Record an audit event. Best-effort by design: if the audit itself cannot be written we do
   * NOT escalate, because escalating here would make the archive fail-closed through the back
   * door — the exact property this module is documented not to have.
   */
  function audit (event, detail) {
    try {
      appendLine(auditPath, Object.assign({ schemaVersion: SCHEMA_VERSION, event, at: stamp() }, detail || {}))
      return true
    } catch (_) { return false }
  }

  /**
   * Append one turn.
   *
   * NEVER THROWS. Every failure path returns a result the caller can surface and carry on from.
   *
   * @param {object} t
   * @param {string} t.conversationId
   * @param {string} t.role       'user' | 'assistant'
   * @param {string} t.text       the turn, verbatim, before redaction
   * @param {number} t.turnIndex  position within the conversation, 0-based
   * @param {string} [t.model]    e.g. claude-haiku-4-5-20251001
   * @param {string} [t.provider] e.g. claude | openai
   * @param {string} [t.lane]
   * @param {string} [t.requestId]
   * @param {boolean} [t.userAskedNotToRecord] decided by the caller from the USER's text
   */
  function appendTurn (t = {}) {
    try {
      if (!t.conversationId || typeof t.conversationId !== 'string') {
        return { ok: false, written: false, reason: 'no_conversation_id' }
      }
      if (!ROLES.includes(t.role)) {
        return { ok: false, written: false, reason: 'bad_role' }
      }

      // THE OWNER'S OPT-OUT WINS BEFORE ANYTHING IS WRITTEN. Not redacted-and-stored:
      // not stored. The audit records that a turn was skipped and nothing about it.
      if (t.userAskedNotToRecord === true) {
        audit('turn_skipped', { conversationId: t.conversationId, turnIndex: t.turnIndex, reason: 'owner_asked_not_to_record' })
        return { ok: true, written: false, reason: 'owner_asked_not_to_record' }
      }

      const { text, hits } = redact(t.text)

      const record = {
        schemaVersion: SCHEMA_VERSION,
        id: 'turn_' + newId(),
        conversationId: t.conversationId,
        turnIndex: Number.isInteger(t.turnIndex) ? t.turnIndex : null,
        role: t.role,
        text,
        at: stamp(),
        model: t.model || null,
        provider: t.provider || null,
        lane: t.lane || null,
        requestId: t.requestId || null,
        // WHAT WAS REMOVED, BY KIND ONLY. The kinds make a redaction auditable; the values
        // would put the secret back into the file it was removed from.
        redactedKinds: hits.length ? [...new Set(hits)] : []
      }

      appendLine(archivePath, record)
      return { ok: true, written: true, id: record.id, redactedKinds: record.redactedKinds }
    } catch (err) {
      // FAIL-OPEN. The caller completes the conversation; the failure is reported, not thrown.
      audit('write_failed', { conversationId: t && t.conversationId, turnIndex: t && t.turnIndex, error: err && err.code ? err.code : 'unknown' })
      return { ok: false, written: false, reason: 'write_failed', error: err && err.message ? err.message : String(err) }
    }
  }

  /** Every record currently in the archive. Owner-side only; never reached by the model. */
  function readAll () {
    let raw
    try { raw = fs.readFileSync(archivePath, 'utf8') } catch (_) { return [] }
    const out = []
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue
      // A malformed line is skipped and counted, never thrown on: one bad line must not make
      // the whole archive unreadable.
      try { out.push(JSON.parse(line)) } catch (_) { }
    }
    return out
  }

  function readAudit () {
    let raw
    try { raw = fs.readFileSync(auditPath, 'utf8') } catch (_) { return [] }
    return raw.split(/\r?\n/).filter((l) => l.trim()).map((l) => { try { return JSON.parse(l) } catch (_) { return null } }).filter(Boolean)
  }

  /**
   * Remove records, and record the removal.
   *
   * @param {object} sel exactly one of: {turnId} | {conversationId} | {from,to} | {all:true}
   */
  function remove (sel = {}) {
    const before = readAll()
    let keep
    let what

    if (sel.all === true) {
      keep = []
      what = { scope: 'all' }
    } else if (sel.turnId) {
      keep = before.filter((r) => r.id !== sel.turnId)
      what = { scope: 'turn', turnId: sel.turnId }
    } else if (sel.conversationId) {
      keep = before.filter((r) => r.conversationId !== sel.conversationId)
      what = { scope: 'conversation', conversationId: sel.conversationId }
    } else if (sel.from || sel.to) {
      const from = sel.from ? Date.parse(sel.from) : -Infinity
      const to = sel.to ? Date.parse(sel.to) : Infinity
      if (Number.isNaN(from) || Number.isNaN(to)) return { ok: false, reason: 'bad_date_range' }
      keep = before.filter((r) => {
        const at = Date.parse(r.at)
        return !(at >= from && at <= to)
      })
      what = { scope: 'range', from: sel.from || null, to: sel.to || null }
    } else {
      return { ok: false, reason: 'no_selector' }
    }

    const removed = before.length - keep.length
    try {
      ensureRoot()
      // Rewrite via temp + rename: a reader sees the old file or the new one, never a half
      // deletion. This is the one operation that is not an append, and it is audited.
      const tmp = archivePath + '.tmp-' + newId()
      fs.writeFileSync(tmp, keep.map((r) => JSON.stringify(r)).join('\n') + (keep.length ? '\n' : ''), 'utf8')
      fs.renameSync(tmp, archivePath)
    } catch (err) {
      audit('delete_failed', Object.assign({}, what, { error: err && err.code ? err.code : 'unknown' }))
      return { ok: false, reason: 'delete_failed', error: err && err.message }
    }

    // Counts and selectors only. The deleted text is not preserved anywhere — an audit that
    // kept it would be a copy of the thing the Owner asked to be gone.
    audit('deleted', Object.assign({}, what, { removed, remaining: keep.length }))
    return { ok: true, removed, remaining: keep.length }
  }

  /**
   * Everything, as one JSON document, for the Owner to take away.
   *
   * The export carries the same content as the archive, so it is exactly as sensitive as the
   * archive and inherits every warning above.
   */
  function exportAll () {
    const turns = readAll()
    const conversations = {}
    for (const t of turns) {
      if (!conversations[t.conversationId]) conversations[t.conversationId] = []
      conversations[t.conversationId].push(t)
    }
    for (const id of Object.keys(conversations)) {
      conversations[id].sort((a, b) => (a.turnIndex ?? 0) - (b.turnIndex ?? 0) || String(a.at).localeCompare(String(b.at)))
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: stamp(),
      note: 'Contains verbatim conversation text. Redaction is best-effort and this file must be treated as containing secrets.',
      turnCount: turns.length,
      conversationCount: Object.keys(conversations).length,
      conversations
    }
  }

  function stats () {
    const turns = readAll()
    const ids = new Set(turns.map((t) => t.conversationId))
    return {
      root,
      turnCount: turns.length,
      conversationCount: ids.size,
      firstAt: turns.length ? turns[0].at : null,
      lastAt: turns.length ? turns[turns.length - 1].at : null,
      auditEvents: readAudit().length
    }
  }

  return { appendTurn, readAll, readAudit, remove, exportAll, stats, paths: { root, archivePath, auditPath } }
}

module.exports = {
  createConversationArchive,
  DEFAULT_ROOT,
  ARCHIVE_FILE,
  AUDIT_FILE,
  SCHEMA_VERSION,
  ROLES
}
