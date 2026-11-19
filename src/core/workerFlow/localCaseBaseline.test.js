'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),saved=require('../../../test/localBrain/fixtures/case-baseline-native-v1.json'),draft=require('./localTestDraft'),review=require('./localTestReview'),{createHash}=require('node:crypto'),hash=s=>createHash('sha256').update(s).digest('hex')
const input=JSON.parse(saved.draftInputRaw),output=JSON.parse(saved.draftOutputRaw),packet=JSON.parse(input.messages.find(m=>m.role==='user').content)
const {synthetic}=require('../../../test/localBrain/fixtures/casePlan.fixture.cjs'),cases=require('./localCasePlan'),baseline=require('./localCaseBaseline'),make=()=>{const prepared=draft.prepare(JSON.stringify(packet));return{prepared,spec:prepared.packet.draftContract.casePlan,value:synthetic(prepared.packet.draftContract.casePlan)}}
const oldReviewPacket=JSON.parse(JSON.parse(saved.reviewInputRaw).messages.find(m=>m.role==='user').content)
function reviewInput(){return{ownerGoal:oldReviewPacket.goal,acceptanceCriteria:oldReviewPacket.criteria.map(c=>c.text),source:Object.fromEntries(oldReviewPacket.baseline.files.map(f=>[f.file,f.lines.map(l=>l.text).join('\n')])),protectedTests:Object.fromEntries(oldReviewPacket.target.files.map(f=>[f.file,f.lines.map(l=>l.text).join('\n')])),workOrder:{allowedFiles:oldReviewPacket.target.files.map(f=>f.file),protectedFiles:oldReviewPacket.target.files.map(f=>f.file),expectedTests:3},testsExecuted:false,appliedToLive:false,draftOrigin:oldReviewPacket.draftOrigin}}
test('real raw draft with twenty missing baseline rejections is rejected before review without repair',()=>{
 for(const phase of ['draft','review'])for(const kind of ['Input','Output'])assert.equal(hash(saved[phase+kind+'Raw']),saved[phase+kind+'Sha256'])
 assert.throws(()=>draft.project(output.text,draft.prepare(JSON.stringify(packet))),e=>e.localDraftValidation.reason==='case_plan_baseline_coverage'&&e.localDraftValidation.missingBaselineCases===20&&e.localDraftValidation.wrongBaselineExpectedValues===1)
})
test('real native PASS cannot turn the incomplete exact test version into an accepted review',()=>{
 assert.equal(JSON.parse(JSON.parse(saved.reviewOutputRaw).text).verdict,'pass')
 assert.throws(()=>review.parseCompact(JSON.parse(saved.reviewOutputRaw).text,reviewInput()),e=>e.reviewValidation?.stage==='baseline_coverage')
})
test('all 52 audited baseline cases are individually mandatory; duplicate rows never supply a missing combination',()=>{
 const {prepared,spec,value}=make();assert.equal(prepared.packet.draftContract.baselineContract.requiredRows,52);assert.match(prepared.system,/28 throws/)
 let tested=0
 for(const id of ['c1','c2'])for(const [gi,g]of value.tests[id].groups.entries())for(let ri=0;ri<g.rows.length;ri++){
  const missing=structuredClone(value);missing.tests[id].groups[gi].rows.splice(ri,1);missing.tests[id].groups[gi].rows.push(g.rows[(ri+1)%g.rows.length]);tested++
  assert.throws(()=>draft.project(JSON.stringify(missing),prepared),e=>e.localDraftValidation.reason==='case_plan_baseline_coverage')
 }
 assert.equal(tested,52);assert.equal(baseline.check(spec,value).missingBaselineCases,0)
})
test('every baseline expectation is exact, conflicting duplicates fail, and maximum BigInt expression remains valid data',()=>{
 const {prepared,spec,value}=make(),wrong=structuredClone(value)
 wrong.tests.c2.groups[0].rows.at(-1)[1]="'42866666666m 31s'"
 assert.throws(()=>draft.project(JSON.stringify(wrong),prepared),e=>e.localDraftValidation.reason==='case_plan_baseline_expected'&&e.localDraftValidation.wrongBaselineExpectedValues===1)
 wrong.tests.c2.groups[0].rows.push(value.tests.c2.groups[0].rows.at(-1))
 assert.throws(()=>draft.project(JSON.stringify(wrong),prepared),e=>e.localDraftValidation.reason==='case_plan_baseline_expected')
 for(const id of ['c1','c2'])for(let ri=0;ri<value.tests[id].groups[0].rows.length;ri++){
  const v=structuredClone(value);v.tests[id].groups[0].rows[ri][v.tests[id].groups[0].rows[ri].length-1]='0'
  // The existing zero box-count case already expects zero.
  if(id==='c1'&&ri===4)continue
  assert.throws(()=>draft.project(JSON.stringify(v),prepared),e=>e.localDraftValidation.reason==='case_plan_baseline_expected')
 }
 value.tests.c2.groups[0].rows.at(-1)[1]='(BigInt(Number.MAX_SAFE_INTEGER)/60n)+"m "+(BigInt(Number.MAX_SAFE_INTEGER)%60n)+"s"'
 const projected=draft.project(JSON.stringify(value),prepared);assert.equal(baseline.rendered(spec,projected.generated.testCode).requiredRows,52);assert.equal(projected.origin.testsExecuted,false)
})
test('known-source drift and unsupported recipe changes fail closed, while unrelated recipes gain no coverage claim',()=>{
 const {spec,value}=make()
 for(const file of Object.keys(spec.sourceHashes)){const changed=structuredClone(spec);changed.sourceHashes[file]='a'.repeat(64);assert.throws(()=>cases.render(JSON.stringify(value),changed),e=>e.casePlanFailure==='baseline_source')}
 const different=structuredClone(spec);different.tests[1].subject.symbol='other';assert.throws(()=>baseline.profile(different),e=>e.casePlanFailure==='baseline_source')
 assert.equal(baseline.profile({sourceHashes:{'src/other.js':'a'.repeat(64)},tests:[]}),null)
})
test('review rechecks the exact generated code, refuses dormant/malformed assertions and binds positive proof into its packet',()=>{
 const {prepared,spec,value}=make(),projected=draft.project(JSON.stringify(value),prepared),good=reviewInput(),name=Object.keys(good.protectedTests)[0]
 good.protectedTests[name]=projected.generated.testCode;good.draftOrigin=projected.origin
 const p=review.prepareCompact(good);assert.equal(p.packet.baselineProof.requiredRows,52);assert.equal(p.packet.baselineProof.testsExecuted,false)
 for(const change of [s=>s.replace('test(', 'test.skip('),s=>s.replace('assert.equal(', 'if(false)assert.equal('),s=>s+'process.exit()\n',s=>s.replace('assert.equal(', 'assert.equal(/*x*/')]){
  assert.throws(()=>baseline.rendered(spec,change(projected.generated.testCode)),/invalid_worker_result/)
 }
 const unsupported=structuredClone(value);unsupported.tests.c2.groups[0].rows.at(-1)[1]='process.exit()'
 assert.throws(()=>draft.project(JSON.stringify(unsupported),prepared),e=>e.localDraftValidation.reason==='case_plan_expression')
 assert.equal(JSON.parse(saved.draftOutputRaw).text,output.text)
})
