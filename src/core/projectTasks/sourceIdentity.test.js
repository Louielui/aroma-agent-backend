'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { createMemoryRunStore } = require('../operating/runStore')
const { createRepositoryRequests } = require('./repositoryRequest')
const { createChatTasks } = require('./chat')

const owner = { id: 'owner', role: 'owner' }
const oldCommit = 'a'.repeat(40)
const newCommit = 'b'.repeat(40)

function fixture () {
  const store = createMemoryRunStore()
  const tasks = createRepositoryRequests({
    store, enabled: () => true, localEnabled: () => true, lock: () => () => {},
    record (row, stage, facts) { row.steps.push({ stage, facts }); store.save(row) }
  })
  return { tasks, store }
}

for (const lane of [{ execution: 'local' }, {}]) {
  test('request identity includes the source commit on the ' + (lane.execution || 'subscription') + ' lane', () => {
    const { tasks, store } = fixture()
    const input = { ...lane, requestId: randomUUID(), bootCommit: oldCommit, goal: '  Repair query\r\nhandling.  ' }
    const old = tasks.request(owner, input).run
    const aliasId = randomUUID()
    tasks.request(owner, { ...input, requestId: aliasId })
    const before = store.get(old.id)
    for (const requestId of [input.requestId, aliasId]) {
      assert.throws(() => tasks.request(owner, { ...input, requestId, bootCommit: newCommit }), /request_conflict/)
    }
    const fresh = { ...input, requestId: randomUUID(), bootCommit: newCommit, goal: 'Repair query\nhandling.' }
    const next = tasks.request(owner, fresh).run
    assert.notEqual(next.id, old.id)
    assert.deepEqual(tasks.request(owner, fresh).run, next)
    assert.equal(tasks.request(owner, { ...fresh, goal: input.goal, requestId: randomUUID() }).run.id, next.id)
    assert.deepEqual(store.get(old.id), before)
    assert.equal(store.all().length, 2)
  })
}

test('another source cannot replace the source of a pending request during scope selection', async () => {
  const { tasks, store } = fixture()
  const row = tasks.request(owner, { requestId: randomUUID(), bootCommit: oldCommit, goal: 'Repair query handling.' }).run
  await assert.rejects(tasks.scope(owner, { id: row.id, bootCommit: newCommit, criteria: ['Keep behavior'], editable: ['src/work.js'], readonly: [] }), /source_changed/)
  assert.deepEqual(store.get(row.id), row)
})

test('chat refuses a matching request receipt from another commit', async () => {
  const input = { requestId: randomUUID(), message: 'ask Codex to repair query handling' }
  const chat = createChatTasks({ bootCommit: newCommit, env: { READ_ACCESS: 'on' },
    request: async () => ({run:{workflow:'project_task',id:randomUUID(),requestId:input.requestId,input:{goal:input.message,bootCommit:oldCommit}}}) })
  await assert.rejects(chat.prepare(owner, input), /invalid_worker_result/)
})
