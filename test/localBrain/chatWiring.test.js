'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm')
const root=path.resolve(__dirname,'../..')
function client(){const window={};vm.runInNewContext(fs.readFileSync(path.join(root,'src/demo/assets/topics.js'),'utf8'),{window});return window.XiangxiangTopics}
 async function request(app,url,{body,method=body?'POST':'GET',cookie,headers={}}={}){
  const {IncomingMessage,ServerResponse}=require('node:http'),{Duplex}=require('node:stream')
  const wire=[],socket=new Duplex({read(){},write(c,e,n){wire.push(c.toString());n()}}),req=new IncomingMessage(socket),text=body?JSON.stringify(body):''
  req.method=method;req.url=url;req.headers={host:'127.0.0.1:18099',origin:'http://127.0.0.1:18099',accept:'application/json',...(text?{'content-type':'application/json','content-length':String(Buffer.byteLength(text))}:{}),...(cookie?{cookie:'aroma_owner_session='+cookie}:{}),...headers};req.httpVersionMajor=1;req.httpVersionMinor=1;req.httpVersion='1.1';req.complete=true
  const res=new ServerResponse(req);res.assignSocket(socket)
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('request_timeout')),8000);res.once('finish',()=>{clearTimeout(timer);resolve()});app.handle(req,res,e=>{if(e){clearTimeout(timer);reject(e)}});if(text)req.push(text);req.push(null)})
  const raw=wire.join(''),payload=raw.slice(raw.indexOf('\r\n\r\n')+4);return{status:res.statusCode,raw,json:()=>JSON.parse(payload)}
 }
