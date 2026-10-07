'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {createXiangxiangOperationsReadAdapter}=require('../context/adapters/xiangxiangOperationsRead')
const {evaluateInvestigation}=require('./intelligence')
const {renderInvocationSummary}=require('./invocationBrief')
const {complete}=require('../subscription/claudeClient')
const row={sourceId:'invocation:one',invocationId:'one',role:'memory_completion',requestId:null,state:'succeeded',model:'claude-sonnet',actualModel:'claude-sonnet-5-5',at:'2026-10-07T12:00:00Z',startedAt:'2026-10-07T11:59:55Z',finishedAt:'2026-10-07T12:00:00Z',durationMs:5000,modelResultObserved:true,usage:{inputTokens:10,outputTokens:4},usageBasis:'provider_result_model_usage',evidenceBasis:'owner_bridge_invocation_ledger'}
test('ledger and session failures are isolated; actual tokens do not become billing or a named email',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'inv-evidence-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let reads=0
 const adapter=createXiangxiangOperationsReadAdapter({dataDir:dir,executionReader:async()=>{throw Error('unavailable')},invocationReader:async()=>{reads++;return {state:'partial',records:[row],coverageStartedAt:row.startedAt,omitted:0}}})
 const snapshot=await adapter.methods.readInvestigation({query:'credit'}),s=snapshot.results.find(x=>x.fields.section==='execution').fields
 assert.equal(reads,1);assert.equal(s.state,'partial');assert.equal(s.records[0].actualModel,row.actualModel);assert.equal(s.coverage.sessions,'unavailable');assert.equal(s.coverage.invocations,'partial')
 const report=evaluateInvestigation({focus:'cost',sections:[{...s,sourceId:'execution:receipt'}]})
 assert.equal(report.billingConfirmed,false);assert.ok(report.findings.some(f=>f.kind==='model_result_observed'))
 assert.equal(report.invocationCorrelation.requestGroups.length,0);assert.equal(report.invocationCorrelation.unlinkedCalls,1)
 const summary=renderInvocationSummary(report,{message:'什麼在扣 credit？'})
 assert.match(summary.text,/claude-sonnet-5-5/);assert.match(summary.text,/10/);assert.match(summary.text,/4/);assert.match(summary.text,/未確認/);assert.doesNotMatch(summary.text,/已證實扣款/)
 assert.equal(summary.references[0].recordId,'invocation:one')
})
test('only exact host request identity groups calls; equal time and similar names never link a schedule',()=>{
 const calls=[{...row,role:'chat_completion',requestId:'request-a',phase:'answer'}, {...row,sourceId:'invocation:two',invocationId:'two',requestId:'request-a',phase:'evidence_review'}, {...row,sourceId:'invocation:three',invocationId:'three',requestId:null}]
 const report=evaluateInvestigation({focus:'cost',sections:[{section:'execution',sourceId:'s',state:'partial',records:calls},{section:'schedules',sourceId:'t',state:'ok',records:[{sourceId:'memory_completion',state:'PAUSED',at:row.at}]}]})
 assert.equal(report.invocationCorrelation.requestGroups.length,1);assert.deepEqual(report.invocationCorrelation.requestGroups[0].invocationIds,['one','two']);assert.equal(report.invocationCorrelation.unlinkedCalls,1)
 assert.equal(report.findings.some(f=>f.kind==='candidate_link'),false);assert.equal(report.billingConfirmed,false)
 const failed=evaluateInvestigation({focus:'cost',sections:[{section:'execution',sourceId:'s',state:'partial',records:[{...row,state:'failed',modelResultObserved:false,actualModel:null,usage:null}]}]})
 assert.equal(failed.findings.some(f=>f.kind==='model_result_observed'),false);assert.match(renderInvocationSummary(failed,{message:'credit'}).text,/unknown|not recorded/)
})
test('many observed calls cannot crowd the unconfirmed billing boundary out of the findings budget',()=>{
 const report=evaluateInvestigation({focus:'cost',sections:[{section:'execution',sourceId:'s',state:'partial',records:Array.from({length:24},(_,i)=>({...row,sourceId:'invocation:'+i,invocationId:String(i)}))},{section:'billing',sourceId:'billing:s',state:'unconnected',records:[]}]})
 assert.equal(report.findings.length,30);assert.equal(report.findings[0].kind,'charge_unverified');assert.equal(report.billingConfirmed,false)
})
test('Claude result projects selected-model and helper usage separately, with dispatch only after preflight',async()=>{
 let dispatched=0
 const r=await complete({onDispatch:()=>dispatched++,catalogue:async()=>[{value:'sonnet',resolvedModel:'claude-sonnet-5-5',supportsEffort:true,supportedEffortLevels:['medium']}],run:async args=>args.includes('auth')?{loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty'}:{type:'result',subtype:'success',result:'ok',modelUsage:{'claude-sonnet-5-5':{inputTokens:13,outputTokens:4,cacheReadInputTokens:42,costUSD:3},'claude-haiku-4-5':{inputTokens:2,outputTokens:1}}}},{prompt:'hello',model:'claude-sonnet',effort:'medium'})
 assert.equal(dispatched,1);assert.deepEqual(r.usage,{inputTokens:13,outputTokens:4,cacheReadInputTokens:42});assert.equal(r.usage.totalTokens,undefined);assert.equal(r.usageByModel[1].usage.inputTokens,2)
 await assert.rejects(complete({onDispatch:()=>dispatched++,run:async()=>({loggedIn:false})},{prompt:'hello',model:'claude-sonnet'}));assert.equal(dispatched,1)
})
