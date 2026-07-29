'use strict'

/**
 * assertionRegistry.test.js — Phase 3b. THE CROSS-CHECK THAT TURNS ID DRIFT INTO A FAILURE.
 *
 * The register exists because three drifts were found by reading code and register side by
 * side, and the Owner's conclusion was the right one: if one number can change meaning
 * unnoticed, EVERY number is unverified until re-read. Re-reading is not a control. A test
 * is.
 *
 * So this file asserts, mechanically:
 *   . every id a probe or harness can emit EXISTS in the register
 *   . target, access mask and expectation match the register field for field
 *   . every negative names a positive control that is present AND holding IN THE SAME RUN
 *   . POS-* rows are registered too — an unregistered control is the same class of risk
 *   . the pinned fingerprints fail if an id's meaning changes without the id changing
 *   . the checker is itself capable of failing, demonstrated on each rule
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const R = require('./assertionRegistry')

const SCRIPTS = path.resolve(__dirname, '..', '..', 'scripts', 'computer')

/* ── shape ────────────────────────────────────────────────────────────────── */

test('every entry declares the fields the register is for', () => {
  for (const e of R.ASSERTIONS) {
    assert.match(e.id, /^[A-Za-z0-9_-]+$/, 'id is a stable token: ' + e.id)
    assert.ok(e.title && e.title.length > 5, e.id + ' has a human title')
    assert.ok((e.target === null) !== (e.targetPattern === null), e.id + ' declares exactly one of target / targetPattern')
    assert.ok(Array.isArray(e.mechanism) && e.mechanism.length > 0, e.id + ' names at least one mechanism class')
    for (const m of e.mechanism) assert.ok(R.MECHANISM_CLASSES.includes(m), e.id + ' mechanism class is known: ' + m)
    assert.equal(typeof e.expectedPermitted, 'boolean', e.id + ' declares an expectation')
    assert.ok(['A', 'B'].includes(e.tier), e.id + ' has a tier')
    assert.ok(e.implies && e.doesNotImply, e.id + ' states what it does and does not license')
    if (e.accessMask !== null) assert.equal(typeof e.accessMask, 'number', e.id + ' access mask is numeric')
  }
})

test('ids are unique — a collision is what produced this file', () => {
  const seen = new Set()
  for (const id of R.ids()) {
    assert.equal(seen.has(id), false, 'duplicate id: ' + id)
    seen.add(id)
  }
  assert.equal(seen.size, R.ASSERTIONS.length)
})

test('*** every negative names a positive control that is itself registered and positive ***', () => {
  for (const e of R.ASSERTIONS) {
    if (e.expectedPermitted !== false) continue
    assert.ok(e.positiveControlId, e.id + ' is a negative and must name a positive control')
    const ctrl = R.get(e.positiveControlId)
    assert.ok(ctrl, e.id + ' names a control that does not exist: ' + e.positiveControlId)
    assert.equal(ctrl.expectedPermitted, true, e.id + ' control must itself be expect-permitted')
  }
})

test('*** the POS-* rows are registered, not harness-only ***', () => {
  // The fourth, structural finding: every positive control lived in the harness and in no
  // register at all. It could not DRIFT from a definition because none existed — which is
  // the same risk as a drifted negative, not a smaller one.
  const pos = R.ASSERTIONS.filter((e) => e.id.startsWith('POS-'))
  assert.ok(pos.length >= 11, 'the controls are all here, not just the three the harness had')
  for (const p of pos) assert.equal(p.expectedPermitted, true, p.id + ' is a positive control')
})

/* ── the E7 collision and the E6 narrowing, asserted as facts ─────────────── */

test('*** E7 and E10 are DIFFERENT assertions under different ids ***', () => {
  // The collision: the register said E7 = read another session's MainModule; the harness ran
  // E7 = PROCESS_TERMINATE. The registered E7 was therefore never run while the row looked
  // covered. Terminate now has its own id, and the register says so out loud.
  const e7 = R.get('E7-read-other-session-module')
  const e10 = R.get('E10-terminate-other-session-process')
  assert.ok(e7 && e10)
  assert.notEqual(e7.accessMask, e10.accessMask)
  assert.equal(e10.accessMask, R.MASK.PROCESS_TERMINATE)
  assert.match(e10.doesNotImply, /NOT a replacement for E7/)
  assert.notEqual(e7.positiveControlId, e10.positiveControlId, 'and they do not share a control')
})

