'use strict'

/**
 * run.test.js — unit tests for the Run and Run Timeline model.
 *
 * Uses the built-in Node test runner (node:test), no extra dependencies.
 *   Run: node --test src/run/
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const run = require('./run')
const { createRun, appendStage, deriveStatus, getRun, isTerminal } = run

/** Drive a Run through the full happy path and return its id. */
function happyPath () {
  const r = createRun({ owner: 'louie', task: 'add a field to /health', targetProject: 'backend' })
  appendStage(r.id, 'POLICY_EVALUATED', { verdict: 'require_approval', rule_id: 'prod-deploy-approval' })
  appendStage(r.id, 'AGENT_SELECTED', { agentId: 'claude-code' })
  appendStage(r.id, 'AGENT_RUNNING', {})
  appendStage(r.id, 'AGENT_FINISHED', { cost: '$', latencyMs: 1200 })
  appendStage(r.id, 'PATCH_READY', { patchPath: '/tmp/patch.diff' })
  appendStage(r.id, 'PENDING_APPROVAL', {})
  appendStage(r.id, 'APPLYING', { approvedBy: 'louie' })
  appendStage(r.id, 'COMPLETED', { backupRef: 'bak_123' })
  return r.id
}

test('createRun requires an owner', () => {
  assert.throws(() => createRun({ task: 'no owner' }), TypeError)
  assert.throws(() => createRun({ owner: '' }), TypeError)
})

test('createRun rejects a targetProject of production', () => {
  assert.throws(() => createRun({ owner: 'louie', targetProject: 'production' }), RangeError)
  // a bogus target is rejected too; backend/frontend are accepted
  assert.throws(() => createRun({ owner: 'louie', targetProject: 'staging' }), RangeError)
  assert.equal(createRun({ owner: 'louie', targetProject: 'backend' }).targetProject, 'backend')
  assert.equal(createRun({ owner: 'louie', targetProject: 'frontend' }).targetProject, 'frontend')
})

test('goal and conversationId may be null, and defaults are applied', () => {
  const r = createRun({ owner: 'louie', goal: null, conversationId: null })
  assert.equal(r.goal, null)
  assert.equal(r.conversationId, null)
  assert.equal(r.workspace, 'default') // single default workspace
  assert.equal(r.targetProject, 'backend') // default target project
  // there is no stored status field on the Run
  assert.equal('status' in r, false)
})

test('a happy path sequence of stages is accepted in order', () => {
  const id = happyPath()
  const stored = getRun(id)
  const stages = stored.timeline.map(e => e.stage)
  assert.deepEqual(stages, [
    'TASK_CREATED', 'POLICY_EVALUATED', 'AGENT_SELECTED', 'AGENT_RUNNING',
    'AGENT_FINISHED', 'PATCH_READY', 'PENDING_APPROVAL', 'APPLYING', 'COMPLETED'
  ])
})

test('an unknown stage name throws', () => {
  const r = createRun({ owner: 'louie' })
  assert.throws(() => appendStage(r.id, 'NOT_A_STAGE', {}), RangeError)
})

test('nothing can be appended after any terminal stage', () => {
  for (const terminal of run.TERMINAL_STAGES) {
    const r = createRun({ owner: 'louie' })
    // Reach the terminal stage supplying whatever facts it needs.
    // P1-C1c adds SUCCEEDED, whose required fact is `executor` (COMPLETED keeps backupRef).
    const facts = { verdict: 'deny', rule_id: 'x', error: 'boom', backupRef: 'bak', patchPath: '/p', executor: 'claude-code' }
    appendStage(r.id, terminal, facts)
    assert.throws(() => appendStage(r.id, 'AGENT_RUNNING', {}), /terminal/,
      `appending after ${terminal} should throw`)
  }
})

test('APPLYING without a prior PENDING_APPROVAL and approval throws', () => {
  // No PENDING_APPROVAL at all.
  const a = createRun({ owner: 'louie' })
  appendStage(a.id, 'PATCH_READY', { patchPath: '/p' })
  assert.throws(() => appendStage(a.id, 'APPLYING', { approvedBy: 'louie' }), /PENDING_APPROVAL/)

  // PENDING_APPROVAL present, but no recorded approval.
  const b = createRun({ owner: 'louie' })
  appendStage(b.id, 'PENDING_APPROVAL', {})
  assert.throws(() => appendStage(b.id, 'APPLYING', {}), /approval/)

  // Both present → accepted.
  const c = createRun({ owner: 'louie' })
  appendStage(c.id, 'PENDING_APPROVAL', {})
  assert.doesNotThrow(() => appendStage(c.id, 'APPLYING', { approvedBy: 'louie' }))
})

