'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto')
const usage=require('../../actions/usageBudget'),{hash}=require('../../actions/contract'),{createStore}=require('../../actions/store')
const fixtures=[1,2,3].map(v=>require('../../../test/localBrain/fixtures/test-draft-review-v'+v+'.json'))
// Saved native responses enter the real adapter/parser; only the network and
// temporary ledger are doubled. No model, Sandbox or production state is used.
for(const f of fixtures)test('real failed review '+f.provenance.inputSha256+' is rejected before it can become an acceptance receipt',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'local-review-replay-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const profile=usage.localDevelopmentProfile(randomUUID()),commit='a'.repeat(40),b=usage.createUsageBudget({store:createStore({dir}),profile,evidenceDir:path.join(dir,'evidence'),activationReady:()=>true,runtimeCommit:()=>commit}),owner={id:'owner',role:'owner'}
 b.handle(owner,{op:'usage_local_acceptance_activate',rootId:profile.id,predecessorHash:hash([]),commit});b.handle(owner,{op:'usage_bind_turn',turnId:profile.id,conversationId:profile.id})
 const scope=b.enterTurn(profile.id,profile.id,randomUUID(),'coding');let sends=0
 const p=require('./localProviders').createLocalProviders({root:dir,executor:{run:async()=>{throw Error('must not execute')},readiness:async()=>({ready:true}),isBusy:()=>false},fetchFn:async(url,o)=>{
  assert.ok(url.startsWith('http://127.0.0.1:11435/'));assert.equal(o.redirect,'error')
  if(url.endsWith('/api/tags'))return{ok:true,json:async()=>({models:[{name:profile.model,digest:profile.digest}]})}
  sends++;return{ok:true,body:(async function*(){yield Buffer.from(JSON.stringify({message:{content:f.outputText},done:true,prompt_eval_count:20,eval_count:10})+'\n')})()}
 }})
 try{await assert.rejects(b.withScope(scope,()=>p.reviewAcceptance(f.packet)),/invalid_worker_result/);assert.equal(sends,1);assert.equal(b.status().helper.dispatched,1)}finally{b.finishTurn(scope);b.handle(owner,{op:'usage_pause'})}
})
