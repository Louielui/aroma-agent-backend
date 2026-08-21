'use strict'

/**
 * app.js — Express application factory (separate from server startup).
 *
 * Separating app creation from server startup allows tests to import the app
 * (or build an isolated one via createApp) without binding to a port.
 *
 * Routing note: every Aroma OS route is mounted TWICE — once on its historical
 * unprefixed path (so existing scripts keep working) and once under an /api/v1
 * prefix (so the browser can reach it through the frontend dev-server proxy,
 * which only forwards paths beginning with /api). Every state-changing (POST)
 * route is guarded by requireServiceToken on BOTH mounts; read-only GET routes
 * for runs and proposals are not. GET /health stays unprefixed and open, exactly
 * as it is today, because the apply script probes backend health through it.
 */

require('dotenv').config()

const { BOOT_COMMIT, BOOTED_AT } = require('./governance/bootCommit')
const os = require('node:os')
const path = require('node:path')

const express = require('express')
const intakeRouter = require('./routes/intakeRouter')
const { createDemoRouter } = require('./routes/demoRouter') // B2-2 demo UI (guarded; 403 when demo OFF)
const { createEnquiryRouter } = require('./routes/enquiryRoutes') // read ONE investigation, on request
const { mountHomeRoutes } = require('./home/homeRoutes') // 首頁 — what she ran, what waits on him
const { openErrandStore } = require('./home/errandStore')
const { createEnquiryStore } = require('./agent/enquiryStore')
// THE REAL WRITERS, NAMED AT THE COMPOSITION ROOT. Both routers now default to inert, so
// this file is the only place that hands either of them something that can touch disk.
const { conversationStore: realConversationStore } = require('./store/conversationStore')
const { load: loadOwnerSettingsReal, save: saveOwnerSettingsReal } = require('./persona/ownerSettings')
const { createSettingsRouter } = require('./routes/settingsRouter') // 香香 settings (owner session; style + preferences + switches)
const { createContextRouter } = require('./routes/contextRouter') // Read Context v1 (guarded; 403 when READ_ACCESS OFF)
const { createProposalBridgeRouter, promoteTaskToProposal } = require('./intake/proposalBridge')
const store = require('./store/store')
const { recordApprovalEvent } = require('./store/store') // approval decisions are durable — not a 500-entry buffer
const { listWorkers, getExecutive } = require('./workers/registry')
const { statusLabel } = require('./dispatch/dispatcher')

// Run Store — the asynchronous seam between an HTTP request and the governed
// worker. See src/run/store.js. deriveStatus derives a Run's status from its
// append-only timeline (a Run never stores a status).
const { createRunStore } = require('./run/store')
const { deriveStatus } = require('./run/run')
const { createDispatcher } = require('./capability/dispatcher')
const { createClaudeCodeAdapter } = require('./adapters/claude-code')
// Agent Bridge v0 (built behind AGENT_BRIDGE, default OFF). Single source of truth
// for the three-flag, two-of-three execution-authorization matrix.
const { resolveAgentBridge, authorizeExecution: authorizeExecutionMatrix } = require('./agent/agentAuthorization')
const { createAgentRunner } = require('./agent/agentRunner') // Agent Bridge wiring v1 (built ONLY when AGENT_BRIDGE==='on')
const { createConfirmService } = require('./agent/confirmService') // THE single confirm domain service (both entry points)
const { createOwnerApprovalStore } = require('./agent/ownerApprovalStore') // server-authoritative sealed orders + nonces + sessions
const { createOwnerApprovalRouter } = require('./routes/ownerApprovalRouter') // local Owner approval card (loopback + CSRF + typed EXECUTE)
const { proposeWorkOrder } = require('./agent/workOrderProducer')
const { EXECUTABLE_IDENTITY } = require('./projects/repositoryIdentity')
const { buildApprovalView } = require('./agent/workOrderView')
const { buildAgentResultView, phaseLabel } = require('./agent/agentResultView') // Layer 2 result view (read-only)

// Conversation → Proposal → Run bridge (COO). Proposing is inert; the ONLY path
// from a Proposal to a Run is the structured confirm action below. See
// src/coo/proposal.js and src/coo/intent.js.
const { createProposalStore } = require('./coo/proposal')
const { getAdapter } = require('./adapters/adapterFactory')
const { resolveArtifactDir } = require('./runtime/artifactDir') // Runtime Foundation A4 — external artifact root

// Service-token authentication for every state-changing route. See src/api/auth.js.
const { createRequireServiceToken, readExpectedToken } = require('./governance/auth')
const { createSessionStore, createRequireOwner, readOwnerPassword, ownerPasswordConfigured } = require('./governance/ownerAuth') // Owner gate: demo + context + intake
const { createOwnerAuthRouter } = require('./routes/ownerAuthRouter') // the login surface (mounted OUTSIDE the gate)

// B2-1 worker invocation (integration slice). These are wired at the composition
// root and triggered fire-and-forget AFTER the confirm response — the
// confirmProposal / startRun / dispatch governance is never touched.
const { createArtifactStore } = require('./store/artifactStore')
const { createClaudeWorker } = require('./workers/claudeWorker')
const { createWorkerRunner } = require('./workers/runWorkerInBackground')

// B2-1d read-only Result Read Endpoint helpers (allowlist projection + robust,
// traversal-safe artifact lookup). No worker invocation, no governance.
const {
  validateProposalId, findExecutionByProposalId, findResultByTaskId, buildResultView
} = require('./api/executionResultView')
// Phase 1 (Human Relay Removal) — pure READ aggregation of finished executions.
const { buildReturnReadyList } = require('./api/returnReadyView')

// ── Run Store wiring ───────────────────────────────────────────────────────────
// The owner is supplied here, from the server's trusted context — never from the
// request body. For M1 this is a single local owner.
const LOCAL_OWNER = 'louie'

// B2-1 worker-invocation flag. Single read site (in the confirm handler), default
// 'off' — production behaviour is byte-for-byte unchanged unless explicitly on.
// An invalid value fails closed to 'off' with a warning, never open to 'on'.
function resolveWorkerInvocation () {
  const raw = process.env.WORKER_INVOCATION
  if (raw === undefined || raw === null || raw === '') return 'off'
  if (raw === 'on' || raw === 'off') return raw
  console.warn(`[AROMA-HUB] Invalid WORKER_INVOCATION="${raw}" — falling back to 'off'.`)
  return 'off'
}

// B2-9 flag-scope containment. DEVELOP_DISPATCH gates ONLY the real-repo Claude
// Develop dispatch (the Run-store dispatcher). It mirrors resolveWorkerInvocation
// EXACTLY: strict 'on' only; unset/empty/misspelled/wrong-case/any-other → 'off'
// (fail-closed). It NEVER implies the sandbox worker, and WORKER_INVOCATION never
// implies Develop — the two flags are independent.
function resolveDevelopDispatch () {
  const raw = process.env.DEVELOP_DISPATCH
  if (raw === undefined || raw === null || raw === '') return 'off'
  if (raw === 'on' || raw === 'off') return raw
  console.warn(`[AROMA-HUB] Invalid DEVELOP_DISPATCH="${raw}" — falling back to 'off'.`)
  return 'off'
}

