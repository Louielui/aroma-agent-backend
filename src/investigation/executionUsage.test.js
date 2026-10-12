'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {evaluateInvestigation}=require('./intelligence')
const at='2026-10-09T03:00:00Z'
const request='12345678-1234-4234-8234-123456789012'
const call=(id='one',extra={})=>({sourceId:'invocation:'+id,invocationId:id,requestId:request,linkBasis:'host_request_identity',phase:'answer',role:'chat_completion',state:'succeeded',startedAt:at,finishedAt:'2026-10-09T03:00:03Z',dispatchedAt:at,model:'claude-sonnet',actualModel:'claude-sonnet-5-5',modelResultObserved:true,billingRoute:'claude-subscription',usageBasis:'provider_result_model_usage',usage:{inputTokens:10,outputTokens:4},evidenceBasis:'owner_bridge_invocation_ledger',...extra})
const section=(records,extra={})=>({section:'execution',sourceId:'execution:fixture',state:'partial',retrievedAt:at,records,...extra})
const report=sections=>evaluateInvestigation({focus:'cost',sections})
test('cost enquiry contains an execution-usage chain through the actual read adapter',async()=>{
 const adapter=require('../context/adapters/xiangxiangOperationsRead').createXiangxiangOperationsReadAdapter({dataDir:__dirname,executionReader:async()=>({state:'ok',records:[]}),invocationReader:async()=>({state:'partial',records:[call()],coverageStartedAt:at,retained:1,omitted:0})})
 const snapshot=await adapter.methods.readInvestigation({sections:['execution','billing']})
 const r=report(snapshot.results.map(x=>({sourceId:x.sourceId,retrievedAt:x.retrievedAt,...x.fields})))
 assert.equal(r.executionUsage.version,1);assert.equal(r.executionUsage.chains[0].executionState,'CONFIRMED');assert.equal(r.executionUsage.chains[0].usageState,'CONFIRMED');assert.equal(r.executionUsage.billingState,'UNAVAILABLE');assert.equal(r.billingConfirmed,false)
 assert.deepEqual(r.executionUsage.chains[0].usageModels[0].subtotal,{inputTokens:10,outputTokens:4})
})
test('duplicate call receipts count once, phases are not labelled retries, helper usage stays separate',()=>{
 const primary=call('one',{usageByModel:[{model:'claude-sonnet-5-5',usage:{inputTokens:10,outputTokens:4}},{model:'claude-haiku-4-5',usage:{inputTokens:2,outputTokens:1}}]})
 const r=report([section([primary,structuredClone(primary),call('two',{phase:'evidence_review',usage:{inputTokens:0,outputTokens:0}})])]).executionUsage
 const c=r.chains[0];assert.equal(c.observedAttempts,2);assert.equal(c.successfulResults,2);assert.equal(c.retryCount,null)
 assert.deepEqual(c.usageModels.find(x=>x.model==='claude-sonnet-5-5').subtotal,{inputTokens:10,outputTokens:4})
 assert.deepEqual(c.usageModels.find(x=>x.model==='claude-haiku-4-5').subtotal,{inputTokens:2,outputTokens:1});assert.equal(r.duplicateReceipts,1)
})
test('failed or interrupted calls leave request coverage partial and usage unknown rather than zero',()=>{
 const r=report([section([call(),call('failed',{state:'failed',modelResultObserved:false,actualModel:null,usage:null,usageByModel:[]})])]).executionUsage
 assert.equal(r.chains[0].observedAttempts,2);assert.equal(r.chains[0].usageState,'SUPPORTED');assert.equal(r.chains[0].unknownUsageCalls,1);assert.equal(r.chains[0].usageComplete,false)
 assert.deepEqual(r.chains[0].usageModels[0].subtotal,{inputTokens:10,outputTokens:4})
})
test('conflicting invocation identity and mismatched primary/helper counters are withheld',()=>{
 const r=report([section([call(),call('one',{usage:{inputTokens:999}}),call('other',{requestId:'request-two',usageByModel:[{model:'claude-sonnet-5-5',usage:{inputTokens:500}}]})])]).executionUsage
 assert.equal(r.conflictingReceipts,1);assert.equal(r.chains.some(c=>c.jobId===request),false)
 assert.equal(r.chains[0].usageState,'CONTRADICTED');assert.deepEqual(r.chains[0].usageModels,[])
})
test('cumulative session snapshots keep latest value, not sum; context model cannot receive session totals',()=>{
 const s={sourceId:'codex-session:session',sessionId:'session',evidenceBasis:'owner_codex_session_metadata',model:'gpt-6.1-sol',usageBasis:'latest_recorded_cumulative_session_snapshot_not_sum',usageAt:at,usage:{total_tokens:100},lastStartedAt:at,startedTurns:2,completedTurns:1,turnIdentityComplete:true,completeFile:true}
 const r=report([section([s,{...s,usageAt:'2026-10-09T03:01:00Z',usage:{total_tokens:150}}])]).executionUsage
 const c=r.chains[0];assert.deepEqual(c.cumulativeUsage,{total_tokens:150});assert.equal(c.actualModel,null);assert.deepEqual(c.usageModels,[]);assert.equal(c.observedStartedTurns,2)
})
test('session same-time conflicts and source failures never produce zero-use or complete inventory',()=>{
 const s={sourceId:'codex-session:session',sessionId:'session',evidenceBasis:'owner_codex_session_metadata',usageBasis:'latest_recorded_cumulative_session_snapshot_not_sum',usageAt:at,usage:{total_tokens:100}}
 const r=report([section([s,{...s,usage:{total_tokens:99}}]),{section:'work',sourceId:'w',state:'unavailable',records:[]}]).executionUsage
 assert.equal(r.chains[0].usageState,'CONTRADICTED');assert.equal(r.chains[0].cumulativeUsage,null);assert.equal(r.inventoryComplete,false);assert.equal(r.inventory.find(x=>x.source==='worker_records').state,'UNAVAILABLE')
})
test('last-turn usage is not summed as complete invocation usage and cannot overlap cumulative sessions',()=>{
 const r=report([section([call('one',{usageBasis:'provider_last_turn_usage'}),call('two',{usageBasis:'provider_last_turn_usage'})])]).executionUsage
 assert.equal(r.chains[0].usageModels[0].subtotal,null);assert.equal(r.chains[0].usageComplete,false);assert.equal(r.chains[0].usageState,'SUPPORTED')
})
test('same names or times never attribute unlinked lane calls to a worker or schedule',()=>{
 const r=report([section([call('one',{requestId:null,role:'memory_completion'})]),{section:'work',sourceId:'work:fixture',state:'partial',records:[{sourceId:'same-time',kind:'worker/project-runs',state:'completed',startedAt:at,model:'claude-sonnet-5-5',requestId:'request-one'}]},{section:'schedules',sourceId:'s',state:'ok',records:[{sourceId:'memory_completion',state:'ACTIVE',at}]}]).executionUsage
 assert.equal(r.chains.find(c=>c.kind==='bridge_lane').jobId,null);assert.equal(r.chains.find(c=>c.kind==='worker_record').usageState,'UNKNOWN');assert.equal(r.chains.find(c=>c.kind==='worker_record').executionState,'SUPPORTED')
 assert.equal(r.chains.every(c=>c.billingState!=='CONFIRMED'),true)
})
test('bilingual fixed cost answers show bounded work usage and exact references, not charge attribution',()=>{
 const r=report([section([call('one',{requestId:null})]),{section:'billing',sourceId:'billing:fixture',state:'unconnected',records:[]}])
 for(const message of ['哪些工作用了多少額度？','Which jobs used how many tokens?']){
  const v=require('./costFindings').renderCostFindings(r,{message});assert.match(v.text,/執行與用量|Execution and usage/);assert.match(v.text,/10/);assert.match(v.text,/4/);assert.match(v.text,/未確認|not confirmed/)
  assert.ok(v.references.some(x=>x.recordId==='invocation:one'));assert.doesNotMatch(v.text,/已確認扣款|confirmed charge/)
 }
})

