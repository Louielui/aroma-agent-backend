'use strict'

/**
 * driveSharedDrives.test.js — the Drive adapter must be able to SEE shared drives.
 *
 * ── THE DEFECT THIS PINS ─────────────────────────────────────────────────────
 * `files.list` returns My Drive items ONLY unless the caller passes both
 * `supportsAllDrives` and `includeItemsFromAllDrives`. The adapter passed neither, so every
 * Drive read 香香 has ever done has been My-Drive-only — and a folder on a shared drive came
 * back as an EMPTY LIST, which is indistinguishable from 「the folder is empty」.
 *
 * Measured live on 2026-08-05 with the same credentials:
 *
 *   'Scanned by Franco' (64 files across 4 batches)   WITH flags 7   WITHOUT 0
 *   '00_Inbox'                                        WITH flags 2   WITHOUT 0
 *   the RECENT plan (25 most recently modified)       WITH   25      WITHOUT 1
 *   keyword search 'invoice'                          WITH 1038      WITHOUT 994
 *
 * So: ~4% of keyword matches were invisible, and **24 of the 25 most recent files** were.
 * The recent-files plan is the FALLBACK used whenever a keyword query finds nothing, which
 * is exactly when it is relied on.
 *
 * This is the `count: 43` class — a filtered answer that reads as a complete one — living in
 * our own read layer.
 */

const { test, describe } = require('node:test')
const assert = require('node:assert')
const { createDriveReadAdapter } = require('./driveRead')

/** A fake drive service that records the arguments it was called with. */
function recordingDrive () {
  const calls = []
  return {
    calls,
    files: {
      list: async (args) => { calls.push({ method: 'list', args }); return { data: { files: [] } } },
      get: async (args) => { calls.push({ method: 'get', args }); return { data: { id: 'f1', name: 'n', mimeType: 'application/pdf' } } }
    }
  }
}

describe('drive adapter — shared drives are visible', () => {
  test('searchFiles asks for shared-drive items', async () => {
    const drive = recordingDrive()
    const a = createDriveReadAdapter({ client: drive })
    await a.methods.searchFiles({ q: "name contains 'x'" })
    const { args } = drive.calls[0]
    assert.strictEqual(args.supportsAllDrives, true, 'searchFiles must pass supportsAllDrives')
    assert.strictEqual(args.includeItemsFromAllDrives, true, 'searchFiles must pass includeItemsFromAllDrives')
  })

  test('listFiles asks for shared-drive items — this is the RECENT fallback, 24 of 25 files were invisible', async () => {
    const drive = recordingDrive()
    const a = createDriveReadAdapter({ client: drive })
    await a.methods.listFiles({ pageSize: 25, orderBy: 'modifiedTime desc' })
    const { args } = drive.calls[0]
    assert.strictEqual(args.supportsAllDrives, true, 'listFiles must pass supportsAllDrives')
    assert.strictEqual(args.includeItemsFromAllDrives, true, 'listFiles must pass includeItemsFromAllDrives')
  })

  test('getFile asks for shared-drive support', async () => {
    const drive = recordingDrive()
    const a = createDriveReadAdapter({ client: drive })
    await a.methods.getFile({ fileId: 'f1' })
    const { args } = drive.calls[0]
    assert.strictEqual(args.supportsAllDrives, true, 'getFile must pass supportsAllDrives')
  })

  test('createdTime is requested — "how old is the oldest" cannot be answered from modifiedTime', async () => {
    const drive = recordingDrive()
    const a = createDriveReadAdapter({ client: drive })
    await a.methods.searchFiles({ q: 'x' })
    assert.ok(/createdTime/.test(drive.calls[0].args.fields), 'fields must include createdTime')
  })

  test('createdTime reaches the caller, not just the request', async () => {
    const drive = {
      files: {
        list: async () => ({ data: { files: [{ id: 'a', name: 'n.pdf', mimeType: 'application/pdf', createdTime: '2026-06-13T10:00:16Z', modifiedTime: '2026-07-01T00:00:00Z' }] } })
      }
    }
    const a = createDriveReadAdapter({ client: drive })
    const [row] = await a.methods.searchFiles({ q: 'x' })
    assert.strictEqual(row.fields.createdTime, '2026-06-13T10:00:16Z')
  })
})

describe('drive adapter — a capped page is not a complete answer', () => {
  test('a full page reports itself as truncated rather than looking complete', async () => {
    // Exactly pageSize rows back, and the API offers a nextPageToken. A caller must be able
    // to tell this from a genuinely complete list — that distinction is the whole lesson of
    // `count: 50` on /ai/daily-counts, where the LIMIT was read as a fact.
    const drive = {
      files: {
        list: async () => ({
          data: {
            nextPageToken: 'more',
            files: Array.from({ length: 3 }, (_, i) => ({ id: 'f' + i, name: 'f' + i, mimeType: 'application/pdf', createdTime: '2026-01-0' + (i + 1) + 'T00:00:00Z', modifiedTime: '2026-01-01T00:00:00Z' }))
          }
        })
      }
    }
    const a = createDriveReadAdapter({ client: drive })
    const out = await a.methods.searchFiles({ q: 'x', pageSize: 3 })
    assert.strictEqual(out.length, 3)
    assert.strictEqual(typeof a.methods.searchFiles.lastPageWasTruncated, 'undefined',
      'truncation must not be smuggled onto the function object')
    // The adapter exposes it as an explicit read, never as a side effect.
    assert.strictEqual(a.lastReadTruncated(), true,
      'a full page with a nextPageToken must be reported as truncated')
  })

  test('a short page is not truncated', async () => {
    const drive = { files: { list: async () => ({ data: { files: [{ id: 'a', name: 'a', mimeType: 'application/pdf' }] } }) } }
    const a = createDriveReadAdapter({ client: drive })
    await a.methods.searchFiles({ q: 'x', pageSize: 25 })
    assert.strictEqual(a.lastReadTruncated(), false)
  })
})