test('formal local chat follows authenticated page, scoped catalogue, selection and guarded SSE ingress',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'local-chat-wiring-')),keys=['AROMA_DATA_DIR','CHAT_BACKEND','LOCAL_BRAIN_ONLY','LOCAL_MODEL','LOCAL_APP_PORT','CONVERSATION_DEMO'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));let local,intake,oldIntake
 try{
  Object.assign(process.env,{AROMA_DATA_DIR:dir,CHAT_BACKEND:'local',LOCAL_BRAIN_ONLY:'1',LOCAL_MODEL:'qwen3.5:9b',LOCAL_APP_PORT:'18099',CONVERSATION_DEMO:'on'})
  fs.mkdirSync(path.join(dir,'memory-capture'),{recursive:true});fs.writeFileSync(path.join(dir,'memory-capture/settings.json'),JSON.stringify({enabled:false}))
  let nativeCalls=0,metadataCalls=0,available=true
  const provider={providerName:'local',model:'qwen3.5:9b',preflight:async()=>{metadataCalls++;if(!available)throw Error('local_service_unavailable');return{available:true,provider:'local',model:'qwen3.5:9b'}},complete:()=>{nativeCalls++;throw Error('unexpected_inference')}}
  local=require('../../src/localBrain/production').createComposition({dataDir:dir,store:require('../../src/memory/structuredStore').createTestStore(),adapter:provider})
  intake=require('../../src/intake/intakeService');oldIntake=intake.processIntake;let reached=0
  intake.processIntake=async(message,adapter,history,options)=>{reached++;assert.equal(adapter,provider);assert.equal(options.chatModel,'local:qwen3.5:9b');assert.equal(options.chatLevel,'auto');require('../../src/adapters/LocalAdapter').events.getStore()({type:'model_start',phase:'answer'});return{mode:'chat',intent:'chit_chat',reply:'Guarded fixture reply.'}}
  const app=require('../../src/app').createApp({ownerPassword:'fixture-password-only',serviceToken:'fixture-token-only',localBrain:local}),cookie=app.locals.ownerSessions.issue(),cid=crypto.randomUUID()
  assert.equal((await request(app,'/api/v1/demo/models')).status,401)
  const page=await request(app,'/demo',{cookie});assert.equal(page.status,200);assert.match(page.raw,/var LOCAL_BRAIN = true/)
  const catalogue=await request(app,'/api/v1/demo/models',{cookie,headers:{'x-xiangxiang-conversation':cid}});assert.equal(catalogue.status,200);const c=catalogue.json();assert.equal(c.billing,'local');assert.equal(c.models.length,1);assert.equal(c.models[0].model,'local:qwen3.5:9b');assert.equal(c.models[0].available,true);assert.equal(c.selection.effective.model,c.models[0].model);assert.equal(c.selection.effective.effort,'auto')
  const topic=(await request(app,'/api/v1/demo/models',{cookie,headers:{'x-xiangxiang-topic':'memory'}})).json();assert.equal(topic.selection.scope.kind,'topic');assert.equal(topic.selection.scope.id,'memory');assert.equal(topic.selection.effective.model,'local:qwen3.5:9b')
  const scoped='/api/v1/model-center/selection/conversation/'+cid
  const selected=await request(app,scoped,{method:'PUT',cookie,body:{revision:0,mode:'custom',model:'local:qwen3.5:9b',effort:'auto'}});assert.equal(selected.status,200);assert.equal(selected.json().selection.effective.effort,'auto')
  assert.equal((await request(app,scoped,{method:'PUT',cookie,body:{revision:0,mode:'central'}})).status,409)
  assert.equal((await request(app,scoped,{method:'PUT',cookie,body:{revision:1,mode:'custom',model:'claude-sonnet',effort:'medium'}})).status,400)
  assert.equal((await request(app,scoped,{method:'PUT',cookie,headers:{origin:'https://other.invalid'},body:{revision:1,mode:'central'}})).status,403)
  const response=await request(app,'/api/v1/demo/intake',{cookie,headers:{accept:'text/event-stream'},body:{message:'Hello, do not retain.',history:[],interactionMode:'chat',conversationId:cid,chatModel:'local:qwen3.5:9b',chatLevel:'medium'}})
  assert.equal(response.status,200);assert.match(response.raw,/Guarded fixture reply/);assert.match(response.raw,/"type":"final"/);assert.equal(reached,1)
  const rejected=await request(app,'/api/v1/demo/intake',{cookie,body:{message:'Hello',history:[],interactionMode:'chat',conversationId:crypto.randomUUID(),chatModel:'claude-sonnet'}});assert.equal(rejected.status,400);assert.equal(reached,1)
  const status=(await request(app,'/api/v1/execution-health',{cookie})).json();assert.equal(status.inference.state,'ready');assert.equal(status.inference.model,'qwen3.5:9b');assert.equal(status.inference.cloudFallback,false);assert.equal(status.dispatch.enabled,false);assert.equal(status.dispatch.reason,'local_worker_not_connected');assert.equal(client().executionLabel(status,true,k=>k),'localBrain.chatReadyWorkerUnavailable')
  available=false;const unavailable=(await request(app,'/api/v1/demo/models',{cookie,headers:{'x-xiangxiang-conversation':cid}})).json();assert.equal(unavailable.models[0].available,false)
  const failedStatus=(await request(app,'/api/v1/execution-health',{cookie})).json();assert.equal(failedStatus.inference.state,'unavailable');assert.equal(client().executionLabel(failedStatus,true,k=>k),'localBrain.unavailable')
  assert.ok(metadataCalls>=3);assert.equal(nativeCalls,0);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'memory-capture/settings.json'))).enabled,false);assert.equal(fs.existsSync(path.join(dir,'scheduler-action-runs','usage-budget')),false)
 }finally{if(intake)intake.processIntake=oldIntake;local?.close();for(const k of keys)if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];fs.rmSync(dir,{recursive:true,force:true})}
})