// B2-2 Conversation Demo gate. Mirrors resolveWorkerInvocation/resolveDevelopDispatch
// EXACTLY: strict 'on' only; unset/empty/misspelled/wrong-case → 'off' (fail-closed).
// Purely conversational: it gates additive demo wiring only — never touches the
// Dispatcher, a Run, a Worker, or the Timeline.
function resolveConversationDemo () {
  const raw = process.env.CONVERSATION_DEMO
  if (raw === undefined || raw === null || raw === '') return 'off'
  if (raw === 'on' || raw === 'off') return raw
  console.warn(`[AROMA-HUB] Invalid CONVERSATION_DEMO="${raw}" — falling back to 'off'.`)
  return 'off'
}

// B2-9 execution-authorization gate. Confirm approves a Proposal; it is NOT
// blanket authorization to run anything. Real execution is authorized ONLY here,
// fail-closed and with NO implicit priority:
//   - both flags on  → 'configuration_conflict' (zero worker, zero dispatcher)
//   - DEVELOP on AND a dispatcher explicitly injected/configured → Develop authorized
//   - WORKER on (and no conflict)                                → sandbox worker authorized
//   - otherwise                                                  → 'not_authorized'
// `dispatcherConfigured` reflects whether a REAL/injected Develop dispatcher exists
// at all (the productionDispatcher is never the implicit default — see createApp),
// so DEVELOP='on' with no dispatcher configured is still not_authorized.
// Agent Bridge v0 extends this to THREE independent, fail-closed flags via the
// shared matrix (agentAuthorization.js): ANY two-of-three 'on' → configuration_
// conflict → ZERO execution. AGENT_BRIDGE defaults OFF and needs an agent runner
// configured to authorize, so with the flag off (or no runner wired) the result is
// byte-for-byte the same as before for the worker/develop lanes.
function resolveExecutionAuthorization (dispatcherConfigured, agentRunnerConfigured = false) {
  return authorizeExecutionMatrix({
    worker: resolveWorkerInvocation(),
    develop: resolveDevelopDispatch(),
    agent: resolveAgentBridge(),
    dispatcherConfigured,
    agentRunnerConfigured
  })
}

// The real Claude Code adapter is built lazily (and once), so importing this
// module never spawns anything. Paths mirror scripts/proof-run.js.
let realAdapter = null
function claudeCodeAdapters () {
  if (!realAdapter) {
    const home = os.homedir()
    realAdapter = createClaudeCodeAdapter({
      selfexecDir: path.join(home, 'Downloads', 'aroma-selfexec'),
      backendRoot: path.join(home, 'Downloads', 'm1', 'aroma-m1-backend')
    })
  }
  return { 'claude-code': realAdapter }
}

// Production dispatcher: route one Run's work through the REAL Capability
// Dispatcher, recording each observed milestone into that Run's timeline via the
// runContext the store supplies. Errors are caught by the store and recorded as
// FAILED — they never crash the process.
function productionDispatcher ({ run, runContext, request, approval }) {
  const dispatcher = createDispatcher({ adapters: claudeCodeAdapters(), runContext })
  // The apply phase supplies an explicit, already-fixed request (Apply@1 → dev)
  // and an approval; the store owns its APPLYING/COMPLETED/ROLLED_BACK stages, so
  // we route without a runContext and return the result verbatim.
  if (request) {
    return dispatcher.dispatch(request, approval)
  }
  // The initial (develop) phase derives its request from the Run itself and
  // records every observed milestone into the Run's timeline via runContext.
  return dispatcher.dispatch({
    capabilityId: run.capabilityId,
    version: run.version == null ? 1 : run.version,
    target: run.targetProject,
    // The adapter chooses backend vs frontend per invocation, so the Develop
    // input must carry the Run's targetProject — otherwise a frontend Run would
    // be misdirected to the backend project the adapter was constructed with.
    input: { task: run.task, target: run.targetProject, targetProject: run.targetProject },
    context: { description: run.task, intent: run.intent }
  })
}

// The intent classifier's language model, built lazily (and once) from the
// configured LLM adapter so importing this module never touches the network. The
// model's answer is UNTRUSTED — intent.js re-validates every field before any
// Proposal is created, and the model can never reach production or trigger a Run.
let intentAdapter = null
async function intentLlm (message) {
  if (!intentAdapter) intentAdapter = getAdapter()
  const system = [
    'You classify ONE message from the operator of a software business.',
    'Reply with STRICT JSON only — no prose, no code fences.',
    'If the message is a greeting, a question, or small talk, reply exactly:',
    '  {"intent":"chat"}',
    'If the message asks to build, change, fix, or add something to a project,',
    'reply: {"intent":"develop","task":"<a single clear instruction for a',
    'developer, verbatim-ready to send to a worker>","targetProject":"backend"',
    'or "frontend"}.',
    'targetProject MUST be exactly "backend" or "frontend". Never "production".',
    'When unsure, choose {"intent":"chat"}.'
  ].join(' ')

  const result = await intentAdapter.complete(message, { system, maxTokens: 400, temperature: 0 })
  return parseIntentJson(result && result.text)
}

// Extract the first JSON object from a model reply, tolerating stray code
// fences or surrounding text. Returns null on anything unparseable — intent.js
// then treats it as ordinary conversation.
function parseIntentJson (text) {
  if (typeof text !== 'string') return null
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch (_) {
    return null
  }
}

/**
 * Build the router that carries every Aroma OS route. It is mounted at both '/'
 * and '/api/v1' by createApp, so each route below is reachable on its historical
 * unprefixed path and on its /api/v1 twin. State-changing (POST) routes carry
 * requireServiceToken; read-only GET routes for runs and proposals do not.
 */
// B2-1: schedule a worker AFTER the confirm response, fire-and-forget. It reads
// the proposal's own confirm provenance for the Execution Artifact and never
// blocks or alters the confirm/startRun path. No-op unless the sandbox worker is
// AUTHORIZED (WORKER_INVOCATION on AND no config conflict) and a worker is wired.
// Any error is swallowed into a log line — never a late write, never a crash.
//
// Lifted to module scope (unchanged behaviour) so the ONE shared confirm service —
// used by both the Bearer confirm route and the local Owner approval card — owns the
// single sandbox-worker schedule call, instead of each entry point having its own.
function createScheduleWorker ({ runStore, proposalStore, workerDeps, authorizeExecution }) {
  return function scheduleWorker (proposalId, runId) {
    if (!authorizeExecution().workerAuthorized || !workerDeps || !workerDeps.runner) return
    // B2-14 SANDBOX-WORKER CLAIM GATE — synchronous, AFTER the B2-9 auth gate above
    // (auth FIRST → flag-off = 0 claim, 0 worker). Only a fresh, unique WORKER_CLAIMED
    // claim spawns; already_dispatched / already_completed / needs_review / claim-
    // failed → NO spawn (idempotent, fail-closed). Never bypasses authorization.
    const claim = runStore.claimWorker(runId)
    if (claim.status !== 'dispatched') {
      console.warn(`[worker] not dispatched (status: ${claim.status}) for run ${runId} — no spawn`)
      return
    }
    Promise.resolve()
      .then(() => {
        const proposal = proposalStore.getProposal(proposalId)
        if (!proposal) return
        return workerDeps.runner.run({
          proposalId,
          runId,
          task: proposal.task,
          approval: { confirmedBy: proposal.confirmedBy, confirmedAt: proposal.confirmedAt }
        })
      })
      .catch(err => console.error('[worker] invocation failed:', err && err.message ? err.message : String(err)))
  }
}

