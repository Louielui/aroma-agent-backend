'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {createBridge}=require('../subscription/bridge'),{joinBackgroundModels}=require('./runtimeEvidence')
const {evaluateInvestigation}=require('./intelligence'),{renderRuntimeSummary}=require('./operationalBrief')
const at='2026-10-09T02:00:00.000Z'
const section=(records,extra={})=>({section:'configuration',sourceId:'configuration:fixture',state:'partial',retrievedAt:at,records,...extra})
const row=(extra={})=>({sourceId:'backend:mail_analysis',role:'mail_analysis',enabled:true,currentRunningState:'idle',model:'claude-sonnet',modelBasis:'bridge_route_configuration',evidenceBasis:'live_process_snapshot',at,...extra})

test('bridge records preserve configuration independently of active requests without extra inference', {timeout:5000},async t=>{
 let release,entered;const started=new Promise(r=>{entered=r}),waiting=new Promise(r=>{release=r});let calls=0
 const token='7'.repeat(64),server=createBridge({token,memoryEnabled:true,backgroundModel:'claude-sonnet',claudeFn:async()=>{calls++;entered();await waiting;return{text:'fixture',model:'claude-sonnet'}}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close()})
 const post=(route,body={})=>fetch('http://127.0.0.1:'+server.address().port+route,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)})
 const pending=post('/v1/chat/completions',{messages:[{role:'user',content:'fixture'}]});await started
 try{
  const metadata=await(await post('/runtime-metadata')).json(),route=metadata.records.find(r=>r.role==='memory_completion')
  assert.equal(route.model,'claude-sonnet');assert.equal(route.configuredModel,'claude-sonnet')
  const joined=joinBackgroundModels([row({model:null})],[{...route,model:'claude-opus-5-5',modelBasis:'in_flight_request_selection'}])[0]
  assert.equal(joined.model,'claude-sonnet');assert.equal(joined.modelBasis,'bridge_route_configuration');assert.equal(joined.currentRunningState,'idle')
  assert.equal(calls,1)
 }finally{release();await pending}
})

test('bilingual owner inventory separates enabled, running, configured and selected model evidence',()=>{
 const rows=[row({enabled:false,currentRunningState:'active'}),{...row(),sourceId:'bridge:memory_completion',role:'memory_completion',model:'claude-opus-5-5',configuredModel:'claude-sonnet',configuredEffort:'low',modelBasis:'in_flight_request_selection',currentRunningState:'active'}]
 const r=evaluateInvestigation({focus:'background',sections:[section(rows),{section:'execution',sourceId:'execution:fixture',state:'partial',retrievedAt:at,records:[{sourceId:'invocation:old',role:'memory_completion',model:'gpt-6.1-sol',actualModel:'gpt-6.1-sol',state:'succeeded',modelResultObserved:true,evidenceBasis:'owner_bridge_invocation_ledger',startedAt:'2026-10-01T01:00:00Z'}]}]})
 const selected=r.evidenceModel.assertions.find(a=>a.facet==='selected_request_model')
 assert.equal(selected.value,'claude-opus-5-5');assert.equal(selected.temporalScope,'current_runtime')
 assert.equal(r.evidenceModel.assertions.find(a=>a.recordId==='bridge:memory_completion'&&a.facet==='configured_model').value,'claude-sonnet')
 for(const message of ['目前哪些在運行？','What is running now?']){
  const text=renderRuntimeSummary(r,{message}).text
  assert.match(text,/停用|disabled/);assert.match(text,/正在執行|active/)
  assert.match(text,/claude-sonnet/);assert.match(text,/此次請求模型|selected request model/);assert.match(text,/claude-opus-5-5/)
  assert.doesNotMatch(text,/gpt-6.1-sol/)
  const line=text.split('\n').find(s=>s.startsWith('- '+(message.includes('目前')?'電郵分析':'Mail analysis')))
  assert.match(line,/啟用狀態：已停用|enablement: disabled/)
  const bridgeLine=text.split('\n').find(s=>s.startsWith('- '+(message.includes('目前')?'記憶模型請求':'Memory model request')))
  assert.match(bridgeLine,/設定模型：`claude-sonnet`.*此次請求模型：`claude-opus-5-5`|configured model: `claude-sonnet`.*selected request model: `claude-opus-5-5`/)
 }
})

