'use strict'

/**
 * index.js — server entry point.
 *
 * Imports the app from app.js and starts the HTTP server.
 * Separated from app.js so tests can import app without binding a port.
 */

const app = require('./app')
const { sweepAgedSandboxes } = require('./workers/workspace/tmpdirSandbox')
const { readExpectedToken } = require('./api/auth')
const { evaluateStartupConfig } = require('./persona/processRole') // R4a — memory-free startup guard
const { evaluatePrimaryPersonaStartup } = require('./persona/primaryPersonaStartupGuard') // Runtime Guard — hybrid-primary readiness
const { getPersonaSource } = require('./persona/personaSource') // memory-free import (Memory lazy-loaded only for non-legacy)

const PORT = process.env.PORT || 8081

// R4a PROCESS-ROLE GUARD — runs on the production entry/listen path only, BEFORE
// binding the port. A `primary` process may only use PERSONA_SOURCE=legacy; a
// non-legacy source is allowed solely in an explicit `persona-canary` role. Unknown
// role / source / forbidden combination => refuse to start (no listener, no Memory
// read, no composer load, no model call, no truth/artifact write). Reads env only.
function assertProcessRoleConfigured () {
  const cfg = evaluateStartupConfig(process.env)
  if (!cfg.valid) {
    console.error('[AROMA-HUB] FATAL: invalid persona process configuration — ' + cfg.status +
      '. Refusing to start. (primary requires PERSONA_SOURCE=legacy; non-legacy needs AROMA_PROCESS_ROLE=persona-canary.)')
    process.exit(1)
  }
  console.log('[AROMA-HUB] process role: ' + cfg.processRole + ' | persona source: ' + cfg.personaSourceMode)
}

// RUNTIME GUARD — Memory-readiness gate for a primary process, on the production
// entry/listen path only (never in createApp). Runs AFTER config validation, BEFORE
// listen. A `legacy` primary is allowed WITHOUT touching Memory (memory-free — the
// guard never calls getPersonaSource for legacy). A `hybrid` primary must have a
// fully READY hybrid composer (R1/R2), or we REFUSE TO START — fail-closed, with NO
// silent legacy fallback. It reuses the existing persona-source readiness path and
// re-implements no verifier logic. `PERSONA_SOURCE` is read, never written.
function assertPrimaryPersonaReady () {
  const cfg = evaluateStartupConfig(process.env) // already proven valid by assertProcessRoleConfigured
  const decision = evaluatePrimaryPersonaStartup(cfg, { getPersonaSource })
  if (!decision.allow) {
    console.error('[AROMA-HUB] FATAL: ' + decision.code + ' — persona runtime is not ready for a hybrid primary' +
      (decision.reason ? ' (' + decision.reason + ')' : '') + '. Refusing to start. No silent fallback — ' +
      'set PERSONA_SOURCE=legacy (or unset) to run the frozen legacy persona.')
    process.exit(1)
  }
  console.log('[AROMA-HUB] persona startup guard: ' + decision.code + (decision.memoryRead ? ' (memory read)' : ' (memory-free)'))
}

// B2-15 STARTUP FAIL-FAST — this lives ONLY on the production entry/listen path
// (never in createApp), so tests that build apps via createApp cannot trip it.
// Context is detected BY CODE LOCATION, not NODE_ENV. If no service token is
// configured, refuse to start: a privileged server must never run un-authenticated
// (and must never fall back to a shared literal — auth.js has no fallback).
function assertServiceTokenConfigured () {
  if (!readExpectedToken()) {
    console.error('[AROMA-HUB] FATAL: HUB_TOKEN is not configured. Refusing to start — ' +
      'privileged routes would be unauthenticated. Set HUB_TOKEN in the service environment.')
    process.exit(1)
  }
}

// B2-11b STARTUP RECONCILE — PURE MARK, ZERO DISPATCH. Runs here (server startup)
// rather than inside createApp, so tests that build apps never trigger it. For
// each durable Run it marks the recovered status from the timeline + safe-loaded
// .aroma artifacts; it never dispatches, spawns, or retries (preserves B2-9:
// flag-off = 0 execution). Runs BEFORE listen so recovered state is settled first.
function startupReconcile () {
  const runStore = app.locals && app.locals.runStore
  const artifactStore = app.locals && app.locals.workerDeps && app.locals.workerDeps.artifactStore
  if (!runStore || typeof runStore.reconcile !== 'function' || !artifactStore) return
  const findExecution = (runId) => {
    try { return artifactStore.list('tasks').find(e => e && e.runId === runId) || null } catch (_) { return null }
  }
  const findResult = (executionId) => {
    try { return artifactStore.list('results').find(r => r && r.taskId === executionId) || null } catch (_) { return null }
  }
  try {
    const { reconciled } = runStore.reconcile({ findExecution, findResult })
    console.log(`[AROMA-HUB] startup reconcile: ${reconciled} run(s) marked (no dispatch)`)
  } catch (err) {
    console.error('[AROMA-HUB] startup reconcile error:', err && err.message ? err.message : String(err))
  }
}

// B2-12 STARTUP-ONLY SANDBOX SWEEP — once at boot, best-effort, containment-checked.
// It only removes aged os.tmpdir()/aroma-sandbox-* dirs; never .aroma/data/repo, no
// dispatch, no lifecycle management. Wrapped + called AFTER listen so it can NEVER
// block server startup. No periodic timer, no daemon.
function startupSandboxSweep () {
  try {
    const summary = sweepAgedSandboxes()
    console.log(`[AROMA-HUB] sandbox sweep: scanned=${summary.scanned} deleted=${summary.deleted} skipped=${summary.skipped} errors=${summary.errors}`)
  } catch (err) {
    console.error('[AROMA-HUB] sandbox sweep error (ignored):', err && err.message ? err.message : String(err))
  }
}

assertProcessRoleConfigured() // R4a — fail-closed on invalid role/source BEFORE the port
assertPrimaryPersonaReady() // Runtime Guard — hybrid primary needs a READY composer; legacy stays memory-free
assertServiceTokenConfigured() // B2-15 — fail-fast BEFORE binding the port
startupReconcile()

// B2-2 — INFORMATIONAL ONLY (never blocks startup, never changes runtime): the
// Conversation Demo is on but not on the real reasoning provider, so replies come
// from a stub, not the live Xiang Xiang. Activation tests intentionally run on the
// mock provider, so this stays a warning.
if (process.env.CONVERSATION_DEMO === 'on' && (process.env.LLM_PROVIDER || 'claude') !== 'claude') {
  console.warn('[AROMA-HUB] CONVERSATION_DEMO=on but LLM_PROVIDER=' +
    `${process.env.LLM_PROVIDER} — demo replies come from a non-real provider, not the live Xiang Xiang.`)
}

app.listen(PORT, () => {
  console.log(`[AROMA-HUB] Listening on port ${PORT}`)
  console.log(`[AROMA-HUB] LLM provider: ${process.env.LLM_PROVIDER || 'claude'}`)
  // NEVER log the API key
})

startupSandboxSweep() // after listen — never blocks boot
