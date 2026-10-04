'use strict'
const express = require('express'), { localRequest } = require('../../adapters/CodexSubscriptionAdapter')
const { sameOrigin } = require('../operating/chatRequest'), { ID } = require('../operating/runStore'), { buildHtml } = require('./view')
function createProjectRouter ({ bootCommit, env = process.env, request = input => localRequest('/project-work', input, env) } = {}) {
  const router = express.Router()
  router.use(['/project-work', '/api/v1/project-work'], (req, res, next) => { if (env.READ_ACCESS !== 'on') return res.status(503).json({ error: 'read_access_disabled' }); next() })
  router.get('/project-work', (req, res) => res.set('Cache-Control', 'no-store').type('html').send(buildHtml()))
  const call = async (res, input) => { try { const value = await request(input); res.set('Cache-Control', 'no-store').status(value.error ? 409 : 200).json(value) } catch (_) { res.status(503).json({ error: 'workflow_unavailable' }) } }
  router.get('/api/v1/project-work', (req, res) => call(res, { op: 'list' }))
  router.get('/api/v1/project-work/:id', (req, res) => { if (!ID.test(req.params.id || '')) return res.status(400).json({ error: 'invalid_request' }); call(res, { op: 'get', id: req.params.id }) })
  router.get('/api/v1/project-work/:id/browser/:name', async (req, res) => {
    if (!ID.test(req.params.id || '') || !require('../../workers/execution/browserEvidence').NAMES.includes(req.params.name)) return res.status(400).json({ error: 'invalid_request' })
    try {
      const value = await request({ op: 'browser', id: req.params.id, name: req.params.name })
      if (value.error || value.name !== req.params.name || typeof value.content !== 'string' || value.content.length > 2700000) return res.status(409).json({ error: 'evidence_unavailable' })
      res.set('Cache-Control', 'no-store').set('X-Content-Type-Options', 'nosniff').type('png').send(Buffer.from(value.content, 'base64'))
    } catch (_) { res.status(503).json({ error: 'evidence_unavailable' }) }
  })
  router.post('/api/v1/project-work', (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'same_origin_required' })
    const b = req.body, shapes = { prepare: ['op', 'projectId', 'recipe', 'requestId'], approve: ['op', 'id', 'hash', 'nonce'], cancel: ['op', 'id'] }
    if (!req.is('application/json') || !b || Array.isArray(b) || !Object.hasOwn(shapes, b.op) || Object.keys(b).sort().join(',') !== shapes[b.op].sort().join(',') || !ID.test((b.op === 'prepare' ? b.requestId : b.id) || '') || (b.op === 'approve' && (!/^[a-f0-9]{64}$/.test(b.hash || '') || !/^[a-f0-9]{48}$/.test(b.nonce || '')))) return res.status(400).json({ error: 'invalid_request' })
    call(res, b.op === 'prepare' ? { ...b, bootCommit } : b)
  })
  return router
}
module.exports = { createProjectRouter }
