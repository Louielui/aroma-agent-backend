'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), express = require('express'), { randomUUID } = require('node:crypto'), { Script } = require('node:vm')
const { createRouter } = require('./routes'), { createBridge } = require('../../subscription/bridge')
test('task HTTP bodies reject caller authority and bind boot on the server; bilingual view compiles', async t => {
  const calls = [], app = express(); app.use(express.json()); app.use(createRouter({ bootCommit: 'a'.repeat(40), env: { READ_ACCESS: 'on' }, request: async b => { calls.push(b); return { runs: [] } } }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r) })); const url = 'http://127.0.0.1:' + server.address().port
  const post = (b, origin = 'http://127.0.0.1:8090') => new Promise((resolve, reject) => { const req = require('node:http').request(url + '/api/v1/project-tasks', { method: 'POST', headers: { host: '127.0.0.1:8090', origin, 'content-type': 'application/json' } }, res => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })) }); req.on('error', reject); req.end(JSON.stringify(b)) })
  const b = { op: 'start', requestId: randomUUID(), goal: 'New goal', criteria: ['Acceptance'], editable: ['src/context/toolGateway.js'] }
  assert.equal((await post(b, 'https://evil.invalid')).status, 403)
  for (const patch of [{ bootCommit: 'b'.repeat(40) }, { tests: 'caller code' }, { projectId: 'production' }, { commands: [] }, { op: '__proto__' }]) assert.equal((await post({ ...b, ...patch })).status, 400)
  assert.deepEqual(calls, []); assert.equal((await post(b)).status, 200); assert.deepEqual(calls, [{ ...b, bootCommit: 'a'.repeat(40) }])
  const { buildHtml } = require('./view'); for (const locale of ['zh', 'en']) { const prior = process.env.XIANGXIANG_LOCALE; process.env.XIANGXIANG_LOCALE = locale; try { const h = buildHtml(); assert.doesNotMatch(h, /\/\*(?:LABELS|LOCALE)\*\//); new Script(h.match(/<script>([\s\S]*?)<\/script>/)[1]); assert.match(h, /textContent/); assert.doesNotMatch(h, /innerHTML|\.retry\(/) } finally { if (prior === undefined) delete process.env.XIANGXIANG_LOCALE; else process.env.XIANGXIANG_LOCALE = prior } }
})
test('task bridge control reads work while provider runs; other execution lanes cannot overlap', async t => {
  let active = true, workActive = false, starts = 0
  let lookups = 0
  const projectTasks = { isActive: () => active, list: () => ({ runs: [] }), get: () => ({ run: null }), find: (actor, input) => { assert.deepEqual(actor, { id: 'owner', role: 'owner' }); assert.ok(input.requestId); lookups++; return { run: null, approval: null } }, start: () => { starts++; return { run: {} } } }, token = 'a'.repeat(64)
  const server = createBridge({ token, projectTasks, projectWork: { isActive: () => workActive } }); await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r) })); const url = 'http://127.0.0.1:' + server.address().port
  const post = (route, b) => fetch(url + route, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(b) })
  assert.equal((await post('/project-tasks', { op: 'list' })).status, 200); assert.equal((await post('/complete', { prompt: 'x' })).status, 503); assert.equal((await post('/project-work', { op: 'list' })).status, 503)
  active = false; workActive = true; const r = await post('/project-tasks', { op: 'start', bootCommit: 'a'.repeat(40), requestId: randomUUID(), goal: 'x', criteria: ['x'], editable: [] }); assert.equal((await r.json()).error, 'worker_busy'); assert.equal(starts, 0)
  assert.equal((await post('/project-tasks', { op: 'list' })).status, 200)
  assert.equal((await post('/project-tasks', { op: 'find', requestId: randomUUID() })).status, 200); assert.equal(lookups, 1); assert.equal(starts, 0)
  assert.equal((await post('/project-tasks', { op: 'find', requestId: randomUUID(), start: true })).status, 400); assert.equal(lookups, 1)
})
