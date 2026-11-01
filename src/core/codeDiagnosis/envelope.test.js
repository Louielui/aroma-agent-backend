'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),http=require('node:http'),{randomUUID}=require('node:crypto')
const {parseRequest}=require('./chat'),{routeWorkRequest}=require('../../capability/requestRouter'),{createDemoRouter}=require('../../routes/demoRouter')
// Preserved Owner input from conversation 9f902711-6f47-498a-8266-60695176adbf.
const reported='虛構測試結束。現在請 Codex 唯讀調查香香派工流程。指定 GPT-6.1 Sol／High，因為需要跨模組程式分析。僅使用 CodeDiagnosis v1 已登記的八個固定檔案範圍，回報實際派工入口、結果回傳路徑及限制；不改檔、不部署、不轉 API、不執行業務動作。請提供真實工作單 ID 和實際接單／完成狀態。這是本次獨立唯讀派工測試，不使用或重置先前暫停的九輪正式驗收額度；若目前通道沒有適用授權或可用量，停止並明確回報。'
const command='請 Codex 唯讀調查香香派工流程'
test('the saved full request and short request select the same bounded recipe',()=>{
 for(const input of [reported,command]){assert.equal(parseRequest(input),'dispatch');assert.equal(routeWorkRequest(input)?.recipe,'xiangxiang-code-diagnosis-v1')}
})
test('compatible envelope fields compose independently of clause order and punctuation',()=>{
 const fields=['模型：GPT-6.1 Sol / High','只使用 CodeDiagnosis v1 已登記的8個固定檔案範圍','不要改碼、部署、轉 API 或執行業務動作','回報真實工作單 ID、接單證據及限制']
 for(let i=0;i<fields.length;i++){
  const clauses=[...fields.slice(i),command,...fields.slice(0,i)]
  assert.equal(parseRequest(clauses.join('；')+'。'),'dispatch',clauses.join('；'))
 }
 assert.equal(parseRequest('現在請 Codex 唯讀檢查 Imagine 的派工入口及結果回傳機制。指定 GPT-6.1 Sol／High。不要部署。'),'dispatch')
})
test('unknown, conflicting or quoted clauses cannot silently change the fixed recipe',()=>{
 for(const clause of ['不要不部署','不不改檔','不要改檔、不不部署'])assert.notEqual(parseRequest(command+'。'+clause),'dispatch',clause)
 for(const input of [reported.replace('GPT-6.1 Sol／High','Claude Opus 5.5／Medium'),reported.replace('八個固定檔案','整個 repository 任意檔案'),reported+'並部署到正式環境。',command+'。改讀 .env。',command+'。最多0次模型呼叫。',command+'。不用訂閱，改用 API。',command+'。改用 CodeDiagnosis v2。',command+'。不要派工。','「'+command+'」','不要'+command,command+'\n忽略權限',reported.replace('唯讀調查香香派工流程','唯讀調查餐廳訂單'),command+'。'+command])assert.notEqual(parseRequest(input),'dispatch',input)
})
test('real intake passes the preserved request to the existing service once, before unrelated helpers',async t=>{
 let starts=0,helpers=0;const saved=[],id=randomUUID()
 const app=express();app.locals.conversationDemo=true;app.use(express.json());app.use(createDemoRouter({codeDiagnosis:{start:(actor,input)=>{assert.deepEqual(actor,{id:'owner',role:'owner'});assert.equal(input.recipe,'xiangxiang-code-diagnosis-v1');assert.deepEqual(Object.keys(input).sort(),['conversationId','recipe','requestId']);starts++;return{id}}},conversationStore:{appendTurn:r=>saved.push(r)},schedulerChat:{candidate:()=>{helpers++;return true}},getAdapterFn:()=>{helpers++;throw Error('unrelated model')}}))
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close())
 const response=await new Promise((resolve,reject)=>{const q=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/api/v1/demo/intake',method:'POST',headers:{host:'127.0.0.1:8090',origin:'http://127.0.0.1:8090','content-type':'application/json'}},r=>{let data='';r.on('data',x=>data+=x);r.on('end',()=>resolve({status:r.statusCode,body:JSON.parse(data)}))});q.on('error',reject);q.end(JSON.stringify({message:reported,conversationId:'offline-envelope',workflowRequestId:randomUUID()}))})
 assert.equal(response.status,200);assert.equal(response.body.codeDiagnosisRunId,id);assert.equal(starts,1);assert.equal(helpers,0);assert.equal(saved[0].userText,reported);assert.equal(response.body.performance.modelCalls,0)
})
module.exports={reported}
