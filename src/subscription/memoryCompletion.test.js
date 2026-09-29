'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { memoryCompletion } = require('./memoryCompletion')
test('background extraction has a separate session and cannot reject foreground chat as busy', async t => {
  const { createBridge } = require('./bridge'); const token = 'b'.repeat(64)
  let release; let entered; const started = new Promise(r => { entered = r }); const gate = new Promise(r => { release = r })
  const sessions = []
  const server = createBridge({ token, memoryEnabled: true, completeFn: async (options, input) => {
    sessions.push(options.session)
    if (input.system && input.system.includes('structured memory extraction')) { entered(); await gate }
    return { text: '{}', model: 'fixture' }
  } })
  server.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r))
  t.after(() => { release(); server.closeAllConnections(); server.close() })
  const post = (route, body) => fetch('http://127.0.0.1:' + server.address().port + route, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const memory = post('/v1/chat/completions', { messages: [{ role: 'user', content: 'Test preference' }] })
  await started
  assert.equal((await post('/complete', { prompt: 'Hello' })).status, 200)
  assert.notEqual(sessions[0], sessions[1])
  release(); assert.equal((await memory).status, 200)
})
test('Hindsight completion uses the restricted subscription client, accepts only text and preserves structured output', async () => {
  const schema = { type: 'object', properties: { facts: { type: 'array', items: { type: 'string' } } }, required: ['facts'], additionalProperties: false }
  let seen
  const result = await memoryCompletion({}, { model: 'gpt-6-astra', messages: [{ role: 'system', content: 'Extract facts.' }, { role: 'user', content: 'Owner likes green folders.' }], response_format: { type: 'json_schema', json_schema: { name: 'facts', schema } } }, async (opts, input) => { seen = input; return { text: '{"facts":["Owner likes green folders."]}', model: 'gpt-6-astra', usage: null } })
  assert.deepEqual(seen.schema, schema); assert.ok(seen.prompt.includes('Owner likes green folders.'))
  assert.equal(result.choices[0].message.content, '{"facts":["Owner likes green folders."]}')
  await assert.rejects(memoryCompletion({}, { messages: [{ role: 'tool', content: 'secret' }] }))
  await assert.rejects(memoryCompletion({}, { messages: [{ role: 'user', content: 'data' }], tools: [{ type: 'function' }] }))
})
test('memory completion route is token-protected and unavailable until explicitly enabled', async t => {
  const { createBridge } = require('./bridge')
  let calls = 0
  const token = 'a'.repeat(64)
  for (const enabled of [false, true]) {
    const server = createBridge({ token, memoryEnabled: enabled, completeFn: async () => { calls++; return { text: '{}', model: 'gpt-6-astra' } } })
    server.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r))
    const url = 'http://127.0.0.1:' + server.address().port + '/v1/chat/completions'
    const body = JSON.stringify({ messages: [{ role: 'user', content: 'Extract a test preference.' }] })
    assert.equal((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status, 401)
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body })
    assert.equal(response.status, enabled ? 200 : 503)
    await new Promise(r => { server.closeAllConnections(); server.close(r) })
  }
  assert.equal(calls, 1)
})
