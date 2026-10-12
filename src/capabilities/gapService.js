'use strict'
const { randomUUID } = require('node:crypto')
const { ID, createMemoryRunStore } = require('../core/operating/runStore')
const { isValidId } = require('../store/conversationStore')
const { hash, keys, text, validGap, registeredScope, proposalFor } = require('./gapContract')
const OWNER = Object.freeze({ id: 'owner', role: 'owner' })
const TTL = 24 * 60 * 60 * 1000
const uuidFor = h => [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20, 32)].join('-')
const seal = r => hash([r.version, r.originalGoal, r.gap, r.proposal, r.revision, r.conversationId, r.createdAt, r.model, r.effort, ...(r.readRequest ? [r.readRequest] : [])])
const confirmation = s => /^(?:好|好的|可以|同意|批准|確認|yes|ok|okay)[。.!！\s]*$/iu.test(s.trim()) || require('../core/taskPlanner/boundPlan').confirmation(s) || /^(?:批准建立開發任務|建立這項開發任務|approve this development proposal)[。.!！\s]*$/iu.test(s.trim())
function loadedProof (records, workRunId, bootCommit) {
  if (!ID.test(workRunId || '') || !/^[a-f0-9]{40}$/.test(bootCommit || '')) return null
  const r = records.find(r => r.workRunId === workRunId && r.action === 'adopt' && r.state === 'completed' && r.appliedToLive === true &&
    r.loaded?.bootCommit === bootCommit && r.commit === bootCommit && Number.isInteger(r.tests?.total) && r.tests.total > 0 &&
    r.tests.passed === r.tests.total && r.tests.failed === 0 && r.tests.exitCode === 0 && r.tests.skipped === 0 && r.tests.cancelled === 0)
  return r ? { state: 'verified', workRunId, bootCommit } : null
}
function createGapService ({ store = createMemoryRunStore(), conversations, revision, planner, verifyLoaded = async () => null, resumeOriginal = null, now = Date.now }) {
  const pending = new Map()
  const owner = a => { if (a?.id !== 'owner' || a.role !== 'owner') throw Error('permission_denied') }
  function record (r, stage, facts = {}) { r.steps.push({ sequence: r.steps.length + 1, stage, at: new Date(now()).toISOString(), facts }); store.save(r) }
  function checked (id) {
    if (!ID.test(id || '')) throw Error('invalid_request')
    const r = store.get(id)
    if (!r || ![1,2,3].includes(r.version) || !validGap(r.gap) || r.proposalHash !== seal(r) || JSON.stringify(r.proposal) !== JSON.stringify(proposalFor(r.originalGoal, r.gap, r.language,r.version))) throw Error('proposal_unavailable')
    return r
  }
  function latest (r) {
    const last = conversations.get(r.conversationId)?.messages?.at(-1)
    if (last?.role !== 'assistant' || last.capabilityGapRunId !== r.id) throw Error('conversation_changed')
  }
  function view (r) {
    return structuredClone({ id: r.id, version: r.version, state: r.state, reason: r.reason || null, originalGoal: r.originalGoal, gap: r.gap,
      proposal: r.proposal, proposalHash: r.proposalHash, revision: r.revision, conversationId: r.conversationId, createdAt: r.createdAt,
      taskPlanRunId: r.taskPlanRunId || null, developmentTask: r.developmentTask || null, steps: r.steps,
      resumeResult: r.resumeResult || null, replacementRunId:r.replacementRunId || null, language: r.language, ...(r.readRequest ? {readRequest:r.readRequest} : {}) })
  }
  function offer (actor, input) {
    owner(actor)
    if (!keys(input, ['conversationId', 'requestId', 'message', 'gap', 'model', 'effort', ...(Object.hasOwn(input || {},'readRequest') ? ['readRequest'] : [])]) || !isValidId(input.conversationId) || !ID.test(input.requestId || '') || !text(input.message, 2000) || !validGap(input.gap) ||
      !require('../subscription/chatModels').isBrainModel(input.model) || !require('../subscription/chatModels').REASONING_EFFORTS.includes(input.effort)) throw Error('invalid_request')
    const identity = hash(input), prior = store.all().find(r => r.requestId === input.requestId)
    if (prior) { if (prior.identity !== identity) throw Error('request_conflict'); return view(checked(prior.id)) }
    const language = /[\u3400-\u9fff]/u.test(input.message) ? 'zh' : 'en'
    const version = input.gap.capability === 'seven_shifts.read' && require('../context/sevenShiftsReport').clockOutRequest(input.message) ? 3 : 2
    if (input.readRequest) {
      if (version !== 3 || !keys(input.readRequest,['window','dates']) || input.readRequest.window !== 'dates') throw Error('invalid_request')
      require('../context/sevenShiftsReport').queryWindow(input.readRequest,new Date(now()).toISOString())
    }
    const r = { id: randomUUID(), version, workflow: 'capability_gap', requestId: input.requestId, identity, conversationId: input.conversationId,
      originalGoal: input.message, gap: structuredClone(input.gap), proposal: proposalFor(input.message, input.gap, language,version), language, revision,
      model: input.model, effort: input.effort, state: 'awaiting_approval', createdAt: new Date(now()).toISOString(), steps: [], sections: [], ...(input.readRequest ? {readRequest:structuredClone(input.readRequest)} : {}) }
    r.proposalHash = seal(r); record(r, 'gap_observed', { kind: r.gap.kind }); record(r, 'proposal_prepared', { registeredScope: !!r.proposal.scope })
    return view(r)
  }
  function append (r, message, reply) {
    conversations.appendTurn({ id: r.conversationId, userText: message, replyText: reply, capabilityGapRunId: r.id })
  }
  function receiptReply (r) {
    const zh = r.language === 'zh'
    if (r.state === 'awaiting_scope_registration') return zh ? '已建立補強開發任務，保留原要求與驗收條件。目前仍待登記固定開發範圍，尚未派工或取得新權限。' : 'The remediation development task is saved with the original request and acceptance criteria. A fixed scope must still be registered; nothing was dispatched and no privileges were added.'
    if (r.state === 'development_planning') return zh ? '已交給現有規劃流程核對已登記範圍。查看方案後可批准開發；原問題已保留。' : 'The registered scope is being checked by the existing planner. Review its plan before approving development; the original request is saved.'
    if (r.state === 'completed') return zh ? '已重新以唯讀方式核對原問題，結果如下。' : 'The original request was rechecked in read-only mode. The result is below.'
    return zh ? '補強任務已保留；請查看目前階段及待處理項目。' : 'The remediation task is saved. Check its current stage and remaining requirements.'
  }
  async function approve (actor, input, message = '批准建立開發任務') {
    owner(actor)
    if (!keys(input, ['id', 'conversationId', 'hash']) || !isValidId(input.conversationId) || !/^[a-f0-9]{64}$/.test(input.hash || '')) throw Error('invalid_request')
    let r = checked(input.id)
    if (r.conversationId !== input.conversationId || r.proposalHash !== input.hash) throw Error('proposal_changed')
    latest(r)
    if (r.approval) return { run: view(r), replayed: true }
    if (r.state !== 'awaiting_approval' || r.revision !== revision || now() - Date.parse(r.createdAt) >= TTL || now() < Date.parse(r.createdAt)) throw Error('proposal_stale')
    const scope = registeredScope(r.gap,r.originalGoal,r.version)
    if (JSON.stringify(scope) !== JSON.stringify(r.proposal.scope)) throw Error('proposal_changed')
    r.approval = { hash: r.proposalHash, actor: 'owner', at: new Date(now()).toISOString(), permission: 'development_handoff_only' }
    r.developmentTask = { id: uuidFor(hash([r.id, r.proposalHash, 'development'])), goal: scope ? require('./scopeRegistry').remediationGoal(scope,r.originalGoal,r.version) : r.originalGoal, steps: r.proposal.steps, criteria: r.proposal.criteria,
      scope, state: scope ? 'planning_pending' : 'awaiting_scope_registration', originalRequest: { conversationId: r.conversationId, goal: r.originalGoal },
      exclusions: ['new_credentials', 'new_permissions', 'business_writes', 'automatic_adoption', 'arbitrary_commands'] }
    r.state = scope ? 'handoff_pending' : 'awaiting_scope_registration'
    record(r, 'owner_approved', { hash: r.proposalHash, permission: 'development_handoff_only' })
    if (scope) {
      try {
        if (!planner) throw Error('planning_unavailable')
        // Scope is host-selected; the model still must inspect committed source.
        // This approval does not consume the later plan's coding or adoption approval.
        const planningMessage = require('./scopeRegistry').planningMessage(scope)
        const context = require('../core/taskPlanner/dialogueContext').seal({version:1,profile:scope.profile,revision,conversationId:r.conversationId,
          createdAt:new Date(now()).toISOString(),ownerRequests:[planningMessage,r.developmentTask.goal],proposals:[JSON.stringify({originalGoal:r.originalGoal,diagnosis:r.proposal.diagnosis,steps:r.proposal.steps,criteria:r.proposal.criteria,scope})],language:r.language})
        const dialogue = {context,contextDigest:context.digest,ownerRequests:context.ownerRequests,proposals:context.proposals,confirmation:message,language:r.language}
        const job = planner.start(OWNER, { message:planningMessage, dialogue, conversationId: r.conversationId,
          requestId: r.developmentTask.id, model: r.model, effort: r.effort })
        if (!ID.test(job?.id || '') || job.profile !== scope.profile) throw Error('planning_unavailable')
        r.taskPlanRunId = job.id; r.state = 'development_planning'; r.developmentTask.state = 'planning'
        record(r, 'development_handoff', { taskPlanRunId: job.id })
      } catch (_) { r.state = 'needs_attention'; r.reason = 'handoff_unconfirmed'; record(r, 'handoff_unconfirmed', { automaticRetry: false }) }
    }
    append(r, message, receiptReply(r))
    return { run: view(r) }
  }
  function candidate (message, id) {
    if (!text(message, 2000) || !confirmation(message) || !isValidId(id)) return false
    const last = conversations.get(id)?.messages?.at(-1)
    return last?.role === 'assistant' && ID.test(last.capabilityGapRunId || '')
  }
  async function confirm (actor, message, id) {
    if (!candidate(message, id)) return null
    const r = checked(conversations.get(id).messages.at(-1).capabilityGapRunId)
    const result = await approve(actor, { id: r.id, conversationId: id, hash: r.proposalHash }, message)
    return { lane: 'chat', mode: 'chat', reply: receiptReply(result.run), capabilityGapRunId: r.id, capabilityGapResolution: result.run, historySaved: true, servedBy: null }
  }
  function developmentPlan (r) {
    let plan = planner.get(OWNER, r.taskPlanRunId)
    const visited = new Set([r.taskPlanRunId])
    while (plan?.updatedPlanRunId) {
      const id = plan.updatedPlanRunId
      if (!ID.test(id) || visited.has(id) || visited.size >= 16) throw Error('capability_unverified')
      const next = planner.get(OWNER, id)
      // A replan is an explicit Owner operation. Follow its saved link only
      // when it retains this exact business goal and registered scope. The new
      // plan still needs its own coding approval and loaded adoption proof.
      if (!next || next.id !== id || next.conversationId !== r.conversationId || plan.conversationId !== r.conversationId ||
          next.profile !== r.proposal.scope?.profile || next.profile !== plan.profile || next.message !== plan.message ||
          next.model !== plan.model || next.effort !== plan.effort || !plan.dialogue || !next.dialogue ||
          JSON.stringify(next.dialogue.ownerRequests) !== JSON.stringify(plan.dialogue.ownerRequests) ||
          JSON.stringify(next.dialogue.proposals) !== JSON.stringify(plan.dialogue.proposals)) throw Error('capability_unverified')
      visited.add(id); plan = next
    }
    return plan
  }
  function get (actor, id) {
    owner(actor); const r = checked(id)
    if (r.taskPlanRunId && planner) {
      try {
        const plan = developmentPlan(r)
        r.development = plan ? { state: plan.execution?.state || plan.state, workRunId: plan.execution?.workRunId || plan.workRunId || null, taskPlanRunId: plan.id || r.taskPlanRunId } : { state: 'unavailable', workRunId: null }
      } catch (_) { r.development = { state: 'unavailable', workRunId: null } }
    }
    return { ...view(r), scopeRefreshAvailable:r.state === 'awaiting_scope_registration' && !!registeredScope(r.gap,r.originalGoal,2) && !r.replacementRunId,
      ...(r.development ? { development: r.development } : {}) }
  }
  function refreshScope (actor, input) {
    owner(actor)
    if (!keys(input,['id','conversationId','hash']) || !isValidId(input.conversationId)) throw Error('invalid_request')
    const old = checked(input.id)
    if (old.conversationId !== input.conversationId || old.proposalHash !== input.hash) throw Error('proposal_changed')
    const attachRefresh = row => append(row,row.language === 'zh' ? '更新補強方案' : 'Refresh remediation scope',row.language === 'zh' ? '固定唯讀開發範圍已登記。請核對新方案；舊批准不會套用到新增範圍。' : 'A fixed read-only development scope is now registered. Review the new proposal; prior approval does not cover the new scope.')
    if (old.replacementRunId) {
      const row = checked(old.replacementRunId)
      if (row.conversationId !== old.conversationId || row.originalGoal !== old.originalGoal) throw Error('proposal_changed')
      // A crash between saving the replacement and attaching its card is recoverable
      // without any model call. Do not attach over a newer Owner conversation turn.
      const last = conversations.get(old.conversationId)?.messages?.at(-1)
      if (last?.role === 'assistant' && last.capabilityGapRunId === old.id) attachRefresh(row)
      return {run:get(actor,row.id),replayed:true}
    }
    latest(old)
    if (old.state !== 'awaiting_scope_registration' || !registeredScope(old.gap,old.originalGoal,2)) throw Error('scope_unavailable')
    // New files/revision => a new proposal hash and NEW approval. Never upgrade
    // the old receipt into authority or repeat paid planning after a lost response.
    const next = offer(actor,{conversationId:old.conversationId,requestId:uuidFor(hash([old.id,old.proposalHash,revision,'scope-refresh'])),
      message:old.originalGoal,gap:old.gap,model:old.model,effort:old.effort})
    old.replacementRunId = next.id; record(old,'scope_proposal_refreshed',{replacementRunId:next.id,approvalTransferred:false})
    const row = checked(next.id)
    attachRefresh(row)
    return {run:view(row)}
  }
  async function status (actor, id) {
    const v = get(actor, id)
    v.resumeAvailable = false
    if (v.development?.state === 'completed' && !v.resumeResult) {
      try {
        const p = await verifyLoaded({workRunId:v.development.workRunId,scope:v.proposal.scope})
        v.resumeAvailable = !!p && p.state === 'verified' && /^[a-f0-9]{40}$/.test(p.bootCommit || '') && p.bootCommit !== v.revision && p.workRunId === v.development.workRunId
      } catch (_) { v.verificationState = 'unavailable' }
    }
    return v
  }
  function resume (actor, input) {
    owner(actor)
    if (!keys(input, ['id', 'conversationId', 'hash', 'requestId']) || !ID.test(input.requestId || '')) throw Error('invalid_request')
    if (pending.has(input.id)) {
      const job = pending.get(input.id)
      if (job.requestId !== input.requestId || job.identity !== hash(input)) throw Error('request_conflict')
      return job.promise
    }
    const promise = Promise.resolve().then(() => resumeOnce(actor, input)).finally(() => pending.delete(input.id))
    pending.set(input.id, { requestId: input.requestId, identity: hash(input), promise }); return promise
  }
  async function resumeOnce (actor, input) {
    let r = checked(input.id)
    if (r.conversationId !== input.conversationId || r.proposalHash !== input.hash || r.approval?.hash !== r.proposalHash) throw Error('proposal_changed')
    latest(r)
    if (r.resumeRequestId) {
      if (r.resumeRequestId !== input.requestId) throw Error('request_conflict')
      if (r.resumeResult) return { run: view(r), result: r.resumeResult, replayed: true }
      throw Error('resume_unconfirmed')
    }
    if (!r.taskPlanRunId || !planner || typeof resumeOriginal !== 'function') throw Error('capability_unverified')
    const plan = developmentPlan(r), workRunId = plan?.execution?.workRunId || plan?.workRunId
    if (!ID.test(workRunId || '') || plan?.execution?.state !== 'completed') throw Error('capability_unverified')
    const proof = await verifyLoaded({ workRunId, scope: r.proposal.scope })
    if (!proof || proof.state !== 'verified' || !/^[a-f0-9]{40}$/.test(proof.bootCommit || '') || proof.bootCommit === r.revision || proof.workRunId !== workRunId) throw Error('capability_unverified')
    latest(r)
    r.resumeRequestId = input.requestId; r.state = 'resuming'; record(r, 'original_read_requested', { workRunId, bootCommit: proof.bootCommit, businessWrites: false })
    const work = (async () => {
      try {
        const result = await resumeOriginal({ message: r.originalGoal, conversationId: r.conversationId, model: r.model, effort: r.effort, requestId: input.requestId, ...(r.readRequest ? {readRequest:structuredClone(r.readRequest)} : {}) })
        if (!result || !text(result.reply, 50000) || result.proposals?.length || result.tasks?.length || result.decision || !['chat', 'ask', 'recommend'].includes(result.mode)) throw Error('resume_unconfirmed')
        r.resumeResult = { reply: result.reply, mode: result.mode, capabilityGap: result.capabilityGap || null }
        r.state = result.capabilityGap || result.mode === 'ask' ? 'needs_attention' : 'completed'; r.reason = result.capabilityGap ? 'gap_still_present' : result.mode === 'ask' ? 'original_request_needs_clarification' : null
        let attach = true
        try { latest(r) } catch (e) { if (e.message !== 'conversation_changed') throw e; attach = false }
        record(r, result.capabilityGap ? 'gap_still_present' : 'original_read_completed', { writes: false, historyAttachment: attach ? 'current_turn' : 'original_card_only' })
        if (attach) append(r, r.language === 'zh' ? '接續原問題（唯讀）' : 'Continue original request (read-only)', result.reply)
        return { run: view(r), result: r.resumeResult }
      } catch (_) { r.state = 'needs_attention'; r.reason = 'resume_unconfirmed'; record(r, 'resume_unconfirmed', { automaticRetry: false }); throw Error('resume_unconfirmed') }
    })()
    return work
  }
  return { offer, approve, refreshScope, get, status, resume, candidate, confirm }
}
module.exports = { createGapService, confirmation, loadedProof }
