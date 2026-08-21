'use strict'

/**
 * agentRecovery.test.js — P1-C1c. What a restart may conclude about an Agent Bridge
 * execution, and what it must refuse to conclude.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE MEASURED FAULT THIS FIXES. On the live machine there is one durable
 * agent-audit record with ok:true — a real execution that really succeeded — and four
 * Runs, every one of them marked RECONCILED_PENDING: 「never started」. Recovery read
 * only the worker's artifacts, so the Agent lane's evidence sat on disk unread and the
 * canonical ledger said the opposite of what had happened.
 *
 * ⛔ AND THE FIX MUST NOT BECOME A GUESSING MACHINE. Every branch added here only ever
 * concludes from evidence that states an outcome. Where evidence is missing the answer
 * is INTERRUPTED, and where two durable sources disagree the answer is also
 * INTERRUPTED — never the more convenient of the two.
 *
 * Pure derivation + injected artifact readers. ZERO I/O of its own, ZERO execution.
 *
 *   Run: node --test src/run/agentRecovery.test.js
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { deriveRecoveredStatus, matchAgentAudit, MARK } = require('./recovery')
const { createRunStore, AGENT_EXECUTOR } = require('./store')

const at = '2026-08-19T00:00:00.000Z'
const runWith = (...stages) => ({
  id: 'run_x',
  timeline: [{ stage: 'TASK_CREATED', at, facts: {} }].concat(
    stages.map(s => (typeof s === 'string' ? { stage: s, at, facts: {} } : { stage: s.stage, at, facts: s.facts }))
  )
})
const AUDIT = (ok, over = {}) => ({ id: 'aud_1', kind: 'agent-audit', runId: 'run_x', approvalId: 'appr_a1', ok, ...over })

function tmpFile () { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-arec-')); return path.join(d, 'aroma-runs.json') }
const INPUT = (o = {}) => ({ task: 't', targetProject: 'backend', capabilityId: 'Develop', version: 1, ...o })

/* ═══ the crash bridge: AGENT_FINISHED ═════════════════════════════════════ */

test('*** crash AFTER AGENT_FINISHED(ok:true), BEFORE SUCCEEDED → recovered SUCCEEDED ***', () => {
  // The load-bearing window. The runner returned, the Run recorded WHAT it returned,
  // and the process died before the terminal landed. That is recoverable from the Run
  // alone — no artifact, no memory, no audit required.
  const out = deriveRecoveredStatus({ run: runWith('AGENT_CLAIMED', 'AGENT_SELECTED', 'AGENT_RUNNING', { stage: 'AGENT_FINISHED', facts: { ok: true } }) })
  assert.equal(out.status, 'succeeded')
  assert.equal(out.mark, MARK.succeeded)
})

test('*** crash AFTER AGENT_FINISHED(ok:false), BEFORE FAILED → recovered FAILED ***', () => {
  const out = deriveRecoveredStatus({ run: runWith('AGENT_CLAIMED', { stage: 'AGENT_FINISHED', facts: { ok: false } }) })
  assert.equal(out.status, 'failed')
  assert.equal(out.mark, MARK.failed)
})

test('*** an AGENT_FINISHED with no boolean outcome is NOT evidence — it falls through ***', () => {
  // A Develop AGENT_FINISHED carries no `ok` at all. Reading it loosely would fold a
  // missing value into a confident verdict.
  const out = deriveRecoveredStatus({ run: runWith('AGENT_CLAIMED', { stage: 'AGENT_FINISHED', facts: {} }) })
  assert.equal(out.status, 'interrupted', 'no stated outcome → human-gated, not succeeded')
})

/* ═══ the audit as durable evidence ════════════════════════════════════════ */

test('*** crash BEFORE AGENT_FINISHED, matching audit ok:true → recovered SUCCEEDED ***', () => {
  const out = deriveRecoveredStatus({ run: runWith('AGENT_CLAIMED', 'AGENT_RUNNING'), agentAudit: AUDIT(true) })
  assert.equal(out.status, 'succeeded')
})

test('*** matching audit ok:false → recovered FAILED ***', () => {
  const out = deriveRecoveredStatus({ run: runWith('AGENT_CLAIMED', 'AGENT_RUNNING'), agentAudit: AUDIT(false) })
  assert.equal(out.status, 'failed')
})

test('*** an audit whose ok is absent or not a boolean is treated as unreadable ***', () => {
  for (const bad of [AUDIT(null), AUDIT(undefined), AUDIT('true'), AUDIT(1)]) {
    const out = deriveRecoveredStatus({ run: runWith('AGENT_CLAIMED'), agentAudit: bad })
    assert.equal(out.status, 'interrupted', 'unreadable evidence is not a verdict')
  }
})

/* ═══ the claim alone ══════════════════════════════════════════════════════ */

