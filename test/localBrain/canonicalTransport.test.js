'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path')
const root=path.resolve(__dirname,'../..')
function child(code){
 const env={...process.env,NODE_TEST_CONTEXT:'',RUN_PAID_E2E:'',LOCAL_BRAIN_ONLY:'1',CODEX_CHAT_BRIDGE_TOKEN:'a'.repeat(64),ANTHROPIC_API_KEY:'',OPENAI_API_KEY:''}
 const result=cp.spawnSync(process.execPath,['-e',code],{cwd:root,env,windowsHide:true,encoding:'utf8',timeout:20000})
 assert.equal(result.status,0,result.stderr+'\n'+result.stdout);return result.stdout
}

test('local runtime canonical storage traverses the real default transport and both fences',()=>{
 assert.match(child(`const assert=require('node:assert/strict');let sent=0;
 global.fetch=async(url,init)=>{sent++;assert.equal(url,'http://127.0.0.1:8091/memory-store');assert.equal(init.redirect,'error');assert.equal(init.headers.authorization,'Bearer '+'a'.repeat(64));assert.deepEqual(JSON.parse(init.body),{op:'health'});return Response.json({result:{state:'connected',database:'disposable-fixture'}})};
 require('./src/localBrain/productionFence').install();
 (async()=>{const store=require('./src/memory/structuredStore').createStructuredStore();assert.equal((await store.health()).state,'connected');assert.equal(sent,1);console.log('DEFAULT_CANONICAL_TRANSPORT_PASSED')})().catch(e=>{console.error(e);process.exitCode=1})`),/DEFAULT_CANONICAL_TRANSPORT_PASSED/)
})

test('local canonical storage eligibility cannot be reused for cloud, worker, redirect or arbitrary socket destinations',()=>{
 assert.match(child(`const assert=require('node:assert/strict');let sent=0;global.fetch=async()=>{sent++;throw Error('unexpected_send')};
 require('./src/localBrain/productionFence').install();const {fencedFetch}=require('./src/adapters/liveEgressFence');
 const options={method:'POST',redirect:'error',headers:{authorization:'Bearer '+'a'.repeat(64)},body:'{}'};
 (async()=>{for(const [provider,url,change] of [
 ['memory_gateway','https://api.anthropic.com/v1/messages',{}],['memory_gateway','https://api.openai.com/v1/responses',{}],
 ['memory_gateway','http://127.0.0.1:8091/chat',{}],['memory_gateway','http://127.0.0.1:8888/v1',{}],
 ['memory_gateway','http://127.0.0.1:8091/memory-store?op=chat',{}],['memory_gateway','http://localhost:8091/memory-store',{}],
 ['memory_gateway','http://user@127.0.0.1:8091/memory-store',{}],['memory_gateway','http://127.0.0.1:8091/memory-store#x',{}],
 ['memory_gateway','http://127.0.0.1:8091/memory-store',{redirect:'follow'}],['memory_gateway','http://127.0.0.1:8091/memory-store',{method:'GET'}],
 ['memory_gateway','http://127.0.0.1:8091/memory-store',{headers:{}}],['memory_gateway','http://127.0.0.1:8091/memory-store',{dispatcher:{}}],
 ['anthropic','http://127.0.0.1:8091/memory-store',{}],['openai','http://127.0.0.1:8091/memory-store',{}]]){
 await assert.rejects(async()=>fencedFetch(provider)(url,{...options,...change}),e=>e.liveEgressBlocked===true||e.code==='local_cloud_inference_forbidden')}
 process.env.RUN_PAID_E2E='1';await assert.rejects(async()=>fencedFetch('openai')('https://api.openai.com/v1/responses',options));assert.equal(sent,0);console.log('DESTINATIONS_REFUSED_BEFORE_SEND')})().catch(e=>{console.error(e);process.exitCode=1})`),/DESTINATIONS_REFUSED_BEFORE_SEND/)
})

test('an ordinary test process cannot reach the real canonical storage through the local runtime allowance',()=>{
 assert.match(child(`const assert=require('node:assert/strict');process.env.NODE_TEST_CONTEXT='child-v8';let sent=0;global.fetch=async()=>{sent++;throw Error('unexpected_send')};
 (async()=>{await assert.rejects(require('./src/memory/structuredStore').createStructuredStore().health(),e=>e.liveEgressBlocked===true);assert.equal(sent,0);console.log('TEST_STORAGE_FENCE_RETAINED')})().catch(e=>{console.error(e);process.exitCode=1})`),/TEST_STORAGE_FENCE_RETAINED/)
})

test('canonical HTTP and malformed response failures stay explicit and never select a cloud fallback',()=>{
 assert.match(child(`const assert=require('node:assert/strict');let sent=0,mode='unavailable';global.fetch=async()=>{sent++;return mode==='unavailable'?new Response('{}',{status:503}):new Response('invalid-json',{status:200})};
 require('./src/localBrain/productionFence').install();const store=require('./src/memory/structuredStore').createStructuredStore();
 (async()=>{await assert.rejects(store.health(),/memory_database_unavailable/);mode='invalid';await assert.rejects(store.health());assert.equal(sent,2);console.log('STORAGE_FAILURES_PRESERVED')})().catch(e=>{console.error(e);process.exitCode=1})`),/STORAGE_FAILURES_PRESERVED/)
})

