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

const os = require('node:os')
const path = require('node:path')

const express = require('express')
const intakeRouter = require('./routes/intakeRouter')
const { createProposalBridgeRouter } = require('./intake/proposalBridge')
const store = require('./store/store')
const { listWorkers, getExecutive } = require('./workers/registry')
const { statusLabel } = require('./dispatch/dispatcher')

// Run Store — the asynchronous seam between an HTTP request and the governed
// worker. See src/run/store.js. deriveStatus derives a Run's status from its
// append-only timeline (a Run never stores a status).
const { createRunStore } = require('./run/store')
const { deriveStatus } = require('./run/run')
const { createDispatcher } = require('./capability/dispatcher')
const { createClaudeCodeAdapter } = require('./adapters/claude-code')

// Conversation → Proposal → Run bridge (COO). Proposing is inert; the ONLY path
// from a Proposal to a Run is the structured confirm action below. See
// src/coo/proposal.js and src/coo/intent.js.
const { createProposalStore } = require('./coo/proposal')
const { getAdapter } = require('./adapters/adapterFactory')

// Service-token authentication for every state-changing route. See src/api/auth.js.
const { requireServiceToken } = require('./api/auth')

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
function createAromaRouter ({ runStore, proposalStore, workerDeps }) {
  const router = express.Router()

  // B2-1: schedule a worker AFTER the confirm response, fire-and-forget. It reads
  // the proposal's own confirm provenance for the Execution Artifact and never
  // blocks or alters the confirm/startRun path. No-op when the flag is off or no
  // worker is wired. Any error is swallowed into a log line — never a late write
  // to an already-sent response, never a process crash.
  function scheduleWorker (proposalId, runId) {
    if (resolveWorkerInvocation() !== 'on' || !workerDeps || !workerDeps.runner) return
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
      res.status(result.intent === 'develop' ? 201 : 200).json(result)
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
      const runId = proposalStore.confirmProposal(req.params.id, LOCAL_OWNER)
      res.status(201).json({ runId })
      scheduleWorker(req.params.id, runId) // B2-1: fire-and-forget, AFTER the response
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
 * @returns {import('express').Express}
 */
function createApp (options = {}) {
  const opts = options || {}
  const dispatcher = typeof opts.dispatcher === 'function' ? opts.dispatcher : productionDispatcher

  const app = express()

  // The Run Store — the asynchronous seam between an HTTP request and the worker.
  const runStore = createRunStore({
    resolveOwner: () => LOCAL_OWNER,
    dispatcher
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
  const workerDeps = opts.workerDeps || (() => {
    // One artifact store, shared by the (write) trigger and the (read) endpoint —
    // the read endpoint's source of truth is exactly what the worker wrote.
    const artifactStore = createArtifactStore({ baseDir: path.resolve(__dirname, '..', '.aroma') })
    return {
      artifactStore,
      runner: createWorkerRunner({ worker: createClaudeWorker(), artifactStore })
    }
  })()
  app.locals.proposalStore = proposalStore
  app.locals.workerDeps = workerDeps

  // ── Middleware ────────────────────────────────────────────────────────────────
  app.use(express.json({ limit: '50kb' }))
  app.use(express.urlencoded({ extended: false }))

  // ── Routes ────────────────────────────────────────────────────────────────────

  // Health check — unprefixed and open, exactly as it is today. The apply script
  // verifies backend health through it, so it must require no credential.
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'aroma-hub',
      version: '0.1.0',
      capability_layer: 'v1',
      timestamp: new Date().toISOString()
    })
  })

  // M1: Intake endpoint (COO Brain)
  // Mounted into the hub app at /api/v1/intake (per task spec AO-001)
  app.use('/api/v1/intake', intakeRouter)

  // B2-7 intake Task → Proposal bridge (PROMOTE ONLY). State-changing, so it is
  // token-guarded like the other proposal-mutation routes. It builds + binds a
  // Proposal and sets linkState; it NEVER confirms and NEVER starts a worker —
  // POST /proposals/:id/confirm remains the sole execution-authorization point.
  app.use('/api/v1/intake/tasks', requireServiceToken, createProposalBridgeRouter({ store, proposalStore }))

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
  const aromaRouter = createAromaRouter({ runStore, proposalStore, workerDeps })
  app.use('/', aromaRouter)
  app.use('/api/v1', aromaRouter)

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

  return app
}

// Default export stays the ready-to-listen app instance so index.js is unchanged;
// createApp is attached for tests that need an isolated, injectable app.
const app = createApp()
app.createApp = createApp

module.exports = app
