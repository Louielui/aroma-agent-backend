'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { previousInvestigation, referenceContext, compareInvestigation } = require('./continuity')
const report = (records, focus = 'work_failure') => ({ readOnly: true, focus, sections: [{ section: 'work', state: 'partial', sourceId: 'work:receipt', retrievedAt: '2026-10-07T16:00:00Z', latestFailureId: 'new-failure', records }] })
const old = () => ({ id: randomUUID(), conversationId: 'conversation1', state: 'completed', updatedAt: '2026-10-07T15:00:00Z', investigation: { ...report([{ sourceId: 'original-failure', state: 'failed', reason: 'source_dirty' }]), goal: 'Investigate the failed development task', sections: [{ ...report([]).sections[0], latestFailureId: 'original-failure', records: [{ sourceId: 'original-failure', state: 'failed', reason: 'source_dirty' }] }] } })
test('the reference comes only from the last saved assistant turn and survives receipt reopen, never from browser prose', () => {
 const r = old(), conversationStore = { get: () => ({ messages: [{ role: 'assistant', investigationRunId: r.id }] }) }
 let got = previousInvestigation({ conversationId: r.conversationId, conversationStore, receipts: { get: id => { assert.equal(id, r.id); return structuredClone(r) } } })
 assert.equal(got.state, 'available'); assert.equal(got.failureId, 'original-failure')
 assert.match(referenceContext(got), /CONTEXT, NOT CURRENT EVIDENCE/)
 assert.match(referenceContext(got), /original-failure/)
 for (const changed of [{ ...r, conversationId: 'other' }, { ...r, state: 'failed' }]) {
  got = previousInvestigation({ conversationId: r.conversationId, conversationStore, receipts: { get: () => changed } })
  assert.equal(got.state, 'unavailable'); assert.equal(referenceContext(got), null)
 }
 assert.equal(previousInvestigation({ conversationId: r.conversationId, conversationStore: { get: () => ({ messages: [{ role: 'assistant', investigationRunId: r.id }, { role: 'assistant', content: 'new unrelated topic' }] }) }, receipts: { get: () => { throw Error('must not reach older topic') } } }).state, 'absent')
})
test('fresh same-ID observations can report a change; other tasks and missing samples never prove repair', () => {
 const r = old(), p = { ...r, state: 'available', runId: r.id, focus: 'work_failure', failureId: 'original-failure' }
 const fresh = report([{ sourceId: 'new-failure', state: 'failed', reason: 'different' }, { sourceId: 'original-failure', state: 'completed', reason: null }])
 const x = compareInvestigation(fresh, p, 'previous')
 assert.equal(x.selectedRecordId, 'original-failure'); assert.equal(x.referenceRunId, r.id)
 assert.deepEqual(x.changes.map(v => [v.field, v.before, v.after]), [['state', 'failed', 'completed'], ['reason', 'source_dirty', null]])
 assert.equal(x.provesRepair, false)
 const absent = compareInvestigation(report([{ sourceId: 'new-failure', state: 'failed', reason: 'other' }]), p, 'previous')
 assert.equal(absent.selectedRecordId, 'original-failure'); assert.equal(absent.targetState, 'not_observed'); assert.deepEqual(absent.changes, [])
 assert.equal(compareInvestigation(fresh, p, null), null)
 assert.equal(compareInvestigation({ ...fresh, focus: 'background' }, p, 'previous').state, 'focus_mismatch')
 assert.equal(compareInvestigation(fresh, { state: 'unavailable' }, 'previous').state, 'reference_unavailable')
})
test('duplicate identities with conflicting fields are withheld; unknowns and unreadable sections remain unknown', () => {
 const r = old(), p = { ...r, state: 'available', runId: r.id, focus: 'work_failure', failureId: 'original-failure' }
 const x = compareInvestigation(report([{ sourceId: 'original-failure', state: 'failed', reason: 'a' }, { sourceId: 'original-failure', state: 'completed', reason: 'b' }]), p, 'previous')
 assert.equal(x.targetState, 'ambiguous'); assert.deepEqual(x.changes, [])
 const unavailable = compareInvestigation({ ...report([]), sections: [{ section: 'work', state: 'unavailable', records: [{ sourceId: 'original-failure', state: 'completed' }] }] }, p, 'previous')
 assert.equal(unavailable.targetState, 'not_observed'); assert.deepEqual(unavailable.changes, [])
})
