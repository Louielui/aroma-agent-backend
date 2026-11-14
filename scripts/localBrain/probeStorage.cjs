'use strict'
// Explicit host-only read probe. No listener, model call, canonical write,
// background worker activation, credentials output or production file change.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto')
async function main(){
 if(process.argv.slice(2).join(' ')!=='--real-readonly')throw Error('explicit_readonly_probe_required')
 const live='C:/Aroma/aroma-agent-backend',parent='C:/Aroma/local-brain-runtime'
 const dir=fs.mkdtempSync(parent+'/canonical-readonly-'),profile=require('../../src/localBrain/production')
 let composition
 try{
  Object.assign(process.env,require('dotenv').parse(fs.readFileSync(live+'/.env')))
  Object.assign(process.env,{AROMA_DATA_DIR:dir,PORT:'18099',LOCAL_APP_PORT:'18099',XIANGXIANG_MEMORY:'on',READ_ACCESS:'off',CONVERSATION_DEMO:'on'})
  // Pause before importing the activated formal app: its ordinary startup must
  // never drain the production outbox or create an inference reservation here.
  fs.mkdirSync(path.join(dir,'memory-capture'));fs.writeFileSync(path.join(dir,'memory-capture/settings.json'),JSON.stringify({enabled:false}))
  profile.activate()
  // Suppress ancillary app schedulers only during construction. Restore the
  // marker before every canonical request, so the default transport sees the
  // same non-test local-mode decision as the formal service.
  const testContext=process.env.NODE_TEST_CONTEXT;process.env.NODE_TEST_CONTEXT='readonly-probe-construction'
  let createApp,app
  try{
   createApp=require('../../src/app').createApp;composition=profile.runtime()
   app=createApp({localBrain:composition,serviceToken:'isolated-readonly-service-token',ownerPassword:'isolated-fixture-password'})
  }finally{if(testContext===undefined)delete process.env.NODE_TEST_CONTEXT;else process.env.NODE_TEST_CONTEXT=testContext}
  let inference=0;composition.provider.complete=async()=>{inference++;throw Error('readonly_probe_model_forbidden')}
  const {IncomingMessage,ServerResponse}=require('node:http'),{Duplex}=require('node:stream')
  async function get(id){
   const chunks=[];const socket=new Duplex({read(){},write(c,e,done){done()}}),req=new IncomingMessage(socket)
   req.method='GET';req.url='/api/v1/memory/catalog/'+id;req.headers={host:'127.0.0.1:18099',accept:'application/json',authorization:'Bearer isolated-readonly-service-token'};req.httpVersion='1.1';req.httpVersionMajor=1;req.httpVersionMinor=1;req.complete=true
   const res=new ServerResponse(req);res.assignSocket(socket)
   const write=res.write.bind(res),end=res.end.bind(res)
   res.write=(chunk,...args)=>{if(chunk)chunks.push(Buffer.from(chunk));return write(chunk,...args)}
   res.end=(chunk,...args)=>{if(chunk)chunks.push(Buffer.from(chunk));return end(chunk,...args)}
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('canonical_route_timeout')),30000);res.once('finish',()=>{clearTimeout(timer);resolve()});app.handle(req,res,e=>{if(e){clearTimeout(timer);reject(e)}});req.push(null)})
   assert.equal(res.statusCode,200,'formal_canonical_route_failed');return JSON.parse(Buffer.concat(chunks).toString()).record
  }
  const expected=[['xx-06c3a189-a5c1-4287-8fad-46955d4019ab',4,'02a5acc67da36f30d6ad6f2f53236564fc775a733556100788dea7aa66c9cf9a'],['xx-cd157abe-4079-49ab-8895-b562db8252d4',4,'cbbfb22d7e4377a3bd5823496925d3d228d2dba88c8e1ff74347c879c84954b0'],['xx-a2b8cbbc-2cf9-4d4f-8876-8f9b00b49537',3,'876e7fb2ee15a10e824a668043e7af7300be5935c325d8678416e9bc469df447']]
  const records=[]
  for(const [id,version,hash]of expected){const row=await get(id);assert.equal(row.status,'active');assert.equal(row.version,version);assert.equal(crypto.createHash('sha256').update(row.text).digest('hex'),hash);records.push({id,version,hash})}
  const preferences=await composition.memory.gateway.preferences(require('../../src/memory/governed').OWNER)
  assert.ok(preferences.items.some(r=>r.id===expected[2][0]),'approved_preference_unavailable')
  assert.equal(inference,0);assert.equal(composition.memory.runtime.status().enabled,false)
  console.log(JSON.stringify({at:new Date().toISOString(),state:'ISOLATED_FORMAL_DEFAULT_STORAGE_READONLY_PASS',records,approvedPreferenceFound:true,defaultStorageTransport:true,productionFenceActive:profile.isActive(),modelCalls:inference,canonicalWrites:0,productionServicesChanged:false,note:'Real canonical data through existing Bridge; isolated in-memory authenticated app, not formal listener or browser pixels'}))
 }finally{composition?.memory.runtime.stop();composition?.close();assert.ok(path.resolve(dir).startsWith(path.resolve(parent)+path.sep));fs.rmSync(dir,{recursive:true,force:true})}
}
main().catch(e=>{console.error(JSON.stringify({state:'CANONICAL_READONLY_NOT_CONFIRMED',code:e.code||e.message}));process.exitCode=1})
