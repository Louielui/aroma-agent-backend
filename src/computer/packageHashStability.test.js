'use strict'

/**
 * packageHashStability.test.js — the integrity value must not move for reasons unrelated to
 * content.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 * computePackageHash() sha256s the RAW BYTES of every packaged file. On 2026-08-02, with
 * core.autocrlf=true and no .gitattributes, a `git stash push` / `git stash pop` round-trip over
 * five packaged files — `git diff` showing not one textual change — moved the package hash
 * 167b15cb… -> 57f24d25…, and turned controlIdentity.test.js red because it slices uiaCanary.ps1
 * on '\n}\n', which stops matching under CRLF.
 *
 * A hash that moves when git touches the tree is worse than no hash: it teaches its readers that
 * a changed number is normal. So the stability is MEASURED here — a real clone, a real stash
 * round-trip, real bytes — rather than asserted from the presence of a .gitattributes file.
 *
 * These tests shell out to git and are slower than the rest of the suite. That is the price of
 * measuring the thing instead of describing it.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const { PACKAGE_FILES, computePackageHash } = require('../../scripts/computer/executionPackage')
const REPO = path.join(__dirname, '..', '..')

function git (args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function tmp (prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function rm (dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch (_) { }
}

/* ── 1. a fresh checkout produces the same bytes, under EITHER autocrlf ────── */

test('*** the package hash survives a fresh clone, with core.autocrlf ON and OFF ***', () => {
  // The two settings are the whole point: before .gitattributes, autocrlf=true rewrote every
  // checked-out file and autocrlf=false did not, so two developers hashed the same commit and got
  // different numbers.
  //
  // The comparison is BETWEEN THE TWO CLONES, not against this working tree. Comparing against
  // the working tree would make this test go red for every uncommitted edit to a packaged file —
  // a false alarm on ordinary work, which is precisely the habit that lets a real hash change
  // slip past unread. What is under test is the checkout mechanism, so the checkouts are what
  // get compared. (Equality with the working tree is asserted below, but only when the tree is
  // clean and the question is therefore meaningful.)
  const hashes = {}
  const dirs = []
  try {
    for (const autocrlf of ['true', 'false']) {
      const dst = tmp('pkg-eol-' + autocrlf + '-')
      dirs.push(dst)
      git(['clone', '--quiet', '--no-hardlinks', '--local', REPO, dst], os.tmpdir())
      git(['config', 'core.autocrlf', autocrlf], dst)
      // Re-materialise every file so the setting actually applies to the working tree.
      git(['rm', '--cached', '-r', '-q', '.'], dst)
      git(['reset', '--hard', '--quiet'], dst)
      hashes[autocrlf] = computePackageHash(dst)
    }

    assert.equal(hashes.true, hashes.false,
      'the same commit must hash identically whether core.autocrlf is on or off')

    const dirty = git(['status', '--porcelain'], REPO).trim()
    if (dirty === '') {
      assert.equal(hashes.true, computePackageHash(),
        'and with a clean tree, this checkout must agree with a fresh one')
    }
  } finally { dirs.forEach(rm) }
})

/* ── 2. the exact operation that broke it ─────────────────────────────────── */

test('*** the package hash survives the stash round-trip that moved it on 2026-08-02 ***', () => {
  const dst = tmp('pkg-stash-')
  try {
    git(['clone', '--quiet', '--no-hardlinks', '--local', REPO, dst], os.tmpdir())
    git(['config', 'core.autocrlf', 'true'], dst)
    git(['rm', '--cached', '-r', '-q', '.'], dst)
    git(['reset', '--hard', '--quiet'], dst)

    const before = computePackageHash(dst)

    // Dirty a packaged file, then push and pop — precisely what happened. Under the old
    // configuration the pop restored the file with CRLF and the hash moved.
    const victim = path.join(dst, 'scripts', 'computer', 'uiaCanary.ps1')
    fs.appendFileSync(victim, '\n# transient\n')
    git(['stash', 'push', '--quiet', '-u', '-m', 'eol-probe'], dst)
    git(['stash', 'pop', '--quiet'], dst)
    git(['checkout', '--', '.'], dst)

    assert.equal(computePackageHash(dst), before,
      'a stash round-trip must not move the package hash')
  } finally { rm(dst) }
})

