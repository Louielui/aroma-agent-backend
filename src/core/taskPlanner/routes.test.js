'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), express = require('express'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), { randomUUID } = require('node:crypto')
const { createDemoRouter } = require('../../routes/demoRouter'), { createRouter } = require('./routes')
async function fixture (t) {
  let started = 0, prepared = 0, registered = 0, models = 0; const saved = [], id = randomUUID(), plans = new Map()
  const service = { start: (a, b) => { if (plans.has(b.requestId)) return { ...plans.get(b.requestId), reused: true }; started++; const r = { id, state: 'queued' }; plans.set(b.requestId, r); return r }, list: () => [], get: () => ({ id, state: 'completed' }), prepare: () => { prepared++; return { run: { id }, work: { approval: null } } }, cancel: () => ({ id, state: 'cancelled' }) }
  service.registerTask = (actor, input) => { assert.deepEqual(actor, { id: 'owner', role: 'owner' }); registered++; return { run: { id, taskRunId: randomUUID() }, input } }
  const app = express(); app.locals.conversationDemo = true; app.use(express.json()); app.use(createRouter({ service })); app.use(createDemoRouter({ taskPlanner: service, conversationStore: { appendTurn: r => saved.push(r) }, getAdapterFn: () => { models++; return {} }, processIntakeFn: async () => ({ reply: 'ordinary' }) }))
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r) }))
  const base = 'http://127.0.0.1:' + server.address().port, post = (route, b, origin = 'http://127.0.0.1:8090') => new Promise((resolve, reject) => { const req = require('node:http').request({ host: '127.0.0.1', port: server.address().port, path: route, method: 'POST', headers: { host: '127.0.0.1:8090', origin, 'content-type': 'application/json' } }, res => { let text = ''; res.on('data', c => { text += c }); res.on('end', () => resolve({ status: res.statusCode, json: async () => JSON.parse(text) })) }); req.on('error', reject); req.end(JSON.stringify(b)) })
  const body = { message: 'plan Xiangxiang work order button improvements', conversationId: 'planner-chat-' + randomUUID(), workflowRequestId: randomUUID() }
  return { id, body, post, base, saved, counts: () => ({ started, prepared, registered, models }) }
}
test('chat registration HTTP binds explicit fields, rejects foreign origins and extra authority', async t => {
  const f = await fixture(t), input = { op: 'register', id: f.id, requestId: randomUUID(), goal: 'Improve snapshots', criteria: ['Independent data'], editable: ['src/context/toolGateway.js'] }
  assert.equal((await f.post('/api/v1/task-plan', input, 'https://evil.invalid')).status, 403)
  for (const extra of [{ bootCommit: 'a'.repeat(40) }, { commands: ['unsafe'] }, { tests: 'unsafe' }, { recipe: 'forged' }, { approval: true }]) assert.equal((await f.post('/api/v1/task-plan', { ...input, ...extra })).status, 400)
  assert.equal(f.counts().registered, 0); const response = await f.post('/api/v1/task-plan', input); assert.equal(response.status, 200); assert.equal((await response.json()).input.goal, input.goal); assert.equal(f.counts().registered, 1); assert.equal(f.counts().prepared, 0)
})
test('chat starts bounded planning, stores one display-only reference, and history cannot route', async t => {
  const f = await fixture(t), r = await f.post('/api/v1/demo/intake', f.body); assert.equal(r.status, 200); assert.equal((await r.json()).taskPlanRunId, f.id); assert.equal(f.saved[0].taskPlanRunId, f.id)
  await f.post('/api/v1/demo/intake', f.body); assert.equal(f.saved.length, 1); assert.equal(f.counts().started, 1); assert.equal(f.counts().prepared, 0); assert.equal(f.counts().models, 0)
  await f.post('/api/v1/demo/intake', { ...f.body, message: 'hello', history: [{ role: 'user', text: f.body.message }] }); assert.equal(f.counts().started, 1)
})
test('foreign origins, forged recipes/files and vague profiles fail before planning or preparation', async t => {
  const f = await fixture(t)
  assert.equal((await f.post('/api/v1/demo/intake', f.body, 'https://evil.invalid')).status, 403)
  for (const extra of [{ recipe: 'arbitrary' }, { files: ['.env'] }, { bootCommit: 'a'.repeat(40) }]) assert.equal((await f.post('/api/v1/demo/intake', { ...f.body, ...extra })).status, 400)
  const vague = await f.post('/api/v1/demo/intake', { ...f.body, message: 'plan arbitrary behavior' }); assert.equal((await vague.json()).servedBy, null); assert.equal(f.counts().started, 0)
  const prepare = { op: 'prepare', id: f.id, requestId: randomUUID() }; assert.equal((await f.post('/api/v1/task-plan', prepare, 'https://evil.invalid')).status, 403); assert.equal((await f.post('/api/v1/task-plan', { ...prepare, recipe: 'arbitrary' })).status, 400); assert.equal(f.counts().prepared, 0)
})
function dom (plan, fail = false) {
  const calls = [], nested = [], timers = []
  function el (tag, cls, text) { return { tag, className: cls, textContent: text || '', children: [], events: {}, appendChild (c) { this.children.push(c) }, addEventListener (k, f) { this.events[k] = f }, setAttribute () {} } }
  const body = el('div'), flat = n => [n, ...n.children.flatMap(flat)], code = fs.readFileSync(path.join(__dirname, '../../demo/assets/app.js'), 'utf8'), fn = code.slice(code.indexOf('  function createWorkActivity ('), code.indexOf('  function renderProjectWork ('))
  const sandbox = { body, runId: plan.id, el, clear: n => { n.children = [] }, t: k => k, crypto: { randomUUID }, AbortController, setInterval: () => 1, clearInterval () {}, setTimeout: (f, ms) => { timers.push({ f, ms }); return 1 }, clearTimeout () {}, renderProjectWork: (turn, id, p) => nested.push({ id, p }), fetch: async (url, opts) => { const b = opts.body ? JSON.parse(opts.body) : null; calls.push({ url, body: b }); if (b && fail) throw Error('lost'); return { ok: true, json: async () => b ? { run: { ...plan, preparation: { state: 'prepared' }, workRunId: 'work' }, work: { run: { id: 'work' }, approval: { nonce: 'ram-only' } } } : { run: plan } } } }
  vm.runInNewContext(fn + ';renderTaskPlan({body},runId)', sandbox)
  return { calls, nested, timers, nodes: () => flat(body), flush: async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)) } }
}
const plan = () => ({ id: randomUUID(), state: 'completed', executableRecipe: 'registered', evidence: { revision: 'a'.repeat(40), profile: 'context', files: [{ evidenceId: 'one', path: 'registered.js' }] }, result: { goal: '<script>untrusted</script>', steps: ['read'], acceptanceChecks: ['verify'], questions: [], risks: [], citations: [{ evidenceId: 'one', startLine: 1, endLine: 1, quote: 'untrusted text' }] } })
test('real UI displays draft safely and requires one deliberate preparation click; no coding approval is automatic', async () => {
  const p = plan(), f = dom(p); await f.flush(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].body, null); assert.ok(f.nodes().some(n => n.textContent === p.result.goal))
  const button = f.nodes().find(n => n.textContent === 'taskPlan.prepare'); button.events.click(); button.events.click(); await f.flush(); assert.equal(f.calls.filter(c => c.body).length, 1); assert.equal(f.calls[1].body.op, 'prepare'); assert.equal(f.nested.length, 1); assert.equal(f.nested[0].p.approval.nonce, 'ram-only')
})
test('history restores work without nonce and uncertain preparation offers only readback', async () => {
  const history = dom({ ...plan(), workRunId: 'work', preparation: { state: 'prepared' } }); await history.flush(); assert.equal(history.nested[0].p, null); assert.equal(history.nodes().some(n => n.textContent === 'taskPlan.prepare'), false)
  const f = dom(plan(), true); await f.flush(); f.nodes().find(n => n.textContent === 'taskPlan.prepare').events.click(); await f.flush(); assert.equal(f.calls.filter(c => c.body).length, 1); assert.ok(f.nodes().some(n => n.textContent === 'taskPlan.refresh')); assert.equal(f.nodes().some(n => n.textContent === 'taskPlan.prepare'), false)
})
test('unregistered draft and pending job cannot prepare; pending jobs poll and offer cancellation', async () => {
  const draft = dom({ ...plan(), executableRecipe: null }); await draft.flush(); assert.equal(draft.nodes().some(n => n.textContent === 'taskPlan.prepare'), false)
  const pending = dom({ id: randomUUID(), state: 'running' }); await pending.flush(); assert.ok(pending.timers.some(t => t.ms === 2500)); assert.ok(pending.nodes().some(n => n.textContent === 'taskPlan.cancel')); assert.equal(pending.calls.filter(c => c.body).length, 0)
})