test('*** ⛔ AGENT_CLAIMED WITH NOTHING ELSE IS INTERRUPTED, NEVER PENDING ***', () => {
  // This is the exact case the live data got wrong. A durable claim means an attempt
  // MAY have started and MAY have touched a workspace; 「never started」 is the one
  // answer the evidence rules out.
  const out = deriveRecoveredStatus({ run: runWith('AGENT_CLAIMED') })
  assert.equal(out.status, 'interrupted')
  assert.equal(out.mark, MARK.interrupted)
  assert.notEqual(out.status, 'pending')
})

test('*** a Run with no claim and no evidence is still PENDING (unchanged) ***', () => {
  assert.equal(deriveRecoveredStatus({ run: runWith() }).status, 'pending')
})

/* ═══ contradiction ════════════════════════════════════════════════════════ */

test('*** ⛔ AGENT_FINISHED(ok:true) vs audit(ok:false) → INTERRUPTED, never succeeded ***', () => {
  const out = deriveRecoveredStatus({
    run: runWith('AGENT_CLAIMED', { stage: 'AGENT_FINISHED', facts: { ok: true } }),
    agentAudit: AUDIT(false)
  })
  assert.equal(out.status, 'interrupted', '⛔ disagreement resolved in favour of success is the worst guess available')
})

test('*** ⛔ AGENT_FINISHED(ok:false) vs audit(ok:true) → INTERRUPTED, not failed either ***', () => {
  const out = deriveRecoveredStatus({
    run: runWith('AGENT_CLAIMED', { stage: 'AGENT_FINISHED', facts: { ok: false } }),
    agentAudit: AUDIT(true)
  })
  assert.equal(out.status, 'interrupted', 'no winner is invented in either direction')
})

test('*** ⛔ AGENT EVIDENCE BESIDE A WORKER RESULT IS INCONSISTENT STATE → INTERRUPTED ***', () => {
  const agentRun = runWith('AGENT_CLAIMED', { stage: 'AGENT_FINISHED', facts: { ok: true } })
  assert.equal(deriveRecoveredStatus({ run: agentRun, execution: { id: 'exec_1' }, result: { ok: true } }).status, 'interrupted')
  assert.equal(deriveRecoveredStatus({ run: agentRun, execution: { id: 'exec_1' } }).status, 'interrupted')
  assert.equal(deriveRecoveredStatus({ run: runWith('AGENT_CLAIMED'), agentAudit: AUDIT(true), result: { ok: true } }).status, 'interrupted')
})

/* ═══ Develop / Worker semantics unchanged ═════════════════════════════════ */

test('*** the Develop and Worker branches are byte-for-byte the same behaviour ***', () => {
  assert.equal(deriveRecoveredStatus({ run: runWith('DISPATCH_CLAIMED') }).status, 'interrupted')
  assert.equal(deriveRecoveredStatus({ run: runWith('WORKER_CLAIMED') }).status, 'interrupted')
  assert.equal(deriveRecoveredStatus({ run: runWith('DISPATCH_CLAIMED'), execution: { id: 'e' } }).status, 'interrupted')
  assert.equal(deriveRecoveredStatus({ run: runWith('DISPATCH_CLAIMED'), execution: { id: 'e' }, result: { ok: true } }).status, 'succeeded')
  assert.equal(deriveRecoveredStatus({ run: runWith('DISPATCH_CLAIMED'), execution: { id: 'e' }, result: { ok: false } }).status, 'failed')
})

/* ═══ reconcile: the store-level integration ═══════════════════════════════ */

function agentRunAt (file, stagesToAppend, approvalId = 'appr_a1') {
  const store = createRunStore({ dispatcher: async () => {}, authorizeDispatch: () => false, persistence: file })
  const id = store.startRun(INPUT({ approvalId }))
  // RB1: a claim must name its repository or the store refuses it (needs_review), which
  // would silently leave these fixtures with no Agent lane at all.
  store.claimAgent(id, { approvalId, workOrderHash: 'h1', projectId: 'aroma-agent-backend', repoFullName: 'Louielui/aroma-agent-backend' })
  for (const s of stagesToAppend) store.appendAgentStage(id, s.stage, s.facts)
  return { store, id }
}

test('*** reconcile marks a crashed-after-AGENT_FINISHED Run SUCCEEDED from the Run alone ***', () => {
  const file = tmpFile()
  const { id } = agentRunAt(file, [{ stage: 'AGENT_FINISHED', facts: { ok: true, approvalId: 'appr_a1' } }])
  const after = createRunStore({ dispatcher: async () => {}, persistence: file })
  assert.equal(after.reconcile({}).reconciled, 1, 'no artifact reader needed at all')
  assert.ok(after.getRun(id).timeline.some(e => e.stage === 'RECONCILED_SUCCEEDED'))
})

test('*** reconcile uses a runId-matched audit when the Run never recorded the outcome ***', () => {
  const file = tmpFile()
  const { id } = agentRunAt(file, [])
  const after = createRunStore({ dispatcher: async () => {}, persistence: file })
  const reconciled = after.reconcile({ findAgentAudit: (runId) => (runId === id ? { runId, ok: true } : null) })
  assert.equal(reconciled.reconciled, 1)
  assert.ok(after.getRun(id).timeline.some(e => e.stage === 'RECONCILED_SUCCEEDED'))
})

