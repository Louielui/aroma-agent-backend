'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
const {createOperator,FIXTURE}=require('./service'),{createOperatorBroker}=require('./broker.cjs')
const scope={tabId:5,windowId:7,url:FIXTURE,width:1000,height:700},target={id:'fixture_input',label:'Fixture input',href:FIXTURE,x:0.3,y:0.2}
const frame={image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a+9sAAAAASUVORK5CYII=',fingerprint:'a'.repeat(64),window:'123',rect:{left:0,top:100,width:1000,height:700},capturedAt:1000}
test('native refusal preserves a closed diagnostic and consumed ticket without exposing an arbitrary exception',async()=>{
 for(const [message,expected]of [['native_typing_target_unavailable','native_typing_target_unavailable'],['browser_pixels_changed','browser_pixels_changed'],['PRIVATE_EXCEPTION_WITH_TOKEN','native_input_unknown']]){
  const events=[],service=createOperator({companyId:153450,env:{},selection:()=>({model:'claude-opus-5-5',effort:'medium'}),provider:()=>({complete:async()=>({text:JSON.stringify({kind:'type',target:'fixture_input',x:0,y:0,text:'Imagine test',answer:''}),model:'claude-opus-5-5',actualModel:'claude-opus-5-5'})}),audit:e=>events.push(e),now:()=>1000})
  let executions=0;const broker=createOperatorBroker({request:b=>service.handle(b),executor:async b=>{if(b.op==='capture')return frame;executions++;throw Error(message)}})
  const j=await broker({op:'operator_start',requestId:randomUUID(),question:'Type on the owned fixture',consent:true,scope}),failed=await broker({op:'operator_next',id:j.id,scope,text:'PRIVATE_PAGE',targets:[target]})
  assert.equal(failed.state,'failed');assert.equal(failed.error,'native_input_unknown');assert.equal(failed.nativeFailure,expected)
  assert.deepEqual(events.filter(e=>e.stage==='native_input_unknown').map(e=>e.reason),[expected]);assert.ok(!JSON.stringify(events).includes('PRIVATE_'))
  await assert.rejects(broker({op:'operator_next',id:j.id,scope,text:'',targets:[target]}),/operation_unavailable/);await assert.rejects(service.handle({op:'claim',id:j.id,ticket:randomUUID()}),/input_ticket_unavailable/);assert.equal(executions,1)
 }
})
test('native refusal reporting accepts legacy uncertainty but refuses arbitrary causes and causes on success',async()=>{
 const service=createOperator({companyId:153450,env:{},selection:()=>({model:'claude-opus-5-5',effort:'medium'}),provider:()=>({complete:async()=>({text:JSON.stringify({kind:'click',target:'fixture_input',x:0,y:0,text:'',answer:''}),model:'claude-opus-5-5',actualModel:'claude-opus-5-5'})}),audit:()=>{},now:()=>1000})
 const j=await service.handle({op:'start',requestId:randomUUID(),question:'Click the fixture',consent:true,scope}),p=await service.handle({op:'plan',id:j.id,scope,frame,text:'',targets:[target]});await service.handle({op:'claim',id:j.id,ticket:p.ticket})
 for(const body of [{success:false,reason:'PRIVATE_CAUSE'},{success:true,reason:'browser_pixels_changed'}])await assert.rejects(service.handle({op:'report',id:j.id,...body}),/invalid_operator_request/)
 const legacy=await service.handle({op:'report',id:j.id,success:false});assert.equal(legacy.error,'native_input_unknown');assert.equal(legacy.nativeFailure,'native_input_unknown')
})
