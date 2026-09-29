'use strict'
const express = require('express')
const { OWNER } = require('./governed')
const { sameOrigin } = require('../core/operating/chatRequest')
const shapes = { consolidate: ['op','id'], consolidationSettings: ['op','enabled'], backup: ['op'], propose: ['op', 'record'], observe: ['op', 'record'], transition: ['op', 'id', 'version', 'action'],
  index: ['op', 'id'], reflect: ['op', 'request'], working: ['op', 'request'], finish: ['op', 'id', 'version', 'outcome'],
  grant: ['op', 'request'], recall: ['op', 'query', 'scope'], decision: ['op', 'subject', 'scope'],
  procedure: ['op', 'id', 'runId', 'outcome', 'exception'] }
function createGovernedRouter({ gateway, runtime }) {
  const router = express.Router()
  const fail = (res, e) => res.status(/permission/.test(e.message) ? 403 : /conflict|stale/.test(e.message) ? 409 : /invalid|required|not_/.test(e.message) ? 400 : 503).json({ error: ['permission_denied', 'revision_conflict', 'stale_evidence', 'invalid_supersession', 'sop_link_and_version_required', 'decision_conflict'].includes(e.message) ? e.message : 'memory_operation_unconfirmed' })
  router.get('/api/v1/memory/catalog', async (req, res) => {
    try {
      const filter = { scope: req.query.scope, type: req.query.type, status: req.query.status }
      const rows = await gateway.list(OWNER, filter)
      const offset = Math.max(0, Math.min(100000, Number.parseInt(req.query.offset, 10) || 0))
      res.set('Cache-Control', 'no-store').json({ status: await gateway.status(OWNER), consolidation: runtime?.consolidation?.status() || null, runtime: runtime?.status() || null, total: rows.length, offset, items: rows.reverse().slice(offset, offset + 200) })
    } catch (e) { fail(res, e) }
  })
  router.get('/api/v1/memory/catalog/:id', async (req, res) => {
    try { res.set('Cache-Control', 'no-store').json({ record: await gateway.get(OWNER, req.params.id), audit: await gateway.audit(OWNER, req.params.id) }) } catch (e) { fail(res, e) }
  })
  async function execute(actor, b) {
    if (!b || Array.isArray(b) || !Object.hasOwn(shapes, b.op) || Object.keys(b).some(k => !shapes[b.op].includes(k))) throw Error('invalid_request')
    switch (b.op) {
      case 'consolidate': return gateway.consolidate(actor, b.id)
      case 'consolidationSettings': return runtime.consolidation.configure(b.enabled)
      case 'backup': return runtime.backup()
      case 'propose': return gateway.propose(actor, b.record)
      case 'observe': return gateway.observe(actor, b.record)
      case 'transition': return gateway.transition(actor, b.id, b.version, b.action)
      case 'index': return gateway.index(actor, b.id)
      case 'reflect': return gateway.reflect(actor, b.request)
      case 'working': return gateway.working(actor, b.request)
      case 'finish': return gateway.finishWork(actor, b.id, b.version, b.outcome)
      case 'grant': return gateway.grant(actor, b.request)
      case 'recall': return gateway.recall(actor, b.query, { scope: b.scope })
      case 'decision': return gateway.getDecision(actor, b.subject, b.scope)
      case 'procedure': {
        const sop = await gateway.get(actor, b.id)
        if (!sop || sop.type !== 'procedural' || sop.status !== 'active' || typeof b.runId !== 'string' || typeof b.outcome !== 'string') throw Error('invalid_procedure')
        return gateway.observe(actor, { type: 'episodic', subject: sop.subject + ' · ' + b.runId, text: JSON.stringify({ outcome: b.outcome, exception: b.exception || null }),
          scope: sop.scope, source: { kind: 'sop_usage', id: b.runId, at: new Date().toISOString(), attribution: 'external_claim', url: sop.source.url, version: sop.source.version, evidence: [sop.id] } })
      }
    }
  }
  router.post('/api/v1/memory/catalog', async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'same_origin_required' })
    if (!req.is('application/json')) return res.status(400).json({ error: 'invalid_request' })
    try { res.set('Cache-Control', 'no-store').json({ result: await execute(OWNER, req.body) }) } catch (e) { fail(res, e) }
  })
  // Separate credentials and route: a scoped agent token is never an owner session.
  router.post('/api/v1/agent-memory', async (req, res) => {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || req.get('origin') || !req.is('application/json')) return res.status(403).json({ error: 'permission_denied' })
    try {
      const actor = await gateway.authenticate((req.get('authorization') || '').replace(/^Bearer /, ''))
      if (!['observe', 'recall', 'decision', 'working', 'finish', 'procedure'].includes(req.body?.op)) throw Error('permission_denied')
      res.set('Cache-Control', 'no-store').json({ result: await execute(actor, req.body) })
    } catch (e) { fail(res, e) }
  })
  return router
}
module.exports = { createGovernedRouter }