test('historical model results remain on their exact lane, never attributed to current components',()=>{
 const old={sourceId:'invocation:one',role:'memory_completion',state:'succeeded',modelResultObserved:true,actualModel:'past-model',evidenceBasis:'owner_bridge_invocation_ledger',startedAt:'2026-10-01T01:00:00Z',finishedAt:'2026-10-01T01:00:03Z'}
 for(const message of ['現在有哪些工作？','What jobs exist now?']){
  const r=evaluateInvestigation({focus:'background',sections:[section([row()]),{section:'execution',sourceId:'execution:fixture',state:'partial',retrievedAt:at,records:[old,{...old,sourceId:'failed',state:'failed',actualModel:'failed-model'},{...old,sourceId:'undated',finishedAt:null,actualModel:'undated-model'}]}]})
  const x=renderRuntimeSummary(r,{message});assert.match(x.text,/歷史模型呼叫|Historical model calls/);assert.match(x.text,/past-model/)
  assert.doesNotMatch(x.text,/failed-model|undated-model/)
  assert.doesNotMatch(x.text.split('\n').find(s=>s.includes('Mail analysis:')||s.includes('電郵分析：')),/past-model/)
  assert.equal(x.references.find(ref=>ref.recordId===old.sourceId).sourceId,'execution:fixture')
 }
})

test('unknown boolean fields and scheduler enablement failures preserve missing evidence',async()=>{
 const {createBackendRuntimeReader}=require('./runtimeEvidence')
 const read=await createBackendRuntimeReader({clock:()=>at,mailMemory:{runtimeStatus:()=>({enabled:true,analysisConnected:true,analysisActive:true})},mailScheduler:{status:()=>({})},memory:{status:()=>({enabled:true,active:true})}}).read()
 assert.equal(read.records.find(r=>r.role==='mail_analysis').enabled,null)
 assert.equal(read.records.find(r=>r.role==='memory_outbox').currentRunningState,'unknown')
 const failing=await createBackendRuntimeReader({clock:()=>at,mailMemory:{runtimeStatus:()=>({enabled:true,analysisConnected:true,analysisActive:true})},mailScheduler:{status:()=>{throw Error('fixture')}}}).read()
 const r=evaluateInvestigation({focus:'background',sections:[section(failing.records)]})
 assert.equal(r.evidenceModel.assertions.find(a=>a.recordId==='backend:mail_analysis'&&a.facet==='enabled').state,'UNAVAILABLE')
 assert.equal(r.evidenceModel.assertions.find(a=>a.recordId==='backend:mail_analysis'&&a.facet==='running').value,'active')
})

test('independent current observations use the latest valid observation and preserve transitions',()=>{
 const {currentActivity}=require('./evidenceState'),older='2026-10-09T01:59:00.000Z'
 const r=evaluateInvestigation({focus:'background',sections:[section([row({at:older,currentRunningState:'active'}),row()])]})
 assert.equal(currentActivity(r,'configuration:fixture','backend:mail_analysis','active'),'idle')
 assert.ok(r.evidenceModel.transitions.some(t=>t.facet==='running'))
})

test('semantic review cannot rescue stale or unavailable enablement and configured-model observations',()=>{
 const {bindClaim}=require('./semanticAnswer')
 for(const extra of [{observationState:'unavailable'},{at:'2026-10-01T00:00:00Z'}]){
  const r=evaluateInvestigation({focus:'background',sections:[section([row(extra)])]})
  for(const[field,value]of [['enabled',true],['model','claude-sonnet'],['currentRunningState','idle']]){
   const claim={id:'c1',text:'Observed background state.',kind:'observation',evidenceState:'confirmed',temporalScope:'current',references:[{sourceId:'configuration:fixture',recordId:'backend:mail_analysis',field,value}]}
   assert.equal(bindClaim(claim,r).reason,'runtime_not_established')
  }
 }
})

