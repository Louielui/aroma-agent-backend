'use strict'
const express = require('express'), { localRequest } = require('../../adapters/CodexSubscriptionAdapter')
const { sameOrigin } = require('../operating/chatRequest'), { ID } = require('../operating/runStore')
function createAdoptionRouter ({ bootCommit, env = process.env, request = input => localRequest('/project-adoption', input, env) } = {}) {
  const router = express.Router()
  router.use('/api/v1/project-adoption', (req, res, next) => { if (env.READ_ACCESS !== 'on') return res.status(503).json({ error: 'read_access_disabled' }); next() })
  const call = async (res, input) => { try { const value = await request(input); res.set('Cache-Control', 'no-store').status(value.error ? 409 : 200).json(value) } catch (_) { res.status(503).json({ error: 'adoption_unavailable' }) } }
  router.get('/api/v1/project-adoption', (req, res) => call(res, { op: 'list' }))
  router.post('/api/v1/project-adoption', (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'same_origin_required' })
    const b = req.body, shapes = { prepare: ['op', 'action', 'runId', 'requestId'], approve: ['op', 'id', 'hash', 'nonce'], cancel: ['op', 'id'], reload: ['op', 'id'] }
    if (!req.is('application/json') || !b || Array.isArray(b) || !Object.hasOwn(shapes, b.op) || Object.keys(b).sort().join(',') !== shapes[b.op].sort().join(',') ||
      !ID.test((b.op === 'prepare' ? b.requestId : b.id) || '') || (b.op === 'prepare' && (!ID.test(b.runId || '') || !['adopt', 'rollback'].includes(b.action))) ||
      (b.op === 'approve' && (!/^[a-f0-9]{64}$/.test(b.hash || '') || !/^[a-f0-9]{48}$/.test(b.nonce || '')))) return res.status(400).json({ error: 'invalid_request' })
    call(res, b.op === 'prepare' ? { ...b, bootCommit } : b)
  })
  return router
}
module.exports = { createAdoptionRouter }
