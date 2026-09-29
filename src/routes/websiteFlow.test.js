'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createDemoRouter } = require('./demoRouter')
const { processIntake } = require('../intake/intakeService')
test('real chat route reports active website work, persists its outcome and never calls legacy models', async t => {
  const env = { ...process.env }; Object.assign(process.env, { CHAT_BACKEND: 'codex-subscription', XIANGXIANG_WEBSITE_FLOW: 'on', A4_KNOWLEDGE_ROUTING: 'off', READ_ACCESS: 'on', CONTEXT_PUBLIC_KNOWLEDGE: 'on' })
  t.after(() => { for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k]; Object.assign(process.env, env) })
  const express = require('express'); const app = express(); app.use(express.json()); app.locals.conversationDemo = true
  let release; let entered; const searching = new Promise(resolve => { entered = resolve })
  const id = require('node:crypto').randomUUID()
  const adapter = { preflight: async () => {}, complete: async () => { throw Error('unexpected legacy model') } }
  app.use(createDemoRouter({ getAdapterFn: () => adapter, processIntakeFn: (m, a, h, o) => processIntake(m, a, h, { ...o, openaiAdapter: adapter,
    websiteDeps: { classify: async () => ({ intent: 'navigate', target: 'Costco Business Centre' }), search: () => { entered(); return new Promise(resolve => { release = resolve }) } } }) }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const root = 'http://127.0.0.1:' + server.address().port
  const response = fetch(root + '/api/v1/demo/intake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Open Costco Business Centre website', websiteRequestId: id }) })
  await searching
  const status = await fetch(root + '/api/v1/demo/website-status/' + id).then(r => r.json())
  assert.equal(status.run.state, 'searching')
  release({ status: 'found', url: 'https://www.costcobusinesscentre.ca/', model: 'gpt-6-astra', searchCalls: 2 })
  const result = await (await response).json()
  assert.equal(result.website.id, id); assert.equal(result.website.state, 'completed'); assert.equal(result.servedBy, 'gpt-6-astra')
  assert.match(result.reply, /\[.*\]\(https:\/\/www.costcobusinesscentre.ca\/\)/)
  assert.equal((await fetch(root + '/api/v1/demo/website-status/' + id).then(r => r.json())).run.state, 'completed')
  assert.equal((await fetch(root + '/api/v1/demo/website-status/bad')).status, 400)
})
