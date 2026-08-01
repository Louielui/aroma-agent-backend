'use strict'

/**
 * probeResidueGuards.test.js — a measurement must not damage what it measures.
 *
 * ── WHAT HAPPENED ──────────────────────────────────────────────────────────
 * The `writable` probe measured "can this account write here" by writing a file and deleting it.
 * In C:\Aroma\ComputerOperator-Test the write succeeded and the delete could not: AromaOperator's
 * mask there is 0x1201BF, which is Modify MINUS 0x10000, and 0x10000 is DELETE. FILE_DELETE_CHILD
 * (0x40) is absent as well, so neither route exists.
 *
 * That is deliberate — FORBIDDEN_RIGHTS refuses the run if the operator holds Delete, because the
 * account performing the canary must not be able to delete its own evidence. So write-then-delete
 * was impossible in that folder from the day the ACL was set, and every run left one file behind.
 * The leftovers then failed the NEXT run's "folder is empty" check: a probe that broke the check
 * after it. Two logins, two files, canary blocked.
 *
 * The fix is not a better cleanup. It is that the one path where the write SUCCEEDS is the one
 * path that never needed writing — its exact mask is already asserted bit by bit, Delete included.
 * Out of scope, a write is expected to FAIL, and a failure creates nothing.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.resolve(__dirname, '..', '..')
const PROBE = path.join(REPO, 'scripts', 'computer', 'probe-machine.ps1')
const R = require('./companionCanaryRunner')
const T = require('../../scripts/computer/operatorToolsCommon')

const psCode = (f) => fs.readFileSync(f, 'utf8').replace(/<#[\s\S]*?#>/g, '').replace(/#.*$/gm, '')

/* ── nothing writes inside the approved folder to measure it ──────────────── */

test('*** the writable probe never writes inside the allowed path ***', () => {
  const code = psCode(PROBE)
  const op = code.slice(code.indexOf("'writable' {"), code.indexOf("'staging' {"))
  assert.ok(op.length > 200, 'the op survived comment stripping — not a vacuous pass')

  // $TestDir must not be among the paths that get written to.
  // The list the probe WRITES to is now the enforced one; $TestDir must not be in it.
  const probed = /\$enforced\s*=\s*@\(([\s\S]*?)\n    \)/.exec(op)
  assert.ok(probed, 'the enforced list is declared')
  assert.equal(/\$TestDir/.test(probed[1]), false, 'the allowed path is not written to')
  // And the two paths that were enforced on a guess are gone from it.
  assert.equal(/Windows\\\\Temp/.test(probed[1]), false, 'C:\\Windows\\Temp is no longer enforced')
  assert.equal(/USERPROFILE/.test(probed[1]), false, 'the operator profile is no longer enforced')
  // Every enforced entry carries provenance — who set the permission being asserted.
  const entries = probed[1].split('@{').slice(1)
  assert.ok(entries.length >= 2, 'at least two enforced entries')
  for (const e of entries) assert.match(e, /provenance\s*=/, 'each enforced entry names what set it')

  // And it is named as deliberately skipped, so the omission is a decision on the record rather
  // than something that fell out of a list.
  assert.match(op, /notProbed/, 'the skip is reported to the caller')
  assert.match(op, /in_scope_mask_asserted_by_acl_check/, 'with the reason it was skipped')
})

test('*** POSITIVE CONTROL — the scan catches an in-scope write ***', () => {
  // Without this, "not in the list" could mean the regex matched nothing at all.
  const withTestDir = "$enforced = @(\n      @{ path = $TestDir }\n    )\n"
  const m = /\$enforced\s*=\s*@\(([\s\S]*?)\n    \)/.exec(withTestDir)
  assert.ok(m, 'the pattern finds a declared list')
  assert.equal(/\$TestDir/.test(m[1]), true, 'and would flag the allowed path being written to')

  // The real one, for contrast.
  const op = psCode(PROBE).slice(psCode(PROBE).indexOf("'writable' {"), psCode(PROBE).indexOf("'staging' {"))
  const real = /\$enforced\s*=\s*@\(([\s\S]*?)\n    \)/.exec(op)
  assert.ok(real, 'the real list parses')
  assert.equal(/\$TestDir/.test(real[1]), false)
})

