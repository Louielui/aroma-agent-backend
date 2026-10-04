'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto')
const { createPlanner } = require('./service'), { classify, READ_PROFILES, hash, validateResult, validatePacket } = require('./contract')
const { createMemoryRunStore } = require('../operating/runStore'), { FAILURE_RECIPE, FAILURE_WORK_ORDER } = require('../projectWork/contract')
const OWNER = { id: 'owner', role: 'owner' }, HEAD = 'a'.repeat(40), MESSAGE = 'plan Xiangxiang unavailable context scope mutation snapshot repair'
function packet (profile = 'context') {
  const evidence = { project: 'aroma-agent-backend', profile, revision: HEAD, bootCommit: HEAD, committedOnly: true, files: READ_PROFILES[profile].map((p, i) => { const content = fs.readFileSync(path.join(__dirname, '../../..', p), 'utf8').replace(/\r\n/g, '\n'); return { path: p, evidenceId: 'plan-' + i, content, lineCount: content.split('\n').length, sha256: hash(content) } }) }
  return { state: 'ok', retrievedAt: new Date().toISOString(), evidence, hash: hash(JSON.stringify(evidence)) }
}
function result (p) { return { goal: 'Bounded repair', steps: ['Read source', 'Detach snapshots'], acceptanceChecks: ['Source mutation must not alter returned scope'], questions: [], risks: ['Other projects unavailable'], citations: [{ evidenceId: 'plan-1', startLine: 1, endLine: 1, quote: "'use strict'" }] } }
function fixture (options = {}) {
  const p = packet(), store = createMemoryRunStore(), counts = { model: 0, prepare: 0 }, sources = []
  const source = { verify: a => { if (a.role !== 'owner') throw Error('permission_denied') }, read: async (a, profile) => { const v = options.read ? await options.read(sources.length) : packet(profile); sources.push(v); return v } }
  const provider = { preflight: async () => ({ model: 'gpt-6.1-sol', billing: 'chatgpt-subscription' }), complete: async () => { counts.model++; const v = options.complete ? await options.complete() : result(p); return { model: 'gpt-6.1-sol', billing: 'chatgpt-subscription', text: JSON.stringify(v) } } }
  const service = createPlanner({ source, provider, store, bootCommit: HEAD, timeoutMs: options.timeoutMs || 1000, prepareWork: async b => { counts.prepare++; if (options.prepare) return options.prepare(b); return { run: { id: randomUUID(), workflow: 'project_work', requestId: b.requestId, source: { evidence: { revision: HEAD } }, workOrder: FAILURE_WORK_ORDER }, approval: { nonce: 'never-persist' } } } })
  const input = { message: MESSAGE, requestId: randomUUID(), conversationId: 'planner-chat-' + randomUUID() }
  return { service, store, counts, source, input }
}
test('routing is current explicit planning only, ambiguous or unrelated authority cannot execute', () => {
  assert.equal(classify(MESSAGE).profile, 'context'); assert.equal(classify('plan Xiangxiang work order button improvements').profile, 'interface')
  for (const text of ['plan production writes', 'plan .env changes', 'plan arbitrary behavior', 'plan context sidebar changes']) assert.equal(classify(text).clarification, true)
  for (const text of ['hello', 'approve', 'x'.repeat(1600)]) assert.equal(classify(text), null)
})
test('schema rejects extra authority, invented quotes and tampered source hashes', () => {
  const p = packet(), r = result(p); assert.equal(validateResult(r, p.evidence), true); assert.equal(validateResult({ ...r, recipe: FAILURE_RECIPE }, p.evidence), false)
  r.citations[0].quote = 'invented'; assert.equal(validateResult(r, p.evidence), false)
  p.evidence.files[0].content += 'changed'; assert.throws(() => validatePacket(p, 'context'), /context_unavailable/)
})
test('source-bound read-only plan requires independent preparation and never persists nonce', async () => {
  const f = fixture(), r = f.service.start(OWNER, f.input); await f.service.wait(r.id)
  const plan = f.service.get(OWNER, r.id); assert.equal(plan.state, 'completed'); assert.equal(plan.verification.testsExecuted, false); assert.equal(f.counts.prepare, 0); assert.equal(plan.executableRecipe, FAILURE_RECIPE)
  const key = randomUUID(), v = await f.service.prepare(OWNER, { id: r.id, requestId: key }); assert.equal(v.work.approval.nonce, 'never-persist'); assert.equal(f.counts.prepare, 1)
  assert.equal(JSON.stringify(f.store.all()).includes('never-persist'), false)
  const replay = await f.service.prepare(OWNER, { id: r.id, requestId: key }); assert.equal(replay.work.approval, null); assert.equal(f.counts.prepare, 1)
  await assert.rejects(f.service.prepare(OWNER, { id: r.id, requestId: randomUUID() }), /request_conflict/)
})
test('unregistered plans and clarification cannot dispatch, and request replays stay bound', async () => {
  const f = fixture(); f.input.message = 'plan Xiangxiang context query improvements'; const r = f.service.start(OWNER, f.input); await f.service.wait(r.id)
  assert.equal(f.service.get(OWNER, r.id).executableRecipe, null); await assert.rejects(f.service.prepare(OWNER, { id: r.id, requestId: randomUUID() }), /invalid_request/)
  assert.equal(f.service.start(OWNER, f.input).reused, true); assert.equal(f.counts.model, 1)
  assert.throws(() => f.service.start(OWNER, { ...f.input, message: MESSAGE }), /request_conflict/)
  const q = fixture({ complete: async () => ({ ...result(packet()), questions: ['Specify desired behavior'] }) }), run = q.service.start(OWNER, q.input); await q.service.wait(run.id); assert.equal(q.service.get(OWNER, run.id).state, 'needs_clarification'); assert.equal(q.service.get(OWNER, run.id).executableRecipe, null)
})
test('source changed during planning or before preparation never issues authority', async () => {
  const changed = () => { const p = packet(); p.evidence.files[0].content += '\n// changed'; p.evidence.files[0].sha256 = hash(p.evidence.files[0].content); p.evidence.files[0].lineCount++; p.hash = hash(JSON.stringify(p.evidence)); return p }
  const f = fixture({ read: async i => i ? changed() : packet() }), r = f.service.start(OWNER, f.input); await f.service.wait(r.id); assert.equal(f.service.get(OWNER, r.id).reason, 'evidence_changed'); assert.equal(f.service.get(OWNER, r.id).result, null)
  const g = fixture({ read: async i => i >= 2 ? changed() : packet() }), run = g.service.start(OWNER, g.input); await g.service.wait(run.id); await assert.rejects(g.service.prepare(OWNER, { id: run.id, requestId: randomUUID() }), /evidence_changed/); assert.equal(g.counts.prepare, 0)
})
test('uncertain preparation keeps intent and never repeats a write', async () => {
  const f = fixture({ prepare: () => { throw Error('response_lost') } }), r = f.service.start(OWNER, f.input); await f.service.wait(r.id); const input = { id: r.id, requestId: randomUUID() }
  await assert.rejects(f.service.prepare(OWNER, input)); await assert.rejects(f.service.prepare(OWNER, input), /request_conflict/); assert.equal(f.counts.prepare, 1)
})
test('timeout keeps the slot until an uncooperative provider settles and has one terminal result', async () => {
  let release; const slow = new Promise(resolve => { release = resolve }), f = fixture({ timeoutMs: 35, complete: () => slow }), r = f.service.start(OWNER, f.input)
  await f.service.wait(r.id); assert.equal(f.service.get(OWNER, r.id).state, 'timed_out'); assert.throws(() => f.service.start(OWNER, { ...f.input, requestId: randomUUID() }), /worker_busy/)
  release(result(packet())); for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve))
  const saved = f.service.get(OWNER, r.id); assert.equal(saved.result, null); assert.equal(saved.steps.filter(s => s.stage === 'timed_out').length, 1)
})
test('cancellation, permission, extra inputs and restart remain closed', async () => {
  const f = fixture(); assert.throws(() => f.service.start({ id: 'ivy', role: 'manager' }, f.input), /permission_denied/); assert.throws(() => f.service.start(OWNER, { ...f.input, files: ['.env'] }), /invalid_request/)
  const r = f.service.start(OWNER, f.input); f.service.cancel(OWNER, r.id); await f.service.wait(r.id); assert.equal(f.service.get(OWNER, r.id).state, 'cancelled')
  const persisted = { ...f.service.get(OWNER, r.id), state: 'running' }; f.store.save(persisted)
  createPlanner({ source: f.source, provider: {}, store: f.store, bootCommit: HEAD }); assert.equal(f.store.get(r.id).state, 'interrupted'); assert.equal(f.store.get(r.id).result, null)
})

