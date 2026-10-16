'use strict'
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),{randomUUID}=require('node:crypto')
const [role,directory]=process.argv.slice(2)
if(role==='grandchild'){
 const timer=setInterval(()=>{if(fs.existsSync(path.join(directory,'go'))){clearInterval(timer);fs.writeFileSync(path.join(directory,'protected'),'descendant final write');fs.writeFileSync(path.join(directory,'done'),'done')}},10)
}else if(role==='parent'){
 const child=cp.spawn(process.execPath,[__filename,'grandchild',directory],{windowsHide:true,detached:true,stdio:'ignore'});child.unref();process.send({grandchild:child.pid},()=>process.exit(0))
}else if(role==='service'){
 const server=require('node:http').createServer((req,res)=>{res.end('accepted');const timer=setInterval(()=>{if(fs.existsSync(path.join(directory,'go'))){clearInterval(timer);fs.writeFileSync(path.join(directory,'protected'),'independent service write');process.send({event:'written'})}},10)})
 server.listen(0,'127.0.0.1',()=>process.send({port:server.address().port}));process.on('message',m=>{if(m.command==='close')server.close(()=>process.disconnect())})
}else if(role==='host'){
 const raw={...fs},gate=require('./quiescence').createGate({directory:path.join(directory,'gate'),participants:['backend'],ownerPassword:()=> 'fixture-owner-password'});gate.initialize({password:'fixture-owner-password'})
 const runtime=require('./quiescenceRuntime').createRuntime({gate,participant:'backend'}),restore=require('./quiescenceFence').installFence(runtime,{controlDirectory:path.join(directory,'gate')})
 const child=cp.fork(__filename,['parent',directory],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});let grandchild
 child.on('message',m=>{grandchild=m.grandchild});child.on('close',()=>setImmediate(()=>process.send({event:'parent-closed',parent:child.pid,grandchild})))
 process.on('message',m=>{
  if(m.command==='close'){restore();runtime.close();process.exit(0)}
  if(m.command==='freeze'){
   const r={password:'fixture-owner-password',run:randomUUID(),expectedGeneration:0};let result
   try{gate.prepare(r);gate.acknowledge('backend',runtime.inspectIdle);result={phase:gate.freeze({...r,expectedGeneration:1}).phase}}catch(e){result={error:e.message,leases:gate.status().leases.length,idle:runtime.inspectIdle()}}
   process.send({id:m.id,failedTermination:child.kill()===false,...result})
  }
 })
}