test('authenticated manual SSE chat uses the independent cap across two saved turns',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'manual-owner-http-'))
 const env={AROMA_DATA_DIR:dir,CHAT_BACKEND:'local',LOCAL_BRAIN_ONLY:'1',LOCAL_MODEL:'qwen3.5:9b',LOCAL_APP_PORT:'18099',CONVERSATION_DEMO:'on'}
 const previous=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]))
 Object.assign(process.env,env)
 t.after(()=>{for(const [k,v] of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;fs.rmSync(dir,{recursive:true,force:true})})
 const profile=require('../../src/localBrain/deploymentProfile.json'),calls=[]
 const provider=new (require('../../src/adapters/LocalAdapter').LocalAdapter)({env:{LOCAL_MODEL:profile.model,LOCAL_MODEL_DIGEST:profile.digest,LOCAL_MODEL_CONTEXT:String(profile.context)},fetchFn:async(url,o)=>{
  if(url.endsWith('/api/tags'))return Response.json({models:[{name:profile.model,digest:profile.digest}]})
  assert.equal(url,profile.endpoint+'/api/chat')
  calls.push(JSON.parse(o.body))
  return new Response(JSON.stringify({done:true,message:{content:JSON.stringify({intent:'chit_chat',mode:'chat',reply:'Mock cobalt reply',tasks:[],risks:[],memoryReferences:[]})}})+'\n')
 }})
 const local=require('../../src/localBrain/production').createComposition({dataDir:dir,memoryEnabled:false,adapter:provider})
 const grant=require('../../src/localBrain/dailyDialogue').createDailyDialogue({dir:path.join(dir,'owner-local-dialogue'),runtimeCommit:()=>'b'.repeat(40)})
 local.dailyDialogue=grant.run
 const app=require('../../src/app').createApp({ownerPassword:'fixture-password-only',serviceToken:'fixture-token-only',localBrain:local})
 const cookie=app.locals.ownerSessions.issue(),conversationId=crypto.randomUUID(),headers={accept:'text/event-stream'}
 const send=(message,extra={},session=cookie,id=crypto.randomUUID())=>request(app,'/api/v1/demo/intake',{cookie:session,headers:{...headers,...extra},body:{message,conversationId,workflowRequestId:id,websiteRequestId:id,history:[]}})
 const final=r=>JSON.parse(r.raw.match(/data: (\{"type":"final".*\})/)[1]).body
 assert.equal(final(await send('Hello')).error.code,'usage_not_enabled')
 const id=crypto.randomUUID();grant.activate({id,commit:'b'.repeat(40),limit:12,windowMs:60000})
 assert.equal((await send('Hello',{origin:'http://example.invalid'})).status,403)
 assert.equal((await send('Hello',{authorization:'Bearer fixture-token-only'},null)).status,403)
 assert.equal(calls.length,0)
 for(const message of ['Hello there.','Hello again.']){
  const body=final(await send(message));assert.equal(body.reply,'Mock cobalt reply',JSON.stringify(body))
 }
 assert.ok(calls.length>=2)
 assert.ok(calls.slice(1).some(c=>c.messages.some(m=>m.content.includes('Mock cobalt reply'))))
 grant.pause(id)
 assert.equal(final(await send('Hello once more')).error.code,'usage_run_not_active')
 assert.equal(grant.status().helper.dispatched,calls.length)
})

