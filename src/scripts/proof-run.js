'use strict'

/**
 * proof-run.js — end-to-end proof of the Aroma OS backend Capability Layer.
 *
 * This script proves the FULL governed chain works, without a human running
 * develop.js by hand. It drives the REAL Claude Code adapter through the
 * Dispatcher and demonstrates two things in one run:
 *
 *   STEP ONE (safety):  a Deploy to 'production' with NO approval must be
 *                        stopped by policy as 'pending_approval', and the real
 *                        adapter must never be invoked.
 *   STEP TWO (real work): a Develop to 'dev' is allowed, routed to the real
 *                        claude-code adapter, and produces a patch — which is
 *                        NEVER applied. Applying it is a separate human decision.
 *
 * Governance invariants this script upholds and NEVER breaks:
 *   - It NEVER passes an approval object for the production Deploy step.
 *   - It NEVER calls the Apply capability and NEVER applies the patch itself.
 *   - It only reads/reports; the human keeps the apply decision (apply.js).
 *
 * This file adds no backend logic: registry.js, agents.js, policy.js,
 * adapter.js and dispatcher.js are untouched and only consumed here.
 */

const os = require('node:os')
const path = require('node:path')

const { createDispatcher } = require('../capability/dispatcher')
const { createClaudeCodeAdapter } = require('../adapters/claude-code')
const { registerAgent, getHealth } = require('../capability/agents')

// --- tiny console helpers -------------------------------------------------

const RED = '[31m'
const GREEN = '[32m'
const CYAN = '[36m'
const RESET = '[0m'

function line () {
  console.log('-'.repeat(72))
}

function redLine (message) {
  console.log(`${RED}${message}${RESET}`)
}

// --- setup ----------------------------------------------------------------

// (2) Register the claude-code agent manifest. agents.js already seeds this
// manifest, but registering it here makes the proof self-contained: the script
// declares exactly the manifest it depends on rather than assuming a seed.
registerAgent({
  id: 'claude-code',
  role: 'Software Engineer',
  adapter: 'adapters/claude-code',
  provides: [
    { capability: 'Develop', version: 1, seed_quality: 0.9, seed_cost: '$' },
    { capability: 'Apply', version: 1, seed_quality: 0.95, seed_cost: 'free' }
  ],
  availability: 'local',
  status: 'active'
})

// (3) Construct the REAL Claude Code adapter. selfexecDir and backendRoot are
// resolved from the user's home directory, matching the on-disk layout.
const home = os.homedir()
const selfexecDir = path.join(home, 'Downloads', 'aroma-selfexec')
const backendRoot = path.join(home, 'Downloads', 'm1', 'aroma-m1-backend')

const realAdapter = createClaudeCodeAdapter({ selfexecDir, backendRoot })

// Wrap the real adapter with an invocation counter so the safety check can
// PROVE the real worker was never touched during the production Deploy step.
// The wrapper only delegates — it adds no behaviour of its own.
let realInvocations = 0
const countingAdapter = {
  invoke (capabilityId, version, input) {
    realInvocations += 1
    return realAdapter.invoke(capabilityId, version, input)
  },
  health () {
    return realAdapter.health()
  }
}

// (4) Create a dispatcher with the (wrapped) real adapter registered under the
// agent id 'claude-code', and an eventSink that prints each Event as it fires.
const dispatcher = createDispatcher({
  adapters: { 'claude-code': countingAdapter },
  eventSink (event) {
    console.log(
      `${CYAN}[event]${RESET} capability=${event.capabilityId}@${event.version} ` +
      `verdict=${event.verdict} rule_id=${event.rule_id} ` +
      `agentId=${event.agentId} success=${event.success} ` +
      `cost=${event.cost} latencyMs=${event.latencyMs}`
    )
  }
})

// --- main -----------------------------------------------------------------