test('*** E6 carries the mask it actually ran, and says 0x1000 is NOT implied ***', () => {
  // Owner ruling: narrow denial implies broad denial, so 0x0400 denied entails denial of any
  // mask containing it — the executed assertion is STRONGER than the registered one and the
  // result stands. It does NOT reach PROCESS_QUERY_LIMITED_INFORMATION, which is a separate,
  // weaker right that can be granted independently.
  const e6 = R.get('E6-open-other-session-process')
  assert.equal(e6.accessMask, 0x0400)
  assert.match(e6.implies, /PROCESS_ALL_ACCESS/)
  assert.match(e6.doesNotImply, /0x1000/)

  const e6b = R.get('E6b-open-other-session-process-limited')
  assert.ok(e6b, '0x1000 is asserted on its own, not inferred')
  assert.equal(e6b.accessMask, 0x1000)
  assert.match(e6b.doesNotImply, /directions are not symmetric/,
    'the louis->session-5 probe was corroboration, not the measurement')
})

test('*** the mask-matched controls exist, because D6 used .Handle and is not one ***', () => {
  const d6 = R.get('D6-open-own-session-process')
  assert.equal(d6.accessMask, null)
  assert.match(d6.doesNotImply, /NOT A MASK-MATCHED CONTROL/)
  for (const [neg, ctrl, mask] of [
    ['E6-open-other-session-process', 'POS-open-own-process-query', 0x0400],
    ['E6b-open-other-session-process-limited', 'POS-open-own-process-limited', 0x1000],
    ['E10-terminate-other-session-process', 'POS-open-own-process-terminate', 0x0001]
  ]) {
    assert.equal(R.get(neg).accessMask, mask)
    assert.equal(R.get(ctrl).accessMask, mask, ctrl + ' controls at the SAME mask as ' + neg)
    assert.equal(R.get(neg).positiveControlId, ctrl)
  }
})

test('*** E2 records that the Win32 route was tried and found incapable ***', () => {
  // The route was RUN, not reasoned about: OpenWindowStation refuses a qualified path even
  // for our OWN session's station, and returns the identical error for a session number
  // that does not exist. A negative from it would have been vacuous and would have looked
  // exactly like containment.
  const e2 = R.get('E2-open-other-session-winsta')
  assert.equal(e2.accessMask, R.MASK.DIRECTORY_QUERY)
  assert.match(e2.doesNotImply, /LEAF object DACL is NOT reached/)
  assert.match(e2.doesNotImply, /ABSENT-EXISTENCE, never containment/)
  assert.deepEqual(e2.mechanism, ['ACL'], 'only a nameable access denial counts')

  // and its control is the SAME call on our own container, which is what makes it a
  // measurement of the target rather than of the API
  const ctrl = R.get(e2.positiveControlId)
  assert.equal(ctrl.accessMask, e2.accessMask)
  assert.equal(ctrl.targetPattern, e2.targetPattern)
})

test('E3 states that the desktop object may never be reached at all', () => {
  assert.match(R.get('E3-open-other-session-desktop').doesNotImply, /NOTHING whatever is proven about it/)
})

/* ── E4 cannot settle itself ──────────────────────────────────────────────── */

test('*** E4 declares a post-run verification, and it is a PINNED field ***', () => {
  // THE HOLE (Owner, 2026-07-29): the clipboard sentinel lives on the OWNER's clipboard, so
  // any copy in session 3 between the seed and the measurement silently removes it — and the
  // operator CANNOT DETECT THAT, because checking would mean reading the owner's clipboard,
  // which is exactly what E4 tests. "Not found" then becomes true by construction and scores
  // as containment. The owner sentinel WINDOW has an attestation gate against precisely this;
  // the clipboard had none, and relying on the Owner to remember a step is not a control.
  const e4 = R.get('E4-read-other-session-clipboard')
  assert.ok(e4.postRunVerification, 'the dependency is declared, not remembered')
  assert.match(e4.postRunVerification, /-Verify/)
  assert.match(e4.postRunVerification, /may never be scored BOUNDED/)
  assert.ok(R.PINNED_FIELDS.includes('postRunVerification'),
    'and it is pinned, so it cannot be dropped without a test failing')

  // it is the ONLY entry carrying one — a blanket requirement would mean nothing
  const withVerification = R.ASSERTIONS.filter((e) => e.postRunVerification).map((e) => e.id)
  assert.deepEqual(withVerification, ['E4-read-other-session-clipboard'])
})

