'use strict'

/**
 * PROBE — 2026-08-05. ONE PAID MODEL CALL. Not a test; see scripts/probes/README.md.
 *
 * QUESTION: does the classifier prompt's OWN commit example produce mode='commit'?
 *
 * 「幫我改 docs/canary/agent-canary.md，第二行改成 line 3」 — exact path, exact line, exact
 * replacement — was classified `ask` with CONVERSATION_CONTRACT both on and off. So the
 * contract is eliminated and the classifier is the confirmed location. Before paying for a
 * phrasing matrix, the reference point has to be established:
 *
 *   distillPrompt.js:69 lists 「幫我把 Timeline 的輪詢在終止狀態後停掉」 as a commit example,
 *   in the same system prompt the model is reading.
 *
 * If the prompt's own example does not produce commit, that is a bigger finding than any
 * phrasing question and a matrix would be wasted money.
 *
 * SECOND QUESTION, free once the first is answered: the card needs six links and only the
 * first two are now instrumented. If step 2 passes, do steps 3–5 hold? This runs the REAL
 * promotion seam — against a proposal store this script constructs itself, over a scratch
 * AROMA_DATA_DIR — so nothing reaches the Owner's live records.
 *
 * Run:
 *   $env:ANTHROPIC_API_KEY = [Environment]::GetEnvironmentVariable('ANTHROPIC_API_KEY','User')
 *   node scripts/probes/commitExample.js
 */

const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')

// BEFORE any require: AROMA_DATA_DIR defaults to production (backlog M-3).
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-probe-commit-'))

// Match the live process, minus the connectors an ACTION turn does not use anyway.
process.env.CONVERSATION_DEMO = 'on'
process.env.CONVERSATION_CONTRACT = 'on' // as live
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
const { promoteTaskToProposal } = require(path.join(ROOT, 'src/intake/proposalBridge'))
const { createProposalStore } = require(path.join(ROOT, 'src/coo/proposal'))
const { createRunStore } = require(path.join(ROOT, 'src/run/store'))
const store = require(path.join(ROOT, 'src/store/store'))
const { inferWorkRequest } = require(path.join(ROOT, 'src/agent/requestInference'))

// distillPrompt.js:69, verbatim.
const MESSAGE = '幫我把 Timeline 的輪詢在終止狀態後停掉'

;(async () => {
  // In-memory run + proposal stores built HERE, so the real seam can run without the
  // Owner's live proposal records being involved at all.
  // `persistence: false` is the in-memory mode the run store documents for tests, and the
  // dispatcher is inert: a probe must not be able to dispatch anything, and confirm is not
  // reached here in any case.
  const runStore = createRunStore({
    resolveOwner: () => 'louie',
    dispatcher: async () => ({ ok: false, error: 'inert probe dispatcher' }),
    authorizeDispatch: () => false,
    persistence: false
  })
  const proposalStore = createProposalStore({ runStore, resolveOwner: () => 'louie', persistence: false })

  const promoteCalls = []
  const promoteToProposal = async (taskId) => {
    promoteCalls.push(taskId)
    try {
      const r = await promoteTaskToProposal({ store, proposalStore, taskId })
      if (r.status === 200 && r.body && r.body.proposalId) {
        const proposal = proposalStore.getProposal(r.body.proposalId)
        return proposal ? { ok: true, proposal } : { ok: false, error: { code: 'proposal_record_missing' } }
      }
      return { ok: false, error: { code: 'promote_rejected', message: `status ${r.status}` } }
    } catch (err) {
      return { ok: false, error: { code: 'promote_error', message: err && err.message } }
    }
  }

  const tel = {}
  let res = null
  let err = null
  try {
    res = await processIntake(MESSAGE, getAdapter(), [], {
      interactionMode: 'proposal', demo: true, telemetry: tel,
      requestId: '00000000-0000-4000-8000-000000000004',
      promoteToProposal
    })
  } catch (e) { err = { name: e && e.name, reason: (e && e.reason) || null } }

  // Step 6's payload — deterministic, no model call.
  const inferred = inferWorkRequest({ message: MESSAGE, conversation: '' })

  console.log(JSON.stringify({
    probe: 'commitExample',
    // ── step 2: the classifier ────────────────────────────────────────────
    mode: tel.mode === undefined ? null : tel.mode,
    modeCoerced: tel.modeCoerced === undefined ? null : tel.modeCoerced,
    clarificationReason: tel.clarificationReason === undefined ? null : tel.clarificationReason,
    parseResult: tel.parseResult || null,
    parseErrorReason: tel.parseErrorReason === undefined ? null : tel.parseErrorReason,
    stopReason: tel.stopReason === undefined ? null : tel.stopReason,
    outputTokens: tel.outputTokens === undefined ? null : tel.outputTokens,
    error: err,
    // ── steps 3-5: one task, persisted, promoted ─────────────────────────
    taskCount: res && Array.isArray(res.tasks) ? res.tasks.length : null,
    promoteSeamCalled: promoteCalls.length,
    promotedTaskIdResolved: promoteCalls.filter(Boolean).length,
    proposalCount: res && Array.isArray(res.proposals) ? res.proposals.length : null,
    promoteErrors: res && Array.isArray(res.promoteErrors) ? res.promoteErrors.map((e) => e && e.code) : null,
    demoOutcome: (res && res.demoOutcome) || null,
    // ── step 6: what the UI would receive ────────────────────────────────
    carriesProposal: !!(res && Array.isArray(res.proposals) && res.proposals.length > 0),
    inferredHasFile: !!(inferred && inferred.file),
    inferredNeedsQuestion: !!(inferred && inferred.question)
  }, null, 2))
})().catch((e) => { console.error('PROBE FAILED:', e && e.message); process.exit(1) })
