'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),review=require('./localTestReview'),fixture=require('../../../test/localBrain/fixtures/test-draft-review-v4.json')
function accepted(input){
 const {packet:p,schema}=review.prepareCompact(input),lines=p.target.files.flatMap(f=>f.lines)
 const refs=c=>c.requiredSubjects.map(s=>lines.find(l=>l.kind==='assertion'&&l.subjects.some(v=>v.file===s.file&&v.symbol===s.symbol)).anchorId)
 return{binding:p.binding,verdict:'pass',summary:schema.anyOf.find(v=>v.properties.verdict.const==='pass').properties.summary.const,findings:[],coverage:p.criteria.map(c=>({criterion:c.id,status:'covered',checks:c.checks.map(k=>({id:k.id,status:'covered',anchors:[...new Set(refs(c))],reason:'Offline coverage double, not a semantic proof.'}))})),baseline:{expectation:'expected_failure',anchor:refs(p.criteria.at(-1))[0],reason:'New export is absent from unchanged baseline.'}}
}
test('saved real output-limit input is reproduced and compacted without dropping source, criteria or checks',()=>{
 const old=review.prepare(fixture.packet),fresh=review.prepareCompact(fixture.packet)
 assert.equal(JSON.stringify(old.packet),fixture.originalModelInput.messages[1].content)
 assert.deepEqual(fresh.packet.criteria,old.packet.criteria);assert.deepEqual(fresh.packet.baseline,old.packet.baseline)
 for(const f of old.packet.target.files){const n=fresh.packet.target.files.find(v=>v.file===f.file);assert.equal(n.sha256,f.sha256);assert.deepEqual(n.lines.map(({anchorId,...l})=>l),f.lines.map(({anchorId,...l})=>l))}
 const bytes=p=>Buffer.byteLength(JSON.stringify(p.packet)+p.system+JSON.stringify(p.schema))
 assert.ok(bytes(fresh)<bytes(old)*0.8,JSON.stringify({before:bytes(old),after:bytes(fresh)}))
 const response=accepted(fixture.packet);assert.ok(Buffer.byteLength(JSON.stringify(response))<2500)
 const parsed=review.parseCompact(JSON.stringify(response),fixture.packet);assert.equal(parsed.verdict,'pass');assert.equal(parsed.reviewBasis.wireProtocol,'host_anchor_compact_v2')
 assert.equal(parsed.reviewBasis.coverage.length,3);assert.ok(parsed.reviewBasis.coverage.every((c,i)=>c.checks.length===old.packet.criteria[i].checks.length))
 for(const c of parsed.reviewBasis.coverage)for(const a of c.assertions)assert.equal(a.quote,fixture.packet.protectedTests[a.file].split('\n')[a.line-1])
})
test('compact binding, all checks, executable subjects and explicit negative verdicts remain mandatory',()=>{
 const input=fixture.packet,a=accepted(input),{packet,schema}=review.prepareCompact(input),reference=packet.target.files[0].lines.find(l=>l.kind==='reference').anchorId
 const mutations=[v=>delete v.binding,v=>v.binding='0'.repeat(64),v=>v.coverage.pop(),v=>v.coverage[1].criterion=1,v=>v.coverage[0].checks.pop(),v=>v.coverage[0].checks[0].anchors=[reference],v=>v.coverage[0].checks[0].anchors=[999999],v=>v.coverage[0].checks[0].anchors.push(v.coverage[0].checks[0].anchors[0]),v=>v.coverage[0].checks[0].status='uncertain',v=>v.coverage[0].checks[0].extra=true,v=>v.extra=true,v=>v.baseline.expectation='not_established',v=>v.verdict='changes_requested',v=>{for(const k of v.coverage[0].checks)k.anchors=v.coverage[2].checks[0].anchors}]
 for(const mutate of mutations){const v=structuredClone(a);mutate(v);assert.throws(()=>review.parseCompact(JSON.stringify(v),input),/invalid_worker_result/)}
 const changed=structuredClone(input);changed.ownerGoal+=' different';assert.throws(()=>review.parseCompact(JSON.stringify(a),changed),/invalid_worker_result/)
 const changedTests=structuredClone(input);changedTests.protectedTests[Object.keys(changedTests.protectedTests)[0]]+='\n';assert.throws(()=>review.parseCompact(JSON.stringify(a),changedTests),/invalid_worker_result/)
 const negative=structuredClone(a);negative.verdict='changes_requested';negative.summary=schema.anyOf.find(v=>v.properties.verdict.const===negative.verdict).properties.summary.const;negative.findings=[{anchor:a.baseline.anchor,message:'Offline negative finding.'}];negative.coverage[2].status='uncertain';negative.coverage[2].checks=negative.coverage[2].checks.map(c=>({...c,status:'uncertain',anchors:[]}));assert.equal(review.parseCompact(JSON.stringify(negative),input).verdict,'changes_requested')
})
test('compact wire binds each criterion to its own check IDs and count in both verdict branches',()=>{
 const input=structuredClone(fixture.packet)
 input.acceptanceCriteria[0]+='; Preserve the required subject on this additional check.'
 const prepared=review.prepareCompact(input), response=accepted(input)
 const expected=prepared.packet.criteria.map(c=>c.checks.map(k=>k.id))
 assert.ok(new Set(expected.map(ids=>ids.length)).size>1)
 for(const branch of prepared.schema.anyOf){
  const coverage=branch.properties.coverage
  assert.equal(coverage.minItems,expected.length)
  assert.equal(coverage.maxItems,expected.length)
  const choices=coverage.items.anyOf
  assert.ok(Array.isArray(choices),'schema must bind check IDs to the containing criterion')
  assert.deepEqual(choices.map(choice=>choice.properties.criterion.const),prepared.packet.criteria.map(c=>c.id))
  for(const [index,choice] of choices.entries()){
   const checks=choice.properties.checks,ids=expected[index]
   assert.equal(checks.minItems,ids.length)
   assert.equal(checks.maxItems,ids.length)
   for(const entry of checks.items.anyOf??[checks.items]){
    const check=prepared.schema.$defs[entry.$ref.split('/').at(-1)]
    assert.deepEqual(check.properties.id,{type:'integer',enum:ids})
   }
  }
 }
 const reordered=structuredClone(response)
 reordered.coverage.reverse()
 for(const criterion of reordered.coverage)criterion.checks.reverse()
 assert.equal(review.parseCompact(JSON.stringify(reordered),input).verdict,'pass')
 const wrong=structuredClone(response)
 wrong.coverage.at(-1).checks[0].id=999
 assert.throws(()=>review.parseCompact(JSON.stringify(wrong),input),error=>error.reviewValidation?.stage==='finding')
 const duplicate=structuredClone(response)
 duplicate.coverage[0].checks[1].id=duplicate.coverage[0].checks[0].id
 assert.throws(()=>review.parseCompact(JSON.stringify(duplicate),input),error=>error.reviewValidation?.stage==='finding')
})
module.exports={accepted}

