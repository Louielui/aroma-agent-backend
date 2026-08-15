'use strict'

/**
 * E0-W1 Canonical Observer Source Foundation.
 *
 * The canonical Observer source is not a reconstruction. It is the exact historical Git
 * blob that was independently pinned by the registered task and later matched by the staged
 * machine copy. This test asks Git for the blob object stored at the canonical path, so line
 * ending conversion in a working tree cannot weaken the provenance check.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ AND THE BLOB ALONE WAS NOT ENOUGH.
 *
 * A Git blob stores LF. The file the Scheduled Task actually executes is CRLF, and it is
 * those DEPLOYED BYTES that the task pins by SHA-256. So provenance of the source and
 * provenance of the deployed artefact are two different claims, and the first was being
 * allowed to stand in for the second.
 *
 * It matched on this machine only because `core.autocrlf` happened to be `true` — a LOCAL
 * setting, carried by nobody, promised by nothing. Check the same commit out on a Linux CI
 * runner, or on a Windows box configured `input`, and the working tree renders LF, hashes to
 * 5281bc37…, and does NOT equal the registered pin. Same commit, different artefact.
 *
 * ⛔ SO THE RULE IS READ FROM THE REPOSITORY, NEVER ASSUMED FROM THE ENVIRONMENT.
 * `.gitattributes` states `eol=crlf` for this one path; `git check-attr` reports what Git
 * will actually apply, attributes taking precedence over `core.autocrlf`. The proof below is
 * therefore: CANONICAL BLOB + REPOSITORY-CONTROLLED EOL RULE = THE REGISTERED PIN. The
 * conversion happens in memory. Nothing on disk is read to establish it, because reading the
 * working tree would only re-prove this machine's configuration — the very thing that was
 * mistaken for a guarantee.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

/** The historical source, as a Git object identity — immune to working-tree conversion. */
const EXPECTED_OBSERVER_BLOB = 'ac0a39bcc3bd8d9944326c3c46320cbe01a1b139'
/** What the registered Scheduled Task pins, and what the staged machine copy matched. */
const EXPECTED_DEPLOYED_SHA256 = '2539e5154328f504c9e0d1a9dcc0c2567f30ab5ba3869a4fd9b9cb1d6a01da92'
/** What the SAME source renders to under `eol=lf` — recorded so the difference is not abstract. */
const CANONICAL_LF_SHA256 = '5281bc37e5eb028d5609680b4a10687c2d9bec82954b7abbfde7341709f89fe9'
/** The rule the repository must carry. Read back from Git, never assumed. */
const REQUIRED_TEXT_ATTR = 'set'
const REQUIRED_EOL_ATTR = 'crlf'

const OBSERVER_PATH = 'scripts/computer/observer.ps1'
const REPO_ROOT = path.resolve(__dirname, '../..')

const git = (args, opts) => execFileSync('git', args, Object.assign({ cwd: REPO_ROOT }, opts))
const gitText = (args) => git(args, { encoding: 'utf8' }).trim()
const gitBytes = (args) => git(args, { maxBuffer: 64 * 1024 * 1024 })
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

/**
 * The attribute Git will APPLY to this path, asked of Git itself. `check-attr` resolves
 * `.gitattributes` the same way checkout does, so this reports the rule in force rather than
 * the rule someone believes is in force.
 */
function attributeFor (name) {
  const line = gitText(['check-attr', name, '--', OBSERVER_PATH])
  const marker = ': ' + name + ': '
  const at = line.lastIndexOf(marker)
  assert.notEqual(at, -1, 'git check-attr returned an unparsable line: ' + JSON.stringify(line))
  return line.slice(at + marker.length).trim()
}

/**
 * ⛔ THE `eol=crlf` RENDERING, DONE IN MEMORY. Every LF becomes CRLF; an LF already preceded
 * by CR is left alone, so the function is idempotent and cannot silently double a line ending.
 */
function renderCrlf (buf) {
  const out = Buffer.alloc(buf.length * 2)
  let n = 0
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i]
    if (b === 0x0a && (i === 0 || buf[i - 1] !== 0x0d)) out[n++] = 0x0d
    out[n++] = b
  }
  return out.subarray(0, n)
}

test('*** E0-W1 CANONICAL OBSERVER SOURCE IS EXACT HISTORICAL BLOB ac0a39b ***', () => {
  const actual = gitText(['rev-parse', 'HEAD:' + OBSERVER_PATH])
  assert.equal(actual, EXPECTED_OBSERVER_BLOB)
})