function createAromaRouter ({ runStore, proposalStore, workerDeps, authorize, requireServiceToken, confirmService }) {
  const router = express.Router()

  // B2-9: the authorization gate. Defaults to a fail-closed 'not_authorized' if a
  // caller ever omits it, so the worker/dispatch can never fire un-gated.
  const authorizeExecution = typeof authorize === 'function'
    ? authorize
    : () => ({ status: 'not_authorized', workerAuthorized: false, developAuthorized: false })

  // ── Runs — asynchronous, governed work with a live append-only timeline ───────

  // Create a Run and dispatch it in the BACKGROUND. Responds immediately (well
  // under a second) with the run id and its derived status. `owner` is NEVER read
  // from the body — the store sets it from the server's trusted context. Passing
  // the service token proves the caller came through the trusted proxy; it is
  // never treated as a value the caller may use to name itself.
  router.post('/runs', requireServiceToken, (req, res) => {
    const body = req.body || {}
    try {
      const id = runStore.startRun({
        task: body.task,
        targetProject: body.targetProject,
        capabilityId: body.capabilityId,
        version: body.version,
        intent: body.intent,
        conversationId: body.conversationId,
        goal: body.goal
      })
      const run = runStore.getRun(id)
      res.status(201).json({ id, status: deriveStatus(run) })
    } catch (err) {
      // Invalid input (e.g. targetProject 'production') is a client error.
      res.status(400).json({ error: err.message })
    }
  })

  // Read one Run — full timeline plus derived status — or 404. No token required.
  router.get('/runs/:id', (req, res) => {
    const run = runStore.getRun(req.params.id)
    if (!run) return res.status(404).json({ error: 'not found' })
    res.json({ ...run, status: deriveStatus(run) })
  })

  // List the most recent Runs (most-recent-first), each with its derived status.
  router.get('/runs', (req, res) => {
    const limit = Number.parseInt(req.query.limit, 10)
    const runs = runStore.listRuns(Number.isInteger(limit) ? limit : undefined)
    res.json(runs.map(run => ({ ...run, status: deriveStatus(run) })))
  })

  // Approve a pending-approval Run and apply its frontend patch. `approvedBy` is
  // supplied by the SERVER from its trusted context (exactly as `owner` is) and is
  // NEVER read from the request body — a client can never set the approver.
  router.post('/runs/:id/approve', requireServiceToken, async (req, res) => {
    try {
      const run = await runStore.approveRun(req.params.id, LOCAL_OWNER)
      res.json({ ...run, status: deriveStatus(run) })
    } catch (err) {
      res.status(err.statusCode || 400).json({ error: err.message })
    }
  })

  // Reject a pending-approval Run. `rejectedBy` is server-supplied; the body may
  // carry only an optional `reason`. This never dispatches anything.
  router.post('/runs/:id/reject', requireServiceToken, (req, res) => {
    try {
      const body = req.body || {}
      const reason = typeof body.reason === 'string' ? body.reason : undefined
      const run = runStore.rejectRun(req.params.id, LOCAL_OWNER, reason)
      res.json({ ...run, status: deriveStatus(run) })
    } catch (err) {
      res.status(err.statusCode || 400).json({ error: err.message })
    }
  })

  // B2-11b: human-gated Retry of an INTERRUPTED run. Requires an explicit `reason`
  // (Louie's authorization); retryApprovedBy/At are server-side. It creates a NEW
  // attempt preserving the original, and does NOT dispatch — the new attempt is
  // inert and a future dispatch stays gated by B2-9. Duplicate retry → 409.
  router.post('/runs/:id/retry', requireServiceToken, (req, res) => {
    try {
      const body = req.body || {}
      const reason = typeof body.reason === 'string' ? body.reason : ''
      const findExecution = (runId) => {
        const store = workerDeps && workerDeps.artifactStore
        if (!store || typeof store.list !== 'function') return null
        try { return store.list('tasks').find(e => e && e.runId === runId) || null } catch (_) { return null }
      }
      const attempt = runStore.retry(req.params.id, { reason, findExecution })
      res.status(201).json(attempt)
    } catch (err) {
      res.status(err.statusCode || 400).json({ error: err.message })
    }
  })

  // ── Conversation → Proposal → Run bridge ──────────────────────────────────────

  // A message becomes either a chat reply or a PROPOSAL that shows EXACTLY what
  // would be sent to a worker. This NEVER creates a Run and NEVER dispatches — only
  // the confirm route below can do that.
  router.post('/conversations/:id/messages', requireServiceToken, async (req, res) => {
    const body = req.body || {}
    try {
      const result = await proposalStore.propose({
        conversationId: req.params.id,
        message: body.message,
        llm: intentLlm
      })
      // 201 when a Proposal was created (the response includes the verbatim task
      // string for display); 200 for an ordinary chat reply.
      //
      // ⛔ AND 503 WHEN WE COULD NOT FIND OUT. A classifier that timed out or returned
      // something unreadable used to arrive here as an ordinary 200 chat reply, so the Owner's
      // work request vanished into a conversation. 503 is the honest code: the request was not
      // refused and was not answered — the upstream that decides could not be reached, and he
      // should send it again rather than assume it was heard.
      const status = result.intent === 'develop' ? 201 : (result.intent === 'unavailable' ? 503 : 200)
      res.status(status).json(result)
    } catch (err) {
      res.status(err.statusCode || 400).json({ error: err.message })
    }
  })

  // Confirm a pending Proposal — the ONE structured action that creates a Run.
  // `confirmedBy` is supplied by the SERVER from its trusted context (exactly as
  // `owner` is) and is NEVER read from the request body; there is deliberately no
  // body field a caller could use to name the confirmer.
  router.post('/proposals/:id/confirm', requireServiceToken, (req, res) => {
    try {
      // Resolve authorization ONCE, before anything dispatches. The Run-store
      // Develop dispatch (inside confirmProposal→startRun) is gated by the same
      // authorization (authorizeDispatch=developAuthorized) in run/store.js; the
      // sandbox worker below by workerAuthorized. Under conflict, NEITHER fires.
      // ONE shared confirm domain service. This Bearer entry and the local Owner
      // approval card both call the SAME confirmProposalAction — the authorization read,
      // the Proposal confirm, dispatchStatus, the sandbox-worker schedule and the agent
      // hand-off (with its hash check) exist in exactly one implementation. Nothing is
      // duplicated here and the server never self-HTTPs with HUB_TOKEN.
      //
      // An ordinary confirm carries no agentExecute triple, so approving a normal
      // Proposal is structurally incapable of starting the agent.
      const b = req.body || {}
      const out = confirmService.confirmProposalAction({
        proposalId: req.params.id,
        agentExecute: b.agentExecute,
        workOrder: b.workOrder,
        approvedHash: b.approvedWorkOrderHash,
        entryPoint: 'bearer_token'
      })
      res.status(out.status).json(out.body)
    } catch (err) {
      res.status(err.statusCode || 400).json({ error: err.message })
    }
  })

  // Cancel a pending Proposal. Terminal, and creates NO Run. `cancelledBy` is
  // server-supplied, never read from the body.
  router.post('/proposals/:id/cancel', requireServiceToken, (req, res) => {
    try {
      const proposal = proposalStore.cancelProposal(req.params.id, LOCAL_OWNER)
      res.json(proposal)
    } catch (err) {
      res.status(err.statusCode || 400).json({ error: err.message })
    }
  })

  // ── Human Relay Removal · Phase 1 — return-ready view (READ-ONLY) ─────────────
  // Lists FINISHED (terminal) executions as decision-ready summaries so 心燈 can
  // surface "what came back" without Louie relaying reports. Pure read over
  // durable artifacts + the proposal store (reuses B2-8 buildResultView allowlist);
  // NO dispatch, NO write, NO GO/confirm. Token-free, exactly like /proposals and
  // /proposals/:id/result. Optional pure filters: ?status=succeeded|failed, ?since=<ISO>.
  //
  // ROUTE ORDER IS LOAD-BEARING: both static routes are registered BEFORE the
  // parametric '/proposals/:id' below, so '/proposals/results' is never captured
  // as a proposal :id. GET /return-ready is canonical; /proposals/results is an alias.
  function returnReadyHandler (req, res) {
    const store = workerDeps && workerDeps.artifactStore
    if (!store) return res.status(503).json({ error: 'result store unavailable' })
    try {
      const filters = { status: req.query.status, since: req.query.since }
      res.json(buildReturnReadyList({ artifactStore: store, proposalStore, filters }))
    } catch (_) {
      return res.status(500).json({ error: 'failed to build return-ready view' })
    }
  }
  router.get('/return-ready', returnReadyHandler) // canonical
  router.get('/proposals/results', returnReadyHandler) // alias — MUST precede '/proposals/:id'

  // Read endpoints so the UI can show persisted Proposals (read-only, no Run,
  // no token).
  router.get('/proposals', (req, res) => res.json(proposalStore.listProposals()))
  router.get('/proposals/:id', (req, res) => {
    const proposal = proposalStore.getProposal(req.params.id)
    if (!proposal) return res.status(404).json({ error: 'not found' })
    res.json(proposal)
  })

  // B2-1d: read a confirmed proposal's execution result (READ-ONLY, no token, no
  // worker call). Keyed by proposalId (the id the frontend already holds). The
  // response is an allowlist projection — it never carries the prompt, sandbox
  // paths, or any unknown artifact field. 400 malformed id · 404 unknown ·
  // 200 pending/running/succeeded/failed · 500 controlled (unreadable artifact).
  router.get('/proposals/:id/result', (req, res) => {
    const proposalId = req.params.id
    if (!validateProposalId(proposalId)) {
      return res.status(400).json({ error: 'invalid proposal id' })
    }
    const store = workerDeps && workerDeps.artifactStore
    if (!store) return res.status(503).json({ error: 'result store unavailable' })
    try {
      const { execution, malformed: taskMalformed } = findExecutionByProposalId(store, proposalId)
      const proposal = proposalStore.getProposal(proposalId)

      if (!execution) {
        if (!proposal) {
          // Nothing known — unless a corrupt task file could have hidden it.
          if (taskMalformed > 0) return res.status(500).json({ error: 'a stored record is unreadable' })
          return res.status(404).json({ error: 'not found' })
        }
        // Proposal exists, no execution yet (worker off / not started).
        return res.json(buildResultView({ proposalId, execution: null, result: null, proposal }))
      }

      const { result, malformed: resultMalformed } = findResultByTaskId(store, execution.id)
      // No matching result AND a corrupt result file exists → the answer might be
      // unreadable; surface a controlled error rather than a misleading 'running'.
      if (!result && resultMalformed > 0) {
        return res.status(500).json({ error: 'a stored result is unreadable' })
      }
      return res.json(buildResultView({ proposalId, execution, result, proposal }))
    } catch (_) {
      // Controlled, path-free error — never leak internals.
      return res.status(500).json({ error: 'failed to read result' })
    }
  })

  return router
}

