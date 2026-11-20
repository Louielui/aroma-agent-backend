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

function secondPosition(first) {
  return Object.fromEntries(Object.entries(first).map(([key,[invalid,,error]]) => [key,['0',invalid,error]]))
}
function correctedCases(complete = true) {
  const data = JSON.parse(nativeDraft)
  // Restore only the unaffected argument slots in a temporary control.
  for (const [i,row] of data.tests.c2.groups[0].rows.entries()) {
    if (i>=9 && i<18) row[0] = '1'
    if (i>=18 && i<27) [row[0],row[1]] = ['1','3']
  }
  if (complete) data.tests.c3.secondRejections = secondPosition(data.tests.c3.rejections)
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
  assert.throws(()=>draft.project(nativeDraft,p),e=>e.localDraftValidation?.reason==='case_plan_boundary')
  const control = JSON.parse(nativeDraft)
  control.tests.c3.secondRejections = secondPosition(control.tests.c3.rejections)
  assert.throws(()=>draft.project(JSON.stringify(control),p),e=>e.localDraftValidation?.reason==='case_plan_baseline_coverage'&&e.localDraftValidation.missingBaselineCases===18)
  assert.deepEqual(p.packet.draftContract.baselineContract.referenceCases.map(v=>[v.criterion,v.cases.length]),[['c1',7],['c2',28]])
  assert.equal(p.packet.draftContract.newExampleContract.rejectionCases.length,12)
  assert.equal(saved['draft-output'].text,nativeDraft)
})

