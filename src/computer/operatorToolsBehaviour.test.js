'use strict'

/**
 * operatorToolsBehaviour.test.js — the three operator tools, actually run.
 *
 * ── THEY HAD NO BEHAVIOUR TESTS AT ALL ─────────────────────────────────────
 * Until now `operatorToolsCommon.js` appeared in three test files, all of which checked the
 * module GRAPH — who imports what, which names are banned. Nothing had ever called a function in
 * it. So the first execution of `checkIdentity` in the history of the project happened on the
 * Owner's machine, in a session he had just switched into, and it failed.
 *
 * ── AND THE JUDGE'S TESTS NEVER RAN THE PRODUCTION CALL SHAPE ──────────────
 * identityAttestation.test.js calls `attest(good())` — always with the `expected` argument
 * OMITTED, which makes it default to REQUIRED, which always matches. Production called
 * `attest(snap, { sid, name })`. Every test was green and the one shape that shipped had never
 * been executed.
 *
 * That is the same failure as the code behind the shut fence, in a different costume: the path
 * that runs in production is not the path the tests take. The remedy used here is the cheap one —
 * the tools are called the way production calls them, with the collector's real snapshot shape.
 *
 * ── FIXTURES MIRROR THE COLLECTOR ──────────────────────────────────────────
 * `good()` below has exactly the fields collect-identity.ps1 emits, spelled the way it spells
 * them. identityFieldContract.test.js is what keeps that true: it parses the .ps1 and fails if a
 * name drifts. A fixture nobody checks against the source is how a test suite comes to agree
 * with its author and with nothing else.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const T = require('../../scripts/computer/operatorToolsCommon')
const { attest, REQUIRED } = require('./identityAttestation')

/** The collector's own shape, for a correct operator session. */
const good = (over) => Object.assign({
  account: 'AROMABRAIN\\AromaOperator',
  sid: 'S-1-5-21-2042659270-2029498691-2127769412-1009',
  processId: 4321,
  sessionId: 5,
  isInteractive: true,
  desktop: 'WinSta0\\Default',
  isElevated: false,
  integrityLevel: 'Medium',
  groupSids: ['S-1-5-32-545'],
  administratorsPresent: false,
  administratorsEnabled: false,
  collectorVersion: 1,
  collectorSha256: 'a'.repeat(64),
  attestedAt: '2026-08-01T12:00:00.000Z'
}, over)

/** A runner that answers the collect-identity script and nothing else. */
const runnerFor = (snap, over = {}) => ({
  calls: [],
  run (id, payload) {
    this.calls.push(id)
    if (over.transportFails) return { ok: false, refusal: 'no_envelope' }
    if (id === 'collect-identity') return { ok: true, result: snap }
    return { ok: true, result: { ok: true } }
  }
})

/** Capture what the tools print. */
function captured (fn) {
  const lines = []
  const orig = process.stdout.write
  process.stdout.write = (s) => { lines.push(String(s).replace(/\r?\n$/, '')); return true }
  try { fn() } finally { process.stdout.write = orig }
  return lines
}

const rowFor = (lines, label) => lines.find((l) => l.trim().startsWith(label)) || ''
const resultLine = (lines) => lines.find((l) => l.includes('RESULT:')) || ''

/* ── checkIdentity: the production call shape ─────────────────────────────── */

test('*** a correct operator session PASSES ***', () => {
  const res = T.checkIdentity({ runner: runnerFor(good()) })
  assert.equal(res.ok, true, 'refusal was: ' + res.refusal)
  assert.equal(res.refusal, null)
  assert.equal(res.snapshot.account, 'AROMABRAIN\\AromaOperator')
})

test('*** REGRESSION — this exact call used to refuse a correct session ***', () => {
  // The shipped call was `attest(snap, { sid: EXPECTED_SID, name: EXPECTED_NAME })`. There is no
  // `name` key; the field is `account`. So expected.account was undefined, the comparison was
  // against the string "UNDEFINED", and a perfect session got identity_name_mismatch.
  const res = T.checkIdentity({ runner: runnerFor(good()) })
  assert.notEqual(res.refusal, 'identity_name_mismatch',
    'a correct session must never be refused for the name')

  // And the malformed shape is now impossible to write by accident: it throws rather than
  // producing a verdict about the machine.
  assert.throws(() => attest(good(), { sid: REQUIRED.sid, name: 'AromaOperator' }),
    /missing required key\(s\): account, desktop/)
  assert.throws(() => attest(good(), {}), /missing required key/)
  assert.throws(() => attest(good(), null), /must be an object/)
})