test('*** E4 scored BOUNDED without the verification is REFUSED ***', () => {
  const rows = [
    { id: 'POS-read-own-clipboard', target: 'own session clipboard', expectedPermitted: true, verdict: 'ACCEPTED', mechanism: 'PERMITTED' },
    { id: 'E4-read-other-session-clipboard', target: 'session 3 clipboard', expectedPermitted: false, verdict: 'BOUNDED', mechanism: 'ACL' }
  ]
  const r = R.crossCheck(rows)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => /without the required post-run verification/.test(e)))
})

test('PENDING-VERIFY passes the cross-check — it is unfinished, not wrong', () => {
  // The probe's correct output. It is not a pass and it never becomes one by being ignored.
  const rows = [
    { id: 'POS-read-own-clipboard', target: 'own session clipboard', expectedPermitted: true, verdict: 'ACCEPTED', mechanism: 'PERMITTED' },
    { id: 'E4-read-other-session-clipboard', target: 'session 3 clipboard', expectedPermitted: false, verdict: 'PENDING-VERIFY', mechanism: 'ACL' }
  ]
  assert.deepEqual(R.crossCheck(rows).errors, [])
})

test('once verified, the released row is accepted — and has to SAY it was verified', () => {
  const rows = [
    { id: 'POS-read-own-clipboard', target: 'own session clipboard', expectedPermitted: true, verdict: 'ACCEPTED', mechanism: 'PERMITTED' },
    { id: 'E4-read-other-session-clipboard', target: 'session 3 clipboard', expectedPermitted: false, verdict: 'BOUNDED', mechanism: 'ACL', postRunVerified: true }
  ]
  assert.deepEqual(R.crossCheck(rows).errors, [])
})

test('*** the probe and the verifier honour the gate, read from the scripts ***', () => {
  // A rule the producer does not honour is a rule in prose. Read from the real files.
  const topup = fs.readFileSync(path.join(SCRIPTS, 'stage3-topup.ps1'), 'utf8')
  assert.ok(topup.includes("$e4v = 'PENDING-VERIFY'"), 'the top-up never settles E4 itself')
  assert.ok(topup.includes('clipNonce'), 'the run records WHICH seed it measured against')
  assert.ok(topup.includes('pendingVerdict'), 'it carries the verdict the row would earn')

  const clip = fs.readFileSync(path.join(SCRIPTS, 'stage3-owner-clip.ps1'), 'utf8')
  for (const needed of ['$Verify', '$Seed', '$Clear', 'clipboard-sentinel-lost', 'OWNER-CLIP-VERIFY']) {
    assert.ok(clip.includes(needed), 'stage3-owner-clip.ps1 provides ' + needed)
  }
  // -Clear before -Verify would destroy the only thing that could ever resolve E4
  assert.ok(/REFUSED: no -Verify record/.test(clip), '-Clear refuses to run before -Verify')
})

test('E8 records the scope limit the signature check states about itself', () => {
  // It detects the owner SENTINEL COLOUR. It cannot prove the absence of all owner-session
  // content — only that the one marker made deliberately detectable is absent. The register
  // has to say that, or the record reads wider than the evidence.
  assert.match(R.get('E8-capture-other-session-screen').doesNotImply, /sentinel colour only/i)
})

test('*** POS-read_uia_tree-own requires a NON-EMPTY tree ***', () => {
  // Its stored artefact was 0 bytes and the row was ACCEPTED, because read_uia_tree had no
  // vacuous-pass rule at all. The register now states the requirement and observation.js
  // enforces it.
  assert.match(R.get('POS-read_uia_tree-own').implies, /nodeCount > 0/)
})

/* ── pinned fingerprints — a silent meaning change fails here ─────────────── */

/**
 * sha256 over (id, target, targetPattern, accessMask, mechanism, expectedPermitted,
 * positiveControlId, tier). Editing any of them without minting a new id fails this table.
 *
 * IF THIS TEST FAILS: do not update the number. Decide first whether the assertion CHANGED
 * MEANING — if it did, it needs a NEW ID, because reusing one is exactly the E7 defect.
 */
