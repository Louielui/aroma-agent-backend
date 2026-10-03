'use strict'
const { randomUUID } = require('node:crypto'), { createOwnerApprovalStore } = require('../../agent/ownerApprovalStore')
const { digest } = require('../../workers/execution/windowsSandbox'), { FILE, TEST, TESTS, WORK_ORDER } = require('./contract')
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const BOUNDARY = ['noExternalInterfaces', 'hostReadDenied', 'hostWriteDenied', 'readonlyInputDenied', 'readonlyToolsDenied', 'loopbackDenied', 'ipv6LoopbackDenied', 'internetDenied', 'cleanIdentity', 'secretsAbsent']
const boundaryValid = e => e?.engine === 'windows-sandbox-offline-v1' && Object.keys(e.boundary || {}).length === 10 && BOUNDARY.every(k => e.boundary[k] === true)
const owner = actor => { if (actor?.id !== 'owner' || actor.role !== 'owner') throw Error('permission_denied') }
function validateAccepted (run, isolated) {
  const result = run?.result, c = result?.changes?.[0]
  if (!run?.source?.evidence || !result || !c || !isolated?.workOrder?.files) throw Error('accepted_evidence_changed')
  if (run?.state !== 'completed' || run.workOrder?.recipe !== WORK_ORDER.recipe || run.review?.verdict !== 'pass' || run.review.billing !== 'claude-subscription' ||
      run.appliedToLive !== false || result?.appliedToLive !== false || result?.model !== 'gpt-6.1-sol' || result.billing !== 'chatgpt-subscription' ||
      result.changes?.length !== 1 || c?.file !== FILE || typeof c.before !== 'string' || typeof c.after !== 'string' || !c.after || c.before === c.after ||
      digest(c.before) !== c.beforeHash || digest(c.after) !== c.afterHash || digest(JSON.stringify(result.changes)) !== result.patchHash ||
      Buffer.byteLength(c.before) > 100000 || Buffer.byteLength(c.after) > 100000 || run.source.evidence.sourceFiles?.length !== 1 || run.source.evidence.acceptanceFiles?.length !== 1 ||
      run.source.evidence.sourceFiles?.[0]?.path !== FILE || run.source.evidence.acceptanceFiles?.[0]?.path !== TEST ||
      run.source.evidence.sourceFiles?.[0]?.sha256 !== c.beforeHash || run.source.evidence.acceptanceFiles?.[0]?.sha256 !== digest(TESTS) ||
      isolated?.state !== 'accepted_isolated' || isolated.id !== result.isolatedRunId || isolated.patchHash !== result.patchHash ||
      JSON.stringify(isolated.changes) !== JSON.stringify(result.changes) || isolated.workOrder.files[TEST] !== TESTS || isolated.workOrder.files[FILE] !== c.before ||
      isolated.workOrder.sourceRevision !== run.source.evidence.revision) throw Error('accepted_evidence_changed')
  for (const evidence of [result.tests, isolated.tests]) if (evidence?.total !== 8 || evidence.passed !== 8 || evidence.failed !== 0 || evidence.exitCode !== 0 ||
    evidence.skipped !== 0 || evidence.cancelled !== 0 || !boundaryValid(evidence)) throw Error('accepted_evidence_changed')
  return { before: c.before, after: c.after, patchHash: result.patchHash, evidenceHash: digest(JSON.stringify({ run, isolated })) }
}
function createAdoption ({ source, repository, executor, work, isolated, store, loader, enabled, onEvent = () => {}, approvals = createOwnerApprovalStore() }) {
  let busy = false, pending = Promise.resolve(), refreshing = null
  const sessions = new Map(), active = new Set(['queued', 'testing', 'applying'])
  function record (r, stage, facts = {}) {
    const at = new Date().toISOString(); r.steps.push({ stage, at, facts }); store.save(r)
    try { onEvent({ id: r.id, stage, at, state: r.state, action: r.action, workRunId: r.workRunId, facts }) } catch (_) { /* Normal memory receipt failure is separate. */ }
  }
  for (const r of store.all()) if (r.state === 'awaiting_approval' || active.has(r.state)) { const inspectionRequired = active.has(r.state); r.state = 'interrupted'; r.reason = 'process_restarted'; record(r, 'interrupted', { automaticResume: false, inspectionRequired }) }
  async function reconcile () {
    if (busy) return
    for (const r of store.all().filter(r => r.state === 'awaiting_restart')) {
      try {
        r.loaded = await repository.verifyLoaded(r); r.state = 'completed'; r.finishedAt = new Date().toISOString()
        record(r, 'completed', { action: r.action, commit: r.commit, workRunId: r.workRunId, appliedToLive: r.action === 'adopt', bootCommit: r.loaded.bootCommit })
      } catch (_) { /* Old boot or source drift does not report adoption complete. */ }
    }
  }
  function refresh () { if (!refreshing) refreshing = reconcile().finally(() => { refreshing = null }); return refreshing }
  async function prepare (actor, input) {
    owner(actor)
    if (!enabled()) throw Error('not_enabled')
    if (!input || Object.keys(input).sort().join(',') !== 'action,bootCommit,requestId,runId' || !ID.test(input.requestId || '') || !ID.test(input.runId || '') || !['adopt', 'rollback'].includes(input.action)) throw Error('invalid_request')
    if (busy) throw Error('worker_busy')
    if (store.all().some(r => r.state === 'awaiting_restart' || active.has(r.state))) throw Error('reload_pending')
    const existing = store.all().find(r => r.requestId === input.requestId)
    if (existing) { if (existing.workRunId !== input.runId || existing.action !== input.action || existing.source.evidence.bootCommit !== input.bootCommit) throw Error('request_conflict'); return { run: existing, approval: null } }
    busy = true
    try {
      const original = work.get(actor, input.runId), accepted = validateAccepted(original, await isolated(original?.result?.isolatedRunId))
      const snapshot = await source.read(input.bootCommit)
      const before = input.action === 'adopt' ? accepted.before : accepted.after, after = input.action === 'adopt' ? accepted.after : accepted.before
      if (snapshot.order.files[FILE] !== before) throw Error('source_changed')
      if (input.action === 'rollback' && !store.all().some(r => r.workRunId === input.runId && r.action === 'adopt' && r.state === 'completed')) throw Error('rollback_unavailable')
      const id = randomUUID(), hash = digest(JSON.stringify({ action: input.action, runId: input.runId, snapshot, accepted, before, after }))
      const sealed = approvals.seal({ workOrder: { approvalId: id, workOrderHash: hash, snapshot, accepted, action: input.action, runId: input.runId, before, after }, proposalId: id })
      if (!sealed.ok) throw Error('approval_unavailable')
      const session = approvals.createSession(); sessions.set(id, session)
      const r = { id, workflow: 'project_adoption', action: input.action, state: 'awaiting_approval', startedAt: new Date().toISOString(), workRunId: input.runId,
        requestId: input.requestId, source: snapshot, accepted, before, after, approvalHash: hash, expiresAt: sealed.record.expiresAt,
        steps: [], sections: [], commit: null, change: null, appliedToLive: false, rollbackAvailable: false }
      record(r, 'prepared', { action: r.action, parentCommit: snapshot.evidence.revision, patchHash: accepted.patchHash })
      return { run: r, approval: { id, hash, nonce: approvals.issueNonce({ approvalId: id, workOrderHash: hash, sessionId: session }), expiresAt: r.expiresAt } }
    } finally { busy = false }
  }
  async function execute (r) {
    try {
      if (!enabled()) throw Error('not_enabled')
      const original = work.get({ id: 'owner', role: 'owner' }, r.workRunId)
      const current = validateAccepted(original, await isolated(original?.result?.isolatedRunId))
      if (current.evidenceHash !== r.accepted.evidenceHash) throw Error('accepted_evidence_changed')
      await source.verify(r.source)
      r.state = 'testing'; record(r, 'testing')
      const pack = { files: { [FILE]: r.after, [TEST]: TESTS }, tests: [TEST], expectedTests: 8 }
      r.tests = await executor.run(pack)
      const expectedPass = r.action === 'adopt' ? 8 : 3, expectedFail = 8 - expectedPass
      if (r.tests.total !== 8 || r.tests.passed !== expectedPass || r.tests.failed !== expectedFail || r.tests.exitCode !== (expectedFail ? 1 : 0) || r.tests.skipped !== 0 || r.tests.cancelled !== 0 ||
          !boundaryValid(r.tests)) throw Error('acceptance_failed')
      record(r, 'tests_verified', { passed: expectedPass, failed: expectedFail, rollbackRestoresOriginalBehavior: r.action === 'rollback' })
      await source.verify(r.source)
      if (!enabled()) throw Error('not_enabled')
      r.state = 'applying'; record(r, 'write_authorized', { parentCommit: r.source.evidence.revision, patchHash: r.accepted.patchHash, file: FILE })
      r.change = await repository.apply({ snapshot: r.source, before: r.before, after: r.after, id: r.id, action: r.action })
      r.commit = r.change.commit; r.appliedToLive = r.action === 'adopt'; r.rollbackAvailable = r.action === 'adopt'
      r.state = 'awaiting_restart'; record(r, 'commit_created', r.change)
      try { await loader(r); record(r, 'reload_requested', { protectionBypassed: false }) }
      catch (_) { r.reloadError = 'administrator_reload_required'; record(r, 'reload_required', { protectionBypassed: false }) }
    } catch (e) {
      r.state = 'failed'; r.reason = ['source_changed', 'source_dirty', 'accepted_evidence_changed', 'acceptance_failed', 'repository_unavailable', 'adoption_inspection_required', 'sandbox_stop_unconfirmed'].includes(e.message) ? e.message : 'adoption_unavailable'
      record(r, 'failed', { reason: r.reason, commit: r.commit, inspectionRequired: r.reason === 'adoption_inspection_required' })
    } finally { busy = false }
  }
  function approve (actor, input) {
    owner(actor)
    if (!enabled()) throw Error('not_enabled')
    if (!input || Object.keys(input).sort().join(',') !== 'hash,id,nonce') throw Error('invalid_request')
    if (busy || executor.isBusy()) throw Error('worker_busy')
    if (store.all().some(r => r.state === 'awaiting_restart' || active.has(r.state))) throw Error('reload_pending')
    const r = store.get(input.id), sessionId = sessions.get(input.id), sealed = approvals.loadSealed(input.id)
    if (!r || r.state !== 'awaiting_approval' || !sealed.ok || !approvals.validSession(sessionId) || !approvals.consumeNonce({ nonce: input.nonce, approvalId: input.id, displayedHash: input.hash, sessionId }).ok || r.approvalHash !== input.hash) throw Error('approval_unavailable')
    const w = sealed.record.workOrder
    if (digest(JSON.stringify({ action: r.action, runId: r.workRunId, snapshot: r.source, accepted: r.accepted, before: r.before, after: r.after })) !== input.hash) throw Error('approval_unavailable')
    Object.assign(r, { source: structuredClone(w.snapshot), accepted: structuredClone(w.accepted), action: w.action, workRunId: w.runId, before: w.before, after: w.after })
    r.state = 'queued'; record(r, 'approved', { actor: 'owner', hash: input.hash }); busy = true
    pending = Promise.resolve().then(() => execute(r)).catch(() => { /* Failed audit: stop, no silent retry. */ })
    return r
  }
  function cancel (actor, id) {
    owner(actor); const r = store.get(id)
    if (!r || r.state !== 'awaiting_approval') throw Error('invalid_request')
    sessions.delete(id); r.state = 'cancelled'; record(r, 'cancelled'); return r
  }
  function reload (actor, id) {
    owner(actor); const r = store.get(id)
    if (!enabled() || !r || r.state !== 'awaiting_restart' || busy) throw Error('invalid_request')
    busy = true
    pending = Promise.resolve().then(() => loader(r)).then(() => record(r, 'reload_requested', { protectionBypassed: false })).catch(() => { r.reloadError = 'administrator_reload_required'; record(r, 'reload_required', { protectionBypassed: false }) }).finally(() => { busy = false })
    return r
  }
  return { prepare, approve, cancel, reload, refresh, list: actor => { owner(actor); return store.all().sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 25) },
    get: (actor, id) => { owner(actor); return store.get(id) }, settled: () => pending, isActive: () => busy || store.all().some(r => r.state === 'awaiting_restart'), enabled }
}
module.exports = { createAdoption, validateAccepted }
