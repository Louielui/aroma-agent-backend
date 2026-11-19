'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const draft = require('./localTestDraft')
const review = require('./localTestReview')
const fixture = require('../../../test/localBrain/fixtures/stock-case-proof-native-v1.json')

const hash = value => createHash('sha256').update(value).digest('hex')
const saved = Object.fromEntries(Object.entries(fixture.evidence).map(([name,{raw}])=>[name,JSON.parse(raw)]))
const packet = JSON.parse(saved['draft-input'].messages.find(message=>message.role==='user').content)
const nativeDraft = saved['draft-output'].text
const nativeReview = JSON.parse(saved['review-output'].text)
const testFile = packet.protectedTestPath
const sourceFile = 'src/localBrain/examples/stock.js'
const prepared = () => draft.prepare(JSON.stringify(packet))

function correctedCases(complete = true) {
  const data = JSON.parse(nativeDraft)
  // Restore only the unaffected argument slots in a temporary control.
  for (const [i,row] of data.tests.c2.groups[0].rows.entries()) {
    if (i>=9 && i<18) row[0] = '1'
    if (i>=18 && i<27) [row[0],row[1]] = ['1','3']
  }
  if (complete) data.tests.c3.groups.push({
    method:'throws',rows:Object.values(data.tests.c3.rejections).map(([invalid,,name])=>['0',invalid,name])
  })
  return data
}
function reviewInput(code, origin) {
  return {
    ownerGoal:packet.goal, acceptanceCriteria:packet.criteria, source:packet.files,
    protectedTests:{[testFile]:code},
    workOrder:{expectedTests:3,allowedFiles:[testFile],protectedFiles:[testFile]},
    testsExecuted:false,appliedToLive:false,draftOrigin:origin
  }
}

test('saved stock draft is rejected before review for changing 18 exact orderBoxes tuples', () => {
  for (const { raw, sha256 } of Object.values(fixture.evidence)) assert.equal(hash(raw),sha256)
  assert.equal(saved['draft-input'].callId,saved['draft-output'].callId)
  assert.equal(saved['review-input'].callId,saved['review-output'].callId)
  const p = prepared()
  assert.throws(()=>draft.project(nativeDraft,p),e=>e.localDraftValidation?.reason==='case_plan_baseline_coverage'&&e.localDraftValidation.missingBaselineCases===18)
  assert.deepEqual(p.packet.draftContract.baselineContract.referenceCases.map(v=>[v.criterion,v.cases.length]),[['c1',7],['c2',28]])
  assert.equal(p.packet.draftContract.newExampleContract.rejectionCases.length,12)
  assert.equal(saved['draft-output'].text,nativeDraft)
})

test('restoring old tuples alone cannot hide missing second-position stockVariance probes', () => {
  const p = prepared(), data = correctedCases(false)
  assert.throws(()=>draft.project(JSON.stringify(data),p),e=>e.localDraftValidation?.reason==='case_plan_new_coverage'&&e.localDraftValidation.missingNewCases===6)
  const correct = correctedCases()
  assert.equal(draft.project(JSON.stringify(correct),p).generated.expectedTests,3)
  const conflicting = structuredClone(correct)
  conflicting.tests.c3.groups[0].rows.push(['7','3','-4'])
  assert.throws(()=>draft.project(JSON.stringify(conflicting),p),e=>e.localDraftValidation?.reason==='case_plan_new_expected')
  const damaged = structuredClone(correct)
  damaged.tests.c3.rejections.r1[0] = '-1,'
  assert.throws(()=>draft.project(JSON.stringify(damaged),p),e=>e.localDraftValidation?.reason==='case_plan_expression')
})

test('review independently rejects a correctly hashed rendered test missing a second-position probe', () => {
  const good = draft.project(JSON.stringify(correctedCases()),prepared())
  const line = 'assert.throws(()=>require("../src/localBrain/examples/stock.js").stockVariance(0,-1),RangeError)\n'
  assert.ok(good.generated.testCode.includes(line))
  const changed = good.generated.testCode.replace(line,'')
  const forged = {...good.origin,renderedTestSha256:hash(changed)}
  assert.throws(()=>review.prepareCompact(reviewInput(changed,forged)),e=>e.reviewValidation?.stage==='new_coverage')
})

test('saved false PASS cannot cite the orderBoxes result as RED after rebinding a complete control', () => {
  const good = draft.project(JSON.stringify(correctedCases()),prepared())
  const input = reviewInput(good.generated.testCode,good.origin)
  const compact = review.prepareCompact(input)
  const lines = compact.packet.target.files[0].lines
  const old = lines.find(line=>line.anchorId===nativeReview.baseline.anchor)
  assert.match(old.text,/\.orderBoxes\(0,Number.MIN_VALUE,Number.MIN_VALUE\)/)
  const rebound = {...nativeReview,binding:compact.packet.binding}
  assert.throws(()=>review.parseCompact(JSON.stringify(rebound),input),e=>e.reviewValidation?.stage==='red_anchor')
  const allowed=compact.schema.properties.baseline.anyOf.find(branch=>branch.properties.expectation.const==='expected_failure').properties.anchor.enum
  assert.equal(allowed.length,10)
  assert.ok(allowed.every(id=>/^assert\.(?:equal|deepEqual)\(.*\.stockVariance\(/.test(lines.find(line=>line.anchorId===id).text)))
  assert.deepEqual(compact.packet.baseline.expectedFailureSubject,{file:sourceFile,symbol:'stockVariance'})
  const fixed={...rebound,baseline:{...rebound.baseline,anchor:allowed[0]}}
  const readBack=review.parseCompact(JSON.stringify(fixed),input)
  assert.equal(readBack.verdict,'pass')
  assert.equal(readBack.reviewBasis.baseline.subjects[0].symbol,'stockVariance')
  assert.equal(compact.packet.baselineProof.requiredRows,35)
  assert.deepEqual(compact.packet.baselineProof.newExampleProof,{exactCases:10,rejectionProbes:12})
})

test('the stock contract refuses source drift while unrelated criteria retain generic operation', () => {
  const changed={...packet,files:{...packet.files,[sourceFile]:packet.files[sourceFile]+'\n'}}
  assert.throws(()=>draft.prepare(JSON.stringify(changed)),e=>e.casePlanFailure==='baseline_source')
  assert.throws(()=>draft.prepare(JSON.stringify({...packet,files:{}})),e=>e.localDraftValidation?.reason==='case_plan_baseline_source')
 const other={...packet,criteria:packet.criteria.map((criterion,i)=>i===0?criterion+' A different Owner criterion.':criterion)}
  assert.equal(draft.prepare(JSON.stringify(other)).packet.draftContract.baselineContract,undefined)
})
