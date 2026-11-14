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
test('authenticated app composition reaches intake and ends SSE with a real memory journal, without a listener',async()=>{
 const fs=require('node:fs'),path=require('node:path'),{IncomingMessage}=require('node:http'),dir=fs.mkdtempSync('C:/Aroma/local-brain-runtime/stream-app-')
 const keys=['LOCAL_BRAIN_ONLY','LOCAL_MEMORY_LEARNING','LOCAL_LEARNING_DIR','LOCAL_APP_PORT','AROMA_DATA_DIR'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]))
 const intake=require('../../src/intake/intakeService'),oldIntake=intake.processIntake,{LocalAdapter,events}=require('../../src/adapters/LocalAdapter'),oldPreflight=LocalAdapter.prototype.preflight
 let host,called=0
 try{
  Object.assign(process.env,{LOCAL_BRAIN_ONLY:'1',LOCAL_MEMORY_LEARNING:'1',LOCAL_LEARNING_DIR:path.join(dir,'learning'),LOCAL_APP_PORT:'18092',AROMA_DATA_DIR:path.join(dir,'data')})
  LocalAdapter.prototype.preflight=async()=>{}
  intake.processIntake=async()=>{called++;events.getStore()({type:'model_start',phase:'fixture'});return {intent:'chit_chat',mode:'chat',reply:'Fixture acknowledged.'}}
  host=require('../../src/localBrain/server').createLocalApp({dataDir:path.join(dir,'data'),ownerPassword:'disposable-fixture-password'})
  host.learning.runtime.stop()
  const chunks=[],socket=new Duplex({read(){},write(c,e,next){chunks.push(c.toString());next()}}),req=new IncomingMessage(socket)
  const body=JSON.stringify({message:'I prefer fixture diagrams in blue.',history:[],interactionMode:'chat',conversationId:require('node:crypto').randomUUID()})
  req.method='POST';req.url='/api/v1/demo/intake';req.headers={host:'127.0.0.1:18092',origin:'http://127.0.0.1:18092',accept:'text/event-stream','content-type':'application/json','content-length':String(Buffer.byteLength(body)),cookie:'aroma_owner_session='+host.sessions.issue()}
  req.httpVersionMajor=1;req.httpVersionMinor=1;req.httpVersion='1.1';req.complete=true
  const res=new ServerResponse(req);res.assignSocket(socket)
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('fixture_stream_did_not_finish')),5000);res.once('finish',()=>{clearTimeout(timer);resolve()});host.app.handle(req,res,e=>{if(e){clearTimeout(timer);reject(e)}});req.push(body);req.push(null)})
  await new Promise(r=>setImmediate(r))
  assert.equal(called,1);const wire=chunks.join('');assert.match(wire,/Fixture acknowledged/);assert.equal((wire.match(/"type":"final"/g)||[]).length,1)
  assert.ok(fs.existsSync(path.join(dir,'data','turns.jsonl')))
  assert.ok(host.learning.runtime.status().pending>=1)
 }finally{
  intake.processIntake=oldIntake;LocalAdapter.prototype.preflight=oldPreflight;host?.close()
  for(const k of keys)if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k]
  fs.rmSync(dir,{recursive:true,force:true})
 }
})
