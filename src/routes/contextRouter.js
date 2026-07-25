'use strict'

/**
 * contextRouter.js — OPTIONAL read-only inspection routes for Read Context v1, so a
 * source can be queried without spending a chat turn.
 *
 *   GET /api/v1/context/health           → which sources are enabled / registered / skipped
 *   GET /api/v1/context/recent?q=…       → the same bounded, cited context the chat lane
 *                                          would inject, as JSON
 *
 * SAFETY: there is deliberately NO parameterised method endpoint — the route set is
 * fixed, so a caller can never name an adapter method (no method injection). Both
 * routes are READ-only and fail-closed: unless READ_ACCESS === 'on' they return 403
 * and touch nothing. Skip reasons are plain text; no credential value is ever exposed.
 */

const express = require('express')
const { resolveFlag } = require('../context/flags')
const { createLiveReadConnector, enabledSources } = require('../context/liveClients')
const { buildReadContext, CAPS } = require('../context/readContext')

function createContextRouter (deps = {}) {
  const router = express.Router()
  const buildConnector = deps.buildConnector || ((env) => createLiveReadConnector({ env }))
  const build = deps.buildReadContextFn || buildReadContext

  function gate (req, res, next) {
    if (resolveFlag(process.env, 'READ_ACCESS') === 'on') return next()
    return res.status(403).json({ error: 'read_access_disabled' })
  }

  router.get('/api/v1/context/health', gate, (req, res) => {
    try {
      const { registered, skipped } = buildConnector(process.env)
      res.json({ enabled: enabledSources(process.env), registered, skipped, caps: CAPS })
    } catch (err) {
      res.status(500).json({ error: 'context_health_failed', detail: err.message })
    }
  })

  router.get('/api/v1/context/recent', gate, async (req, res) => {
    try {
      const sources = enabledSources(process.env)
      if (sources.length === 0) return res.json({ sources: [], status: 'NO_SOURCES', perSource: [], block: null })
      const { connector } = buildConnector(process.env)
      const rc = await build({ connector, message: String(req.query.q || ''), sources, env: process.env })
      res.json({ sources, status: rc.status, perSource: rc.perSource, block: rc.block })
    } catch (err) {
      res.status(500).json({ error: 'context_read_failed', detail: err.message })
    }
  })

  return router
}

module.exports = { createContextRouter }
