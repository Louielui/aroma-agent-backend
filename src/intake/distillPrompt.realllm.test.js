'use strict'

/**
 * distillPrompt.realllm.test.js — B2-3 gated real-LLM regression.
 *
 * The discourse bug is a MODEL judgment against the prompt, so stubs cannot
 * verify the fix — this exercises the REAL model (claude-haiku-4-5-20251001,
 * temp 0) at the distill level WITHOUT persisting (no processIntake, no data/).
 * GATED: runs only with RUN_PAID_E2E=1; the default suite skips it (no paid call).
 *
 *   Enable:  RUN_PAID_E2E=1 node --test src/intake/distillPrompt.realllm.test.js
 *
 * Background statements must be NON-COMMIT (no Decision/Task) and stable across
 * 3 runs; real commands must still COMMIT with a Decision/Task.
 */

require('dotenv').config()

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { getAdapter } = require('../adapters/adapterFactory')
const { buildDistillPrompt, parseDistillResponse } = require('./distillPrompt')

const PAID = process.env.RUN_PAID_E2E === '1'

const BACKGROUND = [
  '從今天開始，我們一起開發 Aroma System',
  '我們公司主要做餐飲，中午最忙',
  '我昨天跟供應商談過了',
  'Aroma 現在有三個門市',
  '我最近在想香香的定位'
]
const COMMANDS = [
  '幫我把 Timeline 的輪詢在終止狀態後停掉',
  '建立一個新的供應商資料表'
]

async function classify (message) {
  const adapter = getAdapter()
  const { system, prompt } = buildDistillPrompt(message, [])
  const r = await adapter.complete(prompt, { system, maxTokens: 1024, temperature: 0 })
  const d = parseDistillResponse(r.text)
  return { model: r.model, intent: d.intent, mode: d.mode, decision: d.decision, tasks: d.tasks }
}
const persists = (d) => d.mode === 'commit' // intakeService persists only on commit

test('BACKGROUND statements are NON-COMMIT (no Decision/Task), stable across 3 runs', { skip: PAID ? false : 'set RUN_PAID_E2E=1 to run', timeout: 300000 }, async () => {
  for (const msg of BACKGROUND) {
    const modes = []
    for (let i = 1; i <= 3; i++) {
      const d = await classify(msg)
      modes.push(d.mode)
      console.log(`[bg] "${msg}" run ${i}: intent=${d.intent} mode=${d.mode} commit=${d.mode === 'commit' ? 'Y' : 'N'} persistDecision/Task=${persists(d) ? 'YES' : 'no'} tasks=${d.tasks.length}`)
      assert.notEqual(d.mode, 'commit', `"${msg}" (run ${i}) committed — must be non-commit`)
      assert.equal(d.decision, null, `"${msg}" (run ${i}) produced a Decision`)
      assert.equal(d.tasks.length, 0, `"${msg}" (run ${i}) produced ${d.tasks.length} Task(s)`)
    }
    const stable = modes.every(m => m === modes[0])
    console.log(`[bg] "${msg}" modes=${JSON.stringify(modes)} ${stable ? 'STABLE' : 'FLAKY'}`)
    assert.ok(stable, `"${msg}" classification is flaky across runs: ${JSON.stringify(modes)}`)
  }
})

test('real COMMANDS still COMMIT with a Decision/Task', { skip: PAID ? false : 'set RUN_PAID_E2E=1 to run', timeout: 180000 }, async () => {
  for (const msg of COMMANDS) {
    const d = await classify(msg)
    console.log(`[cmd] "${msg}": intent=${d.intent} mode=${d.mode} commit=${d.mode === 'commit' ? 'Y' : 'N'} persistDecision/Task=${persists(d) ? 'YES' : 'no'} tasks=${d.tasks.length}`)
    assert.equal(d.mode, 'commit', `"${msg}" → mode=${d.mode} (must commit — over-blocked?)`)
    assert.ok(d.tasks.length >= 1, `"${msg}" produced no Task`)
  }
})
