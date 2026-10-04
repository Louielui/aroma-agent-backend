'use strict'
const { randomUUID } = require('node:crypto')
const { ID } = require('../operating/runStore')
const { PROFILES, hash, validatePacket, validateResult } = require('./contract')
const { keys, request, definition } = require('../projectTasks/contract')
const ACTIVE = ['queued', 'reading', 'drafting', 'checking', 'coding', 'reviewing']
const OWNER = Object.freeze({ id: 'owner', role: 'owner' })
const SAFE = new Set(['source_changed', 'source_dirty', 'source_sensitive', 'source_unavailable', 'evidence_changed', 'not_enabled', 'worker_busy', 'subscription_limit_reached', 'subscription_login_required', 'subscription_unavailable', 'claude_unavailable', 'claude_max_turns', 'claude_invalid_structured_output', 'timed_out', 'worker_timeout', 'approval_unavailable', 'invalid_worker_result', 'consent_expired', 'cancelled'])
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const planHash = r => hash(JSON.stringify({ result: r.result, evidenceHash: r.evidenceHash, message: r.message, executableRecipe: r.executableRecipe, ...(r.dialogue ? { dialogue: r.dialogue } : {}) }))
// This is a bounded delegation, granted by an explicit Owner POST over the
// displayed plan hash. It consumes the existing sealed approvals; it never
// registers unreviewed tests, widens file profiles or applies changes to live.
function createConfirmedExecution ({ store, source, bootCommit, registerTask, rpc, pollMs = 2500 }) {
  const running = new Map(); let reserving = false
  const enabled = () => typeof rpc?.task === 'function' && typeof rpc?.work === 'function'
  const owner = a => { if (a?.id !== 'owner' || a.role !== 'owner') throw Error('permission_denied'); source.verify(a) }
  const save = (id, e) => { const r = store.get(id); r.execution = structuredClone(e); store.save(r); return r }
  const record = (id, e, stage, facts = {}) => { e.steps.push({ sequence: e.steps.length + 1, stage, at: new Date().toISOString(), facts }); save(id, e) }
  for (const r of store.all()) if (r.execution && ACTIVE.includes(r.execution.state)) {
    r.execution.state = 'interrupted'; r.execution.reason = 'process_restarted'; r.execution.finishedAt = new Date().toISOString()
    record(r.id, r.execution, 'interrupted', { automaticResume: false })
  }
  function checkPlan (r, input) {
    if (!r || r.state !== 'completed' || r.result?.questions?.length || !r.verification?.matched || !validateResult(r.result, r.evidence) || !Object.hasOwn(PROFILES, r.profile)) throw Error('invalid_request')
    if (input.planHash !== r.planHash || r.planHash !== planHash(r) || r.evidenceHash !== hash(JSON.stringify(r.evidence)) || r.evidence.bootCommit !== bootCommit) throw Error('evidence_changed')
  }
  async function start (actor, input) {
    owner(actor)
    if (!keys(input, ['id', 'requestId', 'planHash']) || !ID.test(input.id || '') || !ID.test(input.requestId || '') || !/^[a-f0-9]{64}$/.test(input.planHash || '')) throw Error('invalid_request')
    const r = store.get(input.id)
    if (r?.execution) {
      if (r.execution.requestId !== input.requestId || r.execution.consent.planHash !== input.planHash) throw Error('request_conflict')
      return { run: r }
    }
    if (!enabled()) throw Error('not_enabled')
    checkPlan(r, input)
    if (r.registrationPreparation || r.preparation) throw Error('request_conflict')
    if (reserving || running.size) throw Error('worker_busy')
    const taskInput = request({ bootCommit, requestId: randomUUID(), goal: r.result.goal, criteria: r.result.acceptanceChecks, editable: [...PROFILES[r.profile]] })
    reserving = true
    try {
      const packet = await source.read(actor, r.profile); validatePacket(packet, r.profile)
      if (packet.hash !== r.evidenceHash || packet.evidence.bootCommit !== bootCommit) throw Error('evidence_changed')
      checkPlan(store.get(r.id), input)
      if (store.get(r.id).execution) throw Error('request_conflict')
      const e = { requestId: input.requestId, state: 'queued', startedAt: new Date().toISOString(), finishedAt: null, reason: null, steps: [], appliedToLive: false,
        consent: { actor: 'owner', planHash: input.planHash, evidenceHash: r.evidenceHash, scope: 'isolated_development_and_tests', confirmedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(), input: taskInput },
        workRequestId: randomUUID(), taskRunId: null, workRunId: null }
      e.consentHash = hash(JSON.stringify(e.consent))
      record(r.id, e, 'owner_confirmed', { planHash: input.planHash, scope: e.consent.scope })
      const c = { stopped: false, promise: null }; running.set(r.id, c)
      c.promise = execute(r.id, e, c).finally(() => running.delete(r.id))
      return { run: store.get(r.id) }
    } finally { reserving = false }
  }
  async function execute (id, e, c) {
    const check = () => {
      owner(OWNER)
      if (c.stopped) throw Error('cancelled')
      if (Date.now() >= Date.parse(e.consent.expiresAt)) throw Error('consent_expired')
      const saved = store.get(id)
      checkPlan(saved, { planHash: e.consent.planHash })
      if (e.consentHash !== hash(JSON.stringify(e.consent)) || saved.execution?.consentHash !== e.consentHash || !equal(saved.execution.consent, e.consent)) throw Error('evidence_changed')
    }
    const call = async (lane, body) => {
      check()
      if (!['get', 'find'].includes(body.op)) record(id, e, lane + '_' + body.op + '_requested', { childId: body.id || null })
      // Persist intent before every mutation. A transport failure is uncertain,
      // not an invitation to resend a start, approval or preparation.
      let value
      try { value = await rpc[lane](body) } catch (_) { throw Error('outcome_unconfirmed') }
      if (value?.error) throw Error(SAFE.has(value.error) ? value.error : 'outcome_unconfirmed')
      if (!value?.run) throw Error('invalid_worker_result')
      return value
    }
    const pause = () => new Promise(resolve => { c.wake = resolve; c.timer = setTimeout(() => { c.wake = null; resolve() }, pollMs) })
    const observe = (child, kind) => {
      check()
      const state = child.state === 'awaiting_approval' || child.state === 'registered' ? 'checking' : child.state
      if (ACTIVE.includes(state)) e.state = state
      e.child = { kind, id: child.id, state: child.state, reason: child.reason || null, steps: child.steps || [], ...(child.generated ? { generated: child.generated } : {}), ...(child.result ? { result: child.result } : {}) }
      save(id, e)
    }
    const ticket = (value, expectedHash) => {
      const a = value.approval, expiry = typeof a?.expiresAt === 'number' ? a.expiresAt : Date.parse(a?.expiresAt)
      if (!a || a.id !== value.run.id || a.hash !== expectedHash || typeof a.nonce !== 'string' || !a.nonce || expiry <= Date.now() || !Number.isFinite(expiry)) throw Error('approval_unavailable')
      return { id: a.id, hash: a.hash, nonce: a.nonce }
    }
    const validateTask = r => {
      if (r?.id !== e.taskRunId || r.workflow !== 'project_task' || !equal(r.input, e.consent.input)) throw Error('invalid_worker_result')
    }
    const stopped = r => { e.state = r.state === 'cancelled' ? 'cancelled' : 'needs_attention'; e.reason = SAFE.has(r.reason) ? r.reason : r.state === 'needs_attention' ? 'review_changes_requested' : 'worker_stopped'; record(id, e, e.state) }
    try {
      check(); e.state = 'drafting'; record(id, e, 'drafting')
      const linked = await registerTask(OWNER, { id, ...Object.fromEntries(Object.entries(e.consent.input).filter(([k]) => k !== 'bootCommit')) })
      e.taskRunId = linked?.run?.taskRunId
      if (!ID.test(e.taskRunId || '')) throw Error('invalid_worker_result')
      save(id, e)
      let t
      for (;;) {
        t = await call('task', { op: 'get', id: e.taskRunId }); validateTask(t.run); observe(t.run, 'task')
        if (!ACTIVE.includes(t.run.state)) break
        await pause()
      }
      if (t.run.state !== 'awaiting_approval') { stopped(t.run); return }
      const d = definition(t.run.id, e.consent.input, t.run.generated)
      if (!equal(t.run.registration, d) || t.run.acceptanceReview?.verdict !== 'pass' || t.run.acceptanceReview.billing !== 'claude-subscription') throw Error('invalid_worker_result')
      const taskHash = hash(JSON.stringify({ registration: d, snapshot: t.run.snapshot, review: t.run.acceptanceReview }))
      if (taskHash !== t.run.approvalHash) throw Error('invalid_worker_result')
      check(); record(id, e, 'registration_authorized', { consentHash: e.consentHash, approvalHash: taskHash })
      const registered = await call('task', { op: 'approve', ...ticket(t, taskHash) }); validateTask(registered.run)
      if (registered.run.state !== 'registered') throw Error('invalid_worker_result')
      const prepared = await call('task', { op: 'prepare', id: e.taskRunId, requestId: e.workRequestId })
      const w = prepared.work
      e.workRunId = w?.run?.id
      // Save a known child before checking cancellation so it can be stopped.
      save(id, e); check()
      if (!ID.test(e.workRunId || '') || w.run.workflow !== 'project_work' || !equal(w.run.workOrder, d.workOrder) || w.run.requestId !== e.workRequestId || w.run.source?.evidence?.revision !== bootCommit || w.run.state !== 'awaiting_approval') throw Error('invalid_worker_result')
      record(id, e, 'coding_authorized', { consentHash: e.consentHash, approvalHash: w.run.approvalHash, registrationHash: d.workOrder.registrationHash })
      const coding = await call('work', { op: 'approve', ...ticket(w, w.run.approvalHash) })
      let value = coding
      for (;;) {
        if (value.run.id !== e.workRunId || !equal(value.run.workOrder, d.workOrder)) throw Error('invalid_worker_result')
        observe(value.run, 'work')
        if (!ACTIVE.includes(value.run.state)) break
        await pause(); value = await call('work', { op: 'get', id: e.workRunId })
      }
      const result = value.run
      if (result.state !== 'completed') { stopped(result); return }
      if (result.review?.verdict !== 'pass' || result.review.billing !== 'claude-subscription' || !result.result?.tests || result.result.tests.passed !== result.result.tests.total || result.result.tests.total !== d.workOrder.expectedTests || result.result.tests.failed !== 0 || result.result.tests.skipped !== 0 || result.result.tests.cancelled !== 0) throw Error('invalid_worker_result')
      e.state = 'completed'; record(id, e, 'completed', { tests: result.result.tests.total, appliedToLive: false })
    } catch (err) {
      e.state = c.stopped ? 'cancelled' : 'needs_attention'; e.reason = c.stopped ? 'cancelled' : SAFE.has(err.message) ? err.message : 'outcome_unconfirmed'
      // Stop only children owned by this explicit consent. No replay or broad cancellation.
      if (c.stopped || e.reason === 'consent_expired') {
        const lane = e.workRunId ? 'work' : e.taskRunId ? 'task' : null, childId = e.workRunId || e.taskRunId
        if (lane) {
          try {
            const value = await rpc[lane]({ op: 'get', id: childId })
            if (ACTIVE.includes(value?.run?.state) || value?.run?.state === 'awaiting_approval') {
              const cancelled = await rpc[lane]({ op: 'cancel', id: childId })
              if (cancelled?.error) throw Error('outcome_unconfirmed')
              let actual = cancelled
              const until = Date.now() + 10000
              while (ACTIVE.includes(actual?.run?.state) && Date.now() < until) {
                await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, 500)))
                actual = await rpc[lane]({ op: 'get', id: childId })
              }
              if (!actual?.run || actual.error || ACTIVE.includes(actual.run.state) || actual.run.state === 'awaiting_approval') throw Error('outcome_unconfirmed')
              if (actual.run.state !== 'cancelled') { e.state = 'needs_attention'; e.reason = 'cancellation_unconfirmed' }
            }
          } catch (_) { e.state = 'needs_attention'; e.reason = 'cancellation_unconfirmed' }
        } else if (store.get(id)?.registrationPreparation) { e.state = 'needs_attention'; e.reason = 'cancellation_unconfirmed' }
      }
      record(id, e, e.state, { reason: e.reason })
    } finally { e.finishedAt = new Date().toISOString(); save(id, e); clearTimeout(c.timer) }
  }
  async function cancel (actor, id) {
    owner(actor); if (!ID.test(id || '')) throw Error('invalid_request')
    const c = running.get(id)
    if (c) { c.stopped = true; clearTimeout(c.timer); c.wake?.(); await c.promise }
    return { run: store.get(id) }
  }
  return { start, cancel, enabled, wait: id => running.get(id)?.promise || Promise.resolve() }
}
module.exports = { createConfirmedExecution }
