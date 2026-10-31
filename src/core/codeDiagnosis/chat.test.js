'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),{randomUUID}=require('node:crypto')
const {createDemoRouter}=require('../../routes/demoRouter')
const original='請查你目前已登記的 Codex 派工能力及 bridge 健康。若可用，派 GPT-6.1 Sol／High 做唯讀調查：現有一般任務派工入口及結果回傳機制。選此模型是因為需要跨模組程式調查。回報真實工作單 ID 及接單證據；若不可用，說明具體阻塞。不要改碼、部署、轉 API 或執行業務動作。'
test('the reported Owner command reaches existing diagnosis before scheduler or general investigation',async t=>{
 let starts=0,unrelated=0;const saved=[],id=randomUUID(),service={start:(actor,input)=>{assert.equal(actor.role,'owner');assert.equal(input.recipe,'xiangxiang-code-diagnosis-v1');starts++;return {id}}}
 const app=express();app.locals.conversationDemo=true;app.use(express.json());app.use(createDemoRouter({codeDiagnosis:service,schedulerChat:{candidate:()=>{unrelated++;return true}},conversationStore:{appendTurn:r=>saved.push(r)},getAdapterFn:()=>{unrelated++;throw Error('unrelated')}}))
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close())
 const url='http://127.0.0.1:'+server.address().port,body={message:original,conversationId:'codex-readonly',workflowRequestId:randomUUID()}
 const response=await new Promise((resolve,reject)=>{const req=require('node:http').request(url+'/api/v1/demo/intake',{method:'POST',headers:{host:'127.0.0.1:8090','content-type':'application/json',origin:'http://127.0.0.1:8090'}},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(data)}))});req.on('error',reject);req.end(JSON.stringify(body))})
 assert.equal(response.status,200,JSON.stringify(response.body));assert.equal(response.body.codeDiagnosisRunId,id);assert.equal(starts,1);assert.equal(unrelated,0);assert.equal(saved[0].codeDiagnosisRunId,id)
})
test('explicit dispatch intent stays bounded and cannot silently substitute another task',()=>{
 const {parseRequest}=require('./chat')
 assert.equal(parseRequest(original),'dispatch')
 assert.equal(parseRequest('請 Codex 唯讀調查香香派工流程'),'dispatch')
 assert.equal(parseRequest('Codex bridge 健康及派工能力？'),'health')
 for(const message of ['不要派 Codex 調查','「請 Codex 唯讀調查香香派工流程」','請 Codex 唯讀調查 .env','請 Codex 修改香香派工流程並部署','請派 GPT-6-Astra 做唯讀調查香香派工流程','請 Codex 唯讀調查餐廳訂單'])assert.notEqual(parseRequest(message),'dispatch',message)
})
test('health separates transport, authorization, capability and worker readiness; mismatch fails closed',async()=>{
 const {readDispatchStatus}=require('./status'),sha='a'.repeat(40)
 const diagnosis={catalogue:()=>({workers:[{id:'codex-code-diagnosis',capability:'CodeDiagnosis',version:1,model:'gpt-6.1-sol',billing:'chatgpt-subscription',state:'configured'}]}),isActive:()=>false}
 const input={diagnosis,env:{READ_ACCESS:'on',AGENT_BRIDGE:'off'},bootCommit:sha,health:async()=>({state:'ready',bootCommit:sha})}
 const ready=await readDispatchStatus(input)
 assert.equal(ready.transport.state,'ready');assert.equal(ready.dispatch.enabled,true);assert.equal(ready.legacyAgentBridge.enabled,false);assert.equal(ready.capabilities[0].capability,'CodeDiagnosis');assert.equal(ready.worker.state,'not_probed');assert.equal(ready.worker.canAccept,null)
 const mismatch=await readDispatchStatus({...input,health:async()=>({state:'ready',bootCommit:'b'.repeat(40)})})
 assert.equal(mismatch.dispatch.enabled,false);assert.equal(mismatch.dispatch.reason,'version_mismatch')
 const off=await readDispatchStatus({...input,env:{READ_ACCESS:'off'}});assert.equal(off.dispatch.enabled,false)
})

test('result report requires host verification and never upgrades a failed or running work order',()=>{
 const {report}=require('./chatView'),id=randomUUID()
 assert.match(report({id,state:'failed',reason:'subscription_login_required',steps:[]}),/subscription_login_required/)
 assert.doesNotMatch(report({id,state:'running',steps:[{stage:'context_read'}],result:{summary:'unsafe'}}),/unsafe/)
 const complete={id,state:'completed',result:{summary:'Scoped worker summary'},verification:{matched:true,citationsVerified:true}}
 assert.match(report(complete),/Scoped worker summary/)
 assert.doesNotMatch(report({...complete,verification:{matched:false}}),/Scoped worker summary/)
})
