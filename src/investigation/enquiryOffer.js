'use strict'
const FILE = 'src/context/adapters/xiangxiangOperationsRead.js'
const IDENTITY = Object.freeze({ projectId: 'aroma-agent-backend', repoFullName: 'Louielui/aroma-agent-backend' })
// This registered profile explains this investigation's coverage. It cannot grant a
// model arbitrary repository access, change settings, or establish actual charges.
function createEnquiryOffer ({ receipts, proposals, findSavedEnquiry = () => null }) {
  return { prepare (id) {
    const run = receipts.get(id)
    if (!run || run.state !== 'completed' || !run.investigation?.sections?.length) throw Error('investigation_not_ready')
    let sourceTaskId = 'investigation:' + id
    let p = run.enquiryProposalId ? proposals.getProposal(run.enquiryProposalId) : proposals.findBySourceTaskId(sourceTaskId)
    if (run.enquiryProposalId && !p) throw Error('investigation_enquiry_already_requested')
    if (p && p.status !== 'pending') {
      const saved = run.enquiryApprovalId && findSavedEnquiry(run.enquiryApprovalId)
      if (p.status !== 'confirmed' || saved?.outcome !== 'FAILED' || saved.approvalId !== run.enquiryApprovalId) throw Error('investigation_enquiry_already_requested')
      sourceTaskId += ':after:' + run.enquiryApprovalId
      p = proposals.findBySourceTaskId(sourceTaskId)
      if (p && p.status !== 'pending') throw Error('investigation_enquiry_already_requested')
    }
    const goal = '核對這次調查的程式來源：' + String(run.investigation.goal || run.reply || '').slice(0, 1200) + '\n說明哪些資料有讀取、範圍限制與缺少的證據。程式碼不能證明實際執行或扣款。'
    if (!p) p = proposals.createBridgeProposal({ repositoryIdentity: IDENTITY, sourceTaskId, task: goal, sourceTaskProvenance: { source: 'saved_investigation', investigationId: id, previousApprovalId: run.enquiryApprovalId || null } })
    if (p.linkState !== 'ready') p = proposals.setLinkState(p.id, 'ready')
    return { previousApprovalId: run.enquiryApprovalId || null, proposalId: p.id, goal: p.task, candidateFile: FILE, conversation: [FILE], taskKind: 'read_only_enquiry', intendedChange: 'Read the approved source snapshot and save a cited answer; no changes.' }
  } }
}
module.exports = { createEnquiryOffer, FILE }
