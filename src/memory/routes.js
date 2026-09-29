'use strict'
const express = require('express')
const crypto = require('node:crypto')
const { createHindsight, ID, validText } = require('./hindsight')
function createMemoryRouter ({ client = createHindsight(), capture = null, governed = false } = {}) {
  const router = express.Router(); let busy = false
  const sameOrigin = require('../core/operating/chatRequest').sameOrigin
  router.get('/api/v1/memory/capture', (req, res) => {
    try { res.set('Cache-Control', 'no-store').json(req.query.q ? { results: capture.search(req.query.q) } : capture.status()) }
    catch (_) { res.status(503).json({ error: 'capture_unavailable' }) }
  })
  router.get('/api/v1/memory/capture/:id', (req, res) => {
    try { const entry = capture.get(req.params.id); res.set('Cache-Control', 'no-store').status(entry ? 200 : 404).json({ entry }) }
    catch (_) { res.status(503).json({ error: 'capture_unavailable' }) }
  })
  router.post('/api/v1/memory/capture', (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'same_origin_required' })
    const b = req.body; const shapes = { enabled: ['op', 'value'], retry: ['op', 'id'] }
    if (!req.is('application/json') || !b || Array.isArray(b) || !Object.hasOwn(shapes, b.op) || Object.keys(b).some(k => !shapes[b.op].includes(k)) || (b.op === 'enabled' ? typeof b.value !== 'boolean' : !ID.test(b.id || ''))) return res.status(400).json({ error: 'invalid_request' })
    try { res.json(b.op === 'enabled' ? capture.setEnabled(b.value) : capture.retry(b.id)) }
    catch (_) { res.status(409).json({ error: 'capture_unconfirmed' }) }
  })
  router.get('/memory', (req, res) => res.set('Cache-Control', 'no-store').type('html').send(governed ? require('./governedView').buildHtml() : require('./view').buildMemoryHtml()))
  router.get('/memory/legacy', (req, res) => res.set('Cache-Control', 'no-store').type('html').send(require('./view').buildMemoryHtml({ governed })))
  router.get('/api/v1/memory', async (req, res) => {
    try { res.set('Cache-Control', 'no-store').json({ state: 'connected', ...await client.list() }) }
    catch (_) { res.status(503).json({ state: 'unavailable', items: null, total: null }) }
  })
  router.post('/api/v1/memory', async (req, res) => {
    const host = req.get('host')
    if (!['127.0.0.1:8090', 'localhost:8090'].includes(host) || req.get('origin') !== 'http://' + host || req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'same_origin_required' })
    const b = req.body; const allowed = { save: ['op', 'id', 'text'], forget: ['op', 'id'] }
    if (!req.is('application/json') || !b || Array.isArray(b) || !Object.hasOwn(allowed, b.op) || Object.keys(b).some(k => !allowed[b.op].includes(k)) ||
        (b.id !== undefined && !ID.test(b.id)) || (b.op === 'forget' && !b.id) || (b.op === 'save' && !validText(b.text))) return res.status(400).json({ error: 'invalid_memory_request' })
    if (busy) return res.status(409).json({ error: 'memory_busy' })
    busy = true
    try {
      const execute = () => b.op === 'save' ? client.retain(b.id || 'xx-' + crypto.randomUUID(), b.text) : client.forget(b.id)
      const result = capture ? await capture.mutate(b.id, b.op === 'save' ? 'edited' : 'forgotten', execute) : await execute()
      res.set('Cache-Control', 'no-store').json(result)
    } catch (_) { res.status(503).json({ error: 'memory_unconfirmed' }) }
    finally { busy = false }
  })
  return router
}
module.exports = { createMemoryRouter }
