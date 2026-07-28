'use strict'

/**
 * computerOperatorFlag.js — Computer Operator v0, PHASE 1. The flag resolver, and
 * nothing else.
 *
 * ── IT IS NOT WIRED, AND TURNING IT ON DOES NOTHING ───────────────────────────
 * No module in src/ calls this. `resolveComputerOperator()` returns a string and that
 * string is read by nobody, so setting COMPUTER_OPERATOR=on in the environment has
 * exactly zero effect today. A test asserts that non-wiring, so it stays true until
 * somebody changes it deliberately.
 *
 * ── THE MATRIX QUESTION IS THE OWNER'S, AND IS OPEN ───────────────────────────
 * The existing execution gate (src/agent/agentAuthorization.js) refuses to run anything
 * when two or more of {WORKER_INVOCATION, DEVELOP_DISPATCH, AGENT_BRIDGE} are on. Adding
 * a fourth flag raises a question this file deliberately does NOT answer: may
 * COMPUTER_OPERATOR and AGENT_BRIDGE be on together, or are they mutually exclusive?
 * They are different capability domains — one edits files in a throwaway clone, the
 * other operates a real desktop — so the existing rule is not automatically right.
 *
 * Until the Owner rules, agentAuthorization.js is UNTOUCHED and still knows about three
 * flags. This resolver stands alone and joins no matrix.
 *
 * Fail-closed, exactly like the other resolvers: strict 'on' only; unset, empty,
 * misspelled, wrong case or any other value → 'off'. An invalid flag can never open it.
 */

function resolveComputerOperator (env = process.env) {
  const raw = env.COMPUTER_OPERATOR
  if (raw === undefined || raw === null || raw === '') return 'off'
  if (raw === 'on' || raw === 'off') return raw
  console.warn('[AROMA-HUB] Invalid COMPUTER_OPERATOR — falling back to \'off\'.')
  return 'off'
}

module.exports = { resolveComputerOperator }
