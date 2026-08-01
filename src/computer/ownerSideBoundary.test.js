'use strict'

/**
 * ownerSideBoundary.test.js — the Owner's side asks only what it can answer.
 *
 * ── WHAT HAPPENED ──────────────────────────────────────────────────────────
 * The Owner pressed E and got: "The folder's permissions cannot be read from here. Run this as
 * the Owner." He was the Owner. Owner-Execute.ps1 was calling Get-Acl on
 * C:\Aroma\ComputerOperator-Test, which is permissioned for AromaOperator, Administrators and
 * SYSTEM — and `louis` is none of those. It also counted Notepad windows in session 3, while the
 * canary runs on session 5.
 *
 * Every line was correct code. All of it answered questions this session cannot answer.
 *
 * ── WHY NOTHING CAUGHT IT ──────────────────────────────────────────────────
 * The block sat AFTER the fence, and the fence was shut. From the architecture ruling until the
 * unlock, that code was UNREACHABLE — pressing E always exited at the fence, several dozen lines
 * earlier. Tests that assert the fence's ordering, and a person testing by pressing E, both stop
 * at exactly the same place.
 *
 * So the lesson is not "check the folder differently". It is that a fence hides everything behind
 * it, and code behind a shut fence needs tests that DO NOT GO THROUGH THE FENCE. The tests below
 * read the post-fence region directly, so they hold whichever way the fence is set — and would
 * have failed on the day the block was written.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.resolve(__dirname, '..', '..')
const SCRIPTS = path.join(REPO, 'scripts', 'computer')
const EXECUTE_PS1 = path.join(SCRIPTS, 'Owner-Execute.ps1')
const ENTRY_JS = path.join(SCRIPTS, 'run-notepad-canary.js')

const E = require('../../scripts/computer/run-notepad-canary')

const psCode = (f) => fs.readFileSync(f, 'utf8').replace(/<#[\s\S]*?#>/g, '').replace(/^\s*#.*$/gm, '')
const jsCode = (f) => fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

/** Everything AFTER the fence check — the region a shut fence hides. */
function postFence (src) {
  const i = src.indexOf('if (-not $CANARY_EXECUTE_AUTHORISED)')
  assert.ok(i > 0, 'the fence check exists')
  return src.slice(i)
}

/* ── the Owner side does not measure the operator's machine ───────────────── */

test('*** the Owner screen never reads the canary folder or its ACL ***', () => {
  const src = psCode(EXECUTE_PS1)
  assert.equal(/Get-Acl/.test(src), false, 'no ACL is read on this side')
  assert.equal(src.includes('ComputerOperator-Test'), false, 'the canary folder is not named at all')
  for (const banned of ['AreAccessRulesProtected', 'AccessControlType', 'IsInherited', 'FileSystemRights']) {
    assert.equal(src.includes(banned), false, 'no ACL inspection: ' + banned)
  }
})

test('*** the Owner screen never counts Notepad ***', () => {
  // It counted session 3. The canary runs on session 5. Zero here says nothing about there —
  // the check was not merely misplaced, it was measuring a different desktop.
  const src = psCode(EXECUTE_PS1)
  assert.equal(/Get-Process/.test(src), false, 'no process enumeration on this side')
  assert.equal(/notepad/i.test(src.replace(/run-notepad-canary\.js/g, '')), false,
    'and Notepad is not named outside the entrypoint filename')
})

test('*** the Owner-side preflight touches no filesystem state of the canary folder ***', () => {
  const src = jsCode(ENTRY_JS)
  const pre = src.slice(src.indexOf('function preflight'), src.indexOf('function request'))
  for (const banned of ['io.dirExists', 'io.listDir', 'io.fileExists', 'io.auditWritable']) {
    assert.equal(pre.includes(banned), false, 'the Owner preflight must not call: ' + banned)
  }
  // The one that stays, and why: it reads a field of the signed document, not a disk.
  assert.ok(pre.includes('receipt.approvedOrder.allowedPath'), 'the approved path is still checked, from the receipt')
})

test('*** POSITIVE CONTROL — the scan catches each banned form ***', () => {
  // Without this, "none found" could mean the rule cannot detect anything. Each pattern is run
  // against a line that genuinely does the thing.
  const psSamples = {
    'Get-Acl': "$acl = Get-Acl -LiteralPath $testDir -ErrorAction Stop\n",
    'ComputerOperator-Test': "$testDir = 'C:\\Aroma\\ComputerOperator-Test'\n",
    'Get-Process': "$n = @(Get-Process -Name 'notepad').Count\n"
  }
  for (const [needle, sample] of Object.entries(psSamples)) {
    assert.ok(sample.includes(needle), 'the pattern matches a real use of ' + needle)
  }
  const jsSample = "  if (!io.dirExists(ALLOWED_DIR)) { return fail('folder_missing') }\n"
  assert.ok(jsSample.includes('io.dirExists'), 'and the JS pattern matches a real call')

  // And the real files do NOT contain them — the two halves of the control together mean the
  // zero above is a measurement rather than a broken matcher.
  assert.equal(psCode(EXECUTE_PS1).includes('Get-Acl'), false)
  assert.equal(jsCode(ENTRY_JS).includes('io.dirExists'), false)
})

