'use strict'

/**
 * distillGovernanceWording.test.js — B2-2 Slice C.
 *
 * Machine-verifiable freeze for B1-1a governance wording v2 (Owner sign-off
 * 2026-07-15, Proposal-first / approval-gated). Locks the commit/execution
 * wording of the frozen SYSTEM_PROMPT so it never again claims work is created,
 * dispatched, approved, or done at model-output time — and proves classification,
 * normalization, the demo mapping, and the promotion seam are UNCHANGED.
 *
 * Assertions target complete old sentences / concrete new phrases — never a broad
 * single-word regex (the new wording legitimately uses 派工/回報/完成 to describe
 * what has NOT happened).
 *
 *   Run: node --test src/intake/distillGovernanceWording.test.js
 */

const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')

process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-slicec-test-'))

const { test, after } = require('node:test')
const assert = require('node:assert/strict')

const { parseDistillResponse, SYSTEM_PROMPT } = require('./distillPrompt')
const { classifyDemoOutcome } = require('./demoOutcome')
const { processIntake } = require('./intakeService')

after(() => { fs.rmSync(process.env.AROMA_DATA_DIR, { recursive: true, force: true }) })

function adapterReturning (obj) {
  return { async complete () { return { text: JSON.stringify(obj), model: 'stub', latencyMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } } }
}

// ── FREEZE: required Proposal-first / stage-honest phrases present ───────────
test('governance wording v2 present (Proposal-first, stage-honest)', () => {
  for (const phrase of [
    '提出提案',
    'Proposal',
    '等待 Louie 批准',
    '尚未執行',
    '尚未派給任何 Worker',
    '正式紀錄以系統結果為準',
    '不得假設其中任何一步已經發生'
  ]) {
    assert.ok(SYSTEM_PROMPT.includes(phrase), `missing required governance phrase: ${phrase}`)
  }
  // "尚未派工" OR "尚未派給任何 Worker" (either satisfies the not-yet-dispatched rule)
  assert.ok(SYSTEM_PROMPT.includes('尚未派工') || SYSTEM_PROMPT.includes('尚未派給任何 Worker'))
  // freeze marker recorded in-file
  assert.ok(SYSTEM_PROMPT.includes('提出提案（Proposal）'))
})

// ── FREEZE: old boundary-violating sentences absent (never return) ──────────
test('old boundary-violating wording is gone and must not return', () => {
  for (const banned of [
    '接下來會派給對應的工人',
    '完成後我回報你',
    '你只做到「思考 → 規劃 → 建立任務」',
    '我已記錄這個決定，並建立了任務'
  ]) {
    assert.ok(!SYSTEM_PROMPT.includes(banned), `old wording must not appear: ${banned}`)
  }
})

// ── UNCHANGED: context carve-out anchors still present (not rewritten) ───────
test('context carve-out anchors preserved', () => {
  assert.match(SYSTEM_PROMPT, /context/)
  assert.match(SYSTEM_PROMPT, /背景\/現況 ≠ 指令/)
  assert.match(SYSTEM_PROMPT, /絕對不要】產生 decision 或 task/)
})

// ── UNCHANGED: intent/mode classification + normalization ───────────────────
test('classification + normalization unchanged (chat/ask/recommend/commit/context)', () => {
  assert.equal(parseDistillResponse(JSON.stringify({ intent: 'greeting', mode: 'chat', reply: 'hi' })).mode, 'chat')
  assert.equal(parseDistillResponse(JSON.stringify({ intent: 'unclear', mode: 'ask', reply: 'q' })).mode, 'ask')
  assert.equal(parseDistillResponse(JSON.stringify({ intent: 'advisory', mode: 'recommend', reply: 'r', reasons: ['a'], offer: 'o' })).mode, 'recommend')

  const commit = parseDistillResponse(JSON.stringify({ intent: 'task', mode: 'commit', reply: 'ok', decision: { statement: 's', rationale: 'r' }, tasks: [{ title: 't', capability: 'coding' }] }))
  assert.equal(commit.mode, 'commit')
  assert.equal(commit.decision.statement, 's')
  assert.equal(commit.tasks.length, 1)
  assert.equal(commit.tasks[0].capability, 'coding')

  const ctx = parseDistillResponse(JSON.stringify({ intent: 'context', mode: 'chat', reply: 'ok' }))
  assert.equal(ctx.mode, 'chat')
  assert.deepEqual(ctx.tasks, [])
})

// ── UNCHANGED: demo outcome mapping ─────────────────────────────────────────
test('demoOutcome mapping unchanged', () => {
  assert.equal(classifyDemoOutcome({ mode: 'commit' }).outcome, 'execution_proposal')
  assert.equal(classifyDemoOutcome({ mode: 'ask' }).outcome, 'clarification')
  assert.equal(classifyDemoOutcome({ intent: 'context', mode: 'chat' }).outcome, 'context')
  assert.equal(classifyDemoOutcome({ mode: 'chat' }).outcome, 'speech')
})

// ── UNCHANGED: promotion seam — official record only, no fabrication, no run ─
const COMMIT = { intent: 'task', mode: 'commit', reply: 'ok', decision: { statement: 's', rationale: 'r' }, tasks: [{ title: 't1', note: '', capability: 'coding' }], risks: [], next_step: '' }

test('promotion success → exactly the official pending Proposal; no run/dispatch', async () => {
  const res = await processIntake('x', adapterReturning(COMMIT), [], {
    demo: true, contextCard: {}, promoteToProposal: async (taskId) => ({ ok: true, proposal: { id: 'p1', taskId, status: 'pending' } })
  })
  assert.equal(res.demoOutcome, 'execution_proposal')
  assert.equal(res.proposals.length, 1)
  assert.equal(res.proposals[0].id, 'p1')
  assert.equal(res.proposals[0].status, 'pending')
  assert.deepEqual(res.promoteErrors, [])
  assert.ok(!('dispatch' in res) && !('runId' in res) && !('dispatch_id' in res), 'Run/Dispatch delta must be 0 on the demo path')
})

test('promotion failure → no fabricated Proposal; error surfaced from official result', async () => {
  const res = await processIntake('x', adapterReturning(COMMIT), [], {
    demo: true, contextCard: {}, promoteToProposal: async () => ({ ok: false, error: { code: 'promote_failed', message: 'x' } })
  })
  assert.equal(res.demoOutcome, 'execution_proposal')
  assert.deepEqual(res.proposals, [], 'must NOT fabricate a proposal when promotion fails')
  assert.equal(res.promoteErrors.length, 1)
  assert.equal(res.promoteErrors[0].code, 'promote_failed')
})