test('malformed and overflowing counters remain unknown with per-field coverage, never a numeric reset',()=>{
 const r=report([section([call('one',{usage:{inputTokens:Number.MAX_SAFE_INTEGER,outputTokens:1}}),call('two',{usage:{inputTokens:1,outputTokens:1}}),call('three',{usage:{inputTokens:1,outputTokens:-1}})])]).executionUsage
 const c=r.chains[0],m=c.usageModels[0]
 assert.equal(m.subtotal.inputTokens,null);assert.equal(m.subtotal.outputTokens,2);assert.equal(m.counterCoverage.outputTokens,2);assert.equal(m.receiptCount,3)
 assert.equal(c.usageComplete,false);assert.equal(c.usageState,'SUPPORTED');assert.equal(c.unknownUsageCalls,1)
})

test('inventory counts have identity receipts and conflicting worker state is withheld in both languages',()=>{
 const r=report([section([call()]),{section:'work',sourceId:'work:fixture',state:'partial',records:[{sourceId:'worker-one',kind:'worker/project-runs',state:'completed'},{sourceId:'worker-one',kind:'worker/project-runs',state:'failed'}]}])
 const v=require('./executionUsageView')
 for(const message of ['查用量','Usage']){
  const view=v.renderExecutionUsage(r,{message})
  assert.match(view.text,/紀錄矛盾|conflicting records/);assert.doesNotMatch(view.text,/記錄狀態 `completed`|recorded state `completed`/)
  assert.ok(view.references.some(x=>x.recordId==='invocation:one'&&x.fields.invocationId==='one'))
 }
 assert.equal(r.evidenceModel.assertions.find(a=>a.facet==='execution_usage_model').value[0],'claude-sonnet-5-5')
 assert.equal(r.executionUsage.inventory.find(x=>x.source==='worker_records').observedRecords,1)
})

test('missing helper-model counters keep the request usage partial',()=>{
 const c=report([section([call('one',{usageByModel:[{model:'claude-haiku-4-5',usage:{outputTokens:1}}]})])]).executionUsage.chains[0]
 assert.equal(c.usageState,'SUPPORTED');assert.equal(c.usageComplete,false);assert.equal(c.unknownUsageCalls,1)
 assert.deepEqual(c.usageModels.find(m=>m.model==='claude-haiku-4-5').subtotal,{outputTokens:1})
})
