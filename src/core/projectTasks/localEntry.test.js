'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
const {classify,createChatTasks}=require('./chat'),{validInput}=require('../../subscription/controlledDispatch')
test('explicit local Node intake keeps engine, goal and dedup identity without granting execution',async()=>{
 const goal='local Node repair: fix the selected module, no deployment',id=randomUUID(),requestId=randomUUID(),seen=[]
 assert.deepEqual(classify(goal),{op:'request',goal,execution:'local'})
 for(const q of ['Someone said: '+goal,'"'+goal+'"','Can local Node repair code?','本機修碼可以嗎？','不要本機修正，先解釋'])assert.equal(classify(q),null)
 assert.equal(classify('ask Codex to fix this').execution,undefined)
 const service=createChatTasks({bootCommit:'a'.repeat(40),env:{READ_ACCESS:'on',XIANGXIANG_LOCAL_CODING:'on'},request:async b=>{seen.push(b);return{run:{id,workflow:'project_task',requestId,input:{goal,execution:'local',bootCommit:b.bootCommit}}}}})
 await service.prepare({id:'owner',role:'owner'},{message:goal,requestId});assert.equal(seen[0].execution,'local');assert.equal(seen[0].op,'request')
 await assert.rejects(service.prepare({id:'staff',role:'staff'},{message:goal,requestId}),/permission_denied/)
 const off=createChatTasks({bootCommit:'a'.repeat(40),env:{READ_ACCESS:'on'},request:()=>{throw Error('no transport')}});await assert.rejects(off.prepare({id:'owner',role:'owner'},{message:goal,requestId}),/local_coding_disabled/)
 const input={op:'request',execution:'local',bootCommit:'a'.repeat(40),requestId,goal};assert.equal(validInput({target:'task',input}),true)
 for(const extra of [{execution:'claude'},{model:'local:qwen3.5:9b'},{helper:100},{root:'C:/production'},{endpoint:'http://evil.invalid'}])assert.equal(validInput({target:'task',input:{...input,...extra}}),false)
})
test('versioned local registration switch is inert, closed and preserves explicit off',()=>{
 const apply=require('../../localBrain/dispatchProfile').apply,profile=require('../../localBrain/deploymentProfile.json'),env={};apply(env,profile);assert.equal(env.XIANGXIANG_LOCAL_CODING,'on');assert.equal(env.LOCAL_BRAIN_ONLY,undefined)
 const off={XIANGXIANG_LOCAL_CODING:'off'};apply(off,profile);assert.equal(off.XIANGXIANG_LOCAL_CODING,'off');assert.throws(()=>apply({XIANGXIANG_LOCAL_CODING:'true'},profile),/configuration_invalid/)
})
test('same-origin local HTTP request binds host commit and rejects extra authority before forwarding',async t=>{
 const express=require('express'),http=require('node:http'),app=express(),seen=[];app.use(express.json());app.use(require('./routes').createRouter({bootCommit:'a'.repeat(40),env:{READ_ACCESS:'on',XIANGXIANG_LOCAL_CODING:'on'},request:async b=>{seen.push(b);return{run:null}}}))
 const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));t.after(()=>new Promise(r=>{s.closeAllConnections();s.close(r)}))
 const b={op:'request',execution:'local',requestId:randomUUID(),goal:'Local repair'},send=(body,origin='http://127.0.0.1:8090')=>new Promise((resolve,reject)=>{const q=http.request({hostname:'127.0.0.1',port:s.address().port,path:'/api/v1/project-tasks',method:'POST',headers:{host:'127.0.0.1:8090',origin,'content-type':'application/json'}},r=>{r.resume();r.on('end',()=>resolve(r.statusCode))});q.on('error',reject);q.end(JSON.stringify(body))})
 assert.equal(await send(b,'https://evil.invalid'),403);assert.equal(await send({...b,helper:100}),400);assert.equal(await send({...b,bootCommit:'b'.repeat(40)}),400);assert.deepEqual(seen,[]);assert.equal(await send(b),200);assert.deepEqual(seen,[{...b,bootCommit:'a'.repeat(40)}])
})