const PINNED = {
  "C4-modify-gate-task": "e41d0fea3ad70eb820e224403baf07a4e80f45e16fcb1289c8a9a1f88d671d39",
  "C4a-gate-action-intact": "097df86e34a0088b0a27b365335414037b27116df5b9848eea5935895c0d5a01",
  "C4b-gate-script-sha": "37af5d2f9a289f18ac0b4ba7bb36f5ac7f2bd534ff23d098de40b68300a6039a",
  "C5-read-gate-task": "3de7fe9ccbc864b48c4784bdb7c58812c181dac89668418fe4399811cbd8f269",
  "C1-register-own-task": "28b7a4faeb44c35e33e339a228a36395c3d8f58ec714fe7b9ba94fa67d270fe0",
  "C2-register-logon-trigger": "23dcd67716eab659bc642f133928d63185a1e59ac1a73db0d9f087d0ff42fa62",
  "C3-register-as-SYSTEM": "bc773c15986b8a651960ea13a7fa1eb57bf7acb9313121f98c69d636ef8c2e4a",
  "A1-write-profile-root": "18ad275519a3293df354c3a49186bce4bde8d6ff5682ff4739be1ff5968f6560",
  "A2-write-temp": "68902963ec0c72ffcab3460295c50f9f41b021e679002efe35a739889236e44c",
  "A3-write-startup": "d9bb70a4d7bc4daf66336eb7cf91b1f62d7b2c1ffc9186e0d8d5ee4a7bae48c6",
  "A4-write-desktop": "7dd3eb0eeb0c483a0f3c53d7898baa0fa4258a3f9f706940b805d418612018e3",
  "A5-set-acl-on-own-dir": "8aefdf9fddfe793e775871cb052d984080eb37d4222849a2118754f8cf255544",
  "A6-write-owner-profile": "79822f2e5669d7d035487760b4d108859027bbd632b2f78bee5fb3a89f79a566",
  "B1-hkcu-run": "8d3b9a4381568f13c957199b65fc1e952f2ce1c05ed59a6c1ccdea3a2f29ebc0",
  "B2-hkcu-runonce": "2f7a33b26dc8e9c0aa32802689c673022babab859742773ac7824985219826dc",
  "B3-user-shell-fldr": "1d459ed44d1162a972a4d4374fb5f6e44391e7510439b003253dda576ed92250",
  "B4-hkcu-environment": "87131217e9fcac6f798074d209b520b8f7e0a5b69dd46d758c424ea9d1ca220d",
  "B5-winnt-windows": "6cbccd880d816e35c0175e06e2864cdce04a05447880bde064af07615c9c7693",
  "B6-policies-explorer": "915d796df6e5a6e99c2b175b1297173aceef8d2b3379617b5e0626bd236cd672",
  "B7-hklm-run": "5797ec16f802921d084bc4f835babeb52cc3ad0fa8c813d4db01b1a64402102a",
  "D5-enumerate-own-session": "f6c2e2bd54ff1efd0a904b834d88d9d9b43f0798071fe78aa638472d82862cad",
  "D6-open-own-session-process": "ffab811fd3acf9e1ee155b414668b8a083648fc9b9667b836f05eec20e3f6d91",
  "E5-enumerate-other-session": "8936c0ab820e9abf46dcceafa0c3b9bbe3651ecf013e424925635a43f2370320",
  "E1-enumerate-other-session-windows": "683f5373cb3b594767ab6ed673be762e5c0db9762862132f287c89428855a39f",
  "E2-open-other-session-winsta": "6400e0853fd42348bf2e59513de660d6ee50882a4940315e855842fad229be80",
  "E3-open-other-session-desktop": "8f3be2e6e4c38cdaf97b813b85bd4898219437314eabbf934d1745351b6c7952",
  "E4-read-other-session-clipboard": "06e9b1ce01bbc3232328cfcfdd7763a6dc0999d432fc5dd88a2e8a6079dbc110",
  "E6-open-other-session-process": "e4c9cb5fb7112db9cfa45a81284d26813c0eaeddaa61d79dc24be99339c849b3",
  "E6b-open-other-session-process-limited": "9e3d0629282efce67939b56398820c1b23fda02551f601cb5af130d7a81897aa",
  "E7-read-other-session-module": "57f4b75f0c401461ee095e53b1abe738d68b02845a0defa821a4b951ab7e7af1",
  "E8-capture-other-session-screen": "74d6c01a0d6d2de77fa4a38baa8272f1fa12cc2a7e6016a06623c1179ad52ab2",
  "E9-read-other-session-cmdline": "58eaaadc3972a4fac14915cf674466f1c693bd96364fad860abcd9a103c175a3",
  "E10-terminate-other-session-process": "fa5a1df141bf687d952c918c37d20ec8c1b8be611682e8431281a0a54d6b4976",
  "POS-list_windows-own": "a26e80640bf9cf58ddf1ab8e73c7840c5bd65201baa7941edee55c74088b5af2",
  "POS-capture_screen": "6bdc145c6c8ee035ba0345042840c74f93ec23a38f28e23b282830bd5f6c4d62",
  "POS-read_uia_tree-own": "ef00f7c0c6629fb8e74354270dd9436451695a8bb2f56326d2b446e2972e22c1",
  "POS-open-own-winsta": "22924084172e836b677439a25fa815a677c9160088e0f3dcfb4b0d30e324f9e4",
  "POS-open-own-desktop": "8b42b9c3ecf6e0ba78baba7208ac8dd9f267446029db321023ad181fd66abe0b",
  "POS-read-own-clipboard": "cd4d2a0f8408661732a7f93ec273b97c1a4151335b579067fa1bcef856fd6f6c",
  "POS-open-own-process-query": "7cef1ec744f011ff8fe80daf9f04141e74d14cdda38151df3acdc1d72a09617d",
  "POS-open-own-process-limited": "41a68405c112cfdc71144c40e1c514aa5d888cfb93762a843801f58e61e425de",
  "POS-open-own-process-terminate": "d25173511eef8a832818243adea350e3c545039e405c618cd64d62c36cc8345b",
  "POS-read-own-module": "d75ba336b0abd6ab9221317d6026eddde44b1f67953b701d0b0e925443d2eb7e",
  "POS-read-own-cmdline": "ef31d5eb82a743d63ca4e649feaa382b847edf32dbe2583184a0267b935937ee"
}

