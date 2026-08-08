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
const { DISTILL_WITH_PLAN_SCHEMA, DISTILL_WITH_READ_DECISION_SCHEMA, withRowRefs, withReadChoices, validatePlan, minimalAnswer, logAnswerPlan } = require('./answerPlan') // the model decides, the server proves
// ⛔ THE CLOSED VOCABULARY the model may pick a read from. It EXPANDS authorised sources; it
// never adds one. See readOperations.js.
const { operationsForSources, resolveReadOperation, operationForAromaMethod, describeOperations } = require('../context/readOperations')
const { routeTurn, logTurnRoute, resolveTurnRouter } = require('./turnRouter') // intent-first router: UTILITY acts, the rest observe
const { answerUtility } = require('./utilityAnswer') // the server answers, or it says nothing

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
const CHAT_MAX_TOKENS = 2048

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
  const { system, prompt } = buildDistillPrompt(message, history)
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
  let recallBlockCache // undefined = not attempted yet; null = nothing to inject
  let convRecallBlockCache // same three-state contract, for Conversation Recall

  // THE TURN'S REAL READ OUTCOME, recorded AT the read — source -> {source,trust,count,
  // usedFallback}. Keyed by source so the same source fetched for a second provider does
  // not double-count. This is what the reply is checked against below; reconstructing it
  // afterwards is the exact bug class that has already cost three rounds.
  const turnPerSource = new Map()

  // THE ROWS THEMSELVES, for the Owner-facing view. Recorded at the same instant as
  // turnPerSource and for the same reason: the presentation is built from what this turn
  // really retrieved, never reconstructed from the reply afterwards.
  const turnItems = new Map() // source -> items[]
  const turnEvidence = new Map() // source -> what that read IS (kind, totals, meaning)
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
        const all = (routeGoverns && !forced)
          ? enabled.filter((s) => routeDecision.sources.includes(s))
          : enabled
        // PER-SOURCE, PER-PROVIDER. Claude gets everything READ_ACCESS allows; OpenAI
        // gets that minus anything the Owner has withheld from it.
        const sources = sourcesForProvider(providerName, all, process.env)
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
              if (g && g.source && Array.isArray(g.items) && g.items.length) turnItems.set(g.source, g.items)
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
        schema: withReadChoices(DISTILL_WITH_READ_DECISION_SCHEMA, openChoices, choiceGloss)
      }
    }
    const refs = []
    for (const [source, items] of turnItems) {
      for (const it of (Array.isArray(items) ? items : [])) {
        if (it && it.sourceId != null && it.sourceId !== '') refs.push(`${source}#${it.sourceId}`)
      }
    }
    // ⛔ THE MODEL IS SHOWN ITS ACTUAL CHOICES (live canary, blocker 2). Authorised for the
    // provider making THIS call, minus anything already read this turn. With nothing left,
    // withReadChoices() makes nextRead null-only rather than emitting an empty enum.
    // Reuses openChoices from above rather than recomputing, so the two schemas can never
    // disagree about what is still readable this turn.
    const shaped = withReadChoices(withRowRefs(DISTILL_WITH_PLAN_SCHEMA, refs), openChoices, choiceGloss)
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
      for (const items of turnItems.values()) rows += Array.isArray(items) ? items.length : 0
      logTurnRoute({
        decision: routeDecision,
        // Read from `opts`, NOT from `isChat`/`interactionMode`: both of those live in the
        // per-provider closure above and are out of scope here. The first draft used them,
        // and because the block is wrapped in a catch it would have thrown silently every
        // turn and produced no shadow data at all — a telemetry feature that logs nothing
        // while appearing to work.
        lane: (opts && opts.interactionMode === 'proposal') ? 'proposal' : ((opts && opts.interactionMode === 'chat') ? 'chat' : 'other'),
        sourcesRead: Array.from(turnPerSource.values()).filter((r) => r && r.trust === 'live').map((r) => r.source),
        rowsRetrieved: rows,
        // THE EXACT CONDITION at intakeService.js:401 that makes the plan mandatory today.
        answerPlanForced: turnItems.size > 0,
        requestId
      })
    } catch (_) { /* shadow telemetry is never load-bearing */ }
  }

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
  if (interactionMode === 'chat' && distilled && distilled.nextRead) {
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
    let pending = distilled.nextRead
    const loop = await runReasoningLoop({
      capabilities: allowed,
      onEvent: (e) => { try { console.log('[AROMA-REASONING]', JSON.stringify(Object.assign({ requestId, provider: activeProvider }, e))) } catch (_) {} },
      executeRead: async ({ capability }) => {
        // ⛔ RESOLVE BEFORE THE CONNECTOR, AND REFUSE WITHOUT TOUCHING IT.
        // Two independent checks, and the connector is reached only past both: the name must be
        // in the vocabulary this turn generated, and it must resolve in the frozen table. An
        // invented operation therefore costs zero reads — it is refused as an observation and
        // handed back to the model, exactly like any other refusal in the loop.
        const resolved = allowed.includes(capability) ? resolveReadOperation(capability) : null
        if (!resolved) return { capability, ok: false, error: 'unknown_read_operation', summary: null }
        const connector = (readDeps && readDeps.connector) || createLiveReadConnector({ env: process.env }).connector
        // `operation` is what makes this a MODEL-DIRECTED read: for aroma_system it selects the
        // view the model already chose, instead of re-deriving one from the Owner's message —
        // the re-derivation that vetoed this very read as `notAsked`. For every other source it
        // changes nothing; their plans were never intent-derived.
        const rc = await buildReadContext({ connector, message, sources: [resolved.source], operation: capability, env: process.env })
        if (rc && rc.block) extraObservationBlocks.push(rc.block)
        for (const row of (rc && Array.isArray(rc.perSource)) ? rc.perSource : []) if (row && row.source) turnPerSource.set(row.source, row)
        for (const g of (rc && Array.isArray(rc.itemsBySource)) ? rc.itemsBySource : []) if (g && g.source && Array.isArray(g.items) && g.items.length) turnItems.set(g.source, g.items)
        for (const e of (rc && Array.isArray(rc.evidenceSets)) ? rc.evidenceSets : []) if (e && e.source) turnEvidence.set(e.source, e)

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
        recordOperation(capability, trust)
        // ⛔ TRUTH CLOSURE: PROVENANCE IS RECORDED AT THE ONLY PLACE THAT KNOWS IT.
        // This line is inside the loop's executeRead, so reaching it IS the proof the read was
        // model-directed; and `trust === 'live'` is the proof it produced evidence. An
        // `unavailable` read is excluded here, so a failed read can never open the grounding
        // path — the same three-state rule as recordOperation, applied to a second question.
        if (trust === 'live') modelDirectedLiveOperations.add(capability)
        return { capability, ok: trust === 'live', summary: null }
      },
      callModel: async ({ step }) => {
        if (step === 1) return { type: 'read', capability: String(pending.capability || '') }
        const prompt = await buildPromptFor(activeProvider)
        const fmt = answerPlanFormat()
        const next = await activeAdapter.complete(prompt, { system: effSystem, maxTokens, ...(fmt ? { responseFormat: fmt } : {}) })
        noteProvider(activeProvider === OPENAI ? 'openai' : 'claude', next) // provenance, per call
        await recordProviderUsage(next)                                     // ⛔ accounting, per call
        llmResult = next
        let parsed = null
        try { parsed = parseDistillResponse(next.text, tel) } catch (_) { return { type: 'final', result: null } }
        pending = parsed && parsed.nextRead ? parsed.nextRead : null
        if (!pending) { distilled = parsed || distilled; return { type: 'final', result: parsed } }
        // ⛔ BLOCKER 4: a STILL-PENDING envelope is NOT adopted as the answer. If the loop
        // now hits the step limit, distilled still holds the last FINISHED envelope and the
        // prose that was mid-request never reaches the Owner as though it were complete.
        return { type: 'read', capability: String(pending.capability || '') }
      }
    })
    // ⛔ BLOCKER 4: the result is USED, not voided. At the step limit there is no fourth
    // call and nothing is invented — the turn falls through to the EXISTING deterministic
    // rendering, which now runs over every observation gathered (they are already in
    // turnEvidence / turnItems / turnPerSource) rather than over a half-finished sentence.
    if (loop.stopReason === STOP.STEP_LIMIT) {
      distilled = Object.assign({}, distilled, { answerPlan: null, nextRead: null })
      try { console.log('[AROMA-REASONING]', JSON.stringify({ requestId, event: 'REASONING_STEP', reasoningStep: loop.steps, decisionType: null, stopReason: loop.stopReason, observations: loop.observations.length })) } catch (_) {}
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
      itemsBySource: Array.from(turnItems.entries()).map(([source, items]) => ({ source, items })),
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
    const lang = enforceTraditional(guarded.reply)
    logTraditionalFlag(lang, requestId)
    guarded.reply = lang.reply
    if (guarded.corrected) logReadClaimCorrection(guarded, requestId)
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
      itemsBySource: Array.from(turnItems.entries()).map(([source, items]) => ({ source, items })),
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
