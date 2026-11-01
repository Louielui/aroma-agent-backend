'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream')
const {connect,complete,safeDiagnostics}=require('./codexClient')
function fixture(){const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};return child}
test('transport exits, timeouts and stdout overflow retain safe branch diagnostics',async()=>{
 for(const [reason,trigger]of [['stdout_limit',c=>c.stdout.write('x'.repeat(4*1024*1024+1))],['process_exit',c=>c.emit('exit',7,null)],['rpc_invalid_json',c=>c.stdout.write('invalid\n')],['transport_timeout',()=>{}]]){
  const child=fixture(),rpc=connect({executable:'offline-fixture',cwd:'.',timeoutMs:reason==='transport_timeout'?5:1000,spawnImpl:()=>child}),pending=rpc.request('initialize')
  const checked=assert.rejects(pending,e=>{assert.equal(e.code,'subscription_unavailable');assert.equal(e.safeDiagnostics.reason,reason);if(reason==='process_exit')assert.equal(e.safeDiagnostics.exitCode,7);return true});trigger(child);await checked
 }
})
test('diagnostics never copy raw stderr, provider bodies, credentials or arbitrary fields',()=>{
 const safe=safeDiagnostics({reason:'stdout_limit',stdoutBytes:123,stderrBytes:17,exitCode:7,raw:'Bearer secret',message:'private',providerBody:'token',subtype:'injected'})
 assert.equal(safe.reason,'stdout_limit');assert.equal(safe.exitCode,7);assert.equal(JSON.stringify(safe).includes('secret'),false);assert.equal(safe.raw,undefined)
})

test('explicit input limits remain validation errors rather than inferred quota exhaustion',async()=>{
 for(const [providerError,code,category]of [[{code:'context_length_exceeded',message:'Input limit reached: private'},'subscription_unavailable','validation'],[{code:'rate_limit',message:'private'},'subscription_limit_reached','quota'],[{code:'unauthorized',message:'token expired: private'},'subscription_login_required','authentication']]){
  const child=fixture(),rpc=connect({executable:'offline-fixture',cwd:'.',timeoutMs:1000,spawnImpl:()=>child}),pending=rpc.request('initialize')
  const checked=assert.rejects(pending,e=>{assert.equal(e.code,code);assert.equal(e.safeDiagnostics.providerCategory,category);assert.doesNotMatch(JSON.stringify(e.safeDiagnostics),/private|token/);return true})
  child.stdout.write(JSON.stringify({id:1,error:providerError})+'\n');await checked;rpc.close()
 }
})
test('oversized completed output is distinct from login/quota and does not retry',async()=>{
 const events=new EventEmitter();let turns=0
 const rpc={events,notify(){},close(){},async request(method){
  if(method==='account/read')return{account:{type:'chatgpt'}}
  if(method==='model/list')return{data:[{model:'gpt-6-astra'}]}
  if(method==='account/rateLimits/read')return{rateLimits:{primary:{usedPercent:1}}}
  if(method==='config/read')return{config:{}}
  if(method==='thread/start')return{model:'gpt-6-astra',modelProvider:'openai',thread:{id:'fixture'}}
  if(method==='mcpServerStatus/list')return{data:[]}
  if(method==='turn/start'){turns++;queueMicrotask(()=>{events.emit('notification',{method:'item/completed',params:{threadId:'fixture',item:{type:'agentMessage',text:'x'.repeat(100001)}}});events.emit('notification',{method:'turn/completed',params:{threadId:'fixture',turn:{status:'completed'}}})});return{}}
  return{}
 }}
 await assert.rejects(complete({connect:()=>rpc},{prompt:'offline'}),e=>e.code==='subscription_invalid_output'&&e.safeDiagnostics.reason==='completion_output_limit');assert.equal(turns,1)
})