test('*** ⛔ AN AUDIT FOR A DIFFERENT RUN IS NEVER BORROWED ***', () => {
  const file = tmpFile()
  const { id } = agentRunAt(file, [])
  const after = createRunStore({ dispatcher: async () => {}, persistence: file })
  // The reader is asked about THIS runId and honestly has nothing for it.
  after.reconcile({ findAgentAudit: (runId) => (runId === 'run_someone_else' ? { runId, ok: true } : null) })
  const t = after.getRun(id).timeline
  assert.ok(t.some(e => e.stage === 'RECONCILED_INTERRUPTED'), 'a claim with no evidence of its own is interrupted')
  assert.equal(t.some(e => e.stage === 'RECONCILED_SUCCEEDED'), false, '⛔ someone else’s success was adopted')
})

test('*** ⛔ A LEGACY AUDIT WITH NO runId CANNOT BE ATTACHED TO ANY RUN ***', () => {
  // The real historical record: approvalId appr_c793ed1b, runId absent. There is no
  // honest way to decide which Run it belongs to, so it belongs to none of them.
  const file = tmpFile()
  const { id } = agentRunAt(file, [])
  const legacyAudits = [{ id: 'aud_old', approvalId: 'appr_c793ed1b', ok: true }] // no runId key
  const after = createRunStore({ dispatcher: async () => {}, persistence: file })
  after.reconcile({ findAgentAudit: (runId) => legacyAudits.filter(a => a.runId === runId)[0] || null })
  assert.ok(after.getRun(id).timeline.some(e => e.stage === 'RECONCILED_INTERRUPTED'))
  assert.equal(after.getRun(id).timeline.some(e => e.stage === 'RECONCILED_SUCCEEDED'), false)
})

/* ═══ matching an audit to a Run ═══════════════════════════════════════════ */

test('*** matchAgentAudit returns the record whose runId is exactly this Run ***', () => {
  const audits = [{ id: 'a1', runId: 'run_a', ok: true }, { id: 'a2', runId: 'run_b', ok: false }]
  assert.equal(matchAgentAudit('run_a', audits).id, 'a1')
  assert.equal(matchAgentAudit('run_b', audits).id, 'a2')
})

test('*** ⛔ A LEGACY AUDIT WITH NO runId IS NEVER MATCHED TO ANYTHING ***', () => {
  // The real record on the live machine: approvalId appr_c793ed1b, ok true, no runId.
  const legacy = [{ id: 'aud_old', approvalId: 'appr_c793ed1b', ok: true }]
  assert.equal(matchAgentAudit('run_a', legacy), null)
  assert.equal(matchAgentAudit('run_anything', legacy), null)
  // ...and it is not rescued by a blank or missing runId on the asking side either.
  assert.equal(matchAgentAudit('', legacy), null)
  assert.equal(matchAgentAudit(null, legacy), null)
  assert.equal(matchAgentAudit(undefined, legacy), null)
})

test('*** ⛔ AN AUDIT BELONGING TO ANOTHER RUN IS NEVER BORROWED ***', () => {
  assert.equal(matchAgentAudit('run_mine', [{ id: 'a', runId: 'run_theirs', ok: true }]), null)
})

test('*** two audits for one Run is inconsistent — neither is chosen ***', () => {
  const dup = [{ id: 'a1', runId: 'run_a', ok: true }, { id: 'a2', runId: 'run_a', ok: false }]
  assert.equal(matchAgentAudit('run_a', dup), null, '⛔ picking either would settle a contradiction unseen')
})

test('*** a malformed audit list can never produce a match ***', () => {
  for (const bad of [null, undefined, 'nope', {}, [null], [undefined]]) {
    assert.equal(matchAgentAudit('run_a', bad), null)
  }
})

test('*** a Run that already settled live is skipped by reconcile ***', () => {
  const file = tmpFile()
  const { id } = agentRunAt(file, [
    { stage: 'AGENT_FINISHED', facts: { ok: true, approvalId: 'appr_a1' } },
    { stage: 'SUCCEEDED', facts: { executor: AGENT_EXECUTOR, approvalId: 'appr_a1' } }
  ])
  const after = createRunStore({ dispatcher: async () => {}, persistence: file })
  assert.equal(after.reconcile({}).reconciled, 0, 'terminal means settled — nothing to recover')
  assert.equal(after.getRun(id).timeline.filter(e => String(e.stage).startsWith('RECONCILED_')).length, 0)
})

test('*** reconcile is a MARK — it never dispatches, spawns or retries ***', () => {
  const file = tmpFile()
  const { id } = agentRunAt(file, [])
  let dispatched = 0
  const after = createRunStore({ dispatcher: async () => { dispatched++ }, authorizeDispatch: () => true, persistence: file })
  after.reconcile({ findAgentAudit: () => ({ runId: id, ok: false }) })
  assert.equal(dispatched, 0, 'zero execution during recovery')
})
