'use strict'

const { t } = require('../i18n/t')

/**
 * invoiceBacklog.js — what is waiting in Drive, read-only.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * Franco scans into 「Scanned by Franco」. The Owner moves the batch folders into 00_Inbox.
 * Every downstream step then works — classification, the approval queue, the dual-write.
 * When he is busy the move does not happen and the whole pipeline stops: measured
 * 2026-08-05, **1 invoice ingested in 30 days** while 4 batches sat waiting, the oldest
 * 53 days old.
 *
 * His KPI for the project is 「what manual work will Louie never do again?」 — repetitive,
 * mechanical, zero judgement. This is that work. **Phase 1 only TELLS him.** Moving files
 * needs a write scope and a fence, and is deliberately not built here.
 *
 * ── FOLDERS ARE DECLARED BY ID, NEVER BY NAME ────────────────────────────────
 * A rename must fail LOUDLY (FOLDER_NOT_FOUND), not quietly return zero and read as
 * 「nothing to move」. Looking a folder up by name would convert a rename into good news.
 * Same reasoning as the frozen PATHS table in aromaSystemRead.js.
 *
 * ── THE STATES NEVER MERGE ───────────────────────────────────────────────────
 * 「nothing to move」, 「I could not look」, 「that folder is gone」 and 「I did not look」 are
 * four different answers. Before the shared-drive fix (cd8c9d7) a folder holding 64 files
 * returned an empty list, so the wrong one of these would have been shown — which is the
 * whole reason they are separated here.
 *
 * READ-ONLY. This module lists metadata. It downloads nothing and writes nothing.
 */

const FOLDER_MIME = 'application/vnd.google-apps.folder'

/**
 * Verified live on 2026-08-05: both live on shared drive 0AJApVuax7MarUk9PVA, which is why
 * the shared-drive flags in driveRead.js are a precondition for any of this working.
 */
const FOLDERS = Object.freeze({
  scannedByFranco: Object.freeze({ id: '1-A2R1fTvCrPgIeDG3iq_U4wyV388qDGI', label: 'Scanned by Franco' }),
  inbox: Object.freeze({ id: '1Jmovov85L4vwvOUWZ1ffrUSw71JVBz4F', label: '00_Inbox' })
})

const BACKLOG_STATE = Object.freeze({
  FILES_WAITING: 'FILES_WAITING',
  EMPTY: 'EMPTY',
  FOLDER_NOT_FOUND: 'FOLDER_NOT_FOUND',
  READ_FAILED: 'READ_FAILED',
  NOT_LOOKED: 'NOT_LOOKED'
})

/** A result that carries NO number. A failed read reports null, never 0. */
function noNumber (state, reason) {
  return { state, fileCount: null, batchCount: null, nonEmptyBatchCount: null, oldestBatchAgeDays: null, reason: reason || null }
}

const DAY = 86400000

async function children (drive, folderId) {
  const r = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType,createdTime,modifiedTime)',
    pageSize: 1000,
    orderBy: 'createdTime',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  })
  return (r.data && r.data.files) || []
}

/**
 * Read one folder, counting files ONE LEVEL DOWN as well —「Scanned by Franco」 holds batch
 * folders (Invoices_20260728 …), not loose files, so a flat count would report 7 when 64
 * documents are waiting.
 */
async function readFolder (drive, folder, now) {
  if (!drive) return noNumber(BACKLOG_STATE.NOT_LOOKED)
  let top
  try {
    top = await children(drive, folder.id)
  } catch (err) {
    const code = err && (err.code || err.status)
    if (code === 404 || /not found/i.test(String(err && err.message))) {
      return noNumber(BACKLOG_STATE.FOLDER_NOT_FOUND, `folder id ${folder.id} not found`)
    }
    return noNumber(BACKLOG_STATE.READ_FAILED, String((err && err.message) || 'read failed').slice(0, 160))
  }

  const batches = top.filter((f) => f.mimeType === FOLDER_MIME)
  let fileCount = top.length - batches.length
  let nonEmptyBatchCount = 0

  // CONCURRENTLY, and this is not a micro-optimisation. Measured 2026-08-06: eight
  // SEQUENTIAL calls took 3.2-5.6s against the greeting's 2.5s budget, so every cold read
  // timed out and rendered as SILENCE — indistinguishable from 「nothing waiting」, which is
  // the one thing this whole module exists to prevent. The same work issued concurrently
  // measured 1.0-1.4s.
  let kidsPerBatch
  try {
    kidsPerBatch = await Promise.all(batches.map((b) => children(drive, b.id)))
  } catch (err) {
    // One unreadable batch must not turn the whole answer into a number that looks whole.
    return noNumber(BACKLOG_STATE.READ_FAILED, String((err && err.message) || 'read failed').slice(0, 160))
  }
  for (const kids of kidsPerBatch) {
    const files = kids.filter((k) => k.mimeType !== FOLDER_MIME).length
    fileCount += files
    if (files > 0) nonEmptyBatchCount++
  }

  // Age from createdTime. modifiedTime moves whenever anything touches the folder, so it
  // answers 「when was it last poked」 rather than 「how long has this been waiting」.
  const stamps = (batches.length ? batches : top).map((f) => f.createdTime).filter(Boolean).sort()
  const oldestBatchAgeDays = stamps.length ? Math.floor((now.getTime() - Date.parse(stamps[0])) / DAY) : null

  if (fileCount === 0) {
    return { state: BACKLOG_STATE.EMPTY, fileCount: 0, batchCount: batches.length, nonEmptyBatchCount: 0, oldestBatchAgeDays, reason: null }
  }
  return { state: BACKLOG_STATE.FILES_WAITING, fileCount, batchCount: batches.length, nonEmptyBatchCount, oldestBatchAgeDays, reason: null }
}

