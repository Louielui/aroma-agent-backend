'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto')
const {createOperator,FIXTURE}=require('./service')
const scope={tabId:5,windowId:7,url:FIXTURE,width:1000,height:700},target={id:'fixture_button',label:'Fixture button',href:FIXTURE,x:0.3,y:0.2}
const frame={image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a+9sAAAAASUVORK5CYII=',fingerprint:'a'.repeat(64),window:'123',rect:{left:0,top:100,width:1000,height:700},capturedAt:1000}
const action={kind:'click',target:'fixture_button',x:0.3,y:0.2,text:'',answer:''}
async function plan(output,inspect=()=>{}){
 const events=[],service=createOperator({companyId:153450,env:{},selection:()=>({model:'claude-opus-5-5',effort:'medium'}),provider:()=>({complete:async(prompt,options)=>{inspect(options);return{text:typeof output==='string'?output:JSON.stringify(output),model:'claude-opus-5-5',actualModel:'claude-opus-5-5'}}}),audit:e=>events.push(e),now:()=>1000})
 const j=await service.handle({op:'start',requestId:randomUUID(),question:'Click the owned fixture button',consent:true,scope})
 return {events,service,id:j.id,pending:service.handle({op:'plan',id:j.id,scope,frame,text:'PRIVATE_PAGE_TEXT',targets:[target]})}
}
test('operator vision contract uses normalized coordinates and empty non-result fields before a sealed fixture click',async()=>{
 const f=await plan(action,options=>{
  require('../adapters/adapterErrors').assertResponseFormat(options.responseFormat)
  for(const key of ['x','y'])assert.deepEqual({minimum:options.responseFormat.schema.properties[key].minimum,maximum:options.responseFormat.schema.properties[key].maximum},{minimum:0,maximum:1})
  assert.match(options.system,/normalized.*0.*1/i)
  assert.match(options.responseFormat.schema.properties.answer.description,/empty/i)
  assert.match(options.responseFormat.schema.properties.text.description,/Imagine test/)
 });const planned=await f.pending;assert.equal(planned.state,'awaiting_input');const sealed=await f.service.handle({op:'claim',id:f.id,ticket:planned.ticket});assert.equal(sealed.action.x,target.x);assert.equal(sealed.action.y,target.y)
})
test('operator invalid action diagnostics record only closed reasons without model text page text or input tickets',async()=>{
 const cases=[['not json','json_parse'],[{...action,extra:'PRIVATE_MODEL_TEXT'},'action_shape'],[{...action,x:250},'coordinate_range'],[{...action,answer:'PRIVATE_MODEL_TEXT'},'unexpected_answer'],[{...action,kind:'move',text:'PRIVATE_MODEL_TEXT'},'unexpected_text'],[{...action,kind:'done',answer:''},'empty_answer']]
 for(const [output,reason]of cases){const f=await plan(output);await assert.rejects(f.pending,/invalid_operator_action/);assert.equal((await f.service.handle({op:'get',id:f.id})).state,'failed');assert.deepEqual(f.events.filter(e=>e.stage==='action_refused').map(e=>e.reason),[reason]);assert.ok(!JSON.stringify(f.events).includes('PRIVATE_'));assert.equal(f.events.some(e=>['input_sealed','input_claimed'].includes(e.stage)),false);await assert.rejects(f.service.handle({op:'claim',id:f.id,ticket:randomUUID()}),/input_ticket_unavailable/)}
})
