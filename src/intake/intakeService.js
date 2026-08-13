'use strict'

// Capability -> worker (which team member Aroma delegates each task to).
const WORKER_MAP = {
  architecture: 'Claude', product: 'Claude',
  coding: 'Codex', software: 'Codex',
  execution: 'Windows Agent', desktop: 'Windows Agent',
  browser: 'Manus', ssh: 'SSH Agent',
  verification: '香香(自己)', ops: '待指派'
}
function enrichTasks (storedTasks, distilledTasks) {
  return (storedTasks || []).map((t, i) => {
    const cap = (distilledTasks[i] && distilledTasks[i].capability) || 'ops'
    return { ...t, capability: cap, worker: WORKER_MAP[cap] || '待指派', stage: '待派工' }
  })
}

const { v4: uuidv4 } = require('uuid')
const { checkRedLine } = require('./redlinePolicy')
const { buildDistillPrompt, parseDistillResponse } = require('./distillPrompt')
const { buildDecisionRecallContext } = require('../coo/decisionRecall')       // Decision Recall v1 (chat-lane only)
const { buildConversationRecall } = require('../lab/conversationRecall')      // Conversation Recall v0.1 (chat-lane only, flag-gated)
const { replyCitesContext } = require('../lab/citationDetector')              // A′ narrowed: omit only when the REPLY drew on the context
const { listDecisions, listTasks } = require('../store/store')                // read-only store fns for recall
// Read Context Wiring v1 (chat-lane only, flag-gated OFF by default, fail-soft).
const { buildReadContext, aromaMethodFor } = require('../context/readContext')
const { logReadSource } = require('../utils/readContextLog') // fail-soft, but never silent
const { createLiveReadConnector, enabledSources } = require('../context/liveClients')
const { resolveFlag } = require('../context/flags')
const { createDispatchesForTasks, executeDispatch, statusLabel } = require('../dispatch/dispatcher')
const { logLLMCall, logRedLineBlock } = require('../utils/metricsLogger')
const { persistIntake, recordLLMUsage } = require('../utils/hubClient')
const { classifyDemoOutcome } = require('./demoOutcome')          // B2-2 slice 1 (pure)
const { buildGroundedReply } = require('./groundedReply')         // B2-2 reply grounding — action prose from the REAL outcome
const { buildPersonaSystemFromPersona, ACTION_HONESTY_GUARD } = require('../persona/xiangxiang') // B2-2 slice 2 hook (+ R2 pure composer) + honesty frame
const { CONVERSATION_CONTRACT, resolveConversationContract } = require('../persona/conversationContract') // Conversation Experience Contract v1 (flag-gated, OFF by default)
const { load: loadOwnerSettings, buildSettingsBlock } = require('../persona/ownerSettings') // Owner-editable style + preferences (no code change, no restart)
// Multi-AI Router v0 (flag-gated OFF; Claude stays default + one-shot fallback).
const { selectPrimaryProvider, OPENAI, CLAUDE } = require('../routing/modelRouter')
const { sourcesForProvider, decisionRecallSharedWith, withheldFrom } = require('../context/providerSharing') // per-source, per-provider sharing policy
const { createOpenAIAdapterIfConfigured } = require('../adapters/OpenAIAdapter')
const { getPersonaSource } = require('../persona/personaSource')   // R2 runtime persona source selector (legacy default; memory lazy-loaded)
const { buildContextPreamble } = require('../governance/contextCard')         // B2-2 slice 2 hook
const { IntakeUpstreamError } = require('./intakeErrors')         // B2-2 slice B — typed upstream error
const { runU1DraftShadow } = require('./u1DraftShadow')
const { isShortReply, isReadRequest } = require('./laneRouter') // a short confirmation is an answer, not an instruction
const { enforceReadState, enforceNoReadClaim } = require('./readStateGuard') // a reply may not deny a read that happened — nor claim one that never ran
// ⛔ Beside it, and for the same reason: the language rule was prose with no output check.
const { enforceTraditional, logTraditionalFlag } = require('./traditionalGuard')
const { buildReadResultReply } = require('./readResultView') // the Owner-facing shape of a read result
const { DISTILL_WITH_PLAN_SCHEMA, DISTILL_WITH_READ_DECISION_SCHEMA, withRowRefs, withReadChoices, withReadArgs, withChatKnowledgeModes, validatePlan, minimalAnswer, logAnswerPlan } = require('./answerPlan') // the model decides, the server proves
// ⛔ THE CLOSED VOCABULARY the model may pick a read from. It EXPANDS authorised sources; it
// never adds one. See readOperations.js.
const { operationsForSources, resolveReadOperation, operationForAromaMethod, describeOperations } = require('../context/readOperations')
// ⛔ A4-0A: the gate. Off (the default) ⇒ every line below that mentions A4 is inert.
const { a4ContractEnabled, a4SemanticRoutingEnabled, wouldLeakInternalEvidence, MIN_LEAKABLE_CHARS } = require('./a4Contract')
// ⛔ A4-2A: a public SEARCH is keyed per query, not per operation.
const { publicReadKey } = require('../context/publicReadIdentity')
const { createTurnPlanCache, ownerAuthoredContext, logEgressPlan } = require('./publicQueryEgressPlanner')
// ⛔ ONLY THE COMPLETENESS GUARD SURVIVES FROM MIX1. `missingWorld` is plain code answering
// 「given that both worlds are required, are both actually read?」 — a different question from
// 「does he want both?」, which is now the resolver's alone. The mixed VERIFIER (a model call
// that could classify a request as mixed) is deliberately no longer imported or wired: two
// components able to establish the same fact is a coincidence waiting to diverge.
const { missingWorld } = require('./mixedKnowledgeRequirement')
const { createTurnFinalCache, renderRequiredWorldObservation, logFinalRequirement } = require('./finalKnowledgeRequirement')
const { createTurnIntentCache, readMatchesIntent, buildIntentPrompt, logOwnerSourceIntent } = require('./ownerSourceIntentResolver')
const { runRecoveryWorker, buildWorkerPrompt, logRecoveryWorker } = require('./recoveryDecisionWorker')

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ A4-RR1 — WHERE THE SECOND PROVIDER IS CHOSEN, AND NOWHERE ELSE.
 *
 * recoveryDecisionWorker.js names no provider and no model; it is handed this closure. That
 * separation is the same one verifier EFFORT already uses — the semantic module states the
 * contract, the composition layer decides who answers it.
 *
 * ⛔ THE MODEL IS PINNED TO THE EXACT DATED BUILD THAT WAS MEASURED. `claude-haiku-4-5-20251001`
 * scored 40/40 on this contract with the currently configured key. It is written here rather
 * than inherited ON PURPOSE: a safety component must not be re-pointed by a setting that
 * exists to steer some other lane.
 *
 * The follow-up this comment used to describe — the adapter's retired hardcoded default — has
 * since been repaired: ClaudeAdapter now resolves an explicit pin, then CLAUDE_MODEL, then
 * FAILS CLOSED with no built-in model at all. This pin is what keeps that fix invisible here:
 * an explicit model always wins over the environment.
 *
 * ⛔ AND IT IS NOT THE MAIN BRAIN. This closure is reached only after the main model has been
 * told what is missing and has declined a second time. It returns one capability name, never
 * prose, and its output can never become the Owner's reply.
 * ══════════════════════════════════════════════════════════════════════════════
 */
const RECOVERY_WORKER_MODEL = 'claude-haiku-4-5-20251001'

async function defaultRecoveryWorker (input) {
  const { ClaudeAdapter } = require('../adapters/ClaudeAdapter')
  const adapter = new ClaudeAdapter({ model: RECOVERY_WORKER_MODEL })
  const r = await adapter.complete(buildWorkerPrompt(input), {
    system: input.system,
    responseFormat: { type: 'json_schema', name: 'recovery_decision', schema: input.schema, strict: true }
  })
  return r.text
}
// ⛔ A4-AMB1: one narrow binary gate, before any connector. Provider-neutral; the verifier
// itself is injected.
const { ambiguityGateEnabled, availableWorlds, worldForCapability, runSourceAmbiguityGate, logAmbiguityGate, SAFE_FALLBACK_QUESTION: AMBIGUITY_FALLBACK_QUESTION } = require('./sourceAmbiguityGate')
const { routeTurn, logTurnRoute, resolveTurnRouter } = require('./turnRouter') // intent-first router: UTILITY acts, the rest observe
const { answerUtility } = require('./utilityAnswer') // the server answers, or it says nothing
// An 'I cannot tell' may not outrank a deterministic classification (B canary, 052761bc).
const { decideWorldAsk } = require('./worldAskDecision')

/** ⛔ Status and reason only — never his words, never the question text (logContent fence). */
function logWorldAsk (requestId, resolverIntent, decision, asked) {
  try {
    console.log('[AROMA-WORLD-ASK]', JSON.stringify({
      requestId, resolverIntent, asked, reason: decision.reason,
      obligation: decision.requiredWorlds ? 'internal' : null
    }))
  } catch (_) { /* telemetry is never load-bearing */ }
}
// SHADOW ONLY: measures unsourced specific claims on zero-evidence turns. Decides nothing.
const { logNoEvidenceShadow } = require('./noEvidenceShadow')
// She must never have to ask the Owner what Aroma System is: identity, not availability.
const { namesInternalSystem, describe: describeSelf } = require('../governance/selfDescription')
// A post-generation check: she may not ask the Owner what his own system is (02e430e, twice).
const { enforceInternalSystemAnswer } = require('../governance/internalSystemAnswer')
// ⛔ No path ships silence. Measured 17:18: a completed call stored content:"".
const { ensureNonEmptyReply } = require('../governance/nonEmptyReply')
// B, the goal decomposer. Load-bearing behind GOAL_DECOMPOSER, default OFF. It states what a
// question NEEDS; the server then reads only what was named. A failure has no opinion.
const { decomposeGoal } = require('./goal/goalDecomposer')
const { goalDecomposerEnabled, sourcesForPlan, requirementBlock } = require('./goal/goalGate')

/**
 * One line whenever a false read-claim is corrected, so the failure is COUNTABLE and not
 * just visible on one screen. Allowlisted by construction, same discipline as the other
 * two logs: the source names, which rule fired, and the request id — never the reply, the
 * message, or anything read.
 */
/**
 * A turn that read nothing carried a note saying so. Counted, because 「how often does she
 * talk about a source we never read」 is the measurement that says whether the intent
 * vocabulary is the real problem — and nobody could answer it before this existed.
 * Metadata only: no message, no reply, no content.
 */
function logNoReadClaim (routeDecision, requestId) {
  try {
    console.log('[AROMA-READ-CLAIM]', JSON.stringify({
      event: 'NO_READ_CLAIM_NOTED',
      timestamp: new Date().toISOString(),
      route: (routeDecision && routeDecision.route) || null,
      reason: (routeDecision && routeDecision.reason) || null,
      requestId: typeof requestId === 'string' ? requestId : null
    }))
  } catch (_) { /* a diagnostic must never break a turn */ }
}

function logReadClaimCorrection (guarded, requestId) {
  try {
    console.log('[AROMA-READ-CLAIM]', JSON.stringify({
      event: 'READ_CLAIM_CORRECTED',
      timestamp: new Date().toISOString(),
      kind: guarded.kind,
      sources: guarded.sources,
      requestId: typeof requestId === 'string' ? requestId : null
    }))
  } catch (_) {}
}

/**
 * intakeService.js — orchestrates the full M1 intake pipeline.
 *
 * Pipeline (per task spec):
 *   1. RED-LINE policy check (FIRST — before any external call)
 *   2. LLM distillation via the adapter interface
 *   3. Persist via Wall-E's hub endpoint POST /api/v1/intake/persist
 *   4. Write metrics via Wall-E's hub endpoint POST /api/v1/llm-usage
 *   5. Return { understanding, decision, tasks, blocked: false }
 *
 * If red-line matched:
 *   - Record locally only (no external call)
 *   - Return { blocked: true, blocked_reason, understanding: "含敏感資訊..." }
 *
 * @param {string} message — Louie's raw message
 * @param {import('../adapters/LLMAdapter').LLMAdapter} adapter — injected LLM adapter
 * @returns {Promise<IntakeResult>}
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Per-lane output limits for the distill call. DEFAULT is the historical value and
// applies to the proposal lane and to any legacy/unset interactionMode.
const DEFAULT_MAX_TOKENS = 1024
/**
 * ⛔ ON A THINKING MODEL THIS IS A THINKING CAP, NOT A LENGTH CAP. (Owner decision, 8192.)
 *
 * 2048 was fitted to a model that answers without reasoning first. Measured on the same
 * prompt and the same schema:
 *
 *   opus-5 @ 2048   stop: max_tokens   out: 2048   thinking only, NO answer
 *   opus-5 @ 16000  stop: end_turn     out: 6712   thinking + a 2748-char answer
 *   haiku  @ 2048   stop: end_turn     out:  633   answer, no thinking block
 *
 * Roughly ten times the output for the same task, because the reasoning is billed as output.
 *
 * 8192 covers the one observed completion with about 22% headroom. 16384 was rejected: it
 * raises the per-turn ceiling eightfold against today for a need nobody has measured.
 *
 * ⛔ ONE COMPLETION IS DIRECTION, NOT RATE. How reasoning scales with question difficulty is
 * unmeasured. A harder question that needs more will arrive as `stop_reason: max_tokens` —
 * which now reports itself honestly through the adapter rather than as an empty string.
 */
const CHAT_MAX_TOKENS = 8192

// DECISION_RECALL runtime flag (same env-flag style as CONVERSATION_DEMO): only exact 'on'
// enables; unset/empty/any other value → fail-closed OFF.
function resolveDecisionRecall () { return process.env.DECISION_RECALL === 'on' ? 'on' : 'off' }

// CONVERSATION_RECALL runtime flag — same fail-closed style. OFF is the default and, with
// it off, nothing is read and the prompt is byte-identical to today's.
function resolveConversationRecall () { return process.env.CONVERSATION_RECALL === 'on' ? 'on' : 'off' }

async function processIntake (message, adapter, history = [], opts = {}) {
  // Correlation id: a caller-supplied requestId is honoured ONLY when it is a valid
  // UUID; anything missing/non-string/malformed is replaced by a fresh UUID. The
  // final id is the single correlationId used by success, the Error, and diagnostics.
  const supplied = opts && opts.requestId
  const requestId = (typeof supplied === 'string' && UUID_RE.test(supplied)) ? supplied : uuidv4()
  try {
    return await runIntakePipeline(message, adapter, history, opts, requestId)
  } catch (err) {
    // Slice B: every error leaving intake carries the correlationId (== requestId).
    // IntakeUpstreamError sets it in its constructor; DistillParseError and any
    // unexpected error are tagged here. Existing set values are never overwritten.
    if (err && err.correlationId == null) err.correlationId = requestId
    throw err
  }
}

