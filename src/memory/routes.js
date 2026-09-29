'use strict'
const express = require('express')
const crypto = require('node:crypto')
const { createHindsight, ID, validText } = require('./hindsight')
function createMemoryRouter ({ client = createHindsight() } = {}) {
  const router = express.Router(); let busy = false
  router.get('/memory', (req, res) => res.set('Cache-Control', 'no-store').type('html').send(require('./view').buildMemoryHtml()))
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
      const result = b.op === 'save' ? await client.retain(b.id || 'xx-' + crypto.randomUUID(), b.text) : await client.forget(b.id)
      res.set('Cache-Control', 'no-store').json(result)
    } catch (_) { res.status(503).json({ error: 'memory_unconfirmed' }) }
    finally { busy = false }
  })
  return router
}
module.exports = { createMemoryRouter }
