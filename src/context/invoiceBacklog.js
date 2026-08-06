'use strict'

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

  for (const b of batches) {
    let kids
    try {
      kids = await children(drive, b.id)
    } catch (err) {
      // One unreadable batch must not turn the whole answer into a number that looks whole.
      return noNumber(BACKLOG_STATE.READ_FAILED, `batch ${b.name}: ${String((err && err.message) || 'read failed')}`.slice(0, 160))
    }
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
  const scanned = await readFolder(drive, FOLDERS.scannedByFranco, at)
  const inbox = await readFolder(drive, FOLDERS.inbox, at)
  return { scanned, inbox }
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
function sentenceFor (r) {
  const s = r && r.scanned
  const i = r && r.inbox
  if (!s) return null

  if (s.state === BACKLOG_STATE.NOT_LOOKED && (!i || i.state === BACKLOG_STATE.NOT_LOOKED)) return null

  if (s.state === BACKLOG_STATE.FOLDER_NOT_FOUND) {
    return `我搵唔到「${FOLDERS.scannedByFranco.label}」呢個資料夾（id 已經寫死）。可能改咗名或者搬咗——我唔會當佢係空。`
  }
  if (s.state === BACKLOG_STATE.READ_FAILED) {
    return `我睇唔到「${FOLDERS.scannedByFranco.label}」——${s.reason}。等緊幾多份，我而家答唔到。`
  }
  if (s.state === BACKLOG_STATE.EMPTY && (!i || i.fileCount === 0)) return null

  const parts = []
  if (s.state === BACKLOG_STATE.FILES_WAITING) {
    const batchBit = s.nonEmptyBatchCount ? `${s.nonEmptyBatchCount} 個批次、` : ''
    const ageBit = s.oldestBatchAgeDays === null ? '' : `，最舊嗰個批次 ${s.oldestBatchAgeDays} 日前`
    parts.push(`「${FOLDERS.scannedByFranco.label}」有 ${batchBit}共 ${s.fileCount} 個檔案${ageBit}。`)
  } else if (s.state === BACKLOG_STATE.EMPTY) {
    parts.push(`「${FOLDERS.scannedByFranco.label}」係空嘅。`)
  }

  if (i && i.state === BACKLOG_STATE.FILES_WAITING) parts.push(`「${FOLDERS.inbox.label}」有 ${i.fileCount} 項。`)
  else if (i && i.state === BACKLOG_STATE.READ_FAILED) parts.push(`「${FOLDERS.inbox.label}」我睇唔到——${i.reason}。`)

  parts.push('我只數到檔案，數唔到入面有幾多張發票，亦分唔到邊啲你已經處理過。')
  return parts.join('')
}

module.exports = { readInvoiceBacklog, sentenceFor, FOLDERS, BACKLOG_STATE }