test('*** the wrong SID is refused ***', () => {
  const res = T.checkIdentity({ runner: runnerFor(good({ account: 'AROMABRAIN\\louis', sid: 'S-1-5-21-2042659270-2029498691-2127769412-1002' })) })
  assert.equal(res.ok, false)
  assert.equal(res.refusal, 'wrong_identity')
})

test('*** an elevated token is refused ***', () => {
  const res = T.checkIdentity({ runner: runnerFor(good({ isElevated: true })) })
  assert.equal(res.refusal, 'elevated_token')
})

test('*** a missing field is refused as incomplete, never scored ***', () => {
  for (const f of ['account', 'sid', 'isElevated', 'isInteractive', 'desktop', 'integrityLevel', 'administratorsEnabled']) {
    const snap = good(); delete snap[f]
    const res = T.checkIdentity({ runner: runnerFor(snap) })
    assert.equal(res.refusal, 'incomplete_attestation', f)
  }
})

test('*** a transport failure is not an identity verdict ***', () => {
  const res = T.checkIdentity({ runner: runnerFor(good(), { transportFails: true }) })
  assert.equal(res.ok, false)
  assert.equal(res.refusal, 'identity_unmeasured', '"I could not ask" is its own answer')
})

/* ── the three display defects, each pinned ───────────────────────────────── */

test('*** DISPLAY 1 — the account is shown, not a blank with a tick ***', () => {
  const lines = captured(() => T.renderIdentity({ ok: true, refusal: null, snapshot: good() }))
  const row = rowFor(lines, 'Account')
  assert.match(row, /AROMABRAIN\\AromaOperator/, 'the real account name appears')
  assert.doesNotMatch(row, /^\s*Account\s+-\s/, 'not a dash')
  assert.match(row, /OK$/)
})

test('*** DISPLAY 2 — a correct desktop session is not marked PROBLEM ***', () => {
  const lines = captured(() => T.renderIdentity({ ok: true, refusal: null, snapshot: good() }))
  const row = rowFor(lines, 'Own desktop session')
  assert.match(row, /session 5/)
  assert.doesNotMatch(row, /PROBLEM/, 'this was the false problem on the Owner\'s screen')
})

test('*** DISPLAY 3 — an elevated token can NEVER print "no / OK" ***', () => {
  // The unseen one, and the dangerous one. `s.elevated` was undefined for every snapshot, so the
  // row printed "no" and ticked OK whatever the token actually was.
  const lines = captured(() => {
    const snap = good({ isElevated: true })
    const v = attest(snap)
    T.renderIdentity({ ok: v.ok === true, refusal: v.refusal, snapshot: snap })
  })
  const row = rowFor(lines, 'Administrator rights')
  assert.match(row, /YES/, 'it says YES')
  assert.match(row, /PROBLEM/, 'and it is the problem')
  assert.doesNotMatch(row, /OK$/)
})

/* ── the RESULT and the row markers are one judgement ─────────────────────── */

test('*** the PROBLEM marker sits on the row the RESULT is about ***', () => {
  // On the Owner's screen the RESULT blamed the account name while the marker sat on the desktop
  // row. Two sources, one screen.
  const cases = [
    [good({ account: 'AROMABRAIN\\louis', sid: 'S-1-5-21-2042659270-2029498691-2127769412-1002' }), 'Account'],
    [good({ isElevated: true }), 'Administrator rights'],
    [good({ groupSids: ['S-1-5-32-545', 'S-1-5-32-544'], administratorsPresent: true }), 'In Administrators group'],
    [good({ isInteractive: false }), 'Own desktop session'],
    [good({ desktop: 'WinSta0\\Winlogon' }), 'Own desktop session']
  ]
  for (const [snap, expectedRow] of cases) {
    const v = attest(snap)
    assert.equal(v.ok, false, 'the fixture really is refused')
    const lines = captured(() => T.renderIdentity({ ok: false, refusal: v.refusal, snapshot: snap }))
    const problems = lines.filter((l) => l.includes('PROBLEM'))
    assert.equal(problems.length, 1, v.refusal + ': exactly one row is the problem')
    assert.ok(problems[0].trim().startsWith(expectedRow),
      v.refusal + ': the marker belongs on "' + expectedRow + '", found: ' + problems[0].trim())
    assert.ok(resultLine(lines).length > 0, 'and a RESULT is printed')
  }
})