async function runIntakePipeline (message, adapter, history, opts, requestId) {
  const endpoint = '/api/v1/intake'

  /**
   * ⛔ THIS TURN DID NOT COME FROM A ROUTE, SO IT IS NOT VERIFICATION.
   *
   * Four PASSes this month did not survive the Owner's machine, and one cause was that
   * 「verified on a live turn」 meant calling this function DIRECTLY with an options bag the
   * harness built itself — `{interactionMode:'chat'}` and nothing else. His turn arrives
   * through `POST /api/v1/demo/intake`, carrying `demo`, `contextCard`, `providerHint`,
   * `previousLane`, real history, and the route's own `readContextDeps` assembly. Same
   * function, different inputs, and the inputs are what steer routing.
   *
   * The routes now stamp `viaRoute`. A bag without it was hand-made.
   *
   * ⛔ IT WARNS AND DOES NOT REFUSE. Refusing would break every unit test that legitimately
   * calls this directly — and a guard whose failure mode is a broken suite gets deleted. The
   * point is only that the cheap path can no longer look like the real one in a transcript.
   *
   * ⛔ AND IT IS SILENT UNDER THE TEST RUNNER, measured rather than assumed:
   * `node --test` sets NODE_TEST_CONTEXT="child-v8". Unit tests are not pretending to verify.
   */
  if (!process.env.NODE_TEST_CONTEXT && !(opts && opts.viaRoute)) {
    console.warn('[AROMA-NOT-VERIFICATION] processIntake was called directly, not through a route. ' +
      'This turn exercises a hand-built options bag and is NOT evidence about 香香. ' +
      'Use: node --env-file=.env scripts/verify/liveTurn.js "<message>"')
  }
  // B2-2 Conversation Demo — additive, flag-gated. When `demo` is false (default,
  // i.e. no opts) every demo branch below is skipped and the pipeline is unchanged.
  const demo = opts && opts.demo === true                  // CONVERSATION_DEMO gate; default false
  const contextCard = (opts && opts.contextCard) || null   // per-turn, session-only; NEVER persisted

  // ── STEP 1: RED-LINE CHECK (must be first, before any external call) ──────
  const redLine = checkRedLine(message)

  if (redLine.blocked) {
    // Log locally — class name only, NOT the message content
    logRedLineBlock({ matchedClass: redLine.matchedClass, endpoint })

    // Record to hub (non-fatal if unavailable)
    await recordLLMUsage({
      model: 'none',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      latencyMs: 0,
      endpoint,
      requestId,
      blocked: true
    }).catch(() => {}) // swallow — hub may not be up yet

    return {
      blocked: true,
      blocked_reason: redLine.blocked_reason,
      reply: '這句話含敏感資訊(可能涉及銀行、報稅或密鑰)。依政策,我不會把它送給外部模型,只在本機記錄。',
      understanding: '含敏感資訊，只在本機記錄，未送外部模型。',
      summary: '',
      decision: null,
      tasks: [],
      risks: [],
      next_step: '',
      requestId
    }
  }


  // -- U1 DRAFT PROPOSAL SHADOW (flag-gated; after red-line, before STEP 2) --
  if (opts && opts.u1DraftShadow === true) {
    const src = (opts && opts.personaSource) || getPersonaSource()
    const runtimePersona = src.runtimePersona()
    return await runU1DraftShadow({ instruction: message, adapter, history, requestId, personaText: runtimePersona.personaText })
  }
  // ── THE TURN'S ROUTE, decided ONCE ────────────────────────────────────────
  // Computed here and reused by the utility answer, the read guard and the Answer Plan
  // gate. Routing the same message three times would be three chances to disagree.
  //
  // `routerMode` distinguishes the two live steps and gives two real rollback points:
  //   off    — the router does not act at all (pre-Step-2 behaviour)
  //   shadow — UTILITY answers; reads and the plan gate are UNCHANGED (Step 2)
  //   on     — routing GOVERNS reads and the Answer Plan gate (Step 3)
  const routerMode = resolveTurnRouter(process.env)
  const routeDecision = routerMode === 'off'
    ? null
    : routeTurn(message, { previousLane: (opts && opts.previousLane) || null })
  const routeGoverns = routerMode === 'on' && routeDecision !== null

  /**
   * ⛔ THE ROUTING DECISION IS A FIRST-CLASS ENTRY, NOT AN ABSENT ONE.
   *
   * > **Owner: 「A list missing its routing entry reads as 『we do not know』 rather than
   * > 『nothing was asked』 — and that is `|| ''` one layer up.」**
   *
   * A turn can involve more than one model. A single turn-level label describes none of them
   * (HR-62), so the turn reports a LIST — and the deterministic step has to appear in it, or a
   * reader counts the model calls and silently concludes the routing was one of them.
   *
   * `model: null` here means 「no model was asked」, which is a FACT. Elsewhere in this file
   * `model: null` means 「we could not find out」. They are told apart by `deterministic`, never
   * by the absence of a value — the distinction HR-68 was about.
   */
  // ⛔ `opts.telemetry`, NOT `tel`. The `tel` alias is declared ~600 lines below this point, so
  // reading it here is a temporal-dead-zone throw on EVERY turn — and one that only appears at
  // runtime, since requiring the module never executes the function body.
  const routeTel = (opts && opts.telemetry && typeof opts.telemetry === 'object') ? opts.telemetry : null
  if (routeDecision && routeTel) {
    routeTel.calls = (routeTel.calls || []).concat([{
      role: 'route',
      deterministic: true,
      model: null,
      route: routeDecision.route || null,
      confidence: routeDecision.confidence || null
    }])
  }

  // ── STEP 1b: THE UTILITY ROUTE — LIVE, and it answers before anything else ─
  //
  // Placed AFTER the red-line check (which must stay first — a message carrying a bank
  // number is refused whatever it is asking) and BEFORE the distillation, the recall
  // injection and every connector read. That ordering IS the fix: 「現在是幾點？」 read Drive,
  // Gmail, Calendar and the inventory because nothing had yet decided that a clock question
  // needs none of them.
  //
  // A UTILITY turn therefore performs NO connector read, builds NO EvidenceSet, requests NO
  // Answer Plan (there is no model call at all, so there is no responseFormat to request),
  // and costs nothing.
  //
  // IT DECLINES RATHER THAN GUESSING. `answerUtility` returns null when it cannot answer
  // deterministically — an expression it cannot parse, a unit it does not know, a timezone
  // it cannot resolve — and this falls through to the ordinary path. A worse answer, never a
  // wrong one, and never a sentence implying something was looked up.
  //
  // Every other route still only observes: the shadow log below is unchanged for them.
  if (routeDecision) {
    const decision = routeDecision
    if (decision.route === 'UTILITY') {
      const answered = answerUtility(decision.utility, message, {})
      if (answered) {
        try {
          logTurnRoute({
            decision, lane: (opts && opts.interactionMode === 'chat') ? 'chat' : 'other',
            sourcesRead: [], rowsRetrieved: 0, answerPlanForced: false, requestId
          })
        } catch (_) { /* telemetry is never load-bearing */ }
        // The SAME chat shape every other talking turn returns, so the conversation store,
        // the Lab archive hook and the envelope all treat it as the ordinary turn it is.
        return {
          blocked: false, mode: 'chat', intent: 'question', talkOnly: true, interactionMode: 'chat',
          reply: answered.text, replyForArchive: answered.text, readClaimCorrected: false,
          utility: answered.kind,
          decision: null, tasks: [], risks: [], next_step: '', requestId
        }
      }
      // Fell through: the utility could not answer. The ordinary path takes the turn, and
      // the shadow line for it is written after the model call as usual.
    }
  }

  // ── STEP 2: LLM DISTILLATION ──────────────────────────────────────────────
  // ⛔ A4-1 is CHAT-ONLY: the lane is passed explicitly so the proposal and email_draft
  // system strings can never pick up read guidance for a lane that cannot read.
  const { system, prompt } = buildDistillPrompt(message, history, { chatLane: (opts && opts.interactionMode === 'chat') === true })
  // DEMO (flag ON): trusted persona identity via `system`; untrusted project
  // context via a sanitized prompt data block. Both cross the SAME LLMAdapter
  // boundary as plain strings — no provider SDK here. Context Card sanitization
  // surfaces observable `warnings` (never a silent rewrite).
  const ctx = demo ? buildContextPreamble(contextCard) : { preamble: '', warnings: [] }
  // R2: the runtime persona slot is chosen by PERSONA_SOURCE (legacy default). In
  // legacy mode this is byte-identical to buildPersonaSystem(system) and reads no
  // Memory. In hybrid mode a fail-closed PersonaSourceUnavailableError propagates
  // BEFORE any adapter/model call. Only the persona slot varies; guard, separators
  // and the classifier are unchanged. Non-demo path is untouched.
  let effSystem
  if (demo) {
    const src = (opts && opts.personaSource) || getPersonaSource()
    const rp = src.runtimePersona() // hybrid: throws PersonaSourceUnavailableError before the model is called
    // Change C: inject the trusted ACTION_HONESTY_GUARD (demo-only) so the model's
    // conversational (speech/context) prose makes no false completion claims. The
    // action outcomes below are additionally grounded deterministically.
    // Conversation Experience Contract v1 (flag-gated, default OFF): an additional
    // TRUSTED frame appended to extraGuards — after persona + data-boundary guard,
    // before the classifier (which stays last). With the flag off the guard list is
    // exactly [ACTION_HONESTY_GUARD], so the system string is byte-identical to today.
    const guards = [ACTION_HONESTY_GUARD]
    if (resolveConversationContract(process.env) === 'on') guards.push(CONVERSATION_CONTRACT)
    // OWNER SETTINGS — the Owner's own style + preferences, written on his settings page.
    //
    // Placed LAST in the guard list, which puts it after ACTION_HONESTY_GUARD and the
    // Conversation Contract and still before the classifier. Position is not the defence
    // though: the block frames its own scope, the save path refuses boundary-removing text,
    // and the guards that actually matter (red-line, read-state, grounded action prose,
    // archive redaction) are CODE and never read this string.
    //
    // Absent or empty settings push nothing, so the system string stays byte-identical.
    try {
      const ownerBlock = buildSettingsBlock(loadOwnerSettings())
      if (ownerBlock) guards.push(ownerBlock)
    } catch (_) { /* settings must never be able to break a conversation */ }
    effSystem = buildPersonaSystemFromPersona(rp.personaText, system, { extraGuards: guards })
  } else {
    effSystem = system
  }
  /**
   * ⛔ ROUND B — THE SECTION ENVELOPE ENTERS HERE, AND ONLY HERE.
   *
   * `opts.sectionPreamble` is built by `home/sectionAttachment.js` from the SERVER's own store
   * — never from anything the browser sent — and it arrives already whitelisted, delimiter-
   * escaped and wrapped in a block that says, in words, that its contents are a record and not
   * a request.
   *
   * It sits BEFORE the context card and before the prompt for the same reason the context card
   * does: it is background the turn is read against, not the turn.
   */
  const sectionPre = (demo && typeof opts?.sectionPreamble === 'string') ? opts.sectionPreamble : ''
  const baseEffPrompt = demo ? (sectionPre + ctx.preamble + prompt) : prompt

  // ── CONTEXT SHARING (v1 — supersedes the v0 boundary) ──────────────────────
  // In v0 the GPT path was denied the Read Context and Decision Recall blocks by
  // construction. The Owner has since decided, knowingly, that his operational data may
  // go to a second vendor, so BOTH providers now receive the same context, assembled the
  // same way, with the same caps and the same untrusted-data framing.
  //
  // That decision stays reversible WITHOUT a code change: providerSharing.js gates each
  // source per provider from configuration, fail-closed toward withholding. Gmail — the
  // one most likely to be pulled back — can be withheld from GPT on its own with a
  // single line, and Claude is unaffected.
  //
  // The prompt is still built LAZILY and PER PROVIDER: nothing is fetched until we know
  // who is being asked, and a provider is never handed a block it is not permitted.
  const promptCache = new Map()   // provider -> assembled prompt
  const readBlockCache = new Map() // source-set key -> read-context block (one fetch per set)
  /**
   * ⛔ B RUNS AT MOST ONCE PER TURN, AND THE MEMO IS THE PRICE CONTROL.
   *
   * `buildPromptFor` is called per provider AND again on every reasoning-loop step. Calling the
   * decomposer from inside it without this cache would buy one paid call per provider per step
   * — the turn that costs 「four connectors and thirteen rows」 all over again, in tokens.
   *
   * Three states, deliberately: `undefined` not attempted, a promise in flight, and a resolved
   * value that may itself be `null` for 「B had no opinion」. A rejected promise is impossible —
   * `decomposeOnce` never throws, because B failing must not be able to fail the turn.
   */
  let goalPlanPromise // undefined = not attempted; Promise<plan|null> once started
  let recallBlockCache // undefined = not attempted yet; null = nothing to inject
  let convRecallBlockCache // same three-state contract, for Conversation Recall

  /**
   * THE TURN'S REAL READ OUTCOME, recorded AT the read.
   *
   * ⛔ KEYED AT THE GRAIN THE READ ACTUALLY HAPPENED — `readKey` below, NOT bare source.
   *
   * These were keyed by SOURCE, which was right while a turn could read a source at most
   * once. The model-directed loop broke that: `aroma_system.replenishment` and
   * `aroma_system.purchasing` are two reads of two different entities and BOTH carry
   * `source === 'aroma_system'`, so the second silently overwrote the first and the validator
   * was handed half of what had been read.
   *
   * Worse, the three maps disagreed about WHEN they overwrote — `turnItems` was replaced only
   * by a non-empty group while the other two were replaced unconditionally — so a live
   * zero-row second read left read A's ROWS paired with read B's EVIDENCE, a state describing
   * neither read. Latent until Truth Closure started handing these to the validator.
   *
   * The KEY changed; the VALUES did not. Each carries its own real `source`, so the evidence
   * ref contract downstream (`source#sourceId`, e.g. `aroma_system#7`) is byte-identical —
   * nothing outside this file learns that the key is finer than it was.
   */
  const turnPerSource = new Map()

  // THE ROWS THEMSELVES, for the Owner-facing view. Recorded at the same instant as
  // turnPerSource and for the same reason: the presentation is built from what this turn
  // really retrieved, never reconstructed from the reply afterwards.
  const turnItems = new Map() // readKey -> { source, items[] }
  const turnEvidence = new Map() // readKey -> what that read IS (kind, totals, meaning)
  let turnTruncated = false

  // WHICH PROVIDER ACTUALLY RECEIVED EXTERNAL READ CONTEXT, recorded AT the injection —
  // provider -> the source kinds that were really in the prompt sent to it.
  //
  // Recorded here, at the only line that prepends the block, rather than inferred later from
  // flags. "READ_ACCESS is on" is not the same claim as "this answer was built on somebody's
  // mailbox": the flag can be on while the fetch returns nothing, and the block is per-provider
  // (GPT is never given it), so a flags-based guess would be wrong in both directions. The Lab
  // archive uses this to decide whether an assistant turn may be stored, so a wrong value here
  // means either third-party data kept that should not be, or an answer discarded for nothing.
  const readContextUsedBy = new Map()

  // ── BLOCKER 1 + 3 (Owner review): ONE read-dependency resolution and ONE authorisation
  // calculation, resolved here and reused by BOTH the initial read and the reasoning loop.
  // They used to be resolved inside buildPromptFor(), where the reasoning loop could not see
  // them — so the loop referenced a  that was out of scope.
  const readDeps = (opts && opts.readContextDeps) || null
  /**
   * ⛔ THE AUTHORISATION BOUNDARY, AND THE ONLY ONE. A source may be read this turn when
   * READ_ACCESS is on AND it is enabled AND the ACTIVE provider is allowed to see it.
   * The ROUTE may narrow the automatic first read; it is NOT the boundary, so a reasoning
   * step may pick any source the Owner has already authorised — and nothing wider.
   */
  function authorisedSourcesFor (providerName) {
    if (resolveFlag(process.env, 'READ_ACCESS') !== 'on') return []
    const enabled = readDeps && Array.isArray(readDeps.sources) ? readDeps.sources : enabledSources(process.env)
    return sourcesForProvider(providerName, enabled, process.env)
  }
  /**
   * ⛔ THE CLOSED READ-OPERATION VOCABULARY FOR THIS PROVIDER, derived from — never wider
   * than — the sources authorisedSourcesFor() already granted. aroma_system expands to its six
   * concrete views; every other source is its own single operation and is unchanged.
   *
   * The expansion is the fix for the first-read defect: offering the bare source name made the
   * model's request under-specified, so the server fell back to re-deriving the view from the
   * Owner's message and vetoed the read when the message named no business entity.
   */
  function authorisedOperationsFor (providerName) {
    return operationsForSources(authorisedSourcesFor(providerName))
  }
  /**
   * ⛔ WHAT HAPPENED TO EACH OPERATION THIS TURN — THREE STATES, NOT TWO.
   *
   * operation → 'live' | 'unavailable'. An operation ABSENT from this map is OPEN: authorised
   * and not attempted.
   *
   * ⛔ ATTEMPTED IS NOT READ. This was a Set of 「已執行」 names, and both writers added to it
   * unconditionally — the reasoning path after buildReadContext returned, the automatic path
   * for any perSource row. But buildReadContext reports `trust:'unavailable'` for a real
   * connector failure, so a FAILED read was filed alongside a successful one, and the gloss
   * then told the model 「資料已經喺上面 …… 唔好講讀唔到」 about data that was never retrieved.
   * That is a false claim manufactured by the server, in the exact class the read-state guards
   * exist to prevent — and worse than the canary defect it was introduced to fix, because there
   * the data really was present.
   *
   * Both states are excluded from OPEN — a failed operation is not re-offered inside the same
   * bounded loop, so there is still no automatic retry. They are described completely
   * differently, which is the whole point.
   *
   * LIVE IS STICKY. A source read successfully and then re-requested and failing does not
   * un-retrieve the rows already in the prompt.
   */
  const turnOperations = new Map()
  const OP_LIVE = 'live'
  const OP_UNAVAILABLE = 'unavailable'
  /** trust in, state out. Anything that is not a live read is an attempt that did not land. */
  function recordOperation (operation, trust) {
    if (!operation) return
    if (turnOperations.get(operation) === OP_LIVE) return // live is sticky
    turnOperations.set(operation, trust === 'live' ? OP_LIVE : OP_UNAVAILABLE)
  }
  const operationsInState = (state) => Array.from(turnOperations.entries()).filter(([, v]) => v === state).map(([k]) => k)
  /**
   * ⛔ TRUTH CLOSURE — OPERATIONS THIS TURN OBTAINED BY THE MODEL'S OWN DECISION, AND LIVE.
   *
   * > **Production request dbda7d7f-0899-4f65-87ff-97e9914af640, gpt-5.6-terra.**
   * > Router said CONVERSATION/default and read NOTHING automatically. The model then chose
   * > `aroma_system.replenishment` (live), observed it, chose `aroma_system.purchasing` (live),
   * > observed that, and answered — genuine autonomous multi-step reasoning.
   * > `ANSWER_PLAN outcome=fallback reason=no_plan_returned`. No claim binding, no evidence
   * > validation. Real business prose about stockout risk and expired purchase orders reached
   * > the Owner having been proven against nothing.
   *
   * The gate below asked the ROUTER whether this turn was about business data. The router
   * answers a different question — 「what should be read automatically from the ORIGINAL
   * message」 — and it is right about that. It cannot answer 「did the model later obtain real
   * evidence」, because that had not happened yet when it ran.
   *
   * So provenance is RECORDED WHERE IT HAPPENS, at the reasoning loop's own executeRead, and
   * nowhere else. It is deliberately NOT derived from the route, from turnItems, from a source
   * name, from the presence of a read block, or from `turnOperations` — that last one carries
   * automatic reads too, so it would let the router's own read masquerade as the model's.
   *
   * MEMBERSHIP IS EARNED BY ONE THING: the loop asked for it AND the row came back
   * `trust:'live'`. A live zero-row read IS evidence — the table really is empty — and it
   * belongs here. An `unavailable` read is not evidence and must never appear.
   */
  const modelDirectedLiveOperations = new Set()
  // ── A3 REASONING LOOP: observations gathered mid-turn, in the order they arrived. ──
  // Each entry is a read-context block produced by the SAME buildReadContext the one-shot
  // path uses. Empty on an ordinary turn, so the prompt is byte-identical to before.
  const extraObservationBlocks = []
  // ⛔ ONE SAFE PUBLIC QUERY PLAN PER OWNER CONTEXT, FOR THIS TURN ONLY. Constructed here and
  // dropped with the turn, so no plan can outlive the request that authored it. The main model
  // may ask for PUBLIC more than once inside the bounded loop; the Owner's words do not change
  // between those asks, so the second one reuses the first plan rather than spending another
  // paid call — and rather than deriving a DIFFERENT safe string, which would slip past the
  // executor dedupe that keys on canonical args.
  const egressPlans = createTurnPlanCache()
  // ⛔ ONE INITIAL-FINAL VERDICT PER TURN. Turn-scoped and dropped with the request; a later
  // FINAL reuses the obligation rather than re-asking a question whose input has not changed.
  const finalObligations = createTurnFinalCache()
  // ⛔ ONE source-world authority per turn, resolved at most once per stable Owner context.
  const sourceIntents = createTurnIntentCache()

  /**
   * B, once. Returns the judged plan, or `null` for 「no opinion」.
   *
   * ⛔ IT NEVER THROWS AND IT NEVER REJECTS. The Owner's rule: 「B failing falls back to the
   * existing reasoning loop, never to no answer.」 Every failure — flag off, no adapter, a
   * provider error, an unparseable envelope, a plan the contract refuses — resolves to `null`,
   * and `sourcesForPlan(null, …)` then narrows nothing. The turn proceeds exactly as it did
   * before B existed.
   */
  function decomposeOnce () {
    if (goalPlanPromise !== undefined) return goalPlanPromise
    goalPlanPromise = (async () => {
      try {
        const out = await decomposeGoal({
          question: message,
          // Provider-neutral by construction: B is handed a closure and never learns what is
          // behind it — the same arrangement reasoningLoop uses.
          callModel: async ({ prompt, responseFormat }) => {
            const r = await adapter.complete(prompt, { system: effSystem, maxTokens, ...(responseFormat ? { responseFormat } : {}) })
            return { text: r && r.text, usage: r && r.usage }
          }
        })
        // ⛔ MEASURED AND LOGGED EVERY TIME, including the refusals. The per-query cost was to
        // be taken from real runs rather than estimated, and a refusal that costs a call is
        // still a cost.
        try {
          console.log('[AROMA-GOAL]', JSON.stringify({
            requestId,
            ok: !!(out && out.ok),
            reason: (out && out.reason) || null,
            facts: (out && out.ok && out.plan && Array.isArray(out.plan.facts)) ? out.plan.facts.length : null,
            unavailable: (out && out.ok && out.plan && Array.isArray(out.plan.facts))
              ? out.plan.facts.filter((f) => f && f.status === 'UNAVAILABLE').length : null,
            usage: (out && out.usage) || null
          }))
        } catch (_) { /* telemetry is never load-bearing */ }
        return (out && out.ok && out.plan) ? out.plan : null
      } catch (_) {
        return null
      }
    })()
    return goalPlanPromise
  }

  async function buildPromptFor (providerName) {
    // ⛔ THE CACHE KEY CARRIES THE OBSERVATION COUNT. Without it, step 2 would be handed
    // step 1's prompt and the loop would ask the same question forever — the read would
    // happen and the model would never see it.
    const cacheKey = providerName + ':' + extraObservationBlocks.length
    if (promptCache.has(cacheKey)) return promptCache.get(cacheKey)
    let effPrompt = baseEffPrompt
    const isChat = !!(opts && opts.interactionMode === 'chat')

    // DECISION RECALL v1 — chat-lane only, opt-in, FAIL-SOFT. Any read error or
    // NO_RECORDS injects nothing (chat proceeds exactly as today; never break/repair/write).
    // Withholdable from OpenAI on its own via CONTEXT_DECISIONS_OPENAI=off.
    if (isChat && resolveDecisionRecall() === 'on' && decisionRecallSharedWith(providerName, process.env)) {
      try {
        if (recallBlockCache === undefined) {
          const deps = (opts && opts.decisionRecallDeps) || { listDecisionsFn: listDecisions, listTasksFn: listTasks }
          const recall = buildDecisionRecallContext(deps)
          recallBlockCache = (recall && recall.block) ? recall.block : null
        }
        if (recallBlockCache) effPrompt = recallBlockCache + '\n\n' + baseEffPrompt
      } catch (err) {
        // Same rule as the read block below: fail soft, but never silently. A recall
        // failure used to be invisible, so 心燈 answering without past decisions looked
        // identical to there being none.
        recallBlockCache = null
        logReadSource({ source: 'decisions', trust: 'unavailable', count: 0, usedFallback: false, error: (err && err.message) || String(err), durationMs: null })
      }
    }

    // CONVERSATION RECALL v0.1 — chat-lane only, opt-in, FAIL-SOFT. The archive has been
    // written since 2026-08-01 and never read, so every conversation began from nothing.
    // This injects the most recent PREVIOUS conversations as memory.
    //
    // Injected AFTER Decision Recall so that, when both are on, decisions sit closer to the
    // system prompt than chat history does — a decision outranks a conversation, and the
    // order should say so.
    //
    // Turns whose assistant body was omitted under A′ are rendered as an explicit
    // "[reply not retained]" statement, never as a gap. See conversationRecall.js.
    if (isChat && resolveConversationRecall() === 'on') {
      try {
        if (convRecallBlockCache === undefined) {
          const deps = (opts && opts.conversationRecallDeps) || {}
          const cr = buildConversationRecall(Object.assign({ currentConversationId: opts && opts.conversationId }, deps))
          convRecallBlockCache = (cr && cr.block) ? cr.block : null
        }
        if (convRecallBlockCache) effPrompt = convRecallBlockCache + '\n\n' + effPrompt
      } catch (err) {
        // Fail soft, never silently — the same rule as the two blocks around it. Losing
        // memory must not look identical to having none.
        convRecallBlockCache = null
        logReadSource({ source: 'conversation-archive', trust: 'unavailable', count: 0, usedFallback: false, error: (err && err.message) || String(err), durationMs: null })
      }
    }

    // READ CONTEXT v1 — chat-lane only, flag-gated, FAIL-SOFT. Injected ONLY when
    // READ_ACCESS==='on' AND at least one per-source flag is 'on' AND the lane is chat.
    // With the flags off (the default) nothing is built and NO source is read.
    // The block is UNTRUSTED REFERENCE DATA (cited + dated); a per-source failure
    // becomes an UNAVAILABLE line and never blocks the reply. Nothing is persisted.
    if (isChat && resolveFlag(process.env, 'READ_ACCESS') === 'on') {
      try {
        const deps = readDeps // BLOCKER 1: the one shared resolution, not a second one
        const enabled = deps && Array.isArray(deps.sources) ? deps.sources : enabledSources(process.env)
        // ── STEP 3: THE ROUTE DECIDES WHAT IS READ ────────────────────────
        // Before this, the only conditions were "chat lane" and "READ_ACCESS on", so every
        // enabled source was read on every chat turn — 「你可以幫我做什麼？」 paid for four
        // connectors and thirteen rows, and those rows then forced an Answer Plan.
        //
        // CONVERSATION and UTILITY name no source, so they read nothing. BUSINESS_QUERY
        // names exactly one: the source that AUTHORITATIVELY holds that entity. A declared
        // source is a hint about where an answer might live, never an authorisation to read
        // — see the ruling above INTENTS in readContext.js.
        //
        // INTERSECTED with what is enabled, never unioned: the route can only ever narrow
        // what the Owner's own switches already allow.
        const forced = deps && deps.forceSources === true // tests only, to prove the plan gate
        let all = (routeGoverns && !forced)
          ? enabled.filter((s) => routeDecision.sources.includes(s))
          : enabled

        /**
         * ── ⛔ B DECIDES WHAT IS NEEDED, AND THE SERVER READS ONLY THAT ──────
         *
         * The route answers 「which source could hold this entity」 from keywords. B answers a
         * different question — 「what facts would ANSWER this」 — and it can return the one
         * thing a keyword table structurally cannot: **nothing here carries that.**
         *
         * 「給我 Aroma System 的 website」 is the case. The keyword route sees 「system」 and
         * names stock; B names the required fact as the system's own URL, finds no operation
         * that provides it, and `sourcesForPlan` therefore returns `[]`. The turn reaches the
         * model with zero rows and a stated gap instead of four stock counts and a shrug.
         *
         * ⛔ NARROW ONLY. Intersected inside `sourcesForPlan` against what is already enabled,
         * never unioned — a requirement is not an authorisation.
         *
         * ⛔ AND `null` IS NOT `[]`. A plan that could not be produced narrows NOTHING and the
         * turn is byte-for-byte what it was before B existed; only a real plan can say 「read
         * nothing」. That distinction is the whole of the fail-safe.
         */
        let goalBlock = null
        if (goalDecomposerEnabled(process.env) && !forced) {
          const plan = await decomposeOnce()
          const wanted = sourcesForPlan(plan, all)
          if (wanted !== null) all = wanted
          goalBlock = requirementBlock(plan)
        }
        // PER-SOURCE, PER-PROVIDER. Claude gets everything READ_ACCESS allows; OpenAI
        // gets that minus anything the Owner has withheld from it.
        //
        // ══════════════════════════════════════════════════════════════════════
        // ⛔ A4-1: THE KEYWORD ROUTE LOSES THE POWER TO INITIATE A READ.
        //
        // This is the whole architectural change, and it is deliberately ONE condition rather
        // than a rewrite. `routeTurn` still runs, still classifies BUSINESS_QUERY, still names
        // its source, and still logs all of it — the telemetry, the entity vocabulary and the
        // A4-off path are untouched. What it no longer owns is the decision to READ.
        //
        // WHY HERE AND NOT IN turnRouter. The router answers 「which source could hold this
        // entity」 and it is RIGHT about that; 「食材採購價平均增加 3%」 genuinely mentions
        // purchasing. What it cannot answer is 「does answering this question require our
        // records at all」, because that is a judgement about the QUESTION, not the words. A
        // negative regex for 採購 would be the same architecture with a longer list — which is
        // exactly what this slice was told not to build.
        //
        // With the read withheld, the turn reaches the model with zero rows, which is precisely
        // the A3 first-read-initiation path: the decision schema offers every authorised
        // operation and the model chooses READ / ASK / FINAL. No capability is added and no
        // authorisation moves — `authorisedOperationsFor` is still the only boundary.
        //
        // ⛔ 'shadow' DOES NOT REACH HERE. Only 'on'. Shadowing a semantic decision means
        // asking the model, i.e. a second paid call per turn; that is not free and has no
        // owner yet, so shadow changes nothing about routing.
        // ══════════════════════════════════════════════════════════════════════
        const a4Semantic = a4SemanticRoutingEnabled(process.env)
        const sources = a4Semantic ? [] : sourcesForProvider(providerName, all, process.env)
        if (sources.length > 0) {
          const key = sources.join(',')
          if (!readBlockCache.has(key)) {
            const connector = (deps && deps.connector) || createLiveReadConnector({ env: process.env }).connector
            const rc = await buildReadContext({ connector, message, sources, env: process.env })
            readBlockCache.set(key, (rc && rc.block) ? rc.block : null)
            for (const row of (rc && Array.isArray(rc.perSource)) ? rc.perSource : []) {
              if (row && row.source) turnPerSource.set(row.source, row)
              // WHICH OPERATION THE AUTOMATIC READ ACTUALLY WAS, AND HOW IT WENT. Recomputed
              // with the SAME deterministic function planFor used a moment ago — no new
              // plumbing, and no guess: for aroma_system the view came from the message, for
              // every other source the operation IS the source.
              //
              // ⛔ THE ROW'S OWN `trust` DECIDES THE STATE. `trust:'live'` is a successful read
              // INCLUDING a zero-row one — the table really is empty, which is a true answer.
              // `trust:'unavailable'` is a read that did not happen, and must never be filed as
              // one that did. A source nobody asked (`notAsked`) produces NO perSource row at
              // all, so it is never touched here and stays OPEN.
              if (row && row.source === 'aroma_system') {
                recordOperation(operationForAromaMethod(aromaMethodFor(message)), row.trust)
              } else if (row && row.source) {
                recordOperation(row.source, row.trust)
              }
            }
            for (const g of (rc && Array.isArray(rc.itemsBySource)) ? rc.itemsBySource : []) {
              // AUTOMATIC READ: one read per source, so the readKey IS the source — this grain
              // is unchanged and this path behaves exactly as it always has.
              if (g && g.source && Array.isArray(g.items) && g.items.length) turnItems.set(g.source, { source: g.source, readKey: g.readKey || g.source, items: g.items })
            }
            for (const e of (rc && Array.isArray(rc.evidenceSets)) ? rc.evidenceSets : []) {
              if (e && e.source) turnEvidence.set(e.source, e)
            }
            if (rc && rc.status === 'TRUNCATED') turnTruncated = true
          }
          const block = readBlockCache.get(key)
          if (block) {
            effPrompt = block + '\n\n' + effPrompt
            // The block is really in this provider's prompt. Source KINDS only — a closed
            // enum from ALL_SOURCES. No snippet, no subject, no name, no count.
            readContextUsedBy.set(providerName, sources.slice())
          }
        }

        /**
         * ⛔ INJECTED OUTSIDE THE `sources.length > 0` BRANCH, AND THAT IS THE ACCEPTANCE CASE.
         *
         * When B finds that nothing carries the required fact, there are ZERO sources — so a
         * requirement block placed inside the read branch would be built and then never
         * reach the prompt, on precisely the turn it exists for. The gap has to travel when
         * there is nothing to read, or it does not travel at all.
         */
        if (goalBlock) effPrompt = goalBlock + '\n\n' + effPrompt

        /**
         * ⛔ SELF-DESCRIPTION, AND IT IS NOT A READ.
         *
         * She asked the Owner what Aroma System is. Naming it internal stopped the question,
         * but she still answered 「目前沒有獨立的 website」 from memory — because the registry
         * that holds the base URL had ZERO CALL SITES. Built, tested, reachable by nothing.
         *
         * ⛔ INJECTED AS FACTS, NEVER AS PERMISSION. This is a deterministic sentence built
         * from frozen tables and runtime values (`describe()` — no model, no template a model
         * can extend). It says what she IS; it does not say any source is reachable, and it
         * grants no authorisation. `reachable` is null in the registry precisely so a flag can
         * never answer a capability question through this door.
         *
         * Only on turns that name her own system, so an ordinary business question does not
         * pay for prompt it will not use.
         */
        if (namesInternalSystem(message)) {
          effPrompt = '【關於你自己（呢啲係事實，唔係推測）】\n' + describeSelf() + '\n\n' + effPrompt
        }
      } catch (err) {
        // FAIL-SOFT, BUT NEVER SILENT. This used to be `catch (_) {}`. A whole-block
        // failure therefore produced a turn that looked normal, with no context and no
        // record that context had been attempted — which is how 「讀唔到」 became
        // undiagnosable. It still fails soft (the reply proceeds without context), but
        // the attempt is now on the record, scrubbed to the same allowlist as everything
        // else in that log.
        logReadSource({
          source: 'all',
          trust: 'unavailable',
          count: 0,
          usedFallback: false,
          error: (err && err.message) || String(err),
          durationMs: null
        })
      }
    }

    // Observations from earlier steps of THIS turn, newest last, above the base prompt and
    // below nothing — they are read context and are framed by the same safety header the
    // one-shot read block carries, because they were produced by the same builder.
    for (const obs of extraObservationBlocks) {
      if (obs) effPrompt = obs + '\n\n' + effPrompt
    }
    promptCache.set(cacheKey, effPrompt)
    return effPrompt
  }

  // Output limit, selected PER LANE. The chat lane answers in prose inside the JSON
  // `reply` string and can legitimately need more room (a truncated reply is cut
  // mid-JSON and fails the strict parser as fence_malformed). Every other lane —
  // proposal, legacy/unset interactionMode — keeps the historical 1024, and the
  // email_draft lane never reaches here (U1 early-return above). The adapter's own
  // default (ClaudeAdapter: 1024) is unchanged.
  const maxTokens = (opts && opts.interactionMode === 'chat') ? CHAT_MAX_TOKENS : DEFAULT_MAX_TOKENS

  // ── MULTI-AI ROUTER v0 — THE ORCHESTRATION BOUNDARY ─────────────────────────
  // This is the single place that owns BOTH adapter.complete() and the strict
  // envelope parse, which is why parse-failure fallback lives here and NOT in the
  // adapter or the router. The parser itself is untouched and never provider-aware.
  //
  // Attempt 1 (only when the router picks openai): GPT with a RESTRICTED prompt —
  // persona + trusted guards + Conversation Contract + classifier (system) and the
  // bounded history + current turn (user). The Read Context and Decision Recall
  // blocks and the Context Card are deliberately NOT sent to GPT in v0.
  // On provider failure OR parse failure: record GPT usage if any tokens were
  // produced (otherwise Louie pays with no accounting), log a CONTENT-FREE reason,
  // and fall back to Claude EXACTLY ONCE with the full, unchanged prompt. If Claude
  // also fails, the existing safe error propagates. Never loops.
  const primaryProvider = selectPrimaryProvider(process.env, opts)
  // ── THE ANSWER PLAN IS REQUESTED WHENEVER THIS TURN READ SOMETHING ──────────────
  // Enforced by the provider (json_schema, strict), not asked for in prose. The model was
  // told to emit two markdown headings and wrote neither, in three real turns; that is why
  // shape is bought at the API layer here and facts are checked afterwards.
  //
  // A FUNCTION, NOT A VALUE, AND THIS IS THE WHOLE POINT. It used to be computed here, at
  // the top — before buildPromptFor had ever run, and buildPromptFor is what performs the
  // read and fills turnItems. So the condition was evaluated against an empty map on every
  // single turn: responseFormat was never sent, no plan ever came back, and every live turn
  // silently used the old renderer while the tests passed. Evaluating it AT the call site,
  // after the prompt (and therefore the read) is built, is the fix.
  // THE ROW REFERENCES GO OUT WITH THE SCHEMA. A live turn cited "aroma_system" — the
  // source NAME — as the sourceId of both its items and lost them both; the field asked
  // for "a real id" and never said which token that was. Pinning the enum to exactly the
  // rows this turn retrieved makes the wrong answer unrepresentable rather than merely
  // detectable, which is the same reason the plan itself is bought at the API layer.
  const answerPlanFormat = () => {
    // ⛔ A4-0A. Off (the default, and production today) ⇒ withReadArgs returns the schema
    // OBJECT ITSELF, so an A4-off turn cannot differ from f836534 by even a key order.
    const a4On = a4ContractEnabled(process.env)
    // ⛔ A4-1C: the chat lane may not offer 'commit'. Gated on SEMANTIC routing (only 'on') AND
    // the chat lane, so shadow, A4-off and the proposal/email_draft lanes are all untouched.
    // This removes no capability: intakeService already intercepts a chat-lane commit and
    // creates nothing. It aligns the model's contract with the authority the server has always
    // had, which is what two rounds of prose calibration could not do.
    const a4ChatModes = a4SemanticRoutingEnabled(process.env) && !!(opts && opts.interactionMode === 'chat')
    // TWO INDEPENDENT CONDITIONS, and the Owner asked for exactly that. Rows can no longer
    // force a plan on a route that did not ask for data — and the gate does NOT lean on
    // reads being governed. With reads governed there should be no rows on a CONVERSATION
    // turn anyway; if a future change ever puts some there, the schema still must not
    // appear. Proven by a test that injects rows onto a conversational route.
    // ⛔ FIRST-READ INITIATION. These two conditions used to RETURN UNDEFINED, sending no
    // schema at all — so on a zero-read turn the model was never offered nextRead, and the
    // loop could EXTEND a read but never INITIATE one. 「你能看到 aroma system 嗎？」 came back
    // as 「我無法確認」 with the connector authorised and working.
    //
    // They still do their original job: no ANSWER PLAN before evidence exists. They no
    // longer stop the model ASKING for a read.
    //
    // ROUTER vs MODEL — the distinction is the whole fix. The router decides the AUTOMATIC
    // first read; nextRead is the model REQUESTING one. The router keeps its job and loses
    // only its power to silence the question.
    // ── THE AUTOMATIC RULE, UNCHANGED, BYTE FOR BYTE ──────────────────────────
    // The router still decides whether an AUTOMATIC read may demand an Answer Plan, and rows
    // still cannot force one onto a route that did not ask for data. Nothing below relaxes it.
    const automaticPlanApplies = !(routeGoverns && (!routeDecision || routeDecision.route !== 'BUSINESS_QUERY')) && turnItems.size > 0
    // ── TRUTH CLOSURE: EVIDENCE THE MODEL FETCHED ITSELF ALSO DEMANDS A PLAN ──
    //
    // ⛔ AND IT DELIBERATELY DOES NOT REQUIRE turnItems.size > 0. A live read that matched
    // ZERO rows is a true answer about an empty table, and it is exactly the answer most likely
    // to be embroidered — 「我睇過，冇嘢」 is cheap to say and expensive to be wrong about. It
    // gets grounded like any other read. No row refs exist, so withRowRefs leaves the schema
    // alone and the model declares citesEvidence:false with empty sections, which the existing
    // schema already supports. Nothing fabricates an id.
    //
    // An `unavailable` model-directed read is absent from this set, so a failed read still
    // cannot open the grounding path.
    const modelDirectedPlanApplies = modelDirectedLiveOperations.size > 0
    const planApplies = automaticPlanApplies || modelDirectedPlanApplies
    // ⛔ OPERATIONS, MINUS THE ONES ALREADY PERFORMED. Filtering by SOURCE used to hide all six
    // Aroma views the moment any one of them was read; an operation grain hides only what has
    // actually been answered.
    const openChoices = authorisedOperationsFor(activeProvider || primaryProvider).filter((op) => !turnOperations.has(op))
    // ⛔ ALL THREE STATES, NAMED SEPARATELY.
    //
    // OPEN, because an operation that merely disappears from the list reads as 「not available」
    // — the live canary watched exactly that turn into 「無法直接讀取庫存資料」 with the
    // inventory rows sitting in the same prompt.
    //
    // LIVE vs UNAVAILABLE, because collapsing them is the same error pointing the other way: it
    // would tell her the data is above when the connector never answered, which is a false claim
    // the server itself authored. Both are withheld from OPEN — no retry inside the bound — and
    // they are described as the different things they are.
    const choiceGloss = describeOperations(openChoices, operationsInState(OP_LIVE), operationsInState(OP_UNAVAILABLE))
    if (!planApplies) {
      // Nothing to plan over yet — offer the DECISION only, never a fabricated plan.
      // No reads left, or not the chat lane: behave exactly as before this change.
      if (openChoices.length === 0) return undefined
      if (!(opts && opts.interactionMode === 'chat')) return undefined
      return {
        type: 'json_schema',
        name: 'distill_with_read_decision',
        schema: withReadChoices(withReadArgs(withChatKnowledgeModes(DISTILL_WITH_READ_DECISION_SCHEMA, a4ChatModes), a4On), openChoices, choiceGloss)
      }
    }
    // ⛔ THE REF COMES FROM THE GROUP'S OWN SOURCE, NEVER FROM THE MAP KEY. The key is now the
    // read grain (an operation for a model-directed read) and the ref contract is the SOURCE —
    // building refs from the key would emit `aroma_system.purchasing#31` while evidenceIndex
    // builds `aroma_system#31` from the row itself, and every citation would drop.
    const refs = []
    for (const g of turnItems.values()) {
      for (const it of (g && Array.isArray(g.items) ? g.items : [])) {
        if (it && it.sourceId != null && it.sourceId !== '') refs.push(`${it.readKey || g.readKey || g.source}#${it.sourceId}`)
      }
    }
    // ⛔ THE MODEL IS SHOWN ITS ACTUAL CHOICES (live canary, blocker 2). Authorised for the
    // provider making THIS call, minus anything already read this turn. With nothing left,
    // withReadChoices() makes nextRead null-only rather than emitting an empty enum.
    // Reuses openChoices from above rather than recomputing, so the two schemas can never
    // disagree about what is still readable this turn.
    const shaped = withReadChoices(withReadArgs(withRowRefs(withChatKnowledgeModes(DISTILL_WITH_PLAN_SCHEMA, a4ChatModes), refs), a4On), openChoices, choiceGloss)
    return { type: 'json_schema', name: 'distill_with_answer_plan', schema: shaped }
  }
  let llmResult = null
  // ⛔ THE PROVIDER THAT PRODUCED THE ACCEPTED ENVELOPE. Set at the orchestration branch
  // that actually made the call — never inferred from the result, because the real
  // OpenAIAdapter returns {text, usage, model, latencyMs, stopReason} and carries NO
  // provider field at all. Reading llmResult.provider therefore silently identified every
  // real GPT turn as Claude, and the reasoning loop would have continued on the wrong
  // adapter with a prompt built for someone else. The path already knows who it called.
  let activeProvider = null
  let activeAdapter = null
  let distilled = null
  let routerFallbackReason = null

  // ACCOUNTING: every provider call that actually RETURNED is recorded exactly once,
  // BEFORE the envelope parse. A parse failure used to abort before the (post-parse)
  // recording, so a paid turn could go unaccounted (observed: 251 + 312 Claude output
  // tokens with zero rows). Idempotent by identity — the downstream outcome branches
  // still call this, and it is a no-op the second time, so success cannot double-record.
  // Shape unchanged; no content fields are added. Accounting never breaks a turn.
  // TELEMETRY SINK (observability v1): a caller-owned plain object that this pipeline
  // fills with NUMBERS and SHORT ENUMS only. It is never part of the HTTP response, so
  // the response contract is unchanged; the router reads it to emit one outcome line.
  const tel = (opts && opts.telemetry && typeof opts.telemetry === 'object') ? opts.telemetry : {}
  // Recorded once, at the single place the reason is decided, so a new clarification branch
  // cannot be added that returns a reason without recording it.
  const recordClarification = (t, reason) => { t.clarificationReason = reason; return reason }
  tel.interactionMode = (opts && typeof opts.interactionMode === 'string') ? opts.interactionMode : null
  function noteProvider (name, result) {
    tel.provider = name
    // MODEL PROVENANCE — the id the ADAPTER returned for the call that actually happened,
    // never a config default read back, never inferred from the provider name. Every adapter
    // returns it (ClaudeAdapter/OpenAIAdapter echo the API's own `data.model` and fall back to
    // the configured id; MockAdapter returns 'mock'), so an absent value here means the result
    // shape changed and is recorded as absent rather than filled in with a plausible guess.
    tel.model = (result && typeof result.model === 'string' && result.model) ? result.model : null

    /**
     * ⛔ ONE ENTRY PER CALL. `tel.provider`/`tel.model` describe the LAST provider that
     * returned, which was adequate while a turn used one model and describes nothing once it
     * uses two (HR-62). The list is what the Owner reads on the card.
     *
     * ⛔ AND ABSENT STAYS ABSENT: an entry whose model could not be read carries `null` with
     * `deterministic: false`, which says 「a model was asked and we do not know which」 — a
     * different fact from the routing entry's `null`, and the two must never collapse.
     */
    tel.calls = (tel.calls || []).concat([{
      role: 'answer',
      deterministic: false,
      provider: name || null,
      model: tel.model,
      ms: (result && Number.isFinite(result.latencyMs)) ? result.latencyMs : null
    }])
    // EXTERNAL READ CONTEXT, resolved for the provider that produced THIS answer. noteProvider
    // is called once per provider that returned, so the last call — the one whose reply is
    // used — is the one that lands here. A GPT answer is correctly false (GPT is never sent
    // the block); a Claude fallback after GPT is correctly true.
    const used = readContextUsedBy.get(name)
    tel.readContextUsed = Array.isArray(used) && used.length > 0
    tel.readContextSources = tel.readContextUsed ? used.slice() : []

    // DID THE REPLY ACTUALLY DRAW ON IT? (A′ narrowed, Owner decision 2026-08-02.)
    //
    // The decision is made HERE, where the block already exists, and only a BOOLEAN travels
    // onward. The block is third-party content; passing it to the archive hook so the hook
    // could decide would spread that content one layer further for no gain.
    //
    // Fail-safe in both directions: no block, no reply, or an error all yield `true`, so the
    // body is omitted. Only a confident "this reply cites nothing" keeps it.
    if (!tel.readContextUsed) {
      tel.replyCitesContext = false
    } else {
      // `result.text` is the model's RAW output — the whole envelope, not just the parsed
      // reply. That is deliberate: if a subject line was quoted anywhere in what the model
      // produced, it is caught, including in fields the parser would drop.
      // The cache is keyed by the joined source list, exactly as it was written.
      const blockForProvider = readBlockCache.get(used.join(','))
      tel.replyCitesContext = replyCitesContext(
        result && typeof result.text === 'string' ? result.text : null,
        blockForProvider || null)
    }
    if (result && result.usage) {
      tel.inputTokens = Number.isFinite(result.usage.inputTokens) ? result.usage.inputTokens : null
      tel.outputTokens = Number.isFinite(result.usage.outputTokens) ? result.usage.outputTokens : null
    }
    // FIX 3: stopReason is recorded on the SUCCESS path too, so a valid envelope that
    // nonetheless hit max_tokens is visible BEFORE it becomes a failure.
    tel.stopReason = (result && typeof result.stopReason === 'string' && result.stopReason) ? result.stopReason : null
  }

  const recordedResults = new Set()
  async function recordProviderUsage (result) {
    if (!result || !result.usage || recordedResults.has(result)) return
    recordedResults.add(result)
    try {
      logLLMCall({ model: result.model, latencyMs: result.latencyMs, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, totalTokens: result.usage.totalTokens, endpoint, blocked: false })
      await recordLLMUsage({ model: result.model, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, totalTokens: result.usage.totalTokens, latencyMs: result.latencyMs, endpoint, requestId, blocked: false })
    } catch (_) { /* accounting must never become a response failure */ }
  }

  if (primaryProvider === OPENAI) {
    const gpt = (opts && opts.openaiAdapter) || createOpenAIAdapterIfConfigured(process.env)
    if (!gpt) {
      routerFallbackReason = 'openai_unavailable' // not configured → no call attempted
    } else {
      let gptResult = null
      try {
        // The prompt is built first on purpose: building it performs the read, and the
        // read is what decides whether a plan is wanted.
        const gptPrompt = await buildPromptFor(OPENAI)
        const gptFormat = answerPlanFormat()
        gptResult = await gpt.complete(gptPrompt, { system: effSystem, maxTokens, temperature: 0.3, ...(gptFormat ? { responseFormat: gptFormat } : {}) })
      } catch (err) {
        // Content-free, but no longer blind: the adapter's allowlisted diagnostics
        // (HTTP status + provider error type/code/param) are appended so a failure is
        // explainable from the log. Never the body, prompt, output or any credential.
        const d = (err && err.providerDiagnostics) || {}
        const bits = [d.httpStatus != null ? `http=${d.httpStatus}` : null, d.errorType ? `type=${d.errorType}` : null, d.errorCode ? `code=${d.errorCode}` : null, d.errorParam ? `param=${d.errorParam}` : null].filter(Boolean)
        routerFallbackReason = `openai_provider_error${bits.length ? ` (${bits.join(' ')})` : ''}`
      }
      if (gptResult) {
        // Billable tokens exist the moment the provider returned — record BEFORE the
        // parse, so a fallback turn accounts for BOTH providers separately.
        noteProvider('openai', gptResult)
        await recordProviderUsage(gptResult)
        try {
          distilled = parseDistillResponse(gptResult.text, tel)
          llmResult = gptResult
          activeProvider = OPENAI // its envelope PARSED — this is the accepted provider
          activeAdapter = gpt
        } catch (err) {
          routerFallbackReason = `openai_parse_${(err && err.reason) || 'error'}`
        }
      }
    }
    if (routerFallbackReason) {
      console.warn(`[router] falling back to claude (reason: ${routerFallbackReason}) correlationId=${requestId}`)
    }
  }

  if (!distilled) {
    try {
      // Built HERE, on the Claude path only — whether this is the primary attempt or the
      // one-shot fallback after GPT. Either way Claude receives the full, unchanged
      // prompt, so the fallback answer is exactly as informed as it has always been.
      // The prompt is built FIRST and held in a variable on purpose: building it performs
      // the read, and the read is what decides whether an Answer Plan is wanted. Asking
      // that question before this line is what made the whole layer unreachable.
      const claudePrompt = await buildPromptFor(CLAUDE)
      const claudeFormat = answerPlanFormat()
      llmResult = await adapter.complete(claudePrompt, {
        system: effSystem,
        maxTokens,
        temperature: 0.3,
        ...(claudeFormat ? { responseFormat: claudeFormat } : {})
      })
    } catch (err) {
      // Upstream provider/adapter failure → typed, safe error. Provider message is
      // kept only on .cause (server-side classification), never surfaced to client.
      throw new IntakeUpstreamError({ correlationId: requestId, cause: err })
    }
    // Same rule for the Claude attempt: recorded before the parse can throw.
    noteProvider('claude', llmResult)
    // Claude produced the answer — either as primary, or as the fallback after GPT failed
    // or failed to parse. Either way it is now the active provider for the rest of the turn.
    activeProvider = CLAUDE
    activeAdapter = adapter
    tel.fallbackUsed = (primaryProvider === OPENAI)
    await recordProviderUsage(llmResult)
  }

  // ── TURN ROUTER — SHADOW ONLY (Step 1). It decides NOTHING. ────────────────
  // Computed here, AFTER the reads and the call, because the whole point is to record the
  // router's verdict beside what the pipeline actually did on the same turn — a list of
  // classifications would answer the wrong question. With TURN_ROUTER unset (the default)
  // this block does not run at all and the turn is byte-identical to before.
  //
  // Wrapped whole: a shadow observation may never be able to break a live turn.
  if (routeDecision) {
    try {
      let rows = 0
      for (const g of turnItems.values()) rows += (g && Array.isArray(g.items)) ? g.items.length : 0
      logTurnRoute({
        decision: routeDecision,
        // Read from `opts`, NOT from `isChat`/`interactionMode`: both of those live in the
        // per-provider closure above and are out of scope here. The first draft used them,
        // and because the block is wrapped in a catch it would have thrown silently every
        // turn and produced no shadow data at all — a telemetry feature that logs nothing
        // while appearing to work.
        lane: (opts && opts.interactionMode === 'proposal') ? 'proposal' : ((opts && opts.interactionMode === 'chat') ? 'chat' : 'other'),
        // De-duplicated: the key is now the read grain, so one source read through two
        // operations appears twice in the map and must not be double-listed here.
        sourcesRead: [...new Set(Array.from(turnPerSource.values()).filter((r) => r && r.trust === 'live').map((r) => r.source))],
        rowsRetrieved: rows,
        // THE EXACT CONDITION at intakeService.js:401 that makes the plan mandatory today.
        answerPlanForced: turnItems.size > 0,
        requestId
      })
    } catch (_) { /* shadow telemetry is never load-bearing */ }
  }

  /**
   * ⛔ AND IT HAPPENED AGAIN, TWENTY LINES FROM THIS WARNING. 2026-08-11.
   *
   * The comment above records a first draft that would have 「thrown silently every turn and
   * produced no shadow data at all — a telemetry feature that logs nothing while appearing to
   * work」. The no-evidence shadow was then wired beside `enforceNoReadClaim`, which is the
   * PROPOSAL-FALLBACK reply path, and emitted nothing on a real turn for exactly that reason.
   *
   * ⛔ IT WAS FOUND BY RUNNING ONE TURN, NOT BY READING THE CODE — and the warning it repeats
   * was already written, in this file, a screen away. Reading did not transfer it; running did.
   * Both reply paths now carry the shadow, each labelled with `path`, so a path that goes quiet
   * shows up as an absent label rather than as calm.
   *
   * The lesson is placed HERE rather than in the house rules on the Owner's instruction: a
   * warning about silent telemetry belongs where telemetry is written.
   */

  // Parse the structured JSON response. DistillParseError (Slice A) propagates
  // untouched — it owns .reason/.diagnostic; the outer wrapper tags correlationId.
  // On failure we attach NUMERIC/enum diagnostics only, so a truncation can be proven
  // instead of inferred: stopReason==='max_tokens' next to the configured limit and
  // the TRUE output size. The model output itself, the prompts and the user's message
  // are never attached — the existing rawSample (capped at 200) remains the only text.
  try {
    if (!distilled) distilled = parseDistillResponse(llmResult.text, tel)
    tel.parseResult = 'ok'
    // THE CLASSIFIER LOGS ITS OWN VERDICT. The router has logged its decision since Step 1;
    // this one decided whether a work-order card could exist and left no trace at all.
    tel.mode = distilled && typeof distilled.mode === 'string' ? distilled.mode : null
    // modeCoerced is written by parseDistillResponse through the diag channel above.
  } catch (err) {
    tel.parseResult = 'failed'
    tel.parseErrorReason = (err && typeof err.reason === 'string') ? err.reason : null
    if (err && err.name === 'DistillParseError') {
      const raw = typeof llmResult.text === 'string' ? llmResult.text : ''
      err.parseDiagnostics = {
        interactionMode: (opts && typeof opts.interactionMode === 'string') ? opts.interactionMode : null,
        configuredMaxTokens: maxTokens,
        outputTokens: (llmResult.usage && Number.isFinite(llmResult.usage.outputTokens)) ? llmResult.usage.outputTokens : null,
        rawTextChars: raw.length,
        rawTextBytes: Buffer.byteLength(raw, 'utf8'),
        stopReason: (typeof llmResult.stopReason === 'string' && llmResult.stopReason) ? llmResult.stopReason : null
      }
    }
    throw err
  }

  // ── B2 DETERMINISTIC INTERACTION-MODE GATE (opt-in). When opts.interactionMode is
  //    ABSENT this whole block is skipped ⇒ byte-identical to the prior behaviour.
  //    It sits AFTER parse (above) and BEFORE any persist/proposal/dispatch below.
  //    A real model call ran, so usage IS recorded first (same accounting contract as
  //    the talk / clarification paths) — but NO Decision/Task, NO Proposal, NO dispatch.
  const interactionMode = opts && opts.interactionMode
  // ══════════════════════════════════════════════════════════════════════════════
  // A3 — THE BOUNDED REASONING LOOP. Reason → Read → Observe → Reason → Final.
  //
  // > **Owner: 「Louie must NOT need to manually carry information between steps.」**
  //
  // The first model call has already happened above. If it asked for a read instead of
  // answering, this executes that read with the SAME buildReadContext the one-shot path
  // uses, feeds the observation back, and calls the model again — at most three decisions.
  //
  // ⛔ INERT ON AN ORDINARY TURN. A model that answers directly sets no `nextRead`, this
  // block does nothing, and the prompt, the reply and the accounting are byte-identical to
  // before. A direct question still costs exactly one model call.
  //
  // Provider neutrality: the loop module is handed a closure and never learns what is
  // behind it. All provider routing stays above, behind the adapter boundary.
  // ══════════════════════════════════════════════════════════════════════════
  // ⛔ A4-FINAL1 — THE INITIAL FINAL IS VALIDATED BEFORE IT IS BELIEVED.
  //
  // Three live turns failed the same way: asked for outside-world information, the main model
  // at LOW proposed NO read and answered that it could not obtain external data — while
  // `public_knowledge.search` sat in the authorised enum it had just been handed. Verified
  // directly: the capability WAS offered.
  //
  // Every guard built so far hangs off the model PROPOSING a read. A model that proposes
  // nothing sails past all of them — the worst case being 「兩邊都睇。」, where no read was
  // proposed and the whole MIX1 chain never engaged.
  //
  // So when the initial decision is FINAL, one narrow verifier decides whether the question is
  // answerable WITHOUT retrieval. ⛔ IT IS NOT A ROUTER: a turn that proposes a read never
  // reaches it, and it names a WORLD, never a capability. The model still chooses how to read.
  // ══════════════════════════════════════════════════════════════════════════
  let initialObligation = null
  // ⛔ AN ASK IS ALSO A WAY TO STOP — AND THAT WAS THE LAST ESCAPE HATCH.
  //
  // A4-FINAL1 excluded mode:'ask' because gating it withheld legitimate clarifications and
  // left the Owner with silence. Correct as far as it went, and it left one hole: asked
  // 「加拿大牛肉批發市場價點？」 — a question naming the country, the commodity and the market
  // — the model returned an ASK, reproducibly, and the gate never ran. The Owner got a
  // pointless clarification instead of an answer, and no read happened.
  //
  // An ASK and a FINAL both END the turn without reading. So both are validated, by the SAME
  // verifier, on the same Owner-only input. What differs is what a verdict may DO:
  //
  //   FINAL  · require_* → refuse and oblige   · allow_final → release   · unusable → withhold
  //   ASK    · require_* → SUPPRESS and oblige · allow_final → KEEP ASK  · unusable → KEEP ASK
  //
  // ⛔ ONLY A POSITIVE require_* MAY OVERRIDE AN ASK, and that asymmetry is the whole design.
  // `allow_final` on an ASK means 「no retrieval is needed」 — which does NOT mean the question
  // was pointless: the model may be asking which of two things the OWNER PREFERS, and this is
  // a KNOWLEDGE gate, not an Owner-intent gate. Forcing an answer there would be a new defect
  // wearing this one's clothes.
  //
  // ⛔ AND AN UNUSABLE VERDICT KEEPS THE ASK. The direction is opposite to FINAL's on purpose:
  // a FINAL asserts things, so an unverified one is withheld; an ASK asserts nothing and reads
  // nothing, so the safe failure is to let the Owner be asked. No obligation is invented and
  // no read is performed on a verdict that did not arrive.
  //
  // 'commit' belongs to the proposal path and never had a knowledge obligation.
  const initialTerminalMode = (distilled && typeof distilled.mode === 'string') ? distilled.mode : null
  const initialIsAsk = initialTerminalMode === 'ask'
  const initialFinalGate = interactionMode === 'chat' && distilled && !distilled.nextRead &&
    a4SemanticRoutingEnabled(process.env) && initialTerminalMode !== 'commit'
  if (initialFinalGate) {
    const allowedNow = (activeAdapter && activeProvider) ? authorisedOperationsFor(activeProvider) : []
    const w = availableWorlds(allowedNow)
    const startedAt = Date.now()
    const verdict = await finalObligations.get({
      verify: (readDeps && readDeps.finalVerifier) || null,
      message,
      history,
      availableWorlds: { internal: w.includes('internal'), public: w.includes('public') }
    })
    logFinalRequirement({ requestId, outcome: verdict.outcome, requiredWorlds: verdict.requiredWorlds, ownerMessageCount: ownerAuthoredContext(message, history).length, durationMs: Date.now() - startedAt })
    if (!verdict.ok) {
      // ⛔ FAIL CLOSED — IN THE DIRECTION THAT MATCHES WHAT WAS SAID.
      //
      // A FINAL asserts things, so an unverified one is withheld: no connector ran, no
      // EvidenceSet exists, nothing is fabricated, and the turn falls through to the same
      // deterministic rendering the step limit uses.
      //
      // An ASK asserts nothing and reads nothing. Withholding it would leave the Owner with
      // silence — the exact defect that made A4-FINAL1 exclude ASK in the first place. So the
      // question stands, no obligation is invented, and no read is performed on a verdict that
      // never arrived.
      if (!initialIsAsk) {
        distilled = Object.assign({}, distilled, { answerPlan: null, nextRead: null, reply: null })
      }
      try { console.log('[AROMA-REASONING]', JSON.stringify({ requestId, event: 'REASONING_STEP', reasoningStep: 1, decisionType: initialIsAsk ? 'ask' : 'final', stopReason: initialIsAsk ? 'ask_validation_unavailable' : 'final_validation_unavailable' })) } catch (_) {}
    } else if (verdict.decision === 'clarify') {
      // The ASK is legitimate — either the model already asked, or its FINAL was premature and
      // the meaning genuinely is open. Either way this is an ordinary conversation result, as
      // the ambiguity ASK is: no new response type, zero reads, no EvidenceSet, no trust state.
      // The verifier's own validated question is preferred over the model's wording, which the
      // verifier was never shown.
      distilled = Object.assign({}, distilled, { intent: 'unclear', mode: 'ask', reply: verdict.question, nextRead: null, answerPlan: null })
    } else if (verdict.decision === 'allow_final' && initialIsAsk) {
      // ⛔ THE ASK SURVIVES, UNTOUCHED. `allow_final` means no retrieval is needed — not that
      // the question was pointless. The model may be asking which of two things the OWNER
      // PREFERS, and this is a knowledge gate, not an Owner-intent gate. Turning every
      // no-retrieval ASK into a forced answer would be a new defect wearing this one's clothes.
    } else if (verdict.requiredWorlds) {
      // ══════════════════════════════════════════════════════════════════════
      // ⛔ FinalKnowledge DECIDES *WHETHER*; THE RESOLVER DECIDES *WHICH*.
      //
      // require_internal / require_public / require_mixed are kept for compatibility, but their
      // world suffix is NO LONGER authoritative — all three mean only 「more knowledge is
      // needed」. Which world that is comes from the Owner's resolved meaning, so there is one
      // authority instead of two enums that can disagree.
      //
      // If his meaning is genuinely open, the turn ASKS: no obligation, no read, no recovery
      // worker. That is the case A4 has failed on since the beginning.
      // ══════════════════════════════════════════════════════════════════════
      const startedAt2 = Date.now()
      const resolved = await sourceIntents.get({
        resolve: (readDeps && readDeps.sourceIntentResolver) || null,
        message,
        history
      })
      logOwnerSourceIntent({ requestId, outcome: resolved.outcome, ownerMessageCount: ownerAuthoredContext(message, history).length, durationMs: Date.now() - startedAt2 })
      // ⛔ SAME DECISION, SAME INPUTS, BOTH GATE SITES. Two places converting `ambiguous` into
      // a terminal ASK is how one of them drifts; the rule lives in one function.
      const worldAsk0 = decideWorldAsk({
        resolverIntent: resolved.intent,
        route: routeDecision ? routeDecision.route : null,
        routerSources: (routeDecision && routeDecision.sources) || [],
        authorisedSources: authorisedSourcesFor(activeProvider || primaryProvider)
      })
      logWorldAsk(requestId, resolved.intent, worldAsk0, worldAsk0.ask)
      if (worldAsk0.ask) {
        distilled = Object.assign({}, distilled, { intent: 'unclear', mode: 'ask', reply: resolved.question, nextRead: null, answerPlan: null })
      } else if (worldAsk0.requiredWorlds) {
        initialObligation = worldAsk0.requiredWorlds
      } else if (resolved.intent === 'ambiguous') {
        // Routed internal but unreachable: no obligation, no question, no read. The reply's
        // honesty about that is the read-state guards' job, not this gate's.
        initialObligation = null
      } else {
        // require_* on an ASK also SUPPRESSES it: the meaning is settled, it is answerable, and
        // the turn owes a read. The model's question is dropped here and never rendered — the
        // post-loop obligation check keeps it from returning through the fallback.
        initialObligation = resolved.requiredWorlds
      }
    }
  }

  if (interactionMode === 'chat' && distilled && (distilled.nextRead || initialObligation)) {
    const { runReasoningLoop, STOP } = require('./reasoningLoop')
    // ⛔ BLOCKER 2: THE PROVIDER THAT PRODUCED THE VALID FIRST ENVELOPE CONTINUES THE TURN.
    // Step 2 used to call the Claude adapter even when OpenAI produced step 1 — a silent
    // provider switch mid-turn, with step 2 reading a prompt built for someone else.
    // Both are tracked explicitly and neither is chosen inside reasoningLoop.js, which stays
    // provider-neutral: the loop is handed a closure and never learns what is behind it.
    // Set above, at the branch that produced the accepted envelope. Not re-derived here.
    // ⛔ BLOCKER 3: the SAME authorisation boundary as the first read, for the ACTIVE
    // provider. READ_ACCESS off yields [], so every reasoning read is refused.
    // The vocabulary generated from the SAME authorised sources, at the operation grain the
    // schema offered. Already-performed operations are NOT removed here: the schema narrows
    // what is offered, the allowlist decides what is permitted, and conflating the two would
    // make a repeat request look like a permission failure in the log.
    const allowed = (activeAdapter && activeProvider) ? authorisedOperationsFor(activeProvider) : []
    // ⛔ NULL ON AN INITIAL-FINAL TURN. The loop is entered with no read to replay, so step 1
    // is a real recovery call rather than a replay — see callModel.
    let pending = distilled.nextRead || null
    // ══════════════════════════════════════════════════════════════════════════
    // ⛔ A4-AMB1 — THE SOURCE-AMBIGUITY GATE, ONCE PER TURN, BEFORE ANY CONNECTOR.
    //
    // Four attempts to make the MAIN model ask on a genuinely ambiguous question have failed.
    // This asks a different model call ONE binary question with everything else removed, and
    // it runs at the only point where the answer still costs nothing: after the allowlist and
    // the write guard, before the reader.
    //
    // ⛔ ONLY WHEN THE QUESTION IS REAL. If just one knowledge world is reachable there is
    // nothing to be ambiguous BETWEEN, so the gate does not run and no call is spent. It is
    // also skipped once any read has already been allowed this turn — the meaning was settled
    // by the first decision, and re-litigating it would spend a call per step.
    const gateOn = a4SemanticRoutingEnabled(process.env) &&
      ambiguityGateEnabled(process.env) &&
      interactionMode === 'chat'
    const worlds = availableWorlds(allowed)
    let ambiguityUsed = false
    // ══════════════════════════════════════════════════════════════════════════
    // ⛔ A4-MIX1 — EXPLICIT MIXED IS NOT AMBIGUITY, AND IT IS NOT COMPLETE UNTIL BOTH.
    //
    // 「Aroma 實際牛肉成本升幅同市場相比合理嗎？」 failed live twice, in two places:
    //   · the ambiguity verifier answered `ask` — although its own frozen rules say
    //     「要兩邊 ≠ 含糊」. Asked whether his meaning was unclear, it read the two sides AS
    //     the ambiguity.
    //   · with that gate off, the model read internal evidence and went straight to FINAL,
    //     honestly reporting it had no market data rather than going to get some.
    //
    // Both are one missing concept. A turn could be 「clear」 or 「ambiguous」, and an explicit
    // request for two worlds is neither — it is the clearest kind of request there is, and it
    // needs two reads. `requiredWorlds` is that concept, and it is deliberately tiny: two
    // booleans, set once, for this turn only.
    // ══════════════════════════════════════════════════════════════════════════
    // ⛔ TURN-SCOPED, PER MISSING WORLD. `terminalRefusals` is what gives the main brain its
    // first attempt; `workerUsed` is what stops the fallback becoming a loop. Both are dropped
    // with the turn, and a mixed turn tracks its two worlds independently — public may need the
    // worker while internal does not.
    const terminalRefusals = { internal: 0, public: 0 }
    const workerUsed = { internal: false, public: false }
    // ⛔ SEEDED FROM THE INITIAL-FINAL VERDICT, when there was one. ONE obligation state, not
    // two: MIX1's completion guard reads this same variable, so an obligation discovered from
    // a refused FINAL and one discovered from a first READ are enforced by identical code.
    let requiredWorlds = initialObligation
    if (initialObligation) {
      // ⛔ AND THE MODEL MUST BE ABLE TO SEE IT. Refused observations reach the LOOP but never
      // reached the MODEL — only successful read blocks are added to the prompt. A guard the
      // model cannot see cannot be honoured, and calling that 「the model refuses to recover」
      // would have blamed it for something it was never shown.
      const first = missingWorld(initialObligation, {})
      const block = renderRequiredWorldObservation(first)
      if (block) extraObservationBlocks.push(block)
    }
    // ⛔ WHEN A WORLD OBLIGATION CAN EXIST AT ALL: A4 on, chat lane, and two worlds actually
    // reachable. With only one world there is nothing to choose between and nothing to owe.
    // Deliberately NOT gated on the ambiguity flag — that switch governs a guard that no longer
    // runs, and completion is a different guarantee from meaning.
    const mixedOn = a4SemanticRoutingEnabled(process.env) && interactionMode === 'chat' && worlds.length > 1
    const completedWorlds = { internal: false, public: false }

    // ══════════════════════════════════════════════════════════════════════════
    // ⛔ ONE SOURCE-WORLD AUTHORITY, AND THIS IS WHERE THE SECOND ONE WAS REMOVED.
    //
    // MIX1's mixed VERIFIER used to run here and could establish 「both worlds」 on its own,
    // before the resolver was ever consulted — so two components could classify the same
    // request. They never disagreed in testing, but 「two authorities that happen to agree」 is
    // a coincidence, not an architecture, and the next divergence would have been silent.
    //
    // The resolver now answers 「which world did he mean」 for EVERY read path, including the
    // explicit-mixed one. What survives of MIX1 is its COMPLETENESS GUARD — `missingWorld()`
    // against `completedWorlds`, plain code with no model call — which answers only 「given
    // that both worlds are required, are both actually read?」. That is a different question
    // and it is still asked, in beforeTerminal.
    //
    // ⛔ RESOLVED BEFORE THE LOOP, NOT INSIDE IT. The step budget depends on whether this turn
    // owes two worlds, and the budget is chosen when the loop is constructed. The turn-local
    // cache keys on the Owner context, so beforeRead's later lookup is the same answer at no
    // additional cost.
    // ══════════════════════════════════════════════════════════════════════════
    let sourceIntentLogged = false
    const resolveIntent = async () => {
      if (initialObligation) return { intent: null, requiredWorlds: initialObligation }
      /**
       * ⛔ SHE MUST NEVER HAVE TO ASK WHAT AROMA SYSTEM IS.
       *
       * Measured: five turns, five clarifying questions, zero reads — ending in 「你講嘅 Aroma
       * System 係我哋內部使用嘅系統，定係外部公司／服務嘅網站？」. She reads it every day.
       *
       * The cause is structural. `buildIntentPrompt` sends the resolver the Owner's own
       * messages AND NOTHING ELSE, so a proper noun that IS one of her six sources looks
       * exactly like an outside company. Unresolvable → `ambiguous` → and `ambiguous` returns
       * `{type:'final'}`, which ENDS THE TURN. Asking is not merely cheaper than reading: it
       * is the terminal branch AND the fail-closed default for every resolver error, so every
       * uncertainty and every failure leave by the same cheapest door.
       *
       * ⛔ AND THIS DOES NOT RELAX THE RESOLVER'S OWN RULE. Its header refuses
       * `availableWorlds` because 「what he means」 and 「what we can currently reach」 are
       * different questions and mixing them lets availability decide meaning. That stands.
       * This is not availability — it is IDENTITY. 「Aroma System」 denoting the Owner's own
       * system is a fact about language, not about the network, and a resolver that does not
       * know the name cannot tell an internal system from a supplier. Nothing here says a
       * source is reachable; the server still decides that afterwards, exactly as before.
       */
      const startedAt = Date.now()
      const r = await sourceIntents.get({
        resolve: (readDeps && readDeps.sourceIntentResolver) || null,
        message,
        history
      })
      if (!sourceIntentLogged) {
        sourceIntentLogged = true
        logOwnerSourceIntent({ requestId, outcome: r.outcome, ownerMessageCount: ownerAuthoredContext(message, history).length, durationMs: Date.now() - startedAt })
      }
      /**
       * ⛔ ONLY THE AMBIGUOUS CASE, AND ONLY BY NAME. The first version of this short-circuited
       * BEFORE the resolver and forced `internal` on any message naming her system — which
       * broke MIXED, where a question about her system genuinely needs the outside world too.
       * The tests caught it. The name is not a better resolver; it is a floor under the one
       * outcome that ends the turn.
       *
       * When the resolver CAN decide, its answer stands untouched. When it cannot, and the
       * message names one of her own six sources, 「internal」 is a better answer than asking
       * the Owner what his own system is.
       */
      if (r && r.intent === 'ambiguous' && namesInternalSystem(message)) {
        return { intent: 'internal', requiredWorlds: { internal: true, public: false }, outcome: 'internal_by_name' }
      }
      return r
    }
    // The turn's world obligation, settled once, from his meaning alone.
    if (!initialObligation && mixedOn) {
      const r = await resolveIntent()
      if (r.requiredWorlds) requiredWorlds = r.requiredWorlds
    }
    // ══════════════════════════════════════════════════════════════════════════
    // ⛔ THE PRE-READ GATE IS NOW ONE QUESTION: DID HE LEAVE THE WORLD OPEN?
    //
    // The obligation was already settled above, from his meaning alone. All that remains here
    // is the case where his meaning is genuinely open — then the turn asks and reads nothing.
    // Everything else is allowed through: a read in the wrong world is refused inside
    // performRead, which hands the model an ordinary refused observation and its normal
    // recovery opportunity, so the wrong world is never executed and nothing here has to end
    // the turn to prevent it.
    //
    // ⛔ AND A VALID FIRST HALF OF A MIXED TURN IS NOT A WRONG WORLD. With both worlds
    // required, either side may be read first; the completeness guard keeps the other side
    // outstanding until it is actually read.
    // ══════════════════════════════════════════════════════════════════════════
    const beforeRead = mixedOn
      ? async () => {
          // Once per turn, and only before the FIRST read actually happens.
          if (ambiguityUsed || turnOperations.size > 0) return { type: 'allow' }
          ambiguityUsed = true
          if (initialObligation) return { type: 'allow' }
          const resolved = await resolveIntent()
          /**
           * ⛔ AN 「I CANNOT TELL」 NO LONGER OUTRANKS A DETERMINISTIC CLASSIFICATION.
           *
           * Measured on the B canary (052761bc): route BUSINESS_QUERY / intent_inventory /
           * aroma_system, B facts:2 unavailable:0 — and this gate still returned `ambiguous`
           * and ended the turn `before_read`. The router and B had both already answered the
           * question this was about to ask him.
           */
          const worldAsk = decideWorldAsk({
            resolverIntent: resolved.intent,
            route: routeDecision ? routeDecision.route : null,
            routerSources: (routeDecision && routeDecision.sources) || [],
            authorisedSources: authorisedSourcesFor(activeProvider || primaryProvider)
          })
          if (worldAsk.ask) {
            // ⛔ ASK IS AN ORDINARY CONVERSATION RESULT, NOT A NEW RESPONSE TYPE. It reuses the
            // existing Distill envelope, so nothing downstream learns that a resolver exists.
            // No read happened, so there is no EvidenceSet, no perSource row and no trust
            // state — a question about meaning is not a read failure.
            logWorldAsk(requestId, resolved.intent, worldAsk, true)
            return { type: 'final', result: { intent: 'unclear', mode: 'ask', reply: resolved.question, nextRead: null, answerPlan: null } }
          }
          logWorldAsk(requestId, resolved.intent, worldAsk, false)
          if (worldAsk.requiredWorlds) initialObligation = worldAsk.requiredWorlds
          return { type: 'allow' }
        }
      : undefined

    // ══════════════════════════════════════════════════════════════════════════
    // ⛔ THE COMPLETION GUARD. A required world that was never read is not an answer.
    //
    // Measured: the model read internal evidence, found no market data, and wrote a careful
    // apology instead of requesting the second world. That is not dishonesty — it is a model
    // holding a requirement in prose across three calls. It must not be asked to.
    //
    // ⛔ IT NAMES A WORLD, NEVER A CAPABILITY. The server does not choose the tool: it says
    // which half of the question is still unanswered, and the model picks from the operations
    // it was already authorised for. The one established exception stays exactly as it was —
    // when public follows internal, the server owns the QUERY through the Owner-only planner.
    //
    // ⛔ AND A WORLD IS COMPLETED ONLY BY A LIVE READ. Refused, unavailable, duplicate-blocked
    // and failed reads do not count, which is the A3 three-state rule applied to a second
    // question: treating an attempt as completion is the exact defect 「attempted ≠ read」 was
    // raised to end.
    // ══════════════════════════════════════════════════════════════════════════
    // ⛔ ENABLED WHENEVER AN OBLIGATION COULD EXIST — including a SINGLE-world one, which the
    // `worlds.length > 1` test alone would have missed: `require_internal` on a turn that can
    // only reach internal is a real obligation, and gating completion on there being two
    // worlds would have silently released exactly those answers. It no-ops when nothing is
    // required, so the broader condition costs nothing.
    const beforeTerminal = (mixedOn || initialObligation)
      ? async () => {
          if (!requiredWorlds) return { type: 'allow' }
          const missing = missingWorld(requiredWorlds, completedWorlds)
          if (!missing) return { type: 'allow' }
          // ⛔ AND THE REFUSAL IS PUT WHERE THE MODEL CAN SEE IT. The loop observation alone was
          // invisible to her: the prompt is built from read-context blocks only. Named as a
          // WORLD, never a capability — she still chooses the operation.
          const block = renderRequiredWorldObservation(missing)
          if (block && !extraObservationBlocks.includes(block)) extraObservationBlocks.push(block)

          // ══════════════════════════════════════════════════════════════════
          // ⛔ A4-RR1 — THE BOUNDED RECOVERY WORKER, AND ONLY AFTER THE MAIN BRAIN HAS TRIED.
          //
          // Measured on one byte-identical recovery input: the main model chose the correct
          // read 3/7 at LOW and 2/7 at MEDIUM. Raising effort made it WORSE, so there was no
          // effort to buy and nothing left to tune. A separate narrow worker, asked only
          // 「which authorised operation satisfies the world we already know is missing」,
          // scored 40/40 on the same four classes.
          //
          // ⛔ THE MAIN BRAIN STILL GOES FIRST. `terminalRefusals` counts refusals for THIS
          // missing world: the first one is simply handed back, so a turn where the model
          // recovers on its own never spends a worker call and never leaves GPT. Only a SECOND
          // refusal for the same world — the model told what is missing and declining again —
          // invokes the worker, exactly once per obligation instance.
          //
          // ⛔ AND IT NEVER ANSWERS LOUIE. It returns one capability name; the read runs
          // through performRead, the same path with the same guards; the reply is still
          // composed by the main model afterwards, from the evidence the read produced.
          // ══════════════════════════════════════════════════════════════════
          terminalRefusals[missing] = (terminalRefusals[missing] || 0) + 1
          if (terminalRefusals[missing] >= 2 && !workerUsed[missing]) {
            workerUsed[missing] = true // once per missing-world obligation, never a loop
            const startedAt = Date.now()
            const decided = await runRecoveryWorker({
              // ⛔ HIS WORDS, THE MISSING WORLD, WHAT IS DONE, AND THE AUTHORISED LIST.
              // No evidence parameter exists to forget to strip.
              decide: (readDeps && readDeps.recoveryWorker) || defaultRecoveryWorker,
              message,
              history,
              requiredWorld: missing,
              completedWorlds,
              capabilities: allowed
            })
            logRecoveryWorker({ requestId, outcome: decided.outcome, requiredWorld: missing, capability: decided.capability, durationMs: Date.now() - startedAt })
            if (decided.ok) {
              // ⛔ ARGS ARE NOT THE WORKER'S. For a public read the Owner-only egress planner
              // constructs them inside performRead; for an internal one the operation IS the
              // query. Passing null is what keeps a second provider out of the egress path.
              try { await performRead({ capability: decided.capability, args: null }) } catch (_) {}
            }
          }
          // A structural observation, on the same terms as any refused read: an enum and a
          // world name. No business evidence, no prose, no reasoning.
          return { type: 'refuse', observation: { capability: null, ok: false, error: 'required_world_missing', requiredWorld: missing, summary: null } }
        }
      : undefined

    // ⛔ ONE READ IMPLEMENTATION, TWO CALLERS. Extracted verbatim so the recovery worker
    // executes reads through EXACTLY the path the model-directed loop uses — the same
    // allowlist, egress guard, dedupe, trust rule and world accounting. A second read path
    // would be a second place for those guarantees to drift.
    async function performRead ({ capability, args }) {
        // ⛔ A4-0A: ACCEPTED, RECORDED, AND DELIBERATELY NOT CONSUMED.
        //
        // This signature used to be `({ capability })`, so every argument the loop forwarded
        // was destructured into nothing. Accepting it here is the last link in the chain the
        // whole slice exists to prove.
        //
        // ⛔ IT IS NOT PASSED TO buildReadContext. Every current operation is INTERNAL, and an
        // internal operation IS its own query — the closed table already fixes its method and
        // params. Forwarding args now would change what today's adapters receive, which is
        // precisely what this slice promised not to do. The public plane (A4-2) is where a
        // capability first has anything to do with them, and it must not arrive by accident.
        //
        // The observer below is a TEST SEAM, on the same terms as readContextDeps.forceSources:
        // production passes nothing, so it is undefined and never called. It exists because
        // 「the argument reached the reader with exactly these values」 cannot be asserted from
        // outside the pipeline any other way, and structural telemetry must not carry values.
        // ⛔ ONE REPRESENTATION FOR 「no arguments」. reasoningLoop.js has always defaulted
        // `decision.args || {}`, so a null decision arrives here as an empty object — meaning a
        // turn that declared nothing and a turn that declared {} would be indistinguishable, and
        // A4-2 will branch on presence. Normalised here rather than by redesigning the loop,
        // which this slice has no reason to touch.
        const readArgs = (args && typeof args === 'object' && !Array.isArray(args) && Object.keys(args).length > 0) ? args : null
        if (readDeps && typeof readDeps.onModelDirectedRead === 'function') {
          try { readDeps.onModelDirectedRead({ capability, args: readArgs }) } catch (_) {}
        }
        // ⛔ RESOLVE BEFORE THE CONNECTOR, AND REFUSE WITHOUT TOUCHING IT.
        // Two independent checks, and the connector is reached only past both: the name must be
        // in the vocabulary this turn generated, and it must resolve in the frozen table. An
        // invented operation therefore costs zero reads — it is refused as an observation and
        // handed back to the model, exactly like any other refusal in the loop.
        const resolved = allowed.includes(capability) ? resolveReadOperation(capability) : null
        if (!resolved) return { capability, ok: false, error: 'unknown_read_operation', summary: null }

        // ⛔ A READ IN A WORLD HE DID NOT ASK FOR IS NOT EXECUTED.
        //
        // Once a world obligation exists — from his resolved meaning, or from the initial
        // terminal validator — a proposed read outside it is refused HERE, before the
        // connector. Refused as an ordinary observation rather than a thrown error, so the
        // model gets its normal recovery opportunity inside the same bound and the turn still
        // completes. The old gate could not do this at all: 「his meaning is clear」 returned
        // `allow` even when the clear meaning pointed at the other world.
        if (requiredWorlds && !readMatchesIntent(capability, requiredWorlds.internal && requiredWorlds.public ? 'mixed' : (requiredWorlds.public ? 'public' : 'internal'))) {
          const missing = missingWorld(requiredWorlds, completedWorlds)
          const block = missing ? renderRequiredWorldObservation(missing) : null
          if (block && !extraObservationBlocks.includes(block)) extraObservationBlocks.push(block)
          return { capability, ok: false, error: 'wrong_world_for_owner_intent', summary: null }
        }

        // ══════════════════════════════════════════════════════════════════════
        // ⛔ A4-2A — THE EGRESS GUARD. A4-EGRESS-1 stops being a note and starts refusing.
        //
        // An INTERNAL read has already put the restaurant's own data into this turn. A PUBLIC
        // read sends its query to a third party. Composing the two is the natural, helpful
        // thing a model does — and it is how a supplier name and a unit price leave the
        // building inside a search string. A prompt instruction cannot be the control here.
        //
        // It runs AFTER the model proposes the read and BEFORE the executor is reached, and it
        // FAILS CLOSED: nothing is called, no EvidenceSet exists, and the loop is handed an
        // ordinary refused observation — no new trust state, because no read happened.
        //
        // ⛔ THE OWNER'S OWN WORDS ARE NOT A LEAK. A value he typed himself is his to send;
        // blocking it because internal evidence happens to contain it too would refuse the very
        // question he asked. So the candidate set is internal values MINUS anything already in
        // his message.
        //
        // ⛔ NOTHING HERE IS LOGGED. Not the query, not the value, not the match. The
        // observation carries one enum.
        // ══════════════════════════════════════════════════════════════════════
        let outboundArgs = readArgs
        if (resolved.source === 'public_knowledge') {
          const internalValues = []
          for (const g of turnItems.values()) {
            if (!g || g.source === 'public_knowledge' || !Array.isArray(g.items)) continue
            for (const it of g.items) {
              for (const v of Object.values((it && it.fields) || {})) internalValues.push(v)
              if (it && it.title) internalValues.push(it.title)
            }
          }
          const ownerText = String(message == null ? '' : message).toLowerCase()
          const notFromOwner = internalValues.filter((v) => {
            const s = String(v == null ? '' : v).trim().toLowerCase()
            return s.length >= MIN_LEAKABLE_CHARS && !ownerText.includes(s)
          })

          // ══════════════════════════════════════════════════════════════════
          // ⛔ OWNER-ONLY PUBLIC QUERY PROVENANCE — the author is replaced, not audited.
          //
          // > **Owner: 「If PUBLIC is requested AFTER INTERNAL evidence has been read, the raw
          // > main-model public query is UNTRUSTED and MUST NOT leave the process.」**
          //
          // Blocking-on-inspection was correct and unwinnable: the MIXED question REQUIRES
          // reading internal evidence first, and a model that has just read 「Beef Brisket /
          // Gordon / 8.72」 composes a query containing them because that is the helpful thing
          // to do. Three phrasings measured, two blocked, each block right — and the Owner got
          // half an answer every time. A substring check also only ever catches the literal
          // value; it cannot catch a paraphrase, and a guard that is decorative on paraphrase
          // is not a guard.
          //
          // So `readArgs` is DISCARDED UNREAD and the query is re-authored from a context that
          // has never contained internal evidence (see publicQueryEgressPlanner.js).
          // Contamination becomes impossible rather than undetected.
          //
          // ⛔ FOR EVERY PUBLIC READ — NOT ONLY AFTER INTERNAL EVIDENCE EXISTS.
          //
          // This used to be `if (internalValues.length > 0)`, which made 「has the model already
          // seen something private?」 the trigger for owning the outbound words. The A4-3B
          // production canary showed why that is the wrong question. On a PURE PUBLIC turn
          // there is no internal evidence, so the planner never ran; the recovery worker then
          // routed a public read with `args: null` — it returns a CAPABILITY, never args — and
          // the provider received an empty query and answered MALFORMED without ever searching.
          //
          // The same gap admitted the main model's own raw string on any turn that happened to
          // have read nothing internal first. Both are the same defect: the authority over what
          // leaves the building was conditional on an unrelated fact.
          //
          // ⛔ THE LOOP DECIDES *WHETHER* THE OUTSIDE WORLD IS NEEDED. IT NEVER DECIDES *WHAT
          // WORDS GO*. Raw readArgs are untrusted input on this path, always — not merely when
          // they look dangerous, and not merely when something private has already been read.
          //
          // ⛔ AND IT FAILS CLOSED. No planner, a throw, a timeout, malformed output, an empty
          // query, no Owner text — every one means NO PUBLIC READ. It never reverts to the
          // main model's string, because that reversion IS the thing forbidden, and it would
          // be silent: the search would succeed and look entirely normal.
          //
          // Cost is unchanged: `createTurnPlanCache` keys on the Owner's own context, so a
          // second public attempt in the same turn reuses the one plan — and a refusal is
          // cached too, so a broken planner is asked once.
          // ══════════════════════════════════════════════════════════════════
          const startedAt = Date.now()
          const planned = await egressPlans.get({
            plan: (readDeps && readDeps.publicQueryPlanner) || null,
            message,
            history
          })
          logEgressPlan({
            requestId,
            outcome: planned.outcome,
            rawQueryDiscarded: true,
            ownerMessageCount: ownerAuthoredContext(message, history).length,
            durationMs: Date.now() - startedAt
          })
          if (!planned.ok) {
            // A safe unavailable observation. No EvidenceSet, no perSource row, no trust
            // state — nothing was read, so nothing is recorded as read.
            return { capability, ok: false, error: 'PUBLIC_QUERY_UNAVAILABLE', summary: null }
          }
          outboundArgs = planned.args

          // ⛔ THE SECOND FENCE, ON WHATEVER IS ACTUALLY ABOUT TO LEAVE.
          //
          // Kept deliberately after the re-author. The planner cannot have learned an internal
          // value — it was never shown one — so this should never fire, and a test asserts the
          // safe query survives it. It stays because it is the only check that reads the FINAL
          // string: if a future edit ever leaked evidence into the planner's context, this is
          // what turns that bug into a refusal instead of a send.
          if (wouldLeakInternalEvidence(outboundArgs, notFromOwner)) {
            return { capability, ok: false, error: 'PUBLIC_QUERY_EGRESS_BLOCKED', summary: null }
          }
        }

        // ⛔ THE READ GRAIN, COMPUTED BEFORE THE EXECUTOR. For a public search that is the
        // INSTANCE (operation + canonical args); for everything else it is the operation.
        // ⛔ KEYED ON WHAT ACTUALLY LEAVES, NOT ON WHAT WAS PROPOSED. After the re-author these
        // differ, and keying on the discarded string would make two identical safe searches
        // look like two different reads — the dedupe below would miss the repeat it exists for.
        const turnKey = resolved.source === 'public_knowledge' ? publicReadKey(capability, outboundArgs) : capability

        // ⛔ AND AN EXACT REPEAT IS NOT EXECUTED TWICE. `public_knowledge.search` stays
        // re-offerable — the schema hides INSTANCES, not the operation, so a second, different
        // search is allowed and that is the point. But the identical search inside one turn
        // would return the identical evidence at a second cost, and inside a bounded loop a
        // model that repeats itself must not be able to spend the bound on one question.
        // Refused deterministically, without touching the executor.
        if (turnOperations.has(turnKey)) {
          return { capability, ok: false, error: 'duplicate_read_this_turn', summary: null }
        }

        const connector = (readDeps && readDeps.connector) || createLiveReadConnector({ env: process.env }).connector
        // `operation` is what makes this a MODEL-DIRECTED read: for aroma_system it selects the
        // view the model already chose, instead of re-deriving one from the Owner's message —
        // the re-derivation that vetoed this very read as `notAsked`. For every other source it
        // changes nothing; their plans were never intent-derived.
        // ⛔ ARGS REACH THE PUBLIC EXECUTOR AND NOTHING ELSE. A4-0A proved the channel and
        // deliberately did not connect it; this is the one capability that has any business
        // with it. Internal adapters still receive byte-identical params (test E).
        const publicArgs = resolved.source === 'public_knowledge' ? outboundArgs : null
        const rc = await buildReadContext({ connector, message, sources: [resolved.source], operation: capability, args: publicArgs, env: process.env })
        if (rc && rc.block) extraObservationBlocks.push(rc.block)
        // ⛔ MODEL-DIRECTED READ: the readKey is the OPERATION, because that is the grain at
        // which the model actually read. Keying by source here is what let
        // aroma_system.purchasing erase aroma_system.replenishment. The values still carry
        // their own real `source`, so every ref downstream is unchanged.
        // ⛔ THE TURN KEY IS THE READ GRAIN. For a public search that is the INSTANCE, not the
        // operation — two searches in one turn are two reads, and keying by operation would let
        // the second erase the first exactly as purchasing once erased replenishment.

        for (const row of (rc && Array.isArray(rc.perSource)) ? rc.perSource : []) if (row && row.source) turnPerSource.set(turnKey, row)
        for (const g of (rc && Array.isArray(rc.itemsBySource)) ? rc.itemsBySource : []) if (g && g.source && Array.isArray(g.items) && g.items.length) turnItems.set(turnKey, { source: g.source, readKey: g.readKey || turnKey, items: g.items })
        for (const e of (rc && Array.isArray(rc.evidenceSets)) ? rc.evidenceSets : []) if (e && e.source) turnEvidence.set(turnKey, e)

        // ⛔ ATTEMPTED IS NOT READ. This used to be an unconditional `turnOperations.add()` and
        // an `ok` computed from `!!rc.block` — but a FAILED read still produces a block: it
        // carries the UNAVAILABLE line. So a connector failure was recorded as a success, told
        // to the model as 「資料已經喺上面」, and reported to the loop as ok:true.
        //
        // The row's own `trust` is the authority, exactly as on the automatic path. A read that
        // succeeded and returned nothing is 'live' and IS a real answer; a read that could not
        // be performed is 'unavailable'. Absent row ⇒ treated as an attempt that did not land,
        // which is the safe direction: it is never described as retrieved, and it is not retried.
        const row = (rc && Array.isArray(rc.perSource)) ? rc.perSource.find((r) => r && r.source === resolved.source) : null
        const trust = row ? row.trust : null
        recordOperation(turnKey, trust)
        // ⛔ TRUTH CLOSURE: PROVENANCE IS RECORDED AT THE ONLY PLACE THAT KNOWS IT.
        // This line is inside the loop's executeRead, so reaching it IS the proof the read was
        // model-directed; and `trust === 'live'` is the proof it produced evidence. An
        // `unavailable` read is excluded here, so a failed read can never open the grounding
        // path — the same three-state rule as recordOperation, applied to a second question.
        if (trust === 'live') modelDirectedLiveOperations.add(turnKey)
        // ⛔ A4-MIX1: A WORLD IS COMPLETED BY A LIVE READ AND BY NOTHING ELSE. Recorded on the
        // same `trust === 'live'` test the line above uses, so a refused, unavailable or
        // duplicate-blocked read can never mark a world done — every one of those returns
        // earlier and never reaches here.
        if (trust === 'live') {
          const w = worldForCapability(capability)
          if (w === 'public') completedWorlds.public = true
          else completedWorlds.internal = true
        }
        return { capability, ok: trust === 'live', summary: null }
    }

    const loop = await runReasoningLoop({
      capabilities: allowed,
      beforeRead,
      // ⛔ TERMINAL, NOT FINAL. An ASK reaches the loop as a terminal decision exactly like an
      // ANSWER does, so this one hook closes both exits: with an obligation outstanding the
      // model can neither answer nor ask its way out of the turn.
      beforeTerminal,
      // ⛔ ONE EXTRA DECISION, AND ONLY FOR A TURN THAT STRUCTURALLY NEEDS IT. The recovery
      // path is read → premature final (refused) → second read → final, which is four
      // decisions. Every other turn keeps the bound of three, and there is no env var: the
      // grant is computed here, from a requirement this turn actually established.
      //
      // `requiredWorlds` is set by beforeRead, which runs INSIDE the loop — so at this point
      // it is still null. The bound must therefore be decided from the same question, asked
      // before the loop starts; the cache makes that free, because beforeRead will reuse this
      // answer rather than spending a second call.
      // ⛔ THREE BUDGETS, EACH TIED TO A PATH THAT STRUCTURALLY NEEDS IT.
      //
      //   no obligation                     3  (unchanged default, every ordinary turn)
      //   single-world from initial FINAL   3  (final refused → read → final)
      //   mixed from a first READ           4  (read → premature final refused → read → final)
      //   mixed from an initial FINAL       5  (final refused → read A → final refused →
      //                                          read B → final)
      //
      // The 5 exists only because the initial FINAL consumes a decision before any read has
      // happened. No env var, no global change, and every other turn keeps 3.
      // ⛔ AND AN ESTABLISHED OBLIGATION DOES NOT RE-ASK. When the initial-FINAL verifier has
      // already settled what this turn owes, running the mixed verifier too would spend a
      // second paid call to answer a question that is closed — and could answer it
      // differently, giving one turn two obligation states.
      maxSteps: initialObligation
        ? ((initialObligation.internal === true && initialObligation.public === true) ? 5 : undefined)
        : ((mixedOn && (await resolveIntent()).intent === 'mixed') ? 4 : undefined),
      onEvent: (e) => { try { console.log('[AROMA-REASONING]', JSON.stringify(Object.assign({ requestId, provider: activeProvider }, e))) } catch (_) {} },
      executeRead: performRead,
      callModel: async ({ step }) => {
        // ⛔ A4-0A: THE ARGUMENTS TRAVEL WITH THE DECISION. reasoningLoop already forwarded
        // decision.args to executeRead — the seam existed and was closed at BOTH ends, so the
        // channel looked wired and carried nothing. With A4 off the parser never sets
        // pending.args, so this is null and the decision is identical to today's.
        // ⛔ ONLY WHEN THERE IS ONE TO REPLAY. On an initial-FINAL turn `pending` is null: the
        // model already spoke, its answer was withheld, and step 1 IS the recovery call.
        if (step === 1 && pending) return { type: 'read', capability: String(pending.capability || ''), args: pending.args || null }
        const prompt = await buildPromptFor(activeProvider)
        const fmt = answerPlanFormat()
        const next = await activeAdapter.complete(prompt, { system: effSystem, maxTokens, ...(fmt ? { responseFormat: fmt } : {}) })
        noteProvider(activeProvider === OPENAI ? 'openai' : 'claude', next) // provenance, per call
        await recordProviderUsage(next)                                     // ⛔ accounting, per call
        llmResult = next
        let parsed = null
        try {
          parsed = parseDistillResponse(next.text, tel)
        } catch (err) {
          /**
           * ⛔ AN UNREADABLE ENVELOPE IS NOT A COMPLETED ANSWER. IT USED TO LOOK LIKE ONE.
           *
           * This was `catch (_) { return { type: 'final', result: null } }`. The loop's one
           * signal for 「the model is done」 was therefore also emitted by the failure path, and
           * the loop logged `decisionType: 'final', stopReason: 'final'` — the SAME line it
           * logs for a genuine completion. The reason was discarded by the bare catch.
           *
           * A month of judgement rests on the difference. `opus-5` was read as 「less careful
           * than haiku」 because it produced 「fallback」 twice; what actually happened is that
           * one envelope did not parse and a catch renamed the failure a completion. The
           * renderer then recorded `no_plan_returned` — a message about the MODEL not returning
           * a plan, when the SERVER could not read one. Every layer downstream reasoned
           * correctly from a false premise. (HR-67.)
           *
           * ⛔ AND A FAILING STEP SHORTENED THE TURN. Returning 'final' ends the loop, so a
           * step that produced nothing consumed the budget AND cut the conversation short —
           * the opposite of what a failure should do.
           *
           * WHAT THIS CHANGE DOES AND DOES NOT DO. It makes the failure VISIBLE — in the log,
           * in telemetry, and on the decision object — and it changes the control flow not at
           * all. The turn still terminates exactly as it did. Whether an unreadable envelope
           * should instead be handed back as a refused observation is a real question with a
           * real risk attached, and it is NOT decided here.
           */
          const reason = (err && err.reason) ? String(err.reason) : ((err && err.message) ? String(err.message).slice(0, 120) : 'unknown')
          tel.envelopeUnreadable = true
          tel.envelopeUnreadableReason = reason
          // ⛔ ITS OWN EVENT NAME. A distinguishing field inside the existing line would have
          // been missed the same way the last one was; a reader greps for what went wrong.
          try {
            console.log('[AROMA-REASONING]', JSON.stringify({
              requestId, event: 'ENVELOPE_UNREADABLE', reasoningStep: step, reason,
              note: 'the turn ends here, and this is NOT a completed answer'
            }))
          } catch (_) {}
          return { type: 'final', result: null, unreadable: true }
        }
        pending = parsed && parsed.nextRead ? parsed.nextRead : null
        if (!pending) { distilled = parsed || distilled; return { type: 'final', result: parsed } }
        // ⛔ BLOCKER 4: a STILL-PENDING envelope is NOT adopted as the answer. If the loop
        // now hits the step limit, distilled still holds the last FINISHED envelope and the
        // prose that was mid-request never reaches the Owner as though it were complete.
        // Each step carries ITS OWN args, from the envelope that requested it — never step 1's.
        return { type: 'read', capability: String(pending.capability || ''), args: pending.args || null }
      }
    })
    // ⛔ BLOCKER 4: the result is USED, not voided. At the step limit there is no fourth
    // call and nothing is invented — the turn falls through to the EXISTING deterministic
    // rendering, which now runs over every observation gathered (they are already in
    // turnEvidence / turnItems / turnPerSource) rather than over a half-finished sentence.
    // ══════════════════════════════════════════════════════════════════════════
    // ⛔ A REFUSED ANSWER MUST NOT COME BACK THROUGH THE SIDE DOOR.
    //
    // `callModel` assigns `distilled = parsed` the moment an envelope carries no nextRead —
    // BEFORE beforeFinal has judged it. So a FINAL the completion guard refused was still
    // installed as the turn's envelope, and the deterministic fallback then rendered its
    // `reply`: the Owner received the half answer anyway, with the guard reporting a refusal.
    // Caught by the two tests that assert the withheld prose never reaches him.
    //
    // The obligation is re-checked here against what was actually read, not against what the
    // loop happened to return, so this holds however the loop ended.
    // ══════════════════════════════════════════════════════════════════════════
    if (requiredWorlds && missingWorld(requiredWorlds, completedWorlds)) {
      distilled = Object.assign({}, distilled, { answerPlan: null, nextRead: null, reply: null })
      try { console.log('[AROMA-REASONING]', JSON.stringify({ requestId, event: 'REASONING_STEP', reasoningStep: loop.steps, decisionType: 'final', stopReason: 'required_world_missing' })) } catch (_) {}
    }
    /**
     * ⛔ STEP_LIMIT_NO_COMPOSE IS A STEP LIMIT TOO — it is the budget running out WITH the
     * reserved compose call also failing to produce a plan. It must clear the envelope exactly
     * as STEP_LIMIT does. COMPOSED_AFTER_READS is deliberately NOT here: that is the reserved
     * call succeeding, and its plan is the entire point of the reserve.
     */
    if (loop.stopReason === STOP.STEP_LIMIT || loop.stopReason === STOP.STEP_LIMIT_NO_COMPOSE) {
      distilled = Object.assign({}, distilled, { answerPlan: null, nextRead: null })
      try { console.log('[AROMA-REASONING]', JSON.stringify({ requestId, event: 'REASONING_STEP', reasoningStep: loop.steps, decisionType: null, stopReason: loop.stopReason, observations: loop.observations.length })) } catch (_) {}
    }
    /**
     * ⛔ ONE COST LINE PER TURN, UNCONDITIONALLY.
     *
     * The bound moved from 3 model calls to 4 by Owner decision, so the cost of that decision
     * has to be observable in the ordinary logs rather than inferred. Counts and timings only —
     * no prompts, no message bodies, no source content (HR log-content fence).
     */
    try {
      console.log('[AROMA-REASONING]', JSON.stringify({
        requestId,
        event: 'TURN_COST',
        modelCallCount: typeof loop.modelCalls === 'number' ? loop.modelCalls : null,
        reads: loop.observations.length,
        steps: loop.steps,
        stopReason: loop.stopReason
      }))
    } catch (_) {}
    // ⛔ A PRE-READ STOP IS THE ANSWER, and it must REPLACE the envelope that asked to read.
    // `distilled` still holds the first envelope, whose nextRead is set and whose mode is not
    // 'ask' — shipping that would show the Owner 「等我睇睇」 for a turn that read nothing.
    // With no usable result the turn still must not read, so it falls back to the same safe
    // clarification the gate itself uses.
    if (loop.stopReason === STOP.BEFORE_READ) {
      const asked = loop.result && typeof loop.result.reply === 'string' && loop.result.reply.trim()
        ? loop.result
        : { intent: 'unclear', mode: 'ask', reply: AMBIGUITY_FALLBACK_QUESTION, nextRead: null, answerPlan: null }
      distilled = Object.assign({}, distilled, asked, { nextRead: null, answerPlan: null })
    }
  }
  if (interactionMode === 'chat' && distilled.mode === 'commit') {
    // chat mode never creates a proposal: intercept a commit → talk-only.
    await recordProviderUsage(llmResult) // idempotent: already recorded pre-parse

    // A SHORT CONFIRMATION CONTINUING A PREVIOUS TURN IS AN ANSWER, NOT AN INSTRUCTION.
    // 心燈 offered a numbered list, the Owner replied 「1」, and the classifier read that
    // as a commit. The interception then threw away the real 622-token answer she had
    // just written and replaced it with a canned notice about proposals — for a turn
    // where he had simply picked an option. Selecting from a list she offered is the most
    // ordinary thing in a conversation.
    //
    // THE SAFE DIRECTION IS UNCHANGED, because this branch is still the interception:
    // whichever reply is returned, NOTHING is created — no Decision, no Task, no
    // Proposal, no dispatch — and the proposal seam is not even present in chat opts. All
    // that changes is which words come back.
    const trimmed = String(message == null ? '' : message).trim()
    const shortContinuation = isShortReply(trimmed) && Array.isArray(history) && history.length > 0

    // A READ INSTRUCTION IS NOT AN EDIT INSTRUCTION. 「幫我睇 Calendar」 was answered with
    // 「我未有建立提案」 — the Owner asked to be shown something and was told about a
    // proposal he never requested. Short replies were already exempt; ordinary read
    // instructions were not. The interception still holds for anything carrying a change
    // verb, so the safe direction is untouched: this branch creates NOTHING either way.
    const readRequest = isReadRequest(trimmed)

    const reply = ((shortContinuation || readRequest) && typeof distilled.reply === 'string' && distilled.reply.trim())
      ? distilled.reply.trim()
      // Neither a continuation nor a lookup: the Owner asked for something actionable in a
      // lane that does not act, so say what is missing — a specific file and change —
      // rather than pointing at the mode button that no longer exists.
      : '我未有建立提案 —— 呢句我當咗係傾偈。想我出一張提案，直接講明改邊個檔案同改乜，例如「改 docs/canary/agent-canary.md 嗰行字」。'

    const guarded = enforceReadState(reply, Array.from(turnPerSource.values()), message)
    // ⛔ THE OTHER HALF OF THE SAME RULE. `enforceReadState` catches 「she denied a read that
    // HAPPENED」. This catches 「she made a claim about reading when NOTHING was read」 — the
    // 2026-08-08 aroma_system turn, which routed CONVERSATION with sourcesRead:[] and was
    // answered with 「我目前沒有直接連接到 Aroma System 的讀取權限」. Nothing existed to
    // contradict her, so nothing did.
    //
    // Appending to `guarded.reply` is safe HERE specifically: this fires only when the turn
    // read nothing, and `buildReadResultReply` is a no-op with nothing retrieved, so the note
    // cannot be discarded the way a correction on a rebuilt read-reply would be.
    const unread = enforceNoReadClaim(guarded.reply, Array.from(turnPerSource.values()), message, routeDecision)
    guarded.reply = unread.reply
    if (unread.flagged) logNoReadClaim(routeDecision, requestId)
    /**
     * ⛔ SHADOW ONLY (HR-74). Placed HERE, beside `enforceNoReadClaim`, because they are the two
     * halves of one question and only one of them is currently asked.
     *
     * `enforceNoReadClaim` catches 「she CLAIMED a read that never happened」. It has nothing to
     * say about 「she stated a specific fact about the business with no read behind it」 —
     * 「現在我們有三間門市」 claims no read, so that guard correctly passes it.
     *
     * This measures the second half and DECIDES NOTHING. Zero model calls, so unlike B the
     * shadow is free; the Owner's real traffic produces the false-positive rate, and only then
     * is there anything to decide. It must never grow a refusal: an empty reply is worse than
     * a wrong one, and a gate whose failure mode is silence recreates the defect it was built
     * against.
     */
    try {
      let shadowRows = 0
      for (const g of turnItems.values()) shadowRows += (g && Array.isArray(g.items)) ? g.items.length : 0
      logNoEvidenceShadow({
        reply: guarded.reply,
        question: message,
        rowsRead: shadowRows,
        rowsText: shadowRows > 0 ? JSON.stringify(Array.from(turnItems.values())) : ''
      }, requestId)
    } catch (_) { /* a measurement may never break a turn */ }
    // ⛔ SECOND OUTPUT GUARD. Detect + record + flag; never rewrite — 簡轉繁 is not one-to-one.
    const lang = enforceTraditional(guarded.reply)
    logTraditionalFlag(lang, requestId)
    guarded.reply = lang.reply
    if (guarded.corrected) logReadClaimCorrection(guarded, requestId)
    // THE OWNER-FACING SHAPE, applied last so it wraps the reply the guard approved.
    // With nothing retrieved it is a no-op and the reply passes through untouched.
    const view = buildReadResultReply({
      reply: guarded.reply,
      correction: guarded.correction || null,
      message,
      // The model's own plan, when it sent one. answerPlan.js validates it against the
      // evidence; nothing here trusts it, and every fall-through is logged.
      answerPlan: distilled.answerPlan || null,
      evidenceSets: Array.from(turnEvidence.values()),
      provider: (llmResult && llmResult.provider) || null,
      requestId,
      itemsBySource: Array.from(turnItems.values()),
      perSource: Array.from(turnPerSource.values()),
      truncated: turnTruncated,
      // THIS CONVERSATION SO FAR — read for exactly one purpose: so a source's FIXED scope
      // properties are stated once rather than every turn (scopeNotes.js). It is never a
      // source of business facts, and recall-is-not-evidence is unchanged by it.
      history
    })
    return {
      blocked: false, mode: 'chat', talkOnly: true, interactionMode: 'chat',
      reply: view.reply, replyForArchive: guarded.reply, readClaimCorrected: guarded.corrected,
      decision: null, tasks: [], risks: [], next_step: '', requestId
    }
  }
  if (interactionMode === 'proposal' && distilled.mode !== 'commit') {
    // proposal mode + a non-executable intent: deterministic clarification.
    // Do NOT fabricate a Task or Proposal; do NOT persist or promote.
    await recordProviderUsage(llmResult) // idempotent: already recorded pre-parse
    return {
      blocked: false, mode: distilled.mode, interactionMode: 'proposal',
      demoOutcome: 'clarification', clarificationReason: recordClarification(tel, 'not_a_commit_intent'),
      reply: '這看起來不是一個可執行的任務，尚未建立任何提案。請描述你想執行的具體任務。',
      decision: null, tasks: [], proposals: [], requestId
    }
  }

  // ── DEMO — Plan A: an execution intent must resolve to EXACTLY ONE task (this
  //    is the first official-Proposal demo, not a batch system). 0 or >1 tasks →
  //    clarification; do NOT persist and do NOT promote. ──────────────────────
  if (demo && distilled.mode === 'commit' && (!Array.isArray(distilled.tasks) || distilled.tasks.length !== 1)) {
    await recordProviderUsage(llmResult) // idempotent: already recorded pre-parse
    const clarificationReason = recordClarification(tel, (Array.isArray(distilled.tasks) && distilled.tasks.length > 1) ? 'multiple_tasks_narrow_to_one' : 'no_actionable_task')
    return {
      blocked: false, mode: 'commit', intent: distilled.intent, demoOutcome: 'clarification',
      // Change B: ground the reply — narrowing created NO proposal; never echo the
      // model's speculative "整理出一項提案" prose here.
      reply: buildGroundedReply({ type: 'clarification', clarificationReason }),
      clarificationReason,
      contextCardWarnings: ctx.warnings, requestId
    }
  }

  // ── CHAT or ASK: talk only — do NOT persist any Decision/Task ─────────────
  if (distilled.mode !== 'commit') {
    await recordProviderUsage(llmResult) // idempotent: already recorded pre-parse
    // The ordinary chat path — this is the one the 「我目前讀唔到你的日程」 turn came down
    // while the calendar telemetry said trust:'live'.
    const guarded = enforceReadState(distilled.reply, Array.from(turnPerSource.values()), message)
    /**
     * ⛔ SHE MAY NOT ASK THE OWNER WHAT HIS OWN SYSTEM IS. Observed twice on 02e430e through
     * the real UI, in one session, in two different model-authored phrasings — while the same
     * session's earlier turn used the registry correctly. The fact reaches the prompt on every
     * one of those turns by the same code path; the model used it once and ignored it twice.
     *
     * ⛔ SO THIS IS A POST-GENERATION CHECK, NOT A STRONGER INSTRUCTION. Owner's ruling and the
     * standing CONTRACT_RELIABILITY finding: a fact supplied by prompt is followed
     * inconsistently, and reinforcing the sentence changes the odds rather than the guarantee.
     *
     * It fires only when the OWNER's own message names her system, removes only the offending
     * sentence, and leaves every other clarification alone — which endpoint, which range,
     * which location are all questions she is still entitled to ask.
     */
    const selfDesc = enforceInternalSystemAnswer({ reply: guarded.reply, message })
    if (selfDesc.composed || selfDesc.corrected) {
      guarded.reply = selfDesc.reply
      try {
        console.log('[AROMA-SELFDESC-CORRECTED]', JSON.stringify({
          requestId, composed: selfDesc.composed, supplied: selfDesc.supplied, removedSentences: selfDesc.removed.length
        }))
      } catch (_) { /* telemetry is never load-bearing */ }
    }
    const lang = enforceTraditional(guarded.reply)
    logTraditionalFlag(lang, requestId)
    guarded.reply = lang.reply
    /**
     * ⛔ THE FLOOR: NO PATH SHIPS SILENCE. Measured 17:18 — a completed call (`servedBy`
     * populated) stored `content: ""`, and the UI rendered its meta label and nothing else.
     * An empty reply is worse than a wrong one: a wrong answer says something is broken,
     * silence is indistinguishable from a dropped message or a closed tab.
     *
     * ⛔ THIS IS A FLOOR, NOT A FIX. It does not know what emptied the text and must never be
     * read as having repaired it. Placed LAST, after every guard that can rewrite, because a
     * floor upstream of a remover guarantees nothing.
     */
    const floored = ensureNonEmptyReply(guarded.reply)
    if (floored.wasEmpty) {
      guarded.reply = floored.reply
      try {
        console.log('[AROMA-EMPTY-REPLY]', JSON.stringify({
          requestId, note: 'a completed turn produced no text; shipped the defect sentence'
        }))
      } catch (_) { /* telemetry is never load-bearing */ }
    }
    if (guarded.corrected) logReadClaimCorrection(guarded, requestId)
    /**
     * ⛔ THE MAIN CHAT PATH. The first placement of this sat beside `enforceNoReadClaim` on the
     * proposal-fallback path and emitted NOTHING on a real turn — found by running one, not by
     * reading it. That is exactly the hazard `logTurnRoute` warns about above: a telemetry
     * feature that logs nothing while appearing to work. Both reply paths carry it now, each
     * labelled, so a path that goes quiet is visible rather than assumed.
     */
    try {
      let shadowRows = 0
      for (const g of turnItems.values()) shadowRows += (g && Array.isArray(g.items)) ? g.items.length : 0
      logNoEvidenceShadow({
        reply: guarded.reply,
        question: message,
        rowsRead: shadowRows,
        rowsText: shadowRows > 0 ? JSON.stringify(Array.from(turnItems.values())) : '',
        path: 'chat'
      }, requestId)
    } catch (_) { /* a measurement may never break a turn */ }
    const view = buildReadResultReply({
      reply: guarded.reply,
      correction: guarded.correction || null,
      message,
      // The model's own plan, when it sent one. answerPlan.js validates it against the
      // evidence; nothing here trusts it, and every fall-through is logged.
      answerPlan: distilled.answerPlan || null,
      evidenceSets: Array.from(turnEvidence.values()),
      provider: (llmResult && llmResult.provider) || null,
      requestId,
      itemsBySource: Array.from(turnItems.values()),
      perSource: Array.from(turnPerSource.values()),
      truncated: turnTruncated,
      // THIS CONVERSATION SO FAR — read for exactly one purpose: so a source's FIXED scope
      // properties are stated once rather than every turn (scopeNotes.js). It is never a
      // source of business facts, and recall-is-not-evidence is unchanged by it.
      history
    })
    return { blocked: false, mode: distilled.mode, intent: distilled.intent,
      ...(demo && { demoOutcome: classifyDemoOutcome({ mode: distilled.mode, intent: distilled.intent }).outcome, contextCardWarnings: ctx.warnings }),
      reply: view.reply, replyForArchive: guarded.reply, readClaimCorrected: guarded.corrected,
      judgment: '', reasons: distilled.reasons || [], offer: distilled.offer || '', decision: null, tasks: [], risks: [], next_step: '', requestId }
  }

  // ── STEP 3: LOG METRICS (local — condition 6) ─────────────────────────────
  // Idempotent: this turn's provider result was already recorded pre-parse.
  await recordProviderUsage(llmResult)

  // ── STEP 4: PERSIST via Wall-E's hub endpoint ─────────────────────────────
  const persistPayload = {
    understanding: distilled.understanding,
    decision: distilled.decision,
    tasks: distilled.tasks,
    provenance: {
      proposed_by: 'louie',
      source: 'homepage-intake'
    },
    requestId
  }
  // Persist locally (in-process store); capture ids to return to the UI
  const persisted = await persistIntake(persistPayload)

  // ── STEP 5: WRITE LLM USAGE via Wall-E's hub endpoint ────────────────────
  // Idempotent: recorded pre-parse; kept here so the ordering contract is explicit.
  await recordProviderUsage(llmResult)

  // ── STEP 6: DISPATCH (real Worker Dispatcher) ─────────────────────────────
  const stored = persisted && persisted.ok ? persisted.data : null

  // ── DEMO — EXECUTION via the OFFICIAL governance seam (single task, enforced
  //    above). Promote the persisted Task through the injected DOMAIN seam
  //    (opts.promoteToProposal → { ok, proposal } | { ok:false, error }): a real,
  //    persisted, pending Proposal that is confirmable later, but NO Run, NO
  //    worker, no dispatch, and it never touches the Timeline. Confirm remains the
  //    sole execution gate. Proposal state comes ONLY from the official record in
  //    `proposals[]` — nothing (status/linkState/dispatch authority) is invented.
  if (demo) {
    const taskId = stored && Array.isArray(stored.tasks) && stored.tasks[0] ? stored.tasks[0].id : null
    const proposals = []
    const promoteErrors = []
    if (!taskId) {
      promoteErrors.push({ code: 'persist_failed', message: 'intake task not persisted; no Proposal created' })
    } else if (typeof opts.promoteToProposal !== 'function') {
      promoteErrors.push({ code: 'seam_not_wired', message: 'promoteToProposal not injected' })
    } else {
      const r = await opts.promoteToProposal(taskId)
      if (r && r.ok && r.proposal) proposals.push(r.proposal) // official record only — the single source of proposal truth
      else promoteErrors.push((r && r.error) || { code: 'promote_failed', message: 'unknown promotion failure' })
    }
    // Change B: the ONLY source of proposal truth is the official record. Claim a
    // created proposal (with its real id) only when exactly one real record exists;
    // any promote failure grounds to "遇到問題,尚未建立任何提案".
    const createdProposal = (proposals.length === 1 && proposals[0] && proposals[0].id) ? proposals[0] : null
    return {
      blocked: false, mode: 'commit', intent: distilled.intent, demoOutcome: 'execution_proposal',
      reply: buildGroundedReply({
        type: 'execution_proposal',
        proposalCreated: !!createdProposal,
        proposalId: createdProposal ? createdProposal.id : null,
        promoteError: promoteErrors[0] || null
      }),
      proposals,
      promoteErrors, contextCardWarnings: ctx.warnings, requestId
    }
  }

  const decisionId = stored ? stored.decision.id : null
  const decisionStatement = stored ? stored.decision.statement : (distilled.decision ? distilled.decision.statement : '')
  const storedTasks = stored ? stored.tasks : distilled.tasks
  const tasksWithCap = storedTasks.map((t, i) => ({ ...t, capability: (distilled.tasks[i] && distilled.tasks[i].capability) || 'ops' }))

  const dispatched = createDispatchesForTasks(tasksWithCap, decisionId)
  // Kick off REAL execution for connected workers only (fire-and-forget). Others stay waiting_connection.
  for (const { dispatch, worker } of dispatched) {
    if (worker.connected && worker.engine === 'llm') {
      executeDispatch(dispatch.id, adapter, { decisionStatement }).catch(() => {})
    }
  }
  const enrichedTasks = dispatched.map(({ dispatch, task }) => ({
    id: task.id, title: task.title, note: task.note,
    worker: dispatch.worker_name, status: dispatch.status, stage: statusLabel(dispatch.status), dispatch_id: dispatch.id
  }))

  return {
    blocked: false,
    mode: 'commit',
    intent: distilled.intent,
    reply: distilled.reply,
    understanding: distilled.understanding,
    judgment: distilled.judgment,
    // A DECISION THAT WAS NOT PERSISTED IS NOT A DECISION.
    // This used to fall back to `distilled.decision` — the model's own proposed text —
    // so a turn whose write failed looked, to the Owner, exactly like one that succeeded.
    // Null is the honest answer, and `decisionPersisted` below says so out loud.
    decision: stored ? stored.decision : null,
    decisionPersisted: !!(persisted && persisted.durable),
    tasks: enrichedTasks,
    risks: distilled.risks,
    next_step: distilled.next_step,
    requestId
  }
}

module.exports = { processIntake }
