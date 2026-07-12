'use strict'

/**
 * index.js — server entry point.
 *
 * Imports the app from app.js and starts the HTTP server.
 * Separated from app.js so tests can import app without binding a port.
 */

const app = require('./app')

const PORT = process.env.PORT || 8081

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

startupReconcile()

app.listen(PORT, () => {
  console.log(`[AROMA-HUB] Listening on port ${PORT}`)
  console.log(`[AROMA-HUB] LLM provider: ${process.env.LLM_PROVIDER || 'claude'}`)
  // NEVER log the API key
})
