'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{createGitHub,CONTEXTS}=require('./github')
test('GitHub adapter never accepts arbitrary repositories or records absent status evidence',async()=>{
  let calls=0;const api=createGitHub({root:'fixture',tokenProvider:()=> 'fixture-only',fetchImpl:async()=>{calls++;return{ok:true,json:async()=>({})}}})
  await assert.rejects(api.api('/repos/other/repo/pulls'),/outside_policy/)
  await assert.rejects(Promise.resolve().then(()=>api.api('/repos/Louielui/aroma-agent-backend/../../other')),/outside_policy/)
  assert.throws(()=>api.api('/repos/Louielui/aroma-agent-backend/pulls',{method:'POST',body:{}}),/raw_github_write_forbidden/)
  await assert.rejects(api.recordChecks(65,'a'.repeat(40),{tests:true,review:false,preservation:true,policy:true}),/invalid_status_proof/)
  assert.equal(calls,0)
})
test('merge rechecks exact PR head, base, checks and unresolved review threads',async()=>{
  const head='a'.repeat(40),base='b'.repeat(40);let puts=0
  const get=url=>url.includes('/pulls/65/reviews')?[]:url.includes('/pulls/65')?{head:{sha:head},base:{sha:base},state:'open',mergeable:true}:url.endsWith('/status')?{statuses:CONTEXTS.map(context=>({context,state:'success'}))}:url.endsWith('/check-runs')?{check_runs:[]}:url.endsWith('/graphql')?{data:{repository:{pullRequest:{reviewThreads:{nodes:[],pageInfo:{hasNextPage:false}}}}}}:{sha:base}
  const api=createGitHub({root:'fixture',tokenProvider:()=> 'fixture-only',fetchImpl:async(url,options)=>{if(options.method==='PUT'){puts++;return{ok:true,json:async()=>({merged:true,sha:'c'.repeat(40)})}}return{ok:true,json:async()=>get(url)}}})
  await assert.rejects(api.merge({number:65,head:'d'.repeat(40),base}),/head_or_base_changed/);assert.equal(puts,0)
  assert.equal((await api.merge({number:65,head,base})).commit,'c'.repeat(40));assert.equal(puts,1)
})
test('an encoded branch slash is legal query data while encoded path traversal remains refused',async()=>{
  let calls=0
  const g=createGitHub({root:'fixture',tokenProvider:()=> 'fixture-only',fetchImpl:async()=>{calls++;return{ok:true,json:async()=>[]}}})
  await g.api('/repos/Louielui/aroma-agent-backend/pulls?state=open&head=Louielui%3Apolicy%2Fsafe')
  assert.equal(calls,1)
  await assert.rejects(g.api('/repos/Louielui/aroma-agent-backend/%2e%2e/other'),/outside_policy/)
  assert.equal(calls,1)
})
