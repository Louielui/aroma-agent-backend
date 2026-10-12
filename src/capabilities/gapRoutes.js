'use strict'
const express = require('express')
const { sameOrigin } = require('../core/operating/chatRequest')
const { keys } = require('./gapContract')
function createGapRouter ({ service }) {
  const router = express.Router(), actor = { id: 'owner', role: 'owner' }, api = '/api/v1/capability-gaps'
  router.get(api + '/:id', async (req, res) => {
    try { res.set('Cache-Control', 'no-store').json({ run: await service.status(actor, req.params.id) }) }
    catch (_) { res.status(404).json({ error: 'proposal_unavailable' }) }
  })
  router.post(api, async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'same_origin_required' })
    const b = req.body
    if (!req.is('application/json') || !b || !['approve', 'refreshScope', 'resume'].includes(b.op) || !keys(b, b.op !== 'resume' ? ['op', 'id', 'conversationId', 'hash'] : ['op', 'id', 'conversationId', 'hash', 'requestId'])) return res.status(400).json({ error: 'invalid_request' })
    try { const { op, ...input } = b; res.set('Cache-Control', 'no-store').json(await service[op](actor, input)) }
    catch (e) { const safe = ['invalid_request', 'proposal_changed', 'proposal_stale', 'conversation_changed', 'capability_unverified', 'request_conflict', 'resume_unconfirmed']; res.status(409).json({ error: safe.includes(e.message) ? e.message : 'proposal_unavailable' }) }
  })
  return router
}
module.exports = { createGapRouter }
