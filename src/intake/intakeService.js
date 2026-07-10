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
const { createDispatchesForTasks, executeDispatch, statusLabel } = require('../dispatch/dispatcher')
const { logLLMCall, logRedLineBlock } = require('../utils/metricsLogger')
const { persistIntake, recordLLMUsage } = require('../utils/hubClient')

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
async function processIntake (message, adapter, history = []) {
  const requestId = uuidv4()
  const endpoint = '/api/v1/intake'

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

  // ── STEP 2: LLM DISTILLATION ──────────────────────────────────────────────
  const { system, prompt } = buildDistillPrompt(message, history)

  let llmResult
  try {
    llmResult = await adapter.complete(prompt, {
      system,
      maxTokens: 1024,
      temperature: 0.3
    })
  } catch (err) {
    throw new Error(`Intake LLM call failed: ${err.message}`)
  }

  // Parse the structured JSON response
  let distilled
  try {
    distilled = parseDistillResponse(llmResult.text)
  } catch (err) {
    throw new Error(`Intake distillation parse failed: ${err.message}`)
  }

  // ── CHAT or ASK: talk only — do NOT persist any Decision/Task ─────────────
  if (distilled.mode !== 'commit') {
    logLLMCall({
      model: llmResult.model, latencyMs: llmResult.latencyMs,
      inputTokens: llmResult.usage.inputTokens, outputTokens: llmResult.usage.outputTokens,
      totalTokens: llmResult.usage.totalTokens, endpoint, blocked: false
    })
    await recordLLMUsage({
      model: llmResult.model, inputTokens: llmResult.usage.inputTokens,
      outputTokens: llmResult.usage.outputTokens, totalTokens: llmResult.usage.totalTokens,
      latencyMs: llmResult.latencyMs, endpoint, requestId, blocked: false
    })
    return { blocked: false, mode: distilled.mode, intent: distilled.intent, reply: distilled.reply, judgment: '', reasons: distilled.reasons || [], offer: distilled.offer || '', decision: null, tasks: [], risks: [], next_step: '', requestId }
  }

  // ── STEP 3: LOG METRICS (local — condition 6) ─────────────────────────────
  logLLMCall({
    model: llmResult.model,
    latencyMs: llmResult.latencyMs,
    inputTokens: llmResult.usage.inputTokens,
    outputTokens: llmResult.usage.outputTokens,
    totalTokens: llmResult.usage.totalTokens,
    endpoint,
    blocked: false
  })

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
  await recordLLMUsage({
    model: llmResult.model,
    inputTokens: llmResult.usage.inputTokens,
    outputTokens: llmResult.usage.outputTokens,
    totalTokens: llmResult.usage.totalTokens,
    latencyMs: llmResult.latencyMs,
    endpoint,
    requestId,
    blocked: false
  })

  // ── STEP 6: DISPATCH (real Worker Dispatcher) ─────────────────────────────
  const stored = persisted && persisted.ok ? persisted.data : null
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
