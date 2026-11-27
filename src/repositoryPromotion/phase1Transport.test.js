'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),http=require('node:http')
const {contentRiskText}=require('./checks'),{classifyChanges}=require('./policy')
const root=path.resolve(__dirname,'../..')
const read=name=>fs.readFileSync(path.join(root,name),'utf8').replace(/\r\n/g,'\n')
const files=[
 ['src/demo/assets/phase1.js',"request('chat',","request('company/write',"],
 ['src/localBrain/next/view.js',"request('/approve',","request('/company/write',"],
 ['src/localBrain/next/adapter.js',"'/api/chat'","'/company/write'"]
]
function addition(name,text){
 const lines=text.replace(/\n$/,'').split('\n')
 return ['diff --git a/'+name+' b/'+name,'new file mode 100644','--- /dev/null','+++ b/'+name,
  '@@ -0,0 +1,'+lines.length+' @@',...lines.map(line=>'+'+line),...(!text.endsWith('\n')?['\\ No newline at end of file']:[]),''].join('\n')
}
function risks(name,text){
 return classifyChanges([name],contentRiskText([addition(name,text)]).addedText)
}
test('only exact reviewed Phase 1 transport additions retain protected-source classification',()=>{
 for(const [name,route,write] of files){
  const text=read(name)
  assert.deepEqual(risks(name,text),['security_permission_change'])
  for(const mutation of [
   text+'\n// Source changed.\n',
   text.replace(route,write),
   text.replace(/redirect:\s*'error'/,"redirect:'follow'"),
   text+"\nfetch('http://127.0.0.1:8090/company/write',{method:'POST'});\n",
   text+"\nfetch('https://business.invalid/write',{method:'POST'});\n"
  ]){
   assert.notEqual(mutation,text)
   assert.ok(risks(name,mutation).includes('business_data_write'))
  }
  assert.ok(risks('src/renamed.js',text).includes('business_data_write'))
 }
})

test('loopback inference refuses a redirect without requesting the new destination',async t=>{
 const observed=[]
 const server=http.createServer((req,res)=>{
  observed.push([req.method,req.url])
  res.writeHead(307,{Location:'/unexpected'});res.end()
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 t.after(()=>new Promise(resolve=>server.close(resolve)))
 const {createAdapter}=require('../localBrain/next/adapter')
 assert.throws(()=>createAdapter({url:'https://inference.invalid',engine:'strata'}),/local_endpoint_not_loopback/)
 for(const [engine,route] of [['strata','/v1/chat/completions'],['ollama','/api/chat']]){
  const url='http://127.0.0.1:'+server.address().port
  const adapter=createAdapter({url,engine,model:'offline-fixture',layers:0})
  await assert.rejects(adapter.generate([{role:'user',content:'Synthetic input'}]),/local_transport_or_protocol_error/)
  assert.deepEqual(observed.pop(),['POST',route])
  assert.deepEqual(observed,[])
 }
})

test('standalone lab browser transport refuses non-loopback origins and unapproved paths before fetch',async()=>{
 const calls=[],location=new URL('http://127.0.0.1:17946/')
 const fetch=async(...args)=>{calls.push(args);return {ok:false}}
 const context=vm.createContext({location,fetch,sessionStorage:{getItem:()=>''},
  document:{getElementById:()=>({})},setInterval:()=>{}})
 vm.runInContext(read('src/localBrain/next/view.js'),context)
 calls.length=0
 for(const route of ['/authorize','/chat','/approve','/release']){
  await context.request(route,{})
  assert.equal(calls.at(-1)[0],route)
  assert.equal(calls.at(-1)[1].redirect,'error')
 }
 calls.length=0
 await assert.rejects(context.request('/company/write',{}),/local_transport_refused/)
 await assert.rejects(context.request('https://business.invalid/write',{}),/local_transport_refused/)
 context.location=new URL('http://business.invalid/')
 await assert.rejects(context.request('/chat',{}),/local_transport_refused/)
 assert.deepEqual(calls,[])
})

test('chat integration stays dormant when the page is outside literal loopback',()=>{
 for(const url of ['http://fixture.invalid/demo','https://127.0.0.1/demo']){
  const window={location:new URL(url),fetch(){assert.fail('No request may leave this page')}}
  vm.runInNewContext(read('src/demo/assets/phase1.js'),{window})
  assert.doesNotThrow(()=>window.XiangxiangPhase1.mount())
 }
})

test('the experimental server route keeps Owner authorization and rejects unknown write routes',async t=>{
 const express=require('express'),app=express(),observed=[]
 app.use(express.json())
 require('../localBrain/next/experimentRoute').register(app,(_req,_res,next)=>next(),req=>req.get('x-test-owner')==='present',{
  preference:{save:body=>{observed.push(['selection',body]);return {selected:'B',revision:1}}},
  call:async(action,body)=>{observed.push([action,body]);return {action}}
 })
 const server=http.createServer(app)
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const oldLocal=process.env.LOCAL_BRAIN_ONLY,oldPort=process.env.LOCAL_APP_PORT
 t.after(async()=>{
  for(const [key,value] of [['LOCAL_BRAIN_ONLY',oldLocal],['LOCAL_APP_PORT',oldPort]]){
   if(value===undefined) delete process.env[key]
   else process.env[key]=value
  }
  await new Promise(resolve=>server.close(resolve))
 })
 process.env.LOCAL_BRAIN_ONLY='1'
 process.env.LOCAL_APP_PORT=String(server.address().port)
 const origin='http://127.0.0.1:'+server.address().port
 const send=(route,headers={},body={})=>fetch(origin+'/api/v1/demo/experimental/'+route,{
  method:'POST',headers:{'content-type':'application/json',origin,...headers},body:JSON.stringify(body)
 })
 const owner={'x-test-owner':'present'}
 assert.equal((await send('selection')).status,401)
 assert.equal((await send('chat',{...owner,origin:'http://fixture.invalid'})).status,403)
 assert.equal((await send('release',{...owner,'content-type':'text/plain'})).status,403)
 assert.equal((await send('business/write',owner)).status,404)
 assert.deepEqual(observed,[])
 assert.equal((await send('selection',owner,{selected:'B',revision:0})).status,200)
 assert.equal((await send('chat',owner,{profile:'B',message:'Synthetic input',history:[]})).status,200)
 assert.equal((await send('release',owner)).status,200)
 assert.deepEqual(observed.map(([action])=>action),['selection','chat','release'])
})
