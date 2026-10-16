'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process')
const wait=ms=>new Promise(r=>setTimeout(r,ms))
test('orphan descendant and failed termination cannot turn direct-parent close into verified freeze',{timeout:30000},async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'q-descendant-')),host=cp.fork(path.join(__dirname,'quiescenceDescendants.fixture.cjs'),['host',directory],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});let stderr='',next=0;host.stderr.on('data',d=>stderr+=d)
 const messages=[],pending=new Map();host.on('message',m=>{if(m.id)pending.get(m.id)?.(m);else messages.push(m)});host.on('error',e=>stderr+=e.message)
 const send=command=>new Promise(resolve=>{const id=++next;pending.set(id,resolve);host.send({command,id})})
 t.after(async()=>{fs.writeFileSync(path.join(directory,'go'),'go');for(let i=0;i<200&&!fs.existsSync(path.join(directory,'done'));i++)await wait(10);if(host.connected)host.send({command:'close'});if(host.exitCode===null)await new Promise(r=>host.once('exit',r));assert(fs.existsSync(path.join(directory,'done')),'owned fixture descendant must finish before cleanup');assert.equal(path.dirname(fs.realpathSync(directory)).toLowerCase(),fs.realpathSync(os.tmpdir()).toLowerCase());fs.rmSync(directory,{recursive:true,force:true})})
 for(let i=0;i<300&&!messages.length;i++)await wait(10);assert(messages.length,stderr||'fixture did not start');const info=messages[0];assert(Number.isInteger(info.grandchild));
 // The parent is already gone. Terminating it cannot attest its orphan tree idle.
 const frozen=await send('freeze');fs.writeFileSync(path.join(directory,'go'),'go');for(let i=0;i<200&&!fs.existsSync(path.join(directory,'done'));i++)await wait(10)
 assert.equal(frozen.failedTermination,true,'closed child handle cannot terminate its orphan tree')
 assert.equal(fs.readFileSync(path.join(directory,'protected'),'utf8'),'descendant final write')
 assert.notEqual(frozen.phase,'frozen','unknown descendant must keep the durable lease; direct-parent close is insufficient')
 assert(frozen.leases>0);assert.equal(frozen.idle.idle,false)
 host.send({command:'close'});await new Promise(r=>host.once('exit',r))
 const restarted=require('./quiescence').createGate({directory:path.join(directory,'gate'),participants:['backend'],ownerPassword:()=> 'fixture-owner-password'}),state=restarted.status()
 assert(state.leases.length>0,'host exit must not erase the unresolved native lease')
 assert.throws(()=>restarted.freeze({password:'fixture-owner-password',run:state.run,expectedGeneration:state.generation}),/writers_not_drained|participants_not_idle/)
})
test('completed independent service request is not an idle acknowledgment',{timeout:30000},async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'q-service-')),child=cp.fork(path.join(__dirname,'quiescenceDescendants.fixture.cjs'),['service',directory],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});let port,written=false;child.on('message',m=>{if(m.port)port=m.port;if(m.event==='written')written=true})
 t.after(async()=>{fs.writeFileSync(path.join(directory,'go'),'fixture cleanup');for(let i=0;i<200&&!written;i++)await wait(10);if(child.connected)child.send({command:'close'});if(child.exitCode===null)await new Promise(r=>child.once('exit',r));assert.equal(path.dirname(fs.realpathSync(directory)).toLowerCase(),fs.realpathSync(os.tmpdir()).toLowerCase());fs.rmSync(directory,{recursive:true,force:true})})
 for(let i=0;i<200&&!port;i++)await wait(10);assert(port);assert.equal(await(await fetch('http://127.0.0.1:'+port)).text(),'accepted')
 const gate=require('./quiescence').createGate({directory:path.join(directory,'gate'),participants:['backend','external-memory'],ownerPassword:()=> 'fixture-owner-password'});gate.initialize({password:'fixture-owner-password'});const r={password:'fixture-owner-password',run:require('node:crypto').randomUUID(),expectedGeneration:0};gate.prepare(r);gate.acknowledge('backend',()=>({idle:true}))
 assert.throws(()=>gate.freeze({...r,expectedGeneration:1}),/participants_unconfirmed/)
 fs.writeFileSync(path.join(directory,'go'),'go');for(let i=0;i<200&&!written;i++)await wait(10);assert(written);assert.equal(fs.readFileSync(path.join(directory,'protected'),'utf8'),'independent service write');assert.equal(gate.status().phase,'draining')
})
