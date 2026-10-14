'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
const {createOperator}=require('./service'),{createOperatorBroker}=require('./broker.cjs')
const scope={tabId:5,windowId:7,url:'https://app.7shifts.com/company/153450/employees',width:1000,height:700}
test('employee live profile admits only the exact Owner company employee landing and list URLs',()=>{
 const {employeeReadProfile}=require('./liveProfile')
 for(const url of [scope.url,scope.url+'/list'])assert.equal(employeeReadProfile(153450,{...scope,url}),true)
 for(const url of [scope.url+'/edit',scope.url+'?view=other',scope.url.replace('153450','153451'),'https://app.7shifts.com/location/193809/schedule/2021-08-17','https://app.7shifts.com.evil.test/company/153450/employees','http://app.7shifts.com/company/153450/employees'])assert.equal(employeeReadProfile(153450,{...scope,url}),false)
 assert.equal(employeeReadProfile(153451,scope),false);assert.equal(employeeReadProfile(undefined,scope),false)
})
test('native live admission rejects a changed source before capture and legacy live get cannot authorize a screenshot',async()=>{
 const {employeeReadProfile}=require('./liveProfile'),events=[];let captures=0
 const service=createOperator({companyId:153450,env:{},liveEnabled:s=>employeeReadProfile(153450,s),selection:()=>({model:'claude-opus-5-5',effort:'medium'}),provider:()=>{throw Error('unexpected_provider')},audit:e=>events.push(e)})
 const broker=createOperatorBroker({request:b=>service.handle(b),executor:async()=>{captures++;throw Error('unexpected_capture')}}),j=await broker({op:'operator_start',requestId:randomUUID(),question:'Open and read employees',consent:true,scope})
 assert.equal((await service.handle({op:'get',id:j.id})).state,'native_admission_required')
 assert.equal((await service.handle({op:'observe',id:j.id,scope})).state,'ready')
 for(const changed of [{...scope,url:'https://app.7shifts.com/location/193809/schedule/2021-08-17'},{...scope,tabId:9}])await assert.rejects(broker({op:'operator_next',id:j.id,scope:changed,text:'',targets:[]}),/operation_(?:scope_changed|native_acceptance_required)/)
 assert.equal(captures,0);assert.equal(events.some(e=>e.stage==='vision_dispatched'),false)
 assert.equal((await service.handle({op:'observe',id:j.id,scope:{...scope,url:scope.url+'/list'}})).state,'ready')
})
test('actual app employee profile is authenticated and refuses other routes without dispatching native or model work',async t=>{
 const before=process.env.SEVEN_SHIFTS_COMPANY_ID;process.env.SEVEN_SHIFTS_COMPANY_ID='153450';t.after(()=>{before===undefined?delete process.env.SEVEN_SHIFTS_COMPANY_ID:process.env.SEVEN_SHIFTS_COMPANY_ID=before})
 const app=require('../app').createApp({ownerPassword:'fixture-owner',serviceToken:'fixture-service',companyAccessEnabled:true,runPersistence:false,proposalPersistence:false,workerDeps:{artifactStore:null,runner:null}}),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>{server.closeAllConnections();server.close()})
 const url='http://127.0.0.1:'+server.address().port+'/api/v1/browser-operator',send=body=>fetch(url,{method:'POST',headers:{authorization:'Bearer fixture-service','content-type':'application/json'},body:JSON.stringify(body)})
 const start={op:'start',requestId:randomUUID(),question:'Read the Owner employee list',consent:true,scope};const result=await (await send(start)).json();assert.equal(result.result?.state||result.state,'ready',JSON.stringify(result));const id=result.result?.id||result.id
 assert.equal((await send({op:'stop',id})).status,200)
 const denied=await send({...start,requestId:randomUUID(),scope:{...scope,url:'https://app.7shifts.com/location/193809/schedule/2021-08-17'}});assert.notEqual(denied.status,200)
 assert.equal((await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(start)})).status,401)
})
