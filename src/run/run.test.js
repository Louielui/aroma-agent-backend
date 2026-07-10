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
    const facts = { verdict: 'deny', rule_id: 'x', error: 'boom', backupRef: 'bak', patchPath: '/p' }
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
