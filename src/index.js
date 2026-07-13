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
const { resolveConnectorProjection } = require('./connector/connectorConfig')
const { readBackendReadIdentity } = require('./connector/backendReadIdentity')

const PORT = process.env.PORT || 8081

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

assertServiceTokenConfigured() // B2-15 — fail-fast BEFORE binding the port

// Phase 2 Gate 1 — fail-fast ONLY when the connector flag is on AND its dedicated
// read identity is unconfigured. Flag off (default) → no-op → existing startup unchanged.
function assertConnectorConfig () {
  if (resolveConnectorProjection() === 'on' && !readBackendReadIdentity()) {
    console.error('[AROMA-HUB] FATAL: CONNECTOR_PROJECTION is on but BACKEND_READ_IDENTITY is not configured. ' +
      'Refusing to start — the connector projection endpoint would be unauthenticated.')
    process.exit(1)
  }
}
assertConnectorConfig()
startupReconcile()

app.listen(PORT, () => {
  console.log(`[AROMA-HUB] Listening on port ${PORT}`)
  console.log(`[AROMA-HUB] LLM provider: ${process.env.LLM_PROVIDER || 'claude'}`)
  // NEVER log the API key
})

startupSandboxSweep() // after listen — never blocks boot
