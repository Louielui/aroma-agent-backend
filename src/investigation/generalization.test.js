'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {investigationRoute}=require('./generalRouter')
const {buildEvidenceState,currentActivity,STATES}=require('./evidenceState')
const {evidencePrompt,renderGeneralization}=require('./generalizationView')
const now='2026-10-08T12:00:00Z'
const section=(section,records,state='ok')=>({section,records,state,sourceId:section+':receipt',retrievedAt:now})
const report=sections=>{const r={sections,focus:'background',readOnly:true};r.evidenceModel=buildEvidenceState(r);return r}
test('missing authorized receipt is not a denial, an empty search, or a fabricated citation',()=>{
 const {refreshRequiredSourceGaps}=require('./generalRouter')
 const r=report([])
 r.routing=investigationRoute({investigationFocus:'general',facts:[{id:'f1',operation:'github',necessity:'required'}]},['github'])
 refreshRequiredSourceGaps(r);refreshRequiredSourceGaps(r)
 r.evidenceModel=buildEvidenceState(r)
 const c=r.evidenceModel.coverage[0]
 assert.equal(c.reason,'read_receipt_missing');assert.equal(c.attempted,null);assert.equal(c.sourceId,null)
 assert.equal(r.gaps.length,1)
 assert.match(renderGeneralization(r,'Find the code history'),/read receipt missing/)
 assert.doesNotMatch(JSON.stringify(evidencePrompt(r)),/read-context:github/)
 r.sections.push(section('external_github',[],'partial'))
 refreshRequiredSourceGaps(r);r.evidenceModel=buildEvidenceState(r)
 assert.equal(r.gaps.length,0)
 assert.equal(r.evidenceModel.coverage[0].state,'UNKNOWN')
})
test('goal-based routes select distinct fixed source sections and intersect authority',()=>{
 const route=(focus,sources=['xiangxiang_operations'],need=[])=>investigationRoute({investigationFocus:focus,investigationEvidence:need,facts:[{operation:'xiangxiang_operations',necessity:'required'},{operation:'github',necessity:'required'},{operation:null,id:'f3',need:'Provider bill'}]},sources)
 assert.deepEqual(route('work_failure').localSections,['work','configuration'])
 assert.deepEqual(route('background').localSections,['configuration','schedules','execution','work'])
 assert.deepEqual(route('cost').localSections,['execution','configuration','schedules','usage','billing'])
 assert.deepEqual(route('work_failure',[]).requiredSources,[])
 assert.equal(route('work_failure').decisions.find(x=>x.source==='github').authorized,false)
 assert.equal(route('work_failure').unmappedFacts[0].status,'UNKNOWN')
 assert.ok(!route('background',undefined,['shell','../../secret']).localSections.includes('shell'))
 const external=investigationRoute({investigationFocus:'general',investigationEvidence:['code_history'],facts:[{operation:'github',necessity:'required'}]},['github'])
 assert.deepEqual(external.requiredSources,['github']);assert.deepEqual(external.localSections,[])
})
test('configured, enabled, historical requested/executed and live models are independent assertions',()=>{
 const r=report([section('configuration',[{sourceId:'job',model:'claude',enabled:true,currentRunningState:'active'}]),section('execution',[{sourceId:'inv:1',model:'gpt',actualModel:'claude',modelResultObserved:true,evidenceBasis:'owner_bridge_invocation_ledger',state:'succeeded',startedAt:'2026-10-07T01:00:00Z',declaredAutomationId:'job'}])])
 const rows=r.evidenceModel.assertions
 assert.equal(rows.find(a=>a.facet==='configured_model').state,'CONFIRMED')
 assert.equal(rows.find(a=>a.facet==='enabled').value,true)
 assert.equal(rows.find(a=>a.facet==='running').state,'UNKNOWN')
 assert.equal(rows.find(a=>a.facet==='requested_model').temporalScope,'historical_configuration')
 assert.equal(rows.find(a=>a.facet==='executed_model').value,'claude')
 assert.equal(rows.find(a=>a.facet==='schedule_link').state,'CANDIDATE')
 assert.equal(r.evidenceModel.contradictions.length,0)
})
test('fresh witnessed activity confirms only observation time; stale/future/missing timestamps stay unknown',()=>{
 for(const [at,state] of [[now,'CONFIRMED'],['2026-10-08T11:00:00Z','UNKNOWN'],['2026-10-09T12:00:00Z','UNKNOWN'],[null,'UNKNOWN']]){
  const r=report([section('configuration',[{sourceId:'job',model:'claude',currentRunningState:'active',evidenceBasis:'live_process_snapshot',at}])])
  assert.equal(r.evidenceModel.assertions.find(a=>a.facet==='running').state,state)
  assert.equal(currentActivity(r,'configuration:receipt','job','active'),state==='CONFIRMED'?'active':'unknown')
 }
})
test('same-time conflicts are contradicted; dated changes are transitions and cannot erase old evidence',()=>{
 const record=(model,at=now)=>({sourceId:'inv:1',model,at,state:'succeeded'})
 const conflict=report([section('execution',[record('a'),record('b')])]).evidenceModel
 assert.ok(conflict.contradictions.length)
 assert.ok(conflict.assertions.filter(a=>a.facet==='executed_model').every(a=>a.state==='CONTRADICTED'))
 const change=report([section('execution',[record('a','2026-10-07T12:00:00Z'),record('b')])]).evidenceModel
 assert.equal(change.contradictions.length,0);assert.equal(change.transitions.length,1)
})
test('unavailable is distinct from empty; absent event dates and null test counters remain unknown',()=>{
 const r=report([section('work',[{sourceId:'failed',state:'failed',tests:{passed:null,failed:null},sourceFiles:[{path:'registered.js',currentHash:null}]}]),section('billing',[],'unconnected'),section('history',[])])
 assert.equal(r.evidenceModel.coverage.find(c=>c.section==='history').state,'UNKNOWN')
 assert.equal(r.evidenceModel.coverage.find(c=>c.section==='billing').state,'UNAVAILABLE')
 assert.equal(r.evidenceModel.assertions.find(a=>a.facet==='work_state').observedAt,null)
 for(const facet of ['candidate_tests','registered_file_comparison','repaired'])assert.equal(r.evidenceModel.assertions.find(a=>a.facet===facet).state,'UNKNOWN')
 assert.deepEqual(r.evidenceModel.states,STATES)
})
test('candidate source and tests cannot certify a currently loaded repair; prompt excludes raw objects',()=>{
 const r=report([section('work',[{sourceId:'failed',state:'failed',reason:'timeout',tests:{passed:4,failed:0},sourceFiles:[{path:'registered.js',currentHash:'abc',comparison:'matches_candidate'}]}])])
 r.focus='work_failure';r.routing={localSections:['work']}
 assert.equal(r.evidenceModel.assertions.find(a=>a.facet==='candidate_tests').state,'CONFIRMED')
 assert.equal(r.evidenceModel.assertions.find(a=>a.facet==='repaired').state,'UNKNOWN')
 assert.match(renderGeneralization(r,'Was it fixed?'),/currently loaded version: unknown/)
 assert.doesNotMatch(JSON.stringify(evidencePrompt(r)),/registered.js|matches_candidate/)
})

