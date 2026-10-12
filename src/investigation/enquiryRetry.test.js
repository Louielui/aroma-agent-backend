'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { createEnquiryOffer } = require('./enquiryOffer')
test('only a saved failed enquiry can prepare a fresh approval; retry cards can be reopened without execution', () => {
  const run = { state: 'completed', investigation: { goal: 'Cost question', sections: [{}] }, enquiryApprovalId: 'appr_old' }
  const original = { id: 'p_old', sourceTaskId: 'investigation:run', status: 'confirmed', task: 'Existing goal', linkState: 'ready' }, rows = [original]
  let saved = null
  const proposals = {
    getProposal: id => rows.find(p => p.id === id), findBySourceTaskId: id => rows.find(p => p.sourceTaskId === id),
    createBridgeProposal: value => { const p = { ...value, id: 'p_retry', status: 'pending', linkState: 'ready' }; rows.push(p); return p }
  }
  const offer = createEnquiryOffer({ receipts: { get: () => run }, proposals, findSavedEnquiry: () => saved })
  assert.throws(() => offer.prepare('run'), /already_requested/)
  saved = { approvalId: 'appr_old', outcome: 'CONCLUDED' }; assert.throws(() => offer.prepare('run'), /already_requested/)
  saved = { approvalId: 'appr_wrong', outcome: 'FAILED' }; assert.throws(() => offer.prepare('run'), /already_requested/)
  saved = { approvalId: 'appr_old', outcome: 'FAILED' }
  const retry = offer.prepare('run'); assert.notEqual(retry.proposalId, original.id); assert.equal(retry.previousApprovalId, 'appr_old')
  assert.equal(original.status, 'confirmed'); assert.equal(saved.outcome, 'FAILED'); assert.equal(rows.length, 2)
  run.enquiryProposalId = retry.proposalId; run.enquiryApprovalId = 'appr_new'; saved = null
  assert.equal(offer.prepare('run').proposalId, retry.proposalId); assert.equal(rows.length, 2)
  rows[1].status = 'confirmed'; assert.throws(() => offer.prepare('run'), /already_requested/)
})