test('a stage missing its required facts throws', () => {
  const r = createRun({ owner: 'louie' })
  assert.throws(() => appendStage(r.id, 'POLICY_EVALUATED', { verdict: 'allow' }), /rule_id/)
  assert.throws(() => appendStage(r.id, 'AGENT_SELECTED', {}), /agentId/)
  assert.throws(() => appendStage(r.id, 'PATCH_READY', {}), /patchPath/)
  assert.throws(() => appendStage(r.id, 'COMPLETED', {}), /backupRef/)
  assert.throws(() => appendStage(r.id, 'FAILED', {}), /error/)
})

test('the timeline returned by getRun cannot be mutated by the caller', () => {
  const id = happyPath()
  const before = getRun(id).timeline.length

  const snapshot = getRun(id)
  assert.throws(() => snapshot.timeline.push({ stage: 'FAILED', at: 'now', facts: {} }))
  assert.throws(() => { snapshot.timeline[0].stage = 'HACKED' })

  // The stored Run is unchanged after the mutation attempts.
  const after = getRun(id)
  assert.equal(after.timeline.length, before)
  assert.equal(after.timeline[0].stage, 'TASK_CREATED')
})

test('there is no status setter and no stored status field', () => {
  const r = createRun({ owner: 'louie' })
  assert.equal('status' in r, false)
  assert.equal('status' in getRun(r.id), false)
  // The module exposes no setter — only a derive function.
  assert.equal(typeof run.deriveStatus, 'function')
  assert.equal(run.setStatus, undefined)
})

test('facts may never carry owner (provenance guard)', () => {
  const r = createRun({ owner: 'louie' })
  assert.throws(() => appendStage(r.id, 'AGENT_RUNNING', { owner: 'attacker' }), /owner/)
})

test('deriveStatus folds the timeline for each shape', () => {
  // happy path → completed (terminal)
  const done = getRun(happyPath())
  assert.equal(deriveStatus(done), 'completed')
  assert.equal(isTerminal(deriveStatus(done)), true)

  // denied
  const denied = createRun({ owner: 'louie' })
  appendStage(denied.id, 'POLICY_EVALUATED', { verdict: 'deny', rule_id: 'deny-sensitive-data' })
  appendStage(denied.id, 'DENIED', {})
  assert.equal(deriveStatus(getRun(denied.id)), 'denied')
  assert.equal(isTerminal('denied'), true)

  // pending approval (non-terminal)
  const pending = createRun({ owner: 'louie' })
  appendStage(pending.id, 'PATCH_READY', { patchPath: '/p' })
  appendStage(pending.id, 'PENDING_APPROVAL', {})
  assert.equal(deriveStatus(getRun(pending.id)), 'pending_approval')
  assert.equal(isTerminal('pending_approval'), false)

  // failed
  const failed = createRun({ owner: 'louie' })
  appendStage(failed.id, 'AGENT_RUNNING', {})
  appendStage(failed.id, 'FAILED', { error: 'adapter crashed' })
  assert.equal(deriveStatus(getRun(failed.id)), 'failed')

  // rolled back (reached by a compensating stage after APPLYING)
  const rolled = createRun({ owner: 'louie' })
  appendStage(rolled.id, 'PENDING_APPROVAL', {})
  appendStage(rolled.id, 'APPLYING', { approvedBy: 'louie' })
  appendStage(rolled.id, 'ROLLED_BACK', { backupRef: 'bak_123' })
  assert.equal(deriveStatus(getRun(rolled.id)), 'rolled_back')
  assert.equal(isTerminal('rolled_back'), true)
})