test('background answer includes configured automation with unknown activity and a concrete read-only recommendation',()=>{
 const r=report([section('schedules',[{sourceId:'codex-automation:one',name:'Follow-up',model:'model-a',state:'PAUSED',currentRunningState:'active'}])]);r.routing={localSections:['schedules']}
 const answer=renderGeneralization(r,'Which background jobs run?')
 assert.match(answer,/Follow-up.*model-a.*disabled.*unknown/)
 assert.match(answer,/Recommendation:.*same job identity/)
 assert.match(answer,/source: schedules:receipt/)
 assert.doesNotMatch(answer,/live activity: active/)
})

test('a planned source outside the connected investigation adapters remains an explicit unavailable need',()=>{
 const routing=investigationRoute({investigationFocus:'work_failure',facts:[{operation:'xiangxiang_operations',necessity:'required'},{id:'f2',operation:'development_record',need:'Saved design history',necessity:'enriching'}]},['xiangxiang_operations'])
 assert.equal(routing.unmappedFacts[0].status,'UNAVAILABLE')
 assert.deepEqual(routing.requiredSources,['xiangxiang_operations'])
 const r=report([]);r.routing=routing
 assert.match(renderGeneralization(r,'Why did it fail?'),/Saved design history.*unavailable.*development_record/)
})
