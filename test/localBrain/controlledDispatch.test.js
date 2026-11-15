'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
const transport=require('../../src/adapters/ControlledDispatchAdapter'),fence=require('../../src/localBrain/productionFence')
test('host-selected control contract describes implementation without claiming a live connection or a work grant',()=>{
 const block=require('../../src/governance/selfCapability').capabilityBlock({localOnly:true,controlledDispatchConfigured:true})
 assert.match(block,/受控 Codex 接頭已實作/);assert.match(block,/連線.*另行核實/);assert.match(block,/範圍.*用量.*批准/);assert.doesNotMatch(block,/Codex／訂閱 Worker 派工未接入/);assert.match(block,/不.*自動回退雲端/)
 const off=require('../../src/governance/selfCapability').capabilityBlock({localOnly:true});assert.match(off,/Codex／訂閱 Worker 派工未接入/)
})
test('explicit host switch opens only the fixed control endpoint; chat, websites and cloud completion remain forbidden',async t=>{
 const keys=['LOCAL_BRAIN_ONLY','XIANGXIANG_CONTROLLED_DISPATCH'],old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));t.after(()=>{for(const k of keys)if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k]})
 process.env.LOCAL_BRAIN_ONLY='1';delete process.env.XIANGXIANG_CONTROLLED_DISPATCH
 assert.equal(fence.allowedUrl('http://127.0.0.1:8091/controlled-dispatch','POST'),false)
 await assert.rejects(transport.projectRequest('task',{op:'list'},process.env),/controlled_dispatch_disabled/)
 process.env.XIANGXIANG_CONTROLLED_DISPATCH='on'
 assert.equal(fence.allowedUrl('http://127.0.0.1:8091/controlled-dispatch','POST'),true)
 for(const p of ['/complete','/v1/chat/completions','/website','/project-work','/workers','/controlled-dispatch?url=external'])assert.equal(fence.allowedUrl('http://127.0.0.1:8091'+p,'POST'),false)
 assert.equal(fence.allowedUrl('https://api.openai.com/v1/responses','POST'),false);assert.equal(fence.allowedChild('codex.exe',['app-server']),false)
 const {CodexSubscriptionAdapter}=require('../../src/adapters/CodexSubscriptionAdapter');await assert.rejects(new CodexSubscriptionAdapter().complete('not a dispatch'),/local_capability_unavailable/)
 const boundary=require('../../src/localBrain/production').routeBoundary;let next=0,status;const res={status:n=>{status=n;return res},json:()=>{}}
 boundary({method:'POST',path:'/api/v1/project-tasks'},res,()=>next++);assert.equal(next,1)
 for(const path of ['/api/v1/code-diagnosis','/api/v1/project-adoption','/api/v1/project-tasks/authorize','/api/v1/worker-flow']){status=null;boundary({method:'POST',path},res,()=>next++);assert.equal(status,503)}assert.equal(next,1)
})
test('live control health is metadata only; wrong version/stale/failed replies cannot advertise a connected worker',async()=>{
 const env={LOCAL_BRAIN_ONLY:'1',XIANGXIANG_CONTROLLED_DISPATCH:'on'},HEAD='a'.repeat(40),at=Date.now();let calls=0
 const request=async b=>{calls++;assert.deepEqual(b,{op:'status'});return{protocol:'controlled-repository-dispatch-v1',bootCommit:HEAD,checkedAt:new Date(at).toISOString(),state:'connected',inferenceStarted:false,requiresScopeApproval:true,requiresUsageApproval:true,requiresCodingApproval:true,cloudFallback:false,workerInference:'explicit_subscription_work_only',automaticDeployment:false}}
 assert.equal((await transport.readStatus({env,bootCommit:HEAD,request,now:()=>at})).state,'connected')
 assert.equal((await transport.readStatus({env,bootCommit:'b'.repeat(40),request,now:()=>at})).state,'unavailable')
 assert.equal((await transport.readStatus({env,bootCommit:HEAD,request,now:()=>at+31000})).state,'unavailable')
 assert.equal((await transport.readStatus({env:{},request})).state,'disabled');assert.equal(calls,3)
})
test('authenticated bridge control path reuses existing repository services; no requests reach provider completion',async t=>{
 const {createBridge}=require('../../src/subscription/bridge'),{createControlledDispatch}=require('../../src/subscription/controlledDispatch'),token='a'.repeat(64),HEAD='b'.repeat(40),seen=[];let calls=0
 const controller=createControlledDispatch({bootCommit:HEAD,enabled:()=>true,projectTasks:{request:async(a,b)=>{seen.push(b);return{run:{id:randomUUID(),workflow:'project_task',kind:'repository_repair',state:'awaiting_scope'}}}}})
 const server=createBridge({token,controlledDispatch:controller,completeFn:async()=>{calls++;throw Error('unexpected inference')}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}))
 const send=(body,extra={})=>fetch('http://127.0.0.1:'+server.address().port+'/controlled-dispatch',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',...extra},body:JSON.stringify(body)})
 assert.equal((await send({op:'status'},{authorization:'bad'})).status,401);assert.equal((await send({op:'status'},{origin:'http://evil'})).status,401)
 assert.equal((await send({op:'status',approved:true})).status,400)
 const r=await send({target:'task',input:{op:'request',requestId:randomUUID(),bootCommit:HEAD,goal:'Only selected sources'}});assert.equal(r.status,200);assert.equal((await r.json()).run.state,'awaiting_scope');assert.equal(seen.length,1);assert.equal(calls,0)
 assert.equal((await send({op:'status'})).status,200);assert.equal(calls,0)
})

test('control mutations share the Bridge single-flight lane, including code repair, while status stays metadata-only',async t=>{
 const {createBridge}=require('../../src/subscription/bridge'),token='d'.repeat(64);let releaseModel,releaseControl,handled=0,repair=false,holdControl=false
 const server=createBridge({token,completeFn:async()=>new Promise(r=>{releaseModel=r}),codeRepair:{isActive:()=>repair},controlledDispatch:{handle:async(a,b)=>{handled++;return holdControl&&b.op!=='status'?new Promise(r=>{releaseControl=r}):{state:'observed'}}}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}))
 const send=(route,b)=>fetch('http://127.0.0.1:'+server.address().port+route,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(b)}),command={target:'task',input:{op:'request',requestId:randomUUID(),bootCommit:'a'.repeat(40),goal:'Inert request'}}
 const first=send('/complete',{prompt:'fixture'});while(!releaseModel)await new Promise(r=>setImmediate(r))
 try{assert.equal((await send('/controlled-dispatch',{op:'status'})).status,200);assert.deepEqual(await (await send('/controlled-dispatch',command)).json(),{error:'worker_busy'});assert.equal(handled,1)}finally{releaseModel({output:'fixture'});await first}
 repair=true;assert.deepEqual(await (await send('/controlled-dispatch',command)).json(),{error:'worker_busy'});assert.equal(handled,1);repair=false
 holdControl=true;const pending=send('/controlled-dispatch',command);while(!releaseControl)await new Promise(r=>setImmediate(r))
 try{assert.equal((await send('/complete',{prompt:'duplicate'})).status,503);assert.deepEqual(await (await send('/controlled-dispatch',command)).json(),{error:'worker_busy'});assert.equal((await send('/controlled-dispatch',{op:'status'})).status,200)}finally{releaseControl({state:'saved'});await pending}
})
