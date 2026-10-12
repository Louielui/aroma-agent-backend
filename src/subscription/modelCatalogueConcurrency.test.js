'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{createBridge}=require('./bridge')
async function fixture(t,options){const token='f'.repeat(64),server=createBridge({token,...options});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}));const send=(route,body={},auth=token)=>fetch('http://127.0.0.1:'+server.address().port+route,{method:'POST',headers:{authorization:'Bearer '+auth,'content-type':'application/json'},body:JSON.stringify(body)});send.server=server;return send}
const gpt={model:'gpt-6.1-sol',available:true,efforts:['medium']},claude={model:'claude-sonnet',available:true,efforts:['medium']}
test('closed authenticated model metadata stays readable during every active worker lane',async t=>{
 let active='',calls=0;const isActive=name=>()=>active===name
 const send=await fixture(t,{modelsFn:async()=>{calls++;return{models:[gpt]}},claudeModelsFn:async()=>({models:[claude]}),projectTasks:{isActive:isActive('tasks')},projectWork:{isActive:isActive('work')},projectAdoption:{isActive:isActive('adoption')},workerFlow:{isActive:isActive('worker')},codeRepair:{isActive:isActive('repair')}})
 for(const lane of ['tasks','work','adoption','worker','repair']){active=lane;const r=await send('/models');assert.equal(r.status,200,lane);assert.deepEqual((await r.json()).models,[claude,gpt]);assert.equal((await send('/complete',{prompt:'blocked'})).status,503)}
 assert.equal(calls,5);assert.equal((await send('/models',{},'bad')).status,401);assert.equal((await send('/models',{model:'arbitrary'})).status,400);assert.equal(calls,5)
})
test('concurrent catalogue reads coalesce on a separate session and never release the execution lock',async t=>{
 let releaseChat,releaseModels,enterModels,chatSession,catalogueSession,reads=0,claudeReads=0
 const modelsEntered=new Promise(r=>{enterModels=r})
 const send=await fixture(t,{completeFn:async options=>{chatSession=options.session;return new Promise(r=>{releaseChat=r})},modelsFn:async options=>{reads++;catalogueSession=options.session;enterModels();return new Promise(r=>{releaseModels=r})},claudeModelsFn:async()=>{claudeReads++;return{models:[claude]}}});t.after(()=>{releaseChat?.({text:'cleanup'});releaseModels?.({models:[gpt]})})
 let bodies=0;const bothBodies=new Promise(resolve=>send.server.on('request',req=>{if(req.url==='/models')req.once('end',()=>{if(++bodies===2)resolve()})}))
 const chat=send('/complete',{prompt:'authorized'});chat.catch(()=>{});while(!releaseChat)await new Promise(r=>setImmediate(r))
 const first=send('/models'),second=send('/models');second.catch(()=>{});await Promise.race([modelsEntered,first.then(r=>assert.equal(r.status,200))])
 await bothBodies;assert.equal(reads,1);assert.equal(claudeReads,1);assert.notEqual(chatSession,catalogueSession)
 releaseModels({models:[gpt]});for(const p of [first,second]){const r=await p;assert.equal(r.status,200);assert.deepEqual((await r.json()).models,[claude,gpt])}
 assert.equal((await send('/status')).status,503);assert.equal((await send('/complete',{prompt:'overlap'})).status,503)
 releaseChat({text:'done'});assert.equal((await chat).status,200)
})
