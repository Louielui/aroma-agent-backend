'use strict'

/**
 * identityAttestation.test.js — proving WHO before allowing WHAT.
 *
 * The canary reached "press E" with every hash, folder and flag correct, and would still have
 * run as the wrong identity, because nothing ever asked. These tests are the question.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { attest, toAuditRecord, REQUIRED, FORBIDDEN_GROUPS, REQUIRED_FIELDS } = require('./identityAttestation')

/** A snapshot of the Companion doing everything right. */
const good = (over = {}) => Object.assign({
  account: 'AROMABRAIN\\AromaOperator',
  sid: 'S-1-5-21-2042659270-2029498691-2127769412-1009',
  sessionId: 2,
  desktop: 'WinSta0\\Default',
  isElevated: false,
  isInteractive: true,
  integrityLevel: 'Medium',
  groupSids: ['S-1-5-32-545', 'S-1-1-0', 'S-1-5-11'],
  // Added when the collector grew: presence and ENABLED state are different questions, and the
  // collector is identified so a snapshot cannot be scored by a checker expecting other fields.
  administratorsPresent: false,
  administratorsEnabled: false,
  collectorVersion: 1,
  collectorSha256: 'a'.repeat(64),
  processId: 7788,
  attestedAt: '2026-07-31T23:00:00.000Z'
}, over)

test('*** the correct identity attests ***', () => {
  const v = attest(good())
  assert.equal(v.ok, true)
  assert.equal(v.sid, REQUIRED.sid)
  assert.equal(v.desktop, 'WinSta0\\Default')
})

test('*** THE FAILURE THAT STARTED THIS — louis is refused ***', () => {
  // The identity the canary would actually have run as.
  const v = attest(good({
    account: 'AROMABRAIN\\louis',
    sid: 'S-1-5-21-2042659270-2029498691-2127769412-1002'
  }))
  assert.equal(v.ok, false)
  assert.equal(v.refusal, 'wrong_identity')
  assert.match(v.detail, /louis/)
})

test('*** an elevated token is refused, however correct the account ***', () => {
  // The "fix" that was rejected: run Step 2 elevated. It would have opened an ELEVATED Notepad.
  const v = attest(good({ isElevated: true }))
  assert.equal(v.refusal, 'elevated_token')
})

test('*** a privileged GROUP is refused even when the token is not elevated ***', () => {
  // Non-elevated is not the same as unprivileged. A token can carry Administrators and simply
  // not have it enabled, and a check that only reads isElevated would pass it.
  for (const [sid, label] of Object.entries(FORBIDDEN_GROUPS)) {
    const v = attest(good({ groupSids: ['S-1-5-32-545', sid] }))
    assert.equal(v.ok, false, label)
    assert.equal(v.refusal, 'privileged_group', label)
    assert.equal(v.detail, label)
  }
})

test('*** an incomplete attestation is a REFUSAL, never a partial pass ***', () => {
  // The dangerous shape: scoring the fields that happen to be present, so "the token could not
  // be read" quietly becomes "the token was fine".
  for (const field of REQUIRED_FIELDS) {
    const snap = good()
    delete snap[field]
    const v = attest(snap)
    assert.equal(v.ok, false, 'missing ' + field + ' must refuse')
    assert.equal(v.refusal, 'incomplete_attestation', field)
    assert.match(v.detail, new RegExp(field))
  }
  assert.equal(attest(null).refusal, 'no_attestation')
})

test('*** session 0 and non-interactive sessions are refused ***', () => {
  assert.equal(attest(good({ sessionId: 0 })).refusal, 'bad_session', 'session 0 has no desktop')
  assert.equal(attest(good({ sessionId: -1 })).refusal, 'bad_session')
  assert.equal(attest(good({ isInteractive: false })).refusal, 'not_interactive')
  // And it must be THE session the run was admitted for, when one was pinned.
  assert.equal(attest(good({ sessionId: 3 }), Object.assign({}, REQUIRED, { sessionId: 2 })).refusal, 'wrong_session')
  assert.equal(attest(good({ sessionId: 2 }), Object.assign({}, REQUIRED, { sessionId: 2 })).ok, true)
})

test('*** a non-interactive desktop is refused ***', () => {
  for (const d of ['WinSta0\\Winlogon', 'Service-0x0-3e7$\\Default', 'WinSta0\\Screen-saver', '']) {
    const v = attest(good({ desktop: d }))
    assert.equal(v.refusal, 'wrong_desktop', d || '(empty)')
  }
})

test('*** the integrity level must be Medium ***', () => {
  for (const lvl of ['High', 'System', 'Low', 'Untrusted', 'unknown']) {
    assert.equal(attest(good({ integrityLevel: lvl })).refusal, 'wrong_integrity', lvl)
  }
})

test('a SID match with a surprising NAME still stops the run', () => {
  // Not paranoia: it means the pinned record and the machine disagree about who this is, and
  // that disagreement is worth a human look before anything touches a desktop.
  const v = attest(good({ account: 'AROMABRAIN\\SomeoneElse' }))
  assert.equal(v.refusal, 'identity_name_mismatch')
})

test('the identity is pinned by SID, not by name', () => {
  // A recreated account with the same name is a different principal wearing the same label.
  assert.match(REQUIRED.sid, /^S-1-5-21-\d+-\d+-\d+-\d+$/)
  const v = attest(good({ sid: 'S-1-5-21-2042659270-2029498691-2127769412-1099' }))
  assert.equal(v.refusal, 'wrong_identity', 'the name alone does not carry it')
})

test('*** the audit record carries what was measured, including on refusal ***', () => {
  const snap = good({ isElevated: true })
  const rec = toAuditRecord(snap, attest(snap))
  assert.equal(rec.kind, 'identity-attestation')
  assert.equal(rec.ok, false)
  assert.equal(rec.refusal, 'elevated_token')
  // The measurement itself is recorded, not just the verdict — a refusal nobody can inspect
  // afterwards is an opinion.
  assert.equal(rec.account, snap.account)
  assert.equal(rec.sessionId, snap.sessionId)
  assert.deepEqual(rec.groupSids, snap.groupSids)
  assert.equal(rec.expectedSid, REQUIRED.sid)
})

test('the module cannot act — it compares a snapshot and nothing else', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const src = fs.readFileSync(path.join(__dirname, 'identityAttestation.js'), 'utf8')
  const requires = [...src.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1])
  assert.deepEqual(requires, [], 'it imports nothing at all')

  // Comments stripped first: the header says "no process spawning", and a scan of prose would
  // fail the file for stating the very rule it obeys. Third time this class has appeared here,
  // and the answer is the same each time — scan the code.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  for (const banned of ['spawn', 'exec(', 'WindowsIdentity', 'child_process', 'Get-Process']) {
    assert.equal(code.includes(banned), false, 'must not reach the OS itself: ' + banned)
  }
})
