'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), express = require('express'), { randomUUID } = require('node:crypto')
const { createAdoptionRouter } = require('./adoptionRoutes')
test('adoption API binds server boot and rejects caller paths, authority, replay shapes and origins', async t => {
  const calls = [], app = express(); app.use(express.json()); app.use(createAdoptionRouter({ bootCommit: 'a'.repeat(40), env: { READ_ACCESS: 'on' }, request: async input => { calls.push(input); return { runs: [] } } }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const send = (body, origin = 'http://127.0.0.1:8090') => new Promise(resolve => { const req = require('node:http').request({ hostname: '127.0.0.1', port: server.address().port, path: '/api/v1/project-adoption', method: 'POST', headers: { host: '127.0.0.1:8090', origin, 'content-type': 'application/json' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)) }); req.end(JSON.stringify(body)) })
  const body = { op: 'prepare', action: 'adopt', runId: randomUUID(), requestId: randomUUID() }
  assert.equal(await send(body, 'https://evil.invalid'), 403)
  for (const patch of [{ path: '.env' }, { bootCommit: 'b'.repeat(40) }, { command: 'anything' }, { action: 'push' }, { actor: { role: 'owner' } }, { op: '__proto__' }]) assert.equal(await send({ ...body, ...patch }), 400)
  assert.equal(calls.length, 0); assert.equal(await send(body), 200); assert.deepEqual(calls, [{ ...body, bootCommit: 'a'.repeat(40) }])
})
test('whole application Owner boundary protects adoption page data and writes', async t => {
  let calls = 0; const { createApp } = require('../../app'), app = createApp({ ownerPassword: 'fixture-owner', serviceToken: 'fixture-service', runPersistence: false, proposalPersistence: false, workerDeps: { artifactStore: null, runner: null }, projectAdoptionOptions: { env: { READ_ACCESS: 'on' }, request: async () => { calls++; return { runs: [] } } } })
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) })); const url = 'http://127.0.0.1:' + server.address().port
  assert.equal((await fetch(url + '/api/v1/project-adoption')).status, 401); assert.equal(calls, 0)
  assert.equal((await fetch(url + '/api/v1/project-adoption', { headers: { authorization: 'Bearer fixture-service' } })).status, 200); assert.equal(calls, 1)
})
test('adoption page has bilingual explicit approval, independent history and session renewal without executable source rendering', () => {
  const { buildHtml } = require('./view'), { Script } = require('node:vm'), old = process.env.XIANGXIANG_LOCALE
  try { for (const locale of ['zh', 'en']) { process.env.XIANGXIANG_LOCALE = locale; const html = buildHtml(); new Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]); assert.match(html, /id="adoptCheck"/); assert.match(html, /id="adoptions"/); assert.match(html, /r.status===401/); assert.doesNotMatch(html, /innerHTML|localStorage|sessionStorage|\[missing/); assert.match(html, locale === 'en' ? /Apply reviewed repairs/ : /審批後套用修正/) } }
  finally { if (old === undefined) delete process.env.XIANGXIANG_LOCALE; else process.env.XIANGXIANG_LOCALE = old }
})
