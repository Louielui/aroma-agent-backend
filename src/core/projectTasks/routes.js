'use strict'
const express = require('express'), { localRequest } = require('../../adapters/CodexSubscriptionAdapter')
const { sameOrigin } = require('../operating/chatRequest'), { ID } = require('../operating/runStore'), { buildHtml } = require('./view')
function createRouter ({ bootCommit, env = process.env, request = input => localRequest('/project-tasks', input, env) } = {}) {
  const router = express.Router(), api = '/api/v1/project-tasks'
  router.use(['/project-tasks', api], (req, res, next) => { if (env.READ_ACCESS !== 'on') return res.status(503).json({ error: 'read_access_disabled' }); next() })
  router.get('/project-tasks', (req, res) => res.set('Cache-Control', 'no-store').type('html').send(buildHtml()))
  async function call (res, b) { try { const v = await request(b); res.set('Cache-Control', 'no-store').status(v.error ? 409 : 200).json(v) } catch (_) { res.status(503).json({ error: 'registration_unavailable' }) } }
  router.get(api, (req, res) => call(res, { op: 'list' }))
  router.get(api + '/:id', (req, res) => { if (!ID.test(req.params.id)) return res.status(400).json({ error: 'invalid_request' }); call(res, { op: 'get', id: req.params.id }) })
  router.post(api, (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'same_origin_required' })
    const b = req.body, shapes = { start: ['op', 'requestId', 'goal', 'criteria', 'editable'], approve: ['op', 'id', 'hash', 'nonce'], prepare: ['op', 'id', 'requestId'], cancel: ['op', 'id'] }
    if (!req.is('application/json') || !b || Array.isArray(b) || !Object.hasOwn(shapes, b.op) || Object.keys(b).sort().join(',') !== shapes[b.op].sort().join(',') || !ID.test((b.op === 'start' ? b.requestId : b.id) || '') || (['start', 'prepare'].includes(b.op) && !ID.test(b.requestId || '')) || (b.op === 'approve' && (!/^[a-f0-9]{64}$/.test(b.hash || '') || !/^[a-f0-9]{48}$/.test(b.nonce || '')))) return res.status(400).json({ error: 'invalid_request' })
    call(res, b.op === 'start' ? { ...b, bootCommit } : b)
  })
  return router
}
module.exports = { createRouter }
