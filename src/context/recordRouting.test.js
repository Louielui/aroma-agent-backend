'use strict'

/**
 * recordRouting.test.js — the record reaches her context, and cannot become permission.
 *
 * ── WHAT WAS MISSING ─────────────────────────────────────────────────────────
 * Measured 2026-08-06: the GitHub connector is LIVE and pointed at her own repo, and
 * `getFileAtRef` returns docs/HOUSE-RULES.md (18,792 chars) successfully. But
 * `planFor('github')` builds only listPullRequests → listCommits, so the method exists on
 * the adapter and is UNREACHABLE from the read layer. She could see commit messages and no
 * file at all.
 *
 * ── AND WHY THE INDEX, NOT THE FILE ──────────────────────────────────────────
 * docs/ is 42 files and ~410,000 characters. Her ENTIRE context block, across all five
 * sources, is maxTotalChars 6000. HOUSE-RULES.md alone is 3x that budget. Handing her the
 * file would be truncated by the provider — a rules file silently missing its later rules.
 */

const { test, describe } = require('node:test')
const assert = require('node:assert')
const { planFor } = require('./readContext')
const { RECORD_STATUS } = require('./developmentRecord')

describe('the record is routable', () => {
  test('a question about a ruling plans a RECORD read, not a commit list', () => {
    const p = planFor('github', { message: '點解 DEFECT-001 冇修？', keywords: ['DEFECT-001'], env: { GITHUB_READ_REPO: 'o/r' } })
    assert.strictEqual(p.method, 'listRecordEntries',
      'a question about the development record must not be answered from commit titles')
  })

  test('an ordinary repo question still plans the old way — nothing is taken away', () => {
    const p = planFor('github', { message: '有咩 PR open 緊？', keywords: ['PR'], env: { GITHUB_READ_REPO: 'o/r' } })
    assert.strictEqual(p.method, 'listPullRequests')
  })

  test('the record plan does NOT fall back to a full file read', () => {
    // 410k chars against a 6000-char block. A fallback that fetches a document would be
    // truncated by the provider, and a truncated rules file is one missing its later rules.
    const p = planFor('github', { message: 'HR-6 講咩？', keywords: ['HR-6'], env: { GITHUB_READ_REPO: 'o/r' } })
    assert.ok(!p.fallback || p.fallback.method !== 'getFileAtRef',
      'the index is the answer; the document is a deliberate follow-up, never an automatic one')
  })

  test('it needs no repo configured — the record is read from this build, not fetched', () => {
    const p = planFor('github', { message: '有咩 house rule？', keywords: ['house rule'], env: {} })
    assert.strictEqual(p.method, 'listRecordEntries',
      'the index must not become unavailable because GITHUB_READ_REPO is unset')
  })
})

describe('what reaches her context', () => {
  const { createRecordReadAdapter } = require('./adapters/recordRead')

  test('entries arrive already rendered as citations, with status and date', async () => {
    const a = createRecordReadAdapter()
    const rows = await a.methods.listRecordEntries({ q: 'HR-6' })
    assert.ok(rows.length > 0, 'HR-6 must be findable')
    const hit = rows.find((r) => /HR-6/.test(r.title))
    assert.ok(hit, 'expected an HR-6 row')
    // The citation is built server-side. She names the rule; she does not compose the stamp.
    assert.match(hit.content, /現行|工作筆記|已推翻|已被取代/)
    assert.match(hit.content, /\d{4}-\d{2}-\d{2}|未標日期/)
  })

  test('a DISPROVEN entry says so in the text that reaches her', async () => {
    const a = createRecordReadAdapter()
    const rows = await a.methods.listRecordEntries({ q: 'DEFECT-001' })
    const hit = rows.find((r) => /DEFECT-001/.test(r.title))
    assert.ok(hit)
    assert.match(hit.content, /已推翻/, 'DEFECT-001 must never reach her looking open')
  })

  test('an OPEN defect does not arrive looking handled', async () => {
    const a = createRecordReadAdapter()
    const rows = await a.methods.listRecordEntries({ q: 'DEFECT-006' })
    const hit = rows.find((r) => /DEFECT-006/.test(r.title))
    assert.ok(hit)
    assert.ok(!/已推翻|已修/.test(hit.content), 'an untouched defect must not read as resolved')
  })

  test('no row carries an approval or authorisation field', async () => {
    const a = createRecordReadAdapter()
    const rows = await a.methods.listRecordEntries({ q: 'HR' })
    for (const r of rows) {
      assert.ok(!('approved' in r.fields), 'the record is history, never permission')
      assert.ok(!('authorised' in r.fields) && !('authorized' in r.fields))
    }
  })

  test('the block stays small — the whole point of an index', async () => {
    const a = createRecordReadAdapter()
    const rows = await a.methods.listRecordEntries({ q: 'HR' })
    const total = rows.reduce((n, r) => n + String(r.content).length, 0)
    assert.ok(total <= 4000, 'record rows totalled ' + total + ' chars; the whole block is 6000')
  })

  test('an unmatched query returns nothing rather than everything', async () => {
    const a = createRecordReadAdapter()
    const rows = await a.methods.listRecordEntries({ q: 'zzzz-not-a-real-topic-zzzz' })
    assert.strictEqual(rows.length, 0,
      'returning the whole index on a miss would flood the block and bury the other sources')
  })
})
