'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { promptEvaluation } = require('./promptPack')

test('cost prompt retains uncertainty and bounded linkage without repeating invocation rows', () => {
  const findings = [{ kind: 'charge_unverified', sourceId: 'billing:one', evidenceState: 'not_established' }]
  for (let i = 0; i < 28; i++) findings.push({ kind: 'invocation_attempt_observed', sourceId: 'execution:one', recordId: `invocation:${i}`, value: { role: 'memory_completion', state: 'succeeded', detail: 'repeated receipt '.repeat(30) } })
  findings.push({ kind: 'candidate_link', sourceId: 'execution:one', recordId: 'invocation:linked', value: { basis: 'user_declared_heartbeat_id_only' } })
  const report = { focus: 'cost', plan: { goal: 'Where did credits go?' }, findings, findingsOmitted: 40, gaps: [{ section: 'billing', state: 'unconnected', sourceId: 'billing:one' }], contradictions: [], transitions: [], evaluationScope: 'bounded', continuity: null }
  const packed = promptEvaluation(report)
  assert.equal(report.findings.length, 30, 'the full report is not changed')
  assert.deepEqual(packed.findings.map(f => f.kind), ['charge_unverified', 'candidate_link'])
  assert.equal(packed.findingKindCounts.invocation_attempt_observed, 28)
  assert.equal(packed.findingsOmittedFromPrompt, 68)
  assert.equal(packed.gaps[0].state, 'unconnected')
  assert.ok(JSON.stringify(packed).length < 2000)
})
