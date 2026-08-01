'use strict'

/**
 * executionPackage.js — WHAT WILL ACTUALLY RUN, as a hashable list.
 *
 * ── THE HOLE THIS FILLS ────────────────────────────────────────────────────
 * An approval receipt binds a Work Order hash: it pins WHAT will be done — open Notepad, type
 * this text, save that file. It pins nothing about the CODE THAT DOES IT. So between approval
 * and execution somebody could change the adapter, the executor, the UIA script or the gate,
 * and the receipt would still verify. The Owner would have approved a description and got an
 * implementation he never saw.
 *
 * The execution package closes that. Every file that can influence what the canary does is
 * listed here by name, hashed, and folded into ONE hash the receipt carries.
 *
 * ── AN ALLOWLIST, NOT A GLOB ───────────────────────────────────────────────
 * Files are enumerated. A new module joining the execution path and not appearing here fails
 * the test, which forces a person to decide whether it belongs. A glob would have silently
 * absorbed exactly the file this exists to catch — the same reasoning as the desktop source
 * scan, and it cost nothing to repeat.
 *
 * ── WHAT IS DELIBERATELY IN ───────────────────────────────────────────────
 * Owner-Execute.ps1 is IN, even though it is a screen rather than an engine. It decides whether
 * execution happens at all, so a change to it is a change to what runs. That is also why the
 * unlock commit necessarily invalidates prior receipts: the fence lives in a packaged file, and
 * that is a feature — the Owner re-approves against the package that will really run.
 *
 * ── WHAT IS DELIBERATELY OUT ──────────────────────────────────────────────
 * Test files, the measured launchers for scripts A and B, the provisioning and staging scripts.
 * None of them runs during a canary. Including them would mean an unrelated test edit
 * invalidating a live approval, which trains people to re-approve without reading.
 *
 * ── SELF-COVERAGE: THIS FILE IS IN ITS OWN LIST, AND THAT IS FINE ─────────
 * It looks circular and is not. The hash is taken over the BYTES OF FILES ON DISK, never over
 * its own output, so there is no fixed point to solve and nothing to converge:
 *
 *   1. read the 19 files            <- plain file reads
 *   2. sort by path, ordinal         <- deterministic
 *   3. SHA-256 the canonical pairs   <- one pass, no recursion
 *
 * Step 1 reads this file the same way it reads any other. Editing it changes its bytes, which
 * changes its entry, which changes the package hash — the ordinary behaviour, and the point.
 * A test proves exactly that by editing a copy in a temp repo and watching the hash move.
 *
 * What WOULD be circular is hashing the computed hash, or storing the expected value inside
 * this file. Neither is done, and neither should be: an expected-value constant here would
 * have to be updated by hand every time, which is how a checksum becomes decoration.
 *
 * ── THE LIST IS NOT HAND-MAINTAINED ANY MORE ─────────────────────────────
 * executionPackageClosure.test.js walks `require` transitively from the fixed entrypoint and
 * fails if anything reachable is absent here. The first version of this list WAS hand-written
 * and was wrong by six files, so the walk is the authority and the list is what it checks.
 */

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.resolve(__dirname, '..', '..')

/**
 * Every file that can influence what the canary does. Paths are repo-relative and POSIX-style
 * so the hash does not depend on the platform that computed it.
 */
const PACKAGE_FILES = Object.freeze([
  // the two screens: they decide whether anything runs, and what the Owner is shown
  'scripts/computer/Owner-Approve.ps1',
  'scripts/computer/Owner-Execute.ps1',
  'scripts/computer/ownerApproval.js',
  // the decision layer
  'src/computer/sealedOrderGate.js',
  'src/computer/orderRegistry.js',
  'src/computer/computerOperatorFlag.js',
  'src/computer/killSwitch.js',
  // the execution layer
  'src/computer/computerExecutor.js',
  'src/computer/computerOperatorWiring.js',
  'src/computer/desktopAdapter.js',
  // The ONE PowerShell transport, shared by the adapter and the machine probe.
  'src/computer/powershellJsonRunner.js',
  'src/computer/identityAttestation.js',
  'src/computer/companionCanaryRunner.js',
  'src/computer/executeRequestStore.js',
  'src/computer/machineProbe.js',
  'src/computer/companionProductionFactory.js',
  // the fixed entrypoint: the only production caller of the wiring
  'scripts/computer/run-notepad-canary.js',
  // the hands
  'scripts/computer/uiaCanary.ps1',
  // the work order itself travels with the package: it is what the code will be pointed at
  'docs/governance/canary-work-order.draft.json',

  // ── ADDED 2026-07-31, after a transitive require walk found them ────────
  // The first list was written by hand from what seemed relevant, and a walk from the
  // entrypoint found six modules that reach the production call path and were not on it.
  // Every one of them can change what runs or what gets recorded, so an approval that did
  // not cover them covered less than it appeared to.
  //
  // THIS FILE, because it DEFINES the list. Left out, someone could add or remove entries
  // and the package hash would not move — the manifest would be the one thing the manifest
  // did not protect. See the self-coverage note below: there is no circularity, because the
  // hash is taken over file BYTES and never over its own output.
  'scripts/computer/executionPackage.js',
  // The audit sink and the directory resolver. One decides how records are written, the
  // other decides WHERE. Either could quietly break the audit or redirect it, and an
  // unrecorded run is the failure this whole design is built to prevent.
  'src/store/artifactStore.js',
  'src/runtime/artifactDir.js',
  // Reached through computerOperatorWiring -> companion -> observation/sessionBoundary.
  'src/computer/companion.js',
  'src/computer/sessionBoundary.js',
  'src/computer/observation.js'
])

const sha256File = (abs) => crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex')

/** Per-file hashes, in the listed order, with anything missing reported rather than skipped. */
function buildManifest (repo) {
  const root = repo || REPO
  const files = []
  const missing = []
  for (const rel of PACKAGE_FILES) {
    const abs = path.join(root, rel.split('/').join(path.sep))
    if (!fs.existsSync(abs)) { missing.push(rel); continue }
    files.push({ path: rel, sha256: sha256File(abs) })
  }
  return { files, missing }
}

/**
 * ONE hash over the whole package.
 *
 * Sorted by path before hashing, so the value depends on the CONTENT of the package and not on
 * the order somebody happened to type the list in. A missing file is not hashed away as an
 * absence — it makes the manifest incomplete, and the caller must refuse.
 */
function computePackageHash (repo) {
  const m = buildManifest(repo)
  if (m.missing.length > 0) {
    const e = new Error('execution package is incomplete: ' + m.missing.join(', '))
    e.missing = m.missing
    throw e
  }
  const canonical = JSON.stringify(
    m.files.slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((f) => [f.path, f.sha256])
  )
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex')
}

module.exports = { PACKAGE_FILES, buildManifest, computePackageHash, REPO }