test('formal authenticated memory routes and background learning use default storage with both fences retained',()=>{
 assert.match(child(`const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
 const parent='C:/Aroma/local-brain-runtime',dir=fs.mkdtempSync(parent+'/canonical-fence-integration-');let local,canonical;
 (async()=>{try{
 Object.assign(process.env,{AROMA_DATA_DIR:dir,LOCAL_APP_PORT:'18099',PORT:'18099',READ_ACCESS:'off',XIANGXIANG_MEMORY:'off',CONVERSATION_DEMO:'on'});
 // Import the application factory before activation without starting a listener
 // or memory worker. The app under test below uses the local composition.
 const createApp=require('./src/app').createApp;
 canonical=require('./src/localBrain/memoryStore').createLocalStore(path.join(dir,'canonical-fixture'));
 const operations=[],inference=[],text='I prefer concise fixture reports with the conclusion first.';
 global.fetch=async(url,init)=>{assert.equal(url,'http://127.0.0.1:8091/memory-store');assert.equal(init.redirect,'error');assert.equal(init.headers.authorization,'Bearer '+'a'.repeat(64));const request=JSON.parse(init.body);operations.push(request.op);try{return Response.json({result:await canonical.store.request(request)})}catch(e){return Response.json({error:e.message},{status:409})}};
 require('./src/localBrain/production').activate();
 const adapter={providerName:'local',model:'fixture-local',complete:async(prompt,opts)=>{inference.push(opts.invocationPhase);return{text:JSON.stringify(opts.invocationPhase==='memory_extract'?{quotes:[text]}:{candidates:[{kind:'preference',subject:'Fixture report style',text,quote:text,reason:'Explicit fixture statement',supersedes:null,taskState:null}]})}}};
 // No store or egress helper injection: use createComposition's real default
 // authenticated RPC and substitute only the final network receiver's database.
 local=require('./src/localBrain/production').createComposition({dataDir:dir,adapter});
 const queued=local.memory.runtime.event('conversation','fence-fixture',text,'owner_statement');
 await local.memory.runtime.drain();await local.memory.runtime.consolidation.tick();
 assert.equal(local.memory.runtime.status().error,null);assert.equal(local.memory.runtime.consolidation.status().error,null);
 const {OWNER}=require('./src/memory/governed'),source=await local.memory.gateway.get(OWNER,queued.id);assert.equal(source.index.state,'saved');
 assert.ok((await local.memory.gateway.recall(OWNER,'concise fixture reports')).some(r=>r.documentId===queued.id));
 const candidates=await local.memory.gateway.list(OWNER,{status:'candidate'});assert.equal(candidates.length,1);assert.equal(candidates[0].text,text);
 assert.equal((await local.memory.gateway.preferences(OWNER)).items.length,0);await assert.rejects(local.memory.gateway.transition({id:'agent',role:'agent'},candidates[0].id,candidates[0].version,'approve'),/permission/);
 const app=createApp({localBrain:local,ownerPassword:'fixture-password-only',serviceToken:'fixture-service-token'});
 const {IncomingMessage,ServerResponse}=require('node:http'),{Duplex}=require('node:stream');
 async function read(url,authenticated){const wire=[],socket=new Duplex({read(){},write(c,e,n){wire.push(c.toString());n()}}),req=new IncomingMessage(socket);req.method='GET';req.url=url;req.headers={host:'127.0.0.1:18099',accept:'application/json',...(authenticated?{authorization:'Bearer fixture-service-token'}:{})};req.httpVersionMajor=1;req.httpVersionMinor=1;req.httpVersion='1.1';req.complete=true;const res=new ServerResponse(req);res.assignSocket(socket);await new Promise((ok,no)=>{const timer=setTimeout(()=>no(Error('route_timeout')),3000);res.once('finish',()=>{clearTimeout(timer);ok()});app.handle(req,res,e=>{if(e){clearTimeout(timer);no(e)}});req.push(null)});return{status:res.statusCode,wire:wire.join('')}}
 assert.equal((await read('/api/v1/memory/catalog/'+queued.id,false)).status,401);
 const visible=await read('/api/v1/memory/catalog/'+queued.id,true);assert.equal(visible.status,200);assert.ok(visible.wire.includes(queued.id));assert.ok(visible.wire.includes(text));
 assert.deepEqual(inference,['memory_extract','memory_consolidation']);assert.ok(operations.includes('get'));assert.ok(operations.includes('general_page'));assert.ok(operations.includes('commit'));assert.ok(operations.includes('audit'));
 // Canonical revision and evidence survive, and re-drain does not repeat work.
 await local.memory.runtime.drain();await local.memory.runtime.consolidation.tick();assert.equal(inference.length,2);
 local.memory.runtime.stop();console.log('FORMAL_STORAGE_BACKGROUND_AND_GUARDS_PASSED');
 }finally{local?.memory.runtime.stop();local?.close();canonical?.close();assert.ok(path.resolve(dir).startsWith(path.resolve(parent)+path.sep));fs.rmSync(dir,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1})`),/FORMAL_STORAGE_BACKGROUND_AND_GUARDS_PASSED/)
})
