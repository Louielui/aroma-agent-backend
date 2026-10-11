'use strict'
const express = require('express')
const { TOPICS } = require('./workspaces')
function createTopicRouter ({ store, conversations, rechecks = null }) {
  const router = express.Router()
  const followups = require('./evidenceFollowups').createEvidenceFollowups({ store, conversations })
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store')
    if (!req.app.locals.conversationDemo) return res.status(403).json({ error: 'not_enabled' })
    if (req.method !== 'GET') {
      let origin; try { origin = new URL(req.headers.origin) } catch (_) {}
      if (!origin || origin.origin !== req.protocol + '://' + req.headers.host) return res.status(403).json({ error: 'origin_rejected' })
    }
    next()
  })
  const handle = fn => async (req, res) => {
    try { if (!TOPICS.includes(req.params.topic)) throw Error('invalid_topic'); res.json({ ok: true, ...await fn(req) }) }
    catch (e) { const known = ['invalid_topic', 'invalid_request', 'topic_conflict', 'request_conflict', 'workspace_capacity', 'note_not_found', 'revision_conflict', 'topic_store_unavailable', 'source_topic_mismatch', 'confirmation_required', 'evidence_report_not_found', 'evidence_source_unavailable', 'recheck_not_found', 'recheck_expired', 'unverified_recheck']; const error = known.includes(e.message) ? e.message : 'topic_store_unavailable'; res.status(error.endsWith('unavailable') ? 503 : error.endsWith('conflict') ? 409 : error.endsWith('not_found') ? 404 : error === 'source_topic_mismatch' ? 403 : 400).json({ error }) }
  }
  router.get('/:topic', handle(req => {
    const workspace = store.get(req.params.topic)
    return { workspace, conversations: conversations.list().filter(c => workspace.conversationIds.includes(c.id)) }
  }))
  router.post('/:topic/conversations', handle(req => {
    if (!req.body || Object.keys(req.body).join(',') !== 'id') throw Error('invalid_request')
    return { workspace: store.link(req.params.topic, req.body.id) }
  }))
  router.post('/:topic/notes', handle(req => ({ note: store.createNote(req.params.topic, req.body) })))
  router.get('/:topic/follow-up-candidates', handle(req => ({ report: followups.prepare(req.params.topic, req.query) })))
  router.post('/:topic/evidence-follow-ups', handle(req => followups.accept(req.params.topic, req.body)))
  const checks = () => { if (!rechecks) throw Error('evidence_source_unavailable'); return rechecks }
  router.post('/:topic/rechecks', handle(async req => ({ recheck: await checks().prepare(req.params.topic, req.body) })))
  router.get('/:topic/rechecks/:id', handle(req => ({ recheck: checks().get(req.params.topic, req.params.id) })))
  router.post('/:topic/recheck-updates', handle(req => checks().accept(req.params.topic, req.body)))
  router.put('/:topic/notes/:id', handle(req => ({ note: store.updateNote(req.params.topic, req.params.id, req.body) })))
  return router
}
module.exports = { createTopicRouter }
