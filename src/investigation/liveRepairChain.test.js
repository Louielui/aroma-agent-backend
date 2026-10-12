'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const api=require('../context/contextResult'), live=require('../core/projectWork/liveVerification'),{RECIPE,FILE,TEST,TESTS}=require('../core/projectWork/contract')
const {projectWorkRecord,selectWorkSample}=require('./workEvidence'),{evaluateInvestigation}=require('./intelligence')
const {renderSourceBoundFindings}=require('./sourceBoundFindings'),{ownerBrief}=require('./ownerBrief')
const hash=v=>crypto.createHash('sha256').update(v).digest('hex')
const target='11111111-1111-4111-8111-111111111111',work='22222222-2222-4222-8222-222222222222',adoption='33333333-3333-4333-8333-333333333333'
const beforeCommit='a'.repeat(40),commit='b'.repeat(40),bootedAt='2026-10-07T00:00:00Z'
const boundary=Object.fromEntries(['noExternalInterfaces','hostReadDenied','hostWriteDenied','readonlyInputDenied','readonlyToolsDenied','loopbackDenied','ipv6LoopbackDenied','internetDenied','cleanIdentity','secretsAbsent'].map(k=>[k,true]))
function fixture(){
 const broken={...api,makeContextResult:v=>({...api.makeContextResult(v),fields:v.fields&&typeof v.fields==='object'&&!Array.isArray(v.fields)?v.fields:{}})}
 const baseline={...live.createProbe({bootCommit:beforeCommit,bootedAt:'2026-10-06T00:00:00Z',sourceHash:hash('before'),api:broken})(),workRunId:target,at:'2026-10-06T01:00:00Z'}
 const candidateBaseline={...baseline,workRunId:work,at:'2026-10-06T02:00:00Z'}
 const measured={...live.createProbe({bootCommit:commit,bootedAt,sourceHash:hash('after'),api})(),workRunId:work,at:'2026-10-07T01:00:00Z'}
 const source={evidence:{recipe:RECIPE,revision:beforeCommit,sourceFiles:[{path:FILE,sha256:hash('before')}],acceptanceFiles:[{path:TEST,sha256:hash(TESTS)}]}}
 const sandbox=(body,failed=0)=>({total:8,passed:8-failed,failed,skipped:0,cancelled:0,exitCode:failed?1:0,engine:'windows-sandbox-offline-v1',boundary,inputHashes:{[FILE]:hash(body),[TEST]:hash(TESTS)},evidenceHash:hash(body+'evidence')})
 const failed={id:target,state:'failed',reason:'worker_timeout',workOrder:{recipe:RECIPE},source,liveBaseline:baseline}
 const candidate={id:work,state:'completed',workOrder:{recipe:RECIPE},source,repairOf:target,liveBaseline:candidateBaseline,
  result:{changes:[{file:FILE,afterHash:hash('after')}],baseline:sandbox('before',5),tests:sandbox('after')},review:{verdict:'pass'}}
 const adopted={id:adoption,action:'adopt',state:'completed',source,after:'after',workRunId:work,accepted:{repairOf:target,liveBaseline:candidateBaseline},
  commit,loaded:{bootCommit:commit},tests:sandbox('after'),appliedToLive:true,liveVerification:measured}
 const raw=[failed,candidate,adopted],rows=raw.map((r,i)=>({sourceId:r.id,...projectWorkRecord(r,{kind:i===2?'worker/adoptions':'worker/project-runs',readSource:()=> 'after'})}))
 const sections=[{section:'work',sourceId:'work:fixture',state:'partial',latestFailureId:target,retrievedAt:new Date().toISOString(),records:rows},
  {section:'configuration',sourceId:'config:fixture',state:'ok',retrievedAt:new Date().toISOString(),records:[{sourceId:'backend',bootCommit:commit,bootedAt}]}]
 return {raw,rows,sections}
}
test('actual component observations bind failure -> explicit correction -> tests -> adoption -> same loaded process; bilingual report states precise scope',()=>{
 const f=fixture(),r=evaluateInvestigation({focus:'work_failure',sections:f.sections}),c=r.workCorrelation
 assert.equal(c.componentVerification,'CONFIRMED');assert.equal(c.repaired,'UNKNOWN','whole task repair remains separate')
 assert.equal(c.repairChain.conclusion,'loaded_component_verified');assert.equal(c.repairChain.firstGap,null)
 assert.deepEqual(c.repairChain.stages.map(s=>s.state),['CONFIRMED','SUPPORTED','CONFIRMED','CONFIRMED','CONFIRMED','SUPPORTED','CONFIRMED'])
 const assertion=r.evidenceModel.assertions.find(a=>a.facet==='repair_chain_live_failure_verification')
 assert.equal(assertion.state,'CONFIRMED');assert.equal(assertion.observedAt,'2026-10-07T01:00:00Z')
 for(const message of ['上一個任務現在修好了嗎?','Has the previous task actually been fixed?']){
  const findings=renderSourceBoundFindings(r,{message}),brief=ownerBrief(r,{message,findings})
  assert.ok(brief);assert.match(brief.text,/組件行為|component behavior/);assert.doesNotMatch(brief.text,/目前仍未確認同一問題已修好|It is not confirmed/)
 }
 assert.deepEqual(selectWorkSample(f.rows).records.map(r=>r.sourceId),[target,work,adoption])
})
test('same checks without exact link, adoption, loaded process, original failing baseline, review or protected inputs cannot prove repair',()=>{
 const mutations=[f=>f.rows[1].repairOf=null,f=>f.rows[1].recipe='different-recipe',f=>f.rows[0].liveBaseline=null,f=>f.rows[1].liveBaseline=null,
  f=>f.rows[2].liveVerification=null,f=>f.rows[2].state='awaiting_restart',f=>f.rows[2].appliedToLive=false,
  f=>f.rows[2].loadedCommit='c'.repeat(40),f=>f.sections[1].records[0].bootedAt='2026-10-08T00:00:00Z',
  f=>f.rows[2].sourceFiles[0].currentHash=hash('drift'),f=>f.rows[0].liveBaseline.sourceHash=hash('other'),
  f=>f.rows[2].liveVerification.checksHash=hash('other'),f=>f.rows[2].liveVerification.workRunId=target,
  f=>f.rows[1].reviewVerdict='changes_requested',f=>f.rows[2].testBinding.candidate.inputHash=hash('other'),
  f=>f.rows[0].state='completed',f=>f.sections[1].retrievedAt='2000-01-01',
  f=>f.rows[1].liveBaseline.at='2026-10-05T00:00:00Z',f=>f.rows[2].liveVerification.at='2099-01-01T00:00:00Z']
 for(const mutate of mutations){const f=fixture();mutate(f);const r=evaluateInvestigation({focus:'work_failure',sections:f.sections});assert.notEqual(r.workCorrelation.componentVerification,'CONFIRMED');assert.equal(r.workCorrelation.repaired,'UNKNOWN');assert.equal(r.workCorrelation.repairChain.stages.at(-1).state,'UNKNOWN')}
 const f=fixture();f.sections[1].records.push({sourceId:'conflicting',bootCommit:'c'.repeat(40),bootedAt})
 assert.equal(evaluateInvestigation({focus:'work_failure',sections:f.sections}).workCorrelation.repairChain.stages[4].state,'CONTRADICTED')
 const unavailable=fixture();unavailable.rows[2].liveVerification={state:'unavailable',reason:'live_verification_unavailable'}
 assert.equal(evaluateInvestigation({focus:'work_failure',sections:unavailable.sections}).workCorrelation.repairChain.stages.at(-1).state,'UNAVAILABLE')
})
test('projection discards arbitrary code/output and invalid measurements; enquiries never invoke an observer',()=>{
 const f=fixture(),before=JSON.stringify(f.raw)
 f.raw[2].liveVerification.stdout='PRIVATE';f.raw[2].liveVerification.secret='PRIVATE'
 const p=projectWorkRecord(f.raw[2],{kind:'worker/adoptions',readSource:()=> 'after'})
 assert.doesNotMatch(JSON.stringify(p),/PRIVATE/)
 for(const mutate of [v=>v.engine='model_claim',v=>v.checks=[],v=>v.passed=999]){const d=structuredClone(f.raw[2]);mutate(d.liveVerification);assert.equal(projectWorkRecord(d).liveVerification,null)}
 let observations=0;f.sections.observeLive=()=>observations++
 evaluateInvestigation({focus:'work_failure',sections:f.sections});assert.equal(observations,0)
 delete f.raw[2].liveVerification.stdout;delete f.raw[2].liveVerification.secret;assert.equal(JSON.stringify(f.raw),before)
})
