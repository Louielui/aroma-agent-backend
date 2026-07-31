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
  // the fixed entrypoint: the only production caller of the wiring
  'scripts/computer/run-notepad-canary.js',
  // the hands
  'scripts/computer/uiaCanary.ps1',
  // the work order itself travels with the package: it is what the code will be pointed at
  'docs/governance/canary-work-order.draft.json'
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