test('*** no production script writes a probe file into the allowed path ***', () => {
  // The general form. A future op that measures the approved folder by touching it would leave
  // residue the operator cannot remove, exactly as this one did.
  const offenders = []
  for (const f of fs.readdirSync(path.join(REPO, 'scripts', 'computer')).filter((n) => n.endsWith('.ps1'))) {
    const abs = path.join(REPO, 'scripts', 'computer', f)
    const code = psCode(abs)
    // A write API targeting something INSIDE the folder. Creating the folder itself is not the
    // problem and must not be banned — prepare-canary-testdir.ps1 legitimately does exactly that,
    // elevated, as setup. The first version of this rule flagged it, which would have made the
    // rule an obstacle to the setup it depends on.
    for (const m of code.matchAll(/(WriteAllText|New-Item|Set-Content|Out-File|Add-Content)[^\r\n]*/g)) {
      const lineText = m[0]
      if (!/\$TestDir|ComputerOperator-Test/.test(lineText)) continue
      if (/-ItemType\s+Directory/.test(lineText)) continue // the folder itself, not a file in it
      // Only a path built INSIDE the folder counts.
      if (/Join-Path\s+\$TestDir|ComputerOperator-Test\\\\/.test(lineText)) {
        offenders.push(f + ' :: ' + lineText.trim().slice(0, 90))
      }
    }
    // And the reverse order: a probe path built from $TestDir then written.
    for (const m of code.matchAll(/\$probe\s*=\s*Join-Path\s+\$TestDir[^\r\n]*/g)) {
      offenders.push(f + ' :: ' + m[0].trim().slice(0, 90))
    }
  }
  assert.deepEqual(offenders, [],
    'the operator cannot delete what it writes there — every such write leaks a file')
})

/* ── residue is reported as itself ────────────────────────────────────────── */

test('*** probe residue in the allowed folder gets its own refusal ***', () => {
  const machine = require('../../src/computer/machineProbe')
  assert.ok(machine, 'module loads')
  const base = {
    readAcl: (p) => (p === R.REQUEST_DIR
      ? { ok: true, protected: true, inheritedCount: 0, denyCount: 0, aces: Object.assign({}, R.EXPECTED_REQUEST_ACES) }
      : { ok: true, protected: true, inheritedCount: 0, denyCount: 0, aces: { [R.EXPECTED_ACES && Object.keys(R.EXPECTED_ACES)[0]]: 0x1201BF, 'S-1-5-32-544': 0x1F01FF, 'S-1-5-18': 0x1F01FF } }),
    listDir: () => ['.aroma-probe-' + 'a'.repeat(32) + '.tmp', '.aroma-probe-' + 'b'.repeat(32) + '.tmp'],
    fileExists: () => false,
    probeWritable: () => ({ ok: true, paths: [{ path: 'C:\\Aroma', writable: false, class: 'enforced' }], residue: [] }),
    stagedClosure: () => ({ ok: true }),
    notepadCount: () => 0,
    auditWritable: () => true
  }
  const res = R.companionPreflight(base)
  assert.equal(res.refusal, 'probe_residue', 'not the generic folder_not_empty')
  assert.match(res.human, /cannot delete them/, 'it says why they are still there')
  assert.match(res.detail, /elevated window/, 'and what the Owner has to do')

  // A file that is NOT ours still reports as folder_not_empty — the two are different problems.
  const other = Object.assign({}, base, { listDir: () => ['someone-elses.txt'] })
  assert.equal(R.companionPreflight(other).refusal, 'folder_not_empty')
})

test('*** a probe refusal keeps its reason all the way to the screen ***', () => {
  // It used to be flattened to `null` in machineProbe and printed as "not measured", which is
  // true and useless. The Owner was shown "not measured" when the answer was "the probe could
  // not delete the file it wrote".
  const { createMachineProbe } = require('./machineProbe')
  const runner = { run: () => ({ ok: true, result: { ok: false, reason: 'probe_file_not_removed', detail: 'C:\\Aroma\\x.tmp' } }) }
  const probe = createMachineProbe({ runner })
  const r = probe.probeWritable()
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'probe_file_not_removed', 'the reason survived')
  assert.equal(r.transport, false, 'and it is known NOT to be a transport failure')

  // A transport failure is a different fact, and stays different.
  const dead = createMachineProbe({ runner: { run: () => ({ ok: false, refusal: 'no_envelope' }) } })
  const d = dead.probeWritable()
  assert.equal(d.ok, false)
  assert.equal(d.transport, true)
  assert.match(d.reason, /^transport_/)
})

/* ── the general remedy: check the SCRIPT, not only the fake ──────────────── */

