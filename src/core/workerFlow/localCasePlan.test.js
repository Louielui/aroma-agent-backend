'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),saved=require('../../../test/localBrain/fixtures/draft-case-plan-v1.json'),draft=require('./localTestDraft')
const input=JSON.parse(saved.inputRaw),output=JSON.parse(saved.outputRaw),packet=JSON.parse(input.messages.find(m=>m.role==='user').content),hash=b=>createHash('sha256').update(b).digest('hex')
const {synthetic}=require('../../../test/localBrain/fixtures/casePlan.fixture.cjs')
test('saved native failure stays immutable; eligible new drafting has a structural case protocol',()=>{
 assert.equal(hash(saved.inputRaw),saved.inputSha256);assert.equal(hash(saved.outputRaw),saved.outputSha256)
 assert.throws(()=>draft.parse(output.text,{packet}),e=>e.localDraftValidation.reason==='assertion_form'&&e.localDraftValidation.missingForms===3)
 const p=draft.prepare(JSON.stringify({...packet,draftContract:undefined})),spec=p.packet.draftContract.casePlan
 assert.equal(spec.version,'local_case_plan_v1');assert.equal(spec.tests.length,3);assert.deepEqual(spec.tests.map(t=>t.subject.symbol),['orderBoxes','formatDuration','formatClockDuration'])
 assert.deepEqual(spec.tests.map(t=>t.subject.arity),[3,1,1]);assert.ok(spec.tests[2].rejections.some(r=>r.expression==='Number.MAX_SAFE_INTEGER+1'))
 assert.deepEqual(p.packet.criteria,packet.criteria);assert.deepEqual(p.packet.files,packet.files)
 assert.throws(()=>draft.parse(output.text,p),e=>e.localDraftValidation.reason==='case_plan_shape')
})
test('synthetic case data render only direct selected calls, all required probes and provenance, without execution',()=>{
 const p=draft.prepare(JSON.stringify(packet)),spec=p.packet.draftContract.casePlan,v=synthetic(spec),raw=JSON.stringify(v),result=draft.project(raw,p),code=result.generated.testCode
 assert.equal(result.generated.expectedTests,3);assert.equal((code.match(/\btest\(/g)||[]).length,3);assert.ok(!code.includes('const {'));assert.ok(!code.includes('example.js'));assert.ok(code.includes('.formatClockDuration(Number.MAX_SAFE_INTEGER+1),RangeError'))
 const evidence=require('./localTestEvidence').catalogue({'acceptance/registered-task.test.cjs':code},packet.files,packet.criteria);assert.equal(new Set(evidence.inlineAssertions.map(a=>a.symbol)).size,3)
 assert.equal(result.origin.protocol,'local_case_plan_v1');assert.equal(result.origin.rawOutputSha256,hash(raw));assert.equal(result.origin.renderedTestSha256,hash(code));assert.equal(result.origin.testsExecuted,false);assert.equal(result.origin.modelAuthoredJavaScript,false)
})
test('missing or disguised required boundary refuses, with no case insertion or raw-output repair',()=>{
 const p=draft.prepare(JSON.stringify(packet)),spec=p.packet.draftContract.casePlan,v=synthetic(spec),probe=spec.tests[2].rejections.find(r=>r.expression==='Number.MAX_SAFE_INTEGER+1'),missing=structuredClone(v);delete missing.tests.c3.rejections[probe.id]
 for(const changed of [missing,(()=>{const r=structuredClone(v);r.tests.c3.rejections[probe.id]=["'Number.MAX_SAFE_INTEGER+1'",'RangeError'];return r})(),(()=>{const r=structuredClone(v);r.tests.c3.rejections[probe.id]=['Number.MAX_SAFE_INTEGER+1','Error'];return r})()])assert.throws(()=>draft.project(JSON.stringify(changed),p),e=>e.localDraftValidation.reason==='case_plan_boundary')
 assert.deepEqual(draft.project(JSON.stringify(v),p).generated,draft.parse(JSON.stringify(v),p))
})
test('expression subset rejects execution and scope escapes; data strings and exact arithmetic stay data',()=>{
 const {expression}=require('./localCaseExpression')
 for(const s of ['process.exit()','globalThis','require("fs")','(()=>1)()','BigInt.constructor("return process")()','Number.MAX_SAFE_INTEGER.constructor','1;process.exit()','1/*x*/+2','...[]','`x`','this','({}).constructor','new Error()'])assert.throws(()=>expression(s),/invalid_worker_result/,s)
 for(const s of ["'process.exit()'",'Number.MAX_SAFE_INTEGER+1','(BigInt(9007199254740991)/60n)+"m "+(BigInt(9007199254740991)%60n)+"s"','-Infinity','[1,null,undefined]','{}'])assert.ok(expression(s),s)
 assert.throws(()=>expression('('.repeat(40)+'1'+')'.repeat(40)),/invalid_worker_result/)
})
test('unselected/ambiguous criteria remain on the unchanged legacy path; fresh case protocol has no JS fallback',()=>{
 const p=draft.prepare(JSON.stringify({goal:'Preserve sum',criteria:['Preserve sum'],files:{'src/x.js':'module.exports={sum};function sum(a,b){return a+b}'}}));assert.equal(p.packet.draftContract.casePlan,undefined);assert.ok(p.schema.properties.testCode)
 const prepared=draft.prepare(JSON.stringify(packet)),value=synthetic(prepared.packet.draftContract.casePlan);value.tests.c3.groups[0].rows[0][0]='require("node:fs")';assert.throws(()=>draft.parse(JSON.stringify(value),prepared),e=>e.localDraftValidation.reason==='case_plan_expression')
 const aliased=structuredClone(packet);aliased.criteria[0]+=' And require("../src/unselected.js").other(...)';assert.equal(draft.prepare(JSON.stringify(aliased)).packet.draftContract.casePlan,undefined)
})
test('case shapes and bounded grammar refuse extra authority, excessive data and unsupported signatures',()=>{
 const p=draft.prepare(JSON.stringify(packet)),make=()=>synthetic(p.packet.draftContract.casePlan)
 for(const mutate of [v=>v.tests.c1.groups[0].rows.push(['1','2']),v=>v.tests.c2.groups[0].rows[0][0]='1; require("fs")',v=>v.tests.c2.groups[0].rows[0][0]='"unterminated',v=>v.tests.c1.callee='require("fs")',v=>v.tests.c2.groups[0].method='exec',v=>v.tests.c2.groups=Array(17).fill(v.tests.c2.groups[0]),v=>v.tests.c1.groups[0].rows=Array(129).fill(['1','2','3','0'])]){const v=make();mutate(v);assert.throws(()=>draft.project(JSON.stringify(v),p),/invalid_worker_result/)}
 const v=make();v.tests.c1.groups=Array.from({length:5},()=>({method:'equal',rows:Array.from({length:128},()=>['1','2','3','0'])}));assert.throws(()=>draft.project(JSON.stringify(v),p),e=>e.localDraftValidation.reason==='case_plan_limit')
 const {expression}=require('./localCaseExpression');for(const s of ['{__proto__:1}','{"\\u005f_proto__":1}','{constructor:0}','{a:1,a:2}','1// comment','1**2','1,'.repeat(300)])assert.throws(()=>expression(s),/invalid_worker_result/)
 const unsupported=structuredClone(packet);unsupported.files['src/localBrain/examples/stock.js']=unsupported.files['src/localBrain/examples/stock.js'].replace('function orderBoxes(current, par, packSize)','function orderBoxes(...args)');unsupported.goal='Preserve behavior';assert.equal(require('./localCasePlan').prepare({...unsupported,criteria:unsupported.criteria.map(c=>c.replace(/orderBoxes\([^)]*\)/g,'orderBoxes(...)'))}),null)
})
test('required probe normalization preserves a quoted constant name as literal data',()=>{
 const v=structuredClone(packet);v.criteria[2]=v.criteria[2].replace('MAX_SAFE_INTEGER+1, strings',"'MAX_SAFE_INTEGER', strings")
 const p=draft.prepare(JSON.stringify(v)),probe=p.packet.draftContract.casePlan.tests[2].rejections.find(r=>r.ownerLabel==="'MAX_SAFE_INTEGER'");assert.equal(probe.expression,"'MAX_SAFE_INTEGER'")
})
