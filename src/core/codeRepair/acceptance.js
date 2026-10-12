'use strict'
// Host-owned, immutable regression checks. Copied into each disposable workspace;
// they import the actual committed modules, never a model-supplied substitute.
const SOURCE = String.raw`'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto')
process.env.AROMA_DATA_DIR = path.join(__dirname, 'scratch')
fs.mkdirSync(process.env.AROMA_DATA_DIR, { recursive: true })
const { createDevelopmentPlan } = require('./src/core/developmentPlan/service'), { createMemoryRunStore, createRunStore } = require('./src/core/operating/runStore')
const { createDispatcher } = require('./src/capability/dispatcher'), { register } = require('./src/capability/registry'), { registerAgent, getHealth, updateHealthFromEvent } = require('./src/capability/agents')
const owner = { id: 'owner', role: 'owner' }, delay = ms => new Promise(r => setTimeout(r, ms))
const report = () => ({ state: 'ok', repository: 'owner/repo', branch: 'main', retrievedAt: new Date().toISOString(), remoteCommit: 'a'.repeat(40), tests: { state: 'not_published', sha: 'a'.repeat(40) }, runtime: { deployedCommit: 'b'.repeat(40), bootCommit: 'b'.repeat(40) }, packs: [] })
const reply = () => ({ model: 'gpt-6-astra', billing: 'chatgpt-subscription', text: JSON.stringify({ nextStep: 'verify', rationale: 'verify', evidenceIds: ['runtime'], acceptanceChecks: ['verify'], questions: [] }) })
async function terminalScenario (timeout) {
 let release, enter, receipts = 0; const ready = new Promise(r => { enter = r })
 const service = createDevelopmentPlan({ source: { verify () {}, read: async () => report() }, store: createMemoryRunStore(), timeoutMs: timeout ? 40 : 1000,
 provider: { preflight: async () => {}, complete: () => { enter(); return new Promise(r => { release = r }) } }, onFinish: () => { receipts++; return { state: 'queued' } } })
 const run = service.start(owner, { recipe: 'development-proposal-v1', requestId: randomUUID() }); await ready
 if (!timeout) service.cancel(owner, run.id)
 await service.wait(run.id); const before = service.get(owner, run.id)
 // Release the uncooperative provider only AFTER the terminal acknowledgement.
 release(reply()); await delay(30); const after = service.get(owner, run.id)
 assert.equal(after.state, timeout ? 'timed_out' : 'cancelled'); assert.equal(after.result, null)
 assert.equal(receipts, 1, 'exactly one terminal memory receipt'); assert.equal(after.steps.filter(s => ['cancelled','timed_out','completed','failed'].includes(s.stage)).length, 1)
 assert.equal(after.finishedAt, before.finishedAt); assert.deepEqual(after.steps, before.steps)
}
test('planner cancellation keeps one terminal outcome and receipt after late completion', () => terminalScenario(false))
test('planner timeout keeps one terminal outcome and receipt after late completion', () => terminalScenario(true))
test('workflow default directories are separate while manager-runs stays compatible', () => {
 const a = createRunStore(), b = createRunStore({ workflow: 'development_proposal' }), c = createRunStore({ workflow: 'code_diagnosis' })
 const row = workflow => ({ id: randomUUID(), workflow, steps: [], sections: [] })
 const ar = row('daily_briefing'), br = row('development_proposal'), cr = row('code_diagnosis'); a.save(ar); b.save(br); c.save(cr)
 assert.deepEqual(a.all().map(x => x.id), [ar.id]); assert.deepEqual(b.all().map(x => x.id), [br.id]); assert.deepEqual(c.all().map(x => x.id), [cr.id])
 assert.equal(fs.existsSync(path.join(process.env.AROMA_DATA_DIR,'manager-runs',ar.id+'.json')),true)
 const explicit = createRunStore({ workflow: 'code_diagnosis', dir: path.join(process.env.AROMA_DATA_DIR,'explicit') }); explicit.save(cr); assert.equal(explicit.get(cr.id).id,cr.id)
})
function dispatchFixture (invoke) {
 const id = 'RepairCheck'+randomUUID().replaceAll('-',''), agent = 'repair-check-'+randomUUID()
 register({ id, version: 1, lifecycle: 'active', risk_tier: 'low', input_schema: {}, output_schema: {} })
 registerAgent({ id: agent, role: 'fixture', adapter: 'fixture', availability: 'local', status: 'active', provides: [{ capability: id, version: 1, seed_quality: 0, seed_cost: 'unknown' }] })
 const dispatcher = createDispatcher({ allowedAgentIds:[agent],fallback:false, adapters:{ [agent]:{ health:()=>({availability:'up',latencyMs:0}),invoke } } })
 return { dispatcher, agent, id, request:{ capabilityId:id,version:1,target:'dev',input:{},context:{} } }
}
test('missing worker cost stays unknown in dispatch, event and health', async () => {
 const f=dispatchFixture(async()=>({ok:true,output:{},cost:null})); const r=await f.dispatcher.dispatch(f.request)
 assert.equal(r.status,'ok'); assert.equal(r.cost,null); assert.equal(f.dispatcher.getEvents().at(-1).cost,null); assert.equal(getHealth(f.agent,f.id,1).cost,null)
})
test('throwing adapter cost stays unknown in failure result, event and health', async () => {
 const f=dispatchFixture(async()=>{throw Error('fixture_failure')}); const r=await f.dispatcher.dispatch(f.request)
 assert.equal(r.status,'failed'); assert.equal(r.cost,null); assert.equal(f.dispatcher.getEvents().at(-1).cost,null); assert.equal(getHealth(f.agent,f.id,1).cost,null)
})
test('unknown cost observations do not dilute a measured numeric average', () => {
 const event={agentId:'cost-'+randomUUID(), capabilityId:'CostCheck',version:1,success:true,latencyMs:2}
 updateHealthFromEvent({...event,cost:6}); updateHealthFromEvent({...event,cost:null}); const r=updateHealthFromEvent({...event,cost:10})
 assert.equal(r.cost,8); assert.equal(r.sample_count,3)
})
test('host immutable acceptance includes failure controls rather than trusting worker claims', () => {
 assert.throws(()=>createRunStore({workflow:'arbitrary'}),/invalid_workflow/)
 const f=dispatchFixture(async()=>({ok:true,output:{},cost:0})); assert.ok(f.agent)
})
`
module.exports = { SOURCE }