test('*** ⛔ THE REPOSITORY CARRIES THE EOL RULE — NOT core.autocrlf ***', () => {
  /**
   * ⛔ ASKED OF GIT, NOT OF THE FILESYSTEM AND NOT OF LOCAL CONFIG. A `.gitattributes` entry
   * overrides `core.autocrlf`, which is exactly why the rule belongs in the repository: it
   * travels with the commit, so every checkout everywhere produces the same artefact.
   */
  assert.equal(attributeFor('text'), REQUIRED_TEXT_ATTR,
    '⛔ the observer path is no longer marked as text — checkout conversion is undefined')
  assert.equal(attributeFor('eol'), REQUIRED_EOL_ATTR,
    '⛔ the observer path no longer requires CRLF — a checkout would not match the deployed pin')
})

test('*** ⛔ CANONICAL BLOB + REPOSITORY EOL RULE = THE REGISTERED DEPLOYED PIN ***', () => {
  /**
   * ⛔ THE CHAIN, END TO END, WITHOUT TOUCHING THE WORKING TREE:
   *     historical blob ac0a39b  →  eol=crlf as the repository requires  →  2539e515…
   * and 2539e515… is what the registered Scheduled Task pins and what the staged copy on
   * AROMABRAIN was measured to be. Hashing the file on disk would prove only that THIS
   * machine is currently configured correctly, which is not a property of the commit.
   */
  const blob = gitBytes(['cat-file', 'blob', EXPECTED_OBSERVER_BLOB])
  assert.equal(blob.length, 14216, 'the canonical blob is the size it has always been')
  assert.equal(blob.indexOf(0x0d), -1, 'the canonical blob is pure LF, so the rule has work to do')

  const deployed = renderCrlf(blob)
  assert.equal(deployed.length, 14467, 'the CRLF rendering is the deployed byte length')
  assert.equal(sha256(deployed), EXPECTED_DEPLOYED_SHA256)

  // idempotent: applying the rule to already-converted bytes changes nothing
  assert.equal(sha256(renderCrlf(deployed)), EXPECTED_DEPLOYED_SHA256,
    'the conversion must not double an existing CRLF')
})

test('*** ⛔ EACH LINK CAN FAIL — THE EOL RULE, THE BLOB, AND THE EXPECTED PIN ***', () => {
  /**
   * ⛔ A TEST THAT CANNOT FAIL PROVES NOTHING. Three counterfactuals, asserted rather than
   * asserted-about, so the suite notices if any of them ever stops being a difference.
   */
  const blob = gitBytes(['cat-file', 'blob', EXPECTED_OBSERVER_BLOB])

  // 1. if the rule became `eol=lf`, the checkout would be the blob verbatim — a different file
  assert.equal(sha256(blob), CANONICAL_LF_SHA256, 'the LF rendering is a known, different artefact')
  assert.notEqual(CANONICAL_LF_SHA256, EXPECTED_DEPLOYED_SHA256,
    '⛔ LF and CRLF renderings hash alike — the eol rule would then be asserting nothing')

  // 2. if the observer source changed by even one byte, the deployed hash would move
  const tampered = Buffer.from(blob)
  tampered[tampered.length - 1] = tampered[tampered.length - 1] ^ 0x01
  assert.notEqual(sha256(renderCrlf(tampered)), EXPECTED_DEPLOYED_SHA256,
    '⛔ a one-bit change in the source did not move the deployed hash')

  // 3. and the comparison is an exact one, not a prefix or a truncation
  const nearMiss = EXPECTED_DEPLOYED_SHA256.slice(0, -1) + (EXPECTED_DEPLOYED_SHA256.endsWith('2') ? '3' : '2')
  assert.notEqual(sha256(renderCrlf(blob)), nearMiss,
    '⛔ a one-character difference in the expected pin still compared equal')
  assert.equal(nearMiss.length, EXPECTED_DEPLOYED_SHA256.length, 'the near miss is the same shape')
})

test('*** THIS CHECKOUT ALSO RENDERS THE DEPLOYED BYTES — corroboration, not the proof ***', () => {
  /**
   * Supplementary. The claim above is machine-independent; this one asks whether the rule is
   * actually being honoured HERE, which is the thing that used to be assumed. It is worth
   * asserting because it is now deterministic: with `eol=crlf` in `.gitattributes`, checkout
   * produces CRLF whatever `core.autocrlf` says. If this ever disagrees with the test above,
   * the finding is about the checkout, not about the commit.
   */
  const onDisk = fs.readFileSync(path.join(REPO_ROOT, OBSERVER_PATH))
  assert.equal(onDisk.length, 14467)
  assert.equal(sha256(onDisk), EXPECTED_DEPLOYED_SHA256,
    '⛔ the checked-out file does not match the registered pin — this checkout would deploy something else')
})
