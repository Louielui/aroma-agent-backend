'use strict'

/**
 * agentAuthorization.test.js — the four-flag gate (Owner ruling, 2026-07-28).
 *
 * COMPUTER_OPERATOR joins the existing gate as a peer: ANY TWO of the four 'on' ⇒
 * configuration_conflict ⇒ zero execution. No exemption, no table of special cases.
 *
 * THE BACKWARD-COMPATIBILITY PROOF IS AGAINST THE OLD CODE, NOT AGAINST A TABLE.
 * LEGACY_authorizeExecution below is a VERBATIM copy of the three-flag implementation as
 * it stood before this change. Every one of the 32 input combinations is run through both
 * and compared. A hand-written expectation table would only prove I copied my own
 * assumptions correctly; this proves the behaviour did not move.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { authorizeExecution, resolveAgentBridge } = require('./agentAuthorization')

/* ── VERBATIM copy of the pre-change implementation. Do not "improve" it. ──── */
function LEGACY_authorizeExecution (o = {}) {
  const worker = o.worker === 'on' ? 'on' : 'off'
  const develop = o.develop === 'on' ? 'on' : 'off'
  const agent = o.agent === 'on' ? 'on' : 'off'
  const onCount = [worker, develop, agent].filter((x) => x === 'on').length

  if (onCount >= 2) {
    return { status: 'configuration_conflict', workerAuthorized: false, developAuthorized: false, agentBridgeAuthorized: false }
  }
  const developAuthorized = develop === 'on' && o.dispatcherConfigured === true
  const workerAuthorized = worker === 'on'
  const agentBridgeAuthorized = agent === 'on' && o.agentRunnerConfigured === true
  const status = developAuthorized
    ? 'develop_authorized'
    : (workerAuthorized
        ? 'worker_authorized'
        : (agentBridgeAuthorized ? 'agent_bridge_authorized' : 'not_authorized'))
  return { status, workerAuthorized, developAuthorized, agentBridgeAuthorized }
}

const FLAGS = ['off', 'on']
const BOOLS = [false, true]

/* ── the compatibility proof ──────────────────────────────────────────────── */

test('*** with COMPUTER_OPERATOR off, all 32 combinations are byte-identical to the old gate ***', () => {
  let checked = 0
  for (const worker of FLAGS) {
    for (const develop of FLAGS) {
      for (const agent of FLAGS) {
        for (const dispatcherConfigured of BOOLS) {
          for (const agentRunnerConfigured of BOOLS) {
            const input = { worker, develop, agent, dispatcherConfigured, agentRunnerConfigured }
            const legacy = LEGACY_authorizeExecution(input)
            // both the explicit 'off' and the ABSENT case must match — every caller today
            // passes no `computer` key at all
            for (const now of [authorizeExecution(input), authorizeExecution({ ...input, computer: 'off' })]) {
              assert.deepEqual(
                {
                  status: now.status,
                  workerAuthorized: now.workerAuthorized,
                  developAuthorized: now.developAuthorized,
                  agentBridgeAuthorized: now.agentBridgeAuthorized
                },
                legacy,
                JSON.stringify(input)
              )
              assert.equal(now.computerOperatorAuthorized, false, 'the new lane stays off: ' + JSON.stringify(input))
            }
            checked++
          }
        }
      }
    }
  }
  assert.equal(checked, 32, 'every combination was checked')
})

test('the differences are ADDITIVE: every added lane is a new field, false by default', () => {
  // Stated explicitly rather than left for a reader to discover. Three whole-object
  // assertions elsewhere had to be narrowed to the four original fields because of it.
  //
  // ⛔ UPDATED when READ_ONLY_ENQUIRY joined as the FIFTH lane. The property this test
  // exists for is unchanged — a new lane may only ever ADD a field that defaults to false,
  // never alter an existing one — so the key list grows with it rather than the test being
  // deleted. computerOperatorAuthorized was the fifth field; readOnlyEnquiryAuthorized is
  // the sixth.
  const r = authorizeExecution({ worker: 'off', develop: 'off', agent: 'off' })
  assert.deepEqual(Object.keys(r).sort(), [
    'agentBridgeAuthorized', 'computerOperatorAuthorized', 'developAuthorized',
    'readOnlyEnquiryAuthorized', 'status', 'workerAuthorized'
  ])
  assert.equal(r.computerOperatorAuthorized, false)
  assert.equal(r.readOnlyEnquiryAuthorized, false)
})

