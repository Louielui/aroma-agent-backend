'use strict'
const { randomUUID } = require('node:crypto')
const { createOwnerApprovalStore } = require('../../agent/ownerApprovalStore')
const { digest } = require('../../workers/execution/windowsSandbox')
const { PROJECT, RECIPES, recipe } = require('./contract')
const browserEvidence = require('../../workers/execution/browserEvidence')
const ACTIVE = new Set(['awaiting_approval', 'queued', 'checking', 'coding', 'reviewing'])
const ERRORS = new Set(['source_changed', 'source_dirty', 'source_sensitive', 'source_unavailable', 'approval_unavailable', 'not_enabled', 'worker_busy', 'worker_cancelled', 'baseline_not_red', 'acceptance_failed', 'subscription_limit_reached', 'subscription_model_unavailable', 'subscription_unavailable', 'sandbox_stop_unconfirmed', 'sandbox_recovery_or_work_pending', 'provider_not_ready', 'invalid_worker_result', 'claude_unavailable', 'claude_max_turns', 'claude_invalid_structured_output', 'worker_timeout', 'visual_evidence_unavailable', 'invalid_visual_review', 'accepted_evidence_changed'])
const owner = actor => { if (actor?.id !== 'owner' || actor.role !== 'owner') throw Error('permission_denied') }
function createProjectWork ({ source, providers, store, enabled, onEvent = () => {}, approvals = createOwnerApprovalStore(), resolveRecipe = recipe, catalogueRecipes = () => Object.values(RECIPES) }) {
  const sessions = new Map(), controllers = new Map()
  let busy = false, pending = Promise.resolve()
  const all = () => store.all()
  const list = actor => { owner(actor); return all().sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 25) }
  const record = (r, stage, facts = {}) => {
    const at = new Date().toISOString(); r.steps.push({ sequence: r.steps.length + 1, stage, at, facts }); store.save(r)
    try { onEvent({ id: r.id, stage, at, state: r.state, recipe: r.workOrder.recipe, facts }) } catch (_) { /* Normal memory outbox reports failure independently. */ }
  }
  for (const r of all()) if (ACTIVE.has(r.state)) { r.state = 'interrupted'; r.reason = 'process_restarted'; r.finishedAt = new Date().toISOString(); record(r, 'interrupted', { automaticResume: false }) }
  async function prepare (actor, input) {
    owner(actor)
    if (!enabled()) throw Error('not_enabled')
    if (!input || Object.keys(input).sort().join(',') !== 'bootCommit,projectId,recipe,requestId' || input.projectId !== PROJECT || typeof input.recipe !== 'string' || !/^[a-f0-9-]{36}$/.test(input.requestId || '')) throw Error('invalid_request')
    const WORK_ORDER = resolveRecipe(input.recipe).workOrder
    if (WORK_ORDER.registeredRevision && WORK_ORDER.registeredRevision !== input.bootCommit) throw Error('source_changed')
    if (busy) throw Error('worker_busy')
    const old = all().find(r => r.requestId === input.requestId)
    if (old) { if (old.source?.evidence.bootCommit !== input.bootCommit || old.workOrder.recipe !== input.recipe) throw Error('request_conflict'); return { run: old, approval: null } }
    busy = true
    try {
      const snapshot = await source.read(input.bootCommit, undefined, input.recipe)
      const id = randomUUID(), session = approvals.createSession()
      const hash = digest(JSON.stringify({ workOrder: WORK_ORDER, snapshot }))
      const sealed = approvals.seal({ workOrder: { approvalId: id, workOrderHash: hash, snapshot, definition: WORK_ORDER }, proposalId: id })
      if (!sealed.ok) throw Error('approval_unavailable')
      const nonce = approvals.issueNonce({ approvalId: id, workOrderHash: hash, sessionId: session })
      sessions.set(id, session)
      const r = { id, workflow: 'project_work', state: 'awaiting_approval', startedAt: new Date().toISOString(), requestId: input.requestId,
        actor: 'owner', workOrder: WORK_ORDER, source: { evidence: snapshot.evidence, hash: snapshot.hash }, approvalHash: hash,
        expiresAt: sealed.record.expiresAt, steps: [], sections: [], result: null, appliedToLive: false }
      record(r, 'prepared', { sourceRevision: snapshot.evidence.revision, approvalHash: hash })
      return { run: r, approval: { id, hash, nonce, expiresAt: r.expiresAt } }
    } finally { busy = false }
  }
  async function execute (r, snapshot, signal) {
    const WORK_ORDER = resolveRecipe(r.workOrder.recipe).workOrder
    try {
      r.state = 'checking'; record(r, 'checking')
      if (!enabled()) throw Error('not_enabled')
      await source.verify(snapshot, signal)
      const isolation = await providers.isolation()
      if (!isolation.ready) throw Error(isolation.reason || 'provider_not_ready')
      r.providers = await providers.status()
      if (!r.providers.codex?.ready || !r.providers.claude?.ready) throw Error('provider_not_ready')
      r.state = 'coding'; record(r, 'coding')
      const coding = await providers.codeOrder({ order: snapshot.order, signal, verify: () => source.verify(snapshot, signal), emit: (stage, facts) => record(r, stage, facts) })
      await source.verify(snapshot, signal)
      if (WORK_ORDER.effort && (!Array.isArray(coding?.changes) || JSON.stringify(coding.changes.map(c => c.file).sort()) !== JSON.stringify(WORK_ORDER.allowedFiles.slice().sort()) ||
          coding.changes.some(c => c.before !== snapshot.order.files[c.file] || typeof c.after !== 'string' || !c.after || c.before === c.after || digest(c.before) !== c.beforeHash || digest(c.after) !== c.afterHash) || digest(JSON.stringify(coding.changes)) !== coding.patchHash)) throw Error('invalid_worker_result')
      if (coding?.model !== 'gpt-6.1-sol' || coding.billing !== 'chatgpt-subscription' || coding.execution !== 'windows_sandbox_offline' || coding.appliedToLive !== false ||
          JSON.stringify(coding.changedFiles?.slice().sort()) !== JSON.stringify(WORK_ORDER.allowedFiles.slice().sort()) || coding.baseline?.failed < 1 || coding.baseline?.total !== WORK_ORDER.expectedTests ||
          coding.tests?.exitCode !== 0 || coding.tests?.total !== WORK_ORDER.expectedTests || coding.tests?.passed !== WORK_ORDER.expectedTests || coding.tests?.failed !== 0 ||
          coding.tests?.skipped !== 0 || coding.tests?.cancelled !== 0 || !/^[a-f0-9]{64}$/.test(coding.patchHash || '') || !Array.isArray(coding.changes) || coding.changes.length !== WORK_ORDER.allowedFiles.length || (WORK_ORDER.effort && coding.effort !== WORK_ORDER.effort)) throw Error('invalid_worker_result')
      if (WORK_ORDER.protectedFiles.includes(browserEvidence.TEST) && !browserEvidence.complete(coding.tests.browser)) throw Error('invalid_worker_result')
      r.result = coding
      if (signal.aborted) throw Error('worker_cancelled')
      r.state = 'reviewing'; record(r, 'reviewing')
      r.review = await providers.reviewOrder({ workOrder: WORK_ORDER, ...coding }, { signal, emit: (stage, facts) => record(r, stage, facts) })
      if (signal.aborted) throw Error('worker_cancelled')
      await source.verify(snapshot, signal)
      if (!['pass', 'changes_requested'].includes(r.review?.verdict)) throw Error('invalid_worker_result')
      if (coding.design && r.review.verdict === 'pass') require('../../design/visualReview').verifyReceipt(r.review.visual, coding, coding.design)
      r.state = r.review.verdict === 'pass' ? 'completed' : 'needs_attention'; r.finishedAt = new Date().toISOString()
      record(r, r.state, { sourceRevision: snapshot.evidence.revision, patchHash: coding.patchHash, tests: coding.tests.total, appliedToLive: false })
    } catch (e) {
      if (e.safeDiagnostics) r.failureDiagnostic = { exitCode: Number.isInteger(e.safeDiagnostics.exitCode) ? e.safeDiagnostics.exitCode : null,
        parsedJson: e.safeDiagnostics.parsedJson === true, subtype: ['success', 'error_max_turns', 'error_during_execution', 'error_max_budget_usd', 'error_max_structured_output_retries'].includes(e.safeDiagnostics.subtype) ? e.safeDiagnostics.subtype : 'unknown',
        stdoutBytes: Number.isInteger(e.safeDiagnostics.stdoutBytes) ? e.safeDiagnostics.stdoutBytes : null, stderrBytes: Number.isInteger(e.safeDiagnostics.stderrBytes) ? e.safeDiagnostics.stderrBytes : null }
      r.state = signal.aborted ? 'cancelled' : 'failed'; r.reason = ERRORS.has(e.code || e.message) ? (e.code || e.message) : 'worker_unavailable'; r.finishedAt = new Date().toISOString()
      record(r, r.state, { reason: r.reason, appliedToLive: false })
    } finally { busy = false; controllers.delete(r.id) }
  }
  function approve (actor, input) {
    owner(actor)
    if (!enabled()) throw Error('not_enabled')
    if (!input || Object.keys(input).sort().join(',') !== 'hash,id,nonce') throw Error('invalid_request')
    if (busy) throw Error('worker_busy')
    const r = store.get(input.id), sealed = approvals.loadSealed(input.id), sessionId = sessions.get(input.id)
    if (!r || r.state !== 'awaiting_approval' || !sealed.ok || !approvals.validSession(sessionId) || !approvals.consumeNonce({ nonce: input.nonce, approvalId: input.id, displayedHash: input.hash, sessionId }).ok) throw Error('approval_unavailable')
    const w = sealed.record.workOrder
    if (r.approvalHash !== input.hash || digest(JSON.stringify({ workOrder: r.workOrder, snapshot: w.snapshot })) !== input.hash || JSON.stringify(r.source) !== JSON.stringify({ evidence: w.snapshot.evidence, hash: w.snapshot.hash })) throw Error('approval_unavailable')
    r.workOrder = structuredClone(w.definition)
    r.state = 'queued'; record(r, 'approved', { actor: 'owner', hash: input.hash })
    busy = true; const controller = new AbortController(); controllers.set(r.id, controller)
    pending = Promise.resolve().then(() => execute(r, w.snapshot, controller.signal)).catch(() => { /* Audit persistence failed; no further work or implicit retry. */ })
    return r
  }
  function cancel (actor, id) {
    owner(actor); const r = store.get(id)
    if (!r || !ACTIVE.has(r.state)) throw Error('invalid_request')
    const controller = controllers.get(id)
    if (controller) { controller.abort(); return r }
    r.state = 'cancelled'; r.finishedAt = new Date().toISOString(); sessions.delete(id); record(r, 'cancelled'); return r
  }
  return { prepare, approve, cancel, list, get: (actor, id) => { owner(actor); return store.get(id) }, browser: (actor, id, name) => { owner(actor); return browserEvidence.screenshot(store.get(id)?.result?.tests, name) }, settled: () => pending,
    isActive: () => busy, catalogue: actor => { owner(actor); return { enabled: enabled(), workOrders: catalogueRecipes().map(r => r.workOrder), limits: ['other_projects', 'dependency_installation', 'general_chat_dispatch', 'automatic_live_application'] } } }
}
module.exports = { createProjectWork }
