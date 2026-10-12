'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {correlateWork,renderWorkCorrelation}=require('./workCorrelation')
const {selectWorkSample}=require('./workEvidence')
const sha='a'.repeat(40),other='b'.repeat(40)
const tests={total:3,passed:3,failed:0,exitCode:0,skipped:0,cancelled:0}
const failed={sourceId:'failed',kind:'worker/adoptions',workRunId:'work',action:'adopt',state:'failed',reason:'source_dirty',at:'2026-10-07T10:00:00Z'}
const adopted={sourceId:'adopted',kind:'worker/adoptions',workRunId:'work',action:'adopt',state:'completed',appliedToLive:true,commit:sha,loadedCommit:sha,tests,sourceFilesComplete:true,sourceFiles:[{path:'registered.js',candidateHash:'c'.repeat(64),currentHash:'c'.repeat(64)}],at:'2026-10-07T11:00:00Z'}
const report=(records,boot=sha)=>({focus:'work_failure',readOnly:true,sections:[{section:'work',sourceId:'work:receipt',state:'ok',retrievedAt:new Date().toISOString(),latestFailureId:'failed',records},{section:'configuration',sourceId:'config:receipt',state:'ok',retrievedAt:new Date().toISOString(),records:[{role:'central_brain_default',bootCommit:boot}]}]})
test('same work identity, complete passing tests and loaded commit prove adoption prerequisite recovery only',()=>{
 const r=report([failed,adopted]);r.workCorrelation=correlateWork(r)
 assert.equal(r.workCorrelation.operationRecovery,'CONFIRMED')
 assert.equal(r.workCorrelation.repaired,'UNKNOWN')
 assert.equal(r.workCorrelation.links[0].verifiedAdoption,true)
 assert.match(renderWorkCorrelation(r,'查原因'),/前置問題已恢復/)
 assert.match(renderWorkCorrelation(r,'Why?'),/not every product defect/)
})
test('similar title, later success, same commit and shared task alone cannot prove same-work recovery',()=>{
 for(const row of [{...adopted,workRunId:'different',goal:'same title'}, {...adopted,workRunId:null,taskRunId:'task'}]){
  const c=correlateWork(report([{...failed,taskRunId:'task'},row]))
  assert.equal(c.operationRecovery,'UNKNOWN');assert.equal(c.repaired,'UNKNOWN')
 }
})
test('mismatching boot, rollback, null/skipped tests, old adoption and duplicate records fail closed',()=>{
 const candidates=[{...adopted,loadedCommit:other},{...adopted,action:'rollback'},
  {...adopted,tests:{...tests,skipped:null}},{...adopted,tests:{...tests,skipped:1}},
  {...adopted,at:failed.at},{...adopted,at:null},{...adopted,appliedToLive:false},
  {...adopted,sourceFilesComplete:false},{...adopted,sourceFiles:[]},{...adopted,sourceFiles:[{candidateHash:'c'.repeat(64),currentHash:'d'.repeat(64)}]}]
 for(const r of candidates)assert.equal(correlateWork(report([failed,r])).operationRecovery,'UNKNOWN')
 assert.equal(correlateWork(report([failed,adopted],other)).operationRecovery,'UNKNOWN')
 assert.equal(correlateWork(report([failed,adopted,{...adopted}])).operationRecovery,'UNKNOWN')
 assert.equal(correlateWork(report([failed,{...failed},adopted])).state,'UNKNOWN')
})
test('previous enquiry target cannot silently become a newer failure',()=>{
 const r=report([failed,adopted]);r.continuity={selectedRecordId:'unseen-previous'}
 assert.equal(correlateWork(r).targetId,'unseen-previous')
 assert.deepEqual(correlateWork(r).gaps,['target_not_observed'])
})
test('bounded work sample retains adoption retries linked by exact parent ID',()=>{
 const r=selectWorkSample([failed,adopted,...Array.from({length:7},(_,i)=>({sourceId:'noise'+i,kind:'worker/project-runs',state:'completed',at:'2026-10-08T01:00:00Z'}))])
 assert.equal(r.latestFailureId,'failed');assert.ok(r.records.includes(adopted));assert.equal(r.records.length,5)
})