/**
 * Build an Express app.
 *
 * @param {{ dispatcher?: function, proposalPersistence?: (string|false|object) }} [options]
 *   dispatcher — optional override for the Run Store's background dispatcher.
 *     Defaults to the production dispatcher, which routes through the REAL
 *     Claude Code adapter. Tests inject an inert dispatcher so no worker runs.
 *   proposalPersistence — optional override for the Proposal Store's durable
 *     backend (see createProposalStore). Defaults to the production file
 *     (data/aroma-proposals.json); tests pass `false` for an isolated in-memory
 *     store, or a temp-dir path, so they never collide on the shared file.
 *   serviceToken — B2-15 explicit auth injection. When a non-empty string is
 *     given, privileged routes are guarded by exactly that token (a deliberately
 *     configured expected token). Omitted in production → the middleware falls
 *     back to readExpectedToken() and fails CLOSED (401) if HUB_TOKEN is unset.
 * @returns {import('express').Express}
 */
function createApp (options = {}) {
  const opts = options || {}

  // B2-9 flag-scope containment. The productionDispatcher (real-repo Claude
  // Develop) is NO LONGER the implicit default. A real Develop dispatcher exists
  // ONLY when either (a) explicitly injected via opts.dispatcher (tests do this),
  // or (b) explicitly configured via opts.useProductionDispatcher === true AND
  // DEVELOP_DISPATCH === 'on'. Otherwise no real dispatcher is built at all (no
  // backendRoot binding, no develop.js reachability). An inert DI floor stands in
  // so the Run Store always has a function, but the authorization gate returns
  // BEFORE invoking it on the unauthorized path — it is never actually called.
  const injectedDispatcher = typeof opts.dispatcher === 'function' ? opts.dispatcher : null
  const configuredProductionDispatcher = (opts.useProductionDispatcher === true && resolveDevelopDispatch() === 'on')
    ? productionDispatcher
    : null
  const developDispatcher = injectedDispatcher || configuredProductionDispatcher // may be null
  const dispatcherConfigured = developDispatcher !== null
  const inertDispatcher = async () => {} // DI safety floor — never invoked on the unauthorized path

  // AGENT BRIDGE WIRING v1 — mirrors the Develop-dispatcher containment above. The
  // runner is built ONLY when AGENT_BRIDGE resolves exactly 'on' (or a test injects
  // one); with the flag unset/empty/invalid nothing is constructed, so
  // agentRunnerConfigured stays false and agentBridgeAuthorized can never be true.
  // Construction is deliberately the WHOLE of this step: no route invokes runner.run()
  // — the sole trigger remains the token-gated POST /proposals/:id/confirm, and it
  // cannot carry an approved Work Order until the Work Order producer and approval
  // surface exist. So this makes the bridge REACHABLE, not executable.
  // ── THE ARTIFACT STORE, BUILT ONCE, BEFORE ANYTHING THAT NEEDS IT ───────────
  // CAP 7 REGRESSION (found by the first real canary, fixed here). The agent runner used
  // to be handed `opts.workerDeps && opts.workerDeps.artifactStore` — the INJECTED deps,
  // which are undefined in the real assembly. The real workerDeps (and its artifact
  // store) were only built ~60 lines later, so in production artifactStore was undefined,
  // the runner's auditLog was null, and the first canary executed with NO audit record at
  // all. Tests never caught it because every test injects an artifactStore.
  //
  // The fix is ordering, not a new object: ONE store is constructed here and shared by
  // the agent runner, the sandbox worker and the read endpoints — which is what the
  // comment on workerDeps always claimed. An injected workerDeps still wins, so tests and
  // fakes behave exactly as before.
  const sharedArtifactStore = (opts.workerDeps && 'artifactStore' in opts.workerDeps)
    ? opts.workerDeps.artifactStore
    : (() => {
        // A4: the artifact root may be redirected OUTSIDE the immutable release via
        // AROMA_ARTIFACT_DIR. Unset -> the historical release-relative `.aroma`. An
        // invalid explicit value fails closed HERE, before any store exists and therefore
        // before any artifact write. The raw value is never echoed.
        const artifactRoot = resolveArtifactDir(process.env, path.resolve(__dirname, '..', '.aroma'))
        if (!artifactRoot.ok) {
          throw new Error('[AROMA-HUB] FATAL: ARTIFACT_DIR_INVALID — AROMA_ARTIFACT_DIR must be an absolute Windows path (' +
            artifactRoot.reason + '). Refusing to construct the artifact store (fail-closed; no write).')
        }
        return createArtifactStore({ baseDir: artifactRoot.dir })
      })()

  const injectedAgentRunner = (opts.agentRunner && typeof opts.agentRunner.run === 'function') ? opts.agentRunner : null
  let builtAgentRunner = null
  if (!injectedAgentRunner && resolveAgentBridge() === 'on') {
    try {
      builtAgentRunner = createAgentRunner({
        repoRoot: path.resolve(__dirname, '..'),
        // ⛔ RB1 — THE ROOT AND THE IDENTITY ARE DECIDED IN THE SAME BREATH, HERE, ONCE.
        //    The root says WHERE on this machine; the identity says WHICH repository. They
        //    are set together so they cannot drift apart, and the runner refuses any order
        //    naming a different repository. Widening this to a second repository is RB2 and
        //    needs a machine-local binding that deliberately does not exist yet.
        projectId: EXECUTABLE_IDENTITY.projectId,
        repoFullName: EXECUTABLE_IDENTITY.repoFullName,
        artifactStore: sharedArtifactStore, // CAP 7: the REAL store, so an audit record is always written
        // P1-C1c. TWO sinks, and only one of them is lifecycle truth. The memory cache
        // keeps every phase for the live card; the CANONICAL Run learns exactly one
        // thing — that the worker was actually invoked.
        //
        // ⛔ ONLY 'running'. 'preparing' is a clone that may still be refused, and a
        //    credential refusal emits 'failed' having never spawned anything; writing
        //    AGENT_RUNNING for either would put "the agent ran" on the durable record
        //    of an attempt that never did.
        onPhase: (id, phase, runId) => {
          try { ownerApprovalStore.recordPhase(id, phase) } catch (_) {}
          if (phase !== 'running' || !runId) return
          // appendAgentStage is append-only and already refuses a duplicate on a
          // terminal Run; the runner emits 'running' once per attempt.
          try { runStore.appendAgentStage(runId, 'AGENT_RUNNING', { approvalId: id }) } catch (_) {}
        }
      })
    } catch (err) {
      // Fail-closed: a runner that cannot be assembled leaves the lane unauthorized.
      console.warn('[agent-bridge] runner not constructed: ' + ((err && err.message) || String(err)))
      builtAgentRunner = null
    }
  }
  const agentRunner = injectedAgentRunner || builtAgentRunner
  const agentRunnerConfigured = agentRunner !== null

  const authorize = () => resolveExecutionAuthorization(dispatcherConfigured, agentRunnerConfigured)

  // B2-15 auth injection seam. The service-token middleware is built PER APP. In
  // production nothing is injected → the resolver defaults to readExpectedToken()
  // → fail-closed (401) when HUB_TOKEN is unset. Tests pass an explicit
  // opts.serviceToken so privileged routes are guarded by a DELIBERATELY-configured
  // token — never a hidden fallback. Global process.env is never mutated.
  const injectedServiceToken = (typeof opts.serviceToken === 'string' && opts.serviceToken.length > 0)
    ? opts.serviceToken
    : null
  const requireServiceToken = createRequireServiceToken(
    injectedServiceToken ? { resolveToken: () => injectedServiceToken } : {}
  )

  const app = express()

  // The Run Store — the asynchronous seam between an HTTP request and the worker.
  // Its background dispatch is gated by the execution-authorization gate: when
  // Develop is not authorized (the default), scheduleDispatch NEVER invokes the
  // dispatcher (see run/store.js). So a confirm triggers NO real dispatch unless
  // Develop is explicitly authorized (flag on + dispatcher configured).
  const runStore = createRunStore({
    resolveOwner: () => LOCAL_OWNER,
    dispatcher: developDispatcher || inertDispatcher,
    authorizeDispatch: () => authorize().developAuthorized,
    // B2-10: durable Run store. Default is the production file
    // (data/aroma-runs.json); tests pass `false` for an isolated in-memory store,
    // or a temp-dir path, so they never collide on the shared file.
    persistence: opts.runPersistence
  })

  // The Proposal Store shares this app's Run Store. `owner`/`confirmedBy` are
  // resolved from the SERVER's trusted context (LOCAL_OWNER) exactly as the Run
  // Store already resolves `owner` — never from a request body or a language model.
  const proposalStore = createProposalStore({
    runStore,
    resolveOwner: () => LOCAL_OWNER,
    persistence: opts.proposalPersistence
  })

  // B2-1 worker dependencies — built ONCE here at the composition root,
  // overridable via opts.workerDeps for test injection. Constructed regardless of
  // the flag (cheap, no process spawned); the flag only gates whether the confirm
  // handler triggers them. proposalStore is exposed on app.locals so tests can
  // seed a proposal to confirm.
  const workerDeps = opts.workerDeps || {
    // THE SAME instance the agent runner received above. One store, so the sandbox
    // worker's writes, the agent's audit records and the read endpoints all see exactly
    // the same artifacts — which is what this comment always claimed, but the agent
    // runner used to be handed `undefined` instead (see sharedArtifactStore above).
    artifactStore: sharedArtifactStore,
    runner: createWorkerRunner({ worker: createClaudeWorker(), artifactStore: sharedArtifactStore })
  }

  app.locals.proposalStore = proposalStore
  app.locals.workerDeps = workerDeps
  app.locals.runStore = runStore // B2-11b: exposed for startup reconcile (index.js) + tests

  // ── ONE shared confirm service + the server-authoritative approval state ──────
  // Owner's non-negotiable principle: the browser expresses INTENT; it is NEVER the
  // authority source for a Work Order. So there is exactly ONE confirm implementation
  // (confirmService — the only `agentRunner.run(` call site in the repo) and exactly ONE
  // place a Work Order can be read from for execution (ownerApprovalStore's sealed,
  // write-once records). The Bearer route and the local Owner card both call the SAME
  // service in-process; the server never HTTPs itself and HUB_TOKEN never leaves it.
  const approvalAuditLog = []
  const approvalAudit = (entry) => {
    // Every approval ATTEMPT is recorded — accepted, refused or expired — with ids and
    // enums only. Never a token, never a header, never Work Order content.
    const rec = {
      at: new Date().toISOString(),
      approvalId: (entry && entry.approvalId) || null,
      outcome: (entry && entry.outcome) || 'unknown',
      reason: (entry && entry.reason) || null,
      entryPoint: (entry && entry.entryPoint) || 'unknown'
    }
    approvalAuditLog.push(rec)
    if (approvalAuditLog.length > 500) approvalAuditLog.shift()
    console.log('[owner-approval] ' + JSON.stringify(rec))

    // ── AND DURABLY, IN THE TRUTH STORE ───────────────────────────────────
    //
    // The array above is a convenience buffer: it answers 「what happened just now」 cheaply
    // and is what /approvalAuditLog serves. It is NOT the record. It caps at 500, it dies
    // with the process, and the console line dies with the log file — so an approval
    // decision survived only as long as a rotation. The Owner's first principle is that
    // operational truth is permanent and conversations are temporary; this was on the wrong
    // side of that line, and the REFUSED attempts had no other record anywhere at all.
    //
    // WRAPPED, AND DELIBERATELY SO. The trail must not become a new way for an approval to
    // fail. If the store cannot be written, the failure is reported here and the Owner's
    // decision still completes — a lost audit line is bad, an approval that throws in his
    // face mid-decision is worse.
    try {
      // The router speaks in OUTCOMES; the store speaks in lifecycle TYPES. Mapped here,
      // explicitly, so a new outcome does not silently land in the durable record under a
      // type nobody queries — an unmapped outcome is refused by the store and warned about.
      const TYPE_OF = {
        sealed: 'sealed',
        approved: 'approved',
        approved_not_dispatched: 'approved',
        rejected: 'rejected',
        cancelled: 'cancelled',
        expired: 'expired',
        executed: 'executed',
        refused: 'refused'
      }
      const written = recordApprovalEvent({
        type: TYPE_OF[rec.outcome] || rec.outcome,
        approvalId: rec.approvalId,
        proposalId: (entry && entry.proposalId) || null,
        workOrderHash: (entry && entry.workOrderHash) || null,
        actor: LOCAL_OWNER,
        reason: rec.reason,
        entryPoint: rec.entryPoint
      })
      if (!written.ok) console.warn('[owner-approval] durable write refused: ' + written.error)
    } catch (err) {
      console.warn('[owner-approval] durable write FAILED: ' + ((err && err.message) || String(err)))
    }
  }
  app.locals.approvalAuditLog = approvalAuditLog

  const scheduleWorker = createScheduleWorker({ runStore, proposalStore, workerDeps, authorizeExecution: authorize })
  const confirmService = createConfirmService({
    proposalStore,
    authorize,
    agentRunner,
    scheduleWorker,
    owner: LOCAL_OWNER,
    auditFn: approvalAudit,
    // LAYER 2 sink — inert. Records what the runner reported so the Owner can be SHOWN the
    // outcome; it authorizes nothing. Resolved lazily because the store is built just below.
    recordResult: (id, r) => ownerApprovalStore.recordResult(id, r),
    recordExecutionStart: (id, f) => ownerApprovalStore.recordExecutionStart(id, f),
    // P1-C1c THE CANONICAL LEDGER. The claim gate must be durable before the runner is
    // called, and the lane's milestones must land on the Run rather than only in memory.
    // Narrow functions, not the store: this service can claim and record, nothing more.
    claimAgent: (runId, facts) => runStore.claimAgent(runId, facts),
    appendAgentStage: (runId, stage, facts) => runStore.appendAgentStage(runId, stage, facts)
  })
  const ownerApprovalStore = createOwnerApprovalStore(opts.ownerApprovalStoreOptions || {})
  app.locals.ownerApprovalStore = ownerApprovalStore

  // ── Middleware ────────────────────────────────────────────────────────────────
  app.use(express.json({ limit: '50kb' }))
  app.use(express.urlencoded({ extended: false }))

  // ── OWNER AUTHENTICATION ──────────────────────────────────────────────────────
  // Until this existed, the ONLY thing protecting the Owner's data was the loopback
  // bind: GET /api/v1/context/recent handed ~6,000 characters of live Gmail, Drive,
  // Calendar and GitHub excerpts to any caller, and both intake routes would spend money
  // on a model call for an anonymous one.
  //
  // Defined HERE, above the first gated mount, so one gate covers demo, context and
  // intake rather than three that could drift apart. The login surface is mounted
  // OUTSIDE the gate — otherwise the only way to log in would be to already be logged in.
  //
  // It does NOT touch the approval defences. Exact Origin, exact Host, loopback socket
  // peer, Sec-Fetch-Site, the approval router's own session, the one-time bound nonce and
  // the typed EXECUTE all remain exactly as they were; this only decides who reaches the
  // routes at all, and uses a separate cookie name so neither session can stand in for
  // the other.
  // Same injection discipline as the service token above: tests pass an explicit
  // opts.ownerPassword so the gate is configured DELIBERATELY, and global process.env is
  // never mutated. Production injects nothing → the resolver reads AROMA_OWNER_PASSWORD
  // and fails closed when it is unset.
  const injectedOwnerPassword = (typeof opts.ownerPassword === 'string' && opts.ownerPassword.length > 0)
    ? opts.ownerPassword
    : null
  const resolveOwnerPassword = injectedOwnerPassword ? () => injectedOwnerPassword : readOwnerPassword
  const ownerConfigured = injectedOwnerPassword ? () => true : () => ownerPasswordConfigured()

  const ownerSessions = opts.ownerSessions || createSessionStore()
  app.locals.ownerSessions = ownerSessions
  app.use(createOwnerAuthRouter({ sessions: ownerSessions, isConfigured: ownerConfigured, resolvePassword: resolveOwnerPassword }))

  // A browser asking for a PAGE is sent to the login form; anything else gets a plain 401
  // it can act on. A machine caller may present the service token instead — the proposal
  // bridge is not a browser and already holds a credential of the same standing.
  const requireOwner = createRequireOwner({
    sessions: ownerSessions,
    isConfigured: ownerConfigured,
    // Resolve the token through the SAME seam the privileged routes use (opts.serviceToken
    // in tests, readExpectedToken() in production). Reading the env directly here would
    // make the gate and the routes behind it disagree about which token is valid.
    serviceTokenOk: (req) => {
      const h = req.headers.authorization
      const expected = injectedServiceToken || readExpectedToken()
      return typeof h === 'string' && h.startsWith('Bearer ') &&
        typeof expected === 'string' && expected.length > 0 && h.slice(7) === expected
    },
    onUnauthenticated: (req, res) => {
      const wantsHtml = typeof req.headers.accept === 'string' && req.headers.accept.includes('text/html')
      if (wantsHtml && req.method === 'GET') {
        return res.redirect(302, '/owner/login?next=' + encodeURIComponent(req.originalUrl || '/demo'))
      }
      return res.status(401).json({ error: 'owner_auth_required' })
    }
  })

  // ── Routes ────────────────────────────────────────────────────────────────────

  // Health check — unprefixed and open, exactly as it is today. The apply script
  // verifies backend health through it, so it must require no credential.
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'aroma-hub',
      version: '0.1.0',
      capability_layer: 'v1',
      /**
       * ⛔ WHICH COMMIT IS RUNNING — unguarded, because a verification script must be able to
       * ask before it has a session. `version` identifies the product and has never changed;
       * this identifies the code, and its absence is why a PASS could be reported against a
       * server two hours older than the fix it was testing.
       */
      bootCommit: BOOT_COMMIT,
      bootedAt: BOOTED_AT,
      timestamp: new Date().toISOString()
    })
  })

  // M1: Intake endpoint (COO Brain)
  // Mounted into the hub app at /api/v1/intake (per task spec AO-001)
  // Owner-gated: this route makes a paid model call, and had no credential of any kind.
  // The gate admits the service token too, so /api/v1/intake/tasks below — which matches
  // this mount first — keeps working for its existing machine caller.
  app.use('/api/v1/intake', requireOwner, intakeRouter)

  // B2-7 intake Task → Proposal bridge (PROMOTE ONLY). State-changing, so it is
  // token-guarded like the other proposal-mutation routes. It builds + binds a
  // Proposal and sets linkState; it NEVER confirms and NEVER starts a worker —
  // POST /proposals/:id/confirm remains the sole execution-authorization point.
  app.use('/api/v1/intake/tasks', requireServiceToken, createProposalBridgeRouter({ store, proposalStore }))

  // ── B2-2 Conversation Demo — flag-gated activation (default OFF). When OFF, NO
  //    locals are set → intakeRouter passes NO opts → processIntake is unchanged.
  //    When ON, expose a DOMAIN-CONTRACT promote wrapper: intakeService never sees
  //    HTTP status/body/router — it gets { ok, proposal } | { ok:false, error }.
  //    `store` (intake Task store) and `proposalStore` are the SAME instances the
  //    bridge above uses; intakeService's persistIntake writes through the SAME
  //    './store/store' module (hubClient requires it), so a persisted taskId
  //    resolves here (store same-source). This creates an official pending
  //    Proposal only — NO Run, NO Worker, no dispatch; confirm stays the sole gate.
  if (resolveConversationDemo() === 'on') {
    app.locals.conversationDemo = true
    // RB1 — `opts.repositoryIdentity` is server-derived by the caller (workRequestRoute)
    // and simply carried through. Callers with no identity (Lane-1 develop) pass none.
    app.locals.promoteToProposal = async (taskId, opts = {}) => {
      try {
        const r = await promoteTaskToProposal({
          store,
          proposalStore,
          taskId,
          repositoryIdentity: (opts && opts.repositoryIdentity) || null
        })
        if (r.status === 200 && r.body && r.body.proposalId) {
          const proposal = proposalStore.getProposal(r.body.proposalId)
          if (!proposal) {
            // Never surface { ok:true, proposal:undefined } — the id must resolve
            // to a real governance record, else it is a fail-visible integrity error.
            return { ok: false, error: { code: 'proposal_record_missing', message: `promoted proposalId ${r.body.proposalId} has no official record` } }
          }
          return { ok: true, proposal } // state from the OFFICIAL record only
        }
        return { ok: false, error: { code: 'promote_rejected', message: (r.body && r.body.error) || `status ${r.status}` } }
      } catch (err) {
        return { ok: false, error: { code: 'promote_error', message: err && err.message ? err.message : String(err) } }
      }
    }
  }

  // Worker Dispatcher — real workers + live dispatch status
  app.get('/api/v1/workers', (req, res) => {
    const dsp = store.listDispatches()
    const workers = listWorkers().map(w => {
      const active = dsp.filter(d => d.worker_id === w.id && !['completed', 'failed'].includes(d.status))
      return { ...w, active_count: active.length }
    })
    res.json({ executive: getExecutive(), workers })
  })
  app.get('/api/v1/dispatches', (req, res) => {
    res.json(store.listDispatches().map(d => ({ ...d, status_label: statusLabel(d.status) })))
  })
  app.get('/api/v1/dispatch/:id', (req, res) => {
    const d = store.getDispatch(req.params.id)
    if (!d) return res.status(404).json({ error: 'not found' })
    res.json({ ...d, status_label: statusLabel(d.status) })
  })

  // M1 read endpoints — so the UI can show persisted truth
  app.get('/api/v1/decisions', (req, res) => res.json(store.listDecisions()))
  app.get('/api/v1/tasks', (req, res) => res.json(store.listTasks()))
  app.get('/api/v1/events', (req, res) => res.json(store.listEvents()))
  app.get('/api/v1/llm-usage/summary', (req, res) => res.json(store.usageSummary()))

  // ── Aroma OS routes — mounted on BOTH the unprefixed path and the /api/v1 twin ──
  // Existing scripts keep hitting the unprefixed routes; the browser reaches the
  // same handlers through the proxy under /api/v1.
  const aromaRouter = createAromaRouter({ runStore, proposalStore, workerDeps, authorize, requireServiceToken, confirmService })
  app.use('/', aromaRouter)
  app.use('/api/v1', aromaRouter)

  // R4c-F1 pre-terminal mount hook (OPT-IN). When a caller supplies
  // opts.mountExtraRoutes (a function), it runs HERE — after the normal routes and
  // BEFORE the terminal 404 — so an entrypoint can add its own routes ahead of the
  // catch-all. Ordinary createApp() calls pass no hook and behave identically to
  // before. It is NOT driven by any request/header/user input, and the primary
  // process never supplies it, so the primary never gains those routes.
  if (typeof opts.mountExtraRoutes === 'function') opts.mountExtraRoutes(app)

  // B2-2 Conversation Demo UI — GET /demo + POST /api/v1/demo/intake. ALWAYS mounted
  // but guard-first: 403 {error:'demo_disabled'} when app.locals.conversationDemo !== true.
  // Mounted here, before the terminal 404, so the guarded routes resolve.
  // PATH-SCOPED, NOT PATHLESS. `app.use(requireOwner, router)` with no path runs the gate
  // on EVERY request that reaches this point — including the approval routes mounted
  // below, which it would then answer 503 for. That is precisely the thing this change is
  // required not to do, so the gate is bound to the paths it protects and nothing else.
  //
  // /manifest.webmanifest is deliberately NOT gated: it holds no secret (a name, two
  // colours and the dot), and Chrome fetches a manifest WITHOUT credentials, so
  // gating it would break installing the app for no gain.
  app.use('/demo', requireOwner)
  app.use('/api/v1/demo', requireOwner)
  // Conversation History v1 lives on the demo router and is gated the same way — same
  // owner session, same loopback. It holds conversation text, so it is never less
  // protected than the page that draws it.
  app.use('/api/v1/conversations', requireOwner)
  // THE REAL STORE IS PASSED HERE, BY NAME, AND NOWHERE ELSE. The router's default is
  // inert, so production is the only place that gets a writer — a test driving this route
  // cannot reach the Owner's data directory even by forgetting to inject.
  // ── THE WAITING-INVOICES LINE ────────────────────────────────────────────
  // Read-only, and gated by the SAME flag as every other Drive read: with READ_ACCESS off
  // no reader is injected at all, so the greeting behaves exactly as it did before.
  // Cached briefly — the number moves in hours, and the greeting is fetched per empty
  // screen. The route timeboxes and swallows failures; nothing here can break the screen.
  let backlogCache = { at: 0, value: null }
  const refreshBacklog = async () => {
    const { readInvoiceBacklog } = require('./context/invoiceBacklog')
    const { credsPresent, service } = require('./context/googleAuth')
    const drive = credsPresent() ? service('drive', 'v3') : null
    const value = await readInvoiceBacklog({ drive })
    backlogCache = { at: Date.now(), value }
    return value
  }
  const readBacklogFn = async () => {
    if (backlogCache.value && Date.now() - backlogCache.at < 5 * 60 * 1000) return backlogCache.value
    return refreshBacklog()
  }
  // The turns of an investigation: stored always, surfaced never. Opening one is a
  // deliberate second step — putting them in front of him by default would recreate exactly
  // the relay the dispatch path removes.
  app.use(createEnquiryRouter({ enquiryStore: createEnquiryStore() }))

  // ── 首頁 ────────────────────────────────────────────────────────────────────
  // What she ran, what waits on him, and the Drive line — the surface the design has
  // specified for two rounds and that nothing rendered. Mounted HERE, on the real
  // composition root, and `homeWiringSmoke.test.js` fails if this line is removed.
  // ONE errand store, shared by 首頁's routes and by the demo router's section attachment —
  // so the lines he is shown and the lines that travel are read from the same file.
  const homeErrandStore = openErrandStore(path.join(__dirname, '..', 'data', 'home'))
  mountHomeRoutes(app, {
    store: homeErrandStore,
    profileDir: 'C:\\Aroma\\browser-profile',
    // DEFECT-011: this was missing, so the Drive section reported NOT_CHECKED — a calm,
    // grammatical, timestamped sentence produced by a wire that was never connected. The
    // SAME reader the greeting already uses, gated the same way.
    //
    // ⚠ AND IT NEEDS AN ADAPTER, which the first fix omitted: `readBacklogFn` returns the raw
    // reading; the Owner-facing SENTENCE comes from `sentenceFor`, and the reading's
    // `checkedAt` is an ISO string while the briefing stamps milliseconds. Wiring it without
    // this produced `state: PRESENT` with NO LINE and NO TIME — the wire connected and the
    // section still saying nothing.
    backlogReader: process.env.READ_ACCESS !== 'on'
      ? null
      : async () => {
          const { sentenceFor } = require('./context/invoiceBacklog')
          const r = await readBacklogFn()
          const line = sentenceFor(r)
          const checkedAt = r && r.checkedAt ? new Date(r.checkedAt).getTime() : undefined
          // `sentenceFor` returns null only for 「the feature is off」 — which is not a read.
          if (!line) return null
          // The reader declares its OWN freshness expectation: this value is served from a
          // 5-minute cache, so five minutes is when its age starts to mean something. The
          // briefing shows a per-section time only past that. See briefing.js stamped().
          return { line, checkedAt, freshWithinMs: 5 * 60 * 1000 }
        },

    // ── the scheduled door, and the two witnesses ────────────────────────────
    //
    // ⛔ THE SERVICE TOKEN, NOT THE OWNER SESSION. A schedule is his absence, so the trigger
    // authenticates as a service. `requireServiceToken` fails CLOSED (401) when HUB_TOKEN is
    // unset — and the PowerShell hydrates that token from the environment at run time, so the
    // registered task definition contains no secret at all.
    serviceGuard: requireServiceToken,

    // ⛔ EVERY KNOCK, SERVER SIDE. On 2026-08-07 this door was hit six times in 45 minutes and
    // three of those left no trace on the server at all — the only log was the PowerShell
    // wrapper's, client side. A door that records nothing cannot tell 「nobody called」 from
    // 「I did not look」.
    knockLog: require('./governance/knockLog').openKnockLog(path.join(__dirname, '..', 'data', 'home')),
    // HR-34 one level up: the pacing rule spaced searches WITHIN a run and nothing governed
    // how often the run happened. A daily errand never needs to run twice in an hour.
    minRunIntervalMs: 60 * 60 * 1000,

    // ⛔ THE READ-ONLY ALLOWLIST, WIRED HERE AND NOWHERE ELSE.
    // The timer can run exactly what is in this object AND declared `readOnly` in the registry.
    // Adding a key here is adding it to the timer, and the Owner's ruling is that nothing else
    // joins without its own GO. The recall check qualifies: public register, no login, no
    // writes, no dispatch, no paid model calls, $0.00.
    scheduledRunners: {
      recall: async () => {
        const { runRecallForIngredients } = require('./errands/recallRunner')
        return runRecallForIngredients()
      }
    },

    // WITNESS #1. Read here because it costs a subprocess; buildBriefing stays pure.
    witnessReader: async () => {
      const { readSchedulerWitness } = require('./home/schedulerWitness')
      return readSchedulerWitness({})
    }
  })

  app.use(createDemoRouter({
    conversationStore: realConversationStore,
    readBacklogFn: process.env.READ_ACCESS === 'on' ? readBacklogFn : null,
    // ⛔ Round B: the section attachment is RE-DERIVED server-side from this store. The browser
    // sends a section id and never the lines — see demoRouter's attachSection block.
    errandStoreFn: () => homeErrandStore
  }))

  // PRIME THE CACHE ONCE AT STARTUP so the FIRST greeting after a restart is already warm.
  // Without this the first render pays the full Drive round-trip, and that is exactly the
  // render most likely to be the Owner opening the page right after a restart. Fire and
  // forget: a failure here is a cold cache, never a failed boot.
  if (process.env.READ_ACCESS === 'on') {
    setTimeout(() => { refreshBacklog().catch(() => {}) }, 500).unref()
  }

  // Read Context v1 inspection routes — GET /api/v1/context/health and .../recent.
  // ALWAYS mounted but guard-first: 403 {error:'read_access_disabled'} unless
  // READ_ACCESS === 'on'. Read-only; no parameterised method endpoint exists.
  // 香香 SETTINGS — GET /settings (page), GET/POST /api/v1/settings.
  // Gated by the SAME owner session as /demo, so the Owner is never asked to log in twice.
  // The write path accepts exactly three keys and a closed list of switch names; nothing
  // the browser invents can become a setting.
  app.use('/settings', requireOwner)
  app.use('/api/v1/settings', requireOwner)
  app.use(createSettingsRouter({ load: loadOwnerSettingsReal, save: saveOwnerSettingsReal }))

  app.use('/api/v1/context', requireOwner)
  app.use(createContextRouter())

  // Local Owner approval card — POST /api/v1/owner/work-orders (seal + surface) and
  // POST /api/v1/owner/approve (four fields only). Not token-gated: it is gated by
  // loopback peer + exact Origin/Host + Sec-Fetch-Site + a server-issued session +
  // a single-use bound nonce + a SERVER-verified typed confirmation. It deliberately
  // does NOT sit behind requireServiceToken, because HUB_TOKEN must never reach the
  // browser. Execution content is loaded from the sealed store, never from the body.
  app.use(createOwnerApprovalRouter({
    store: ownerApprovalStore,
    confirmService,
    proposeWorkOrder,
    buildApprovalView,
    buildAgentResultView,
    sealedHashOf: confirmService.sealedHashOf,
    getProposal: (id) => proposalStore.getProposal(id),
    cancelProposal: (id) => proposalStore.cancelProposal(id, LOCAL_OWNER),
    auditFn: approvalAudit,
    // P1-C1c. approvalId → the canonical Run and its DERIVED status. The router gets a
    // bounded answer and never touches Run internals. A duplicate link is reported as
    // inconsistent rather than resolved first-win, so the surface can fail closed.
    resolveCanonicalRun: (approvalId) => {
      const found = runStore.findByApprovalId(approvalId)
      if (!found.ok) return found
      return { ok: true, runId: found.run.id, status: deriveStatus(found.run) }
    }
  }))

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found', path: req.path })
  })

  // Global error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // Log error type/message only — never log API key or message content
    console.error('[AROMA-HUB] Unhandled error:', err.message)
    res.status(500).json({ error: 'Internal server error' })
  })

  // Read-only introspection seams for unit tests (same pattern as
  // app.resolveConversationDemo). `agentRunner` is exposed so a test can assert it was
  // NOT constructed with the flag off; it is not a route and nothing invokes it.
  app.authorizeExecution = authorize
  app.agentRunnerConfigured = agentRunnerConfigured
  app.agentRunner = agentRunner
  // CAP 7 observability: true only when the runner really has an artifact store to write
  // its append-only audit records to. Asserted against the REAL composition root.
  app.agentAuditConfigured = !!(agentRunner && agentRunner.auditConfigured === true)
  app.artifactStore = sharedArtifactStore

  return app
}

// Default export stays the ready-to-listen app instance so index.js is unchanged;
// createApp is attached for tests that need an isolated, injectable app.
const app = createApp()
app.createApp = createApp
// B2-9: exposed for unit tests (pure, no side effects).
app.resolveDevelopDispatch = resolveDevelopDispatch
app.resolveWorkerInvocation = resolveWorkerInvocation
app.resolveExecutionAuthorization = resolveExecutionAuthorization
app.resolveConversationDemo = resolveConversationDemo // B2-2: exposed for unit tests (pure)

module.exports = app