/**
 * @param {{ drive: object|null, now?: () => Date }} deps
 * @returns {Promise<{ scanned: object, inbox: object }>}
 */
async function readInvoiceBacklog ({ drive, now } = {}) {
  const at = typeof now === 'function' ? now() : new Date()
  // The two folders are independent; reading them one after the other doubles the latency
  // for no reason. checkedAt is recorded because a number with no time cannot prove it is
  // fresh — and a stale number that looks current is the failure this line exists to avoid.
  const [scanned, inbox] = await Promise.all([
    readFolder(drive, FOLDERS.scannedByFranco, at),
    readFolder(drive, FOLDERS.inbox, at)
  ])
  return { scanned, inbox, checkedAt: at.toISOString() }
}

/** HH:MM in the Owner's zone. Never the browser's, never the process's. */
function clockLabel (iso, opts = {}) {
  if (!iso) return null
  let timeZone = opts.timeZone
  if (!timeZone) {
    try { timeZone = require('../utils/localTime').resolveTimeZone(opts) } catch (_) { return null }
  }
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false })
      .format(new Date(iso))
  } catch (_) { return null }
}

/**
 * The Owner-facing line, or NULL when there is nothing to say.
 *
 * SILENCE IS ONLY FOR 「nothing waiting」. A failed read must SPEAK — staying quiet on a
 * failure would render as 「nothing waiting」 to the only person reading it, which is the
 * exact confusion the states exist to prevent.
 *
 * THE THIRD LINE IS VERBATIM BY OWNER RULING. Without it, 「64」 gets read as 「64 invoices」
 * and the number becomes another count:43. She counts FILES; a scanned PDF may hold several
 * invoices, and 64 files against the Owner's own estimate of 291 is the demonstration.
 */
function sentenceFor (r, opts = {}) {
  const s = r && r.scanned
  const i = r && r.inbox
  if (!s) return null

  // SILENCE IS RESERVED FOR ONE STATE ONLY: the feature is off. Owner ruling 2026-08-06,
  // reversing his earlier one — 「a silent screen cannot distinguish clear from broken, and
  // broken is the case that costs me a month of invoices」.
  if (s.state === BACKLOG_STATE.NOT_LOOKED && (!i || i.state === BACKLOG_STATE.NOT_LOOKED)) return null

  const at = clockLabel(r && r.checkedAt, opts)
  const stamp = at ? t('backlog.checkedAt', { at }) : t('backlog.checkedJustNow')

  if (s.state === BACKLOG_STATE.FOLDER_NOT_FOUND) {
    return t('backlog.folderMissing', { folder: FOLDERS.scannedByFranco.label })
  }
  if (s.state === BACKLOG_STATE.READ_FAILED) {
    return t('backlog.folderUnreadable', { folder: FOLDERS.scannedByFranco.label, reason: s.reason })
  }

  // ── CLEAR. Short, and it names BOTH what it checked and when. A 「冇嘢等緊」 with no
  // timestamp is indistinguishable from a check that silently broke.
  if (s.state === BACKLOG_STATE.EMPTY && (!i || i.fileCount === 0)) {
    return t('backlog.folderEmpty', { folder: FOLDERS.scannedByFranco.label, stamp })
  }

  // ── SOMETHING WAITS. Action first, not the count: what it is, where it is stuck, what to
  // do, and why it matters. 「4 個批次、64 個檔」 on its own is numbers with no noun.
  const parts = []
  if (s.state === BACKLOG_STATE.FILES_WAITING) {
    const batchBit = s.nonEmptyBatchCount ? t('backlog.batchBit', { n: s.nonEmptyBatchCount }) : ''
    const ageBit = s.oldestBatchAgeDays === null ? '' : t('backlog.ageBit', { days: s.oldestBatchAgeDays })
    parts.push(
      t('backlog.waiting', {
        folder: FOLDERS.scannedByFranco.label,
        inbox: FOLDERS.inbox.label,
        batch: batchBit,
        files: s.fileCount,
        age: ageBit
      })
    )
  } else if (s.state === BACKLOG_STATE.EMPTY) {
    parts.push(t('backlog.scannedEmpty', { folder: FOLDERS.scannedByFranco.label }))
  }

  if (i && i.state === BACKLOG_STATE.FILES_WAITING) parts.push(t('backlog.inboxCount', { inbox: FOLDERS.inbox.label, n: i.fileCount }))
  else if (i && i.state === BACKLOG_STATE.READ_FAILED) parts.push(t('backlog.inboxUnreadable', { inbox: FOLDERS.inbox.label, reason: i.reason }))

  // OWNER RULING, VERBATIM AND COMPLETE. He refused the shortened form: whether a batch he
  // has already dealt with is sitting inside that count 「is exactly the difference between
  // the line saving me a trip and costing me one」.
  parts.push(t('backlog.countCaveat'))
  return parts.join('')
}

module.exports = { readInvoiceBacklog, sentenceFor, FOLDERS, BACKLOG_STATE }
