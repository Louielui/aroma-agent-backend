'use strict'

/**
 * stagingCoverage.test.js — the staged program must be THIS program.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 * probe-machine.ps1's `staging` op compared the staged folder against seven hard-coded file
 * names: companion-entry.js, companion.js, computerOperatorFlag.js, ipcChannel.js,
 * observation.js, sealedOrderGate.js, sessionBoundary.js. That is the Phase 3a pipe Companion.
 *
 * Not one of those seven is a launcher, the identity collector, the machine probe, the PowerShell
 * transport or a canary entrypoint. So a preflight step reported as "the staged program is
 * verified" would have passed with every file the canary actually runs missing, extra or
 * altered — and it would have passed loudly, in green, at the exact moment it mattered.
 *
 * ── WHAT IT CHECKS NOW ─────────────────────────────────────────────────────
 * The staged manifest, by content: exact file set, exact hashes, nothing missing, nothing extra.
 * This file asserts that the manifest being checked COVERS the five categories the Owner named,
 * because "exact set" is only as strong as the set.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const PKG = require('../../scripts/computer/executionPackage')

const REPO = path.resolve(__dirname, '..', '..')
const PROBE = path.join(REPO, 'scripts', 'computer', 'probe-machine.ps1')
const STAGER = path.join(REPO, 'scripts', 'computer', 'stage-canary-closure.ps1')

/**
 * The five categories, each named by the FILES that must be covered rather than by a count.
 * A count would go green again the moment different files took their place.
 */
const CATEGORIES = Object.freeze({
  launcher: [
    'scripts/computer/Operator-CheckIdentity.ps1',
    'scripts/computer/Operator-CheckMachine.ps1',
    'scripts/computer/Operator-StartCompanion.ps1',
    'scripts/computer/operatorLauncher.ps1'
  ],
  collector: ['scripts/computer/collect-identity.ps1', 'src/computer/identityAttestation.js'],
  probe: ['scripts/computer/probe-machine.ps1', 'src/computer/machineProbe.js'],
  transport: ['scripts/computer/aromaJsonTransport.ps1', 'src/computer/powershellJsonRunner.js'],
  entrypoint: [
    'scripts/computer/run-notepad-canary.js',
    'scripts/computer/tool-check-identity.js',
    'scripts/computer/tool-check-machine.js',
    'scripts/computer/tool-start-companion.js'
  ]
})

/* ── the manifest covers every category ───────────────────────────────────── */

test('*** the staged manifest covers launcher, collector, probe, transport and entrypoint ***', () => {
  const listed = new Set(PKG.PACKAGE_FILES)
  const uncovered = []
  for (const [category, files] of Object.entries(CATEGORIES)) {
    for (const f of files) {
      if (!listed.has(f)) uncovered.push(category + ': ' + f)
    }
  }
  assert.deepEqual(uncovered, [], 'these run on the operator side and would not be staged or checked')
})

test('*** every category file exists — the list is not naming ghosts ***', () => {
  for (const files of Object.values(CATEGORIES)) {
    for (const f of files) {
      assert.ok(fs.existsSync(path.join(REPO, f.split('/').join(path.sep))), 'missing from the repo: ' + f)
    }
  }
})

test('*** the seven Phase 3a names are GONE from the staging check ***', () => {
  // Named individually, because this is the specific defect being closed.
  const probe = fs.readFileSync(PROBE, 'utf8')
  const code = probe.replace(/<#[\s\S]*?#>/g, '').replace(/#.*$/gm, '')
  for (const stale of ['companion-entry.js', 'ipcChannel.js', 'observation.js']) {
    assert.equal(code.includes(stale), false, 'the staging check still names a Phase 3a file: ' + stale)
  }
  // And they are not in the package either, so they will not be staged at all.
  for (const stale of ['scripts/computer/companion-entry.js', 'src/computer/ipcChannel.js',
    'src/computer/companion.js', 'src/computer/observation.js']) {
    assert.equal(PKG.PACKAGE_FILES.includes(stale), false, 'still packaged: ' + stale)
  }
})

/* ── the check is by content, and refuses both directions ─────────────────── */

test('*** the staging check verifies HASHES, not just names ***', () => {
  const code = fs.readFileSync(PROBE, 'utf8').replace(/<#[\s\S]*?#>/g, '').replace(/#.*$/gm, '')
  assert.match(code, /Get-FileHash[\s\S]{0,120}SHA256/, 'it hashes what is on disk')
  assert.match(code, /staging_file_changed/, 'and refuses a file whose content differs')
  assert.match(code, /staging_file_missing/, 'refuses a missing file')
  assert.match(code, /staging_unexpected_file/, 'and refuses an EXTRA file')
  assert.match(code, /staging_manifest_missing/, 'and refuses to proceed with no manifest at all')
})

test('*** an extra file in the staged folder is a refusal, not a shrug ***', () => {
  // The direction that is easy to forget. A folder the operator can execute from, containing one
  // file nobody registered, is the whole shape of the problem.
  const code = fs.readFileSync(PROBE, 'utf8').replace(/#.*$/gm, '')
  assert.match(code, /-Recurse/, 'the scan for extras walks the whole tree, not just the top level')
  const idx = code.indexOf('staging_unexpected_file')
  const before = code.slice(Math.max(0, idx - 400), idx)
  assert.match(before, /foreach/, 'it is reached from a loop over what is actually on disk')
})

test('*** the stager builds the manifest from the PACKAGE, not from its own list ***', () => {
  // A second list inside the staging script would be a second opinion about what runs, and the
  // one in the approval is the one that counts.
  const src = fs.readFileSync(STAGER, 'utf8')
  assert.match(src, /executionPackage/, 'it reads the package module')
  assert.match(src, /PACKAGE_FILES/, 'and takes the file list from it')
  assert.match(src, /computePackageHash/, 'and records the package hash it staged')

  // No hard-coded closure list anywhere in it.
  const code = src.replace(/<#[\s\S]*?#>/g, '').replace(/#.*$/gm, '')
  assert.equal(/\$(ClosureNames|expected)\s*=\s*@\(/.test(code), false, 'no second closure list')
})

test('*** the stager verifies what it wrote by reading it back ***', () => {
  const code = fs.readFileSync(STAGER, 'utf8').replace(/#.*$/gm, '')
  assert.match(code, /Get-FileHash/, 'it hashes the staged copies')
  assert.match(code, /staged copies differ from the repo/, 'and stops if they differ from the source')
  assert.match(code, /Sddl/, 'and it records the folder ACL either side of the write')
})

test('the manifest the stager writes is the manifest the probe reads', () => {
  // One filename, spelled the same in both. Two spellings would mean the probe silently checks
  // nothing while the stager silently writes a file nobody reads.
  const stager = fs.readFileSync(STAGER, 'utf8')
  const probe = fs.readFileSync(PROBE, 'utf8')
  assert.ok(stager.includes('STAGE-MANIFEST.json'), 'the stager writes it')
  assert.ok(probe.includes('STAGE-MANIFEST.json'), 'the probe reads it')
})
