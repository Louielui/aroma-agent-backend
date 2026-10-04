'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), { randomUUID } = require('node:crypto')
const TASK = randomUUID(), PLAN = randomUUID(), WORK = randomUUID()
function fixture (options = {}) {
  const calls = [], nested = [], timers = []
  function el (tag, cls, text) { return { tag, className: cls || '', textContent: text || '', children: [], events: {}, disabled: false, checked: false, appendChild (c) { this.children.push(c); return c }, addEventListener (k, f) { this.events[k] = f }, setAttribute () {} } }
  const body = el('div'), flat = n => [n, ...n.children.flatMap(flat)]
  let plan = { id: PLAN, state: 'completed', executableRecipe: null, evidence: { profile: 'context', revision: 'a'.repeat(40), files: [{ evidenceId: 'one', path: 'source.js' }] }, result: { goal: '<script>example</script>', steps: ['inspect'], acceptanceChecks: ['independent snapshot'], questions: [], risks: [], citations: [{ evidenceId: 'one', startLine: 1, endLine: 1, quote: 'source' }] }, ...(options.history ? { taskRunId: TASK, registrationPreparation: { state: 'prepared' } } : {}) }
  let task = { id: TASK, workflow: 'project_task', state: 'awaiting_approval', input: { goal: plan.result.goal, criteria: ['independent snapshot'], editable: ['src/context/toolGateway.js'], bootCommit: 'a'.repeat(40) }, registration: { workOrder: { readonlyFiles: ['src/context/contextResult.js'] } }, generated: { testCode: 'protected tests', expectedTests: 3 }, acceptanceReview: { verdict: 'pass' }, expiresAt: new Date(Date.now() + 60000).toISOString() }
  const taskValue = () => ({ run: task, approval: task.state === 'awaiting_approval' ? { id: TASK, hash: 'a'.repeat(64), nonce: 'b'.repeat(48), expiresAt: task.expiresAt } : null })
  const code = fs.readFileSync(path.join(__dirname, '../../demo/assets/app.js'), 'utf8'), fn = code.slice(code.indexOf('  function renderTaskPlan ('), code.indexOf('  function renderProjectWork ('))
  const sandbox = { body, runId: PLAN, el, clear: n => { n.children = [] }, t: k => k, crypto: { randomUUID }, AbortController, setTimeout: (f, ms) => { timers.push({ f, ms }); return 1 }, clearTimeout () {}, renderProjectWork: (turn, id, value) => nested.push({ id, value }), fetch: async (url, opts) => {
    const b = opts.body ? JSON.parse(opts.body) : null; calls.push({ url, body: b })
    if (b && options.fail) throw Error('lost response')
    let value
    if (url.includes('task-plan')) { if (b) plan = { ...plan, taskRunId: TASK, registrationPreparation: { state: 'prepared' } }; value = { run: plan } }
    else if (!b) value = taskValue()
    else if (b.op === 'approve') { task = { ...task, state: 'registered' }; value = taskValue() }
    else if (b.op === 'prepare') { task = { ...task, workRunId: WORK, preparation: { state: 'prepared' } }; value = { ...taskValue(), work: { run: { id: WORK }, approval: { nonce: 'coding-is-independent' } } } }
    else if (b.op === 'cancel') { task = { ...task, state: 'cancelled' }; value = taskValue() }
    return { ok: true, json: async () => value }
  } }
  vm.runInNewContext(fn + ';renderTaskPlan({body},runId)', sandbox)
  const nodes = () => flat(body), flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)) }, click = text => { const b = nodes().find(n => n.tag === 'button' && n.textContent === text); assert.ok(b, text); assert.equal(b.disabled, false, text); return b.events.click() }
  return { calls, nested, timers, nodes, flush, click, setTask: patch => { task = { ...task, ...patch } } }
}
async function confirm (f) { const checks = f.nodes().filter(n => n.tag === 'input'); checks[1].checked = true; checks[1].events.change(); checks[2].checked = true; checks[2].events.change() }
test('chat prepares a new draft only after explicit goal, criteria and scope confirmation; duplicate clicks do not repeat', async () => {
  const f = fixture(); await f.flush(); assert.equal(f.calls.filter(c => c.body).length, 0); assert.ok(f.nodes().some(n => n.textContent === '<script>example</script>'))
  const b = f.nodes().find(n => n.textContent === 'projectTask.start'); assert.equal(b.disabled, true); await confirm(f); b.events.click(); b.events.click(); await f.flush()
  const writes = f.calls.filter(c => c.body); assert.equal(writes.length, 1); assert.equal(writes[0].body.op, 'register'); assert.deepEqual(writes[0].body.criteria, ['independent snapshot']); assert.deepEqual(writes[0].body.editable, ['src/context/toolGateway.js']); assert.equal(f.nested.length, 0)
  assert.ok(f.nodes().some(n => n.textContent === 'projectTask.approve')); assert.equal(f.nodes().find(n => n.textContent === 'projectTask.approve').disabled, true)
})
test('registration approval and work preparation are independent clicks; coding nonce reaches only existing work card', async () => {
  const f = fixture({ history: true }); await f.flush(); const approve = f.nodes().find(n => n.textContent === 'projectTask.approve'); assert.equal(approve.disabled, true)
  const check = f.nodes().find(n => n.tag === 'input'); check.checked = true; check.events.change(); await f.click('projectTask.approve'); await f.flush(); assert.equal(f.calls.filter(c => c.body).length, 1); assert.equal(f.nested.length, 0)
  await f.click('projectTask.prepare'); await f.flush(); assert.deepEqual(f.calls.filter(c => c.body).map(c => c.body.op), ['approve', 'prepare']); assert.equal(f.nested[0].value.approval.nonce, 'coding-is-independent')
  assert.equal(f.calls.some(c => c.url.includes('project-work') && c.body), false)
})
test('history and refresh restore links through reads; expired tickets and uncertain writes never autoapprove or retry', async () => {
  const history = fixture({ history: true }); await history.flush(); assert.equal(history.calls.filter(c => c.body).length, 0); await history.click('projectTask.refresh'); await history.flush(); assert.equal(history.calls.filter(c => c.body).length, 0)
  history.setTask({ expiresAt: new Date(0).toISOString() }); await history.click('projectTask.refresh'); await history.flush(); assert.equal(history.nodes().some(n => n.textContent === 'projectTask.approve'), false)
  const f = fixture({ fail: true }); await f.flush(); await confirm(f); await f.click('projectTask.start'); await f.flush(); assert.ok(f.nodes().some(n => n.textContent === 'taskPlan.uncertain')); await f.click('taskPlan.refresh'); await f.flush(); assert.equal(f.calls.filter(c => c.body).length, 1); assert.equal(f.nodes().some(n => n.textContent === 'projectTask.start'), false)
})
test('invalid criteria can be corrected locally without issuing a request', async () => {
  const f = fixture(); await f.flush(); await confirm(f); const criteria = f.nodes().filter(n => n.tag === 'textarea')[1]; criteria.value = ''; await f.click('projectTask.start'); await f.flush(); assert.equal(f.calls.filter(c => c.body).length, 0); assert.ok(f.nodes().some(n => n.textContent === 'taskPlan.invalidDraft'))
  criteria.value = 'Corrected criterion'; await f.click('projectTask.start'); await f.flush(); assert.equal(f.calls.filter(c => c.body).length, 1)
})
