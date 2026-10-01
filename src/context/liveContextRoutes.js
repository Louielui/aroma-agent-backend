'use strict'
const express = require('express')
const { sameOrigin } = require('../core/operating/chatRequest')
const { buildLiveContextHtml } = require('./liveContextView')
function createLiveContextRouter ({ service }) {
  const router = express.Router()
  router.get('/live-context', (req, res) => res.set('Cache-Control', 'no-store').type('html').send(buildLiveContextHtml()))
  router.get('/api/v1/live-context', (req, res) => res.set('Cache-Control', 'no-store').json({ capabilities: service.capabilities() }))
  router.get('/api/v1/live-context/activity', (req, res) => {
    try { res.set('Cache-Control', 'no-store').json({ events: service.activity() }) }
    catch (_) { res.status(503).json({ error: 'audit_unavailable' }) }
  })
  router.post('/api/v1/live-context/development', async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'same_origin_required' })
    if (!req.is('application/json') || !req.body || Array.isArray(req.body) || Object.keys(req.body).length) return res.status(400).json({ error: 'fixed_workflow_only' })
    try { res.set('Cache-Control', 'no-store').json({ report: await service.read({ id: 'owner', role: 'owner' }) }) }
    catch (_) { res.status(503).json({ error: 'context_unavailable' }) }
  })
  return router
}
module.exports = { createLiveContextRouter }
