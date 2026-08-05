'use strict'

/**
 * PROBE — 2026-08-05. TWO PAID MODEL CALLS. Not a test; see scripts/probes/README.md.
 *
 * QUESTION: does CONVERSATION_CONTRACT cause an explicit change request to be classified
 * as something other than commit?
 *
 * ONE VARIABLE. Same message, same model, same everything else; the contract on, then off.
 * The raw mode is read off the diag channel rather than inferred from a reply string and a
 * token count, which is how the original diagnosis had to be made.
 *
 * ANSWER (2026-08-05): NO. mode='ask' with the contract both ON and OFF. The candidate is
 * eliminated. Contract line 125 — 「當 Louie 要求你做一件目前未接通、未啟用或未獲授權的事,
 * 先說明這個限制,然後才問細節」 — was plausible and recently changed, which is exactly the
 * shape of an explanation that was disproved once before. It was disproved again.
 *
 * KNOWN GAP IN THE FIRST RUN OF THIS SCRIPT: it recorded parseResult but NOT
 * parseErrorReason, so when the ON arm hit a DistillParseError it proved the parse failed
 * and nothing about how — costing a repeat call. Both are captured below now. This is the
 * Owner's reason for wanting probes committed: a reviewable script catches that before the
 * call is spent, not after.
 *
 * Run:
 *   $env:ANTHROPIC_API_KEY = [Environment]::GetEnvironmentVariable('ANTHROPIC_API_KEY','User')
 *   node scripts/probes/contractVariable.js
 */

const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')

// BEFORE any require: AROMA_DATA_DIR defaults to production (backlog M-3).
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-probe-contract-'))

process.env.CONVERSATION_DEMO = 'on'
process.env.TURN_ROUTER = 'on'
process.env.LLM_PROVIDER = 'claude'
process.env.CLAUDE_MODEL = 'claude-haiku-4-5-20251001'
process.env.MULTI_AI_ROUTER = 'off'
process.env.READ_ACCESS = 'off'
process.env.DECISION_RECALL = 'off'
process.env.CONVERSATION_RECALL = 'off'

const ROOT = path.resolve(__dirname, '../..')
const { processIntake } = require(path.join(ROOT, 'src/intake/intakeService'))
const { getAdapter } = require(path.join(ROOT, 'src/adapters/adapterFactory'))

const MESSAGE = '幫我改 docs/canary/agent-canary.md，第二行改成 line 3'

async function run (contract, n) {
  process.env.CONVERSATION_CONTRACT = contract
  const tel = {}
  let res = null
  let err = null
  try {
    res = await processIntake(MESSAGE, getAdapter(), [], {
      interactionMode: 'proposal', demo: true, telemetry: tel,
      requestId: '00000000-0000-4000-8000-00000000000' + n
      // promoteToProposal deliberately NOT injected: nothing may reach a live store.
    })
  } catch (e) { err = { name: e && e.name, reason: (e && e.reason) || null } }
  return {
    CONVERSATION_CONTRACT: contract,
    error: err,
    mode: tel.mode === undefined ? null : tel.mode,
    modeCoerced: tel.modeCoerced === undefined ? null : tel.modeCoerced,
    clarificationReason: tel.clarificationReason === undefined ? null : tel.clarificationReason,
    parseResult: tel.parseResult || null,
    parseErrorReason: tel.parseErrorReason === undefined ? null : tel.parseErrorReason,
    stopReason: tel.stopReason === undefined ? null : tel.stopReason,
    outputTokens: tel.outputTokens === undefined ? null : tel.outputTokens,
    demoOutcome: (res && res.demoOutcome) || null
  }
}

;(async () => {
  const out = []
  out.push(await run('on', 1))
  out.push(await run('off', 2))
  console.log(JSON.stringify(out, null, 2))
})().catch((e) => { console.error('PROBE FAILED:', e && e.message); process.exit(1) })