// ALL 44 FINGERPRINTS CHANGED ON 2026-07-29 for a SCHEMA reason, not 44 content reasons:
// `postRunVerification` joined PINNED_FIELDS, and the fingerprint covers the pinned set.
// Exactly one entry has a non-null value for it — E4 — and that change is asserted on its
// own above, so the real edit is not hidden inside a mass re-pin.
test('*** an id cannot change what it means without changing the id ***', () => {
  for (const [id, want] of Object.entries(PINNED)) {
    assert.equal(R.fingerprint(id), want, id + ' changed meaning under the same id')
  }
  assert.deepEqual(R.ids().sort(), Object.keys(PINNED).sort(), 'the pin table covers every id')
})

test('the row count is MEASURED here, not quoted', () => {
  // 24, 26 and 23 were all quoted at different points; 26 was never correct and it
  // propagated because the Owner repeated it from the assistant's own report.
  assert.equal(R.ASSERTIONS.length, Object.keys(PINNED).length)
  assert.equal(R.forTier('A').length + R.forTier('B').length, R.ASSERTIONS.length)
})

/* ── crossCheck, proven capable of failing on each rule ───────────────────── */

const okRows = () => [
  { id: 'POS-open-own-process-query', target: 'own-session process', accessMask: 0x0400, expectedPermitted: true, verdict: 'ACCEPTED', mechanism: 'PERMITTED' },
  { id: 'E6-open-other-session-process', target: 'other-session process', accessMask: 0x0400, expectedPermitted: false, verdict: 'BOUNDED', mechanism: 'ACL' }
]

test('the clean case passes — the control for every failure below', () => {
  const r = R.crossCheck(okRows())
  assert.deepEqual(r.errors, [])
  assert.equal(r.ok, true)
})

test('*** an unregistered id is refused ***', () => {
  const rows = okRows()
  rows.push({ id: 'E42-invented-on-the-spot', target: 'x', expectedPermitted: false, verdict: 'BOUNDED', mechanism: 'ACL' })
  const r = R.crossCheck(rows)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => /not in the register/.test(e)))
})

test('*** a changed target fails, which is drift #1 made mechanical ***', () => {
  const rows = okRows()
  rows[1].target = 'some other object'
  assert.ok(R.crossCheck(rows).errors.some((e) => /target drift/.test(e)))
})

