'use strict'

/**
 * invoiceBacklog.test.js — what is waiting in Drive, and what she is allowed to say about it.
 *
 * The Owner's KPI for this whole project: 「what manual work will Louie never do again?」
 * Franco scans into 「Scanned by Franco」; the Owner moves the batches into 00_Inbox; every
 * downstream step then works. When he is busy the move does not happen and the pipeline
 * stops — 1 invoice ingested in 30 days.
 *
 * Phase 1 is READ ONLY: she says what is waiting. She does not move anything.
 *
 * ── THE FIVE STATES NEVER MERGE ──────────────────────────────────────────────
 * 「nothing to move」 and 「I could not look」 are different answers, and with the shared-drive
 * defect unfixed the wrong one would have been shown — a folder holding 64 files returned an
 * empty list. A missing folder is a THIRD answer again: a rename must fail loudly, never
 * read as good news.
 */

const { test, describe } = require('node:test')
const { CATALOGUE } = require('../i18n/catalogue')
const assert = require('node:assert')
const { readInvoiceBacklog, FOLDERS, BACKLOG_STATE, sentenceFor } = require('./invoiceBacklog')

const FOLDER = 'application/vnd.google-apps.folder'

/** A fake drive whose responses are keyed by the parent folder id in the query. */
function fakeDrive (byParent, opts = {}) {
  return {
    files: {
      list: async ({ q }) => {
        if (opts.throwOn && opts.throwOn.test(q)) throw new Error(opts.message || 'boom')
        const m = /'([^']+)' in parents/.exec(q || '')
        const id = m ? m[1] : null
        return { data: { files: byParent[id] || [] } }
      }
    }
  }
}

const batch = (id, name, created) => ({ id, name, mimeType: FOLDER, createdTime: created, modifiedTime: created })
const doc = (id, name, created) => ({ id, name, mimeType: 'application/pdf', createdTime: created, modifiedTime: created })

