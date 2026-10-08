'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const {projectWorkRecord,selectWorkSample}=require('./workEvidence')
const {correlateWork}=require('./workCorrelation')
const {evaluateInvestigation}=require('./intelligence')
const {renderRepairChain,nextEvidence}=require('./repairChainView')
const h=v=>crypto.createHash('sha256').update(v).digest('hex'),sha='a'.repeat(40)
const task='11111111-1111-4111-8111-111111111111',work='22222222-2222-4222-8222-222222222222',adopt='33333333-3333-4333-8333-333333333333'
const file='src/demo/assets/sidebar.css',protectedFile='acceptance/registered-task.test.cjs'
const summary={total:3,passed:3,failed:0,exitCode:0,skipped:0,cancelled:0}
const boundary=Object.fromEntries(['noExternalInterfaces','hostReadDenied','hostWriteDenied','readonlyInputDenied','readonlyToolsDenied','loopbackDenied','ipv6LoopbackDenied','internetDenied','cleanIdentity','secretsAbsent'].map(k=>[k,true]))
const measurement=(body,failure=false)=>({...summary,...(failure?{passed:2,failed:1,exitCode:1}:{}),engine:'windows-sandbox-offline-v1',boundary,inputHashes:{[file]:h(body),[protectedFile]:h('fixed protected tests')},evidenceHash:h(body+'evidence'),at:new Date().toISOString(),stdout:'PRIVATE_OUTPUT',workspace:'PRIVATE_LOCATION'})
function fixture(){
 const evidence={revision:'b'.repeat(40),sourceFiles:[{path:file,sha256:h('old')}],acceptanceFiles:[{path:protectedFile,sha256:h('fixed protected tests')}]}
 const candidate={sourceId:work,...projectWorkRecord({state:'completed',source:{evidence},workOrder:{recipe:'registered-task-'+task},result:{changes:[{file,afterHash:h('new')}],baseline:measurement('old',true),tests:measurement('new')},review:{verdict:'pass'}},{kind:'worker/project-runs',readSource:()=> 'new'})}
 const adopted={sourceId:adopt,...projectWorkRecord({action:'adopt',state:'completed',source:{evidence},after:{[file]:'new'},workRunId:work,commit:sha,loaded:{bootCommit:sha},tests:measurement('new'),appliedToLive:true},{kind:'worker/adoptions',readSource:()=> 'new'})}
 const failed={sourceId:task,kind:'worker/project-tasks',state:'failed',reason:'source_dirty',at:'2026-10-01T00:00:00Z'}
 return {failed,candidate,adopted,sections:[{section:'work',sourceId:'work:verified',state:'partial',latestFailureId:task,retrievedAt:new Date().toISOString(),records:[failed,candidate,adopted]},{section:'configuration',sourceId:'config:verified',state:'ok',retrievedAt:new Date().toISOString(),records:[{sourceId:'backend',bootCommit:sha}]}]}
}
test('projected sandbox hashes connect exact registration, baseline, candidate, adoption and loaded source; live repair remains unproven',()=>{
 const f=fixture(),r=evaluateInvestigation({focus:'work_failure',sections:f.sections}),c=r.workCorrelation.repairChain
 assert.deepEqual(c.stages.map(s=>s.state),['CONFIRMED','SUPPORTED','CONFIRMED','CONFIRMED','CONFIRMED','SUPPORTED','UNKNOWN'])
 assert.equal(c.conclusion,'registered_source_supported');assert.equal(c.firstGap,'live_failure_verification')
 assert.equal(r.workCorrelation.repaired,'UNKNOWN')
 assert.equal(r.evidenceModel.assertions.find(a=>a.facet==='repair_chain_registered_regression').state,'SUPPORTED')
 assert.match(renderRepairChain(c,'查是否修好'),/保護測試/);assert.match(renderRepairChain(c,'Was it fixed?'),/live application path: not established/)
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE_OUTPUT|PRIVATE_LOCATION/)
 const selected=selectWorkSample([f.failed,f.candidate,f.adopted,...Array.from({length:8},(_,i)=>({sourceId:'noise'+i,state:'completed',at:'2026-10-08'}))])
 assert.deepEqual(selected.records.slice(0,3).map(r=>r.sourceId),[task,work,adopt])
})
test('missing links, changed tests, unbound inputs, review failure, skipped tests, old boot and drift stop the chain at the actual gap',()=>{
 const edits=[f=>f.candidate.registeredTaskId=null,f=>f.candidate.testBinding=null,f=>f.candidate.reviewVerdict='changes_requested',
  f=>f.candidate.testBinding.candidate.inputHash=h('other input'),f=>f.adopted.testBinding.protectedTestsHash=h('different suite'),
  f=>f.adopted.testBinding.dependenciesMatch=false,f=>f.candidate.baseline.skipped=1,f=>f.candidate.tests.skipped=1,
  f=>f.adopted.loadedCommit='c'.repeat(40),f=>f.adopted.sourceFiles[0].currentHash=h('changed'),
  f=>f.sections[1].retrievedAt='2020-01-01T00:00:00Z',f=>f.sections[0].retrievedAt=null]
 for(const edit of edits){const f=fixture();edit(f);const c=correlateWork({focus:'work_failure',readOnly:true,sections:f.sections});assert.equal(c.repaired,'UNKNOWN');assert.notEqual(c.repairChain.conclusion,'registered_source_supported');assert.equal(c.repairChain.stages.find(s=>s.key==='registered_regression').state,'UNKNOWN')}
 const f=fixture();f.candidate.registeredTaskId=null
 const c=correlateWork({focus:'work_failure',readOnly:true,sections:f.sections}).repairChain
 assert.equal(c.firstGap,'linked_correction');assert.match(nextEvidence(c,'en'),/explicitly linked/)
})
test('unavailable work and contradictory loaded revisions are distinct from missing regression records',()=>{
 const unavailable=correlateWork({focus:'work_failure',readOnly:true,sections:[{section:'work',state:'unavailable',records:[]}]})
 assert.equal(unavailable.repairChain.stages[0].state,'UNAVAILABLE');assert.equal(unavailable.repairChain.firstGap,'failure')
 const f=fixture();f.sections[1].records.push({sourceId:'bridge',bootCommit:'c'.repeat(40)})
 const c=correlateWork({focus:'work_failure',readOnly:true,sections:f.sections}).repairChain
 assert.equal(c.stages.find(s=>s.key==='current_version').state,'CONTRADICTED');assert.equal(c.firstGap,'current_version')
 assert.equal(c.stages.find(s=>s.key==='current_version').references.filter(r=>r.field==='bootCommit').length,2)
 const r=evaluateInvestigation({focus:'work_failure',sections:f.sections})
 assert.ok(r.evidenceModel.contradictions.some(x=>x.facet==='repair_chain_current_version'))
 f.failed.state='completed'
 assert.equal(correlateWork({focus:'work_failure',readOnly:true,sections:f.sections}).repairChain.stages[0].state,'UNKNOWN')
})
test('tampered raw sandbox metadata cannot become a hash-bound regression witness',()=>{
 for(const mutate of [v=>v.engine='model_claim',v=>delete v.inputHashes[file],v=>v.inputHashes['../../.env']=h('secret'),v=>v.boundary={hostReadDenied:true},v=>v.evidenceHash=null]){
  const raw=measurement('new');mutate(raw)
  const r=projectWorkRecord({source:{evidence:{sourceFiles:[{path:file,sha256:h('old')}],acceptanceFiles:[{path:protectedFile,sha256:h('fixed protected tests')}]}},result:{changes:[{file,afterHash:h('new')}],tests:raw}},{kind:'worker/project-runs',readSource:()=> 'new'})
  assert.equal(r.testBinding.candidate,null);assert.doesNotMatch(JSON.stringify(r),/PRIVATE|\.env|secret/)
 }
})
