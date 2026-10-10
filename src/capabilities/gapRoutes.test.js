'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),{randomUUID}=require('node:crypto')
const {createGapService}=require('./gapService'),{detectGap}=require('./gapContract'),{createGapRouter}=require('./gapRoutes')
const {createDemoRouter}=require('../routes/demoRouter'),{createConversationStore}=require('../store/conversationStore')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path')
test('actual HTTP intake produces a saved proposal, reload restores it and natural confirmation creates one bounded handoff',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'capability-gap-http-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  const conversations=createConversationStore({dataDir:dir}),cid=randomUUID(),gap=detectGap({reason:'no_mapped_operation',state:{facts:[{need:'time punches',necessity:'required',readState:'no_system_operation',operation:null}]}})
  let calls=0,starts=0
  const service=createGapService({conversations,revision:'a'.repeat(40),planner:{start:()=>{starts++}}})
  const app=express();app.locals.conversationDemo=true;app.use(express.json());app.use(['/api/v1/capability-gaps','/api/v1/demo'],(q,r,next)=>q.headers.authorization==='Bearer owner'?next():r.sendStatus(401));app.use(createGapRouter({service}));app.use(createDemoRouter({capabilityGaps:service,conversationStore:conversations,getAdapterFn:()=>({}),processIntakeFn:async()=>{calls++;return {mode:'chat',reply:'Live evidence unavailable.',capabilityGap:gap,tasks:[]}}}))
  const server=app.listen(0,'127.0.0.1');t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}));await new Promise(r=>server.once('listening',r));const url='http://127.0.0.1:'+server.address().port
  const send=(api,body,origin='http://127.0.0.1:8090')=>new Promise((resolve,reject)=>{const q=require('node:http').request(url+api,{method:'POST',headers:{authorization:'Bearer owner','content-type':'application/json',host:'127.0.0.1:8090',origin}},r=>{let raw='';r.on('data',v=>raw+=v);r.on('end',()=>resolve({status:r.statusCode,body:JSON.parse(raw)}))});q.on('error',reject);q.end(JSON.stringify(body))})
  const post=async body=>(await send('/api/v1/demo/intake',body)).body
  const v=await post({message:'幫我找7shifts員工clock out時間',conversationId:cid,interactionMode:'chat'}),id=v.capabilityGapRunId
  assert.ok(id);assert.equal(conversations.get(cid).messages.at(-1).capabilityGapRunId,id)
  assert.equal((await fetch(url+'/api/v1/capability-gaps/'+id)).status,401)
  const saved=await (await fetch(url+'/api/v1/capability-gaps/'+id,{headers:{authorization:'Bearer owner'}})).json();assert.equal(saved.run.originalGoal,'幫我找7shifts員工clock out時間')
  const a=await post({message:'好，開始',conversationId:cid,interactionMode:'chat'});assert.ok(a.capabilityGapResolution,JSON.stringify(a));assert.equal(a.capabilityGapResolution.state,'awaiting_scope_registration')
  await post({message:'yes',conversationId:cid,interactionMode:'chat'});assert.equal(calls,1);assert.equal(starts,0)
  const foreign=await send('/api/v1/capability-gaps',{op:'approve',id,conversationId:cid,hash:saved.run.proposalHash},'https://evil.example');assert.equal(foreign.status,403)
  const injected=await send('/api/v1/capability-gaps',{op:'approve',id,conversationId:cid,hash:saved.run.proposalHash,files:['.env']});assert.equal(injected.status,400)
})
