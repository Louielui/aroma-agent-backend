'use strict'

/**
 * windowTitleRedaction.test.js — the condition that must land before COMPUTER_OPERATOR.
 *
 * Owner ruling: 「a window title can carry a customer name or an email subject, and once it
 * is in an offsite backup it is out.」 The audit mirror wired on 2026-08-05 replicates
 * `.aroma/computer-audit/` to Backblaze nightly, so this is the last moment it can be fixed
 * cheaply — after the flag is on, a title written once is offsite that night and cannot be
 * recalled from a backup.
 *
 * ── WHY NOT A HASH, WHICH WAS THE OBVIOUS ANSWER ────────────────────────────
 * The file already carries `screenshotSha256` and `fileSha256`, so `windowTitleSha256` looks
 * consistent. It is not equivalent, and the difference matters:
 *
 *   A screenshot has enormous entropy. A window title does not.
 *   「Inbox - Gmail」 · 「Invoice 88.pdf - Adobe Acrobat」 · 「陳先生 - WhatsApp」
 *
 * Those are guessable strings. Anyone holding the offsite backup can brute-force a
 * dictionary of plausible titles against the hash and recover them. A hash of a
 * low-entropy string is obfuscation, not redaction — and shipping it while calling it
 * redaction would be worse than shipping the title, because it would look solved.
 *
 * A salted HMAC would resist that, but the salt then has to exist, be stored, be excluded
 * from the same backup, and survive a restore — a key that can be lost, protecting one
 * field.
 *
 * ── WHAT IS KEPT INSTEAD ────────────────────────────────────────────────────
 * The audit question a window title actually answers is: DID THE FOCUSED WINDOW CHANGE
 * between before and after — did the agent type into the window it was supposed to?
 *
 * That is one bit. It is computed at write time from the two titles, and neither title is
 * stored. Nothing to crack, no salt to manage, and the audit property survives intact.
 *
 * TRI-STATE, per HR-5: `null` means one or both titles were absent, which is a different
 * claim from `false` (both present and the same).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { buildComputerAuditRecord, EVIDENCE_FIELDS, STEP_FIELDS } = require('./computerAudit')

const step = (before, after) => ({
  approvalId: 'appr_x',
  workOrderHash: 'a'.repeat(64),
  who: 'louie',
  steps: [{ n: 1, action: 'type_text', outcome: 'ok', before, after }]
})

/* ═══ 1. THE TITLE NEVER REACHES THE RECORD ══════════════════════════════ */

test('*** windowTitle is not an evidence field any more ***', () => {
  assert.equal(EVIDENCE_FIELDS.includes('windowTitle'), false,
    'the title can still be written, and the mirror sends it offsite nightly')
})

test('*** a title supplied by a caller does NOT survive into the record ***', () => {
  const rec = buildComputerAuditRecord(step(
    { windowTitle: '陳先生 - WhatsApp' },
    { windowTitle: 'Invoice 88.pdf - Adobe Acrobat' }
  ))
  const json = JSON.stringify(rec)
  assert.equal(/陳先生|WhatsApp|Invoice 88|Acrobat/.test(json), false, 'a title rode in: ' + json)
  assert.equal(/windowTitle/.test(json), false, 'the key itself survived: ' + json)
})

test('*** and no hash of it either — a low-entropy string hashes to a crackable value ***', () => {
  const rec = buildComputerAuditRecord(step({ windowTitle: 'Inbox - Gmail' }, { windowTitle: 'Inbox - Gmail' }))
  const json = JSON.stringify(rec)
  assert.equal(/windowTitleSha|titleHash|windowTitleHash/.test(json), false,
    'a hash of a guessable title is obfuscation, not redaction')
})

/* ═══ 2. THE AUDIT PROPERTY IS KEPT ══════════════════════════════════════ */

test('*** the one fact that mattered survives: did the focused window change ***', () => {
  assert.ok(STEP_FIELDS.includes('windowChanged'), 'the derived fact is not on the step')

  const changed = buildComputerAuditRecord(step({ windowTitle: 'A - App' }, { windowTitle: 'B - App' }))
  assert.equal(changed.steps[0].windowChanged, true)

  const same = buildComputerAuditRecord(step({ windowTitle: 'A - App' }, { windowTitle: 'A - App' }))
  assert.equal(same.steps[0].windowChanged, false)
})

test('*** NULL IS NOT FALSE — an absent title is unknown, not unchanged ***', () => {
  // HR-5. 「both present and identical」 and 「we could not see one of them」 are different
  // claims, and collapsing them would let a missing observation read as a safe one.
  assert.equal(buildComputerAuditRecord(step({ windowTitle: 'A' }, {})).steps[0].windowChanged, null)
  assert.equal(buildComputerAuditRecord(step({}, { windowTitle: 'B' })).steps[0].windowChanged, null)
  assert.equal(buildComputerAuditRecord(step({}, {})).steps[0].windowChanged, null)
})

test('a caller cannot supply windowChanged itself — it is derived, never accepted', () => {
  const rec = buildComputerAuditRecord({
    approvalId: 'a', workOrderHash: 'b'.repeat(64), who: 'louie',
    steps: [{ n: 1, action: 'type_text', outcome: 'ok', windowChanged: false, before: { windowTitle: 'A' }, after: { windowTitle: 'B' } }]
  })
  assert.equal(rec.steps[0].windowChanged, true, 'a caller-supplied value overrode the derivation')
})

/* ═══ 3. THE CONDITION IS RECORDED WHERE IT WAS PROMISED ═════════════════ */

test('*** the backup doc no longer says this is unbuilt ***', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'AROMA-AUDIT-BACKUP-PROPOSAL.md'), 'utf8')
  assert.equal(/This is \*\*not built\*\*/.test(doc), false,
    'the condition was written as a promise to whoever enables the flag — it must now say it is done')
})
