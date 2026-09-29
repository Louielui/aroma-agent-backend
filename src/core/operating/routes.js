'use strict'
const express = require('express')
const { buildManagerHtml } = require('./view')
function createManagerRouter ({ manager }) {
  const router = express.Router()
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
