'use strict'

/**
 * dataDir.js — WHERE THE OPERATIONAL STORES LIVE, decided in ONE place.
 *
 * ── THE DEFECT (backlog M-3, open since 2026-08-04) ──────────────────────────
 * This line existed in FOUR modules:
 *
 *     const DATA_DIR = process.env.AROMA_DATA_DIR || path.resolve(__dirname, '../../data')
 *
 * store/store.js · store/conversationStore.js · coo/proposal.js · run/store.js
 *
 * So ANY process that required one of them without setting the variable wrote to the Owner's
 * production store. The test suite is exactly such a process, and it had been doing it for
 * as long as the suite has existed.
 *
 * MEASURED, not suspected. Of 12,125 llm_usage rows in the live truth store on 2026-08-05:
 *
 *     4,768 'spy'   3,465 'f'   2,596 'fake'   264 'm'   201 other fixtures
 *       831 'claude-haiku-4-5-20251001'  ← the only rows from real model calls
 *
 * 93% of the largest collection in the Owner's operational truth store was written by tests.
 * The same root cause had already put 25 real records there through the differential
 * harness, where the Owner ruled: fix the default first, decide about the history after.
 * That ruling still stands — this file changes the DEFAULT and cleans nothing.
 *
 * ── WHY IT IS FIXED NOW ──────────────────────────────────────────────────────
 * Approval decisions are about to become durable records in this same store. Owner ruling:
 * 「a test suite that manufactures fake governance decisions is worse than one that
 * manufactures fake metering, and I will not land the audit work on top of a store that
 * tests still write to.」 Fake metering is noise. Fake approvals would be a corrupted
 * governance record — and the record would not say which rows were which.
 *
 * ── REDIRECT, NOT THROW ──────────────────────────────────────────────────────
 * A test process with no AROMA_DATA_DIR gets a per-process temp directory and ONE loud
 * warning. Throwing would be more fail-closed, and was considered: it would also break every
 * test that merely REQUIRES a store module without writing to it, turning a safety fix into
 * a suite rewrite. The dangerous operation is the WRITE, and after this there is nowhere for
 * a test write to land.
 *
 * ── THE DETECTION IS THE WHOLE FIX ───────────────────────────────────────────
 * NODE_TEST_CONTEXT is set by the node:test runner itself in the child process — verified
 * empirically ('child-v8'), not taken from documentation. Two more signals cover the cases
 * it misses: the runner's own process (`--test` in argv) and a test file executed directly.
 * The live server matches none of them and still gets production.
 */

const os = require('os')
const fs = require('fs')
const path = require('path')

/** The real store. Named rather than inlined, so a test can assert we are NOT it. */
const PRODUCTION_DIR = path.resolve(__dirname, '../../data')

/**
 * @param {object} env
 * @param {string[]} argv
 * @param {string|null} mainFile
 * @returns {boolean}
 */
function isTestProcess (env = process.env, argv = process.argv, mainFile = (require.main && require.main.filename) || null) {
  // Set by node:test in the child it spawns per file. The authoritative signal.
  if (typeof env.NODE_TEST_CONTEXT === 'string' && env.NODE_TEST_CONTEXT !== '') return true
  // The runner process itself, before it spawns children.
  if (Array.isArray(argv) && argv.includes('--test')) return true
  // `node something.test.js` — a developer running one file directly.
  if (typeof mainFile === 'string' && /\.test\.[cm]?js$/i.test(mainFile)) return true
  return false
}

// ONE temp directory per process, created lazily. All four modules must agree: if they each
// got their own, a test that wrote through one and read through another would see an empty
// store, and the disagreement would look like a bug in the code under test.
let redirected = null
let warned = false

function redirectDir (opts) {
  if (!redirected) redirected = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-data-test-'))
  if (!warned || (opts && opts.forceWarn)) {
    warned = true
    console.warn('[AROMA-HUB] AROMA_DATA_DIR is unset in a test process — operational stores redirected to ' +
      redirected + ' so the production store is never written. Set AROMA_DATA_DIR explicitly to choose.')
  }
  return redirected
}

/**
 * @returns {string} the directory the operational JSON stores live in
 */
function resolveDataDir (env = process.env, argv = process.argv, mainFile, opts) {
  const explicit = env && env.AROMA_DATA_DIR
  if (typeof explicit === 'string' && explicit !== '') return explicit

  const main = mainFile === undefined ? ((require.main && require.main.filename) || null) : mainFile
  if (isTestProcess(env, argv, main)) return redirectDir(opts)

  return PRODUCTION_DIR
}

module.exports = { resolveDataDir, isTestProcess, PRODUCTION_DIR }