test('actual read adapter continues other authorized sources after runtime source failure',async t=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'xx-background-generalization-'))
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.writeFileSync(path.join(dir,'model-center.json'),JSON.stringify({brain:{model:'claude-opus-5-5',effort:'medium'}}))
 let runtimeReads=0,executionReads=0
 const adapter=require('../context/adapters/xiangxiangOperationsRead').createXiangxiangOperationsReadAdapter({dataDir:dir,automationDir:path.join(dir,'absent'),clock:()=>at,
  runtimeReader:async()=>{runtimeReads++;throw Error('fixture runtime down')},backgroundReader:async()=>{throw Error('fixture backend down')},
  executionReader:async()=>{executionReads++;return{state:'partial',records:[{sourceId:'past-execution',state:'running',model:'past-model',startedAt:'2026-10-01T00:00:00Z'}]}},
  workReader:async()=>({state:'partial',records:[]})})
 const result=await adapter.methods.readInvestigation({sections:['configuration','schedules','execution','work']})
 assert.equal(runtimeReads,1);assert.equal(executionReads,1)
 const sections=result.results.map(x=>({sourceId:x.sourceId,retrievedAt:x.retrievedAt,...x.fields}))
 const r=evaluateInvestigation({focus:'background',sections})
 assert.ok(r.evidenceModel.coverage.some(c=>c.section==='runtime_bridge'&&c.state==='UNAVAILABLE'))
 assert.equal(r.evidenceModel.assertions.find(a=>a.recordId==='past-execution'&&a.facet==='execution_state').temporalScope,'historical_execution')
 assert.equal(r.evidenceModel.assertions.find(a=>a.recordId==='past-execution'&&a.facet==='running'),undefined)
 r.routing={localSections:['configuration','schedules','execution','work']}
 for(const question of ['現在有哪些背景工作？','What background jobs exist now?']){
  const text=require('./generalizationView').renderGeneralization(r,question)
  assert.match(text,/未能讀取的來源|Unavailable sources/);assert.match(text,/runtime_bridge/)
 }
})

test('unavailable, stale and conflicting process receipts cannot confirm enablement or a model route',()=>{
 for(const extra of [{observationState:'unavailable'},{at:'2026-10-01T00:00:00Z'}]){
  const r=evaluateInvestigation({focus:'background',sections:[section([row(extra)])]})
  for(const facet of ['enabled','running','configured_model'])assert.equal(r.evidenceModel.assertions.find(a=>a.facet===facet).state,extra.observationState?'UNAVAILABLE':'UNKNOWN')
  const text=renderRuntimeSummary(r,{message:'What is running?'}).text
  assert.doesNotMatch(text,/configured model: `claude-sonnet`|enablement: enabled/)
 }
 const conflict=evaluateInvestigation({focus:'background',sections:[section([row(),row({enabled:false})])]})
 assert.ok(conflict.evidenceModel.contradictions.some(c=>c.facet==='enabled'))
 assert.doesNotMatch(renderRuntimeSummary(conflict,{message:'What is running?'}).text,/Mail analysis:.*enablement: enabled/)
})

test('failed component read is unavailable; unattached component read is unconnected, never idle',async()=>{
 const {createBackendRuntimeReader}=require('./runtimeEvidence')
 const r=await createBackendRuntimeReader({clock:()=>at,mailMemory:{runtimeStatus:()=>{throw Error('fixture')}}}).read()
 assert.equal(r.records.find(r=>r.role==='mail_sync').observationState,'unavailable')
 assert.equal(r.records.find(r=>r.role==='memory_index').observationState,'unconnected')
 assert.ok(r.records.every(r=>r.currentRunningState==='unknown'))
})
