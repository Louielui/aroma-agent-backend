'use strict'
const test=require('node:test'),assert=require('node:assert/strict')
const saved=require('../../../test/localBrain/fixtures/test-draft-review-v3.json'),review=require('./localTestReview')
const file='acceptance/registered-task.test.cjs'
function valid(){return{...saved.packet,protectedTests:{[file]:"const test=require('node:test'),assert=require('node:assert/strict');\nconst {orderBoxes}=require('../src/localBrain/examples/stock.js');\nconst {formatDuration,formatClockDuration}=require('../src/localBrain/examples/duration.js');\ntest('stock',()=>{assert.equal(orderBoxes(3,10,4),2)});\ntest('old',()=>{assert.equal(formatDuration(60),'1m 0s')});\ntest('clock',()=>{assert.equal(formatClockDuration(60),'00:01:00')});\n"}}}
function response(input){const p=review.prepare(input).packet,lines=p.target.files[0].lines,a=lines.filter(l=>l.kind==='assertion');return{stage:'test_draft',verdict:'pass',summary:'OFFLINE response double; no execution',findings:[],coverage:p.criteria.map((c,i)=>({criterion:c.id,status:'covered',anchors:[a[i].anchorId],reason:'The cited executable assertion exercises the named source export.',checks:c.checks.map(check=>({id:check.id,status:'covered',anchors:[a[i].anchorId],reason:'Offline synthetic check assessment.'}))})),baseline:{expectation:'expected_failure',anchor:a.at(-1).anchorId,reason:'New clock export is absent in the unchanged baseline.'}}}
test('saved real review remains rejected; new replies select immutable host anchors rather than copying whitespace or line numbers',()=>{
 assert.throws(()=>review.parse(saved.outputText,saved.packet),/invalid_worker_result/)
 const p=valid(),before=JSON.stringify(p),prepared=review.prepare(p),r=response(p),out=review.parse(JSON.stringify(r),p)
 assert.equal(out.verdict,'pass');assert.match(prepared.system,/anchor/);assert.ok(!prepared.schema.properties.findings.items.properties.quote)
 assert.equal(out.reviewBasis.findingEvidence.length,0);assert.equal(out.reviewBasis.coverage[0].assertions[0].quote,p.protectedTests[file].split('\n')[3]);assert.equal(JSON.stringify(p),before)
 const changed=valid();changed.protectedTests[file]='// shifted\n'+changed.protectedTests[file];assert.throws(()=>review.parse(JSON.stringify(r),changed),/invalid_worker_result/)
 for(const mutate of [v=>{v.ownerGoal+=' changed'},v=>{v.source['src/localBrain/examples/stock.js']+='\n'},v=>{v.workOrder={...v.workOrder,registeredRevision:'b'.repeat(40)}},v=>{v.acceptanceCriteria=[...v.acceptanceCriteria];v.acceptanceCriteria[0]+=' changed'}]){const v=valid();mutate(v);assert.throws(()=>review.parse(JSON.stringify(r),v),/invalid_worker_result/)}
})
test('coverage cannot cite a title, unrelated function, missing stock assertions, or comments that look like assertions',()=>{
 const p=valid(),r=response(p),lines=review.prepare(p).packet.target.files[0].lines
 for(const change of [v=>v.coverage[0].anchors=[lines[1].anchorId],v=>v.coverage[0].anchors=v.coverage[1].anchors,v=>v.coverage[0].anchors=['invented'],v=>v.coverage[2].checks.pop(),v=>{v.coverage[2].checks[1].id=1},v=>{v.coverage[2].checks[0]={id:1,status:'missing',anchors:[],reason:'No assertion for this case.'}},v=>{v.coverage[2].checks[0].anchors=[lines[0].anchorId]}]){const v=structuredClone(r);change(v);assert.throws(()=>review.parse(JSON.stringify(v),p),/invalid_worker_result/)}
 const missing=valid();missing.protectedTests[file]=missing.protectedTests[file].replace("assert.equal(orderBoxes(3,10,4),2)","/* assert.equal(orderBoxes(3,10,4),2) */")
 const v=response(p);assert.throws(()=>review.parse(JSON.stringify(v),missing),/invalid_worker_result/)
})
test('grounded negative findings retain canonical line and exact quote; no typo repair or verdict conversion',()=>{
 const p=valid(),r=response(p);r.verdict='changes_requested';r.findings=[{anchor:r.baseline.anchor,message:'The expected value needs a criterion check.'}];r.coverage[2]={criterion:3,status:'uncertain',anchors:[],reason:'Expected value is not established.',checks:r.coverage[2].checks.map(c=>({...c,status:'uncertain',anchors:[]}))}
 const out=review.parse(JSON.stringify(r),p);assert.equal(out.verdict,'changes_requested');assert.equal(out.findings.length,1);assert.equal(out.reviewBasis.findingEvidence[0].line,6)
 const forged=structuredClone(r);forged.findings[0].anchor+='x';assert.throws(()=>review.parse(JSON.stringify(forged),p),/invalid_worker_result/)
})
test('local draft contract rejects saved five-test mixed draft and supplies a criterion-scoped literal-value checklist without executing code',()=>{
 const draft=require('./localTestDraft'),prompt=JSON.stringify({goal:saved.packet.ownerGoal,criteria:saved.packet.acceptanceCriteria,files:saved.packet.source})
 const prepared=draft.prepare(prompt);assert.equal(prepared.schema.properties.expectedTests.const,3);assert.equal(prepared.packet.draftContract.criteria[0].requiredSubjects[0].symbol,'orderBoxes')
 assert.match(prepared.system,/literal expected/);assert.throws(()=>draft.parse(JSON.stringify(saved.generated),prepared),/invalid_worker_result/)
 const good={testCode:valid().protectedTests[file].replace('assert.equal(orderBoxes(3,10,4),2)',"assert.equal(require('../src/localBrain/examples/stock.js').orderBoxes(3,10,4),2)").replace("assert.equal(formatDuration(60),'1m 0s')","assert.equal(require('../src/localBrain/examples/duration.js').formatDuration(60),'1m 0s')").replace("assert.equal(formatClockDuration(60),'00:01:00')","assert.equal(require('../src/localBrain/examples/duration.js').formatClockDuration(60),'00:01:00')"),expectedTests:3};assert.deepEqual(draft.parse(JSON.stringify(good),prepared),good)
 const prior=require('../../../test/localBrain/fixtures/test-draft-review-v2.json'),full={testCode:prior.packet.protectedTests[file],expectedTests:3};assert.throws(()=>draft.parse(JSON.stringify(full),prepared),e=>e.localDraftValidation.reason==='assertion_form')
 const stockAssertion="assert.equal(require('../src/localBrain/examples/stock.js').orderBoxes(3,10,4),2)"
 const missing={...good,testCode:good.testCode.replace(stockAssertion,'')};assert.throws(()=>draft.parse(JSON.stringify(missing),prepared),/invalid_worker_result/)
 for(const code of [good.testCode+'\ntest("extra",()=>assert.ok(true));',good.testCode.replace(/test\('stock'.*\n/,''),good.testCode.replace(stockAssertion,'/* '+stockAssertion+' */'),good.testCode.replace(stockAssertion,'/'+stockAssertion+'/'),good.testCode.replace(stockAssertion,'`'+stockAssertion+'`')])assert.throws(()=>draft.parse(JSON.stringify({...good,testCode:code}),prepared),/invalid_worker_result/)
})
