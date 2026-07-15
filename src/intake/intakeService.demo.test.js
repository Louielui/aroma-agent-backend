'use strict'

/**
 * intakeService.demo.test.js — B2-2 Slice 2. Demo behaviour of processIntake:
 *   - flag OFF: response contract, adapter arguments and side-effects unchanged;
 *   - flag ON: additive demoOutcome; Speech/Context/Clarification map correctly;
 *   - execution goes through the OFFICIAL Proposal seam via a DOMAIN contract
 *     ({ ok, proposal } | { ok:false, error }) — no HTTP shape, no invented state;
 *   - single-task rule (0 or >1 tasks → clarification, no persist, no promote);
 *   - persona guard injected + context card sanitized with observable warnings.
 *
 * Hermetic: a fake injected adapter (records args, returns canned distill JSON)
 * and a temp AROMA_DATA_DIR so the in-process store writes to a throwaway dir.
 *
 *   Run: node --test src/intake/intakeService.demo.test.js
 */

const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')

// Point the in-process truth store at a throwaway dir BEFORE requiring the service.
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-demo-test-'))

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')
const { buildDistillPrompt } = require('./distillPrompt')

// A fake LLMAdapter: records (prompt, system) and returns canned distill JSON.
function fakeAdapter (canned) {
  const calls = []
  return {
    calls,
    async complete (prompt, optsArg) {
      calls.push({ prompt, system: optsArg && optsArg.system })
      return { text: JSON.stringify(canned), model: 'fake', latencyMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
    }
  }
}

const CANNED = {
  speech: { intent: 'chit_chat', mode: 'chat', reply: 'ok-speech' },
  context: { intent: 'context', mode: 'chat', reply: 'ok-context' },
  clarification: { intent: 'unclear', mode: 'ask', reply: 'which part?' },
  exec1: { intent: 'task', mode: 'commit', reply: 'recorded', judgment: 'j', decision: { statement: 'stop polling', rationale: 'r' }, tasks: [{ title: 'stop Timeline polling', note: 'n', capability: 'coding' }], risks: [], next_step: 'next' },
  exec2: { intent: 'task', mode: 'commit', reply: 'recorded', decision: { statement: 's', rationale: 'r' }, tasks: [{ title: 't1', note: '', capability: 'coding' }, { title: 't2', note: '', capability: 'coding' }], risks: [], next_step: '' },
  exec0: { intent: 'task', mode: 'commit', reply: 'r', decision: { statement: 's', rationale: 'r' }, tasks: [], risks: [], next_step: '' }
}

// ── flag OFF ────────────────────────────────────────────────────────────────
test('OFF: response contract + adapter args unchanged (no demoOutcome; raw distill prompt/system)', async () => {
  const msg = '今天先不要動程式，我想聊聊架構。'
  const a = fakeAdapter(CANNED.speech)
  const res = await processIntake(msg, a, []) // no opts → demo off
  assert.equal('demoOutcome' in res, false)
  assert.equal('proposals' in res, false)
  assert.equal('contextCardWarnings' in res, false)
  const { system, prompt } = buildDistillPrompt(msg, [])
  assert.equal(a.calls[0].system, system, 'OFF adapter system == raw distill system (no persona)')
  assert.equal(a.calls[0].prompt, prompt, 'OFF adapter prompt == raw distill prompt (no context block)')
  assert.ok(!a.calls[0].system.includes('資料邊界'), 'no persona guard when OFF')
})

// ── flag ON: Speech / Context / Clarification ────────────────────────────────
test('ON: Speech/Context/Clarification add demoOutcome only; no proposal; no invented state', async () => {
  const cases = [['speech', 'speech'], ['context', 'context'], ['clarification', 'clarification']]
  for (const [key, expected] of cases) {
    const res = await processIntake('x', fakeAdapter(CANNED[key]), [], { demo: true })
    assert.equal(res.demoOutcome, expected)
    assert.equal('proposals' in res, false)
    assert.equal('status' in res, false)
    assert.equal('dispatchStatus' in res, false)
    assert.deepEqual(res.contextCardWarnings, [])
  }
})

// ── flag ON: Execution — official Proposal via domain contract ───────────────
test('ON execution: single task → official Proposal from the domain seam; state only from the record', async () => {
  const officialRecord = Object.freeze({ id: 'prop_abc12345', status: 'pending', linkState: 'ready', task: 'brief', owner: 'louie' })
  let promoteCalledWith = null
  const promoteToProposal = async (taskId) => { promoteCalledWith = taskId; return { ok: true, proposal: officialRecord } }
  const res = await processIntake('把 Timeline 到終止狀態後的輪詢停掉。', fakeAdapter(CANNED.exec1), [], { demo: true, promoteToProposal })
  assert.equal(res.demoOutcome, 'execution_proposal')
  assert.equal(res.proposals.length, 1)
  assert.deepEqual(res.proposals[0], officialRecord, 'proposals[] is the official record verbatim — no re-shaping')
  assert.deepEqual(res.promoteErrors, [])
  assert.ok(typeof promoteCalledWith === 'string' && promoteCalledWith.startsWith('task_'), 'a real persisted taskId reached the domain seam')
  // no invented / duplicate representations
  assert.equal('status' in res, false)
  assert.equal('dispatchStatus' in res, false)
  assert.equal('proposalId' in res, false)
})

test('ON execution: >1 task → clarification; promoteToProposal NEVER called; no proposals', async () => {
  let promoteCalls = 0
  const promoteToProposal = async () => { promoteCalls++; return { ok: true, proposal: {} } }
  const res = await processIntake('兩件事', fakeAdapter(CANNED.exec2), [], { demo: true, promoteToProposal })
  assert.equal(res.demoOutcome, 'clarification')
  assert.equal(res.clarificationReason, 'multiple_tasks_narrow_to_one')
  assert.equal('proposals' in res, false)
  assert.equal(promoteCalls, 0)
})

test('ON execution: 0 task → clarification (no_actionable_task); no promote', async () => {
  let promoteCalls = 0
  const res = await processIntake('x', fakeAdapter(CANNED.exec0), [], { demo: true, promoteToProposal: async () => { promoteCalls++; return { ok: true } } })
  assert.equal(res.demoOutcome, 'clarification')
  assert.equal(res.clarificationReason, 'no_actionable_task')
  assert.equal(promoteCalls, 0)
})

test('ON execution: seam not wired → visible promoteErrors, NO fake proposal', async () => {
  const res = await processIntake('把 Timeline 輪詢停掉', fakeAdapter(CANNED.exec1), [], { demo: true }) // no promoteToProposal
  assert.equal(res.demoOutcome, 'execution_proposal')
  assert.deepEqual(res.proposals, [])
  assert.equal(res.promoteErrors[0].code, 'seam_not_wired')
})

test('ON execution: domain-seam failure surfaces the domain error, not a proposal', async () => {
  const promoteToProposal = async () => ({ ok: false, error: { code: 'promote_rejected', message: 'nope' } })
  const res = await processIntake('把 Timeline 輪詢停掉', fakeAdapter(CANNED.exec1), [], { demo: true, promoteToProposal })
  assert.deepEqual(res.proposals, [])
  assert.equal(res.promoteErrors[0].code, 'promote_rejected')
})

// ── flag ON: persona injected + context card sanitized ───────────────────────
test('ON: persona guard reaches the adapter system; context card sanitized + warnings surfaced', async () => {
  const a = fakeAdapter(CANNED.speech)
  const res = await processIntake('聊架構', a, [], { demo: true, contextCard: { project: 'Aroma', evil: 'x', note: 'y'.repeat(400) } })
  assert.ok(a.calls[0].system.includes('資料邊界'), 'persona guard injected into system (trusted)')
  assert.ok(a.calls[0].prompt.includes('<context_card>') && a.calls[0].prompt.includes('project: Aroma'), 'context card in a data block')
  const codes = res.contextCardWarnings.map((w) => w.code)
  assert.ok(codes.includes('dropped_not_in_whitelist'), 'evil field dropped, observable')
  assert.ok(codes.includes('truncated'), 'over-length note truncated, observable')
})