test('manual supplied identifier uses the same saved conversation and verifies both replies within four native calls', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-identifier-chat-'))
  const profile = require('../../src/localBrain/deploymentProfile.json')
  const env = { AROMA_DATA_DIR: dir, AROMA_ARTIFACT_DIR: dir, CHAT_BACKEND: 'local', LOCAL_BRAIN_ONLY: '1',
    LOCAL_MODEL: profile.model, LOCAL_MODEL_DIGEST: profile.digest, LOCAL_MODEL_CONTEXT: String(profile.context),
    LOCAL_APP_PORT: '18099', CONVERSATION_DEMO: 'on', TURN_ROUTER: 'on', A4_KNOWLEDGE_ROUTING: 'on',
    GOAL_DECOMPOSER: 'on', READ_ACCESS: 'on', XIANGXIANG_MEMORY: 'off' }
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  const originalFetch = global.fetch
  t.after(() => {
    global.fetch = originalFetch
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    fs.rmSync(dir, {recursive:true, force:true})
  })
  Object.assign(process.env, env)
  const first = '這次對話的虛構包裹代號是「青梨-47」。請告訴我代號。'
  const second = '上一輪的虛構包裹代號是什麼？'
  const phases = []
  let verifierDecision = {decision:'allow_final',question:null}
  global.fetch = async (url, options) => {
    if (url === profile.endpoint + '/api/tags') return Response.json({models:[{name:profile.model,digest:profile.digest}]})
    assert.equal(url, profile.endpoint + '/api/chat')
    const body = JSON.parse(options.body)
    const props = body.format?.properties || {}
    let value
    if (body.messages[0].content.includes('Classify the requested activity, not isolated nouns.')) {
      phases.push('intent')
      value = {intent:'NONE',confidence:'LOW'}
    } else if (props.question_restated) {
      phases.push('goal_understanding')
      value = {question_restated:'Repeat the supplied identifier.',facts:[],joins:[]}
    } else if (props.decision?.enum?.includes('allow_final')) {
      phases.push('final_verification')
      value = verifierDecision
    } else {
      phases.push('answer')
      const prompt = body.messages.find(m => m.role === 'user').content
      assert.ok(prompt.includes(first), 'original Owner message reaches the answer model')
      if (phases.length === 3) assert.ok(prompt.includes(second))
      value = {intent:'question',mode:'chat',reply:'青梨-47',tasks:[],risks:[],memoryReferences:[]}
    }
    return new Response(JSON.stringify({done:true,message:{content:JSON.stringify(value)}}) + '\n')
  }
  const local = require('../../src/localBrain/production').createComposition({dataDir:dir,memoryEnabled:false})
  const grant = require('../../src/localBrain/dailyDialogue').createDailyDialogue({dir:path.join(dir,'owner-local-dialogue'),runtimeCommit:()=>'b'.repeat(40)})
  local.dailyDialogue = grant.run
  const app = require('../../src/app').createApp({ownerPassword:'fixture-only',serviceToken:'fixture-only',localBrain:local})
  const cookie = app.locals.ownerSessions.issue(), conversationId = crypto.randomUUID(), id = crypto.randomUUID()
  grant.activate({id,commit:'b'.repeat(40),limit:4,windowMs:900000})
  for (const message of [first, second]) {
    const requestId = crypto.randomUUID()
    const response = await request(app,'/api/v1/demo/intake',{cookie,headers:{accept:'text/event-stream'},
      body:{message,conversationId,workflowRequestId:requestId,websiteRequestId:requestId,history:[]}})
    const final = JSON.parse(response.raw.match(/data: (\{"type":"final".*\})/)[1]).body
    assert.equal(final.reply, '青梨-47', JSON.stringify({error:final.error,phases}))
  }
  assert.deepEqual(phases, ['answer','final_verification','answer','final_verification'])
  grant.pause(id)
  const status = grant.status()
  assert.deepEqual([status.state,status.turnsUsed,status.helper.reserved,status.helper.dispatched,status.helper.available],['paused',2,4,4,0])
  assert.ok(status.turns.every(turn => turn.finished && turn.conversationId === conversationId))

  // A separately isolated mock allocation proves the final decision can still
  // withhold the answer; observing a verifier call alone would not prove that.
  const other = crypto.randomUUID(), requestId = crypto.randomUUID()
  grant.activate({id:other,commit:'b'.repeat(40),limit:2,windowMs:900000})
  verifierDecision = {decision:'clarify',question:'Which fictional label do you mean?'}
  const checked = await request(app,'/api/v1/demo/intake',{cookie,headers:{accept:'text/event-stream'},
    body:{message:first,conversationId:crypto.randomUUID(),workflowRequestId:requestId,websiteRequestId:requestId,history:[]}})
  const final = JSON.parse(checked.raw.match(/data: (\{"type":"final".*\})/)[1]).body
  assert.equal(final.reply, verifierDecision.question)
  assert.deepEqual(phases.slice(4), ['answer','final_verification'])
  grant.pause(other)
})

