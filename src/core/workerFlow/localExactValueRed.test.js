'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const draft = require('./localTestDraft')
const review = require('./localTestReview')
const fixture = require('../../../test/localBrain/fixtures/clock-exact-red-native-v1.json')

const hash = text => createHash('sha256').update(text).digest('hex')
const saved = Object.fromEntries(Object.entries(fixture.evidence).map(([name, value]) => [name, JSON.parse(value.raw)]))
const nativePacket = JSON.parse(saved['draft-input'].messages.find(message => message.role === 'user').content)
const nativeReview = JSON.parse(saved['review-output'].text)
const testFile = nativePacket.protectedTestPath
const bad = saved['draft-output'].text
const wrongMaximum = '25019998757901m 36s'
const correctMaximum = '2501999792983:36:31'

function prepared() {
  return draft.prepare(JSON.stringify(nativePacket))
}

function correctedData() {
  const data = JSON.parse(bad)
  const row = data.tests.c3.groups.find(group => group.method === 'equal').rows.find(row => row[0] === 'Number.MAX_SAFE_INTEGER')
  assert.equal(row[1], JSON.stringify(wrongMaximum))
  row[1] = JSON.stringify(correctMaximum)
  return data
}

function reviewInput(text, origin) {
  return {
    ownerGoal: nativePacket.goal,
    acceptanceCriteria: nativePacket.criteria,
    source: nativePacket.files,
    protectedTests: { [testFile]: text },
    workOrder: { expectedTests: 3, allowedFiles: [testFile], protectedFiles: [testFile] },
    testsExecuted: false,
    appliedToLive: false,
    draftOrigin: origin
  }
}

test('native wrong clock maximum is refused before review, preserving all four original envelopes', () => {
  for (const value of Object.values(fixture.evidence)) assert.equal(hash(value.raw), value.sha256)
  assert.equal(saved['draft-input'].callId, saved['draft-output'].callId)
  assert.equal(saved['review-input'].callId, saved['review-output'].callId)
  const p = prepared()
  assert.throws(() => draft.project(bad, p), error => error.localDraftValidation?.reason === 'case_plan_new_expected')
  assert.equal(saved['draft-output'].text, bad)
  assert.equal(p.packet.draftContract.baselineContract.requiredRows, 52)
})

test('exact owner examples require every row and reject a conflicting duplicate', () => {
  const p = prepared()
  const data = correctedData()
  assert.equal(draft.project(JSON.stringify(data), p).generated.expectedTests, 3)
  for (const mutate of [
    rows => rows.splice(4, 1),
    rows => rows.push(['Number.MAX_SAFE_INTEGER', JSON.stringify(wrongMaximum)]),
    rows => { rows[1][1] = JSON.stringify('00:09:00') }
  ]) {
    const broken = structuredClone(data)
    mutate(broken.tests.c3.groups.find(group => group.method === 'equal').rows)
    assert.throws(() => draft.project(JSON.stringify(broken), p), error => /^case_plan_new_(coverage|expected)$/.test(error.localDraftValidation?.reason))
  }
  const badProbe = structuredClone(data)
  delete badProbe.tests.c3.rejections.r1
  assert.throws(() => draft.project(JSON.stringify(badProbe), p), error => error.localDraftValidation?.reason === 'case_plan_boundary')
})

test('canonical review admission also refuses a rendered, correctly hashed wrong expectation', () => {
  const rendered = draft.project(JSON.stringify(correctedData()), prepared())
  const wrong = rendered.generated.testCode.replace(correctMaximum, wrongMaximum)
  assert.notEqual(wrong, rendered.generated.testCode)
  assert.throws(() => review.prepareCompact(reviewInput(wrong, { ...rendered.origin, renderedTestSha256: hash(wrong) })), error => error.reviewValidation?.stage === 'new_expected')
})

test('the saved PASS cannot use an old assertion as RED evidence after rebinding to the corrected control', () => {
  const projected = draft.project(JSON.stringify(correctedData()), prepared())
  const input = reviewInput(projected.generated.testCode, projected.origin)
  const packed = review.prepareCompact(input)
  const lines = packed.packet.target.files[0].lines
  const oldAnchor = lines.find(line => line.anchorId === nativeReview.baseline.anchor)
  assert.match(oldAnchor.text, /\.orderBoxes\(3,10,4\)/)
  const rebound = { ...nativeReview, binding: packed.packet.binding, summary:packed.schema.anyOf.find(v=>v.properties.verdict.const===nativeReview.verdict).properties.summary.const }
  assert.throws(() => review.parseCompact(JSON.stringify(rebound), input), error => error.reviewValidation?.stage === 'red_anchor')
  assert.deepEqual(packed.schema.anyOf.find(branch => branch.properties.verdict.const === 'pass').properties.baseline, {$ref:'#/$defs/red'})
  const expectedFailure = packed.schema.$defs.red
  const eligible = expectedFailure.properties.anchor.enum
  assert.ok(!eligible.includes(oldAnchor.anchorId))
  assert.ok(eligible.every(id => /^assert\.(?:equal|deepEqual)\(.*\.formatClockDuration\(/.test(lines.find(line => line.anchorId === id).text)))
  const genuineAnchor = lines.find(line => /^assert\.equal\(.*\.formatClockDuration\(0\)/.test(line.text)).anchorId
  const corrected = { ...rebound, baseline: { ...rebound.baseline, anchor: genuineAnchor, reason: 'The baseline lacks the requested export, so this new behavior assertion should fail.' } }
  const accepted = review.parseCompact(JSON.stringify(corrected), input)
  assert.equal(accepted.verdict, 'pass')
  assert.equal(accepted.reviewBasis.baseline.subjects[0].symbol, 'formatClockDuration')
  assert.equal(accepted.reviewBasis.coverage.flatMap(criterion => criterion.checks).length, 13)
})
