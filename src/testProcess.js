'use strict'

/**
 * testProcess.js — AM I A TEST PROCESS? ASKED IN ONE PLACE, ANSWERED ONE WAY.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THIS FUNCTION IS NOT NEW. It was written for `store/dataDir.js`, where it stops a test
 * from writing the Owner's operational store, and it is moved here UNCHANGED — same three
 * signals, same order, same semantics — because a SECOND consumer now needs the same fact:
 * `adapters/liveEgressFence.js`, which stops a test from spending the Owner's money.
 *
 * ⛔ AND IT IS MOVED RATHER THAN COPIED, WHICH IS THE ENTIRE REASON THIS FILE EXISTS. Two
 * components able to establish the same fact is a coincidence waiting to diverge — the repo
 * says so at `intake/intakeService.js:118`. If a copy drifted, the store fence and the egress
 * fence would disagree about what a test process IS, and the disagreement would surface as a
 * paid call nobody could explain. `store/dataDir.js` now requires and re-exports this, so its
 * own suite is untouched and its unchanged green is the proof the move was behaviour-free.
 *
 * ── THE DETECTION IS THE WHOLE FIX ───────────────────────────────────────────
 * NODE_TEST_CONTEXT is set by the node:test runner itself in the child process — verified
 * empirically ('child-v8'), not taken from documentation. Two more signals cover the cases
 * it misses: the runner's own process (`--test` in argv) and a test file executed directly.
 * The live server matches none of them.
 * ══════════════════════════════════════════════════════════════════════════════
 */

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

module.exports = { isTestProcess }
