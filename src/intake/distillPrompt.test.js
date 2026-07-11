'use strict'

/**
 * distillPrompt.test.js — B2-3 intake discourse fix (stub unit).
 *
 * Covers parseDistillResponse routing with canned JSON: a background/context
 * classification is NON-COMMIT (no Decision/Task), a real command still commits,
 * and the out-of-scope forced-task fallback is left unchanged. Also asserts the
 * SYSTEM_PROMPT now declares the context/background category + non-commit rule.
 *
 *   Run: node --test src/intake/distillPrompt.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { parseDistillResponse, SYSTEM_PROMPT } = require('./distillPrompt')

test('SYSTEM_PROMPT declares the context/background category + non-commit rule', () => {
  assert.match(SYSTEM_PROMPT, /context/)
  assert.match(SYSTEM_PROMPT, /背景\/現況 ≠ 指令/)
  assert.match(SYSTEM_PROMPT, /絕對不要】產生 decision 或 task/)
})

test('a context/background classification is NON-COMMIT — no Decision, no Task', () => {
  const raw = JSON.stringify({
    intent: 'context', mode: 'chat',
    reply: '了解——從今天開始我們一起推進 Aroma System。'
  })
  const d = parseDistillResponse(raw)
  assert.equal(d.intent, 'context')
  assert.equal(d.mode, 'chat')
  assert.equal(d.decision, null)
  assert.deepEqual(d.tasks, [])
  // intakeService persists only when mode === 'commit', so this never creates records.
})

test('a real command (commit) still produces a Decision + Task', () => {
  const raw = JSON.stringify({
    intent: 'task', mode: 'commit', reply: '我已記錄這個決定並建立了任務。',
    judgment: '這是明確的行動要求。',
    decision: { statement: '停止 Timeline 在終止狀態後的輪詢', rationale: '避免終止後空轉。' },
    tasks: [{ title: '停止 Timeline 輪詢', note: '終止狀態後', capability: 'coding' }],
    risks: []
  })
  const d = parseDistillResponse(raw)
  assert.equal(d.mode, 'commit')
  assert.ok(d.decision)
  assert.equal(d.decision.statement, '停止 Timeline 在終止狀態後的輪詢')
  assert.equal(d.tasks.length, 1)
  assert.equal(d.tasks[0].capability, 'coding')
})

// B2-4: the synthetic-task fallback is REMOVED. A commit may legitimately have
// zero tasks; the parser must never fabricate one from reply/decision text.

test('ACCEPTANCE (1) commit + tasks:[] → tasks stays [], no synthetic task', () => {
  const d = parseDistillResponse(JSON.stringify({
    intent: 'decision', mode: 'commit', reply: '收到,我已記錄這個決定。',
    decision: { statement: '把庫存盤點改成每週一次', rationale: '降低缺貨風險。' }, tasks: []
  }))
  assert.equal(d.mode, 'commit')
  assert.ok(d.decision) // Decision preserved
  assert.deepEqual(d.tasks, [])
})

test('ACCEPTANCE (2) commit + tasks field MISSING → normalizes to [], no synthetic task', () => {
  const d = parseDistillResponse(JSON.stringify({
    intent: 'decision', mode: 'commit', reply: '好的,我把這個決定記下來了。',
    decision: { statement: '先接 POS 再做庫存', rationale: '資料來源優先。' }
  }))
  assert.deepEqual(d.tasks, [])
})

test('ACCEPTANCE (3) commit + blank/invalid-title tasks → filtered to [], NOT backfilled from reply/decision', () => {
  const d = parseDistillResponse(JSON.stringify({
    intent: 'task', mode: 'commit', reply: '收到,已規劃。',
    decision: { statement: 'D', rationale: '' },
    tasks: [{ title: '', note: 'x', capability: 'coding' }, { note: 'y' }]
  }))
  assert.deepEqual(d.tasks, [])
  // no fabricated content: neither the reply nor the decision statement became a task
})

test('ACCEPTANCE (4) commit + real tasks → preserved unchanged (title/count identical)', () => {
  const d = parseDistillResponse(JSON.stringify({
    intent: 'task', mode: 'commit', reply: '已建立任務。',
    decision: { statement: 'D', rationale: '' },
    tasks: [{ title: '建立供應商資料表', note: '含欄位', capability: 'coding' }]
  }))
  assert.equal(d.tasks.length, 1)
  assert.equal(d.tasks[0].title, '建立供應商資料表')
  assert.equal(d.tasks[0].capability, 'coding')
})

test('ACCEPTANCE (5) chat routing unchanged — no Decision/Task', () => {
  const d = parseDistillResponse(JSON.stringify({ intent: 'context', mode: 'chat', reply: '了解。' }))
  assert.equal(d.mode, 'chat')
  assert.equal(d.decision, null)
  assert.deepEqual(d.tasks, [])
})

test('the synthetic marker note "由對話蒸餾" no longer appears for empty-task commits', () => {
  const d = parseDistillResponse(JSON.stringify({
    intent: 'decision', mode: 'commit', reply: '記錄了。', decision: { statement: 'X', rationale: '' }, tasks: []
  }))
  assert.equal(d.tasks.length, 0)
  assert.ok(!d.tasks.some(t => t.note === '由對話蒸餾'), 'no fabricated 由對話蒸餾 task')
})