test('*** nothing after the first problem is marked OK ***', () => {
  const snap = good({ isElevated: true })
  const lines = captured(() => T.renderIdentity({ ok: false, refusal: attest(snap).refusal, snapshot: snap }))
  const idxProblem = lines.findIndex((l) => l.includes('PROBLEM'))
  const after = lines.slice(idxProblem + 1).filter((l) => /\s{2}\S/.test(l) && !l.includes('RESULT'))
  for (const l of after) {
    if (!l.trim()) continue
    assert.equal(/OK$/.test(l), false, 'the judge stopped, so this was never checked: ' + l.trim())
  }
})

test('*** an unmeasured field is never marked OK ***', () => {
  const snap = good(); delete snap.account
  const v = attest(snap)
  assert.equal(v.refusal, 'incomplete_attestation')
  const lines = captured(() => T.renderIdentity({ ok: false, refusal: v.refusal, snapshot: snap }))
  const row = rowFor(lines, 'Account')
  assert.match(row, /not measured/)
  assert.doesNotMatch(row, /OK$/, 'a value that does not exist cannot pass')
})

test('*** a passing session marks every row OK, and says so once ***', () => {
  const lines = captured(() => T.renderIdentity({ ok: true, refusal: null, snapshot: good() }))
  const rows = lines.filter((l) => /(OK|PROBLEM|not checked|not judged)$/.test(l))
  assert.equal(rows.length, 4, 'four rows')
  assert.equal(rows.filter((l) => /OK$/.test(l)).length, 4, 'all four OK')
  assert.match(resultLine(lines), /is the operator account/)
})

/* ── THE STRUCTURAL RULE: production may not use a test-only parameter ────── */

test('*** no production caller passes `expected` to attest ***', () => {
  // ── WHY THIS RULE, AND NOT "TEST IT BETTER" ─────────────────────────────
  // Twice now a defect has survived a green suite because THE PATH THAT RUNS IN PRODUCTION IS
  // NOT THE PATH THE TESTS TAKE:
  //
  //   1. the code behind the execute fence. With the fence shut it was unreachable, so pressing
  //      E and every test that reasons about the fence both stopped at the same line. The unlock
  //      was its first execution.
  //   2. `attest(snap, { sid, name })`. Every test called `attest(good())` — one argument — which
  //      defaults to REQUIRED and always matches. The two-argument shape that shipped had never
  //      been executed by anything.
  //
  // Writing more tests does not fix that class; it is a shape problem, not a coverage problem.
  // The fix is to remove the divergence: `expected` exists so tests can vary the pinned identity,
  // and production has exactly one permitted identity, so production must never pass it. Then the
  // shape the tests exercise IS the shape that ships, and there is no second path to forget.
  //
  // The same reasoning gave the fence its remedy — read the post-fence region directly rather
  // than reaching it by running. Both are the same move: make the tested thing and the shipped
  // thing the same thing.
  const fs = require('node:fs')
  const path = require('node:path')
  const REPO = path.resolve(__dirname, '..', '..')

  const offenders = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue }
      if (!e.name.endsWith('.js') || e.name.endsWith('.test.js')) continue
      const code = fs.readFileSync(p, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      // The DECLARATION is not a call. `function attest (snapshot, expected = REQUIRED)` is where
      // the parameter is defined, and banning that would ban the parameter existing at all —
      // which tests legitimately need.
      const calls = code.replace(/function\s+attest\s*\([^)]*\)/g, 'function attest ()')
      // A second argument to attest(...) — an object literal, a variable, anything.
      for (const m of calls.matchAll(/\battest\s*\(([^)]*)\)/g)) {
        if (m[1].includes(',')) offenders.push(path.relative(REPO, p).split(path.sep).join('/') + ' :: attest(' + m[1].trim() + ')')
      }
    }
  }
  walk(path.join(REPO, 'src'))
  walk(path.join(REPO, 'scripts'))
  assert.deepEqual(offenders, [],
    'production must call attest with one argument, so the shipped shape is the tested shape')
})

