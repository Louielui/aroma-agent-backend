'use strict'

/**
 * computerAudit.test.js — Computer Operator v0, Phase 1.
 *
 * Two things are being pinned here, and they are the answers to the two hardest
 * problems in the design:
 *
 *   1. NARRATION HONESTY. Every factual field is written by the Supervisor from a fixed
 *      allowlist. A field the model invented cannot enter the record even when it is
 *      handed straight in. That is the difference between this and the read-state guard,
 *      which can only DETECT a false claim after the fact.
 *
 *   2. NO CONTENT, EVER. Screenshots stay on the Companion's own disk for 7 days; the
 *      audit keeps a SHA-256 and metadata. Screen text, image bytes, clipboard contents
 *      and credentials are refused outright rather than stripped, because a caller
 *      trying to write them is a bug worth failing on.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  EVIDENCE_RETENTION_DAYS, OUTCOMES, STEP_FIELDS, EVIDENCE_FIELDS, BANNED_KEYS,
  MODEL_WRITABLE_FIELDS, projectStep, projectEvidence, findBannedKey, buildComputerAuditRecord
} = require('./computerAudit')

const SHA = 'a'.repeat(64)

/* ── the model writes nothing ─────────────────────────────────────────────── */

test('*** the model may write NO audit field — the list is empty and enforced ***', () => {
  assert.deepEqual([...MODEL_WRITABLE_FIELDS], [])
  // Anything the model might invent simply does not survive the projection.
  const step = projectStep({
    n: 1, action: 'create_file', outcome: 'ok',
    // everything below is model-shaped noise and must vanish
    summary: 'I successfully created the file',
    modelSaid: 'done!', confidence: 0.99, narration: 'saved it', ok: true, success: true
  })
  for (const invented of ['summary', 'modelSaid', 'confidence', 'narration', 'success']) {
    assert.equal(invented in step, false, 'not in the record: ' + invented)
  }
  assert.deepEqual(Object.keys(step).sort(), [...STEP_FIELDS, 'before', 'after'].sort())
})

test('*** a claimed outcome that is not a real outcome becomes null, not the claim ***', () => {
  assert.deepEqual([...OUTCOMES], ['ok', 'failed', 'refused', 'aborted'])
  for (const fake of ['succeeded', 'done', 'OK', 'ok ', true, 1, {}]) {
    assert.equal(projectStep({ outcome: fake }).outcome, null, 'refused outcome: ' + String(fake))
  }
  assert.equal(projectStep({ outcome: 'ok' }).outcome, 'ok')
})

test('the record\'s overall ok is DERIVED from the steps, never asserted', () => {
  const good = buildComputerAuditRecord({ steps: [{ outcome: 'ok' }, { outcome: 'ok' }] })
  assert.equal(good.ok, true)
  // a caller insisting it went well cannot make it so
  const bad = buildComputerAuditRecord({ ok: true, steps: [{ outcome: 'ok' }, { outcome: 'failed' }] })
  assert.equal(bad.ok, false, 'one failed step means the run is not ok')
  assert.equal(buildComputerAuditRecord({ ok: true, steps: [] }).ok, false, 'no steps is not success')
})

/* ── no content, ever ─────────────────────────────────────────────────────── */

test('*** image bytes, screen text and credentials are REFUSED, not stripped ***', () => {
  for (const key of BANNED_KEYS) {
    assert.throws(
      () => buildComputerAuditRecord({ steps: [{ outcome: 'ok', [key]: 'whatever' }] }),
      /banned key/,
      'must refuse: ' + key
    )
  }
})

test('a banned key hidden deep inside the input is still caught', () => {
  assert.throws(() => buildComputerAuditRecord({
    steps: [{ outcome: 'ok', before: { meta: { extra: { screenText: 'account balance $12,345' } } } }]
  }), /banned key/)
  assert.equal(findBannedKey({ a: { b: { c: { password: 'x' } } } }), 'password')
  assert.equal(findBannedKey({ a: { b: 1 } }), null)
})

test('*** evidence is metadata ABOUT content, never content ***', () => {
  assert.deepEqual([...EVIDENCE_FIELDS], ['screenshotSha256', 'fileSha256', 'fileBytes', 'windowTitle', 'exists'])
  const ev = projectEvidence({ screenshotSha256: SHA, fileSha256: SHA, fileBytes: 12, windowTitle: 'note.txt', exists: true })
  assert.equal(ev.screenshotSha256, SHA)
  assert.equal(ev.windowTitle, 'note.txt')
  // a non-hash where a hash belongs is dropped, so a caller cannot smuggle a payload in
  assert.equal(projectEvidence({ screenshotSha256: 'data:image/png;base64,iVBOR...' }).screenshotSha256, null)
  assert.equal(projectEvidence({ fileSha256: 'not-a-hash' }).fileSha256, null)
  // a window TITLE is short by nature; an essay in that field is a content channel
  assert.equal(projectEvidence({ windowTitle: 'x'.repeat(200) }).windowTitle, null)
})

test('screenshots are retained for 7 days on the Companion account only', () => {
  assert.equal(EVIDENCE_RETENTION_DAYS, 7)
  const rec = buildComputerAuditRecord({ steps: [{ outcome: 'ok' }] })
  assert.equal(rec.evidenceRetentionDays, 7)
  // the record carries a hash, never a path to the image and never the image
  const json = JSON.stringify(rec)
  assert.equal(/\.png|\.jpg|base64|C:\\/.test(json), false, 'no image, no path, no bytes')
})

/* ── shape ────────────────────────────────────────────────────────────────── */

test('the record has the agreed shape and rejects malformed identifiers', () => {
  const rec = buildComputerAuditRecord({
    id: 'caudit_1', createdAt: '2026-07-28T00:00:00.000Z', approvalId: 'appr_x',
    workOrderHash: SHA, who: 'louie',
    steps: [{
      n: 1, action: 'create_file', targetApp: null, startedAt: '2026-07-28T00:00:01.000Z',
      durationMs: 12, outcome: 'ok',
      before: { exists: false },
      after: { exists: true, fileSha256: SHA, fileBytes: 24 }
    }]
  })
  assert.equal(rec.kind, 'computer-audit')
  assert.equal(rec.approvalId, 'appr_x')
  assert.equal(rec.workOrderHash, SHA)
  assert.equal(rec.steps[0].before.exists, false)
  assert.equal(rec.steps[0].after.fileSha256, SHA)
  assert.equal(rec.ok, true)
  // a bogus hash does not become a real one
  assert.equal(buildComputerAuditRecord({ workOrderHash: 'nope' }).workOrderHash, null)
})

test('the module is pure — building a record touches nothing', () => {
  // No fs, no process, no network in the audit builder. Asserted statically below in
  // phase1Inert.test.js; here we simply prove it returns a plain object.
  const rec = buildComputerAuditRecord({ steps: [{ outcome: 'ok' }] })
  assert.equal(typeof rec, 'object')
  assert.equal(JSON.parse(JSON.stringify(rec)).kind, 'computer-audit', 'plain, serializable data')
})