describe('invoice backlog — folders are declared by ID, never by name', () => {
  test('the declared folder ids are the ones measured live', () => {
    assert.strictEqual(FOLDERS.scannedByFranco.id, '1-A2R1fTvCrPgIeDG3iq_U4wyV388qDGI')
    assert.strictEqual(FOLDERS.inbox.id, '1Jmovov85L4vwvOUWZ1ffrUSw71JVBz4F')
  })

  test('no lookup by name exists — a rename must not silently change what is read', () => {
    const src = require('fs').readFileSync(require.resolve('./invoiceBacklog'), 'utf8')
    assert.ok(!/name\s*=\s*'/.test(src), 'must not query Drive by folder name')
  })
})

describe('invoice backlog — the five states', () => {
  test('FILES_WAITING: counts files nested one level inside the batch folders', async () => {
    const drive = fakeDrive({
      [FOLDERS.scannedByFranco.id]: [
        batch('b1', 'Invoices_20260704', '2026-07-04T00:00:00Z'),
        batch('b2', 'Invoices_20260728', '2026-07-28T00:00:00Z'),
        batch('b3', 'Invoices_20260612', '2026-06-13T00:00:00Z') // empty
      ],
      b1: [doc('f1', 'a.pdf', '2026-07-04T00:00:00Z'), doc('f2', 'b.pdf', '2026-07-04T00:00:00Z')],
      b2: [doc('f3', 'c.pdf', '2026-07-28T00:00:00Z')],
      b3: [],
      [FOLDERS.inbox.id]: [doc('i1', 'x.pdf', '2026-06-13T00:00:00Z')]
    })
    const r = await readInvoiceBacklog({ drive, now: () => new Date('2026-08-05T00:00:00Z') })

    assert.strictEqual(r.scanned.state, BACKLOG_STATE.FILES_WAITING)
    assert.strictEqual(r.scanned.fileCount, 3)
    assert.strictEqual(r.scanned.batchCount, 3)
    assert.strictEqual(r.scanned.nonEmptyBatchCount, 2, 'empty batches are counted separately, not hidden')
    assert.strictEqual(r.scanned.oldestBatchAgeDays, 53, 'age comes from createdTime, not modifiedTime')
    assert.strictEqual(r.inbox.state, BACKLOG_STATE.FILES_WAITING)
    assert.strictEqual(r.inbox.fileCount, 1)
  })

  test('EMPTY: read succeeded and there is genuinely nothing', async () => {
    const drive = fakeDrive({ [FOLDERS.scannedByFranco.id]: [], [FOLDERS.inbox.id]: [] })
    const r = await readInvoiceBacklog({ drive, now: () => new Date('2026-08-05T00:00:00Z') })
    assert.strictEqual(r.scanned.state, BACKLOG_STATE.EMPTY)
    assert.strictEqual(r.scanned.fileCount, 0)
  })

  test('READ_FAILED carries a reason and is NOT the empty answer', async () => {
    const drive = fakeDrive({}, { throwOn: /in parents/, message: 'insufficient permissions' })
    const r = await readInvoiceBacklog({ drive, now: () => new Date('2026-08-05T00:00:00Z') })
    assert.strictEqual(r.scanned.state, BACKLOG_STATE.READ_FAILED)
    assert.notStrictEqual(r.scanned.state, BACKLOG_STATE.EMPTY)
    assert.match(r.scanned.reason, /insufficient permissions/)
    assert.strictEqual(r.scanned.fileCount, null, 'a failed read reports NO number, not zero')
  })

  test('NOT_LOOKED when there is no drive service at all', async () => {
    const r = await readInvoiceBacklog({ drive: null, now: () => new Date('2026-08-05T00:00:00Z') })
    assert.strictEqual(r.scanned.state, BACKLOG_STATE.NOT_LOOKED)
    assert.strictEqual(r.scanned.fileCount, null)
  })

  test('FOLDER_NOT_FOUND is its own state — a 404 must never read as "nothing to move"', async () => {
    const drive = {
      files: {
        list: async () => { const e = new Error('File not found: 1-A2R...'); e.code = 404; throw e }
      }
    }
    const r = await readInvoiceBacklog({ drive, now: () => new Date('2026-08-05T00:00:00Z') })
    assert.strictEqual(r.scanned.state, BACKLOG_STATE.FOLDER_NOT_FOUND)
    assert.strictEqual(r.scanned.fileCount, null)
  })
})

describe('invoice backlog — the honest sentence', () => {
  test('names what was counted, how old, AND what was not looked at', () => {
    const s = sentenceFor({
      scanned: { state: BACKLOG_STATE.FILES_WAITING, fileCount: 64, batchCount: 7, nonEmptyBatchCount: 4, oldestBatchAgeDays: 53 },
      inbox: { state: BACKLOG_STATE.FILES_WAITING, fileCount: 2 }
    })
    assert.match(s, /64/)
    assert.match(s, /53/)
    // The Owner's ruling: keep this line verbatim. It is the difference between a number he
    // can act on and a number he will misread as an invoice count.
    // ⛔ KEPT AS WORDING, in BOTH languages. The Owner's ruling was that this line stays
    // verbatim: it is the difference between a number he can act on and one he misreads as an
    // invoice count. Verbatim in Chinese only would have been half the ruling.
    assert.ok(
      s.includes(CATALOGUE['backlog.countCaveat'].zh),
      'the third line must be present verbatim'
    )
  })

  /**
   * OWNER RULING REVERSED, 2026-08-06. The earlier instruction was 「show nothing when
   * nothing is waiting」. It was wrong, and one round was lost to exactly that:
   *
   *   「a silent screen cannot distinguish clear from broken, and broken is the case that
   *    costs me a month of invoices」
   *
   * 冇時間戳嘅「冇嘢等緊」同一個壞咗嘅檢查睇落一模一樣.
   */
  test('a clear result SPEAKS, and proves it looked by naming the time', () => {
    const s = sentenceFor({
      scanned: { state: BACKLOG_STATE.EMPTY, fileCount: 0 },
      inbox: { state: BACKLOG_STATE.EMPTY, fileCount: 0 },
      checkedAt: '2026-08-06T00:47:00.000Z'
    }, { timeZone: 'UTC' })
    assert.ok(s, 'silence cannot distinguish clear from broken')
    assert.match(s, /00:47/, 'the clear line must carry the time it looked')
    assert.match(s, /Scanned by Franco/, 'it must name what it checked')
  })

  test('a clear line is SHORTER than a waiting line — lighter when clear, heavier when something waits', () => {
    const clear = sentenceFor({
      scanned: { state: BACKLOG_STATE.EMPTY, fileCount: 0 },
      inbox: { state: BACKLOG_STATE.EMPTY, fileCount: 0 },
      checkedAt: '2026-08-06T00:47:00.000Z'
    }, { timeZone: 'UTC' })
    const waiting = sentenceFor({
      scanned: { state: BACKLOG_STATE.FILES_WAITING, fileCount: 64, batchCount: 7, nonEmptyBatchCount: 4, oldestBatchAgeDays: 53 },
      inbox: { state: BACKLOG_STATE.FILES_WAITING, fileCount: 2 },
      checkedAt: '2026-08-06T00:47:00.000Z'
    }, { timeZone: 'UTC' })
    assert.ok(clear.length < waiting.length / 2, 'the clear state must not become furniture')
  })

  test('silence is reserved for "the feature is off" and nothing else', () => {
    const s = sentenceFor({
      scanned: { state: BACKLOG_STATE.NOT_LOOKED, fileCount: null },
      inbox: { state: BACKLOG_STATE.NOT_LOOKED, fileCount: null }
    })
    assert.strictEqual(s, null, 'NOT_LOOKED is the only silent state')
  })

  test('a failed read SPEAKS — silence would read as "nothing waiting"', () => {
    const s = sentenceFor({
      scanned: { state: BACKLOG_STATE.READ_FAILED, fileCount: null, reason: 'timeout' },
      inbox: { state: BACKLOG_STATE.READ_FAILED, fileCount: null, reason: 'timeout' }
    })
    assert.ok(s && /看不到/.test(s), 'a read failure must produce a sentence, not silence')
    assert.ok(!/^0 /.test(s))
  })

  test('never claims a number of invoices', () => {
    const s = sentenceFor({
      scanned: { state: BACKLOG_STATE.FILES_WAITING, fileCount: 64, batchCount: 7, nonEmptyBatchCount: 4, oldestBatchAgeDays: 53 },
      inbox: { state: BACKLOG_STATE.EMPTY, fileCount: 0 }
    })
    assert.ok(!/\d+\s*張發票/.test(s.replace('數不到裡面有多少張發票', '')),
      'must not assert a count of invoices anywhere')
  })
})

describe('invoice backlog — the read must fit inside the greeting budget', () => {
  test('batch folders are read CONCURRENTLY, not one after another', async () => {
    // Measured 2026-08-06: eight SEQUENTIAL Drive calls took 3.2-5.6s against a 2.5s route
    // budget, so every cold read timed out and rendered as silence — indistinguishable from
    // 「nothing waiting」. The same work issued concurrently measured 1.0-1.4s.
    let inFlight = 0
    let peak = 0
    const drive = {
      files: {
        list: async ({ q }) => {
          inFlight++; peak = Math.max(peak, inFlight)
          await new Promise((r) => setTimeout(r, 15))
          inFlight--
          const m = /'([^']+)' in parents/.exec(q || '')
          const id = m ? m[1] : null
          if (id === FOLDERS.scannedByFranco.id) {
            return { data: { files: [
              batch('b1', 'B1', '2026-07-01T00:00:00Z'),
              batch('b2', 'B2', '2026-07-02T00:00:00Z'),
              batch('b3', 'B3', '2026-07-03T00:00:00Z'),
              batch('b4', 'B4', '2026-07-04T00:00:00Z')
            ] } }
          }
          if (id === FOLDERS.inbox.id) return { data: { files: [] } }
          return { data: { files: [doc('f' + id, 'x.pdf', '2026-07-05T00:00:00Z')] } }
        }
      }
    }
    const r = await readInvoiceBacklog({ drive, now: () => new Date('2026-08-06T00:00:00Z') })
    assert.strictEqual(r.scanned.fileCount, 4)
    assert.ok(peak >= 4, 'the four batch reads must overlap; peak concurrency was ' + peak)
  })

  test('the result records WHEN it looked — a number with no time cannot prove it is fresh', async () => {
    const drive = fakeDrive({ [FOLDERS.scannedByFranco.id]: [], [FOLDERS.inbox.id]: [] })
    const r = await readInvoiceBacklog({ drive, now: () => new Date('2026-08-06T00:47:00Z') })
    assert.strictEqual(r.checkedAt, '2026-08-06T00:47:00.000Z')
  })
})
