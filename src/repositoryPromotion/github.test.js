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
  const get=url=>url.includes('/pulls/65/reviews')?[]:url.includes('/pulls/65')?{head:{sha:head},base:{sha:base},state:'open',mergeable:true}:url.includes('/status?')?{total_count:CONTEXTS.length,statuses:CONTEXTS.map(context=>({context,state:'success'}))}:url.includes('/check-runs?')?{total_count:0,check_runs:[]}:url.endsWith('/graphql')?{data:{repository:{pullRequest:{reviewThreads:{nodes:[],pageInfo:{hasNextPage:false}}}}}}:{sha:base}
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

test('reviews retain a blocking request after later comments and checks beyond page one cannot be ignored',async()=>{
 const head='a'.repeat(40),base='b'.repeat(40);let mode='reviews',puts=0;
 const fetchImpl=async(url,options)=>{let data;if(options.method==='PUT'){puts++;data={merged:true,sha:'c'.repeat(40)}}else if(url.endsWith('/graphql'))data={data:{repository:{pullRequest:{reviewThreads:{nodes:[],pageInfo:{hasNextPage:false}}}}}};else if(url.includes('/reviews?'))data=new URL(url).searchParams.get('page')==='1'?Array.from({length:100},(_,id)=>({id,user:{login:'reviewer'},state:'COMMENTED'})):(mode==='reviews'?[{id:101,user:{login:'reviewer'},state:'CHANGES_REQUESTED'},{id:102,user:{login:'reviewer'},state:'COMMENTED'}]:[]);else if(url.includes('/check-runs?'))data=['checks','partial'].includes(mode)?{total_count:101,check_runs:new URL(url).searchParams.get('page')==='1'?Array.from({length:100},(_,id)=>({id,status:'completed',conclusion:'success'})):(mode==='checks'?[{id:101,status:'completed',conclusion:'failure'}]:[])}:{total_count:0,check_runs:[]};else if(url.includes('/status?'))data={total_count:CONTEXTS.length,statuses:CONTEXTS.map(context=>({context,state:'success'}))};else if(url.includes('/pulls/65'))data={head:{sha:head},base:{sha:base},state:'open',mergeable:true};else data={sha:base};return{ok:true,json:async()=>data}};
 const g=createGitHub({root:'fixture',tokenProvider:()=> 'fixture-only',fetchImpl});let pr=await g.inspectPR(65);assert.equal(pr.unresolvedThreads,1);assert.notEqual(pr.checksState,'success');await assert.rejects(g.merge({number:65,head,base}));assert.equal(puts,0);
 mode='checks';pr=await g.inspectPR(65);assert.equal(pr.checksState,'failure');assert.equal(pr.checks.length,101);await assert.rejects(g.merge({number:65,head,base}));assert.equal(puts,0);mode='partial';pr=await g.inspectPR(65);assert.equal(pr.checksState,'pending');await assert.rejects(g.merge({number:65,head,base}));assert.equal(puts,0);
});