async function main () {
  console.log('AROMA OS — Capability Layer proof run')
  console.log(`selfexecDir : ${selfexecDir}`)
  console.log(`backendRoot : ${backendRoot}`)
  line()

  // ----------------------------------------------------------------------
  // (5) STEP ONE — the safety check.
  // Deploy to production with NO approval argument. Policy must return
  // 'pending_approval' and the real adapter must never be invoked.
  // ----------------------------------------------------------------------
  console.log('STEP ONE — safety check: Deploy -> production, NO approval')

  const invocationsBefore = realInvocations
  // NOTE: we deliberately pass NO second argument (no approval) to dispatch.
  const deployResult = await dispatcher.dispatch({
    capabilityId: 'Deploy',
    version: 1,
    target: 'production',
    context: { description: 'attempt to deploy to production without approval' }
  })

  const blocked = deployResult.status === 'pending_approval'
  const adapterUntouched = realInvocations === invocationsBefore

  if (!blocked || !adapterUntouched) {
    // Abort the whole script immediately on a governance failure.
    line()
    redLine('FAILURE — production safety check did NOT hold. Aborting proof run.')
    redLine(`  expected status 'pending_approval', got '${deployResult.status}'`)
    redLine(`  expected real adapter untouched, invocations delta = ${realInvocations - invocationsBefore}`)
    process.exitCode = 1
    return
  }

  console.log(
    `${GREEN}BLOCKED${RESET} — production Deploy was stopped by policy ` +
    `(status='${deployResult.status}', rule_id='${deployResult.rule_id}'). ` +
    'The real adapter was NEVER invoked.'
  )
  line()

  // ----------------------------------------------------------------------
  // (6) STEP TWO — the real work.
  // Develop to dev: allowed by policy, routed to the REAL claude-code adapter.
  // ----------------------------------------------------------------------
  console.log('STEP TWO — real work: Develop -> dev (drives the REAL adapter)')

  const developResult = await dispatcher.dispatch({
    capabilityId: 'Develop',
    version: 1,
    target: 'dev',
    context: {
      description: 'trivial dev-only change: add a static field to the GET /health response'
    },
    input: {
      task: 'In the Aroma OS backend, add a field capability_layer with the string value v1 to the JSON object returned by the existing GET /health endpoint. Change nothing else. Do not touch .env, node_modules, or production.',
      target: 'dev'
    }
  })

  // (7) Print the dispatch result.
  const patchPath = developResult.output ? developResult.output.patchPath : undefined
  line()
  console.log('Dispatch result (Develop@1 -> dev):')
  console.log(`  status    : ${developResult.status}`)
  console.log(`  agentId   : ${developResult.agentId}`)
  console.log(`  cost      : ${developResult.cost}`)
  console.log(`  latencyMs : ${developResult.latencyMs}`)
  console.log(`  patchPath : ${patchPath}`)
  line()

  // (8) Print the full Event trail.
  console.log('Event trail (getEvents):')
  const events = dispatcher.getEvents()
  events.forEach((event, i) => {
    console.log(
      `  #${i + 1} capability=${event.capabilityId}@${event.version} ` +
      `verdict=${event.verdict} rule_id=${event.rule_id} ` +
      `agentId=${event.agentId} success=${event.success} ` +
      `cost=${event.cost} latencyMs=${event.latencyMs}`
    )
  })
  line()

  // (9) Print the runtime health record, proving health was folded from the
  // Develop Event.
  const health = getHealth('claude-code', 'Develop', 1)
  console.log('Runtime health (claude-code / Develop@1):')
  if (health) {
    console.log(`  sample_count : ${health.sample_count}`)
    console.log(`  quality      : ${health.quality}`)
  } else {
    console.log('  (no health record — no Develop Event was folded)')
  }
  line()

  // (10) Final report block.
  const verdicts = events.map(e => `${e.capabilityId}@${e.version}:${e.verdict}(${e.rule_id})`)
  const realAdapterRanForDev = developResult.status === 'ok' && realInvocations > 0

  console.log('FINAL REPORT')
  console.log(`  policy verdicts observed       : ${verdicts.join(', ')}`)
  console.log(`  production blocked             : ${blocked ? 'YES' : 'NO'}`)
  console.log(`  real adapter invoked for dev   : ${realAdapterRanForDev ? 'YES' : 'NO'}`)
  console.log(`  patch produced                 : ${patchPath}`)
  console.log('  REMINDER: the patch was NOT applied. Applying it is a separate,')
  console.log('            explicit human decision made with apply.js. This script')
  console.log('            never calls Apply and never applies the patch itself.')
  line()
}

main().catch(err => {
  redLine(`proof-run crashed: ${(err && err.stack) || err}`)
  process.exitCode = 1
})
