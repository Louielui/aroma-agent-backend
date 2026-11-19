'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process')
test('memory transport and installed SDK carry the same signed root; callback retries cannot reset the Bridge cap',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'learning-callback-'))
 const prior={AROMA_DATA_DIR:process.env.AROMA_DATA_DIR,AROMA_ARTIFACT_DIR:process.env.AROMA_ARTIFACT_DIR}
 process.env.AROMA_DATA_DIR=path.join(dir,'data');process.env.AROMA_ARTIFACT_DIR=path.join(dir,'artifacts')
 let server
 t.after(async()=>{
  try { if(server)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve())) }
  finally {
   for(const [key,value] of Object.entries(prior))if(value===undefined)delete process.env[key];else process.env[key]=value
   fs.rmSync(dir,{recursive:true,force:true})
  }
 })
 const usage=require('../../src/actions/usageBudget'),store=require('../../src/actions/store').createStore({dir:path.join(dir,'budget')}),evidenceDir=path.join(dir,'evidence')
 assert.equal(require('../../src/store/dataDir').resolveDataDir(),path.join(dir,'data'))
 const b=usage.createUsageBudget({store,evidenceDir,profile:usage.LEARNING_PROFILE,activationReady:()=>true}),actor={id:'owner',role:'owner'},token='a'.repeat(64),turnId=crypto.randomUUID(),conversationId=crypto.randomUUID()
 // Diagnostics contain only closed codes and numeric counts, never the signed
 // header, request/response content, OS messages, paths or SDK credentials.
 const replies=[],codes=new Set([...usage.ERRORS,'subscription_unavailable','subscription_invalid_output','subscription_limit_reached'])
 const code=value=>typeof value==='string'&&codes.has(value)?value:value==null?null:'UNCLASSIFIED'
 const diagnose=()=>{
  let ledger
  try {const row=store.get(usage.LEARNING_PROFILE.id);ledger={attempts:row?.attempts?.length??0,dispatched:row?.attempts?.filter(a=>a.dispatchedAt).length??0,states:Object.fromEntries(['reserved','dispatched','succeeded','failed'].map(state=>[state,row?.attempts?.filter(a=>a.state===state).length??0])),failures:row?.attempts?.filter(a=>a.failureCode).map(a=>code(a.failureCode))??[]}}
  catch {ledger={state:'UNREADABLE'}}
  let locks
  try {locks=fs.readdirSync(evidenceDir).filter(n=>/^lock-failure-[a-f0-9-]+\.json$/.test(n)).slice(0,32).map(n=>{
   const r=JSON.parse(fs.readFileSync(path.join(evidenceDir,n),'utf8'))
   return {code:code(r.code),phase:['acquire','release','evidence_register'].includes(r.phase)?r.phase:'UNKNOWN',lockCode:['EEXIST','EACCES','EPERM','ENOSPC','EIO','EMFILE','ENFILE','EROFS','UNKNOWN'].includes(r.lockCode)?r.lockCode:'UNKNOWN',attempts:Number.isSafeInteger(r.attempts)?r.attempts:null,elapsedMs:Number.isFinite(r.elapsedMs)?r.elapsedMs:null}
  })}catch {locks={state:'UNREADABLE'}}
  t.diagnostic('MEMORY_USAGE_SCOPE '+JSON.stringify({replies,ledger,locks,privateResources:true}))
 }
 try {
  b.handle(actor,{op:'usage_activate'});b.handle(actor,{op:'usage_bind_turn',turnId,conversationId});const scope=b.enterTurn(turnId,conversationId,crypto.randomUUID()),header=b.encode(scope,token)
  await b.withScope(scope,async()=>{
   const adapter=require('../../src/memory/hindsight').createHindsight({env:{XIANGXIANG_MEMORY:'on',HINDSIGHT_URL:'http://127.0.0.1:8888',HINDSIGHT_BANK:'xiangxiang-owner',HINDSIGHT_TOKEN:'fixture',CODEX_CHAT_BRIDGE_TOKEN:token},transport:async(url,init)=>{assert.equal(init.headers['x-xiangxiang-usage'],header);return Response.json({structured_output:{candidates:[]}})}})
   await adapter.consolidate({id:'xx-12345678-1234-4123-8123-123456789abc',text:'Use concise answers.'},[])
  })
  const python=JSON.parse(execFileSync('C:/Aroma/hindsight-runtime/Scripts/python.exe',['-B',path.join(__dirname,'usageScope.fixture.py')],{input:JSON.stringify({token,header}),encoding:'utf8',windowsHide:true}));assert.deepEqual(python,{state:'passed',authenticatedForwarding:true,asyncIsolation:true,cloudLeak:false})
  let sent=0
  server=require('../../src/subscription/bridge').createBridge({token,clientOptions:{},usageBudget:b,memoryEnabled:true,backgroundModel:'claude-sonnet',claudeFn:async(_,input)=>{assert.equal(input.model,'claude-sonnet');assert.equal(input.effort,'low');usage.nativePermit('helper',input).permit.dispatched('cli_process_started');sent++;return{text:'offline',model:'claude-sonnet',billing:'claude-subscription',stopReason:'end_turn'}}})
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  const callback=async signed=>{
   try {
    const r=await fetch('http://127.0.0.1:'+server.address().port+'/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',...(signed?{'x-xiangxiang-usage':signed}:{})},body:JSON.stringify({model:'gpt-6-astra',messages:[{role:'user',content:'offline'}]})})
    const body=await r.json();replies.push({index:replies.length,status:r.status,code:code(body.code)});return{status:r.status,body}
   }catch(e){replies.push({index:replies.length,status:null,code:'TRANSPORT_OR_JSON_FAILURE'});throw e}
  }
  assert.equal((await callback()).body.code,'usage_scope_required');assert.equal(sent,0)
  const results=[];for(let i=0;i<21;i++)results.push(await callback(header));assert.equal(results.filter(r=>r.status===200).length,18);assert.equal(results.filter(r=>r.body.code==='usage_limit_reached').length,3);assert.equal(sent,18);assert.equal(b.status().helper.dispatched,18)
  b.finishTurn(scope);assert.equal((await callback(header)).status,409);assert.equal(sent,18)
 }catch(e){diagnose();throw e}
})