test('*** a changed access mask fails, which is drift #2 made mechanical ***', () => {
  const rows = okRows()
  rows[1].accessMask = 0x1000
  assert.ok(R.crossCheck(rows).errors.some((e) => /accessMask drift/.test(e)))
})

test('*** a flipped expectation fails ***', () => {
  const rows = okRows()
  rows[1].expectedPermitted = true
  assert.ok(R.crossCheck(rows).errors.some((e) => /expectedPermitted drift/.test(e)))
})

test('*** a BOUNDED row naming an unregistered mechanism fails ***', () => {
  const rows = okRows()
  rows[1].mechanism = 'SESSION-ISOLATION'
  assert.ok(R.crossCheck(rows).errors.some((e) => /not a registered class/.test(e)),
    'E6 is an ACL assertion; a session-isolation answer means something else was measured')
})

test('an INVALID row may say UNDETERMINED — that is what INVALID means', () => {
  const rows = okRows()
  rows[1].verdict = 'INVALID'
  rows[1].mechanism = 'UNDETERMINED'
  assert.deepEqual(R.crossCheck(rows).errors, [])
})

test('*** a negative whose control is ABSENT from the run is refused ***', () => {
  const rows = [okRows()[1]]
  const r = R.crossCheck(rows)
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => /absent from this run/.test(e)))
})

test('*** a negative whose control DID NOT HOLD is refused ***', () => {
  const rows = okRows()
  rows[0].verdict = 'INVALID'
  const r = R.crossCheck(rows)
  assert.ok(r.errors.some((e) => /is INVALID, not ACCEPTED/.test(e)),
    'a failed control makes the negative prove nothing — it must not read as containment')
})

test('the same id emitted twice in one run is refused', () => {
  const rows = okRows().concat([okRows()[1]])
  assert.ok(R.crossCheck(rows).errors.some((e) => /emitted twice/.test(e)))
})

/* ── the PowerShell side reads the same register ──────────────────────────── */

test('*** the checked-in JSON projection matches the module exactly ***', () => {
  // The probes run where Node may not be. The JSON is a projection, and a projection that
  // can silently fall behind its source is a second definition — the exact defect the
  // register exists to remove.
  const file = path.join(SCRIPTS, 'assertion-registry.json')
  assert.ok(fs.existsSync(file), 'regenerate: node scripts/computer/generate-assertion-registry.js')
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.deepEqual(onDisk, JSON.parse(JSON.stringify(R.toJSON())),
    'stale projection — regenerate it')
  assert.equal(onDisk.fingerprint, R.registerFingerprint())
})

test('*** every assertion id appearing in a probe script exists in the register ***', () => {
  // Static half of the guarantee. The runtime half is Resolve-AssertionRow, which refuses an
  // unknown id while the probe is running; this catches a typo before anyone runs anything.
  const unknown = []
  for (const f of fs.readdirSync(SCRIPTS).filter((n) => n.endsWith('.ps1'))) {
    const code = fs.readFileSync(path.join(SCRIPTS, f), 'utf8')
    for (const m of code.matchAll(/-Id\s+'([^']+)'/g)) {
      if (!R.has(m[1])) unknown.push(f + ' : ' + m[1])
    }
  }
  // the self-test deliberately probes an unknown id to prove the checker can fail
  const allowed = new Set(['assertionRegistry.ps1 : E99-does-not-exist'])
  assert.deepEqual(unknown.filter((u) => !allowed.has(u)), [])
})

/* ── the PowerShell defects that only appear when nothing is wrong ────────── */

test('*** no probe reads a param that the dot-sourced register would clobber ***', () => {
  // MEASURED: dot-sourcing runs the other script's param() block IN THIS SCOPE.
  // assertionRegistry.ps1 declares -SelfTest and -RegistryPath, so after the dot-source both
  // of the caller's values are silently replaced by $false / $null. `stage3-topup.ps1
  // -SelfTest` therefore ran the FULL REAL MEASUREMENT PATH, and -RegistryPath never worked
  // in any probe. Snapshot before the dot-source, into a name that is genuinely different —
  // PowerShell variable names are CASE-INSENSITIVE, so $SELFTEST is the same variable as
  // $SelfTest and the first fix failed for that reason.
  const CLOBBERED = ['SelfTest', 'RegistryPath']
  for (const f of ['tierA-probe.ps1', 'stage3-harness.ps1', 'stage3-topup.ps1']) {
    const code = fs.readFileSync(path.join(SCRIPTS, f), 'utf8')
    const dotSource = code.indexOf("assertionRegistry.ps1'")
    assert.ok(dotSource > 0, f + ' dot-sources the register')
    const after = code.slice(dotSource)
    for (const p of CLOBBERED) {
      assert.equal(new RegExp('\\$' + p + '\\b').test(after), false,
        f + ' reads $' + p + ' AFTER the dot-source, where it has been overwritten')
    }
  }
})

