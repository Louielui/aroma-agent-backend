'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),saved=require('../../../test/localBrain/fixtures/draft-form-review-v1.json'),draft=require('./localTestDraft'),review=require('./localTestReview')
const file='acceptance/registered-task.test.cjs',prompt=JSON.parse(saved.draftInput.messages.find(m=>m.role==='user').content),generated=JSON.parse(saved.draftOutput.text),sent=JSON.parse(saved.reviewInput.messages.find(m=>m.role==='user').content),input=saved.reviewContext
function canonical(){return{...generated,testCode:generated.testCode.replace('assert.equal(orderBoxes(3, 10, 4), 2)',"assert.equal(require('../src/localBrain/examples/stock.js').orderBoxes(3, 10, 4), 2)").replace('assert.equal(formatDuration(s),',"assert.equal(require('../src/localBrain/examples/duration.js').formatDuration(s),").replace("assert.equal(formatClockDuration(0), '00:00:00')","assert.equal(require('../src/localBrain/examples/duration.js').formatClockDuration(0), '00:00:00')")}}
test('saved real draft cannot satisfy the new host call-form contract through comments or destructuring',()=>{
 for(const key of ['draftInput','draftOutput','reviewInput','reviewOutput'])assert.equal(createHash('sha256').update(JSON.stringify(saved[key])).digest('hex'),saved[key+'Sha256'])
 const p=draft.prepare(JSON.stringify(prompt));assert.equal(p.packet.draftContract.assertionForm.version,'selected_inline_assert_v1');assert.equal(p.packet.draftContract.assertionForm.subjects.length,2);assert.equal(p.packet.draftContract.assertionForm.includeNewNamedSubjects,true)
 assert.throws(()=>draft.parse(saved.draftOutput.text,p),e=>{assert.equal(e.localDraftValidation.reason,'assertion_form');assert.equal(e.localDraftValidation.missingForms,3);assert.ok(!JSON.stringify(e.localDraftValidation).includes('stock.js'));return true})
 assert.deepEqual(draft.parse(JSON.stringify(canonical()),p),canonical())
})
test('form conformance requires each selected named export in an actual assertion, preserving refusals and limits',()=>{
 const p=draft.prepare(JSON.stringify(prompt)),v=canonical(),a="require('../src/localBrain/examples/stock.js').orderBoxes(3, 10, 4)"
 for(const replacement of ['orderBoxes(3, 10, 4)',"(require('../src/localBrain/examples/stock.js').orderBoxes, orderBoxes(3,10,4))","require('../src/localBrain/examples/stock.js')['orderBoxes'](3,10,4)","fake.require('../src/localBrain/examples/stock.js').orderBoxes(3,10,4)"]){const bad={...v,testCode:v.testCode.replace(a,replacement)};assert.throws(()=>draft.parse(JSON.stringify(bad),p),/invalid_worker_result/)}
 const wrong=structuredClone(p);wrong.packet.draftContract.assertionForm.version='unrecognized';assert.throws(()=>draft.parse(JSON.stringify(v),wrong),/invalid_worker_result/)
 assert.equal(p.schema.properties.expectedTests.const,3);assert.equal(p.packet.draftContract.criteria.flatMap(c=>c.requiredSubjects).length,2)
})
test('review guidance and status-conditioned schema preserve all data and reject the actual invalid review',()=>{
 const packet={...input,workOrder:{...input.workOrder,allowedFiles:[file],protectedFiles:[file],expectedTests:3}}
 const prepared=review.prepareCompact(packet),flat=prepared.packet.target.files.flatMap(f=>f.lines),assertions=flat.filter(l=>l.kind==='assertion'&&l.subjects.length).map(l=>l.anchorId)
 assert.equal(prepared.packet.binding,sent.binding);assert.equal(prepared.packet.criteria.flatMap(c=>c.checks).length,13);assert.equal(prepared.packet.target.files[0].sha256,createHash('sha256').update(generated.testCode).digest('hex'))
 const choices=prepared.schema.anyOf.find(branch=>branch.properties.verdict.const==='changes_requested').properties.coverage.items.properties.checks.items.anyOf;assert.equal(choices.length,2);assert.equal(choices[0].properties.anchors.minItems,1);assert.equal(choices[1].properties.anchors.maxItems,0);assert.deepEqual(choices[0].properties.anchors.items.enum,assertions)
 assert.deepEqual(prepared.schema.anyOf.find(branch=>branch.properties.verdict.const==='pass').properties.baseline.properties.anchor.enum,assertions);assert.match(prepared.system,/read-only preservation/);assert.match(prepared.system,/comment.*call form/)
 const invalid=JSON.parse(saved.reviewOutput.text);invalid.binding=prepared.packet.binding
 assert.throws(()=>review.parseCompact(JSON.stringify(invalid),packet),e=>e.reviewValidation.stage==='finding')
})
test('no assertion candidates leaves negative review branches, not fabricated executable anchors',()=>{
 const packet=structuredClone(input);packet.protectedTests[file]="const test=require('node:test');\ntest('a',()=>{});test('b',()=>{});test('c',()=>{});\n"
 const p=review.prepareCompact(packet);assert.equal(p.schema.anyOf.length,1);const {verdict,coverage,baseline}=p.schema.anyOf[0].properties;assert.equal(verdict.const,'changes_requested');assert.equal(coverage.items.properties.checks.items.anyOf.length,1);assert.deepEqual(coverage.items.properties.checks.items.anyOf[0].properties.status.enum,['missing','uncertain']);assert.equal(baseline.anyOf.length,1);assert.equal(baseline.anyOf[0].properties.expectation.const,'not_established')
 const first=p.packet.target.files[0].lines[0].anchorId,r={binding:p.packet.binding,verdict:'changes_requested',summary:'Synthetic negative protocol check, not a model review.',findings:[{anchor:first,message:'No source assertions supplied.'}],coverage:p.packet.criteria.map(c=>({criterion:c.id,status:'missing',checks:c.checks.map(k=>({id:k.id,status:'missing',anchors:[],reason:'No source assertion supplied.'}))})),baseline:{anchor:first,expectation:'not_established',reason:'No new behavior assertion.'}}
 assert.equal(review.parseCompact(JSON.stringify(r),packet).verdict,'changes_requested')
})