/* ── the fence must not hide untested code ───────────────────────────────── */

test('*** the post-fence region is covered by tests that do NOT go through the fence ***', () => {
  // THE STRUCTURAL LESSON. Everything after the fence check was invisible for as long as the
  // fence was shut: pressing E stopped there, and every test that reasons about the fence stops
  // there too. This test reads that region directly, so it holds in either fence state.
  const region = postFence(psCode(EXECUTE_PS1))
  assert.ok(region.length > 500, 'there is a substantial region behind the fence')

  // Every external thing the post-fence region does must be one of these. A new command back
  // there — a new probe, a new folder read, a new process — fails this and forces a decision,
  // instead of waiting for an unlock to be discovered by a person pressing a key.
  const ALLOWED_POST_FENCE = [
    '& $Node $Entry preflight',
    '& $Node $Entry request'
  ]
  const invocations = region.match(/&\s+\$Node[^\r\n]*/g) || []
  assert.deepEqual(invocations.map((s) => s.trim()), ALLOWED_POST_FENCE,
    'the post-fence region starts exactly two things, both of them measurements or hand-offs')

  // No cmdlet that touches the machine may appear behind the fence.
  for (const banned of ['Get-Acl', 'Get-Process', 'Get-ChildItem', 'Start-Process', 'New-Item', 'Remove-Item', 'Set-Content']) {
    assert.equal(region.includes(banned), false, 'the post-fence region must not call: ' + banned)
  }
})

test('*** the fence-shut path and the fence-open path reach the same checks ***', () => {
  // The specific trap: with the fence shut, `exit 4` fires BEFORE the post-fence region, so
  // nothing behind it is exercised. Asserted here as a property of the file rather than
  // remembered: whatever the fence is set to today, the ordering means everything after it is
  // only ever reached in one of the two states — so it must be tested by reading, not by running.
  const src = psCode(EXECUTE_PS1)
  const fenceAt = src.indexOf('if (-not $CANARY_EXECUTE_AUTHORISED)')
  const exitAt = src.indexOf('exit 4', fenceAt)
  const firstNodeCall = src.indexOf('& $Node $Entry preflight')
  assert.ok(exitAt > fenceAt && exitAt < firstNodeCall,
    'a shut fence exits before the first post-fence command — which is why that region needs source-level tests')
})

/* ── what the Owner side still guarantees ─────────────────────────────────── */

test('*** the Owner-side preflight still checks everything it CAN answer ***', () => {
  // The removals must not have taken the real guarantees with them. Each of these is a question
  // about a document or about this process, both of which this session can answer.
  const pre = jsCode(ENTRY_JS)
  for (const kept of [
    'approval.verify',              // the receipt, and the package hash it binds
    'executionRecordExists',        // single use, across processes
    'APPROVAL_TTL_MS',              // not too old
    'io.flagScopes',                // COMPUTER_OPERATOR is not set here
    'receipt.approvedOrder.allowedPath'
  ]) {
    assert.ok(pre.includes(kept), 'the Owner side must still check: ' + kept)
  }
})

test('*** and the verbs are still exactly two ***', () => {
  assert.deepEqual([...E.VERBS], ['preflight', 'request'])
})

/* ── absence must never be indistinguishable from blindness ───────────────── */

test('*** the Notepad count cannot report 0 because it could not look ***', () => {
  // The shape that produced this round's other correction. `Get-Process -Name x -EA
  // SilentlyContinue` returns an empty collection both when nothing matches AND when the call
  // fails — and .Count on that is 0, which is the answer that lets a canary proceed.
  // Comments stripped FIRST. The op's own header quotes the offending line to explain why it
  // was removed, and the first version of this test read it and went red — the sixth time in
  // this project that a rule has punished the prose describing the thing it bans. A test that
  // cannot tell a prohibition from a violation makes writing the prohibition down expensive.
  const probe = psCode(path.join(SCRIPTS, 'probe-machine.ps1'))
  const op = probe.slice(probe.indexOf("'notepads' {"), probe.indexOf("'auditwritable' {"))
  assert.ok(op.length > 50, 'the op survived stripping — not a vacuous pass')
  assert.equal(/Get-Process[^\r\n]*SilentlyContinue/.test(op), false,
    'a swallowed error here reads as "no Notepad open"')
  assert.match(op, /ErrorAction Stop/, 'the call fails loudly')
  assert.match(op, /notepad_count_unavailable/, 'and "could not look" is its own refusal')
})

test('*** no packaged PowerShell counts or indexes a SilentlyContinue result ***', () => {
  // The general rule behind that specific fix, applied across everything the approval covers.
  const PKG = require('../../scripts/computer/executionPackage')
  const offenders = []
  for (const rel of PKG.PACKAGE_FILES.filter((p) => p.endsWith('.ps1'))) {
    const src = fs.readFileSync(path.join(REPO, rel.split('/').join(path.sep)), 'utf8').replace(/^\s*#.*$/gm, '')
    for (const m of src.matchAll(/SilentlyContinue\s*\)\s*(\.Count|\[0\])/g)) {
      offenders.push(rel + ' :: ' + m[0])
    }
  }
  assert.deepEqual(offenders, [],
    'counting or indexing a swallowed result cannot tell "none" from "could not read"')
})
