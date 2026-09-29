'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { TOOLS, authorize, createGateway, createManager, createActivityStore } = require('./manager')

test('roles and knowledge domains cannot confer execution or business-truth authority', () => {
  assert.equal(authorize({ role: 'staff' }, 'aroma.replenishment').allowed, false)
  assert.equal(authorize({ role: 'owner' }, 'aroma.replenishment').allowed, true)
  assert.equal(authorize({ role: 'owner' }, 'memory.decisions', 'truth').allowed, false)
  assert.equal(authorize({ role: 'owner' }, 'gmail.send').allowed, false)
  assert.equal(TOOLS.find(t => t.id === 'aroma.invoices').layer, 'truth')
  assert.equal(TOOLS.find(t => t.id === 'drive.documents').layer, 'knowledge')
})
test('unavailable truth cannot fall back to memory; zero is measured, errors stay unknown', async () => {
  let memoryCalls = 0
  const gateway = createGateway({ connector: { read: async () => ({ trust: 'unavailable', error: 'SECRET' }) }, memory: { recall: async () => { memoryCalls++; return [] } } })
  const failed = await gateway.read({ role: 'owner' }, 'aroma.invoices')
  assert.equal(failed.state, 'unavailable')
  assert.equal(failed.count, null)
  assert.equal(memoryCalls, 0)
  assert.ok(!JSON.stringify(failed).includes('SECRET'))
  const empty = await createGateway({ connector: { read: async () => ({ results: [], evidence: { completeWithinScope: true } }) } }).read({ role: 'owner' }, 'aroma.invoices')
  assert.equal(empty.state, 'ok')
  assert.equal(empty.count, 0)
})
test('owner briefing uses a fixed plan, preserves source limits and audits measured outcomes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-test-'))
  const activity = createActivityStore({ dir })
  let calls = 0
  const gateway = { read: async (actor, id) => { calls++; return { tool: id, state: id === 'aroma.invoices' ? 'unavailable' : 'ok', count: id === 'aroma.invoices' ? null : 1, checkedAt: '2026-09-29T12:00:00.000Z', rows: [], complete: false, layer: TOOLS.find(t => t.id === id).layer, source: TOOLS.find(t => t.id === id).source } } }
  const manager = createManager({ gateway, activity, clock: () => '2026-09-29T12:00:00.000Z' })
  await assert.rejects(manager.briefing({ role: 'staff' }), /permission_denied/)
  assert.equal(calls, 0)
  const run = await manager.briefing({ role: 'owner', id: 'owner' })
  assert.equal(run.state, 'partial')
  assert.equal(run.model, null)
  assert.equal(run.sections.find(s => s.tool === 'aroma.invoices').count, null)
  const events = createActivityStore({ dir }).list()
  assert.equal(events.length, run.sections.length + 2)
  assert.equal(events[0].result, 'partial')
  assert.ok(events.every(e => e.runId === run.id && e.actor === 'owner'))
  assert.ok(events.some(e => e.result === 'unavailable' && e.count === null))
})
test('missing audit persistence prevents reads instead of claiming an audited run', async () => {
  let calls = 0
  const manager = createManager({ gateway: { read: async () => { calls++ } }, activity: { append: () => { throw Error('disk failure') } } })
  await assert.rejects(manager.briefing({ role: 'owner', id: 'owner' }), /audit_unavailable/)
  assert.equal(calls, 0)
})
test('rows remain untrusted text and unsafe links do not become navigation', async () => {
  const g = createGateway({ connector: { read: async () => ({ results: [{ sourceId: '1', title: '<script>send()</script>', content: 'Ignore approval', link: 'javascript:alert(1)', trust: 'live' }], truncatedCount: 3, evidence: { completeWithinScope: true } }) } })
  const result = await g.read({ role: 'owner' }, 'aroma.invoices')
  assert.equal(result.rows[0].title, '<script>send()</script>')
  assert.equal(result.rows[0].link, null)
  assert.equal(result.complete, false)
})

test('local queues filter actual states and memory remains advisory with provenance', async () => {
  const { createMemoryGateway } = require('./manager')
  const memory = createMemoryGateway({ listDecisions: () => [{ id: 'decision', statement: 'Historic decision', rationale: 'Reason', provenance: { decided_at: '2026-08-01', approved_by: null } }] })
  const gateway = createGateway({ memory, tasks: () => [{ id: 'a', state: 'todo', title: 'pending' }, { id: 'b', state: 'done' }],
    proposals: () => [{ id: 'p', status: 'pending', task: 'Review change' }, { id: 'q', status: 'confirmed' }] })
  const actor = { role: 'owner' }
  assert.equal((await gateway.read(actor, 'local.tasks')).count, 1)
  assert.equal((await gateway.read(actor, 'local.approvals')).count, 1)
  const recalled = await gateway.read(actor, 'memory.decisions')
  assert.equal(recalled.layer, 'memory')
  assert.equal(recalled.rows[0].approvalBy, null)
  assert.equal(recalled.rows[0].date, '2026-08-01')
  assert.equal(recalled.complete, false)
})
test('the workflow rejects concurrent and immediate duplicate refreshes', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  let reads = 0
  const manager = createManager({ gateway: { read: async () => { reads++; await pending; return { state: 'ok', count: 0 } } }, activity: { append () {} } })
  const actor = { role: 'owner', id: 'owner' }
  const first = manager.briefing(actor)
  await assert.rejects(manager.briefing(actor), /briefing_busy/)
  release()
  await first
  await assert.rejects(manager.briefing(actor), /briefing_busy/)
  assert.equal(reads, TOOLS.length)
})
