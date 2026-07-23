'use strict'

/**
 * groundedReply.test.js — B2-2 reply grounding. The action-bearing reply must be
 * built from the REAL outcome and must NEVER claim a proposal that was not created.
 *
 *   Run: node --test src/intake/groundedReply.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildGroundedReply } = require('./groundedReply')

const CREATED_MARK = '編號' // appears ONLY in the "proposal created (編號 …)" claim
const NO_PROPOSAL = '尚未建立任何提案'

test('clarification / multiple_tasks_narrow_to_one → ask to narrow; NO proposal claim', () => {
  const r = buildGroundedReply({ type: 'clarification', clarificationReason: 'multiple_tasks_narrow_to_one' })
  assert.ok(r.includes(NO_PROPOSAL), 'states no proposal created')
  assert.ok(/收斂|單一/.test(r), 'asks to narrow to a single action')
  assert.ok(!r.includes(CREATED_MARK), 'no proposal-id / created claim')
})

test('clarification / no_actionable_task → NO proposal claim', () => {
  const r = buildGroundedReply({ type: 'clarification', clarificationReason: 'no_actionable_task' })
  assert.ok(r.includes(NO_PROPOSAL))
  assert.ok(!r.includes(CREATED_MARK))
})

test('execution_proposal + real id → references THAT id, marks pending/not-executed', () => {
  const r = buildGroundedReply({ type: 'execution_proposal', proposalCreated: true, proposalId: 'prop_abc12345' })
  assert.ok(r.includes('prop_abc12345'), 'references the real proposal id')
  assert.ok(r.includes(CREATED_MARK), 'makes the created claim')
  assert.ok(/待批准/.test(r) && /尚未執行/.test(r), 'says pending + not executed')
})

test('execution_proposal + promote failed (no id) → NO id, NO created claim', () => {
  const r = buildGroundedReply({ type: 'execution_proposal', proposalCreated: false, proposalId: null, promoteError: { code: 'seam_not_wired' } })
  assert.ok(r.includes(NO_PROPOSAL), 'states no proposal created')
  assert.ok(!r.includes(CREATED_MARK))
})

test('HARD invariant: created claim ONLY when proposalCreated===true AND a real id', () => {
  // created true but empty/whitespace id → must NOT claim
  for (const badId of ['', '   ', null, undefined, 42]) {
    const r = buildGroundedReply({ type: 'execution_proposal', proposalCreated: true, proposalId: badId })
    assert.ok(!r.includes(CREATED_MARK), `no created claim for id=${JSON.stringify(badId)}`)
    assert.ok(r.includes(NO_PROPOSAL))
  }
  // real id present but created !== true → must NOT claim, must NOT leak the id
  const r = buildGroundedReply({ type: 'execution_proposal', proposalCreated: false, proposalId: 'prop_x' })
  assert.ok(!r.includes('prop_x') && !r.includes(CREATED_MARK) && r.includes(NO_PROPOSAL))
})
