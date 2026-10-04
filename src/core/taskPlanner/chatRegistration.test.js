'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto')
const { createPlanner } = require('./service'), { PROFILES, hash, classify } = require('./contract')
const { createMemoryRunStore } = require('../operating/runStore')
const OWNER = { id: 'owner', role: 'owner' }, HEAD = 'a'.repeat(40)
function fixture (options = {}) {
  const store = createMemoryRunStore(), calls = [], evidence = { project: 'aroma-agent-backend', profile: options.profile || 'context', revision: HEAD, bootCommit: HEAD, committedOnly: true, files: PROFILES[options.profile || 'context'].map((path, i) => ({ path, evidenceId: 'plan-' + i, content: "'use strict'\n", lineCount: 2, sha256: hash("'use strict'\n") })) }
  const packet = () => ({ state: 'ok', retrievedAt: new Date().toISOString(), evidence, hash: hash(JSON.stringify(evidence)) })
  const source = { verify: a => { if (a.role !== 'owner') throw Error('permission_denied') }, read: async () => packet() }
  const provider = { preflight: async () => ({ model: 'gpt-6.1-sol', billing: 'chatgpt-subscription' }), complete: async () => ({ model: 'gpt-6.1-sol', billing: 'chatgpt-subscription', text: JSON.stringify({ goal: 'Improve source snapshots', steps: ['Read source'], acceptanceChecks: ['Returned data must remain independent'], questions: options.questions || [], risks: [], citations: [{ evidenceId: 'plan-0', startLine: 1, endLine: 1, quote: "'use strict'" }] }) }) }
  const build = () => createPlanner({ source, provider, store, bootCommit: HEAD, registerTask: async b => { calls.push(b); if (options.start) return options.start(b); return { run: { id: randomUUID(), workflow: 'project_task', state: 'queued', input: Object.fromEntries(Object.entries(b).filter(([k]) => k !== 'op')) }, approval: null } }, findTask: async requestId => options.find ? options.find(requestId) : null })
  const service = build(), plan = service.start(OWNER, { message: options.profile === 'interface' ? 'plan Xiangxiang interface buttons' : 'plan Xiangxiang context snapshots', requestId: randomUUID(), conversationId: 'chat-' + randomUUID() })
  const input = { id: plan.id, requestId: randomUUID(), goal: 'Improve snapshots', criteria: ['Caller changes do not change source'], editable: ['src/context/toolGateway.js'] }
  return { service, store, calls, evidence, input, build, ready: () => service.wait(plan.id) }
}
test('new explicit improvement requests route to planning; vague and forbidden targets clarify', () => {
  assert.equal(classify('香香，幫我改善即時資料查詢的範圍快照').profile, 'context')
  assert.equal(classify('香香，幫我改善這個問題').clarification, true)
  assert.equal(classify('幫我開發 production context writes').clarification, true)
  assert.equal(classify('hello'), null)
  assert.equal(classify('香香，幫我修正 Live Context 查詢範圍快照'), null)
})
test('chat registration starts drafts only after explicit scope confirmation, survives history, never stores nonce', async () => {
  const f = fixture(); await f.ready(); assert.equal(f.calls.length, 0)
  const v = await f.service.registerTask(OWNER, f.input); assert.equal(f.calls.length, 1); assert.equal(v.run.taskRunId, v.task.run.id); assert.equal(v.task.approval, null); assert.equal(f.calls[0].bootCommit, HEAD)
  assert.equal(f.calls[0].op, 'start'); assert.equal(f.store.get(f.input.id).registrationPreparation.state, 'prepared')
  const replay = await f.service.registerTask(OWNER, f.input); assert.equal(replay.task.approval, null); assert.equal(replay.task.run.id, v.task.run.id); assert.equal(f.calls.length, 1)
  await assert.rejects(f.service.registerTask(OWNER, { ...f.input, goal: 'different' }), /request_conflict/)
  assert.equal(f.build().get(OWNER, f.input.id).taskRunId, v.task.run.id)
})
test('tampered plans, foreign actors, wider files, clarification and interface profiles cannot register', async () => {
  const f = fixture(); await f.ready()
  await assert.rejects(f.service.registerTask({ id: 'ivy', role: 'member' }, f.input), /permission_denied/)
  await assert.rejects(f.service.registerTask(OWNER, { ...f.input, editable: ['.env'] }), /invalid_request/)
  f.store.get(f.input.id).result.goal = 'tampered'; const r = f.store.get(f.input.id); r.result.goal = 'tampered'; f.store.save(r)
  await assert.rejects(f.service.registerTask(OWNER, f.input), /invalid_request/); assert.equal(f.calls.length, 0)
  for (const opts of [{ questions: ['Which behavior?'] }, { profile: 'interface' }]) { const other = fixture(opts); await other.ready(); await assert.rejects(other.service.registerTask(OWNER, other.input), /invalid_request/); assert.equal(other.calls.length, 0) }
})
test('source drift fails before draft authority', async () => {
  const f = fixture(); await f.ready(); f.evidence.files[0].content += '// drift'; f.evidence.files[0].lineCount = 2; f.evidence.files[0].sha256 = hash(f.evidence.files[0].content)
  await assert.rejects(f.service.registerTask(OWNER, f.input), /evidence_changed/); assert.equal(f.calls.length, 0)
})
test('uncertain registration preserves intent and readback links the actual matching task without replay', async () => {
  let actual
  const f = fixture({ start: b => { actual = { run: { id: randomUUID(), workflow: 'project_task', input: Object.fromEntries(Object.entries(b).filter(([k]) => k !== 'op')) }, approval: { nonce: 'never-persist' } }; throw Error('lost response') }, find: async () => actual }); await f.ready()
  await assert.rejects(f.service.registerTask(OWNER, f.input), /lost response/); assert.equal(f.store.get(f.input.id).registrationPreparation.state, 'pending')
  await assert.rejects(f.service.registerTask(OWNER, f.input), /request_conflict/)
  const v = await f.service.refreshRegistration(OWNER, f.input.id); assert.equal(v.taskRunId, actual.run.id); assert.equal(f.calls.length, 1); assert.equal(JSON.stringify(f.store.all()).includes('never-persist'), false)
})
test('readback rejects mismatched scope and a concurrent registration cannot duplicate authority', async () => {
  let release; const pending = new Promise(resolve => { release = resolve })
  const f = fixture({ start: async b => { await pending; return { run: { id: randomUUID(), workflow: 'project_task', input: Object.fromEntries(Object.entries(b).filter(([k]) => k !== 'op')) }, approval: null } } }); await f.ready()
  const p = f.service.registerTask(OWNER, f.input); await new Promise(r => setImmediate(r)); await assert.rejects(f.service.registerTask(OWNER, f.input), /request_conflict/); release(); await p; assert.equal(f.calls.length, 1)
  const mismatch = fixture({ start: async () => { throw Error('lost') }, find: async () => ({ run: { id: randomUUID(), workflow: 'project_task', input: { goal: 'foreign' } } }) }); await mismatch.ready(); await assert.rejects(mismatch.service.registerTask(OWNER, mismatch.input)); await assert.rejects(mismatch.service.refreshRegistration(OWNER, mismatch.input.id), /invalid_worker_result/); assert.equal(mismatch.store.get(mismatch.input.id).taskRunId, undefined)
})
