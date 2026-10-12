'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), {randomUUID} = require('node:crypto')
const {createLoadedVerifier} = require('./loadedVerifier')
const {hash, READ_PROFILES} = require('../core/taskPlanner/contract')
const {createMemoryRunStore} = require('../core/operating/runStore')
const OLD='a'.repeat(40), CURRENT='b'.repeat(40)
function fixture (bootCommit=OLD) {
  const workRunId=randomUUID(), profile='seven_shifts', files=READ_PROFILES[profile], contents=['reviewed reader\n','protected dependency\n']
  const changes=files.slice(0,1).map((file,i)=>({file,afterHash:hash(contents[i])}))
  const row={id:randomUUID(),workRunId,action:'adopt',state:'completed',appliedToLive:true,commit:OLD,finishedAt:new Date().toISOString(),
    loaded:{bootCommit:OLD,sourceHashes:{[files[0]]:changes[0].afterHash}},change:{files:changes},
    tests:{total:6,passed:6,failed:0,exitCode:0,skipped:0,cancelled:0},source:{evidence:{sourceFiles:[{path:files[0],sha256:hash('old reader')}],dependencyFiles:[{path:files[1],sha256:hash(contents[1])}]}}}
  const evidence={project:'aroma-agent-backend',profile,revision:bootCommit,bootCommit,committedOnly:true,
    files:files.map((path,i)=>({path,evidenceId:'plan-'+i,content:contents[i],sha256:hash(contents[i]),lineCount:contents[i].split('\n').length}))}
  const packet={state:'ok',retrievedAt:new Date().toISOString(),evidence,hash:hash(JSON.stringify(evidence))},calls=[],runs=[row]
  const request=async (route,input)=>{calls.push({route,input});return route==='/project-adoption'?{runs}:packet}
  const scope={profile,files:[files[0]],permissions:'read_only_existing_authorisation'}
  const verifier=createLoadedVerifier({bootCommit,request,env:{READ_ACCESS:'on'},store:createMemoryRunStore()})
  return {row,packet,calls,runs,scope,workRunId,verify:()=>verifier({workRunId,scope}),verifier}
}
test('actual bridge adoption receipts enable continuation even when backend adoption store is empty',async()=>{
  const f=fixture(),p=await f.verify();assert.equal(p?.state,'verified');assert.equal(p.bootCommit,OLD)
  assert.deepEqual(f.calls.map(c=>c.route),['/project-adoption','/task-plan-source'])
})
test('later host commit requires fresh loaded source hashes matching reviewed reader and protected dependency',async()=>{
  const f=fixture(CURRENT),p=await f.verify();assert.equal(p?.state,'verified');assert.equal(p.bootCommit,CURRENT);assert.equal(p.adoptionCommit,OLD)
  assert.deepEqual(f.calls[1].input,{bootCommit:CURRENT,profile:'seven_shifts'})
})
test('unaccepted, rollback, skipped, foreign scope and mismatched source cannot enable continuation',async()=>{
  for(const mutate of [f=>{f.row.state='awaiting_restart'},f=>{f.row.action='rollback'},f=>{f.row.tests.skipped=1},
    f=>{f.row.loaded.bootCommit=CURRENT},f=>{f.row.workRunId=randomUUID()},f=>{f.row.change.files[0].afterHash=hash('other')},
    f=>{f.row.source.evidence.dependencyFiles[0].sha256=hash('changed')},f=>{f.scope.files=['.env']},
    f=>{f.row.loaded.sourceHashes[f.scope.files[0]]=hash('different loaded bytes')},
    f=>{f.runs.push({...f.row,id:randomUUID(),action:'rollback',finishedAt:new Date(Date.now()+1000).toISOString()})}]) {
    const f=fixture(CURRENT);mutate(f);assert.equal(await f.verify(),null)
  }
})
test('bridge/source failure, stale packet and boot drift stay unavailable rather than trusting prior adoption',async()=>{
  for(const mutate of [f=>{f.packet.retrievedAt='2020-01-01T00:00:00Z'},f=>{f.packet.evidence.bootCommit=OLD},f=>{f.packet.evidence.files[0].content='tampered'},
    f=>{f.packet.state='unavailable'}]) {
    const f=fixture(CURRENT);mutate(f);await assert.rejects(f.verify())
  }
  const f=fixture(),verify=createLoadedVerifier({bootCommit:OLD,env:{READ_ACCESS:'on'},request:async()=>{throw Error('bridge unavailable')},store:createMemoryRunStore()})
  await assert.rejects(verify({workRunId:f.workRunId,scope:f.scope}))
})
test('valid current packet with changed reader or dependency bytes never inherits past adoption',async()=>{
  for(const index of [0,1]){
    const f=fixture(CURRENT),file=f.packet.evidence.files[index]
    file.content='new unapproved bytes\n';file.sha256=hash(file.content);file.lineCount=2;f.packet.hash=hash(JSON.stringify(f.packet.evidence))
    assert.equal(await f.verify(),null)
  }
})
test('revoked read access prevents verification without any bridge request',async()=>{
  const f=fixture(),env={READ_ACCESS:'off'},verify=createLoadedVerifier({bootCommit:OLD,env,request:async()=>{throw Error('unexpected')}})
  await assert.rejects(verify({workRunId:f.workRunId,scope:f.scope}),/read_access_disabled/)
})