/* ── 3. what the bytes actually are ──────────────────────────────────────── */

test('*** no packaged file contains a CR, so there is one byte sequence and not two ***', () => {
  const offenders = []
  for (const rel of PACKAGE_FILES) {
    const buf = fs.readFileSync(path.join(REPO, rel.split('/').join(path.sep)))
    if (buf.includes(0x0D)) offenders.push(rel)
  }
  assert.deepEqual(offenders, [], 'these files still carry CR bytes: ' + offenders.join(', '))
})

test('*** POSITIVE CONTROL — a CRLF flip IS detected, and does move the hash ***', () => {
  // Without this, "no CR bytes" and "hash stable" could both be true of a test that measures
  // nothing. Flip one file in a copy and watch both facts break.
  const dst = tmp('pkg-ctl-')
  try {
    for (const rel of PACKAGE_FILES) {
      const p = path.join(dst, rel.split('/').join(path.sep))
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.copyFileSync(path.join(REPO, rel.split('/').join(path.sep)), p)
    }
    const before = computePackageHash(dst)
    assert.equal(before, computePackageHash(), 'the copy starts identical')

    const victim = path.join(dst, 'scripts', 'computer', 'uiaCanary.ps1')
    const lf = fs.readFileSync(victim)
    fs.writeFileSync(victim, Buffer.from(lf.toString('binary').split('\n').join('\r\n'), 'binary'))

    assert.ok(fs.readFileSync(victim).includes(0x0D), 'the control really did introduce CRs')
    assert.notEqual(computePackageHash(dst), before,
      'a line-ending flip alone MUST move the hash — that is the defect this pins down')
  } finally { rm(dst) }
})

/* ── 4. the rule is written down where git will read it ───────────────────── */

test('*** .gitattributes pins every packaged file type, and binaries are exempt ***', () => {
  const attrs = fs.readFileSync(path.join(REPO, '.gitattributes'), 'utf8')
  for (const ext of ['*.js', '*.ps1', '*.json']) {
    assert.match(attrs, new RegExp('\\' + ext.replace('*', '\\*') + '\\s+text eol=lf'),
      ext + ' must be pinned to LF — its bytes are hashed')
  }
  assert.match(attrs, /\*\s+text=auto eol=lf/, 'and the default catches anything added later')
  assert.match(attrs, /\*\.png\s+binary/, 'binaries are never rewritten')
})

/* ── 5. the BOM is a separate thing, and must survive ─────────────────────── */

test('*** pinning line endings did NOT disturb the UTF-8 BOMs ***', () => {
  // A BOM is EF BB BF — no CR, no LF — so the eol attribute cannot touch it. That is the reasoning;
  // this is the measurement. It matters because PowerShell 5.1 reads a BOM-less .ps1 as ANSI, and
  // a lost BOM would break parsing of any file with a non-ASCII byte in it.
  const ps1 = PACKAGE_FILES.filter((f) => f.endsWith('.ps1'))
  assert.ok(ps1.length >= 10, 'there are packaged PowerShell files to check')

  let withBom = 0
  for (const rel of ps1) {
    const buf = fs.readFileSync(path.join(REPO, rel.split('/').join(path.sep)))
    const hasBom = buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF
    if (hasBom) { withBom++; continue }
    // No BOM is acceptable ONLY if the file is pure ASCII, where ANSI and UTF-8 agree byte for byte.
    const nonAscii = buf.some((b) => b > 0x7F)
    assert.equal(nonAscii, false,
      rel + ' has no BOM and a non-ASCII byte — PowerShell 5.1 would read it as ANSI')
  }
  assert.ok(withBom >= 10, 'the BOM-bearing files still bear their BOM (found ' + withBom + ')')
})
