'use strict'
const express = require('express')
const { sameOrigin } = require('../core/operating/chatRequest')
const { buildLiveContextHtml } = require('./liveContextView')
function createLiveContextRouter ({ service }) {
  const router = express.Router()
  router.get('/gmail-context', (req, res) => res.set('Cache-Control', 'no-store').type('html').send(require('./gmailContextView').buildGmailContextHtml()))
  router.post('/api/v1/live-context/gmail', async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'same_origin_required' })
    const b = req.body
    if (!req.is('application/json') || !b || Array.isArray(b) || Object.keys(b).sort().join(',') !== 'input,operation,resource') return res.status(400).json({ error: 'invalid_request' })
    let input
    try { require('./gmailContextService').gmailMailbox(b.resource); input = require('./gmailContext').validateGmailRequest(b.operation, b.input) } catch (_) { return res.status(400).json({ error: 'invalid_request' }) }
    try { res.set('Cache-Control', 'no-store').json(await service.gmail.read({ id: 'owner', role: 'owner' }, b.resource, b.operation, input)) }
    catch (_) { res.status(503).json({ error: 'gmail_context_unavailable' }) }
  })
  router.get('/calendar-context', (req, res) => res.set('Cache-Control', 'no-store').type('html').send(require('./calendarContextView').buildCalendarContextHtml()))
  router.post('/api/v1/live-context/calendar', async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'same_origin_required' })
    const b = req.body
    if (!req.is('application/json') || !b || Array.isArray(b) || Object.keys(b).sort().join(',') !== 'input,operation') return res.status(400).json({ error: 'invalid_request' })
    let input
    try { input = require('./calendarContext').validateCalendarRequest(b.operation, b.input) } catch (_) { return res.status(400).json({ error: 'invalid_request' }) }
    try { res.set('Cache-Control', 'no-store').json(await service.calendar.read({ id: 'owner', role: 'owner' }, b.operation, input)) }
    catch (_) { res.status(503).json({ error: 'calendar_context_unavailable' }) }
  })
  router.get('/aroma-context', (req, res) => res.set('Cache-Control', 'no-store').type('html').send(require('./aromaContextView').buildAromaContextHtml()))
  router.post('/api/v1/live-context/aroma', async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'same_origin_required' })
    const b = req.body
    if (!req.is('application/json') || !b || Array.isArray(b) || Object.keys(b).sort().join(',') !== 'input,operation,resource') return res.status(400).json({ error: 'invalid_request' })
    let input
    try { input = require('./aromaContext').validateAromaRequest(b.resource, b.operation, b.input) } catch (_) { return res.status(400).json({ error: 'invalid_request' }) }
    try { res.set('Cache-Control', 'no-store').json(await service.aroma.read({ id: 'owner', role: 'owner' }, b.resource, b.operation, input)) }
    catch (_) { res.status(503).json({ error: 'aroma_context_unavailable' }) }
  })
  router.get('/drive-context', (req, res) => res.set('Cache-Control', 'no-store').type('html').send(require('./driveContextView').buildDriveContextHtml()))
  router.post('/api/v1/live-context/drive', async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'same_origin_required' })
    const b = req.body
    if (!req.is('application/json') || !b || Array.isArray(b) || Object.keys(b).sort().join(',') !== 'input,operation') return res.status(400).json({ error: 'invalid_request' })
    let input
    try { input = require('./driveContextService').validateDriveRequest(b.operation, b.input) }
    catch (_) { return res.status(400).json({ error: 'invalid_request' }) }
    try { res.set('Cache-Control', 'no-store').json(await service.drive.read({ id: 'owner', role: 'owner' }, b.operation, input)) }
    catch (_) { res.status(503).json({ error: 'drive_context_unavailable' }) }
  })
  router.get('/live-context', (req, res) => res.set('Cache-Control', 'no-store').type('html').send(buildLiveContextHtml()))
  router.get('/api/v1/live-context', (req, res) => res.set('Cache-Control', 'no-store').json({ capabilities: service.capabilities() }))
  router.get('/api/v1/live-context/activity', (req, res) => {
    try { res.set('Cache-Control', 'no-store').json({ events: service.activity() }) }
    catch (_) { res.status(503).json({ error: 'audit_unavailable' }) }
  })
  router.post('/api/v1/live-context/development', async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'same_origin_required' })
    if (!req.is('application/json') || !req.body || Array.isArray(req.body) || Object.keys(req.body).length) return res.status(400).json({ error: 'fixed_workflow_only' })
    try { res.set('Cache-Control', 'no-store').json({ report: await service.read({ id: 'owner', role: 'owner' }) }) }
    catch (_) { res.status(503).json({ error: 'context_unavailable' }) }
  })
  return router
}
module.exports = { createLiveContextRouter }
