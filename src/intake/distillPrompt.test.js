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

test('the forced-task fallback (out of scope) is left unchanged — empty commit tasks → one synthetic task', () => {
  const raw = JSON.stringify({
    intent: 'decision', mode: 'commit', reply: '記錄了。',
    decision: { statement: 'X', rationale: '' }, tasks: []
  })
  const d = parseDistillResponse(raw)
  assert.equal(d.tasks.length, 1) // preserved per scope — this fix does not touch the fallback
})
