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
const { buildReadContext } = require('../context/readContext')
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
// Multi-AI Router v0 (flag-gated OFF; Claude stays default + one-shot fallback).
const { selectPrimaryProvider, OPENAI, CLAUDE } = require('../routing/modelRouter')
const { sourcesForProvider, decisionRecallSharedWith, withheldFrom } = require('../context/providerSharing') // per-source, per-provider sharing policy
const { createOpenAIAdapterIfConfigured } = require('../adapters/OpenAIAdapter')
const { getPersonaSource } = require('../persona/personaSource')   // R2 runtime persona source selector (legacy default; memory lazy-loaded)
const { buildContextPreamble } = require('./contextCard')         // B2-2 slice 2 hook
const { IntakeUpstreamError } = require('./intakeErrors')         // B2-2 slice B — typed upstream error
const { runU1DraftShadow } = require('./u1DraftShadow')
const { isShortReply, isReadRequest } = require('./laneRouter') // a short confirmation is an answer, not an instruction
const { enforceReadState } = require('./readStateGuard') // a reply may not deny a read that happened

/**
 * One line whenever a false read-claim is corrected, so the failure is COUNTABLE and not
 * just visible on one screen. Allowlisted by construction, same discipline as the other
 * two logs: the source names, which rule fired, and the request id — never the reply, the
 * message, or anything read.
 */
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
    effSystem = buildPersonaSystemFromPersona(rp.personaText, system, { extraGuards: guards })
  } else {
    effSystem = system
  }
  const baseEffPrompt = demo ? (ctx.preamble + prompt) : prompt

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

  async function buildPromptFor (providerName) {
    if (promptCache.has(providerName)) return promptCache.get(providerName)
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
        const deps = (opts && opts.readContextDeps) || null
        const all = deps && Array.isArray(deps.sources) ? deps.sources : enabledSources(process.env)
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
            }
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

    promptCache.set(providerName, effPrompt)
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
  let llmResult = null
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
        gptResult = await gpt.complete(await buildPromptFor(OPENAI), { system: effSystem, maxTokens, temperature: 0.3 })
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
          distilled = parseDistillResponse(gptResult.text)
          llmResult = gptResult
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
      llmResult = await adapter.complete(await buildPromptFor(CLAUDE), {
        system: effSystem,
        maxTokens,
        temperature: 0.3
      })
    } catch (err) {
      // Upstream provider/adapter failure → typed, safe error. Provider message is
      // kept only on .cause (server-side classification), never surfaced to client.
      throw new IntakeUpstreamError({ correlationId: requestId, cause: err })
    }
    // Same rule for the Claude attempt: recorded before the parse can throw.
    noteProvider('claude', llmResult)
    tel.fallbackUsed = (primaryProvider === OPENAI)
    await recordProviderUsage(llmResult)
  }

  // Parse the structured JSON response. DistillParseError (Slice A) propagates
  // untouched — it owns .reason/.diagnostic; the outer wrapper tags correlationId.
  // On failure we attach NUMERIC/enum diagnostics only, so a truncation can be proven
  // instead of inferred: stopReason==='max_tokens' next to the configured limit and
  // the TRUE output size. The model output itself, the prompts and the user's message
  // are never attached — the existing rawSample (capped at 200) remains the only text.
  try {
    if (!distilled) distilled = parseDistillResponse(llmResult.text)
    tel.parseResult = 'ok'
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

    const guarded = enforceReadState(reply, Array.from(turnPerSource.values()))
    if (guarded.corrected) logReadClaimCorrection(guarded, requestId)
    return {
      blocked: false, mode: 'chat', talkOnly: true, interactionMode: 'chat',
      reply: guarded.reply, readClaimCorrected: guarded.corrected,
      decision: null, tasks: [], risks: [], next_step: '', requestId
    }
  }
  if (interactionMode === 'proposal' && distilled.mode !== 'commit') {
    // proposal mode + a non-executable intent: deterministic clarification.
    // Do NOT fabricate a Task or Proposal; do NOT persist or promote.
    await recordProviderUsage(llmResult) // idempotent: already recorded pre-parse
    return {
      blocked: false, mode: distilled.mode, interactionMode: 'proposal',
      demoOutcome: 'clarification', clarificationReason: 'not_a_commit_intent',
      reply: '這看起來不是一個可執行的任務，尚未建立任何提案。請描述你想執行的具體任務。',
      decision: null, tasks: [], proposals: [], requestId
    }
  }

  // ── DEMO — Plan A: an execution intent must resolve to EXACTLY ONE task (this
  //    is the first official-Proposal demo, not a batch system). 0 or >1 tasks →
  //    clarification; do NOT persist and do NOT promote. ──────────────────────
  if (demo && distilled.mode === 'commit' && (!Array.isArray(distilled.tasks) || distilled.tasks.length !== 1)) {
    await recordProviderUsage(llmResult) // idempotent: already recorded pre-parse
    const clarificationReason = (Array.isArray(distilled.tasks) && distilled.tasks.length > 1) ? 'multiple_tasks_narrow_to_one' : 'no_actionable_task'
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
    const guarded = enforceReadState(distilled.reply, Array.from(turnPerSource.values()))
    if (guarded.corrected) logReadClaimCorrection(guarded, requestId)
    return { blocked: false, mode: distilled.mode, intent: distilled.intent,
      ...(demo && { demoOutcome: classifyDemoOutcome({ mode: distilled.mode, intent: distilled.intent }).outcome, contextCardWarnings: ctx.warnings }),
      reply: guarded.reply, readClaimCorrected: guarded.corrected,
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
    decision: stored ? stored.decision : distilled.decision,
    tasks: enrichedTasks,
    risks: distilled.risks,
    next_step: distilled.next_step,
    requestId
  }
}

module.exports = { processIntake }
