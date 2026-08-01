'use strict'

/**
 * stagedVerifierPathIdentity.test.js — a file is its PATH, not its name.
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────
 * verify-staged-closure.ps1 identified files with `-like '*companion.js'`. In PowerShell that
 * means "ends with". `scripts/computer/tool-start-companion.js` ends with the literal string
 * `companion.js`, so a REQUIRED, manifest-listed file was reported as a Phase 3a leftover — in
 * the one check written specifically to be the independent one.
 *
 * The staging was correct the whole time. The check was wrong, and it read perfectly well as
 * correct code, which is why the rule is asserted here rather than remembered.
 *
 * ── WHY BOTH A SOURCE GUARD AND RUNTIME CONTROLS ───────────────────────────
 * The verifier carries four controls that run every time it is used. Those are the real proof —
 * but they only run elevated, on a machine with a staged folder. This file runs in the ordinary
 * suite, on any machine, and checks the two things that can be checked from source: that the
 * banned forms are absent, and that the controls are still present and still assert what they
 * claim to. A control that gets deleted is a control that passes.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.resolve(__dirname, '..', '..')
const VERIFIER = path.join(REPO, 'scripts', 'computer', 'verify-staged-closure.ps1')
const STAGER = path.join(REPO, 'scripts', 'computer', 'stage-canary-closure.ps1')
const PKG = require('../../scripts/computer/executionPackage')

/** Comments stripped — a file explaining a ban must not be read as breaking it. */
const code = (f) => fs.readFileSync(f, 'utf8').replace(/<#[\s\S]*?#>/g, '').replace(/#.*$/gm, '')

/* ── the banned forms ─────────────────────────────────────────────────────── */

test('*** the verifier never identifies a file by suffix, basename or wildcard ***', () => {
  const src = code(VERIFIER)

  // The exact construct that produced the false positive, and its neighbours.
  assert.doesNotMatch(src, /-like\s+\(?\s*['"]\*/, "no -like '*...' matching")
  assert.doesNotMatch(src, /-like\s+\(\s*['"]\*'\s*\+/, 'no -like on a built-up wildcard')
  assert.doesNotMatch(src, /-match\s+['"]\.\*/, 'no regex wildcard matching on paths')
  assert.doesNotMatch(src, /\.EndsWith\(/i, 'no EndsWith')
  assert.doesNotMatch(src, /\.Contains\(/i, 'no Contains')
  assert.doesNotMatch(src, /Split-Path[^\r\n]*-Leaf/, 'no basename extraction for comparison')
  assert.doesNotMatch(src, /\$_\.Name\s+-(eq|in|contains)/, 'no comparison on a bare file name')
})

test('*** the stager uses the same identity rule ***', () => {
  // Two rules for "is this file that file" is two answers, and the lenient one wins by accident.
  const src = code(STAGER)
  assert.doesNotMatch(src, /-like\s+\(?\s*['"]\*/, "no -like '*...' matching")
  assert.doesNotMatch(src, /\.EndsWith\(/i)
  assert.match(src, /function Test-PathInSet/, 'it has the exact-path comparison')
  assert.match(src, /function ConvertTo-CanonicalPath/, 'and the same canonicalization')
})

/* ── canonicalization is fixed and small ──────────────────────────────────── */

test('*** canonicalization does exactly two things, and nothing else ***', () => {
  // Every extra normalisation step is another way for two different files to be judged the same.
  const src = code(VERIFIER)
  const fn = /function ConvertTo-CanonicalPath[\s\S]*?\n\}/.exec(src)
  assert.ok(fn, 'the function exists')
  const body = fn[0]
  assert.match(body, /-replace\s+'\\\\',\s*'\/'/, 'separators to forward slashes')
  assert.match(body, /ToLowerInvariant\(\)/, 'and case-folded, because NTFS is case-insensitive')
  // What it must NOT do: trimming, stripping, or resolving `..` — each of those can map two
  // distinct staged files onto one identity.
  for (const banned of ['Trim(', 'TrimStart', 'TrimEnd', 'Resolve-Path', 'GetFullPath', '..']) {
    assert.equal(body.includes(banned), false, 'canonicalization must not do: ' + banned)
  }
})

test('*** a canonical collision is REFUSED, not deduplicated ***', () => {
  // Silently keeping one of two is how a stray file rides along under a name something else
  // already accounted for.
  const src = code(VERIFIER)
  assert.match(src, /function Assert-NoCanonicalDuplicates/)
  assert.match(src, /REFUSED: two/, 'it says so and stops')
  assert.match(src, /exit 2/, 'and exits rather than continuing')
  assert.match(src, /Assert-NoCanonicalDuplicates \$expected/, 'applied to the manifest')
  assert.match(src, /Assert-NoCanonicalDuplicates \$staged/, 'and to what is on disk')
})

/* ── the four controls are present, and are the right four ────────────────── */

test('*** the verifier still carries all four path controls ***', () => {
  const src = code(VERIFIER)
  // 1. the false positive that started this
  assert.match(src, /tool-start-companion\.js does NOT match companion\.js/)
  // 2. the true positive — without it, (1) could pass by matching nothing at all
  assert.match(src, /the real src\/computer\/companion\.js DOES match/)
  // 3. same basename, different directory
  assert.match(src, /same basename in another directory does NOT match/)
  // 4. separators and case
  assert.match(src, /separators and case normalise/)
  // and they run BEFORE the elevation gate, so they are exercised on every invocation
  assert.ok(src.indexOf('tool-start-companion.js does NOT match') < src.indexOf('elevated=$false') ||
            src.indexOf('tool-start-companion.js does NOT match') < src.indexOf('IsInRole'),
  'the controls run before anything else can stop the script')
  assert.match(src, /the comparison failed its own controls/, 'and a failed control halts it')
})

test('*** the controls encode a real property of the CURRENT manifest ***', () => {
  // The whole point: the manifest genuinely contains a path ending in "companion.js" that is not
  // src/computer/companion.js. If that ever stops being true, control 1 becomes vacuous and this
  // test says so rather than letting it quietly pass forever.
  const trap = PKG.PACKAGE_FILES.filter((p) => p.endsWith('companion.js') && p !== 'src/computer/companion.js')
  assert.deepEqual(trap, ['scripts/computer/tool-start-companion.js'],
    'the file that caused the false positive is still in the manifest, so control 1 still means something')
  assert.equal(PKG.PACKAGE_FILES.includes('src/computer/companion.js'), false,
    'and the real companion.js is still out of the package')
})

test('*** failures print FULL paths, not names ***', () => {
  const src = code(VERIFIER)
  for (const label of ['MISSING \\(in manifest, not staged\\)', 'EXTRA \\(staged, not in manifest\\)', 'PHASE 3A REMNANT']) {
    assert.match(src, new RegExp(label), 'the failing category is reported: ' + label)
  }
  // Each of those loops prints the path variable itself, not a derived name.
  assert.match(src, /foreach \(\$p in \$missing\) \{ Say \(" {6}" \+ \$p\)/)
  assert.match(src, /foreach \(\$p in \$extra\) \{ Say \(" {6}" \+ \$p\)/)
  assert.match(src, /foreach \(\$p in \$leftovers\) \{ Say \(" {6}PHASE 3A REMNANT: " \+ \$p\)/)
  assert.match(src, /STAGED FILES \(full repo-relative paths\)/, 'and the full staged list is printed')
})

/* ── the stager records before it deletes ─────────────────────────────────── */

test('*** the stager backs up, VERIFIES the backup, records, and only then deletes ***', () => {
  const src = code(STAGER)
  const at = (needle) => { const i = src.indexOf(needle); assert.ok(i > 0, 'present: ' + needle); return i }

  const inventory = at('Get-ChildItem -LiteralPath $StageDir -Recurse -File -Force')
  const backup = at('Copy-Item -LiteralPath $StageDir -Destination $BackupDir')
  const verifyBackup = at('BACKUP VERIFICATION FAILED')
  const record = at('REMOVED-FILES.json')
  const del = at('Get-ChildItem -LiteralPath $StageDir -Force | Remove-Item -Recurse -Force')

  assert.ok(inventory < backup, 'inventory before backup')
  assert.ok(backup < verifyBackup, 'backup before its verification')
  assert.ok(verifyBackup < record, 'verification before the record')
  assert.ok(record < del, 'the record is written BEFORE the deletion')
  assert.ok(del > inventory, 'and the deletion is last')
})

test('*** a failed backup verification deletes nothing ***', () => {
  const src = code(STAGER)
  const idx = src.indexOf('BACKUP VERIFICATION FAILED')
  const block = src.slice(idx, idx + 500)
  assert.match(block, /Nothing has been deleted/, 'it says so')
  assert.match(block, /exit 1/, 'and exits before reaching the clear')
  assert.ok(src.indexOf('exit 1', idx) < src.indexOf('Remove-Item -Recurse -Force', idx),
    'the exit comes before any deletion')
})

test('*** REMOVED-FILES.json records every required field ***', () => {
  const src = code(STAGER)
  for (const field of ['repoRelativePath', 'sha256', 'size', 'backupPath', 'recordedAt', 'reason']) {
    assert.match(src, new RegExp(field), 'the removal record must carry: ' + field)
  }
  assert.match(src, /not_in_current_manifest/, 'and state why')
})

test('*** every removal is named on screen before it happens ***', () => {
  const src = code(STAGER)
  assert.match(src, /These are NOT in the current manifest and will be removed/)
  assert.match(src, /foreach \(\$e in \$outsideManifest\)[\s\S]{0,200}\$e\.repoRelativePath/,
    'each one printed by full path, with its size and hash')
})

/* ── the tooling is outside the package ───────────────────────────────────── */

test('*** neither tool is in PACKAGE_FILES, so editing them cannot move the hash ***', () => {
  for (const t of ['scripts/computer/verify-staged-closure.ps1', 'scripts/computer/stage-canary-closure.ps1']) {
    assert.equal(PKG.PACKAGE_FILES.includes(t), false, t + ' must stay outside the execution package')
  }
  // Stated as the reason rather than left implicit: these decide nothing about what a canary
  // does. They check and prepare the folder it will be run from.
  assert.ok(fs.existsSync(VERIFIER) && fs.existsSync(STAGER), 'and both exist')
})
