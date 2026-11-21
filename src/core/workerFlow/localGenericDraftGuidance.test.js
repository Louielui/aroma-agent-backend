'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const saved = require('../../../test/localBrain/fixtures/generic-draft-guidance-v1.json')
const draft = require('./localTestDraft')
const review = require('./localTestReview')

const file = 'acceptance/registered-task.test.cjs'
const wire = JSON.parse(JSON.parse(saved.inputRaw).messages.find(message => message.role === 'user').content)
const original = JSON.parse(saved.outputRaw).text
const raw = JSON.parse(original)
const callee = 'require("../src/topics/publicAnswerFollowupIntent.js").requestKind'
const imports = "const test = require('node:test')\nconst assert = require('node:assert/strict')\n"
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

function fixtureTests (alias = false) {
  const groups = raw.testCode.split(/\/\/ Criterion \d: [^\n]*\n/).slice(1)
  assert.deepEqual(groups.map(group => group.trim().split('\n').length), [3, 7, 3])
  const bindings = alias ? "const {requestKind} = require('../src/topics/publicAnswerFollowupIntent.js')\n" : ''
  const body = groups.map((group, index) => {
    const lines = group.trim().split('\n').map(line => '  ' + (alias ? line : line.replace('requestKind(', callee + '(')))
    return ['test("criterion ' + (index + 1) + '", () => {', ...lines, '})'].join('\n')
  })
  return { testCode: imports + bindings + body.join('\n'), expectedTests: 3 }
}

test('generic JavaScript guidance requires the executable imports, fixed top-level calls and selected callee', () => {
  const prepared = draft.prepare(JSON.stringify(wire))
  assert.deepEqual(prepared.packet, wire)
  assert.equal(prepared.packet.draftContract.casePlan, undefined)
  assert.match(prepared.system, /const test = require\('node:test'\)/)
  assert.match(prepared.system, /const assert = require\('node:assert\/strict'\)/)
  assert.match(prepared.system, /exactly 3 fixed top-level test\(\) calls/)
  assert.match(prepared.system, /comments and bare assertions do not count/i)
  assert.match(prepared.system, /copy the exact callee from draftContract\.assertionForm\.subjects into the assertion/i)
  assert.ok(prepared.packet.draftContract.assertionForm.subjects.some(subject => subject.callee === callee))
  assert.match(prepared.schema.properties.testCode.description, /exactly 3 fixed top-level test\(\) calls/)
  assert.match(prepared.schema.properties.testCode.description, /directly inside each assertion/)
  assert.equal(prepared.schema.properties.expectedTests.const, 3)
  const four = draft.prepare(JSON.stringify({ ...wire, criteria: [...wire.criteria, 'Preserve existing requestKind normalization.'] }))
  assert.match(four.system, /exactly 4 fixed top-level test\(\) calls/)
  assert.match(four.schema.properties.testCode.description, /exactly 4 fixed top-level test\(\) calls/)
})

test('the saved refusal and the alias-only control still fail without rewriting model output', () => {
  assert.equal(digest(saved.inputRaw), saved.inputSha256)
  assert.equal(digest(saved.outputRaw), saved.outputSha256)
  const prepared = draft.prepare(JSON.stringify(wire))
  assert.equal(raw.expectedTests, 3)
  assert.doesNotMatch(raw.testCode, /node:test|\btest\s*\(/)
  assert.throws(() => draft.project(original, prepared), error => error.localDraftValidation?.reason === 'contract')
  assert.throws(() => draft.project(JSON.stringify(fixtureTests(true)), prepared), error => error.localDraftValidation?.reason === 'assertion_form')
  const candidate = fixtureTests()
  assert.deepEqual(draft.project(JSON.stringify(candidate), prepared), { generated: candidate, origin: null })
  assert.equal(digest(saved.outputRaw), saved.outputSha256)
})

test('a synthetic direct-call draft preserves all thirteen literals and the new question RED anchor', () => {
  const prepared = draft.prepare(JSON.stringify(wire))
  const { generated } = draft.project(JSON.stringify(fixtureTests()), prepared)
  const input = { workOrder: { allowedFiles: [file], protectedFiles: [file], expectedTests: 3 }, ownerGoal: wire.goal,
    acceptanceCriteria: wire.criteria, source: wire.files, protectedTests: { [file]: generated.testCode }, testsExecuted: false, appliedToLive: false }
  const packet = review.prepareCompact(input)
  const assertions = packet.packet.target.files[0].lines.filter(line => line.kind === 'assertion' && line.subjects.length)
  assert.equal(assertions.length, 13)
  assert.ok(assertions.every(line => line.text.includes(callee)))
  assert.deepEqual(packet.packet.criteria.map(criterion => criterion.checks.length), [3, 7, 3])
  const red = assertions[10]
  assert.ok(red.text.includes(callee + "('Which parts are missing?'), 'inspect'"))
  const response = { binding: packet.packet.binding, verdict: 'pass',
    summary: 'Static review passed. Tests were not run. Baseline RED expected.', findings: [],
    coverage: packet.packet.criteria.map((criterion, index) => ({ criterion: criterion.id, status: 'covered',
      checks: criterion.checks.map((check, offset) => ({ id: check.id, status: 'covered',
        anchors: [assertions[[0, 3, 10][index] + offset].anchorId], reason: 'Synthetic protocol check for the exact literal pair.' })) })),
    baseline: { anchor: red.anchorId, expectation: 'expected_failure', reason: 'The unchanged requestKind returns null for this question, so the comparison with inspect is expected to fail.' } }
  const result = review.parseCompact(JSON.stringify(response), input)
  assert.equal(result.reviewBasis.baseline.quote, red.text)
  assert.equal(result.reviewBasis.baseline.line, red.line)
  assert.equal(result.reviewBasis.coverage.flatMap(criterion => criterion.checks).length, 13)
  assert.throws(() => review.parseCompact(JSON.stringify({ ...response, binding: '0'.repeat(64) }), input), /invalid_worker_result/)
})
