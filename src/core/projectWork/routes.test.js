'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), express = require('express'), { randomUUID } = require('node:crypto')
const { createProjectRouter } = require('./routes')
test('exact Owner work requests are server-bound to boot; caller authority and cross-origin requests are rejected', async t => {
  const calls = [], app = express(); app.use(express.json()); app.use(createProjectRouter({ bootCommit: 'a'.repeat(40), env: { READ_ACCESS: 'on' }, request: async input => { calls.push(input); return { runs: [] } } }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const url = 'http://127.0.0.1:' + server.address().port
  const send = (body, origin = 'http://127.0.0.1:8090') => new Promise((resolve, reject) => {
    const req = require('node:http').request(url + '/api/v1/project-work', { method: 'POST', headers: { host: '127.0.0.1:8090', origin, 'content-type': 'application/json' } }, res => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })) })
    req.on('error', reject); req.end(JSON.stringify(body))
  })
  const body = { op: 'prepare', projectId: 'aroma-agent-backend', recipe: 'context-fields-snapshot-v1', requestId: randomUUID() }
  assert.equal((await send(body, 'http://evil.invalid')).status, 403)
  for (const patch of [{ bootCommit: 'b'.repeat(40) }, { source: 'text' }, { path: '.env' }, { op: '__proto__' }, { command: 'anything' }]) assert.equal((await send({ ...body, ...patch })).status, 400)
  assert.equal(calls.length, 0); assert.equal((await send(body)).status, 200); assert.deepEqual(calls, [{ ...body, bootCommit: 'a'.repeat(40) }])
  const html = await (await fetch(url + '/project-work')).text(); assert.match(html, /src\/context\/contextResult.js/); assert.match(html, /尚未接通/); assert.doesNotMatch(html, /\/\*LABELS\*\//)
})