test('manual SSE expiry is a correlated pre-turn refusal at the host deadline', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-admission-'))
  const env = { AROMA_DATA_DIR:dir, AROMA_ARTIFACT_DIR:dir, CHAT_BACKEND:'local',
    LOCAL_BRAIN_ONLY:'1', LOCAL_MODEL:'qwen3.5:9b', LOCAL_APP_PORT:'18099', CONVERSATION_DEMO:'on' }
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    fs.rmSync(dir, {recursive:true, force:true})
  })
  // Host times from the PR212 admission failure. No production assets or model transport.
  let now = Date.parse('2026-11-21T19:20:12.455Z')
  const expiresAt = now + 900000, commit = 'b'.repeat(40)
  const ledgerDir = path.join(dir,'owner-local-dialogue')
  const grant = require('../../src/localBrain/dailyDialogue').createDailyDialogue({dir:ledgerDir,now:()=>now,runtimeCommit:()=>commit})
  let calls = 0
  const provider = {providerName:'local',model:env.LOCAL_MODEL,preflight:async()=>({available:true,provider:'local',model:env.LOCAL_MODEL}),
    complete:async()=>{calls++; throw Error('unexpected model call')}}
  const local = require('../../src/localBrain/production').createComposition({dataDir:dir,memoryEnabled:false,adapter:provider})
  local.dailyDialogue = grant.run
  const app = require('../../src/app').createApp({ownerPassword:'fixture-only',serviceToken:'fixture-only',localBrain:local})
  const cookie = app.locals.ownerSessions.issue(), conversationId = crypto.randomUUID(), id = crypto.randomUUID()
  grant.activate({id,commit,limit:4,windowMs:900000})
  const ledger = () => fs.readFileSync(path.join(ledgerDir,id+'.json'))
  const original = ledger()
  const message = '這次對話的虛構包裹代號是「青梨-47」。請告訴我代號。'
  for (now of [expiresAt, expiresAt+1, Date.parse('2026-11-21T19:38:16.493Z')]) {
    const requestId = crypto.randomUUID()
    const response = await request(app,'/api/v1/demo/intake',{cookie,headers:{accept:'text/event-stream'},
      body:{message,conversationId,workflowRequestId:requestId,websiteRequestId:requestId,history:[]}})
    const final = JSON.parse(response.raw.match(/data: (\{"type":"final".*\})/)[1])
    assert.equal(final.body.error.code,'usage_expired')
    assert.equal(final.status,409)
    const {correlationId} = final.body.error
    assert.match(correlationId,require('../../src/actions/contract').ID)
    assert.equal(final.body.error.retryable,false)
    const receipts = fs.readdirSync(path.join(dir,'local-brain')).map(name => JSON.parse(fs.readFileSync(path.join(dir,'local-brain',name))))
    const matches = receipts.filter(row => row.admissionRefusal?.correlationId === correlationId)
    assert.equal(matches.length,1)
    assert.deepEqual(matches[0].admissionRefusal,{code:'usage_expired',correlationId,requestId,conversationId,grantId:id,evaluatedAt:now,expiresAt})
    assert.equal(matches[0].requestId,requestId)
    assert.ok(!JSON.stringify(matches[0]).includes('青梨'))
    assert.deepEqual(ledger(),original)
    const status = grant.status()
    assert.deepEqual([status.turnsUsed,status.helper.reserved,status.helper.dispatched,calls],[0,0,0,0])
  }
})

test('subscription catalogue stays compatible and local backend without local-only authority stays closed',async()=>{
 const saved={CHAT_BACKEND:process.env.CHAT_BACKEND,LOCAL_BRAIN_ONLY:process.env.LOCAL_BRAIN_ONLY};let reads=0
 try{
  const app=require('express')();app.locals.conversationDemo=true;app.use(require('../../src/routes/demoRouter').createDemoRouter({modelsFn:async()=>{reads++;return{billing:'subscriptions',models:[{model:'claude-sonnet',available:true}]}}}))
  process.env.CHAT_BACKEND='codex-subscription';delete process.env.LOCAL_BRAIN_ONLY
  const subscribed=await request(app,'/api/v1/demo/models');assert.equal(subscribed.status,200);assert.equal(subscribed.json().models[0].model,'claude-sonnet');assert.equal(reads,1)
  for(const mode of ['local','unknown']){process.env.CHAT_BACKEND=mode;assert.equal((await request(app,'/api/v1/demo/models')).status,503);assert.equal(reads,1)}
 }finally{for(const [k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v}
})
test('local status rendering distinguishes native inference from a deliberately disconnected worker',()=>{
 const label=client().executionLabel;assert.equal(typeof label,'function')
 assert.equal(label({state:'unavailable',inference:{provider:'local',state:'ready',model:'qwen3.5:9b',cloudFallback:false}},true,k=>k),'localBrain.chatReadyWorkerUnavailable')
 for(const h of [null,{}, {state:'ready'}, {inference:{provider:'claude',state:'ready',cloudFallback:false}}, {inference:{provider:'local',state:'ready',cloudFallback:true}}])assert.equal(label(h,true,k=>k),'localBrain.unavailable')
 assert.equal(label({state:'ready'},false,k=>k),'actions.bridgeReady');assert.equal(label({state:'unavailable'},false,k=>k),'actions.bridgeOffline')
})
