'use strict'

/**
 * observationPrivacy.test.js — E0-W1 COMMIT A. The durable/ephemeral boundary for window titles.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE RULING, 2026-08-05, AND WHAT IT SUPERSEDED.
 *
 * > **Owner: 「a window title can carry a customer name or an email subject, and once it is in
 * > an offsite backup it is out.」**
 *
 * `.aroma/computer-audit/` mirrors to Backblaze nightly, so a title written once is offsite
 * that night and cannot be recalled from a backup. `computerAudit.js` on main removed
 * `windowTitle` from `EVIDENCE_FIELDS` the same day and kept only a derived `windowChanged`
 * bit — and recorded why a hash is the WRONG answer: a title has almost no entropy, so
 * 「Inbox - Gmail」 or 「Invoice 88.pdf - Adobe Acrobat」 brute-forces against a dictionary.
 * Obfuscation wearing the word redaction is worse than the title, because it looks solved.
 *
 * ⛔ THE OBSERVATION MODULE CARRIED AN EARLIER, NARROWER RULING. Its comments say own-session
 * window titles are permitted in the audit. That was true when written (2026-07-31) and was
 * SUPERSEDED five days later. The port therefore keeps the ephemeral shape and removes the
 * durable one, rather than importing the file as it stands.
 *
 * ── THE DISTINCTION THIS FILE EXISTS TO HOLD ──────────────────────────────────
 *   EPHEMERAL — returned to an authorised caller, in memory, never written. PERMITTED.
 *   DURABLE   — audit records, evidence artefacts, logs, anything mirrored. REFUSED.
 * Collapsing the two in either direction is the defect: refusing the ephemeral shape would
 * make observation useless, and permitting the durable one is the thing the Owner ruled out.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const O = require('./observation')
const { createEvidenceStore, classify } = require('./evidenceStore')

/* ═══ P1 — the ephemeral shape is structurally allowed ═══════════════════════ */

test('*** P1. AN EPHEMERAL RESULT MAY CARRY titles — ONCE THE SESSION IS PROVEN ***', () => {
  /**
   * ⛔ REVISED IN COMMIT D. THIS TEST PINNED THE DEFECT.
   *
   * As first written it called `validateResult` with `titles: ['A','B']`, no `sessionId` and
   * no `ownSessionId`, and asserted `ok === true`. That is fail-OPEN: the containment check
   * next to it only ran when a caller happened to supply the expected session, so titles
   * sailed through whenever someone forgot to ask. And because a test asserted the passing
   * result was correct, the gap was held in place by something that looked like a proof.
   *
   * It contradicted the invariant the same commit claimed. Absence of proof was being treated
   * as absence of risk — the same shape as `SilentlyContinue` reading access-denied as zero,
   * and as the ranking gate that skipped validation instead of failing closed.
   *
   * ⛔ THE RULE NOW: titles REQUIRE independent session proof. Not proven is not 「unknown」,
   * it is refused. This does not make titles durable — the audit still refuses them outright
   * (P2). It only means an ephemeral title must be shown to be our own before it is returned.
   */
  assert.ok(O.RESULT_FIELDS.includes('titles'), 'titles is a declared RESULT field')

  // 4. array titles + a matching own session — the one shape that is permitted
  const ok = O.validateResult({ ok: true, action: 'list_windows', windowCount: 2, titles: ['A', 'B'], sessionId: 5, at: 1 }, { ownSessionId: 5 })
  assert.equal(ok.ok, true, 'a proven own-session result still validates: ' + JSON.stringify(ok.errors))

  // 1. no ownSessionId — the caller asked for no proof, so there is none
  const noOwn = O.validateResult({ ok: true, action: 'list_windows', titles: ['A', 'B'], sessionId: 5, at: 1 })
  assert.equal(noOwn.ok, false, '⛔ titles passed with no expected session to compare against')
  assert.match(noOwn.errors[0], /ownSessionId/, JSON.stringify(noOwn.errors))

  // 2. no sessionId on the result — nothing to compare, so nothing is proven
  const noSess = O.validateResult({ ok: true, action: 'list_windows', titles: ['A', 'B'], at: 1 }, { ownSessionId: 5 })
  assert.equal(noSess.ok, false, '⛔ titles passed without saying which session produced them')
  assert.match(noSess.errors[0], /sessionId/, JSON.stringify(noSess.errors))

  /**
   * 3. ⛔ AND `titles` MUST BE AN ARRAY. A declared field name was enough to satisfy the
   * generic allowlist, so `titles: "some sensitive text"` — one free-text string rather than
   * a list of window names — passed as a declared field. The type is part of the contract.
   */
  const notArray = O.validateResult({ ok: true, action: 'list_windows', titles: 'some sensitive text', sessionId: 5, at: 1 }, { ownSessionId: 5 })
  assert.equal(notArray.ok, false, '⛔ a free-text string passed as titles')
  assert.match(notArray.errors[0], /array/, JSON.stringify(notArray.errors))

  // and a result with NO titles at all is unaffected — the gate is about titles, not sessions
  const none = O.validateResult({ ok: true, action: 'list_windows', windowCount: 2, at: 1 })
  assert.equal(none.ok, true, 'a titleless result needs no session proof: ' + JSON.stringify(none.errors))
})