test('compact review refuses the saved PR202 execution claim in either verdict',()=>{
 const input=fixture.packet,good=accepted(input)
 const claim='Implementation of stockVariance and updated tests. All orderBoxes tests pass (regression). stockVariance tests pass with expected_failure anchored at the new export result.'
 const pass={...good,summary:claim}
 const changes={...pass,verdict:'changes_requested',findings:[{anchor:pass.baseline.anchor,message:'A test assertion needs correction.'}]}
 for(const response of [pass,changes]){
  assert.throws(()=>review.parseCompact(JSON.stringify(response),input),error=>error.reviewValidation?.stage==='summary')
 }
 const [passBranch,changesBranch]=review.prepareCompact(input).schema.anyOf
 assert.deepEqual(passBranch.properties.summary,{const:'Static review passed. Tests were not run. Baseline RED expected.'})
 assert.deepEqual(changesBranch.properties.summary,{const:'Static review requested changes. Tests were not run.'})
 assert.throws(()=>review.parseCompact(JSON.stringify({...changes,summary:good.summary}),input),error=>error.reviewValidation?.stage==='summary')
 const acceptedChanges={...changes,summary:changesBranch.properties.summary.const}
 assert.equal(review.parseCompact(JSON.stringify(acceptedChanges),input).summary,acceptedChanges.summary)
})
