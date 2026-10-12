'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),express=require('express'),{randomUUID}=require('node:crypto')
const {createApp}=require('../app'),{createDemoRouter}=require('../routes/demoRouter')
let api={};try{api=require('./calendarContextService')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e}
const pack={state:'ok',source:'calendar',sourceId:'owner_primary',resource:'calendar.owner_events',operation:'list',count:1,layer:'truth',retrievedAt:'2026-10-01T12:00:00Z',content:[{sourceId:'event12',title:'Team review',originalDate:null,content:'Source text',link:'https://www.google.com/calendar/event?eid=fixture',fields:{start:'2026-10-01',end:'2026-10-02',allDay:true,status:'confirmed',timeZone:'America/Winnipeg'}}],coverage:{scope:'2026-10-01T05:00:00Z..2026-10-02T05:00:00Z',complete:true,truncated:false,queryScope:{timeZone:'America/Winnipeg'}}}
function post(server,url,body,{token,origin='http://127.0.0.1:8090'}={}){return new Promise((resolve,reject)=>{const r=http.request({hostname:'127.0.0.1',port:server.address().port,path:url,method:'POST',headers:{host:'127.0.0.1:8090',origin,'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode,value:JSON.parse(raw)}))});r.on('error',reject);r.end(JSON.stringify(body))})}
test('Calendar chat recognizes exact read requests, never compound write requests',()=>{
  assert.deepEqual(api.calendarIntent('香香，今天有什麼行程？'),{operation:'list',input:{window:'today'}})
  assert.deepEqual(api.calendarIntent('本週有哪些會議和截止事項？'),{operation:'list',input:{window:'this_week'}})
  assert.deepEqual(api.calendarIntent('查看活動 event12 詳情'),{operation:'get',input:{eventId:'event12'}})
  for(const m of ['不要查看今天行程','今天有什麼行程？並寄給 Ivy','「今天有什麼行程？」','幫我新增會議'])assert.equal(api.calendarIntent(m),null)
})
test('Calendar page/API reject non-Owner, cross-origin and uncontrolled inputs before reads',async t=>{
  let reads=0;const service={read:async()=>{},capabilities:()=>[],activity:()=>[],calendar:{verify:()=>{},read:async()=>{reads++;return {pack,modelCalls:0}}}}
  const app=createApp({ownerPassword:'fixture',serviceToken:'fixture-service',runPersistence:false,proposalPersistence:false,workerDeps:{artifactStore:null,runner:null},liveContext:service})
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}))
  assert.equal((await fetch('http://127.0.0.1:'+server.address().port+'/calendar-context')).status,401)
  const body={operation:'list',input:{window:'today'}}
  assert.equal((await post(server,'/api/v1/live-context/calendar',body)).status,401)
  assert.equal((await post(server,'/api/v1/live-context/calendar',body,{token:'fixture-service',origin:'https://evil.test'})).status,403)
  for(const b of [{...body,operation:'write'},{...body,input:{calendarId:'other'}},{...body,credentials:'secret'}])assert.equal((await post(server,'/api/v1/live-context/calendar',b,{token:'fixture-service'})).status,400)
  assert.equal(reads,0);assert.equal((await post(server,'/api/v1/live-context/calendar',body,{token:'fixture-service'})).value.pack.count,1)
})
test('Calendar chat cites measured nonempty rows, deduplicates and refuses cached data after access change',async t=>{
  let reads=0,models=0,allowed=true;const saved=[]
  const verify=()=>{if(!allowed)throw Error('source_access_changed')}
  const app=express();app.locals.conversationDemo=true;app.use(express.json());app.use(createDemoRouter({liveContext:{calendar:{verify,captureAccess:()=>verify,read:async()=>{reads++;return {pack,modelCalls:0}}}},conversationStore:{appendTurn:v=>saved.push(v)},getAdapterFn:()=>{models++;throw Error('model_must_not_run')}}))
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}))
  const body={message:'今天有什麼行程？',conversationId:'calendar-fixture',workflowRequestId:randomUUID()}
  const result=await post(server,'/api/v1/demo/intake',body);assert.equal(result.status,200);assert.equal(result.value.calendarContext.pack.count,1);assert.match(result.value.reply,/Team review/);assert.match(result.value.reply,/America\/Winnipeg/);assert.match(result.value.reply,/event12/);assert.equal(models,0);assert.equal(reads,1);assert.equal(saved.length,1)
  assert.equal((await post(server,'/api/v1/demo/intake',body)).value.reply,result.value.reply);assert.equal(reads,1)
  allowed=false;assert.equal((await post(server,'/api/v1/demo/intake',body)).status,503);assert.equal(reads,1)
})
