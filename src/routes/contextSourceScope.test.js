'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), express = require('express')
const { createContextRouter } = require('./contextRouter')
test('read-only source inspection narrows to enabled requested sources and rejects unknown or disabled sources', async t => {
  const old = { ...process.env }
  t.after(() => { for (const k of Object.keys(process.env)) if (!(k in old)) delete process.env[k]; Object.assign(process.env, old) })
  Object.assign(process.env, { READ_ACCESS: 'on', CONTEXT_XIANGXIANG_OPERATIONS: 'on', CONTEXT_GITHUB: 'on', CONTEXT_GMAIL: 'off' })
  const calls = [], app = express()
  app.use(createContextRouter({ buildConnector: () => ({ connector: {} }), buildReadContextFn: async input => { calls.push(input.sources); return { status: 'ok', perSource: [], block: null } } }))
  const server = app.listen(0, '127.0.0.1'); t.after(() => new Promise(resolve => server.close(resolve)))
  await new Promise(resolve => server.once('listening', resolve)); const url = 'http://127.0.0.1:' + server.address().port
  assert.equal((await fetch(url + '/api/v1/context/recent?sources=xiangxiang_operations')).status, 200)
  assert.deepEqual(calls, [['xiangxiang_operations']])
  for (const source of ['gmail', 'unknown', '../private']) assert.equal((await fetch(url + '/api/v1/context/recent?sources=' + encodeURIComponent(source))).status, 400)
  assert.equal(calls.length, 1)
  process.env.READ_ACCESS = 'off'
  assert.equal((await fetch(url + '/api/v1/context/recent?sources=xiangxiang_operations')).status, 403)
  assert.equal(calls.length, 1)
})