test('*** the top-up refuses to measure if -SelfTest was bound ***', () => {
  // The backstop, independent of every variable: $PSBoundParameters is captured at binding
  // and a dot-source cannot reach it. Twice a broken flag let the real measurement path run
  // in the OWNER's session and overwrite the clipboard sentinel.
  const code = fs.readFileSync(path.join(SCRIPTS, 'stage3-topup.ps1'), 'utf8')
  assert.match(code, /PSBoundParameters\.ContainsKey\('SelfTest'\)[\s\S]{0,600}exit 14/,
    'reaching the measurement path with -SelfTest bound must exit, not press on')
  assert.match(code, /\$SELF_TEST = \(\$PSBoundParameters\.ContainsKey\('SelfTest'\)/,
    'the flag is sourced from PSBoundParameters, not from the clobberable parameter variable')
})

test('*** empty collections survive being returned and counted ***', () => {
  // Three separate PowerShell 5.1 behaviours, all invisible until nothing is wrong:
  //   . @($x) where $x is a List[object] THROWS "Argument types do not match", even empty
  //   . a function returning @() emits zero objects, so the caller's variable becomes $null
  //   . $null.Count under Set-StrictMode is a terminating error, not 0
  // Together they killed the first real top-up run in the reporting section, after every
  // measurement, having written nothing.
  const reg = fs.readFileSync(path.join(SCRIPTS, 'assertionRegistry.ps1'), 'utf8')
  assert.match(reg, /^Set-StrictMode -Version Latest$/m,
    'the register runs under the same strictness as its callers, or its self-test proves nothing')
  assert.match(reg, /function Get-AssertionRegistryDrift \{ , @/,
    'leading comma so an empty return survives')
  assert.match(reg, /, @\(\$problems\)/, 'same for the control check')

  // Comments are stripped first: these files QUOTE the defective forms in order to explain
  // them, and a scanner that trips on a file's own documentation is the trap this repo has
  // fallen into before.
  // SPLIT ON /\r?\n/, not '\n'. In a JS regex `.` does not match \r — it is a line
  // terminator — so on a CRLF checkout `/^\s*#.*$/` fails to match a comment line and the
  // strip silently does nothing. This repo normalises line endings, so the same file is LF
  // in one working tree and CRLF in another: a scanner that only works on one of them is a
  // scanner that passes until it matters.
  const stripPs = (s) => s.split(/\r?\n/).map((l) => l.replace(/^\s*#.*$/, '')).join('\n')
  for (const f of ['tierA-probe.ps1', 'stage3-harness.ps1', 'stage3-topup.ps1']) {
    const code = stripPs(fs.readFileSync(path.join(SCRIPTS, f), 'utf8'))
    assert.equal(/@\(\$rows\)/.test(code), false, f + ' must not wrap the row List in @() — it throws')
    assert.ok(/\$rows\.ToArray\(\)|\$rowArray/.test(code), f + ' uses ToArray() instead')
    // and no bare .Count on a collection that a function may have returned empty
    assert.equal(/(?<!@\()\$(registryDrift|controlProblems|pendingRows)\.Count/.test(code), false,
      f + ' still has a bare .Count on a possibly-null accumulator')
  }
})

test('*** no probe script defines expectedPermitted at a call site any more ***', () => {
  // "may not define assertions locally", enforced. The -ExpectPermitted parameter is gone
  // from both probes; the value comes from the register or the row does not exist.
  for (const f of ['tierA-probe.ps1', 'stage3-harness.ps1', 'stage3-topup.ps1']) {
    const p = path.join(SCRIPTS, f)
    if (!fs.existsSync(p)) continue
    const code = fs.readFileSync(p, 'utf8')
    assert.equal(/-ExpectPermitted\s+\$(true|false)/.test(code), false,
      f + ' still declares an expectation at a call site')
    assert.ok(/Resolve-AssertionRow/.test(code), f + ' must read the register')
  }
})