test('planning defaults to medium and creates a provider matching each requested reasoning level', async () => {
  const seen=[]
  const service=createPlanner({source:{verify:()=>{},read:async(a,profile)=>packet(profile)},store:createMemoryRunStore(),bootCommit:HEAD,
    providerFor:settings=>{seen.push(settings);return {preflight:async()=>({model:'gpt-6.1-sol',billing:'chatgpt-subscription'}),complete:async()=>({model:'gpt-6.1-sol',billing:'chatgpt-subscription',text:JSON.stringify(result(packet()))})}}})
  for(const effort of [undefined,'low','medium','high','xhigh','max']) {
    const input={message:MESSAGE,requestId:randomUUID(),conversationId:randomUUID(),...(effort?{effort}:{})}
    const run=service.start(OWNER,input);await service.wait(run.id)
    assert.equal(service.get(OWNER,run.id).effort,effort||'medium');assert.equal(service.get(OWNER,run.id).state,'completed')
    assert.deepEqual(seen.at(-1),{model:'gpt-6.1-sol',effort:effort||'medium'})
    assert.equal(service.start(OWNER,input).reused,true)
    if(effort)assert.throws(()=>service.start(OWNER,{...input,effort:effort==='low'?'medium':'low'}),/request_conflict/)
  }
  assert.equal(seen.length,6)
  for(const effort of ['ultra','none','fast',null,{},''])assert.throws(()=>service.start(OWNER,{message:MESSAGE,requestId:randomUUID(),conversationId:randomUUID(),effort}),/invalid_request/)
})