/* ═══ P1-C1c RULING 1 — APPROVAL IDENTITY ON THE AGENT LANE ════════════════
 *
 * ⛔ THE GAP THIS CLOSES. The first cut required agent-lane evidence to carry AN
 * approvalId. It never checked the id was THIS Run's. Evidence naming a different
 * approval is worse than evidence naming none: it reads as a link, is stored as a
 * link, and points at the wrong governed decision — which is precisely the unlinked
 * / mis-linked execution record C1c exists to abolish.
 *
 * ⛔ AND IT IS LANE-AWARE, NOT GLOBAL. AGENT_FINISHED and SUCCEEDED are shared
 * vocabulary the Develop lane already uses. The rule follows the durable AGENT_CLAIMED
 * on the Run, so tightening the Agent lane cannot break Develop.
 */

/** A Run whose Agent lane has been opened by a matching claim. */
function agentClaimedRun (approvalId = 'appr_real') {
  const r = createRun({ owner: 'louie', approvalId })
  appendStage(r.id, 'AGENT_CLAIMED', { approvalId, workOrderHash: 'h_wo', projectId: 'aroma-agent-backend', repoFullName: 'Louielui/aroma-agent-backend' })
  return r
}

test('*** ⛔ AGENT_CLAIMED MUST NAME THIS RUN OWN APPROVAL ***', () => {
  const r = createRun({ owner: 'louie', approvalId: 'appr_real' })
  assert.throws(() => appendStage(r.id, 'AGENT_CLAIMED', { approvalId: 'appr_other', workOrderHash: 'h', projectId: 'aroma-agent-backend', repoFullName: 'Louielui/aroma-agent-backend' }),
    /not this run/, '⛔ a claim belonging to a different approval opened the lane')
  assert.equal(getRun(r.id).timeline.some(e => e.stage === 'AGENT_CLAIMED'), false, 'and nothing was written')
})

test('*** AGENT_CLAIMED with the matching approvalId is accepted ***', () => {
  const r = agentClaimedRun()
  assert.equal(getRun(r.id).timeline.filter(e => e.stage === 'AGENT_CLAIMED').length, 1)
  assert.equal(deriveStatus(getRun(r.id)), 'agent_claimed')
})

test('*** ⛔ A CLAIM CANNOT OPEN A LANE ON A RUN THAT HAS NO APPROVAL IDENTITY ***', () => {
  // Without run.approvalId there is nothing for recovery or the Owner's result
  // surface to resolve the attempt back to — the claim would be unreconcilable.
  const r = createRun({ owner: 'louie' })
  assert.equal(getRun(r.id).approvalId, null)
  assert.throws(() => appendStage(r.id, 'AGENT_CLAIMED', { approvalId: 'appr_x', workOrderHash: 'h', projectId: 'aroma-agent-backend', repoFullName: 'Louielui/aroma-agent-backend' }),
    /requires the run to carry an approvalId/)
})

test('*** ⛔ AGENT_FINISHED ON THE AGENT LANE MUST CARRY approvalId ***', () => {
  const r = agentClaimedRun()
  assert.throws(() => appendStage(r.id, 'AGENT_FINISHED', { ok: true }), /requires fact 'approvalId'/,
    '⛔ the crash bridge was allowed to omit the approval it belongs to')
})

test('*** ⛔ AGENT_FINISHED WITH A FOREIGN approvalId IS REFUSED ***', () => {
  const r = agentClaimedRun()
  assert.throws(() => appendStage(r.id, 'AGENT_FINISHED', { ok: true, approvalId: 'appr_someone_else' }), /not this run/)
  assert.equal(getRun(r.id).timeline.some(e => e.stage === 'AGENT_FINISHED'), false)
})

test('*** AGENT_FINISHED with the matching approvalId is accepted ***', () => {
  const r = agentClaimedRun()
  appendStage(r.id, 'AGENT_FINISHED', { ok: true, approvalId: 'appr_real' })
  const e = getRun(r.id).timeline.find(x => x.stage === 'AGENT_FINISHED')
  assert.equal(e.facts.ok, true)
  assert.equal(e.facts.approvalId, 'appr_real')
})

