'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { randomUUID } = require('node:crypto')
const express = require('express')
const { createDemoRouter } = require('../routes/demoRouter')
const { createConversationStore } = require('../store/conversationStore')

test('chat persists the real receipt, restores it, and never advertises a failed snapshot as saved', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'investigation-route-')), old = { ...process.env }
  Object.assign(process.env, { AROMA_DATA_DIR: dir, CONTEXT_XIANGXIANG_OPERATIONS: 'on', CHAT_BACKEND: 'fixture', A4_KNOWLEDGE_ROUTING: 'off' })
  const conversationStore = createConversationStore({ dataDir: dir })
  const report = { state: 'partial', sections: [{ section: 'billing', state: 'unconnected', evidenceState: 'not_established', records: [] }], billingConfirmed: false, readOnly: true }
  let calls = 0
  const build = () => {
    const app = express(); app.use(express.json()); app.locals.conversationDemo = true
    app.use(createDemoRouter({ conversationStore, getAdapterFn: () => ({}), processIntakeFn: async (m, a, h, opts) => {
      calls++
      assert.equal(opts.ownerInvestigation, true)
      opts.onInvestigation({ state: 'planning' }); opts.onInvestigation({ state: 'evaluating', investigation: report })
      return { mode: 'chat', reply: 'Evidence remains incomplete.', investigation: structuredClone(report) }
    } }))
    return app
  }
  const serve = async app => { const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); t.after(() => new Promise(r => server.close(r))); return 'http://127.0.0.1:' + server.address().port }
  t.after(() => { for (const k of Object.keys(process.env)) if (!(k in old)) delete process.env[k]; Object.assign(process.env, old); fs.rmSync(dir, { recursive: true, force: true }) })
  const base = await serve(build()), id = randomUUID(), cid = randomUUID()
  const post = async requestId => (await fetch(base + '/api/v1/demo/intake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Investigate previous credit use', interactionMode: 'chat', websiteRequestId: requestId, conversationId: cid }) })).json()
  const result = await post(id)
  assert.equal(result.investigationRunId, id)
  assert.equal(result.investigation.persistenceState, 'saved')
  assert.equal(conversationStore.get(cid).messages[1].investigationRunId, id)
  const restarted = await serve(build())
  const snapshot = await (await fetch(restarted + '/api/v1/demo/investigations/' + id)).json()
  assert.equal(snapshot.run.state, 'completed')
  assert.equal(snapshot.run.investigation.billingConfirmed, false)
  const unchanged = fs.readFileSync(path.join(dir, 'investigation-runs', id + '.json'), 'utf8')
  const duplicate = await post(id)
  assert.equal(duplicate.investigationRunId, id)
  assert.equal(duplicate.replayed, true)
  assert.equal(duplicate.investigation.persistenceState, 'saved')
  assert.equal(calls, 1)
  assert.equal(fs.readFileSync(path.join(dir, 'investigation-runs', id + '.json'), 'utf8'), unchanged)
})
