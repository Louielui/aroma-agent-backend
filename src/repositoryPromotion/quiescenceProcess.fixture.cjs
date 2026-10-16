'use strict'
const fs=require('node:fs'),raw={...fs},path=require('node:path'),cp=require('node:child_process'),{randomUUID,createHash}=require('node:crypto')
const delay=globalThis.setTimeout
const [directory,mode,bridgePort]=process.argv.slice(2),password='fixture-password',participants=['backend','bridge','native']
const {createGate}=require('./quiescence'),{launch}=require('./quiescenceHost')
const gate=createGate({directory:path.join(directory,'gate'),participants,ownerPassword:()=>password});gate.initialize({password})
const run=randomUUID(),request={password,run,expectedGeneration:0},data=path.join(directory,'data');raw.mkdirSync(data,{recursive:true})
let application,server,background
const token='a'.repeat(64),host=launch({directory:path.join(directory,'gate'),participants,participant:mode==='native'?'native':mode==='bridge'?'bridge':'backend',ownerPassword:()=>password,serviceToken:()=>token,requiredInspectors:!['native','bridge'].includes(mode)?['browser-read']:undefined,internalOrigins:bridgePort?['http://127.0.0.1:'+bridgePort]:undefined,park:()=>{throw Error('unexpected_park')},entry:async()=>{
 if(mode==='native'){
  const scope={url:'http://127.0.0.1:8090/browser-operator-fixture',tabId:1,windowId:2,width:800,height:600}
  const broker=require('../browserRead/operatorBroker.cjs').createOperatorBroker({
   request:async body=>{
    if(body.op==='observe')return{state:'ready',scope}
    if(body.op==='plan')return{state:'awaiting_input',ticket:randomUUID()}
    if(body.op==='claim')return{scope,frame:{},action:{kind:'click'}}
    if(body.op==='report'){fs.writeFileSync(path.join(data,'report'),'finished');return{state:'completed'}}
    throw Error('unexpected_fixture_op')
   },executor:async body=>{
    if(body.op==='capture')return{}
    return new Promise((resolve,reject)=>{
     const child=cp.spawn(process.execPath,['-e',`setTimeout(()=>require('fs').writeFileSync(process.argv[1],'input-finished'),150)`,path.join(data,'native-input')],{windowsHide:true,stdio:'ignore'})
     process.send({event:'executing'});child.once('error',reject);child.once('close',code=>code===0?resolve({success:true}):reject(Error('fixture_child_failed')))
    })
   }})
  application=()=>broker({op:'operator_next',id:randomUUID(),scope,text:'fixture',targets:[]})
 }else if(mode==='bridge'){
  server=require('../subscription/bridge').createBridge({token,completeFn:async()=>{fs.writeFileSync(path.join(data,'bridge'),'dispatch');return{output:'fixture'}}})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 }else{
  const store=require('../browserRead/store').createStore(path.join(data,'reads'))
  globalThis[Symbol.for('aroma.deploymentQuiescence.runtime')].registerInspector('browser-read',()=>({idle:!store.all().some(r=>['awaiting_consent','processing'].includes(r.state))}))
  const service=require('../browserRead/service').createBrowserRead({store,selection:()=>({model:'claude-opus-5-5',effort:'medium'}),provider:()=>({complete:async()=>{throw Error('no_model_allowed')}})})
  const express=require('express'),app=express();app.use(express.json())
  app.use('/api/v1/browser-read',require('../governance/auth').createRequireServiceToken({resolveToken:()=>token}))
  app.use(require('../browserRead/routes').createRouter({service}))
  app.get('/side-effect',(_req,res)=>{fs.writeFileSync(path.join(data,'get'),'mutated');res.json({ok:true})})
  app.post('/detached',(_req,res)=>{void new Promise(resolve=>setTimeout(resolve,150)).then(()=>fs.writeFileSync(path.join(data,'detached'),'finished'));res.json({queued:true})})
  app.post('/child',(_req,res)=>{cp.spawn(process.execPath,['-e',`setTimeout(()=>require('fs').writeFileSync(process.argv[1],'finished'),150)`,path.join(data,'child')],{stdio:'ignore',windowsHide:true});res.json({queued:true})})
  app.post('/chain',async(_req,res)=>{process.send({event:'executing'});await new Promise(resolve=>setTimeout(resolve,150));const response=await fetch('http://127.0.0.1:'+bridgePort+'/complete',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({prompt:'fixture'})});await response.text();fs.writeFileSync(path.join(data,'chain'),'finished');res.status(response.status).json({finished:true})})
  if(mode==='background')background=setInterval(()=>fs.appendFileSync(path.join(data,'ticks'),'tick\n'),20)
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve))
  application=()=>require('../browserRead/nativeHost.cjs').createBroker({request:body=>service.handle(body)})({op:'prepare',requestId:randomUUID(),question:'What is the heading?',source:{url:'https://example.com/',tabId:1,windowId:2,documentId:'doc',frameId:0,capturedAt:new Date().toISOString(),contentHash:createHash('sha256').update('fixture').digest('hex'),truncated:false}})
 }
}})
host.started.then(()=>process.send({event:'ready',port:server?.address().port})).catch(e=>{process.send({event:'fatal',error:e.message});process.exitCode=1})
process.on('message',async ({id,command})=>{
 try{
  let result
  if(command==='prepare')result=gate.prepare(request)
  else if(command==='active')result={leases:gate.status().leases,active:host.runtime.active()}
  else if(command==='freeze'){
   host.runtime.acknowledge()
   for(const p of participants)gate.acknowledge(p,()=>({idle:true}))
   result=gate.freeze({...request,expectedGeneration:1})
  }else if(command==='native')result=await application()
  else if(command==='write'){fs.writeFileSync(path.join(data,'bypass'),'unexpected');result='written'}
  else if(command==='async-write')result=await fs.promises.writeFile(path.join(data,'async-bypass'),'unexpected')
  else if(command==='truncate-read')result=fs.readFileSync(path.join(data,'get'),{flag:'w'})
  else if(command==='corrupt'){raw.writeFileSync(path.join(directory,'gate','gate.json'),'{broken');result='corrupt'}
  else if(command==='control-write'){fs.writeFileSync(path.join(directory,'gate','gate.json'),'forged');result='written'}
  else if(command==='delete-control-parent'){fs.rmSync(directory,{recursive:true,force:true});result='deleted'}
  else if(command==='close'){
   if(background)clearInterval(background);host.close();if(server){server.closeAllConnections();server.close()};process.send({id,result:'closed'});process.disconnect();return
  }
  process.send({id,result})
 }catch(e){process.send({id,error:e.message})}
})
