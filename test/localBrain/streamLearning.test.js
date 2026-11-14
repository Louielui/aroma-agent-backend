'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict'),{ServerResponse}=require('node:http'),{Duplex}=require('node:stream')
function response(){
 const chunks=[],socket=new Duplex({read(){},write(chunk,encoding,next){chunks.push(chunk.toString());next()}})
 const res=new ServerResponse({method:'POST',httpVersionMajor:1,httpVersionMinor:1});res.assignSocket(socket)
 res.locals={};res.set=values=>{for(const [k,v]of Object.entries(values))res.setHeader(k,v);return res}
 return {res,chunks}
}
test('saved UI failure: receipt metadata precedes streamed model output and late capture failures remain visible',()=>{
 const {writeLocalEvent}=require('../../src/localBrain/server'),{setMemoryReceipt}=require('../../src/routes/demoRouter'),{res,chunks}=response()
 writeLocalEvent(res,{type:'received',provider:'local'})
 assert.equal(res.headersSent,false)
 setMemoryReceipt(res,'queued');assert.equal(res.getHeader('X-Memory-Receipt'),'queued')
 writeLocalEvent(res,{type:'model_start',phase:'answer'});assert.equal(res.headersSent,true)
 assert.throws(()=>res.setHeader('X-Memory-Receipt','unavailable'),{code:'ERR_HTTP_HEADERS_SENT'})
 assert.doesNotThrow(()=>setMemoryReceipt(res,'unavailable'))
 writeLocalEvent(res,{type:'final',body:{reply:'Fixture acknowledged'},memoryReceipt:res.locals.memoryReceipt});res.end()
 const wire=chunks.join('');assert.match(wire,/model_start/);assert.match(wire,/Fixture acknowledged/);assert.match(wire,/"memoryReceipt":"unavailable"/)
 assert.equal(wire.includes('"type":"received"'),false)
})
test('nonstreaming receipt headers retain their original status without committing a response',()=>{
 const {setMemoryReceipt}=require('../../src/routes/demoRouter'),{res}=response()
 for(const state of ['queued','excluded','paused','partial','unavailable']){setMemoryReceipt(res,state);assert.equal(res.getHeader('X-Memory-Receipt'),state);assert.equal(res.locals.memoryReceipt,state)}
 assert.equal(res.headersSent,false);res.end()
})
