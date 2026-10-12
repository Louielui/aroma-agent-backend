'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
const {createWorkTrace}=require('./workTrace'),{projectRecord}=require('./invocations')
const {appendAttempt,buildAttemptEvidence}=require('./memoryAttemptEvidence')
const {buildDiagnostics}=require('./memoryFailures')
const {evaluateInvestigation}=require('./intelligence')
const {renderWorkPurpose}=require('./workPurpose')
const {correlateMemoryFailures}=require('./memoryFailureCorrelation')
const id='xx-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
function fixture(){
 const at=new Date().toISOString(),start=new Date(Date.parse(at)-3000).toISOString(),finish=new Date(Date.parse(at)-1000).toISOString()
 const trace=createWorkTrace('memory_index','fixture','extraction',3,id)
 const state={state:'unconfirmed',attempts:3,checkedAt:at,reason:'memory_unavailable',failureCheckpoint:'index_retain',workTrace:trace,nextRetryAt:null}
 const rows=[{id,index:state}],progress={version:1,at,unit:'memory_record',scope:'active_general_memory_records',counts:{total:1,saved:0,raw_only:0,pending:0,unconfirmed:1,source_only:0,other:0},diagnostics:buildDiagnostics('memory_index',rows,at),failureEvidence:buildAttemptEvidence('memory_index',rows,at)}
 const invocation=projectRecord({invocationId:randomUUID(),role:'memory_completion',state:'failed',startedAt:start,finishedAt:finish,model:'claude-opus-5-5',failureCode:'subscription_login_required',workTrace:trace})
 const sections=[{section:'configuration',state:'partial',sourceId:'configuration:trace',retrievedAt:at,records:[{sourceId:'backend:memory_index',role:'memory_index',at,evidenceBasis:'live_process_snapshot',progressState:'ok',progress}]},
  {section:'execution',state:'partial',sourceId:'execution:trace',retrievedAt:at,records:[invocation]}]
 return {at,trace,state,rows,progress,invocation,sections}
}
test('exact host identity confirms historical provider rejection, not current login health or global root cause',()=>{
 const f=fixture(),r=evaluateInvestigation({focus:'background',sections:f.sections}),c=r.memoryFailureCorrelation.jobs[0].cases[0]
 assert.equal(c.linkState,'CONFIRMED');assert.equal(c.providerFailures[0].code,'subscription_login_required');assert.equal(c.checkpoint,'index_retain')
 assert.equal(c.rootCauseState,'UNKNOWN');assert.equal(r.memoryFailureCorrelation.jobs[0].currentDependencyState,'UNKNOWN')
 assert.equal(r.evidenceModel.assertions.find(a=>a.facet==='memory_failure_root_cause').state,'UNKNOWN')
 assert.equal(r.evidenceModel.assertions.find(a=>a.facet==='memory_failure_provider_observation').state,'CONFIRMED')
 for(const message of ['記憶為什麼失敗？','Why did memory fail?']){
  const v=renderWorkPurpose(r.workPurpose,{message,failuresOnly:true})
  assert.match(v.text,/有有效執行識別|valid host execution identities/);assert.match(v.text,/登入認證未通過|login authentication rejected/)
  assert.doesNotMatch(v.text,/\{\w+\}|SECRET/);assert.ok(v.references.some(ref=>ref.recordId===f.invocation.sourceId))
 }
})
test('no identity, a bounded ledger miss and an unavailable source are different honest gaps',()=>{
 for(const [kind,expected]of [['untraced','UNKNOWN'],['otherRun','UNKNOWN'],['unavailable','UNAVAILABLE'],['bridgeUnavailable','UNAVAILABLE'],['future','UNKNOWN']]){
  const f=fixture()
  if(kind==='untraced'){f.rows[0].index.workTrace=null;f.progress.failureEvidence=buildAttemptEvidence('memory_index',f.rows,f.at)}
  if(kind==='otherRun')f.sections[1].records[0].workTrace={...f.trace,runId:randomUUID()}
  if(kind==='unavailable'){f.sections[1].state='unavailable';f.sections[1].records=[]}
  if(kind==='bridgeUnavailable')f.sections[1].coverage={invocations:'unavailable',sessions:'ok'}
  if(kind==='future')f.sections[1].records[0].finishedAt='2099-01-01T00:00:00Z'
  const c=evaluateInvestigation({focus:'background',sections:f.sections}).memoryFailureCorrelation.jobs[0].cases[0]
  assert.equal(c.linkState,expected);assert.equal(c.providerFailures.length,0);assert.equal(c.rootCauseState,'UNKNOWN')
 }
})
test('same run with foreign work/attempt identity or conflicting duplicate receipts is contradicted',()=>{
 for(const conflict of ['attempt','record','duplicate','outcome']){
  const f=fixture()
  if(conflict==='attempt')f.invocation.workTrace.attempt=2
  if(conflict==='record')f.invocation.workTrace.recordId='xx-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  if(conflict==='duplicate')f.sections[1].records.push({...f.invocation,failureCode:'subscription_limit_reached'})
  if(conflict==='outcome')f.invocation.workOutcome={state:'saved',at:f.at,basis:'host_checkpoint_report'}
  const c=evaluateInvestigation({focus:'background',sections:f.sections}).memoryFailureCorrelation.jobs[0].cases[0]
  assert.equal(c.linkState,'CONTRADICTED');assert.equal(c.providerFailures.length,0)
 }
})
test('a successful provider result can coexist with subsequent local validation failure',()=>{
 const f=fixture();f.invocation.state='succeeded';f.invocation.failureCode=null;f.invocation.modelResultObserved=true;f.invocation.actualModel='claude-opus-5-5'
 f.state.failureCheckpoint='index_result_validation';f.progress.failureEvidence=buildAttemptEvidence('memory_index',f.rows,f.at)
 const r=evaluateInvestigation({focus:'background',sections:f.sections}),c=r.memoryFailureCorrelation.jobs[0].cases[0]
 assert.equal(c.providerFailures.length,0);assert.equal(c.providerResults.length,1);assert.equal(c.checkpointState,'CONFIRMED')
 assert.match(renderWorkPurpose(r.workPurpose,{message:'Why memory?',failuresOnly:true}).text,/does not prove subsequent memory validation/)
})
test('stale canonical progress does not create failure evidence and same-record later completion is scoped local evidence',()=>{
 const f=fixture();f.progress.at='2020-01-01T00:00:00.000Z'
 assert.equal(evaluateInvestigation({focus:'background',sections:f.sections}).memoryFailureCorrelation.jobs[0].cases.length,0)
 const fresh=fixture(),done=appendAttempt('memory_index',fresh.state,{state:'saved',attempts:4,checkedAt:fresh.at,workTrace:createWorkTrace('memory_index','fixture','extraction',4,id)},id)
 const p=buildAttemptEvidence('memory_index',[{id,index:done}],fresh.at)
 const r={sections:fresh.sections,workPurpose:{jobs:[{role:'memory_index',progressState:'CONFIRMED',progress:{at:fresh.at,failureEvidence:p},references:[]}]}}
 const c=correlateMemoryFailures(r).jobs[0].cases[0]
 assert.equal(c.laterCompletionState,'CONFIRMED');assert.equal(c.rootCauseState,'UNKNOWN')
})
