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
