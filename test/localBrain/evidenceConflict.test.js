'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const fixture=require('./conflicting-read.fixture.json')
const data=fs.mkdtempSync(path.join(os.tmpdir(),'local-read-conflict-'))
Object.assign(process.env,{LOCAL_BRAIN_ONLY:'1',LLM_PROVIDER:'local',CHAT_BACKEND:'local',LOCAL_MODEL:'qwen3.5:9b',LOCAL_MODEL_CONTEXT:'65536',AROMA_DATA_DIR:data,READ_ACCESS:'on',XIANGXIANG_MEMORY:'off',A4_KNOWLEDGE_ROUTING:'on',GOAL_DECOMPOSER:'on',TURN_ROUTER:'on',CONVERSATION_DEMO:'on',CONTEXT_AROMA_SYSTEM:'on'})
delete process.env.LOCAL_TOKENIZER_URL

test('saved real verifier/resolver disagreement cannot publish an invented successful read',async()=>{
 const original=globalThis.fetch;let calls=0,reads=0
 globalThis.fetch=async(url,options)=>{
  if(url==='http://127.0.0.1:11435/api/tags')return Response.json({models:[{name:'qwen3.5:9b'}]})
  assert.equal(url,'http://127.0.0.1:11435/api/chat')
  const saved=fixture.outputs[calls++];assert.ok(saved,'no retries or additional model decisions')
  return new Response(JSON.stringify({message:{content:saved.text}})+'\n'+JSON.stringify({done:true})+'\n')
 }
 try{
  const {LocalAdapter}=require('../../src/adapters/LocalAdapter')
  const deps=require('../../src/intake/a4Runtime').createA4RuntimeDependencies({env:process.env}).deps
  const connector={read:async()=>{reads++;throw Error('unexpected_connector_call')}}
  await assert.rejects(require('../../src/intake/intakeService').processIntake(fixture.message,new LocalAdapter(),[],{demo:true,interactionMode:'chat',readContextDeps:{...deps,connector},requestId:'offline-local-read-conflict'}),{code:'local_evidence_decision_conflict'})
  assert.equal(calls,4);assert.equal(reads,0)
 }finally{globalThis.fetch=original;fs.rmSync(data,{recursive:true,force:true})}
})
