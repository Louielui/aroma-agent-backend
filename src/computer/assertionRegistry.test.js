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
  'C4-modify-gate-task': '1e49013cc49bbe1c2406c4a5618a60f1800e653a15a2501c1f29f9d2238b706e',
  'C4a-gate-action-intact': '67b4b7b3930e2c629000c81e192db1414e3f00e67d8b1b11c526ec7a2d23e06a',
  'C4b-gate-script-sha': '100329a563d4ae5a1fe4c8776311d6b6ff7918ce8bd6b896fb47a23fb56debe7',
  'C5-read-gate-task': 'f0910b1da226a6fba739df3f1c5792a89e354a6e5c7594ae16e5b755bf0c2eb1',
  'C1-register-own-task': '66c7f108f1fe263168da5a5b3ae6b81361004f4af80e28785ef2d3cdd88c46a1',
  'C2-register-logon-trigger': 'a690a502e1309ebf50380f94f21a3d41b6651622f2aa2bc16c83f43f2894907c',
  'C3-register-as-SYSTEM': '06ffe3d4997c4980ae35b020289dbe56644e4bfd00475b7c65b76a0bbc490cb3',
  'A1-write-profile-root': 'd735a13451a9efa3b9483e2c9c4228bfa7acf56fba0c4aa0915866c60aa77f07',
  'A2-write-temp': '8d3d5c26ee42074f44203dd43fcd7129563db414df8f85fd4ae25da41de6e688',
  'A3-write-startup': 'cc3fe34c32fe7ce40dfd4916c99a7069463bd3c5a64e145eb1156d45c00744b2',
  'A4-write-desktop': 'd458e378b1a3a543c89461158c02abd2f9f63142da20c825abe61a78ccd0040b',
  'A5-set-acl-on-own-dir': '61d5d713f8e5228e165e5c94c56d11886a5185b58a8fd7fe7d33813cac0d42ab',
  'A6-write-owner-profile': '9ad51ad6ba42d33c371776158ab958e83f41daf7a427660fcad68261b1a65746',
  'B1-hkcu-run': '5d9db2fec0bda26bfd3992ab869546232efde777ae39f2f06ee29e0ee80d0191',
  'B2-hkcu-runonce': '02f1693034d03d23aecdbf745e82390045ecb66b2de6987e95d9903a39187f0c',
  'B3-user-shell-fldr': 'ccbf85263a434480bd4ffe5b90abcda3f9572ad838b8ad6e16233d6edd82506c',
  'B4-hkcu-environment': 'a35d6a119a24872ba48f2cf39d4da4462a0f3a8634dd63a8373b1ed185dffe73',
  'B5-winnt-windows': '0709c2d55af4177acdb630a6be2b5d98e0d07004dc8eee6ab13c468d3c56759b',
  'B6-policies-explorer': '5ef77009363f7a28f87dcaa549838a14fffacd2d04a58fae79a4fd6a147a14b1',
  'B7-hklm-run': '9c878f55cbc77e92186cf3e23a5890b56d145159dc97384dd7498d41b99b8201',
  'D5-enumerate-own-session': 'bf04a1a5b108812f40912a2ed0e4b7834166203c5625f22648fbb66a712851c5',
  'D6-open-own-session-process': '5126c61480b03ae42fae547ea3b366ccd1cc0b6cd26885f15f6554d665a0ac8d',
  'E5-enumerate-other-session': 'c3fd4bb1613397f1b51480fa2520738d597724b1069b191349f5274ad5fee429',
  'E1-enumerate-other-session-windows': '7bde8f329b1b8cf925414e4084c117dc6af24afc0ff5e38cf721ce26bcd19c63',
  // RE-PINNED 2026-07-29, deliberately, on a measurement — see the entry comments. The
  // previous pins described the Win32 OpenWindowStation route, which was RUN and found
  // incapable of telling isolation from absence. No row was ever produced under the old
  // definition, so nothing recorded is invalidated by the change.
  'E2-open-other-session-winsta': 'b48a63fe6a456926b6bb6f873b7969c8c265093b7866e29f4bd002cdb2e660f4',
  'E3-open-other-session-desktop': '25bf1a341ac3f995e5cbbd7c80f284f80997a0cb5d9c91637efdb01b5bf9d532',
  'E4-read-other-session-clipboard': '7ac7942fbd8b6461bb65390836a5b9a26e5515ef1b4a787dc8736b4ae8131a1b',
  'E6-open-other-session-process': 'b776ff495bb70b80f6468063ce6f8806fd49ba45ff02f89e16387e8eaf46deef',
  'E6b-open-other-session-process-limited': 'e38fe00d69c1fab2c7871e0fc17e01faa03d8f361e065af8b4b6279c02241a52',
  'E7-read-other-session-module': 'b0f083d893e8462f59700fb8922522b37678f3dd92e24da38dc2954afc2b700c',
  'E8-capture-other-session-screen': 'e582b147ca05128e73cba3584773eb7c239e5c4154e94ccbbdabef09322386e0',
  'E9-read-other-session-cmdline': '4537d339fa460de783e1186bf97bd385b258c028520558ef04f33edf7c94798f',
  'E10-terminate-other-session-process': '13582c7e84daa736897858cd758080f9dc8aab6a1a2ac7493b618b91d0399d98',
  'POS-list_windows-own': 'fa81b74775ac022a43a6279b31710df18d7c9de62ed8ae66b7a9babaaadb40d8',
  'POS-capture_screen': '09f96c4b75874d1b4194840cecf62740ef4990dd98ed0362348234fa06297d64',
  'POS-read_uia_tree-own': 'ff1c621d195f90d9da06a44d657062112099aac931fe44ddbddc7b910d004b04',
  'POS-open-own-winsta': 'c11328d1492e0082bb6656ff8caaeccb1fc53007299479fc867acdcd5579c41c',
  'POS-open-own-desktop': '0cde599062b4f8b816e9a2f9224e2ac239ff7213de529647240720c6ce208d4f',
  'POS-read-own-clipboard': 'e4414946274ed63fc7dfc863c7b75e2512757e8c4735def89937301e3077ff26',
  'POS-open-own-process-query': '618d9c74146ff9a802d2f17ebccccc3cf5ce092a8d1016a4e26ef8cee01c0452',
  'POS-open-own-process-limited': '12c4cdff50c648037db15e92222d92772bbb466009cd64f8dab1e90ad805a493',
  'POS-open-own-process-terminate': 'f73e421c477be557bc7f4ae5d86db17422eb99cb3eef7baee430300e39db1d70',
  'POS-read-own-module': 'eb7d0f36c8273e340a38a22991d7b2c731c3882c531d8057b5aa697a799f5812',
  'POS-read-own-cmdline': '6e1c1b4d2e5c31c900a31dd02c1ab8e652edfef6829c17e33dea2140be5d9ad0'
}

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
