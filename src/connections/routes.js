'use strict'
const express = require('express')
const { readCookie } = require('../governance/ownerAuth')
const COOKIE = 'xiangxiang_google_flow'
const flowCookie = value => COOKIE + '=' + value + '; Path=/oauth/google/callback; HttpOnly; SameSite=Lax; Secure; Max-Age=' + (value ? 600 : 0)
function sameOrigin (req) { const host = req.get('host'); return ['127.0.0.1:8090', 'localhost:8090'].includes(host) && req.get('origin') === 'http://' + host && req.get('sec-fetch-site') !== 'cross-site' }
function createRouters ({ manager, flow = require('./oauth').createFlow() }) {
  const router = express.Router(); const callback = express.Router()
  router.get('/connections', (req, res) => res.set('Cache-Control', 'no-store').type('html').send(require('./view').buildHtml()))
  router.get('/api/v1/connections', (req, res) => {
    try { res.set('Cache-Control', 'no-store').json(manager.list()) } catch (_) { res.status(503).json({ error: 'status_unavailable' }) }
  })
  router.post('/api/v1/connections', async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: 'same_origin_required' })
    const b = req.body; const shapes = { test: ['op', 'source'], toggle: ['op', 'source', 'enabled'], authorize: ['op'] }
    if (!req.is('application/json') || !b || Array.isArray(b) || !Object.hasOwn(shapes, b.op) || Object.keys(b).some(k => !shapes[b.op].includes(k))) return res.status(400).json({ error: 'invalid_request' })
    try {
      res.set('Cache-Control', 'no-store')
      if (b.op === 'authorize') {
        // The OAuth callback uses the canonical loopback host, so its cookie must too.
        if (req.get('host') !== '127.0.0.1:8090') return res.status(400).json({ error: 'canonical_host_required' })
        const start = flow.begin(); res.set('Set-Cookie', flowCookie(start.cookie)); return res.json({ url: start.url })
      }
      res.json(b.op === 'test' ? await manager.test(b.source) : manager.toggle(b.source, b.enabled))
    } catch (e) {
      const known = ['busy', 'disabled', 'invalid_source', 'invalid_enabled', 'state_changed']
      res.status(e.message === 'busy' ? 409 : known.includes(e.message) ? 400 : 503).json({ error: known.includes(e.message) ? e.message : 'connection_action_failed' })
    }
  })
  // This one endpoint uses the one-use OAuth state + flow cookie instead of the
  // Strict owner cookie, which is intentionally absent on Google's return redirect.
  callback.get('/oauth/google/callback', async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Set-Cookie': flowCookie('') })
    try {
      if (req.get('host') !== '127.0.0.1:8090') throw Error('invalid_host')
      await flow.finish({ state: req.query.state, code: req.query.code, error: req.query.error, cookie: readCookie(req, COOKIE) })
      manager.invalidate()
      res.redirect(303, '/connections?authorization=success')
    } catch (_) { res.redirect(303, '/connections?authorization=failed') }
  })
  return { router, callback }
}
module.exports = { createRouters }
