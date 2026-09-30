'use strict'
const express = require('express')
const { createRegistry, createGateway } = require('./access')
const { createFlow, googleReaders } = require('./oauth')
const { sameOrigin } = require('../core/operating/chatRequest')
const { buildHtml } = require('./view')
const SESSION = 'xiangxiang_member_session'
const FLOW = 'xiangxiang_member_flow'
const MAIL_FLOW = 'xiangxiang_admin_mail_flow'
function mailCookie (res, value, seconds) {
  res.append('Set-Cookie', MAIL_FLOW + '=' + encodeURIComponent(value) + '; Path=/company/mail/callback; Max-Age=' + seconds + '; HttpOnly; SameSite=Lax; Secure')
}
function cookie (req, name) {
  try {
    const part = String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))
    return part ? decodeURIComponent(part.slice(name.length + 1)) : null
  } catch (_) { return null }
}
function setCookie (res, name, value, seconds, callback = false) {
  res.append('Set-Cookie', name + '=' + encodeURIComponent(value) + '; Path=' + (callback ? '/company/oauth/callback' : '/') +
    '; Max-Age=' + seconds + '; HttpOnly; SameSite=' + (callback ? 'Lax' : 'Strict') + '; Secure')
}
function createRouter ({ requireOwner, endOwnerSession = () => {}, enabled = false, registry = createRegistry(), flow = createFlow({ registry }), readers = googleReaders(), probe,
  mailbox = require('./mailbox').createMailbox({ registry }), mailMemory = null } = {}) {
  const router = express.Router(); const gateway = createGateway({ registry, ...readers })
  const safe = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next)
  const noStore = (req, res, next) => { res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' }); next() }
  router.use(['/company-access', '/api/v1/company-access', '/member', '/api/v1/member', '/company/oauth/callback', '/company/mail/callback'], noStore)
  const same = (req, res, next) => sameOrigin(req) ? next() : res.status(403).json({ error: 'same_origin_required' })
  router.use(['/company-access', '/api/v1/company-access'], requireOwner)
  router.get('/company-access', (req, res) => res.type('html').send(buildHtml({ owner: true })))
  router.get('/api/v1/company-access', (req, res) => res.json({ ...registry.snapshot(), mailbox: mailbox.status(), enabled, memberAcceptance: 'pending', memory: mailMemory ? 'source_bound' : 'not_connected' }))
  router.get('/api/v1/company-access/mail-memory', safe(async (req, res) => {
    if (!mailMemory) return res.status(503).json({ error: 'memory_not_connected' })
    if (Object.keys(req.query).some(k => !['q', 'id'].includes(k)) || (req.query.q && req.query.id)) return res.status(400).json({ error: 'invalid_query' })
    try { res.json(req.query.id ? await mailMemory.detail({ owner: true }, req.query.id) : { ...await mailMemory.list({ owner: true }, req.query.q || ''), sync: await mailMemory.status() }) }
    catch (_) { res.status(403).json({ error: 'mail_memory_unavailable' }) }
  }))
  router.post('/api/v1/company-access/mail-memory', same, safe(async (req, res) => {
    if (!mailMemory) return res.status(503).json({ error: 'memory_not_connected' })
    const b = req.body || {}
    try {
      if (b.op === 'sync' && Object.keys(b).join(',') === 'op') return res.json(await mailMemory.sync())
      if (b.op === 'update' && Object.keys(b).sort().join(',') === 'id,input,op,version') return res.json(await mailMemory.update({ owner: true }, b.id, b.version, b.input))
      return res.status(400).json({ error: 'invalid_request' })
    } catch (e) { res.status(e.message === 'revision_conflict' ? 409 : 503).json({ error: 'mail_memory_operation_unconfirmed' }) }
  }))
  router.get('/api/v1/company-access/mail', safe(async (req, res) => {
    try { res.json(await mailbox.preview({ owner: true })) } catch (_) { res.status(403).json({ error: 'mail_unavailable' }) }
  }))
  router.get('/api/v1/company-access/mail/search', safe(async (req, res) => {
    if (Object.keys(req.query).some(k => k !== 'q') || typeof req.query.q !== 'string') return res.status(400).json({ error: 'invalid_query' })
    try { res.json(await mailbox.search({ owner: true }, { q: req.query.q })) } catch (_) { res.status(403).json({ error: 'mail_unavailable' }) }
  }))
  router.get('/api/v1/company-access/mail/:id', safe(async (req, res) => {
    if (Object.keys(req.query).length) return res.status(400).json({ error: 'invalid_query' })
    try {
      const row = await mailbox.read({ owner: true }, req.params.id)
      let memory = { state: 'not_connected' }
      if (mailMemory) { try { memory = await mailMemory.capture({ owner: true }, row) } catch (_) { memory = { state: 'unavailable' } } }
      mailbox.lease?.({ owner: true })()
      res.json({ ...row, memory })
    } catch (_) { res.status(403).json({ error: 'mail_unavailable' }) }
  }))
  router.post('/api/v1/company-access', same, safe(async (req, res) => {
    const body = req.body || {}
    try {
      if (body.op === 'grant' && Object.keys(body).sort().join(',') === 'enabled,op,sourceId,userId') registry.setGrant(body.userId, body.sourceId, body.enabled)
      else if (body.op === 'suspend' && Object.keys(body).sort().join(',') === 'op,suspended,userId') registry.suspend(body.userId, body.suspended)
      else if (body.op === 'probe' && Object.keys(body).sort().join(',') === 'op,sourceId') {
        const source = registry.source(body.sourceId)
        if (!source || source.kind !== 'drive') return res.status(400).json({ error: 'invalid_request' })
        let connected = false
        try {
          if (probe) connected = await probe(source)
          else {
            const drive = require('../context/googleAuth').service('drive', 'v3')
            const who = (await drive.about.get({ fields: 'user(emailAddress)' }, { timeout: 10000, retry: false })).data
            const expected = registry.snapshot().users.find(u => u.role === 'owner')?.email
            if (!expected || who.user?.emailAddress?.toLowerCase() !== expected) throw Error('wrong_identity')
            const data = (await drive.files.get({ fileId: source.rootId, supportsAllDrives: true, fields: 'id,mimeType,driveId,trashed' }, { timeout: 10000, retry: false })).data
            connected = data.id === source.rootId && data.driveId === source.driveId && data.mimeType === 'application/vnd.google-apps.folder' && !data.trashed
          }
        } catch (_) { connected = false }
        registry.recordProbe(source.id, connected === true)
        return res.status(connected ? 200 : 502).json({ connected: connected === true })
      } else if (body.op === 'mail_authorize' && Object.keys(body).join(',') === 'op') {
        if (req.headers.host !== '127.0.0.1:8090') return res.status(400).json({ error: 'canonical_host_required' })
        const start = mailbox.begin(); mailCookie(res, start.cookie, 600)
        return res.json({ url: start.url })
      } else if (body.op === 'mail_disconnect' && Object.keys(body).join(',') === 'op') mailbox.disconnect()
      else return res.status(400).json({ error: 'invalid_request' })
      return res.json({ ok: true })
    } catch (_) { return res.status(400).json({ error: 'access_change_rejected' }) }
  }))
  router.get('/company/mail/callback', safe(async (req, res) => {
    let ok = false
    try {
      if (req.headers.host !== '127.0.0.1:8090') throw Error('invalid_host')
      await mailbox.finish({ state: req.query.state, code: req.query.code, error: req.query.error, cookie: cookie(req, MAIL_FLOW) })
      ok = true
    } catch (_) { /* Credentials and provider errors never enter the response. */ }
    mailCookie(res, '', 0)
    res.redirect(303, '/company-access?mail=' + (ok ? 'success' : 'failed'))
  }))
  router.use(['/member', '/api/v1/member', '/company/oauth/callback'], (req, res, next) => enabled ? next() : res.status(503).json({ error: 'member_access_disabled' }))
  router.get('/member', (req, res) => res.type('html').send(buildHtml({ owner: false })))
  router.post('/member/login', same, (req, res) => {
    if (req.headers.host !== '127.0.0.1:8090') return res.status(400).json({ error: 'canonical_host_required' })
    try {
      const start = flow.begin()
      endOwnerSession(req, res)
      flow.revoke(cookie(req, SESSION)); setCookie(res, SESSION, '', 0)
      setCookie(res, FLOW, start.cookie, 600, true)
      res.json({ url: start.url })
    } catch (_) { res.status(503).json({ error: 'member_oauth_unavailable' }) }
  })
  router.get('/company/oauth/callback', safe(async (req, res) => {
    let ok = false
    try {
      if (req.headers.host !== '127.0.0.1:8090') throw Error('invalid_host')
      const id = await flow.finish({ state: req.query.state, code: req.query.code, error: req.query.error, cookie: cookie(req, FLOW) })
      flow.revoke(cookie(req, SESSION)); setCookie(res, SESSION, id, 3600); ok = true
    } catch (_) { /* Never echo Google errors, tokens or identity claims. */ }
    setCookie(res, FLOW, '', 0, true); res.redirect(303, '/member?authorization=' + (ok ? 'success' : 'failed'))
  }))
  router.post('/member/logout', same, (req, res) => { flow.revoke(cookie(req, SESSION)); setCookie(res, SESSION, '', 0); res.json({ ok: true }) })
  router.use('/api/v1/member', (req, res, next) => {
    const session = flow.get(cookie(req, SESSION))
    if (!session) return res.status(401).json({ error: 'member_auth_required' })
    req.companySession = session; next()
  })
  router.get('/api/v1/member', (req, res) => {
    const sub = req.companySession.sub
    res.json({ identity: registry.identity(sub), sources: registry.snapshot().sources.filter(s => registry.allowed(sub, s.id)).map(({ ownerProbe, ...s }) => s),
      memory: 'not_connected', gmail: registry.mailAllowed(sub) ? mailbox.status() : null })
  })
  router.get('/api/v1/member/mail', safe(async (req, res) => {
    const sub = req.companySession.sub
    if (!registry.mailAllowed(sub)) return res.status(403).json({ error: 'mail_access_denied' })
    try {
      const result = await mailbox.preview({ sub })
      if (!flow.get(cookie(req, SESSION))) throw Error('session_expired')
      res.json(result)
    } catch (_) { res.status(403).json({ error: 'mail_unavailable' }) }
  }))
  router.get('/api/v1/member/files', safe(async (req, res) => {
    if (Object.keys(req.query).some(k => !['sourceId', 'folderId', 'fileId'].includes(k)) || (req.query.folderId && req.query.fileId)) return res.status(400).json({ error: 'invalid_request' })
    const source = registry.source(req.query.sourceId)
    if (!source || !registry.allowed(req.companySession.sub, source.id)) return res.status(403).json({ error: 'source_access_denied' })
    try {
      const result = req.query.fileId ? await gateway.read(req.companySession, source.id, req.query.fileId) :
        await gateway.list(req.companySession, source.id, req.query.folderId || source.rootId)
      if (!flow.get(cookie(req, SESSION))) throw Error('session_expired')
      res.json(result)
    } catch (_) { res.status(403).json({ error: 'source_unavailable_or_denied' }) }
  }))
  router.use(['/api/v1/member', '/member', '/company/oauth/callback'], (req, res) => res.status(404).json({ error: 'not_found' }))
  return router
}
module.exports = { createRouter }