test('*** ANY two of the FIVE lanes on ⇒ configuration_conflict ⇒ zero execution ***', () => {
  // The same ruling the four-lane test makes, extended to the lane added here. Written as
  // its own test rather than by editing the existing one, so the original guarantee keeps
  // its own name in the ledger.
  const lanes = ['worker', 'develop', 'agent', 'computer', 'readOnlyEnquiry']
  let pairs = 0
  for (let i = 0; i < lanes.length; i++) {
    for (let k = i + 1; k < lanes.length; k++) {
      const input = {
        dispatcherConfigured: true,
        agentRunnerConfigured: true,
        computerSupervisorConfigured: true,
        readOnlyEnquiryConfigured: true
      }
      input[lanes[i]] = 'on'
      input[lanes[k]] = 'on'
      const r = authorizeExecution(input)
      pairs++
      assert.equal(r.status, 'configuration_conflict', lanes[i] + ' + ' + lanes[k])
      assert.equal(r.workerAuthorized, false)
      assert.equal(r.developAuthorized, false)
      assert.equal(r.agentBridgeAuthorized, false)
      assert.equal(r.computerOperatorAuthorized, false)
      assert.equal(r.readOnlyEnquiryAuthorized, false)
    }
  }
  assert.equal(pairs, 10, 'all ten pairs of five lanes must be covered')
})

/* ── the ruling: mutually exclusive, four ways ────────────────────────────── */

test('*** ANY two of the FOUR on ⇒ configuration_conflict ⇒ zero execution ***', () => {
  const lanes = ['worker', 'develop', 'agent', 'computer']
  let pairs = 0
  for (let i = 0; i < lanes.length; i++) {
    for (let j = i + 1; j < lanes.length; j++) {
      const input = {
        worker: 'off',
        develop: 'off',
        agent: 'off',
        computer: 'off',
        dispatcherConfigured: true,
        agentRunnerConfigured: true,
        computerSupervisorConfigured: true
      }
      input[lanes[i]] = 'on'
      input[lanes[j]] = 'on'
      const r = authorizeExecution(input)
      assert.equal(r.status, 'configuration_conflict', lanes[i] + ' + ' + lanes[j])
      assert.equal(r.workerAuthorized, false)
      assert.equal(r.developAuthorized, false)
      assert.equal(r.agentBridgeAuthorized, false)
      assert.equal(r.computerOperatorAuthorized, false)
      pairs++
    }
  }
  assert.equal(pairs, 6, 'all six pairs of four lanes')
})

test('three or four on is also a conflict, not a majority vote', () => {
  const all = { worker: 'on', develop: 'on', agent: 'on', computer: 'on', dispatcherConfigured: true, agentRunnerConfigured: true, computerSupervisorConfigured: true }
  assert.equal(authorizeExecution(all).status, 'configuration_conflict')
  assert.equal(authorizeExecution({ ...all, computer: 'off' }).status, 'configuration_conflict')
})

/* ── the new lane needs a supervisor, exactly like the others need a runner ── */

test('*** COMPUTER_OPERATOR alone authorizes NOTHING without a configured supervisor ***', () => {
  const on = { worker: 'off', develop: 'off', agent: 'off', computer: 'on' }
  assert.equal(authorizeExecution(on).computerOperatorAuthorized, false, 'no supervisor configured')
  assert.equal(authorizeExecution(on).status, 'not_authorized')
  // and even with one, it is only this lane — never another
  const withSup = authorizeExecution({ ...on, computerSupervisorConfigured: true })
  assert.equal(withSup.computerOperatorAuthorized, true)
  assert.equal(withSup.status, 'computer_operator_authorized')
  assert.equal(withSup.workerAuthorized, false)
  assert.equal(withSup.developAuthorized, false)
  assert.equal(withSup.agentBridgeAuthorized, false)
})

test('an invalid or absent flag value can never open the gate', () => {
  for (const bad of [undefined, null, '', 'ON', 'yes', 'true', 1, true, {}]) {
    const r = authorizeExecution({ worker: 'off', develop: 'off', agent: 'off', computer: bad, computerSupervisorConfigured: true })
    assert.equal(r.computerOperatorAuthorized, false, 'refused computer flag: ' + String(bad))
  }
  // the AGENT_BRIDGE resolver is unchanged and equally strict
  assert.equal(resolveAgentBridge({}), 'off')
  assert.equal(resolveAgentBridge({ AGENT_BRIDGE: 'ON' }), 'off')
  assert.equal(resolveAgentBridge({ AGENT_BRIDGE: 'on' }), 'on')
})
