'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),saved=require('../../../test/localBrain/fixtures/case-row-native-v1.json'),draft=require('./localTestDraft'),{synthetic}=require('../../../test/localBrain/fixtures/casePlan.fixture.cjs'),hash=b=>createHash('sha256').update(b).digest('hex'),input=JSON.parse(saved.inputRaw),output=JSON.parse(saved.outputRaw),packet=JSON.parse(input.messages.find(m=>m.role==='user').content)
test('retained native row failure stays rejected without correction; new row instructions preserve task data and schema structure',()=>{
 assert.equal(hash(saved.inputRaw),saved.inputSha256);assert.equal(hash(saved.outputRaw),saved.outputSha256)
 assert.throws(()=>draft.project(output.text,{packet}),e=>e.localDraftValidation.reason==='case_plan_expression')
 const p=draft.prepare(JSON.stringify(packet));assert.deepEqual(p.packet.criteria,packet.criteria);assert.deepEqual(p.packet.files,packet.files);assert.deepEqual(p.packet.draftContract.casePlan,packet.draftContract.casePlan)
 const strip=v=>Array.isArray(v)?v.map(strip):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>k!=='description').map(([k,x])=>[k,strip(x)])):v
 const originalSchema=JSON.parse(input.messages.find(m=>m.role==='system').content.split('HOST OUTPUT CONTRACT (field meanings and shape, not task data):\n')[1])
 assert.deepEqual(strip(p.schema),strip(originalSchema))
 assert.ok(p.system.includes('THROWS ARGUMENT POSITIONS'));assert.ok(p.system.includes('STRING EXPRESSION BOUNDARY'));assert.ok(p.system.includes('Never interleave RangeError between arguments'))
 assert.throws(()=>draft.project(output.text,p),e=>e.localDraftValidation.reason==='case_plan_expression')
})
test('each arity has an explicit argument/error position layout with no new authority or required cases',()=>{
 const p=draft.prepare(JSON.stringify(packet)),spec=p.packet.draftContract.casePlan
 for(const t of spec.tests){const row=p.schema.properties.tests.properties[t.id].properties.groups.items.properties.rows.items;assert.equal(row.minItems,t.subject.arity+1);assert.equal(row.maxItems,t.subject.arity+1);assert.ok(row.description.includes('throws: '+t.subject.arity+' input argument'));assert.ok(row.description.includes('error name only in slot '+t.subject.arity));assert.ok(row.description.includes('never an argument'));assert.equal(row.items.maxLength,600)}
 assert.equal(spec.tests[2].rejections.length,14);assert.ok(spec.tests[2].rejections.some(r=>r.expression==='Number.MAX_SAFE_INTEGER+1'))
})
test('independent synthetic rows render a three-argument rejection matrix and valid string/arithmetic expectations without executing them',()=>{
 const p=draft.prepare(JSON.stringify(packet)),v=synthetic(p.packet.draftContract.casePlan)
 v.tests.c1.groups=[{method:'equal',rows:[['7','11','2','2']]},{method:'throws',rows:[['NaN','11','2','RangeError'],['7','NaN','2','RangeError'],['7','11','NaN','RangeError']]}]
 const exact='(BigInt(Number.MAX_SAFE_INTEGER)/60n)+"m "+(BigInt(Number.MAX_SAFE_INTEGER)%60n)+"s"'
 v.tests.c2.groups=[{method:'equal',rows:[['5',"'0m 5s'"],['Number.MAX_SAFE_INTEGER',exact]]}]
 const raw=JSON.stringify(v),r=draft.project(raw,p),code=r.generated.testCode
 for(const args of ['NaN,11,2','7,NaN,2','7,11,NaN'])assert.ok(code.includes('.orderBoxes('+args+'),RangeError)'))
 assert.ok(code.includes('.formatDuration(5),\'0m 5s\')'));assert.ok(code.includes(exact));assert.equal(r.origin.rawOutputSha256,hash(raw));assert.equal(r.origin.renderedTestSha256,hash(code));assert.equal(r.origin.testsExecuted,false);assert.equal(r.origin.modelAuthoredJavaScript,false)
})
test('saved error-name argument and broken expected-string forms remain expression refusals; complete rows and literals are not repaired',()=>{
 const p=draft.prepare(JSON.stringify(packet)),make=()=>synthetic(p.packet.draftContract.casePlan)
 for(const row of JSON.parse(output.text).tests.c1.groups.find(g=>g.method==='throws').rows){const v=make();v.tests.c1.groups=[{method:'throws',rows:[row]}];assert.throws(()=>draft.project(JSON.stringify(v),p),e=>e.localDraftValidation.reason==='case_plan_expression')}
 const bad=make();bad.tests.c2.groups=[{method:'equal',rows:[JSON.parse(output.text).tests.c2.groups[0].rows.at(-1)]}];assert.throws(()=>draft.project(JSON.stringify(bad),p),e=>e.localDraftValidation.reason==='case_plan_expression')
 const v=make();v.tests.c1.groups=[{method:'throws',rows:[['NaN','RangeError']]}];assert.throws(()=>draft.project(JSON.stringify(v),p),e=>e.localDraftValidation.reason==='case_plan_shape')
 const missing=make();delete missing.tests.c3.rejections.r6;assert.throws(()=>draft.project(JSON.stringify(missing),p),e=>e.localDraftValidation.reason==='case_plan_boundary')
})