test('*** P1b. ⛔ BUT A FOREIGN SESSION\'S TITLES ARE A CONTAINMENT FAILURE, NOT A REDACTION CASE ***', () => {
  // Their presence means isolation failed. Scrubbing them would destroy the only trace.
  const v = O.validateResult(
    { ok: true, action: 'list_windows', windowCount: 1, titles: ['X'], sessionId: 3, at: 1 },
    { ownSessionId: 5 })
  assert.equal(v.ok, false)
  assert.ok(v.errors.join(' ').includes('CONTAINMENT-FAILURE'), 'errors: ' + JSON.stringify(v.errors))
})

/* ═══ P2 / P3 — the durable shape refuses titles ═════════════════════════════ */

test('*** P2. ⛔ THE AUDIT RECORD REFUSES titles OUTRIGHT ***', () => {
  assert.equal(O.AUDIT_FIELDS.includes('titles'), false, '⛔ titles is a durable audit field again')
  const r = O.buildAuditRecord({ at: 1, action: 'list_windows', windowCount: 4, titles: ['Inbox - Gmail'] }, { ownSessionId: 5 })
  assert.equal(r.ok, false, '⛔ a durable record accepted window titles')
  assert.ok(r.errors.join(' ').includes('titles'), 'the refusal names the field: ' + JSON.stringify(r.errors))
})

test('*** P2b. AND THE COUNTS IT REPLACED ARE STILL AUDITABLE ***', () => {
  // ⛔ The fix must not remove the ability to record WHAT HAPPENED. A count is not content.
  const r = O.buildAuditRecord({ at: 1, action: 'list_windows', windowCount: 4, sessionId: 5, outcome: 'observed' }, { ownSessionId: 5 })
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  assert.equal(r.record.windowCount, 4)
  assert.equal('titles' in r.record, false)
})

test('*** P3. ⛔ THE SERIALIZED RECORD CARRIES NEITHER THE KEY NOR THE VALUE ***', () => {
  // Serialization is what reaches the mirror. A field that survives JSON is a field offsite.
  const r = O.buildAuditRecord({ at: 1, action: 'list_windows', windowCount: 1, sessionId: 5 }, { ownSessionId: 5 })
  const json = JSON.stringify(r.record)
  assert.equal(json.includes('titles'), false, '⛔ the key reached the serialized record')
  assert.equal(json.includes('windowTitle'), false, '⛔ the legacy key reached the serialized record')
  assert.equal(json.includes('Inbox'), false)
})

/* ═══ P4 — windowChanged stays server-derived ════════════════════════════════ */

test('*** P4. windowChanged IS DERIVED SERVER-SIDE AND NEITHER TITLE IS KEPT ***', () => {
  const { buildComputerAuditRecord } = require('./computerAudit')
  const rec = buildComputerAuditRecord({
    id: 'caudit_1', approvalId: 'a1', workOrderHash: 'h', who: 'owner', startedAt: 1, finishedAt: 2,
    outcome: 'refused',
    steps: [{
      n: 1, action: 'read_file', targetApp: 'Notepad', startedAt: 1, durationMs: 1, outcome: 'refused',
      // ⛔ The transient input is NOT banned — banning it would break the derivation the
      // Owner kept. What is banned is the durable OUTPUT.
      before: { windowTitle: 'Invoice 88.pdf - Adobe Acrobat' },
      after: { windowTitle: '陳先生 - WhatsApp' }
    }]
  })
  const json = JSON.stringify(rec)
  assert.equal(json.includes('Invoice 88'), false, '⛔ a raw title reached the durable record')
  assert.equal(json.includes('陳先生'), false, '⛔ a raw title reached the durable record')
  assert.equal(json.includes('windowTitle'), false, '⛔ the key itself reached the durable record')
  assert.equal(rec.steps[0].windowChanged, true, 'the one bit it was for survives')
})

