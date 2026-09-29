'use strict'
const express = require('express')
const { buildManagerHtml } = require('./view')
const { buildArchitectureHtml } = require('./architectureView')
function createManagerRouter ({ manager }) {
  const router = express.Router()
  const sameOrigin = require('./chatRequest').sameOrigin
  const owner = { id: 'owner', role: 'owner' }
  router.get('/api/v1/manager/runs', (req, res) => {
    try { res.set('Cache-Control', 'no-store').json({ runs: manager.list() }) }
    catch (_) { res.status(503).json({ error: 'status_unavailable' }) }
  })
  router.get('/api/v1/manager/runs/:id', (req, res) => {
    try { const run = manager.get(req.params.id); res.set('Cache-Control', 'no-store').status(run ? 200 : 404).json({ run }) }
    catch (_) { res.status(503).json({ error: 'status_unavailable' }) }
  })
  router.post('/api/v1/manager/runs', async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'same_origin_required' })
    const b = req.body; const shapes = { start: ['op', 'requestId'], cancel: ['op', 'id'], retry: ['op', 'id'] }
    if (!req.is('application/json') || !b || Array.isArray(b) || !Object.hasOwn(shapes, b.op) || Object.keys(b).some(k => !shapes[b.op].includes(k))) return res.status(400).json({ error: 'invalid_request' })
    try {
      let run
      if (b.op === 'start') {
        if (!require('./runStore').ID.test(b.requestId || '')) return res.status(400).json({ error: 'invalid_request_id' })
        run = manager.start(owner, { requestId: b.requestId })
      } else if (b.op === 'retry') run = manager.retry(owner, b.id)
      else { run = manager.cancel(owner, b.id); run = await manager.wait(run.id) }
      res.set('Cache-Control', 'no-store').json({ run })
    } catch (e) {
      const known = ['briefing_busy', 'invalid_run_id', 'run_not_found', 'run_not_retryable', 'request_conflict']
      res.status(known.includes(e.message) ? 409 : 503).json({ error: known.includes(e.message) ? e.message : 'workflow_unavailable' })
    }
  })
  router.get('/architecture', (req, res) => res.set('Cache-Control', 'no-store').type('html').send(buildArchitectureHtml()))
  router.get('/manager', (req, res) => res.type('html').send(buildManagerHtml()))
  router.get('/api/v1/manager/registry', (req, res) => res.set('Cache-Control', 'no-store').json(manager.registry()))
  router.get('/api/v1/manager/activity', (req, res) => {
    try { res.set('Cache-Control', 'no-store').json({ events: manager.activity(), limit: 100 }) }
    catch (_) { res.status(503).json({ error: 'activity_unavailable' }) }
  })
  router.post('/api/v1/manager/briefing', async (req, res) => {
    const host = req.get('host')
    if (!['127.0.0.1:8090', 'localhost:8090'].includes(host) || req.get('origin') !== 'http://' + host || req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'same_origin_required' })
    if (!req.is('application/json') || !req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length) return res.status(400).json({ error: 'fixed_workflow_only' })
    try { res.set('Cache-Control', 'no-store').json(await manager.briefing({ id: 'owner', role: 'owner' })) }
    catch (error) {
      const code = ['briefing_busy', 'audit_unavailable', 'permission_denied'].includes(error.message) ? error.message : 'briefing_unavailable'
      res.status(code === 'briefing_busy' ? 429 : code === 'permission_denied' ? 403 : 503).json({ error: code })
    }
  })
  return router
}
module.exports = { createManagerRouter }
