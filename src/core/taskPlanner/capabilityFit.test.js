'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto')
const { createPlanner } = require('./service'), { READ_PROFILES, PROFILES, hash } = require('./contract')
const { createMemoryRunStore } = require('../operating/runStore')
const OWNER = { id: 'owner', role: 'owner' }, HEAD = 'a'.repeat(40)
async function fixture (capability, selection) {
  const evidence = { project: 'aroma-agent-backend', profile: 'interface', revision: HEAD, bootCommit: HEAD, committedOnly: true,
    files: READ_PROFILES.interface.map((path, i) => ({ path, evidenceId: 'plan-' + i, content: "'use strict'", lineCount: 1, sha256: hash("'use strict'") })) }
  const result = { editableFiles: capability?.status === 'supported' ? PROFILES.interface : [], goal: 'Make EMAIL a persistent topic workspace', steps: ['Create topic storage'], acceptanceChecks: ['Reopen a topic and retain follow-ups'], questions: [], risks: [], citations: [{ evidenceId: 'plan-0', startLine: 1, endLine: 1, quote: "'use strict'" }], ...(capability ? { capability } : {}) }
  if (selection === null) delete result.editableFiles
  else if (selection !== undefined) result.editableFiles = selection
  const calls = [], prompts = [], store = createMemoryRunStore()
  const service = createPlanner({ bootCommit: HEAD, store, source: { verify: () => {}, read: async () => ({ state: 'ok', retrievedAt: new Date().toISOString(), evidence, hash: hash(JSON.stringify(evidence)) }) },
    provider: { preflight: async () => ({ model: 'gpt-6.1-sol', billing: 'chatgpt-subscription' }), complete: async p => { prompts.push(JSON.parse(p)); return { model: 'gpt-6.1-sol', billing: 'chatgpt-subscription', text: JSON.stringify(result) } } },
    registerTask: async input => { calls.push(input); throw Error('draft_must_not_start') }, executionRpc: { task: async b => calls.push(b), work: async b => calls.push(b) } })
  const run = service.start(OWNER, { message: 'plan Xiangxiang sidebar topic workspace', conversationId: randomUUID(), requestId: randomUUID() })
  await service.wait(run.id)
  return { service, run: service.get(OWNER, run.id), calls, prompts, store }
}
test('unsupported whole requirements stop before drafting, preserve the requested goal and explain missing capabilities', async () => {
  const capability = { status: 'unsupported', explanation: 'This requires durable topic storage and backend routes beyond navigation layout.', missingCapabilities: ['Persistent topic storage', 'Topic conversation routing'] }
  const f = await fixture(capability)
  assert.equal(f.run.state, 'out_of_scope'); assert.deepEqual(f.run.result.capability, capability)
  assert.equal(f.run.result.goal, 'Make EMAIL a persistent topic workspace')
  assert.deepEqual(f.prompts[0].capabilities.editableFiles, PROFILES.interface)
  await assert.rejects(f.service.executeConfirmed(OWNER, { id: f.run.id, requestId: randomUUID(), planHash: f.run.planHash }), /invalid_request/)
  await assert.rejects(f.service.registerTask(OWNER, { id: f.run.id, requestId: randomUUID(), goal: f.run.result.goal, criteria: f.run.result.acceptanceChecks, editable: PROFILES.interface }), /invalid_request/)
  assert.equal(f.calls.length, 0)
})
test('new plans cannot silently omit the full-requirement capability assessment', async () => {
  const f = await fixture(null)
  assert.equal(f.run.state, 'failed'); assert.equal(f.run.reason, 'invalid_worker_result'); assert.equal(f.calls.length, 0)
})

test('supported complete requirements remain executable and do not start without confirmation', async () => {
  const f = await fixture({ status: 'supported', explanation: 'The registered files contain all required behavior.', missingCapabilities: [] })
  assert.equal(f.run.state, 'completed'); assert.equal(f.run.executionAvailable, true)
  assert.equal(f.run.verification.matched, true); assert.equal(f.calls.length, 0)
})
test('contradictory supported assessments and invented write authority are rejected', async () => {
  for (const capability of [
    { status: 'supported', explanation: 'Ready', missingCapabilities: ['Backend storage'] },
    { status: 'unsupported', explanation: 'Not supported', missingCapabilities: [] },
    { status: 'supported', explanation: 'Ready', missingCapabilities: [], editableFiles: ['.env'] }
  ]) { const f = await fixture(capability); assert.equal(f.run.reason, 'invalid_worker_result'); assert.equal(f.calls.length, 0) }
})

test('fresh executable plans require a nonempty unique subset of their host profile', async () => {
  const capability = { status: 'supported', explanation: 'CSS change', missingCapabilities: [] }
  for (const selection of [null, [], ['.env'], ['src/demo/assets/app.js'], [PROFILES.interface[1], PROFILES.interface[1]]]) {
    const f = await fixture(capability, selection)
    assert.equal(f.run.reason, 'invalid_worker_result')
    assert.equal(f.calls.length, 0)
  }
  const f = await fixture(capability, [PROFILES.interface[1]])
  assert.equal(f.run.state, 'completed')
  assert.deepEqual(f.run.result.editableFiles, [PROFILES.interface[1]])
})
