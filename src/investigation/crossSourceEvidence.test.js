'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { appendCrossSourceEvidence, compareCostEvidence, renderCostEvidenceComparison } = require('./crossSourceEvidence')

const requestId = 'req-1234567890abcdef'
const invocationId = 'inv-1234567890abcdef'
function report () {
  return { readOnly: true, focus: 'cost', plan: { sources: ['execution'] }, gaps: [], sections: [
    { section: 'execution', sourceId: 'execution:sample', state: 'partial', records: [
      { sourceId: 'call:one', evidenceBasis: 'owner_bridge_invocation_ledger', requestId, invocationId,
        startedAt: '2026-10-08T12:00:00Z', usage: { outputTokens: 120 } }
    ] }
  ] }
}
function read (content, { fallback = false, unavailable = false } = {}) {
  return { perSource: [{ source: 'gmail', trust: unavailable ? 'unavailable' : 'live', usedFallback: fallback }],
    itemsBySource: unavailable ? [] : [{ source: 'gmail', items: [{ sourceId: 'mail:one', title: 'Provider notice',
      content, originalDate: '2026-10-08T12:10:00Z', retrievedAt: '2026-10-08T13:00:00Z', fields: { from: 'provider@example.test' } }] }],
    evidenceSets: [] }
}

test('an exact shared request ID is only a possible lead and retains both receipt identities', () => {
  const r = report()
  appendCrossSourceEvidence(r, read('Request ' + requestId + ' has a usage notice.'))
  const comparison = compareCostEvidence(r)
  assert.equal(comparison.state, 'possible_identifier_link')
  assert.equal(comparison.links.length, 1)
  assert.deepEqual(comparison.links[0], { mailSourceId: 'read-context:gmail', mailRecordId: 'mail:one',
    executionSourceId: 'execution:sample', executionRecordId: 'call:one', matchedField: 'requestId',
    mailField: 'content', matchedId: requestId, usageReported: true, evidenceState: 'possible',
    basis: 'exact_identifier_mentioned_in_untrusted_mail_text', provesCharge: false })
  assert.equal(r.sections.at(-1).records[0].originalDate, '2026-10-08T12:10:00Z')
  assert.equal(comparison.billingConfirmed, false)
  assert.match(renderCostEvidenceComparison(comparison, { message: '對照扣款' }), /可能線索.*不能證明實際扣款/)
})

test('recent fallback and nearby times without a shared ID do not become evidence of linkage', () => {
  const r = report()
  appendCrossSourceEvidence(r, read('A generic notice close in time to the call.', { fallback: true }))
  const comparison = compareCostEvidence(r)
  assert.equal(comparison.state, 'no_shared_identifier_in_sample')
  assert.equal(comparison.mailSelection, 'recency_fallback')
  assert.equal(comparison.sampledInvocationUsageCount, 1)
  assert.deepEqual(comparison.links, [])
  const answer = renderCostEvidenceComparison(comparison, { message: '查 credit' })
  assert.match(answer, /關鍵字搜尋未命中/)
  assert.match(answer, /不能推論未取樣的紀錄也沒有關聯/)
})

test('substring mention, failed read and non-owner report cannot manufacture a link', () => {
  const r = report()
  appendCrossSourceEvidence(r, read('prefix' + requestId + 'suffix'))
  assert.equal(compareCostEvidence(r).links.length, 0)
  const failed = report()
  appendCrossSourceEvidence(failed, read('', { unavailable: true }))
  assert.equal(compareCostEvidence(failed).state, 'mail_unavailable')
  assert.equal(compareCostEvidence({ ...r, readOnly: false }), null)
})
