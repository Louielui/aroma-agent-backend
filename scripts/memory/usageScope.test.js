'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process')
test('memory transport and installed SDK carry the same signed root; callback retries cannot reset the Bridge cap',async t=>{
 const usage=require('../../src/actions/usageBudget'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'learning-callback-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 const b=usage.createUsageBudget({store:require('../../src/actions/store').createStore({dir}),evidenceDir:path.join(dir,'evidence'),profile:usage.LEARNING_PROFILE,activationReady:()=>true}),actor={id:'owner',role:'owner'},token='a'.repeat(64),turnId=crypto.randomUUID(),conversationId=crypto.randomUUID()
 b.handle(actor,{op:'usage_activate'});b.handle(actor,{op:'usage_bind_turn',turnId,conversationId});const scope=b.enterTurn(turnId,conversationId,crypto.randomUUID()),header=b.encode(scope,token)
 await b.withScope(scope,async()=>{
  const adapter=require('../../src/memory/hindsight').createHindsight({env:{XIANGXIANG_MEMORY:'on',HINDSIGHT_URL:'http://127.0.0.1:8888',HINDSIGHT_BANK:'xiangxiang-owner',HINDSIGHT_TOKEN:'fixture',CODEX_CHAT_BRIDGE_TOKEN:token},transport:async(url,init)=>{assert.equal(init.headers['x-xiangxiang-usage'],header);return Response.json({structured_output:{candidates:[]}})}})
  await adapter.consolidate({id:'xx-12345678-1234-4123-8123-123456789abc',text:'Use concise answers.'},[])
 })
 const python=JSON.parse(execFileSync('C:/Aroma/hindsight-runtime/Scripts/python.exe',['-B',path.join(__dirname,'usageScope.fixture.py')],{input:JSON.stringify({token,header}),encoding:'utf8',windowsHide:true}));assert.deepEqual(python,{state:'passed',authenticatedForwarding:true,asyncIsolation:true,cloudLeak:false})
 let sent=0
 const server=require('../../src/subscription/bridge').createBridge({token,clientOptions:{},usageBudget:b,memoryEnabled:true,backgroundModel:'claude-sonnet',claudeFn:async(_,input)=>{assert.equal(input.model,'claude-sonnet');assert.equal(input.effort,'low');usage.nativePermit('helper',input).permit.dispatched('cli_process_started');sent++;return{text:'offline',model:'claude-sonnet',billing:'claude-subscription',stopReason:'end_turn'}}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)))
 const callback=async signed=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',...(signed?{'x-xiangxiang-usage':signed}:{})},body:JSON.stringify({model:'gpt-6-astra',messages:[{role:'user',content:'offline'}]})});return{status:r.status,body:await r.json()}}
 assert.equal((await callback()).body.code,'usage_scope_required');assert.equal(sent,0)
 const results=[];for(let i=0;i<21;i++)results.push(await callback(header));assert.equal(results.filter(r=>r.status===200).length,18);assert.equal(results.filter(r=>r.body.code==='usage_limit_reached').length,3);assert.equal(sent,18);assert.equal(b.status().helper.dispatched,18)
 b.finishTurn(scope);assert.equal((await callback(header)).status,409);assert.equal(sent,18)
})
