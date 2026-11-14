'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process')
const root=path.resolve(__dirname,'../..'),runtime='C:/Aroma/local-brain-runtime'
test('formal memory timing preserves methods, results and failures without logging query or contents',async()=>{
 const {events}=require('../../src/adapters/LocalAdapter'),trace=[],client={engine:'fixture',preferences:async()=>({items:['private']}),recall:async()=>{throw Error('source_down')},retain:()=>42}
 const wrapped=require('../../src/localBrain/productionStream').measuredMemory(client)
 await events.run(e=>trace.push(e),async()=>{assert.deepEqual(await wrapped.preferences(),{items:['private']});await assert.rejects(wrapped.recall('secret'),/source_down/)})
 assert.equal(wrapped.engine,'fixture');assert.equal(wrapped.retain(),42);assert.equal(trace.length,2);assert.ok(trace.every(e=>e.durationMs>=0));assert.equal(trace[1].code,'memory_read_failed');assert.doesNotMatch(JSON.stringify(trace),/secret|private|source_down/)
})
test('formal profile selects local without accepting fixture paths or an external inference URL',()=>{
 const p=require('../../src/localBrain/production')
 assert.equal(p.profile.mode,'local');assert.equal(p.profile.model,'qwen3.5:9b')
 assert.throws(()=>p.validateEnvironment({LOCAL_TEST_FIXTURES:'1'}),/production_fixture_refused/)
 assert.throws(()=>p.validateEnvironment({LOCAL_OLLAMA_URL:'https://example.com'}),/local_endpoint_refused/)
 assert.throws(()=>p.validateEnvironment({PORT:'8090',LOCAL_APP_PORT:'18092'}),/production_local_port_mismatch/)
 assert.throws(()=>p.validateEnvironment({PORT:'invalid'}),/production_local_port_invalid/)
 assert.doesNotThrow(()=>p.validateEnvironment({}))
})
test('formal canonical storage reuses only the existing authenticated storage RPC without a native service-account spawn',async()=>{
 const dir=fs.mkdtempSync(runtime+'/formal-storage-rpc-'),egress=require('../../src/adapters/liveEgressFence'),original=egress.fencedFetch,token=process.env.CODEX_CHAT_BRIDGE_TOKEN,trace=[];let local
 try{
  process.env.CODEX_CHAT_BRIDGE_TOKEN='a'.repeat(64)
  egress.fencedFetch=provider=>async(url,options)=>{assert.equal(provider,'memory_gateway');trace.push({url,body:JSON.parse(options.body),authorization:options.headers.authorization});return{ok:true,json:async()=>({result:{state:'connected',database:'fixture'}})}}
  local=require('../../src/localBrain/production').createComposition({dataDir:dir})
  assert.equal((await local.memory.store.health()).state,'connected');assert.equal(trace.length,1);assert.equal(trace[0].url,'http://127.0.0.1:8091/memory-store');assert.deepEqual(trace[0].body,{op:'health'});assert.equal(trace[0].authorization,'Bearer '+'a'.repeat(64))
 }finally{local?.close();egress.fencedFetch=original;if(token===undefined)delete process.env.CODEX_CHAT_BRIDGE_TOKEN;else process.env.CODEX_CHAT_BRIDGE_TOKEN=token;fs.rmSync(dir,{recursive:true,force:true})}
})
test('automatic recovery cannot restore a cloud baseline or hide an unknown recovery profile',()=>{
 const {assertLocalRecovery}=require('../../src/localBrain/recovery'),row={committed:{commit:'local'},runtimeSnapshot:{head:'cloud'}},git=args=>args[0]==='ls-tree'?(args[1]==='local'?'blob profile':''):JSON.stringify({mode:'local'})
 assert.throws(()=>assertLocalRecovery({git},row),/local_cloud_recovery_requires_owner/)
 assert.doesNotThrow(()=>assertLocalRecovery({git}, {...row,runtimeSnapshot:{head:'local'}}))
 assert.throws(()=>assertLocalRecovery({git:()=>{throw Error('git_unavailable')}},row),/git_unavailable/)
})
test('a changed model alias is refused before any inference send',async()=>{
 const {LocalAdapter}=require('../../src/adapters/LocalAdapter'),requests=[]
 const adapter=new LocalAdapter({env:{LOCAL_MODEL:'qwen3.5:9b',LOCAL_MODEL_DIGEST:'a'.repeat(64)},fetchFn:async u=>{requests.push(u);return{ok:true,json:async()=>({models:[{name:'qwen3.5:9b',digest:'b'.repeat(64)}]})}}})
 await assert.rejects(adapter.complete('Hello'),/local_model_digest_mismatch/);assert.equal(requests.length,1);assert.match(requests[0],/\/api\/tags$/)
})
test('formal memory uses the canonical store, never seeds it, and persists only derived index/inference',async()=>{
 const dir=fs.mkdtempSync(runtime+'/formal-memory-test-'),calls=[],rows=[]
 const store={generalRows:async()=>rows,all:async()=>rows,get:async()=>null,grants:async()=>[],health:async()=>({state:'connected',database:'fixture-canonical'}),commit:async changes=>{calls.push(changes);return changes.map(c=>c.row)}}
 let memory
 try{
  const create=require('../../src/localBrain/productionMemory').createProductionMemory
  memory=create({store,dir,adapter:{providerName:'local',model:'fixture-local',complete:async()=>({text:'{"quotes":["Blue charts"]}'})}})
  assert.equal(memory.store,store);assert.equal(calls.length,0)
  await memory.engine.forScope('private:owner').retain('xx-06c3a189-a5c1-4287-8fad-46955d4019ab','Blue charts')
  assert.equal(calls.length,0);assert.equal((await memory.engine.forScope('private:owner').recall('Blue')).length,1)
  memory.close();memory=create({store,dir,adapter:{providerName:'local',model:'fixture-local',complete:()=>{throw Error('duplicate_inference')}}})
  assert.equal((await memory.engine.forScope('private:owner').recall('Blue')).length,1)
  assert.equal(memory.engine.status().inference.counts.done,1)
 }finally{memory?.close();fs.rmSync(dir,{recursive:true,force:true})}
})
test('formal no-cloud boundary rejects subscribed Bridge, Hindsight, HTTP redirects, raw sockets and CLI but recognizes exact business reads',()=>{
 const f=require('../../src/localBrain/productionFence')
 assert.equal(f.allowedUrl('http://127.0.0.1:11435/api/chat','POST'),true)
 assert.equal(f.allowedUrl('http://127.0.0.1:8091/memory-store','POST'),true)
 assert.equal(f.allowedUrl('http://127.0.0.1:8091/memory-store?route=complete','POST'),false)
 assert.equal(f.allowedUrl('https://system.aromabistro741.com/ai/inventory','POST'),false)
 for(const u of ['http://127.0.0.1:8091/chat','http://127.0.0.1:8888/v1','https://api.anthropic.com/v1/messages','https://api.openai.com/v1/responses','https://www.googleapis.com/evil'])assert.equal(f.allowedUrl(u),false,u)
 assert.equal(f.allowedUrl('https://system.aromabistro741.com/ai/inventory'),true)
 assert.equal(f.allowedUrl('https://www.googleapis.com/drive/v3/files'),true)
 assert.equal(f.allowedUrl('https://system.aromabistro741.com/ai/chat'),false)
 assert.equal(f.allowedChild('claude.cmd',[],{}),false)
})
test('installed formal fence refuses actual cloud transports and child process launches before forwarding',()=>{
 const code=`const f=require('./src/localBrain/productionFence');const audit=[];const restore=f.install({audit:e=>audit.push(e)});(async()=>{let n=0;for(const invoke of [()=>fetch('https://api.openai.com/v1/responses'),()=>require('http').request('http://127.0.0.1:8091/chat'),()=>require('net').connect(8091,'127.0.0.1'),()=>require('child_process').spawn('claude.cmd',[])]){try{await invoke()}catch(e){if(e.code==='local_cloud_inference_forbidden')n++}}restore();if(n!==4||audit.filter(e=>e.type==='local_egress_denied').length!==4)process.exit(4);console.log('four_denials_before_send')})()`
 const r=cp.spawnSync(process.execPath,['-e',code],{cwd:root,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/four_denials_before_send/)
})
test('formal entry composition activates the reviewed local profile before app creation, without a listener or cloud startup',()=>{
 const dir=fs.mkdtempSync(runtime+'/formal-boot-')
 try{
  const code=`const p=require('./src/localBrain/production');p.activate();const app=require('./src/app');if(!p.isActive()||process.env.LLM_PROVIDER!=='local'||process.env.WORKER_INVOCATION!=='off'||process.env.LOCAL_APP_PORT!=='8090')throw Error('boot_not_local');const same=require('./src/core/operating/chatRequest').sameOrigin;if(!same({get:k=>({host:'127.0.0.1:8090',origin:'http://127.0.0.1:8090'})[k]}))throw Error('formal_origin_refused');const r=p.runtime();if(r.memory.engine.engine!=='local')throw Error('memory_not_local');r.close();console.log('formal_local_composition_created')`
  const r=cp.spawnSync(process.execPath,['-e',code],{cwd:root,env:{...process.env,PORT:'8090',LOCAL_APP_PORT:'',NODE_TEST_CONTEXT:'child-v8',AROMA_DATA_DIR:dir,READ_ACCESS:'off',XIANGXIANG_MEMORY:'on'},encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/formal_local_composition_created/)
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
test('permitted business transport is forwarded once and fetch cannot follow a redirect to an AI service',()=>{
 const code=`const http=require('http');let sent=0;http.request=()=>{sent++;return{fixture:true}};global.fetch=async(u,o)=>{if(o.redirect!=='error')throw Error('redirect_not_stopped');return{ok:true}};const f=require('./src/localBrain/productionFence'),restore=f.install();(async()=>{http.request('https://system.aromabistro741.com/ai/inventory');await fetch('https://www.googleapis.com/drive/v3/files',{redirect:'follow'});restore();if(sent!==1)process.exit(3);console.log('permitted_and_redirect_closed')})()`
 const r=cp.spawnSync(process.execPath,['-e',code],{cwd:root,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/permitted_and_redirect_closed/)
})
test('existing canonical recovery includes a consistent derived SQLite backup and refuses path widening',()=>{
 const result=cp.spawnSync('C:/Aroma/hindsight-runtime/Scripts/python.exe',['-B','-c',`import sys,tempfile,pathlib,sqlite3;sys.path.insert(0,'scripts/memory');import backupRecovery as b;root=pathlib.Path(tempfile.mkdtemp());p=root/'memory-local-index';p.mkdir();d=sqlite3.connect(p/'memory.sqlite');d.execute('pragma journal_mode=wal');d.execute('create table inference(id text,state text)');d.execute("insert into inference values('fixture','running')");d.commit();content=b.local_index_snapshot(p/'memory.sqlite');o=root/'restored.sqlite';o.write_bytes(content);r=sqlite3.connect(o);assert r.execute('select state from inference').fetchone()[0]=='running';assert b.asset_path('memory-local-index/memory.sqlite');print('derived_backup_consistent')`],{cwd:root,encoding:'utf8',windowsHide:true})
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/derived_backup_consistent/)
})
test('formal authenticated app uses canonical memory, local models and SSE, with no duplicate legacy capture',async()=>{
 const {IncomingMessage,ServerResponse}=require('node:http'),{Duplex}=require('node:stream'),dir=fs.mkdtempSync(runtime+'/formal-app-')
 const keys=['AROMA_DATA_DIR','CHAT_BACKEND','LOCAL_BRAIN_ONLY','LOCAL_MODEL','LOCAL_APP_PORT','CONVERSATION_DEMO'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]))
 let local,oldIntake,intake
 async function request(app,url,body,cookie,headers={}){
  const wire=[],socket=new Duplex({read(){},write(c,e,n){wire.push(c.toString());n()}}),req=new IncomingMessage(socket),text=body===null?'':JSON.stringify(body)
  req.method=body===null?'GET':'POST';req.url=url;req.headers={host:'127.0.0.1:18099',origin:'http://127.0.0.1:18099',accept:body===null?'application/json':'text/event-stream',...(text?{'content-type':'application/json','content-length':String(Buffer.byteLength(text))}:{}),...(cookie?{cookie:'aroma_owner_session='+cookie}:{}),...headers};req.httpVersionMajor=1;req.httpVersionMinor=1;req.httpVersion='1.1';req.complete=true
  const res=new ServerResponse(req);res.assignSocket(socket)
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('formal_request_timeout')),6000);res.once('finish',()=>{clearTimeout(timer);resolve()});app.handle(req,res,e=>{if(e){clearTimeout(timer);reject(e)}});if(text)req.push(text);req.push(null)})
  return{status:res.statusCode,wire:wire.join('')}
 }
 try{
  Object.assign(process.env,{AROMA_DATA_DIR:dir,CHAT_BACKEND:'local',LOCAL_BRAIN_ONLY:'1',LOCAL_MODEL:'qwen3.5:9b',LOCAL_APP_PORT:'18099',CONVERSATION_DEMO:'on'})
  const canonical=require('../../src/memory/structuredStore').createTestStore()
  local=require('../../src/localBrain/production').createComposition({dataDir:dir,store:canonical,adapter:{providerName:'local',model:'qwen3.5:9b',preflight:async()=>({available:true})}})
  const queued=local.memory.runtime.event('conversation','formal-fixture','Owner prefers short fixture reports.','owner_statement');await local.memory.runtime.drain()
  // Extraction is unavailable in this transport fixture. The canonical original
  // still supports source recall without claiming its index succeeded.
  const original=await canonical.get(queued.id),before=JSON.stringify(original)
  const recalled=await local.memory.runtime.ownerClient.recall('fixture reports');assert.ok(recalled.some(r=>r.documentId===queued.id))
  intake=require('../../src/intake/intakeService');oldIntake=intake.processIntake
  let reached=0
  intake.processIntake=async(message,adapter,history,options)=>{reached++;assert.equal(adapter,local.provider);assert.equal(options.memoryClient.engine,'memory_gateway');assert.ok((await options.memoryClient.recall('fixture reports')).some(r=>r.documentId===queued.id));require('../../src/adapters/LocalAdapter').events.getStore()({type:'model_start',phase:'answer'});return{mode:'chat',intent:'chit_chat',reply:'Fixture response with retained evidence.'}}
  const app=require('../../src/app').createApp({ownerPassword:'fixture-password-only',serviceToken:'fixture-service-token',localBrain:local}),cookie=app.locals.ownerSessions.issue()
  assert.equal((await request(app,'/api/v1/memory/capture',{op:'enabled',value:false},cookie)).status,200)
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'memory-capture/settings.json'))).enabled,false)
  assert.equal((await request(app,'/api/v1/memory/capture',{op:'enabled',value:true},null)).status,401)
  assert.equal((await request(app,'/api/v1/memory/capture',{op:'enabled',value:true},cookie,{origin:'http://other.example'})).status,403)
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'memory-capture/settings.json'))).enabled,false)
  assert.equal((await request(app,'/api/v1/demo/intake',{message:'Hello'},null)).status,401)
  const denied=await request(app,'/api/v1/project-work',{op:'start'},cookie);assert.equal(denied.status,503);assert.match(denied.wire,/local_capability_unavailable/)
  const catalog=await request(app,'/api/v1/model-center',null,cookie);assert.equal(catalog.status,200);assert.match(catalog.wire,/local:qwen3.5:9b/)
  const response=await request(app,'/api/v1/demo/intake',{message:'Hello, do not save this turn.',history:[],interactionMode:'chat',conversationId:require('node:crypto').randomUUID(),chatModel:'local:qwen3.5:9b'},cookie)
  assert.equal(response.status,200);assert.equal(reached,1);assert.match(response.wire,/data: .*"type":"final"/);assert.match(response.wire,/Fixture response with retained evidence/)
  assert.match(response.wire,/"type":"memory_complete"/)
  assert.equal(JSON.stringify(await canonical.get(queued.id)),before)
  const metadata=fs.readdirSync(path.join(dir,'local-brain')).map(n=>JSON.parse(fs.readFileSync(path.join(dir,'local-brain',n))));assert.equal(metadata.length,1);assert.equal(JSON.stringify(metadata).includes('Hello, do not save'),false)
  assert.equal(metadata[0].trace[0].type,'received')
  assert.equal(fs.existsSync(path.join(dir,'model-center.json')),false)
 }finally{if(intake)intake.processIntake=oldIntake;local?.close();for(const k of keys)if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];fs.rmSync(dir,{recursive:true,force:true})}
})
