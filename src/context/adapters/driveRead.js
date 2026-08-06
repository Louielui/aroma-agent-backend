'use strict'

/**
 * driveRead.js — READ-ONLY Google Drive adapter (scope drive.readonly). Only
 * search/get read methods; NO create/update/delete/share surface. The authed
 * `drive` service is injected (fake in tests; built from googleAuth in live use).
 * v1 returns file metadata + link (content bounded/empty; text export is a later
 * add). Fails-closed to 'unavailable' when the service is absent.
 *
 * ── SHARED DRIVES (fixed 2026-08-05) ─────────────────────────────────────────
 * `files.list` returns My Drive items ONLY unless BOTH `supportsAllDrives` and
 * `includeItemsFromAllDrives` are passed. They were not, so every Drive read since this
 * adapter was written has been My-Drive-only — and a folder living on a shared drive came
 * back as an EMPTY LIST, indistinguishable from 「the folder is empty」.
 *
 * Measured live with the same credentials, before the fix:
 *
 *     'Scanned by Franco'  (64 files in 4 batches)   WITH flags    7   WITHOUT   0
 *     '00_Inbox'                                     WITH flags    2   WITHOUT   0
 *     RECENT plan (25 most recently modified)        WITH flags   25   WITHOUT   1
 *     keyword 'invoice'                              WITH flags 1038   WITHOUT 994
 *     keyword 'recipe'                               WITH flags  364   WITHOUT 348
 *
 * So keyword search lost ~4% — and the RECENT plan lost **24 of 25**. Recent is the
 * FALLBACK readContext uses when a keyword query finds nothing, i.e. exactly when it is
 * being relied on. This is the `count: 43` class inside our own read layer: a filtered
 * answer that reads as a complete one.
 *
 * ── TRUNCATION IS REPORTED, NOT GUESSED ──────────────────────────────────────
 * There is still no pagination here: one page, `pageSize` rows. That is a deliberate cap,
 * not an accident — but a cap the caller cannot see is how `count: 50` on /ai/daily-counts
 * came to be read as a fact about how many stock-takes exist. So the adapter now records
 * whether the last read was cut off, and `lastReadTruncated()` says so out loud.
 */

const { makeContextResult, ENTITY_TYPES } = require('../contextResult')

/**
 * Passed on EVERY list/get call. Both are required together: `supportsAllDrives` says the
 * client understands shared-drive semantics, `includeItemsFromAllDrives` asks for the items.
 * Passing only the first still returns My Drive alone — which is what made the old behaviour
 * look deliberate.
 */
const ALL_DRIVES = Object.freeze({ supportsAllDrives: true, includeItemsFromAllDrives: true })

/** createdTime is NOT decoration: 「how old is the oldest one」 cannot be answered from
 *  modifiedTime, which moves whenever anything touches the file. */
const FILE_FIELDS = 'files(id,name,mimeType,createdTime,modifiedTime,webViewLink,driveId)'
const LIST_FIELDS = 'nextPageToken, ' + FILE_FIELDS

function createDriveReadAdapter (options = {}) {
  const now = typeof options.clock === 'function' ? options.clock : () => new Date().toISOString()
  const drive = options.client || null
  function ensure () { if (!drive) throw new Error('drive service unavailable (no google credentials)'); return drive }

  // Set by every list call, read by lastReadTruncated(). Held here rather than returned
  // alongside the rows so the shape callers already destructure does not change.
  let truncated = false

  function toRow (f) {
    return makeContextResult({
      source: 'drive',
      sourceId: f.id,
      title: f.name,
      originalDate: f.modifiedTime,
      content: f.mimeType || '',
      link: f.webViewLink,
      retrievedAt: now(),
      entityType: ENTITY_TYPES.FILE,
      fields: {
        name: f.name,
        mimeType: f.mimeType || null,
        createdTime: f.createdTime || null,
        modifiedTime: f.modifiedTime || null,
        driveId: f.driveId || null
      }
    })
  }

  /** One page. Records truncation from BOTH signals the API gives us. */
  async function listPage (args, pageSize) {
    const r = await ensure().files.list({ ...args, ...ALL_DRIVES })
    const files = (r.data && r.data.files) || []
    truncated = Boolean(r.data && r.data.nextPageToken) || files.length >= pageSize
    return files.map(toRow)
  }

  const methods = {
    // `orderBy` is a READ-only sort hint (e.g. 'modifiedTime desc') — it grants no
    // additional access and is what makes the recent-items fallback meaningful.
    async searchFiles ({ q, pageSize = 25, orderBy } = {}) {
      const args = { q, pageSize, fields: LIST_FIELDS }
      if (orderBy) args.orderBy = orderBy
      return listPage(args, pageSize)
    },
    async listFiles ({ pageSize = 25, orderBy } = {}) {
      const args = { pageSize, fields: LIST_FIELDS }
      if (orderBy) args.orderBy = orderBy
      return listPage(args, pageSize)
    },
    async getFile ({ fileId } = {}) {
      const r = await ensure().files.get({
        fileId,
        fields: 'id,name,mimeType,createdTime,modifiedTime,webViewLink,driveId',
        supportsAllDrives: true
      })
      return toRow(r.data)
    }
  }

  return {
    source: 'drive',
    methods,
    ready: () => !!drive,
    /** Was the last list cut off by the page size? An explicit read, never a side effect. */
    lastReadTruncated: () => truncated
  }
}

module.exports = { createDriveReadAdapter, ALL_DRIVES, FILE_FIELDS }