test('restoring old tuples alone cannot hide missing second-position stockVariance probes', () => {
  const p = prepared(), data = correctedCases(false)
  assert.throws(()=>draft.project(JSON.stringify(data),p),e=>e.localDraftValidation?.reason==='case_plan_boundary')
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
  const allowed=compact.schema.$defs.red.properties.anchor.enum
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

test('saved stock draft with shifted probe keys requires the exact r1-r6 map and both positions', () => {
  const archive = require('../../../test/localBrain/fixtures/stock-probe-guidance-native-v1.json')
  assert.equal(hash(archive.draftOutput.raw), archive.draftOutput.sha256)
  const nativeText = JSON.parse(archive.draftOutput.raw).text
  const p = prepared()
  assert.throws(() => draft.project(nativeText, p), error =>
    error.localDraftValidation?.reason === 'case_plan_boundary')
  const data = JSON.parse(nativeText)
  assert.deepEqual(data.tests.c3.rejections.r2, ['0', '-1', 'RangeError'])

  const field = prefix => {
    const line = p.system.split('\n').find(value => value.startsWith(prefix))
    assert.ok(line, prefix)
    return JSON.parse(line.slice(prefix.length))
  }
  const firstPosition = field('Use this exact tests.c3.rejections object: ')
  const pairedRows = field('Use this exact tests.c3.secondRejections object: ')
  const probes = ['-1', '1.5', "'1'", 'NaN', 'Infinity', 'Number.MAX_SAFE_INTEGER+1']
  assert.deepEqual(firstPosition, Object.fromEntries(probes.map((value, i) =>
    ['r' + (i + 1), [value, '0', 'RangeError']])))
  assert.deepEqual(pairedRows, secondPosition(firstPosition))

  // This control changes only the six keyed rows, preserving the recorded regression and result rows.
  data.tests.c3.rejections = firstPosition
  assert.throws(() => draft.project(JSON.stringify(data), p), error =>
    error.localDraftValidation?.reason === 'case_plan_boundary')
  data.tests.c3.secondRejections = pairedRows
  const result = draft.project(JSON.stringify(data), p)
  assert.equal(result.generated.expectedTests, 3)
  assert.equal(result.generated.testCode.match(/^assert\./gm).length, 57)
  assert.deepEqual(review.prepareCompact(reviewInput(result.generated.testCode, result.origin))
    .packet.baselineProof.newExampleProof, {exactCases: 10, rejectionProbes: 12})

  const other = {...packet, criteria:packet.criteria.map((criterion, i) =>
    i === 0 ? criterion + ' A different Owner criterion.' : criterion)}
  assert.doesNotMatch(draft.prepare(JSON.stringify(other)).system, /Use this exact tests\.c3\.rejections object/)
})

test('saved stock draft requires separate structured rows for every second-parameter probe', () => {
  const archive = require('../../../test/localBrain/fixtures/stock-paired-probes-native-v1.json')
  assert.equal(hash(archive.draftOutput.raw), archive.draftOutput.sha256)
  const raw = JSON.parse(archive.draftOutput.raw).text
  const p = prepared()
  const c3 = p.schema.properties.tests.properties.c3
  assert.deepEqual(c3.required, ['title', 'groups', 'rejections', 'secondRejections'])
  const keys = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']
  assert.deepEqual(c3.properties.rejections.required, keys)
  assert.deepEqual(c3.properties.secondRejections.required, keys)
  assert.equal(c3.properties.secondRejections.additionalProperties, false)

  const rejectsBoundary = response => assert.throws(() => draft.project(response, p),
    error => error.localDraftValidation?.reason === 'case_plan_boundary')
  rejectsBoundary(raw)

  // Synthetic response with only the omitted object added. The archived text stays byte-exact.
  const complete = JSON.parse(raw)
  complete.tests.c3.secondRejections = secondPosition(complete.tests.c3.rejections)
  for (const field of ['rejections', 'secondRejections']) {
    for (const key of keys) {
      const incomplete = structuredClone(complete)
      delete incomplete.tests.c3[field][key]
      rejectsBoundary(JSON.stringify(incomplete))
    }
  }
  const optionalGroup = JSON.parse(raw)
  optionalGroup.tests.c3.groups.push({method: 'throws', rows: Object.values(complete.tests.c3.secondRejections)})
  rejectsBoundary(JSON.stringify(optionalGroup))
  const wrongFirst = structuredClone(complete)
  wrongFirst.tests.c3.rejections.r2 = ['0', '1.5', 'RangeError']
  rejectsBoundary(JSON.stringify(wrongFirst))
  const extraKey = structuredClone(complete)
  extraKey.tests.c3.secondRejections.r7 = ['0', '-1', 'RangeError']
  rejectsBoundary(JSON.stringify(extraKey))
  const wrong = structuredClone(complete)
  wrong.tests.c3.secondRejections.r2 = ['1.5', '0', 'RangeError']
  rejectsBoundary(JSON.stringify(wrong))
  wrong.tests.c3.secondRejections.r2 = ['0', '-1', 'RangeError']
  rejectsBoundary(JSON.stringify(wrong))
  wrong.tests.c3.secondRejections.r2 = ['0', '1.5', 'Error']
  rejectsBoundary(JSON.stringify(wrong))
  wrong.tests.c3.secondRejections.r2 = ['1', '1.5', 'RangeError']
  rejectsBoundary(JSON.stringify(wrong))

  const text = JSON.stringify(complete)
  const result = draft.project(text, p)
  assert.equal(result.origin.rawOutputSha256, hash(text))
  assert.equal(result.generated.expectedTests, 3)
  assert.equal(result.generated.testCode.match(/^assert\./gm).length, 57)
  assert.deepEqual(review.prepareCompact(reviewInput(result.generated.testCode, result.origin))
    .packet.baselineProof.newExampleProof, {exactCases: 10, rejectionProbes: 12})
  const other = {...packet, criteria: packet.criteria.map((criterion, index) =>
    index === 0 ? criterion + ' Different criterion.' : criterion)}
  assert.equal(draft.prepare(JSON.stringify(other)).schema.properties.tests.properties.c3
    .properties.secondRejections, undefined)
})

test('stock rejection schema pins each transmitted tuple slot and excludes the saved copied rows', () => {
  const archive = require('../../../test/localBrain/fixtures/stock-slot-schema-native-v1.json')
  assert.equal(hash(archive.draftOutput.raw), archive.draftOutput.sha256)
  const raw = JSON.parse(archive.draftOutput.raw).text
  const response = JSON.parse(raw)
  const p = prepared()
  const probes = ['-1', '1.5', "'1'", 'NaN', 'Infinity', 'Number.MAX_SAFE_INTEGER+1']
  const c3 = p.schema.properties.tests.properties.c3
  const paired = response.tests.c3
  for (const [i, probe] of probes.entries()) {
    const key = 'r' + (i + 1)
    for (const [field, values] of [['rejections', [probe, '0', 'RangeError']],
      ['secondRejections', ['0', probe, 'RangeError']]]) {
      const row = c3.properties[field].properties[key]
      assert.equal(row.minItems, 3)
      assert.equal(row.maxItems, 3)
      assert.equal(row.additionalItems, false)
      assert.deepEqual(row.items, values.map(value => ({type: 'string', const: value})))
      const returned = paired[field][key]
      assert.equal(row.items.every((slot, index) => returned[index] === slot.const),
        field === 'rejections')
    }
  }
  assert.throws(() => draft.project(raw, p), error =>
    error.localDraftValidation?.reason === 'case_plan_boundary')

  // Synthetic control only. Supply all six correct second-position rows explicitly.
  paired.secondRejections = secondPosition(paired.rejections)
  const text = JSON.stringify(response)
  const result = draft.project(text, p)
  assert.equal(result.origin.rawOutputSha256, hash(text))
  assert.equal(result.generated.expectedTests, 3)
  assert.equal(result.generated.testCode.match(/^assert\./gm).length, 57)
  assert.deepEqual(review.prepareCompact(reviewInput(result.generated.testCode, result.origin))
    .packet.baselineProof.newExampleProof, {exactCases: 10, rejectionProbes: 12})
})

test('compact stock wire branches enforce verdict, findings, coverage and direct result RED together', () => {
  const good = draft.project(JSON.stringify(correctedCases()),prepared())
  const compact = review.prepareCompact(reviewInput(good.generated.testCode,good.origin))
  const [pass, changes] = compact.schema.anyOf
  assert.deepEqual([pass.properties.verdict.const,changes.properties.verdict.const],['pass','changes_requested'])
  assert.deepEqual(pass.properties.findings.const,[])
  assert.equal(changes.properties.findings.minItems,1)
  const passCriterion = pass.properties.coverage.items.anyOf[0].properties
  assert.equal(passCriterion.status.const,'covered')
  assert.deepEqual(passCriterion.checks.items,{$ref:'#/$defs/c1'})
  assert.equal(compact.schema.$defs.c1.properties.status.const,'covered')
  assert.equal(compact.schema.$defs.refs.minItems,1)
  assert.deepEqual(pass.properties.baseline,{$ref:'#/$defs/red'})
  const passRed = compact.schema.$defs.red.properties
  assert.equal(passRed.expectation.const,'expected_failure')
  assert.equal(passRed.anchor.enum.length,10)
  const lines = compact.packet.target.files.flatMap(file=>file.lines)
  for (const id of passRed.anchor.enum) {
    assert.match(lines.find(line=>line.anchorId===id).text,/^assert\.(?:equal|deepEqual)\(.*\.stockVariance\(/)
  }
  assert.ok(lines.some(line=>/\.stockVariance\(/.test(line.text)&&!passRed.anchor.enum.includes(line.anchorId)))
  assert.ok(lines.some(line=>/\.orderBoxes\(/.test(line.text)&&!passRed.anchor.enum.includes(line.anchorId)))
  assert.equal(changes.properties.baseline.anyOf[1].properties.expectation.const,'not_established')
})
