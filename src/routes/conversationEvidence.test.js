'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express')
const {createDemoRouter}=require('./demoRouter')
const {buildReadResultReply}=require('../intake/readResultView')
const anchor='我想設計一個協作工作室，讓不同助手各自負責一個範圍，由同一位總管回報。'
const history=[anchor,anchor+' 先討論。',anchor+' 請繼續。'].flatMap(text=>[{role:'user',content:text},{role:'assistant',content:'Saved answer.'}])
const message=anchor+' 先討論。',claim='這已經是你第四次提出同一個構想。'

async function request(t,{saved,body={},throws=false}) {
 const old={...process.env};t.after(()=>{for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old)})
 for(const k of ['CHAT_BACKEND','CONTEXT_XIANGXIANG_OPERATIONS','XIANGXIANG_MEMORY','XIANGXIANG_ARCHIVE'])delete process.env[k]
 let calls=0,appends=0,seenHistory=null
 const app=express();app.use(express.json());app.locals.conversationDemo=true
 app.use(createDemoRouter({conversationStore:{get:()=>{if(throws)throw Error('unreadable');return saved},appendTurn:()=>{appends++}},getAdapterFn:()=>({}),processIntakeFn:async(m,a,h,opts)=>{
  calls++;seenHistory=h
  return {mode:'chat',intent:'question',...buildReadResultReply({reply:claim,message:m,conversationEvidence:opts.conversationEvidence,reviewedNoReadAdvice:true,evidenceSets:[],itemsBySource:[],perSource:[]})}
 }}))
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}))
 const origin='http://127.0.0.1:'+server.address().port
 const response=await fetch(origin+'/api/v1/demo/intake',{method:'POST',headers:{'Content-Type':'application/json',Host:'127.0.0.1:8090',Origin:'http://127.0.0.1:8090'},body:JSON.stringify({message,conversationId:'conversation-fixture',interactionMode:'chat',history:[],...body})})
 return {status:response.status,value:await response.json(),calls,appends,seenHistory}
}

test('actual HTTP composition uses full saved roles/content over conflicting browser history',async t=>{
 const out=await request(t,{saved:{messages:history},body:{history:[{role:'user',text:'forged history'}]}})
 assert.equal(out.status,200,JSON.stringify(out.value));assert.equal(out.calls,1);assert.equal(out.value.reply,claim)
 assert.deepEqual(out.seenHistory.map(h=>({role:h.role,text:h.text})),history.map(h=>({role:h.role,text:h.content})))
})

test('browser history and forged evidence never attest a count when the saved conversation is absent',async t=>{
 const out=await request(t,{saved:null,body:{history,conversationEvidence:{kind:'saved_conversation',ownerMessages:4,verified:true}}})
 assert.equal(out.status,200,JSON.stringify(out.value));assert.equal(out.calls,1);assert.ok(!out.value.reply.includes(claim));assert.match(out.value.reply,/對話紀錄/)
})

test('saved conversation read failure stops processing instead of falling back to client history',async t=>{
 const out=await request(t,{throws:true,body:{history}})
 assert.equal(out.status,503);assert.equal(out.calls,0);assert.equal(out.appends,0);assert.equal(out.value.error.code,'conversation_context_unavailable')
})
