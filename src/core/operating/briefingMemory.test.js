'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { createGateway, OWNER } = require('../../memory/governed')
const { createTestStore } = require('../../memory/structuredStore')
const { createBriefingMemory } = require('./briefingMemory')
const { createGateway: createReadGateway } = require('./gateway')
function fixture () {
  const store = createTestStore()
  const gateway = createGateway({ store, engine: { forScope: () => ({ recall: async () => [] }) } })
  const run = { id: randomUUID(), state: 'completed', finishedAt: new Date().toISOString(), sections: [] }
  return { gateway, store, run, memory: createBriefingMemory({ gateway, getRun: id => id === run.id ? run : null }) }
}
test('briefing follow-up is an idempotent owner candidate with original text and run provenance; approval activates context', async () => {
  const { memory, gateway, run } = fixture()
  const input = { requestId: randomUUID(), kind: 'todo', subject: 'Briefing acceptance', text: 'Check the acceptance invoice tomorrow.' }
  await assert.rejects(memory.propose({ id: 'worker', role: 'agent' }, run.id, input), /permission_denied/)
  const row = await memory.propose(OWNER, run.id, input)
  assert.equal(row.status, 'candidate'); assert.equal(row.type, 'semantic')
  assert.equal(row.details.taskState, 'open'); assert.equal(row.details.runId, run.id)
  assert.equal(row.source.attribution, 'owner_statement'); assert.equal(row.text, input.text)
  assert.equal(row.details.runFinishedAt, run.finishedAt)
  assert.equal((await memory.propose(OWNER, run.id, input)).id, row.id)
  await assert.rejects(memory.propose(OWNER, run.id, { ...input, text: 'Different instruction' }), /request_conflict/)
  assert.deepEqual(await memory.recall(), [])
  await gateway.transition(OWNER, row.id, row.version, 'approve')
  const recalled = await memory.recall()
  assert.equal(recalled.length, 1); assert.equal(recalled[0].taskState, 'open')
  assert.equal(recalled[0].originalDate, row.source.at); assert.equal(recalled[0].approvalBy, 'owner')
  assert.equal((await gateway.recall(OWNER, 'Briefing acceptance invoice')).some(r => r.id === row.id), true)
})
test('only approved current context is used; corrections preserve history and completed todos drop out', async () => {
  const { memory, gateway, run } = fixture()
  for (const kind of ['decision', 'preference', 'todo']) {
    const input = { requestId: randomUUID(), kind, subject: kind + ' acceptance', text: 'First acceptance rule.' }
    const old = await memory.propose(OWNER, run.id, input)
    await gateway.transition(OWNER, old.id, old.version, 'approve')
    const next = await memory.propose(OWNER, run.id, { ...input, requestId: randomUUID(), text: 'Corrected acceptance rule.', supersedes: old.id })
    assert.equal((await memory.recall()).find(r => r.id === old.id).content, input.text)
    await gateway.transition(OWNER, next.id, next.version, 'approve')
    assert.equal((await gateway.get(OWNER, old.id)).status, 'superseded')
    assert.ok(!(await memory.recall()).some(r => r.id === old.id))
    assert.ok((await memory.recall()).some(r => r.id === next.id))
  }
  const rows = await gateway.list(OWNER)
  const todo = rows.find(r => r.status === 'active' && r.details.category === 'todo')
  const done = await memory.propose(OWNER, run.id, { requestId: randomUUID(), kind: 'todo', subject: todo.subject, text: 'Completed acceptance only.', supersedes: todo.id, taskState: 'completed' })
  await gateway.transition(OWNER, done.id, done.version, 'approve')
  const expired = await gateway.propose(OWNER, { type: 'preference', subject: 'Expired', text: 'Expired', scope: 'private:owner', source: todo.source })
  const active = await gateway.transition(OWNER, expired.id, expired.version, 'approve')
  assert.ok(!(await memory.recall()).some(r => r.id === done.id))
  assert.ok((await memory.recall()).some(r => r.id === active.id))
  const futureMemory = createBriefingMemory({ gateway, getRun: () => run, clock: () => '2100-01-01T00:00:00.000Z' })
  const expiring = await gateway.propose(OWNER, { type: 'decision', subject: 'Time limited', text: 'Expires tomorrow', scope: 'private:owner', source: todo.source, expiresAt: new Date(Date.now() + 86400000).toISOString() })
  await gateway.transition(OWNER, expiring.id, expiring.version, 'approve')
  assert.ok((await memory.recall()).some(r => r.id === expiring.id))
  assert.ok(!(await futureMemory.recall()).some(r => r.id === expiring.id))
})
test('follow-up rejects unknown or unfinished runs and cross-subject corrections', async () => {
  const { memory, gateway, run } = fixture()
  const input = { requestId: randomUUID(), kind: 'decision', subject: 'Acceptance', text: 'Use version one.' }
  await assert.rejects(memory.propose(OWNER, randomUUID(), input), /run_not_found/)
  run.state = 'running'; await assert.rejects(memory.propose(OWNER, run.id, input), /run_not_finished/); run.state = 'partial'
  const old = await memory.propose(OWNER, run.id, input); await gateway.transition(OWNER, old.id, old.version, 'approve')
  await assert.rejects(memory.propose(OWNER, run.id, { ...input, requestId: randomUUID(), subject: 'Another subject', supersedes: old.id }), /invalid_supersession/)
})
test('disconnected sources, failed reads and measured empty/nonempty results remain distinct', async () => {
  let calls = 0
  const read = async connection => createReadGateway({ connection: async () => connection, connector: { read: async () => { calls++; throw Error('SECRET') } } }).read(OWNER, 'drive.documents')
  for (const reason of ['credential_missing', 'source_disabled', 'not_implemented']) {
    const result = await read({ registered: false, reason })
    assert.equal(result.availability, 'not_connected'); assert.equal(result.reason, reason); assert.equal(result.count, null)
  }
  assert.equal(calls, 0)
  const failure = await read({ registered: true, reason: 'none' })
  assert.equal(failure.availability, 'read_failed'); assert.equal(failure.count, null); assert.ok(!JSON.stringify(failure).includes('SECRET'))
  for (const n of [1, 0]) {
    const result = await createReadGateway({ connector: { read: async () => ({ results: Array.from({ length: n }, () => ({ content: 'Measured' })) }) } }).read(OWNER, 'drive.documents')
    assert.equal(result.availability, 'connected'); assert.equal(result.count, n)
  }
})
