'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{createGitHub,CONTEXTS}=require('./github')
test('an expired authority stops an exact-head merge immediately before PUT',async()=>{
 const head='a'.repeat(40),base='b'.repeat(40);let writes=0,guards=0
 const github=createGitHub({root:'fixture',tokenProvider:()=> 'fixture-only',fetchImpl:async(url,options)=>{
  if(options.method==='PUT'){writes++;return{ok:true,json:async()=>({merged:true,sha:'c'.repeat(40)})}}
  let result
  if(url.endsWith('/pulls/109'))result={number:109,head:{sha:head},base:{sha:base},state:'open',merged:false,mergeable:true}
  else if(url.includes('/status?'))result={total_count:4,statuses:CONTEXTS.map(context=>({context,state:'success'}))}
  else if(url.includes('/check-runs?'))result={total_count:0,check_runs:[]}
  else if(url.includes('/reviews?'))result=[]
  else if(url.endsWith('/graphql'))result={data:{repository:{pullRequest:{reviewThreads:{nodes:[],pageInfo:{hasNextPage:false}}}}}}
  else if(url.endsWith('/commits/main'))result={sha:base}
  else throw Error('unexpected_fixture_request')
  return{ok:true,json:async()=>result}
 }})
 await assert.rejects(github.merge({number:109,head,base,guard:()=>{guards++;throw Error('deployment_authorization_expired')}}),/deployment_authorization_expired/)
 assert.equal(guards,1);assert.equal(writes,0)
})
test('expired recovery authority prevents rollback merge immediately before PUT',async()=>{
 const head='a'.repeat(40),base='b'.repeat(40),source='c'.repeat(40),tree='d'.repeat(40);let writes=0
 const github=createGitHub({root:'fixture',tokenProvider:()=> 'fixture-only',fetchImpl:async(url,options)=>{
  if(options.method==='PUT'){writes++;throw Error('unexpected_write')}
  const value=url.endsWith('/commits/main')?{sha:base}:url.endsWith('/pulls/110')?{head:{sha:head},base:{sha:base}}:{commit:{tree:{sha:tree}},parents:[{sha:base}]}
  return{ok:true,json:async()=>value}
 }})
 await assert.rejects(github.rollbackMerge({pr:110,head,base,source,tree,failure:{reason:'runtime_mismatch'},runId:'a'.repeat(36),guard:()=>{throw Error('recovery_authorization_expired')}}),/recovery_authorization_expired/)
 assert.equal(writes,0)
})
