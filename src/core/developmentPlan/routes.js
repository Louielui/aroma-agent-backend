'use strict'
const express = require('express')
const { sameOrigin } = require('../operating/chatRequest')
const { ID } = require('../operating/runStore')
const { buildHtml } = require('./view')
function createDevelopmentPlanRouter ({ service }) {
  const router = express.Router(), owner = { id: 'owner', role: 'owner' }
  router.get('/development-plan', (req, res) => res.set('Cache-Control', 'no-store').type('html').send(buildHtml()))
  router.get('/api/v1/development-plan', (req, res) => {
    try { res.set('Cache-Control', 'no-store').json({ workOrder: service.workOrder, runs: service.list(owner) }) }
    catch (_) { res.status(503).json({ error: 'status_unavailable' }) }
  })
  router.get('/api/v1/development-plan/:id', (req, res) => {
    if (!ID.test(req.params.id || '')) return res.status(400).json({ error: 'invalid_run_id' })
    try { const run = service.get(owner, req.params.id); res.set('Cache-Control', 'no-store').status(run ? 200 : 404).json({ run }) }
    catch (_) { res.status(503).json({ error: 'status_unavailable' }) }
  })
  router.post('/api/v1/development-plan', async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'same_origin_required' })
    const b = req.body, shapes = { start: ['op', 'requestId'], cancel: ['op', 'id'] }
    if (!req.is('application/json') || !b || Array.isArray(b) || !Object.hasOwn(shapes, b.op) || Object.keys(b).sort().join(',') !== shapes[b.op].sort().join(',') || (b.op === 'start' && !ID.test(b.requestId || '')) || (b.op === 'cancel' && !ID.test(b.id || ''))) return res.status(400).json({ error: 'invalid_request' })
    try {
      const run = b.op === 'start' ? service.start(owner, { recipe: 'development-proposal-v1', requestId: b.requestId }) : service.cancel(owner, b.id)
      if (b.op === 'cancel') await service.wait(b.id)
      res.set('Cache-Control', 'no-store').json({ run: b.op === 'cancel' ? service.get(owner, b.id) : run })
    } catch (e) { res.status(e.message === 'worker_busy' ? 409 : 503).json({ error: e.message === 'worker_busy' ? 'worker_busy' : 'workflow_unavailable' }) }
  })
  return router
}
module.exports = { createDevelopmentPlanRouter }
