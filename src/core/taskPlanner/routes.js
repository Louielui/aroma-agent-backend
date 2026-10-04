'use strict'
const express = require('express'), { sameOrigin } = require('../operating/chatRequest'), { ID } = require('../operating/runStore')
function createRouter ({ service }) {
  const router = express.Router(), actor = { id: 'owner', role: 'owner' }, api = '/api/v1/task-plan'
  router.get(api, (req, res) => { try { res.set('Cache-Control', 'no-store').json({ runs: service.list(actor) }) } catch (_) { res.status(503).json({ error: 'planning_unavailable' }) } })
  router.get(api + '/:id', async (req, res) => { if (!ID.test(req.params.id || '')) return res.status(400).json({ error: 'invalid_request' }); try { const r = service.refreshRegistration ? await service.refreshRegistration(actor, req.params.id) : service.get(actor, req.params.id); res.set('Cache-Control', 'no-store').status(r ? 200 : 404).json({ run: r }) } catch (_) { res.status(503).json({ error: 'planning_unavailable' }) } })
  router.post(api, async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'same_origin_required' })
    const b = req.body, shapes = { prepare: ['op', 'id', 'requestId'], register: ['op', 'id', 'requestId', 'goal', 'criteria', 'editable'], cancel: ['op', 'id'] }
    if (!req.is('application/json') || !b || !Object.hasOwn(shapes, b.op) || Object.keys(b).sort().join(',') !== shapes[b.op].sort().join(',') || !ID.test(b.id || '') || (['prepare', 'register'].includes(b.op) && !ID.test(b.requestId || ''))) return res.status(400).json({ error: 'invalid_request' })
    try { const { op, ...input } = b; const v = op === 'prepare' ? await service.prepare(actor, input) : op === 'register' ? await service.registerTask(actor, input) : { run: service.cancel(actor, b.id) }; res.set('Cache-Control', 'no-store').json(v) } catch (e) { res.status(['worker_busy', 'request_conflict', 'evidence_changed', 'invalid_request'].includes(e.message) ? 409 : 503).json({ error: ['worker_busy', 'request_conflict', 'evidence_changed', 'invalid_request'].includes(e.message) ? e.message : 'planning_unavailable' }) }
  })
  return router
}
module.exports = { createRouter }
