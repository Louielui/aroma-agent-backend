'use strict'
const {test}=require('node:test'),assert=require('node:assert/strict')
const completeDerivedSelections=require('../../src/localBrain/evidenceSchema').completeDerivedSelections || (plan=>plan)
const {validatePlan}=require('../../src/intake/answerPlan')
const fixture=require('./omitted-calculation.fixture.json')
const ref='aroma_system.inventory#LOCAL-TEST-1'
const groups=[{source:'aroma_system',readKey:'aroma_system.inventory',items:[{source:'aroma_system',readKey:'aroma_system.inventory',sourceId:'LOCAL-TEST-1',title:'隔離測試白米',fields:{currentStock:'7.5',parLevel:'20'}}]}]
const evidence=[{source:'aroma_system',trust:'live',derivations:{'缺口':{minus:['parLevel','currentStock']}}}]
test('saved real output retains host-computed shortage when the model selected both operands but omitted the derived field',()=>{
 const plan=JSON.parse(fixture.rawOutput).answerPlan,before=JSON.stringify(plan)
 const fixed=completeDerivedSelections(plan,groups,evidence)
 const v=validatePlan(fixed,{itemsBySource:groups,evidenceSets:evidence})
 assert.ok(v.plan.sections.flatMap(s=>s.items).flatMap(i=>i.facts).some(f=>f.field==='缺口'&&String(f.value)==='12.5'))
 assert.equal(JSON.stringify(plan),before)
})
test('completion cannot combine rows, invent formulas, duplicate selections or trust a supplied computed number',()=>{
 const plan=facts=>({sections:[{heading:'Stock',items:[{sourceId:ref,title:'隔離測試白米',facts}]}]})
 const both=[{field:'currentStock',value:'999'},{field:'parLevel',value:'999'}]
 assert.equal(completeDerivedSelections(plan(both.slice(0,1)),groups,evidence).sections[0].items[0].facts.length,1)
 assert.equal(completeDerivedSelections(plan(both),groups,[]).sections[0].items[0].facts.length,2)
 const ambiguous=[...groups,{...groups[0],items:[{...groups[0].items[0],fields:{currentStock:'90',parLevel:'100'}}]}]
 assert.equal(completeDerivedSelections(plan(both),ambiguous,evidence).sections[0].items[0].facts.length,2)
 const fixed=completeDerivedSelections(plan([...both,{field:'缺口',value:'999'}]),groups,evidence)
 assert.equal(fixed.sections[0].items[0].facts.length,3)
 const v=validatePlan(fixed,{itemsBySource:groups,evidenceSets:evidence})
 assert.ok(v.plan.sections.flatMap(s=>s.items).flatMap(i=>i.facts).some(f=>f.field==='缺口'&&String(f.value)==='12.5'))
})
test('actual presenter fixes the saved local omission while the cloud path and guards retain their behavior',()=>{
 const {buildReadResultReply}=require('../../src/intake/readResultView')
 const input={message:'白米現有多少公斤、PAR多少、還差多少？',reply:'',answerPlan:JSON.parse(fixture.rawOutput).answerPlan,itemsBySource:groups,evidenceSets:evidence,perSource:[{source:'aroma_system',trust:'live',count:1}]}
 const old=process.env.LOCAL_BRAIN_ONLY
 try {
  process.env.LOCAL_BRAIN_ONLY='1'
  assert.match(buildReadResultReply(input).reply,/缺口 12\.5/)
  delete process.env.LOCAL_BRAIN_ONLY
  assert.doesNotMatch(buildReadResultReply(input).reply,/缺口 12\.5/)
 } finally { if(old===undefined)delete process.env.LOCAL_BRAIN_ONLY;else process.env.LOCAL_BRAIN_ONLY=old }
})
test('missing/nonnumeric operands and conflicting declarations never authorize a computed zero',()=>{
 const plan=JSON.parse(fixture.rawOutput).answerPlan
 const broken=[{...groups[0],items:[{...groups[0].items[0],fields:{currentStock:'unknown',parLevel:'20'}}]}]
 const v=validatePlan(completeDerivedSelections(plan,broken,evidence),{itemsBySource:broken,evidenceSets:evidence})
 assert.ok(!v.plan.sections.flatMap(s=>s.items).flatMap(i=>i.facts).some(f=>f.field==='缺口'))
 const conflict=[...evidence,{source:'aroma_system',derivations:{'缺口':{minus:['currentStock','parLevel']}}}]
 assert.equal(completeDerivedSelections(plan,groups,conflict).sections[0].items[0].facts.length,2)
})
