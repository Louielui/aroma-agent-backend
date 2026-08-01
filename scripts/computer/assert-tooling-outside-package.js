'use strict'

/**
 * assert-tooling-outside-package.js — prove the tooling edit did not move the package.
 *
 * ── WHY THIS IS NOT LEFT AS AN ARGUMENT ────────────────────────────────────
 * "Those two scripts are not in PACKAGE_FILES, so editing them cannot change the hash" is a
 * true sentence and a bad check. It is exactly the shape of reasoning that produced the previous
 * three defects in this area: the walk that followed the wrong graph, the staging op that
 * verified the wrong program, and the verifier that matched the wrong file. Each was a correct
 * sentence about something nobody had measured.
 *
 * So: record the hash, make the edit, recompute, compare. Two numbers.
 *
 * Usage:
 *   node scripts/computer/assert-tooling-outside-package.js record  > <file>
 *   node scripts/computer/assert-tooling-outside-package.js verify  < <file>
 *
 * It reads and writes nothing under C:\Aroma\ComputerOperator-Companion and starts no process.
 */

const PKG = require('./executionPackage')

/** The two tools this round edits. Neither runs a canary or decides anything about one. */
const TOOLING = Object.freeze([
  'scripts/computer/verify-staged-closure.ps1',
  'scripts/computer/stage-canary-closure.ps1'
])

function snapshot () {
  return {
    packageHash: PKG.computePackageHash(),
    fileCount: PKG.PACKAGE_FILES.length,
    toolingInPackage: TOOLING.filter((t) => PKG.PACKAGE_FILES.includes(t))
  }
}

const verb = process.argv[2]

if (verb === 'record') {
  process.stdout.write(JSON.stringify(snapshot(), null, 2) + '\n')
  process.exit(0)
}

if (verb === 'verify') {
  let before = ''
  try { before = require('node:fs').readFileSync(0, 'utf8') } catch (_) { before = '' }
  let prior
  try { prior = JSON.parse(before) } catch (_) {
    process.stderr.write('no recorded snapshot on stdin\n')
    process.exit(2)
  }
  const now = snapshot()
  const problems = []

  if (now.toolingInPackage.length > 0) {
    problems.push('the tooling IS in PACKAGE_FILES: ' + now.toolingInPackage.join(', '))
  }
  if (prior.toolingInPackage.length > 0) {
    problems.push('the tooling was in PACKAGE_FILES before the edit too: ' + prior.toolingInPackage.join(', '))
  }
  if (now.packageHash !== prior.packageHash) {
    problems.push('the package hash MOVED: ' + prior.packageHash + ' -> ' + now.packageHash)
  }
  if (now.fileCount !== prior.fileCount) {
    problems.push('the package file count changed: ' + prior.fileCount + ' -> ' + now.fileCount)
  }

  process.stdout.write('  before : ' + prior.packageHash + '  (' + prior.fileCount + ' files)\n')
  process.stdout.write('  after  : ' + now.packageHash + '  (' + now.fileCount + ' files)\n')
  process.stdout.write('  identical      : ' + (now.packageHash === prior.packageHash) + '\n')
  process.stdout.write('  tooling in pkg : ' + (now.toolingInPackage.length === 0 ? 'no (neither file)' : now.toolingInPackage.join(', ')) + '\n')

  if (problems.length) {
    process.stdout.write('\n  FAILED:\n    ' + problems.join('\n    ') + '\n')
    process.exit(1)
  }
  process.stdout.write('\n  PASS — the staged tree does not need restaging for this edit.\n')
  process.exit(0)
}

process.stderr.write('usage: assert-tooling-outside-package.js record|verify\n')
process.exit(2)