test('*** POSITIVE CONTROL — the two-argument scan can find one ***', () => {
  const sample = "const v = attest(deps.snapshot, deps.expectedIdentity)\n"
  const hits = [...sample.matchAll(/\battest\s*\(([^)]*)\)/g)].filter((m) => m[1].includes(','))
  assert.equal(hits.length, 1, 'the rule detects the shape it bans')
  // And the one-argument form is not flagged.
  const ok = "const v = attest(snap)\n"
  assert.equal([...ok.matchAll(/\battest\s*\(([^)]*)\)/g)].filter((m) => m[1].includes(',')).length, 0)
})

test('*** the Companion runner and the tools agree on the identity, without copying it ***', () => {
  // Both used to hold their own copy: operatorToolsCommon had EXPECTED_SID/EXPECTED_NAME, and
  // tool-start-companion passed them on to the Companion. Two copies of a definition is how the
  // request schema went wrong too — each side green against its own idea.
  assert.equal(T.EXPECTED_SID, REQUIRED.sid, 'the tools\' SID is the pinned SID')
  assert.ok(REQUIRED.account.toUpperCase().endsWith(T.EXPECTED_NAME.toUpperCase()),
    'and the display name is the tail of the pinned account')
})

/* ── the machine tool ─────────────────────────────────────────────────────── */

test('*** checkMachine reports every row, and its verdict comes from companionPreflight ***', () => {
  const { companionPreflight, REQUEST_DIR, EXPECTED_REQUEST_ACES } = require('./companionCanaryRunner')
  const OP = 'S-1-5-21-2042659270-2029498691-2127769412-1009'
  const machine = {
    readAcl: (p) => (p === REQUEST_DIR
      ? { ok: true, protected: true, inheritedCount: 0, denyCount: 0, aces: Object.assign({}, EXPECTED_REQUEST_ACES) }
      : { ok: true, protected: true, inheritedCount: 0, denyCount: 0, aces: { [OP]: 0x1201BF, 'S-1-5-32-544': 0x1F01FF, 'S-1-5-18': 0x1F01FF } }),
    listDir: () => [],
    fileExists: () => false,
    probeWritable: () => ({ ok: true, paths: [{ path: 'C:\\Aroma', writable: false, class: 'enforced' }], residue: [], notProbed: [{ path: 'C:\\Aroma\\ComputerOperator-Test', reason: 'in_scope_mask_asserted_by_acl_check' }] }),
    stagedClosure: () => ({ ok: true }),
    notepadCount: () => 0,
    auditWritable: () => true
  }
  const res = T.checkMachine({ machine })
  assert.equal(res.ok, true, 'refusal: ' + res.refusal)
  for (const r of T.MACHINE_ROWS) assert.ok(res.rows[r.key], 'a row for ' + r.key)

  // The verdict is the shared rules', not a second opinion computed for the screen.
  assert.equal(companionPreflight(machine).ok, true)
  const bad = Object.assign({}, machine, { notepadCount: () => 2 })
  assert.equal(T.checkMachine({ machine: bad }).refusal, companionPreflight(bad).refusal)
})

test('*** a probe that could not look does not read as "nothing there" ***', () => {
  // notepadCount() returns -1 on failure precisely so unknown never equals 0.
  const machine = {
    readAcl: () => ({ ok: false, reason: 'denied' }),
    listDir: () => null,
    fileExists: () => true,
    probeWritable: () => ({ ok: false, reason: 'probe_file_not_removed', detail: 'C:\\Aroma\\x.tmp' }),
    stagedClosure: () => ({ ok: false, reason: 'unreadable' }),
    notepadCount: () => -1,
    auditWritable: () => false
  }
  const res = T.checkMachine({ machine })
  assert.equal(res.ok, false)
  // The rows no longer carry their own `ok`: that WAS the defect — a second verdict computed
  // beside the real one. What a row carries is what it says; the marker comes from markRows.
  assert.match(String(res.rows.notepads.value), /could not be counted/, 'a -1 count says so')
  assert.match(String(res.rows.acl.value), /cannot be read/)
  assert.equal(res.rows.notepads.ok, undefined, 'a row does not judge itself any more')

  // And nothing is ticked, because the judge stopped at the first problem.
  const lines = captured(() => T.renderMachine(res))
  assert.equal(lines.filter((l) => /OK$/.test(l)).length, 0, 'no row passes when the first check failed')
  assert.equal(lines.filter((l) => /PROBLEM/.test(l)).length, 1, 'exactly one problem')
})