test('*** P4b. AND null STAYS DISTINCT FROM false ***', () => {
  // ⛔ 「I could not tell」 is not 「it did not change」. Collapsing them would be the same class
  // of defect as an absent counter reading zero.
  const { buildComputerAuditRecord } = require('./computerAudit')
  const mk = (before, after) => buildComputerAuditRecord({
    id: 'c', approvalId: 'a', workOrderHash: 'h', who: 'o', startedAt: 1, finishedAt: 2, outcome: 'refused',
    steps: [{ n: 1, action: 'read_file', targetApp: 'N', startedAt: 1, durationMs: 1, outcome: 'refused', before, after }]
  }).steps[0].windowChanged
  assert.equal(mk({ windowTitle: 'A' }, { windowTitle: 'A' }), false, 'same title -> false')
  assert.equal(mk({ windowTitle: 'A' }, { windowTitle: 'B' }), true, 'different -> true')
  assert.equal(mk({}, {}), null, '⛔ unknown must be null, never false')
})

/* ═══ P5 — observer-result is not a permanent record retaining titles ════════ */

test('*** P5. ⛔ observer-result.json IS NOT A PERMANENT RECORD ***', () => {
  /**
   * ⛔ THE REFERENCE BRANCH ALLOW-LISTS IT AS NEVER-SWEPT, on the rationale that it carries
   * 「counts and own-session titles」. That rationale is the superseded ruling. A file that may
   * hold titles cannot be the one artefact exempt from deletion, so it takes the conservative
   * classification: it ages out with raw content.
   */
  const c = classify('observer-result.json')
  assert.notEqual(c.kind, 'record', '⛔ a titles-bearing artefact was made permanent')
  assert.equal(c.kind, 'raw', 'it ages out with raw content: ' + JSON.stringify(c))
})

test('*** P5b. THE RETENTION TAXONOMY COVERS THE OBSERVER ARTEFACTS ***', () => {
  assert.equal(classify('obs-abc.png').kind, 'raw', 'observer captures')
  assert.equal(classify('obs-abc.uia.txt').kind, 'raw', 'UIA node text — literally UI text')
  assert.equal(classify('stage3-manifest.json').kind, 'record', 'the nonce chain is never swept')
  // ⛔ FAIL-SAFE: a name nobody classified is not silently swept and not silently kept.
  assert.equal(classify('something-nobody-declared.bin').kind, 'unclassified')
})

test('*** P5c. AND THE SWEEP DELETES RAW CONTENT WHILE KEEPING RECORDS ***', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-ev-'))
  try {
    const store = createEvidenceStore({ baseDir: dir, now: () => 100 * 24 * 60 * 60 * 1000 })
    const old = 1000 // far past retention
    for (const n of ['obs-x.png', 'obs-x.uia.txt', 'observer-result.json', 'stage3-manifest.json', 'mystery.bin']) {
      fs.writeFileSync(path.join(dir, n), 'x')
      fs.utimesSync(path.join(dir, n), old / 1000, old / 1000)
    }
    const r = store.sweep()
    assert.ok(r.deleted.includes('obs-x.png'), 'captures deleted: ' + JSON.stringify(r.deleted))
    assert.ok(r.deleted.includes('obs-x.uia.txt'), 'UI text deleted')
    assert.ok(r.deleted.includes('observer-result.json'), '⛔ a titles-bearing artefact was retained')
    assert.equal(r.deleted.includes('stage3-manifest.json'), false, '⛔ a record was swept')
    assert.equal(r.deleted.includes('mystery.bin'), false, '⛔ an unclassified file was swept')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

/* ═══ I3 — nothing here turns a capability on ════════════════════════════════ */

test('*** P6. NO OBSERVATION CAPABILITY IS ENABLED BY THIS TRANCHE ***', () => {
  assert.deepEqual(O.OBSERVATION_CAPABILITIES, { list_windows: false, read_uia_tree: false, capture_screen: false })
  assert.equal(O.anyObservationEnabled(), false)
  // And a caller cannot widen them.
  const o = O.createObserver({ capabilities: { list_windows: true } })
  assert.equal(o.capabilities.list_windows, false, '⛔ a caller widened a capability')
  assert.equal(o.observe({ action: 'list_windows' }).refusal, 'no_capability_enabled')
})
