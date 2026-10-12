'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), express = require('express'), vm = require('node:vm'), { randomUUID } = require('node:crypto')
const { createApp } = require('../../app'), { createDemoRouter } = require('../../routes/demoRouter')
async function serverFor (app, t) { const s = app.listen(0, '127.0.0.1'); await new Promise(r => s.once('listening', r)); t.after(() => new Promise(r => { s.closeAllConnections(); s.close(r) })); return s }
function post (server, url, body, { origin = 'http://127.0.0.1:8090', token } = {}) {
  return new Promise((resolve, reject) => { const req = http.request({ host: '127.0.0.1', port: server.address().port, path: url, method: 'POST', headers: { host: '127.0.0.1:8090', origin, 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) } }, res => { let text = ''; res.on('data', d => { text += d }); res.on('end', () => { let body; try { body = JSON.parse(text) } catch (_) { body = text }; resolve({ status: res.statusCode, body }) }) }); req.on('error', reject); req.end(JSON.stringify(body)) })
}
test('Owner and origin gates protect the reusable workflow UI/API; opening/status never invokes worker', async t => {
  let starts = 0; const id = randomUUID()
  const service = { list: () => [], catalogue: () => ({ workers: [], workOrder: { recipe: 'xiangxiang-code-diagnosis-v1' } }), get: () => null, start: () => { starts++; return { id, state: 'queued' } } }
  const app = createApp({ ownerPassword: 'fixture-owner', serviceToken: 'fixture-service', runPersistence: false, proposalPersistence: false, workerDeps: { artifactStore: null, runner: null }, codeDiagnosis: service })
  const s = await serverFor(app, t), url = 'http://127.0.0.1:' + s.address().port
  assert.equal((await fetch(url + '/code-diagnosis')).status, 401); assert.equal((await fetch(url + '/api/v1/code-diagnosis')).status, 401)
  const response = await fetch(url + '/code-diagnosis', { headers: { authorization: 'Bearer fixture-service' } }); const html = await response.text(); assert.equal(response.status, 200); assert.match(html, /api\/v1\/code-diagnosis/); assert.match(html, /問題尚未重現/)
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*)<\/script>/)[1])); assert.doesNotMatch(html, /\[missing|\/\*LABELS\*\//)
  assert.equal((await post(s, '/api/v1/code-diagnosis', { op: 'start', requestId: randomUUID() }, { token: 'fixture-service', origin: 'https://outside.test' })).status, 403)
  for (const field of ['path', 'worker', 'tools', 'approved', 'model']) assert.equal((await post(s, '/api/v1/code-diagnosis', { op: 'start', requestId: randomUUID(), [field]: 'untrusted' }, { token: 'fixture-service' })).status, 400)
  assert.equal(starts, 0); assert.equal((await post(s, '/api/v1/code-diagnosis', { op: 'start', requestId: randomUUID() }, { token: 'fixture-service' })).status, 200); assert.equal(starts, 1)
})
test('chat capability routing persists exactly one diagnosis link and cannot change worker scope or claim completion', async t => {
  const id = randomUUID(), receipts = new Map(), saved = []; let modelCalls = 0, completions = 0
  const service = { start: (actor, command) => { assert.equal(actor.id, 'owner'); assert.equal(command.recipe, 'xiangxiang-code-diagnosis-v1'); if (receipts.has(command.requestId)) return { id, reused: true }; receipts.set(command.requestId, id); return { id } } }
  const app = express(); app.locals.conversationDemo = true; app.use(express.json()); app.use(createDemoRouter({ codeDiagnosis: service, conversationStore: { appendTurn: r => saved.push(r) }, memoryJournal: { event: () => ({ state: 'queued' }), gateway: { finishWork: async () => { completions++ } } }, getAdapterFn: () => { modelCalls++; throw Error() } }))
  const s = await serverFor(app, t), body = { message: '香香，檢查自己目前的程式，提出問題證據和修正方案。', conversationId: 'diag-chat', workflowRequestId: randomUUID() }
  assert.equal((await post(s, '/api/v1/demo/intake', { ...body, worker: 'unknown' })).status, 400)
  assert.equal((await post(s, '/api/v1/demo/intake', body, { origin: 'https://outside.test' })).status, 403)
  const result = await post(s, '/api/v1/demo/intake', body); assert.equal(result.status, 200); assert.equal(result.body.codeDiagnosisRunId, id); assert.equal(result.body.servedBy, null); assert.match(result.body.reply, /尚未完成診斷/)
  await post(s, '/api/v1/demo/intake', body); assert.equal(saved.length, 1); assert.equal(saved[0].codeDiagnosisRunId, id); assert.equal(modelCalls, 0); assert.equal(completions, 0)
})
test('diagnosis view and architecture remain readable in English with exact scoped limits', () => {
  const prior = process.env.XIANGXIANG_LOCALE; process.env.XIANGXIANG_LOCALE = 'en'
  try { const html = require('../developmentPlan/view').buildHtml({ diagnosis: true }); assert.match(html, /eight fixed/); assert.match(html, /findings remain unverified/i); assert.match(html, /No findings/); assert.doesNotMatch(html, /\[missing/); assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*)<\/script>/)[1])) } finally { if (prior === undefined) delete process.env.XIANGXIANG_LOCALE; else process.env.XIANGXIANG_LOCALE = prior }
})
