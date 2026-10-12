'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const express = require('express')
const { randomUUID } = require('node:crypto')
const { createApp } = require('../../app')
const { createDemoRouter } = require('../../routes/demoRouter')
function post (server, url, body, { origin = 'http://127.0.0.1:8090', token } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host: '127.0.0.1:8090', origin, 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: url, method: 'POST', headers }, res => { let text = ''; res.on('data', d => { text += d }); res.on('end', () => { let value; try { value = JSON.parse(text) } catch (_) { value = text }; resolve({ status: res.statusCode, value }) }) }); req.on('error', reject); req.end(JSON.stringify(body))
  })
}
async function serverFor (app, t) { const s = app.listen(0, '127.0.0.1'); await new Promise(r => s.once('listening', r)); t.after(() => new Promise(r => { s.closeAllConnections(); s.close(r) })); return s }
test('development plan page/API require Owner; GET never dispatches; cross-origin and arbitrary scope refuse', async t => {
  let starts = 0; const id = randomUUID()
  const service = { list: () => [], get: () => ({ id, state: 'failed', reason: 'subscription_limit_reached' }), start: () => { starts++; return { id, state: 'queued' } }, workOrder: { recipe: 'development-proposal-v1' } }
  const app = createApp({ ownerPassword: 'fixture-owner', serviceToken: 'fixture-service', runPersistence: false, proposalPersistence: false, workerDeps: { artifactStore: null, runner: null }, developmentPlan: service })
  const s = await serverFor(app, t); const base = 'http://127.0.0.1:' + s.address().port
  assert.equal((await fetch(base + '/development-plan')).status, 401)
  const page = await fetch(base + '/development-plan', { headers: { authorization: 'Bearer fixture-service' } }); assert.equal(page.status, 200); assert.match(await page.text(), /api\/v1\/development-plan/)
  assert.equal((await post(s, '/api/v1/development-plan', { op: 'start', requestId: randomUUID() })).status, 401)
  assert.equal((await post(s, '/api/v1/development-plan', { op: 'start', requestId: randomUUID() }, { token: 'fixture-service', origin: 'https://evil.test' })).status, 403)
  assert.equal((await post(s, '/api/v1/development-plan', { op: 'start', requestId: randomUUID(), repo: 'private/repo' }, { token: 'fixture-service' })).status, 400)
  assert.equal(starts, 0)
  const result = await post(s, '/api/v1/development-plan', { op: 'start', requestId: randomUUID() }, { token: 'fixture-service' }); assert.equal(result.status, 200); assert.equal(result.value.run.id, id); assert.equal(starts, 1)
})
test('explicit chat dispatch persists work-order link and idempotency; no generic model fallback', async t => {
  const saved = []; let starts = 0, models = 0, prematureCompletion = 0; const id = randomUUID(); const input = { message: '香香，檢查目前開發進度，提出下一項修正方案。', conversationId: 'plan-chat', workflowRequestId: randomUUID() }
  const receipts = new Map()
  const service = { start: (actor, command) => { assert.equal(actor.id, 'owner'); assert.equal(command.recipe, 'development-proposal-v1'); starts++; if (receipts.has(command.requestId)) return { id, reused: true }; receipts.set(command.requestId, id); return { id } } }
  const memoryJournal = { event: () => ({ state: 'queued', id }), gateway: { working: async () => ({ id, version: 1 }), finishWork: async () => { prematureCompletion++ } } }
  const app = express(); app.locals.conversationDemo = true; app.use(express.json()); app.use(createDemoRouter({ developmentPlan: service, memoryJournal, conversationStore: { appendTurn: r => saved.push(r) }, getAdapterFn: () => { models++; throw Error('no generic model') } }))
  const s = await serverFor(app, t)
  assert.equal((await post(s, '/api/v1/demo/intake', input, { origin: 'https://evil.test' })).status, 403); assert.equal(starts, 0)
  const result = await post(s, '/api/v1/demo/intake', input); assert.equal(result.status, 200); assert.equal(result.value.developmentPlanRunId, id); assert.equal(result.value.mode, 'chat'); assert.match(result.value.reply, /development-plan/)
  assert.equal(prematureCompletion, 0, 'an accepted async work order must not be recorded as a completed memory goal')
  await post(s, '/api/v1/demo/intake', input); assert.equal(saved.length, 1); assert.equal(saved[0].developmentPlanRunId, id); assert.equal(models, 0)
})
