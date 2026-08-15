'use strict'

/**
 * E0-W1 Canonical Observer Source Foundation.
 *
 * The canonical Observer source is not a reconstruction. It is the exact historical Git
 * blob that was independently pinned by the registered task and later matched by the staged
 * machine copy. This test asks Git for the blob object stored at the canonical path, so line
 * ending conversion in a working tree cannot weaken the provenance check.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const path = require('node:path')

const EXPECTED_OBSERVER_BLOB = 'ac0a39bcc3bd8d9944326c3c46320cbe01a1b139'
const REPO_ROOT = path.resolve(__dirname, '../..')

test('*** E0-W1 CANONICAL OBSERVER SOURCE IS EXACT HISTORICAL BLOB ac0a39b ***', () => {
  const actual = execFileSync(
    'git',
    ['rev-parse', 'HEAD:scripts/computer/observer.ps1'],
    { cwd: REPO_ROOT, encoding: 'utf8' }
  ).trim()

  assert.equal(actual, EXPECTED_OBSERVER_BLOB)
})