test('*** every op the JS asks for exists in the script, and vice versa ***', () => {
  // ── THE THIRD "THE PRODUCTION PATH WAS NEVER TESTED" ────────────────────
  //   1. code behind the shut fence     — unreachable, so pressing E and every fence test
  //                                       stopped at the same line
  //   2. attest(snap, {sid, name})      — every test used the one-argument form
  //   3. the write-then-delete probe    — every test used a fake that CANNOT fail to delete
  //
  // The third is its own species and the most instructive. The fake replaced precisely the
  // operation that breaks. `probeWritable: () => [...]` writes nothing, so it can never leak a
  // file; the tests proved the RULE reads the answer correctly and said nothing about whether
  // the probe could produce an answer without damaging the thing it measured.
  //
  // More behaviour tests behind better fakes cannot reach that. What can is checking the
  // SCRIPT ITSELF from source — its ops, its shapes, its effects — which needs no machine, no
  // session and no operator account. identityFieldContract.test.js does it for field names; the
  // in-scope-write ban above does it for effects; this does it for the op list.
  const { REQUIRED_OPS } = require('./machineProbe')
  const code = psCode(PROBE)
  const arms = [...code.matchAll(/^\s*'([a-z]+)'\s*\{/gm)].map((m) => m[1])
  assert.ok(arms.length >= 7, 'the switch was parsed: ' + arms.join(', '))

  const missingInScript = REQUIRED_OPS.filter((op) => !arms.includes(op))
  assert.deepEqual(missingInScript, [], 'the JS asks for ops the script cannot answer')

  // The reverse: an op in the script that nothing asks for is dead surface on the operator side.
  const DECLARED_EXTRA = ['echo'] // transport diagnostic, deliberately present and unused
  const unused = arms.filter((op) => !REQUIRED_OPS.includes(op) && !DECLARED_EXTRA.includes(op))
  assert.deepEqual(unused, [], 'the script answers ops nothing asks for: ' + unused.join(', '))
})

test('*** POSITIVE CONTROL — the op scan can find a missing arm ***', () => {
  const code = psCode(PROBE)
  const arms = [...code.matchAll(/^\s*'([a-z]+)'\s*\{/gm)].map((m) => m[1])
  assert.equal(arms.includes('writable'), true, 'it really found the arms')
  assert.equal(arms.includes('nosuchop'), false, 'and does not invent one')
})

/* ── one marker rule, not one per table ───────────────────────────────────── */

test('*** both tables derive their markers from the SAME function ***', () => {
  // The identity table was corrected first and the machine table was left, so the next login hit
  // the identical defect one table down. A shared function is the only version of this fix that
  // cannot be applied to one table and not the other.
  const src = fs.readFileSync(path.join(REPO, 'scripts', 'computer', 'operatorToolsCommon.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.equal((src.match(/function markRows\b/g) || []).length, 1, 'defined once')
  // Two CALLS — one per renderer. The declaration is `function markRows (` with a space, so it
  // is not counted here, which is the point: this counts users, not the definition.
  const uses = src.match(/markRows\(/g) || []
  assert.equal(uses.length, 2, 'exactly two callers, one per table: ' + uses.length)
  assert.match(src, /function renderIdentity[\s\S]*?markRows\(/, 'the identity table calls it')
  assert.match(src, /function renderMachine[\s\S]*?markRows\(/, 'the machine table calls it')

  // Neither renderer may compute a pass of its own.
  const renderMachine = src.slice(src.indexOf('function renderMachine'), src.indexOf('function renderMachine') + 900)
  assert.equal(/row\.ok/.test(renderMachine), false, 'the machine table no longer reads a per-row verdict')
})

test('*** markRows: before the problem OK, at it PROBLEM, after it never OK ***', () => {
  const rows = [
    { label: 'A', owns: ['ra'], value: 'a' },
    { label: 'B', owns: ['rb'], value: 'b' },
    { label: 'C', owns: ['rc'], value: 'c' }
  ]
  assert.deepEqual(T.markRows(rows, true, null).map((m) => m.mark), [true, true, true])
  assert.deepEqual(T.markRows(rows, false, 'rb').map((m) => m.mark), [true, false, null])
  assert.equal(T.markRows(rows, false, 'rb')[2].note, 'not checked')

  // A refusal that belongs to no row judges nothing — and must not tick anything.
  assert.deepEqual(T.markRows(rows, false, 'something_else').map((m) => m.mark), [null, null, null])

  // An unmeasured value is never OK, whatever the verdict says.
  const withGap = [Object.assign({}, rows[0], { unmeasured: true }), rows[1], rows[2]]
  assert.equal(T.markRows(withGap, true, null)[0].mark, false)
  assert.equal(T.markRows(withGap, true, null)[0].value, 'not measured')
})

test('*** every machine refusal is owned by exactly one row ***', () => {
  // A refusal owned by no row shows a table with nothing marked, which is how a screen ends up
  // saying one thing at the bottom and nothing above it.
  const owned = T.MACHINE_ROWS.flatMap((r) => r.owns || [])
  assert.equal(new Set(owned).size, owned.length, 'no refusal is claimed by two rows')

  // Every refusal companionPreflight can actually produce must be in that set.
  const src = fs.readFileSync(path.join(__dirname, 'companionCanaryRunner.js'), 'utf8')
  const pre = src.slice(src.indexOf('function companionPreflight'), src.indexOf('function runCanaryAsCompanion'))
  const produced = [...pre.matchAll(/return no\('([a-z_]+)'/g)].map((m) => m[1])
    .filter((r) => r !== 'no_machine_probe')
  const orphans = [...new Set(produced)].filter((r) => !owned.includes(r))
  assert.deepEqual(orphans, [], 'these refusals have no row to mark: ' + orphans.join(', '))
})
