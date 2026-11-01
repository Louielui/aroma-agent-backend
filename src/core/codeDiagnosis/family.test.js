'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),http=require('node:http'),{randomUUID}=require('node:crypto')
const {parseRequest}=require('./chat'),{classify}=require('../projectTasks/chat'),{createDemoRouter}=require('../../routes/demoRouter')
// Actual Owner input from conversation eee635f7-db19-4b38-b42c-bac41bd45aed.
const reported='請派 Codex 使用 GPT-6.1 Sol／High，唯讀調查香香現有派工流程，因為需要跨模組程式分析。僅限已登記的八個檔案，不改碼、不部署、不轉 API。請回報工作單 ID、實際接單狀態和來源核驗結果。'
test('readonly worker/model/goal/scope fields select diagnosis rather than an editing request',()=>{
 for(const message of [reported,'請派 Codex，指定 GPT-6.1 Sol／High；唯讀檢查 Imagine 現有派工流程；僅限已登記的8個檔案；回報來源核驗結果。','請交給 Codex 使用 GPT-6.1 Sol / High。唯讀調查香香派工流程。不部署。']){assert.equal(parseRequest(message),'dispatch',message);assert.equal(classify(message),null,message)}
 assert.ok(classify('請派 Codex 修正派工流程。保留唯讀限制。'))
})
test('unresolved readonly instructions cannot be silently classified as editing work',()=>{
 for(const message of [reported.replace('GPT-6.1 Sol／High','Claude Opus 5.5／Medium'),reported.replace('GPT-6.1 Sol／High','edit-model'),reported.replace('八個檔案','任意檔案'),reported+'最多0次呼叫。',reported+'並修改檔案。','請派 Codex，指定 unknown。唯讀調查香香派工流程。',reported+'x'.repeat(501)]){assert.notEqual(parseRequest(message),'dispatch',message);assert.equal(classify(message),null,message)}
})
test('both live route families are composed: full and short readonly requests never create editing tasks',async t=>{
 let readonly=0,editing=0,model=0;const saved=[]
 const app=express();app.locals.conversationDemo=true;app.use(express.json());app.use(createDemoRouter({codeDiagnosis:{start:(actor,input)=>{assert.equal(input.recipe,'xiangxiang-code-diagnosis-v1');readonly++;return{id:randomUUID()}}},chatTasks:{prepare:()=>{editing++;throw Error('wrong editing family')}},conversationStore:{get:()=>({messages:[]}),appendTurn:v=>saved.push(v)},getAdapterFn:()=>{model++;throw Error('unexpected helper')}}))
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close())
 const send=message=>new Promise((resolve,reject)=>{const q=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/api/v1/demo/intake',method:'POST',headers:{host:'127.0.0.1:8090',origin:'http://127.0.0.1:8090','content-type':'application/json'}},r=>{let s='';r.on('data',c=>s+=c);r.on('end',()=>resolve({status:r.statusCode,body:JSON.parse(s)}))});q.on('error',reject);q.end(JSON.stringify({message,conversationId:'offline-family',workflowRequestId:randomUUID()}))})
 for(const message of [reported,'請 Codex 唯讀調查香香派工流程。']){const r=await send(message);assert.equal(r.status,200);assert.ok(r.body.codeDiagnosisRunId);assert.equal(r.body.projectTaskRunId,undefined);assert.ok(r.body.reply.includes(r.body.codeDiagnosisRunId));assert.match(r.body.reply,/code-diagnosis\?run=/);assert.equal(saved.at(-1).userText,message)}
 for(const message of [reported.replace('GPT-6.1 Sol／High','wrong-model'),reported+'最多0次呼叫。',reported+'x'.repeat(501)]){const r=await send(message);assert.equal(r.status,200);assert.equal(r.body.projectTaskRunId,undefined);assert.equal(r.body.codeDiagnosisRunId,undefined)}
 assert.equal(readonly,2);assert.equal(editing,0);assert.equal(model,0)
})
