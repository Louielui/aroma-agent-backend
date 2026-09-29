'use strict'
const express = require('express')
const { localRequest } = require('../../adapters/CodexSubscriptionAdapter')
const { buildWorkerHtml } = require('./view')
function createWorkerRouter ({ request = input => localRequest('/workers', input, process.env) } = {}) {
  const router = express.Router()
  router.get('/workers', (req, res) => res.set('Cache-Control', 'no-store').type('html').send(buildWorkerHtml()))
  router.get('/api/v1/worker-flow', async (req, res) => {
    try { res.set('Cache-Control', 'no-store').json(await request({ op: 'list' })) }
    catch (_) { res.status(503).json({ error: 'worker_unavailable' }) }
  })
  router.post('/api/v1/worker-flow', async (req, res) => {
    const host = req.get('host')
    if (!['127.0.0.1:8090', 'localhost:8090'].includes(host) || req.get('origin') !== 'http://' + host || req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'same_origin_required' })
    const b = req.body
    const keys = { status: ['op'], start: ['op', 'recipe', 'approved'], review: ['op', 'id', 'approved'] }
    if (!req.is('application/json') || !b || Array.isArray(b) || !Object.hasOwn(keys, b.op) || Object.keys(b).some(k => !keys[b.op].includes(k))) return res.status(400).json({ error: 'invalid_work_order' })
    try { res.set('Cache-Control', 'no-store').json(await request(b)) }
    catch (_) { res.status(503).json({ error: 'worker_unavailable' }) }
  })
  return router
}
module.exports = { createWorkerRouter }
