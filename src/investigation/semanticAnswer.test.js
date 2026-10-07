'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const {withSemanticAnswer,reviewSemanticAnswer}=require('./semanticAnswer')
const report=()=>({readOnly:true,focus:'cost',billingConfirmed:false,sections:[
 {section:'schedules',sourceId:'schedule-receipt',state:'ok',retrievedAt:'2026-10-07T00:00:00Z',coverage:'bounded',records:[{sourceId:'task-a',name:'Daily observer',state:'PAUSED',model:null}]},
 {section:'history',sourceId:'history-receipt',state:'partial',records:[{sourceId:'old-a',title:'Daily observer consumed credits',at:'2026-09-01T00:00:00Z'}]},
 {section:'billing',sourceId:'billing-receipt',state:'unconnected',records:[]}
],gaps:[],contradictions:[]})
const claim=(over={})=>({id:'c1',text:'The Daily observer schedule is paused in the current definition.',kind:'observation',evidenceState:'confirmed',temporalScope:'current',references:[{sourceId:'schedule-receipt',recordId:'task-a',field:'state',value:'PAUSED'}],...over})
const adapter=(decision='supported')=>({complete:async()=>({billing:'claude-subscription',model:'claude-opus-5-5',text:JSON.stringify({reviews:[{id:'c1',decision,reason:'matches_reference'}]})})})
const check=(draft,over={})=>reviewSemanticAnswer({draft,report:report(),adapter:adapter(),billing:'claude-subscription',model:'claude-opus-5-5',...over})
test('semantic schema is closed, required and isolated from ordinary schemas',()=>{
 const s={type:'object',properties:{reply:{type:'string'}},required:['reply'],additionalProperties:false}
 const n=withSemanticAnswer(s);assert.equal(s.properties.investigationAnswer,undefined)
 assert.ok(n.required.includes('investigationAnswer'));assert.equal(n.properties.investigationAnswer.additionalProperties,false)
})
test('source-bound English paraphrase survives one semantic review with exact same subscription',async()=>{
 const r=await check({claims:[claim()]});assert.equal(r.state,'reviewed');assert.equal(r.accepted[0].text,claim().text)
 assert.equal(r.calls,1);assert.equal(r.machineEntailmentProven,false);assert.equal(r.accepted[0].references[0].recordId,'task-a')
})
test('a reviewer cannot rescue invented values or another record identity',async()=>{
 for(const ref of [{sourceId:'schedule-receipt',recordId:'task-b',field:'state',value:'PAUSED'},{sourceId:'schedule-receipt',recordId:'task-a',field:'state',value:'ACTIVE'}]){
  const r=await check({claims:[claim({references:[ref]})]});assert.equal(r.accepted.length,0);assert.equal(r.calls,0);assert.equal(r.withheld.length,1)
 }
})
test('historical narrative cannot be promoted to confirmed or current evidence',async()=>{
 const references=[{sourceId:'history-receipt',recordId:'old-a',field:'title',value:'Daily observer consumed credits'}]
 for(const props of [{evidenceState:'confirmed',temporalScope:'historical'},{evidenceState:'supported',temporalScope:'current'}]){
  const r=await check({claims:[claim({references,...props})]});assert.equal(r.accepted.length,0);assert.equal(r.calls,0)
 }
})
test('null remains an explicit unknown and cannot support an observation',async()=>{
 const r=await check({claims:[claim({references:[{sourceId:'schedule-receipt',recordId:'task-a',field:'model',value:null}]})]})
 assert.equal(r.accepted.length,0);assert.equal(r.calls,0)
 const good=await check({claims:[claim({kind:'limitation',evidenceState:'not_established',temporalScope:'unknown',text:'The schedule model is not recorded.',references:[{sourceId:'schedule-receipt',recordId:'task-a',field:'model',value:null}]})]})
 assert.equal(good.accepted.length,1)
})
test('duplicate record or receipt identity is ambiguous even with equal values',async()=>{
 const p=report();p.sections[0].records.push({...p.sections[0].records[0]})
 const r=await check({claims:[claim()]},{report:p});assert.equal(r.accepted.length,0);assert.equal(r.calls,0)
 p.sections[0].records.pop();p.sections.push({...p.sections[0]})
 assert.equal((await check({claims:[claim()]},{report:p})).calls,0)
})
test('unsupported numbers in prose cannot pass via an unrelated source value',async()=>{
 const r=await check({claims:[claim({text:'The observer ran 99 times.'})]});assert.equal(r.accepted.length,0);assert.equal(r.calls,0)
})
test('model version display and leading zeros are normalized only from the bound value',async()=>{
 const p=report();p.sections[0].records[0].model='claude-opus-5-5'
 const r=await check({claims:[claim({text:'The schedule names Claude Opus 5.5.',references:[{sourceId:'schedule-receipt',recordId:'task-a',field:'model',value:'claude-opus-5-5'}]})]},{report:p})
 assert.equal(r.accepted.length,1)
})
test('section coverage limitations can cite an unconnected billing receipt without inventing executions',async()=>{
 const r=await check({claims:[claim({kind:'limitation',evidenceState:'not_established',temporalScope:'unknown',text:'Billing attribution is not established because this source is not connected.',references:[{sourceId:'billing-receipt',recordId:null,field:'state',value:'unconnected'}]})]})
 assert.equal(r.accepted.length,1)
})
test('unsupported, contradicted, uncertain, missing and duplicated semantic reviews withhold the statement',async()=>{
 for(const decision of ['unsupported','contradicted','uncertain']){
  const r=await check({claims:[claim()]},{adapter:adapter(decision)});assert.equal(r.accepted.length,0);assert.equal(r.withheld[0].reason,decision)
 }
 for(const reviews of [[],[{id:'c1',decision:'supported',reason:'matches_reference'},{id:'c1',decision:'supported',reason:'matches_reference'}]]){
  const r=await check({claims:[claim()]},{adapter:{complete:async()=>({billing:'claude-subscription',model:'claude-opus-5-5',text:JSON.stringify({reviews})})}})
  assert.equal(r.accepted.length,0)
 }
})
test('review failure and a different provider/model fail closed without retry or fallback',async()=>{
 for(const a of [{complete:async()=>{throw Error('private provider error')}},{complete:async()=>({billing:'paid-api',model:'claude-opus-5-5',text:'{}'})},{complete:async()=>({billing:'claude-subscription',model:'other-model',text:'{}'})}]){
  const r=await check({claims:[claim()]},{adapter:a});assert.equal(r.accepted.length,0);assert.equal(r.calls,1);assert.ok(!JSON.stringify(r).includes('private provider error'))
 }
})
test('non-read-only report and absent draft do not invoke any model',async()=>{
 for(const over of [{report:{...report(),readOnly:false}},{draft:null}]){
  const r=await check({claims:[claim()]},over);assert.equal(r.calls,0);assert.equal(r.accepted.length,0)
 }
})
test('the reviewer sees only referenced fresh receipts, with no previous transcript or unrelated source',async()=>{
 let prompt;const a={complete:async(p)=>{prompt=p;return{billing:'claude-subscription',model:'claude-opus-5-5',text:JSON.stringify({reviews:[{id:'c1',decision:'supported',reason:'matches_reference'}]})}}}
 const p=report();p.previousTranscript='PRIVATE_HISTORY';p.sections.push({sourceId:'private-unrelated',records:[{secret:'PRIVATE_UNRELATED'}]});p.sections[0].records[0].uncitedField='UNCITED_RECORD_FIELD'
 const r=await check({claims:[claim()]},{report:p,adapter:a});assert.equal(r.accepted.length,1);assert.ok(!prompt.includes('PRIVATE_HISTORY'));assert.ok(!prompt.includes('PRIVATE_UNRELATED'))
 assert.ok(!prompt.includes('UNCITED_RECORD_FIELD'),'Uncited fields cannot rescue an incomplete claim reference')
})
