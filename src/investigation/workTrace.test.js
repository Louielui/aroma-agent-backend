'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createWorkTrace, withWorkTrace, currentWorkTrace, encodeWorkTrace, decodeWorkTrace } = require('./workTrace')
const { createBridge } = require('../subscription/bridge')
const { createInvocationLedger } = require('./invocations')
const { buildExecutionUsage } = require('./executionUsage')
const token = 'a'.repeat(64)
async function bridge(t, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'work-trace-'))
  const ledger = createInvocationLedger({ file: path.join(dir, 'ledger.json') })
  const server = createBridge({ token, clientOptions: {}, memoryEnabled: true, backgroundModel: 'claude-sonnet', invocationLedger: ledger, claudeFn: fn })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  t.after(async () => { await new Promise(r => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }) })
  const post = (route, body, headers = {}) => fetch('http://127.0.0.1:' + server.address().port + route, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  return { ledger, post, dir }
}
const result = { text: 'ok', model: 'claude-sonnet', actualModel: 'claude-sonnet-5-5', billing: 'claude-subscription', stopReason: 'end_turn', usageBasis: 'provider_result_model_usage', usage: { inputTokens: 10, outputTokens: 2 } }
test('work identity is private, revision-scoped and async isolated; retries retain work identity only', async () => {
  const a = createWorkTrace('mail_analysis', 'PRIVATE mailbox revision 1', 'analysis')
  const b = createWorkTrace('mail_analysis', 'PRIVATE mailbox revision 1', 'analysis', 2)
  assert.equal(a.workId, b.workId); assert.notEqual(a.runId, b.runId)
  assert.notEqual(a.workId, createWorkTrace('mail_analysis', 'PRIVATE mailbox revision 2', 'analysis').workId)
  await Promise.all([withWorkTrace(a, async () => { await new Promise(r => setTimeout(r, 10)); assert.deepEqual(currentWorkTrace(), a) }), withWorkTrace(b, async () => { assert.deepEqual(currentWorkTrace(), b) })])
  assert.equal(currentWorkTrace(), null); assert.doesNotMatch(JSON.stringify(a), /PRIVATE/)
  const header = encodeWorkTrace(a, token); assert.deepEqual(decodeWorkTrace(header, token), a)
  assert.equal(decodeWorkTrace(header, 'b'.repeat(64)), null); assert.equal(decodeWorkTrace(header + 'a', token), null)
})
test('actual subscription adapter and bridge bind host work to provider receipt without provider metadata leakage', async t => {
  let body; const f = await bridge(t, async (options, input) => { body = input; options.onDispatch(); return result })
  const adapter = new (require('../adapters/CodexSubscriptionAdapter').CodexSubscriptionAdapter)({ model: 'claude-sonnet', request: async (route, input) => (await f.post(route, input)).json() })
  const trace = createWorkTrace('mail_analysis', 'PRIVATE', 'analysis')
  await withWorkTrace(trace, () => adapter.complete('PRIVATE', { workTrace: { fake: true } }))
  const row = f.ledger.read().records[0]
  assert.deepEqual(row.workTrace, trace); assert.equal(row.linkBasis, 'host_work_identity')
  assert.equal(body.workTrace, undefined); assert.equal(body.trace, undefined)
  assert.equal(JSON.stringify(row).includes('PRIVATE'), false)
})
test('memory callback accepts only signed transported trace; missing or forged context remains unlinked', async t => {
  const f = await bridge(t, async options => { options.onDispatch(); return result })
  const trace = createWorkTrace('mail_index', 'PRIVATE', 'extraction')
  const body = { messages: [{ role: 'user', content: 'PRIVATE' }] }
  await f.post('/v1/chat/completions', body, { 'x-xiangxiang-work-trace': encodeWorkTrace(trace, token) })
  assert.deepEqual(f.ledger.read().records[0].workTrace, trace)
  await f.post('/v1/chat/completions', body, { 'x-xiangxiang-work-trace': encodeWorkTrace(trace, 'b'.repeat(64)) })
  assert.equal(f.ledger.read().records[0].workTrace, null)
  await f.post('/v1/chat/completions', body)
  assert.equal(f.ledger.read().records[0].workTrace, null)
})
test('distinct run retries and model phases are counted separately, replay receipts only once, reload retains identity', async t => {
  let count = 0
  const f = await bridge(t, async options => { options.onDispatch(); if (++count === 1) throw Error('failure'); return result })
  const first = createWorkTrace('mail_index', 'PRIVATE', 'extraction', 1), second = createWorkTrace('mail_index', 'PRIVATE', 'extraction', 2)
  const body = { messages: [{ role: 'user', content: 'PRIVATE' }] }
  for (const trace of [first, second, second]) await f.post('/v1/chat/completions', body, { 'x-xiangxiang-work-trace': encodeWorkTrace(trace, token) })
  const rows = createInvocationLedger({ file: path.join(f.dir, 'ledger.json') }).read().records
  const report = buildExecutionUsage({ sections: [{ section: 'execution', sourceId: 'fixture', state: 'partial', records: [...rows, rows[0]] }] })
  const c = report.chains.find(r => r.kind === 'background_work')
  assert.equal(c.jobId, first.workId); assert.equal(c.observedRuns, 2); assert.equal(c.observedAttempts, 3); assert.equal(c.observedRetryRuns, 1)
  assert.equal(c.unknownUsageCalls, 1); assert.equal(c.usageComplete, false); assert.equal(c.billingState, 'UNAVAILABLE')
  assert.equal(report.duplicateReceipts, 1); assert.equal(c.requestCoverageComplete, false)
})
test('canonical mail analysis saves the same work/run identity as the actual adapter receipt across a failure and retry',async t=>{
 let calls=0
 const analysis={category:'notification',summary:'Fixture information',messageId:'abc',quote:'information',task:null,change:{kind:'none',messageId:'abc',quote:'information'}}
 const f=await bridge(t,async options=>{options.onDispatch();if(++calls===1)throw Error('fixture failure');return {...result,text:JSON.stringify(analysis)}})
 const store=require('../memory/structuredStore').createTestStore(),owner={owner:true}
 const message={id:'abc',threadId:'def',mailbox:'fixture@example.test',subject:'Fixture',from:'Fixture',body:'Fixture information',date:'2026-10-08T00:00:00Z',internalDate:'1791417600000',bodyState:'available'}
 const mailbox={status:()=>({mailbox:'fixture@example.test'}),lease:()=>()=>{},read:async()=>message}
 const adapter=new (require('../adapters/CodexSubscriptionAdapter').CodexSubscriptionAdapter)({model:'claude-sonnet',request:async(route,input)=>{const res=await f.post(route,input);if(!res.ok)throw Error('fixture_failure');return res.json()}})
 const memory=require('../company/mailMemory').createMailMemory({store,mailbox,analyzer:require('../company/mailAnalysis').createMailAnalyzer({adapterFactory:()=>adapter})})
 const captured=await memory.capture(owner,message)
 await assert.rejects(memory.analyze(owner,captured.id))
 const failed=await store.get(captured.id),first=failed.details.analysis.workTrace
 assert.equal(failed.details.analysis.state,'failed');assert.deepEqual(f.ledger.read().records[0].workTrace,first)
 await memory.analyze(owner,captured.id)
 const saved=await store.get(captured.id),second=saved.details.analysis.workTrace
 assert.equal(saved.details.analysis.state,'ready');assert.equal(second.recordId,captured.id)
 assert.equal(first.workId,second.workId);assert.notEqual(first.runId,second.runId);assert.equal(second.attempt,2)
 assert.deepEqual(f.ledger.read().records[0].workTrace,second)
 const outcome={state:'ready',at:new Date().toISOString()}
 assert.equal((await (await f.post('/work-outcome',{workTrace:second,outcome})).json()).recorded,true)
 assert.equal((await (await f.post('/work-outcome',{workTrace:second,outcome:{...outcome,state:'failed'}})).json()).recorded,false)
 assert.equal((await (await f.post('/work-outcome',{workTrace:{...second,runId:require('node:crypto').randomUUID()},outcome})).json()).recorded,false)
 const rows=createInvocationLedger({file:path.join(f.dir,'ledger.json')}).read().records
 assert.equal(rows[0].workOutcome.state,'ready');assert.equal(rows[0].workOutcome.basis,'host_checkpoint_report')
 const r=buildExecutionUsage({sections:[{section:'execution',sourceId:'fixture',state:'partial',records:rows}]})
 assert.equal(r.chains[0].recordId,captured.id);assert.equal(r.chains[0].runs.find(r=>r.runId===second.runId).outcomeState,'SUPPORTED')
 for(const message of ['查工作用量','Which work used tokens?']){
  const view=require('./executionUsageView').renderExecutionUsage({readOnly:true,focus:'cost',executionUsage:r},{message})
  assert.match(view.text,/電郵分析|Mail analysis/);assert.match(view.text,/未獨立核證|not independently verified/);assert.match(view.text,/ready/)
  assert.doesNotMatch(view.text,/fixture@example|Fixture information/)
 }
})
test('canonical memory indexing transports signed work context to Hindsight and retains receipt identity after reload',async t=>{
 const f=await bridge(t,async options=>{options.onDispatch();return result})
 let doc,header
 const env={XIANGXIANG_MEMORY:'on',HINDSIGHT_URL:'http://127.0.0.1:8888',HINDSIGHT_BANK:'xiangxiang-test-trace',HINDSIGHT_TOKEN:'fixture',CODEX_CHAT_BRIDGE_TOKEN:token}
 const engine=require('../memory/hindsight').createHindsight({env,transport:async(url,opts)=>{
  const bank=/banks\/([^/]+)/.exec(url)[1];const body=opts.body?JSON.parse(opts.body):null
  if(opts.method==='POST'&&url.endsWith('/memories')){
   header=opts.headers['x-xiangxiang-work-trace'];const r=await f.post('/v1/chat/completions',{messages:[{role:'user',content:'PRIVATE'}]},{'x-xiangxiang-work-trace':header});assert.equal(r.status,200)
   doc={id:body.items[0].document_id,bank_id:bank,original_text:body.items[0].content,memory_unit_count:1}
   return {ok:true,status:200,text:async()=>JSON.stringify({success:true,async:false,bank_id:bank,items_count:1})}
  }
  if(url.includes('/documents/'))return doc?{ok:true,status:200,text:async()=>JSON.stringify(doc)}:{ok:false,status:404}
  return {ok:true,status:200,text:async()=>JSON.stringify({})}
 }})
 const store=require('../memory/structuredStore').createTestStore(),{createGateway,OWNER}=require('../memory/governed'),gateway=createGateway({store,engine})
 const row=await gateway.observe(OWNER,{type:'episodic',subject:'Fixture',text:'OWNER SAID: Use green folders.',scope:'private:owner',policy:'owner_history',source:{kind:'conversation',id:'fixture',at:null,attribution:'historical_import'}})
 const indexed=await gateway.index(OWNER,row.id)
 assert.equal(indexed.index.state,'saved');assert.equal(indexed.index.workTrace.kind,'memory_index')
 assert.deepEqual(decodeWorkTrace(header,token),indexed.index.workTrace)
 const receipts=createInvocationLedger({file:path.join(f.dir,'ledger.json')}).read().records
 assert.deepEqual(receipts[0].workTrace,indexed.index.workTrace)
 await gateway.index(OWNER,row.id);assert.equal(f.ledger.read().records.length,1)
 assert.doesNotMatch(fs.readFileSync(path.join(f.dir,'ledger.json'),'utf8'),/OWNER SAID|green folders|PRIVATE/)
})
test('one run cannot be attributed to two different work records; outcome reporting cannot create invocations',async t=>{
 const f=await bridge(t,async options=>{options.onDispatch();return result})
 const trace=createWorkTrace('mail_index','fixture','extraction'),body={messages:[{role:'user',content:'PRIVATE'}]}
 for(const wt of [trace,{...trace,workId:createWorkTrace('memory_index','different','extraction').workId}])await f.post('/v1/chat/completions',body,{'x-xiangxiang-work-trace':encodeWorkTrace(wt,token)})
 const r=buildExecutionUsage({sections:[{section:'execution',sourceId:'fixture',state:'partial',records:f.ledger.read().records}]})
 assert.equal(r.chains.length,0);assert.equal(r.gaps.every(g=>g.kind==='conflicting_work_run'),true)
 assert.equal((await f.post('/work-outcome',{workTrace:trace,outcome:{state:'ready',at:'2026-10-09T00:00:00Z'},prompt:'run'})).status,400)
 assert.equal(f.ledger.read().records.length,2)
})
