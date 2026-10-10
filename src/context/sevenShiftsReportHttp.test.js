'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), http = require('node:http'), express = require('express'), { randomUUID } = require('node:crypto')
const { createDemoRouter } = require('../routes/demoRouter')
const { createSevenShiftsReport } = require('./sevenShiftsReport')
const { createGapService } = require('../capabilities/gapService')
function post (server, body, origin = 'http://127.0.0.1:8090') {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port: server.address().port, path: '/api/v1/demo/intake', method: 'POST', headers: { host: '127.0.0.1:8090', origin, 'content-type': 'application/json' } }, res => {
      let raw = ''; res.on('data', part => { raw += part }); res.on('end', () => resolve({ status: res.statusCode, value: JSON.parse(raw) }))
    }); request.on('error', reject); request.end(JSON.stringify(body))
  })
}
async function fixture (t, adapter) {
  const env = { READ_ACCESS: 'on', CONTEXT_SEVEN_SHIFTS: 'on', SEVEN_SHIFTS_COMPANY_ID: '123', SEVEN_SHIFTS_ACCESS_TOKEN: 'synthetic' }, saved = new Map(), starts = []
  const conversations = { get: id => saved.get(id), appendTurn: v => saved.set(v.id, { messages: [...(saved.get(v.id)?.messages || []), { role: 'user', content: v.userText }, { role: 'assistant', content: v.replyText, capabilityGapRunId: v.capabilityGapRunId }] }) }
  const gaps = createGapService({ conversations, revision: 'a'.repeat(40), planner: { start: (actor, input) => { starts.push(input); return { id: randomUUID(), profile: 'seven_shifts' } } } })
  const app = express(); app.locals.conversationDemo = true; app.use(express.json())
  app.use(createDemoRouter({ conversationStore: conversations, capabilityGaps: gaps, sevenShiftsReport: createSevenShiftsReport({ env, adapter, clock: () => '2026-10-10T18:00:00Z' }), getAdapterFn: () => { throw Error('model_must_not_run') } }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  return { server, env, saved, gaps, starts }
}
test('the real HTTP path offers a precise v3 gap and binds its local day before any model or worker dispatch', async t => {
  const f = await fixture(t, { methods: {} }), cid = randomUUID(), message = '查昨天所有員工的下班打卡時間，顯示姓名及 Winnipeg 本地時間。'
  const body = { message, conversationId: cid, workflowRequestId: randomUUID() }
  assert.equal((await post(f.server, body, 'https://evil.test')).status, 403)
  const response = await post(f.server, body), run = response.value.capabilityGapResolution
  assert.equal(response.status, 200); assert.equal(run.version, 3); assert.equal(run.state, 'awaiting_approval'); assert.equal(f.starts.length, 0)
  assert.deepEqual(run.readRequest, { window: 'dates', dates: ['2026-10-09', '2026-10-09'] })
  assert.deepEqual(run.proposal.scope.files, ['src/context/adapters/sevenShiftsRead.js'])
  assert.equal((await post(f.server, body)).value.capabilityGapRunId, run.id); assert.equal(f.saved.get(cid).messages.length, 2)
  const approval = await post(f.server, { message: '同意', conversationId: cid, workflowRequestId: randomUUID() })
  assert.equal(approval.value.capabilityGapResolution.state, 'development_planning'); assert.equal(f.starts.length, 1)
  assert.match(f.starts[0].dialogue.ownerRequests[1], /methods.listClockOuts/)
  assert.equal(f.gaps.get({ id: 'owner', role: 'owner' }, run.id).state, 'development_planning')
})
test('the real HTTP report returns all scoped rows and cached replies become unavailable when read access is revoked', async t => {
  let reads = 0
  const f = await fixture(t, { methods: { listClockOuts: async () => { reads++; return {
    results: Array.from({ length: 5 }, (_, i) => ({ fields: { companyId: 123, userId: i + 1, punchId: i + 1, employeeName: 'Name ' + i, nameState: 'confirmed', clockedIn: '2026-10-09T01:00:00Z', clockedOut: '2026-10-09T06:00:00Z' } })),
    evidence: { trust: 'live', completeWithinScope: true, returnedRows: 5, queryScope: { companyId: 123, field: 'clocked_out' } }
  } } } })
  const body = { message: 'Show all employees 7shifts clock-out times yesterday with names.', conversationId: randomUUID(), workflowRequestId: randomUUID() }
  const response = await post(f.server, body)
  assert.equal(response.status, 200); assert.equal(response.value.sevenShiftsReport.rows.length, 5); assert.match(response.value.reply, /Name 4/)
  assert.equal(response.value.sourceBound, true); assert.equal(response.value.servedBy, null)
  assert.equal((await post(f.server, body)).status, 200); assert.equal(reads, 1)
  f.env.READ_ACCESS = 'off'; assert.equal((await post(f.server, body)).status, 503); assert.equal(reads, 1)
})