test('*** ⛔ SUCCEEDED WITH A FOREIGN approvalId IS REFUSED, matching is accepted ***', () => {
  const bad = agentClaimedRun()
  appendStage(bad.id, 'AGENT_FINISHED', { ok: true, approvalId: 'appr_real' })
  assert.throws(() => appendStage(bad.id, 'SUCCEEDED', { executor: 'claude-code', approvalId: 'appr_wrong' }), /not this run/)

  const good = agentClaimedRun()
  appendStage(good.id, 'AGENT_FINISHED', { ok: true, approvalId: 'appr_real' })
  appendStage(good.id, 'SUCCEEDED', { executor: 'claude-code', approvalId: 'appr_real' })
  assert.equal(deriveStatus(getRun(good.id)), 'succeeded')
})

test('*** ⛔ FAILED WITH A FOREIGN approvalId IS REFUSED, matching is accepted ***', () => {
  const bad = agentClaimedRun()
  assert.throws(() => appendStage(bad.id, 'FAILED', { error: 'bounded', approvalId: 'appr_wrong' }), /not this run/)

  const good = agentClaimedRun()
  appendStage(good.id, 'FAILED', { error: 'bounded', approvalId: 'appr_real' })
  assert.equal(deriveStatus(getRun(good.id)), 'failed')
})

test('*** identity is EXACT — no case folding, no trimming, no alias ***', () => {
  for (const near of ['APPR_REAL', 'Appr_Real', ' appr_real', 'appr_real ', 'appr_rea', 'appr_real2']) {
    const r = agentClaimedRun()
    assert.throws(() => appendStage(r.id, 'AGENT_FINISHED', { ok: true, approvalId: near }), /not this run/,
      '⛔ accepted a near-miss approvalId: ' + JSON.stringify(near))
  }
})

/* ── the rule must NOT have leaked onto other lanes or other stages ──────── */

test('*** a NON-agent Run keeps the pre-C1c AGENT_FINISHED contract ***', () => {
  const r = createRun({ owner: 'louie' }) // no approvalId, no claim — the Develop shape
  appendStage(r.id, 'AGENT_FINISHED', {})
  assert.equal(deriveStatus(getRun(r.id)), 'agent_finished', 'Develop still appends it with no facts at all')
})

test('*** ⛔ BUT A SUPPLIED ok MUST STILL BE A REAL BOOLEAN, on any lane ***', () => {
  for (const bad of ['true', 'false', 1, 0, {}, []]) {
    const r = createRun({ owner: 'louie' })
    assert.throws(() => appendStage(r.id, 'AGENT_FINISHED', { ok: bad }), /must be a boolean/,
      '⛔ accepted a non-boolean ok: ' + JSON.stringify(bad))
  }
})

test('*** SUCCEEDED on a non-agent Run needs only executor — approvalId is lane-aware ***', () => {
  const r = createRun({ owner: 'louie' })
  appendStage(r.id, 'SUCCEEDED', { executor: 'future-executor' })
  assert.equal(deriveStatus(getRun(r.id)), 'succeeded',
    'a future non-Agent lane is not forced to invent an approvalId')
})

test('*** the rule did NOT spread to progress stages or to other lanes ***', () => {
  const r = agentClaimedRun()
  // Progress marks answer "what is happening", not "which decision authorised it".
  appendStage(r.id, 'AGENT_SELECTED', { agentId: 'claude-code' })
  appendStage(r.id, 'AGENT_RUNNING', {})
  assert.equal(getRun(r.id).timeline.filter(e => ['AGENT_SELECTED', 'AGENT_RUNNING'].includes(e.stage)).length, 2)

  // Develop/Worker claims are untouched by the approval-identity rule.
  const d = createRun({ owner: 'louie' })
  appendStage(d.id, 'DISPATCH_CLAIMED', {})
  appendStage(d.id, 'WORKER_CLAIMED', {})
  assert.equal(getRun(d.id).timeline.length, 3)
})

test('*** COMPLETED is untouched: still requires backupRef, still not the Agent terminal ***', () => {
  const r = createRun({ owner: 'louie' })
  assert.throws(() => appendStage(r.id, 'COMPLETED', {}), /backupRef/)
  assert.throws(() => appendStage(r.id, 'COMPLETED', { executor: 'claude-code', approvalId: 'appr_real' }), /backupRef/,
    '⛔ an agent-shaped fact bag must not satisfy COMPLETED')
  const ok = createRun({ owner: 'louie' })
  appendStage(ok.id, 'COMPLETED', { backupRef: 'bak_1' })
  assert.equal(deriveStatus(getRun(ok.id)), 'completed')
})
