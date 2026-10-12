'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),express=require('express'),{randomUUID}=require('node:crypto')
const {createApp}=require('../app'),{createDemoRouter}=require('../routes/demoRouter')
const pack={state:'ok',source:'aroma_system',sourceId:'/api/v1/ai/order-planning',resource:'aroma.order_planning',operation:'list',count:1,layer:'truth',retrievedAt:'2026-10-01T21:00:00.000Z',
  content:[{sourceId:'5',title:'Rice <script>unsafe()</script>',originalDate:null,content:'suggested_order_qty=3',fields:{suggested_order_qty:3}}],
  coverage:{scope:'/api/v1/ai/order-planning',complete:null,truncated:null,queryScope:{field:null,window:null,declaredBy:'reader'},returnedRows:100,dataAsOf:null,selection:'bounded_snapshot'}}
function post(server,url,body,{token,origin='http://127.0.0.1:8090'}={}){return new Promise((resolve,reject)=>{const r=http.request({hostname:'127.0.0.1',port:server.address().port,path:url,method:'POST',headers:{host:'127.0.0.1:8090',origin,'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode,value:JSON.parse(raw)}))});r.on('error',reject);r.end(JSON.stringify(body))})}
test('Aroma page/API require Owner and fixed same-origin operations before any source read',async t=>{
  let reads=0
  const service={read:async()=>{},capabilities:()=>[],activity:()=>[],aroma:{verify:()=>{},read:async(actor)=>{assert.equal(actor.role,'owner');reads++;return {pack,modelCalls:0}}}}
  const app=createApp({ownerPassword:'fixture',serviceToken:'fixture-service',runPersistence:false,proposalPersistence:false,workerDeps:{artifactStore:null,runner:null},liveContext:service})
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}))
  const url='http://127.0.0.1:'+server.address().port+'/aroma-context'
  assert.equal((await fetch(url)).status,401)
  const page=await fetch(url,{headers:{authorization:'Bearer fixture-service'}});assert.equal(page.status,200);assert.match(await page.text(),/api\/v1\/live-context\/aroma/);assert.equal(reads,0)
  const body={resource:'aroma.order_planning',operation:'list',input:{}}
  assert.equal((await post(server,'/api/v1/live-context/aroma',body)).status,401)
  assert.equal((await post(server,'/api/v1/live-context/aroma',body,{token:'fixture-service',origin:'https://evil.test'})).status,403)
  for(const b of [{...body,operation:'write'},{...body,resource:'aroma.inventory'},{...body,input:{url:'evil'}},{...body,credentials:'other'},{...body,operation:'get',input:{sourceId:['5']}}])assert.equal((await post(server,'/api/v1/live-context/aroma',b,{token:'fixture-service'})).status,400)
  assert.equal(reads,0);const result=await post(server,'/api/v1/live-context/aroma',body,{token:'fixture-service'});assert.equal(result.status,200);assert.equal(result.value.pack.count,1);assert.equal(reads,1)
})
test('Aroma chat returns measured quantities and citations, deduplicates and checks access before cached delivery',async t=>{
  let reads=0,models=0,allowed=true;const saved=[]
  const app=express();app.locals.conversationDemo=true;app.use(express.json());app.use(createDemoRouter({liveContext:{aroma:{verify:()=>{if(!allowed)throw Error('source_access_changed')},read:async()=>{reads++;return {pack,modelCalls:0}}}},conversationStore:{appendTurn:v=>saved.push(v)},getAdapterFn:()=>{models++;throw Error('model_must_not_run')}}))
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}))
  const body={message:'目前有哪些補貨建議？',conversationId:'aroma-context-fixture',workflowRequestId:randomUUID()}
  const result=await post(server,'/api/v1/demo/intake',body);assert.equal(result.status,200);assert.equal(result.value.aromaContext.pack.count,1);assert.match(result.value.reply,/建議訂量.*3/);assert.match(result.value.reply,/\/api\/v1\/ai\/order-planning/);assert.match(result.value.reply,/未知/)
  assert.equal(models,0);assert.equal(reads,1);assert.equal(saved.length,1)
  const duplicate=await post(server,'/api/v1/demo/intake',body);assert.equal(duplicate.value.reply,result.value.reply);assert.equal(reads,1)
  allowed=false;assert.equal((await post(server,'/api/v1/demo/intake',body)).status,503);assert.equal(reads,1)
})
