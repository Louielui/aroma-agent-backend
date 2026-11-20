'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),saved=require('../../../test/localBrain/fixtures/draft-case-plan-v1.json'),{synthetic}=require('../../../test/localBrain/fixtures/casePlan.fixture.cjs'),draft=require('./localTestDraft'),review=require('./localTestReview')
function fixture(){
 const packet=JSON.parse(JSON.parse(saved.inputRaw).messages.find(m=>m.role==='user').content),p=draft.prepare(JSON.stringify(packet)),raw=JSON.stringify(synthetic(p.packet.draftContract.casePlan)),projected=draft.project(raw,p),name='acceptance/registered-task.test.cjs'
 const input={ownerGoal:packet.goal,acceptanceCriteria:packet.criteria,source:packet.files,protectedTests:{[name]:projected.generated.testCode},workOrder:{allowedFiles:[name],protectedFiles:[name],expectedTests:3},testsExecuted:false,appliedToLive:false,draftOrigin:projected.origin},prepared=review.prepareCompact(input),lines=prepared.packet.target.files.flatMap(f=>f.lines)
 const refs=c=>c.requiredSubjects.map(s=>lines.find(l=>l.kind==='assertion'&&l.subjects.some(v=>v.file===s.file&&v.symbol===s.symbol)).anchorId)
 // Protocol response double only. It is not a real semantic review verdict.
 const reply={binding:prepared.packet.binding,verdict:'pass',summary:prepared.schema.anyOf.find(v=>v.properties.verdict.const==='pass').properties.summary.const,findings:[],coverage:prepared.packet.criteria.map(c=>({criterion:c.id,status:'covered',checks:c.checks.map(k=>({id:k.id,status:'covered',anchors:refs(c),reason:'Synthetic protocol reference.'}))})),baseline:{expectation:'expected_failure',anchor:refs(prepared.packet.criteria[2])[0],reason:'Synthetic expected-failure reference.'}}
 return{input,prepared,reply}
}
test('case provenance is disclosed, packet-bound and retained with all thirteen review conditions',()=>{
 const {input,prepared,reply}=fixture();assert.match(prepared.system,/host-rendered from model case data/);assert.deepEqual(prepared.packet.draftOrigin,input.draftOrigin);assert.equal(prepared.packet.criteria.flatMap(c=>c.checks).length,13)
 const out=review.parseCompact(JSON.stringify(reply),input);assert.deepEqual(out.reviewBasis.draftOrigin,input.draftOrigin);assert.equal(out.reviewBasis.coverage.flatMap(c=>c.checks).length,13)
 const swapped=structuredClone(input);swapped.draftOrigin.rawOutputSha256='a'.repeat(64);assert.notEqual(review.prepareCompact(swapped).packet.binding,prepared.packet.binding);assert.throws(()=>review.parseCompact(JSON.stringify(reply),swapped),/invalid_worker_result/)
 const altered=structuredClone(input);altered.protectedTests[Object.keys(altered.protectedTests)[0]]+='\n';assert.throws(()=>review.prepareCompact(altered),/invalid_worker_result/)
})
test('provenance cannot supply missing coverage or turn a negative review into approval',()=>{
 const {input,reply}=fixture(),missing=structuredClone(reply);missing.coverage[2].checks.pop();assert.throws(()=>review.parseCompact(JSON.stringify(missing),input),/invalid_worker_result/)
 const negative=structuredClone(reply);negative.coverage[2].checks[0]={...negative.coverage[2].checks[0],status:'missing',anchors:[]};assert.throws(()=>review.parseCompact(JSON.stringify(negative),input),/invalid_worker_result/)
 const forged=structuredClone(input);forged.draftOrigin.testsExecuted=true;assert.throws(()=>review.prepareCompact(forged),/invalid_worker_result/)
})
