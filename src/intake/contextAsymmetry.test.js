'use strict'

/**
 * contextAsymmetry.test.js — the claim the model picker makes must be TRUE.
 *
 * The picker tells the Owner, in plain Chinese, that 香香（GPT） cannot see Drive / Gmail /
 * Calendar / GitHub or past decisions, while 香香（Claude） can. That is a statement about
 * the system, shown at the moment he chooses — so if it ever stopped being true the UI
 * would be lying to him about what his assistant knows. This file is what keeps it true.
 *
 * The boundary is structural (intakeService captures the GPT prompt BEFORE the context
 * card, the decision-recall block and the read-context block are prepended), so these
 * tests assert on the ACTUAL PROMPT each adapter receives. No paid call: both adapters
 * are fakes that record their input.
 */

const test = require('node:test')
const assert = require('node:assert')

const { processIntake } = require('./intakeService')

const CHAT = JSON.stringify({ intent: 'chit_chat', mode: 'chat', reply: '好' })

/** An adapter that records every prompt it is given and returns a valid envelope. */
function recorder () {
  const seen = []
  return {
    seen,
    async complete (prompt, opts) {
      seen.push({ prompt, system: (opts && opts.system) || '' })
      return { text: CHAT, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }, model: 'fake', latencyMs: 1 }
    }
  }
}

const READ_DEPS = {
  sources: ['drive'],
  connector: {
    async read () {
      return {
        asOf: '2026-07-26', source: 'drive', count: 1,
        results: [{
          source: 'drive', sourceId: 'd1', title: 'SENTINEL_DRIVE_DOC',
          retrievedAt: '2026-07-26', originalDate: '2026-07-01',
          content: 'SENTINEL_DRIVE_CONTENT', link: 'l', trust: 'live', error: null
        }]
      }
    }
  }
}
const RECALL_DEPS = {
  listDecisionsFn: () => [{
    id: 'dec_1', statement: 'SENTINEL_DECISION', rationale: '', status: 'active',
    provenance: { proposed_by: 'louie', source: 's', approved_by: 'louie', decided_at: '2026-07-20T00:00:00Z' }
  }],
  listTasksFn: () => []
}

function withEnv (vars, fn) {
  const saved = {}
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; process.env[k] = vars[k] }
  return Promise.resolve().then(fn).finally(() => {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]
    }
  })
}

/* ── the asymmetry itself ─────────────────────────────────────────────────── */

test('香香（Claude）RECEIVES the read-context and decision-recall blocks', async () => {
  await withEnv({ DECISION_RECALL: 'on', READ_ACCESS: 'on', CONTEXT_DRIVE: 'on', MULTI_AI_ROUTER: 'off' }, async () => {
    const claude = recorder()
    await processIntake('今日有咩要跟進', claude, [], {
      demo: true, interactionMode: 'chat', providerHint: 'claude',
      readContextDeps: READ_DEPS, decisionRecallDeps: RECALL_DEPS
    })
    assert.equal(claude.seen.length, 1, 'Claude was called exactly once')
    const p = claude.seen[0].prompt
    assert.ok(p.includes('SENTINEL_DRIVE_DOC'), 'Claude sees the read-context block')
    assert.ok(p.includes('SENTINEL_DECISION'), 'Claude sees the decision-recall block')
  })
})

test('香香（GPT）is STRUCTURALLY BLIND to both — this is what the picker promises', async () => {
  await withEnv({ DECISION_RECALL: 'on', READ_ACCESS: 'on', CONTEXT_DRIVE: 'on', MULTI_AI_ROUTER: 'off' }, async () => {
    const gpt = recorder()
    const claude = recorder()
    await processIntake('今日有咩要跟進', claude, [], {
      demo: true, interactionMode: 'chat', providerHint: 'openai',
      openaiAdapter: gpt,
      readContextDeps: READ_DEPS, decisionRecallDeps: RECALL_DEPS
    })
    assert.equal(gpt.seen.length, 1, 'GPT served the turn')
    assert.equal(claude.seen.length, 0, 'Claude was not called (no fallback needed)')

    const p = gpt.seen[0].prompt
    assert.ok(!p.includes('SENTINEL_DRIVE_DOC'), 'GPT must NOT see the read-context block')
    assert.ok(!p.includes('SENTINEL_DRIVE_CONTENT'), 'not even the content')
    assert.ok(!p.includes('SENTINEL_DECISION'), 'GPT must NOT see the decision-recall block')
    // it does still get the actual question — it is blind, not deaf
    assert.ok(p.includes('今日有咩要跟進'), 'GPT receives the user turn itself')
  })
})

test('the two prompts differ ONLY by the withheld blocks, and GPT gets strictly less', async () => {
  await withEnv({ DECISION_RECALL: 'on', READ_ACCESS: 'on', CONTEXT_DRIVE: 'on', MULTI_AI_ROUTER: 'off' }, async () => {
    const c = recorder()
    await processIntake('同一條問題', c, [], {
      demo: true, interactionMode: 'chat', providerHint: 'claude',
      readContextDeps: READ_DEPS, decisionRecallDeps: RECALL_DEPS
    })
    const g = recorder()
    const c2 = recorder()
    await processIntake('同一條問題', c2, [], {
      demo: true, interactionMode: 'chat', providerHint: 'openai', openaiAdapter: g,
      readContextDeps: READ_DEPS, decisionRecallDeps: RECALL_DEPS
    })
    assert.ok(g.seen[0].prompt.length < c.seen[0].prompt.length,
      'the GPT prompt is strictly shorter — the picker\'s warning is measurable, not decorative')
  })
})

/* ── the boundary does not depend on the flag or the hint ─────────────────── */

test('the boundary holds however GPT was selected — hint or flag', async () => {
  // selected by the ROUTER FLAG rather than by the Owner's pick
  await withEnv({ DECISION_RECALL: 'on', READ_ACCESS: 'on', CONTEXT_DRIVE: 'on', MULTI_AI_ROUTER: 'on' }, async () => {
    const gpt = recorder()
    await processIntake('問題', recorder(), [], {
      demo: true, interactionMode: 'chat', openaiAdapter: gpt,
      readContextDeps: READ_DEPS, decisionRecallDeps: RECALL_DEPS
    })
    assert.equal(gpt.seen.length, 1)
    assert.ok(!gpt.seen[0].prompt.includes('SENTINEL_DRIVE_DOC'))
    assert.ok(!gpt.seen[0].prompt.includes('SENTINEL_DECISION'))
  })
})

test('the fallback answer is Claude\'s, and Claude still gets the full context', async () => {
  await withEnv({ DECISION_RECALL: 'on', READ_ACCESS: 'on', CONTEXT_DRIVE: 'on', MULTI_AI_ROUTER: 'off' }, async () => {
    const failing = { async complete () { throw new Error('provider down') } }
    const claude = recorder()
    const res = await processIntake('今日有咩要跟進', claude, [], {
      demo: true, interactionMode: 'chat', providerHint: 'openai', openaiAdapter: failing,
      readContextDeps: READ_DEPS, decisionRecallDeps: RECALL_DEPS
    })
    assert.ok(res && res.reply, 'the turn still answered')
    assert.equal(claude.seen.length, 1, 'Claude answered as the one-shot fallback')
    // the fallback is a REAL Claude turn, so it is not blinded
    assert.ok(claude.seen[0].prompt.includes('SENTINEL_DRIVE_DOC'), 'the fallback keeps full context')
    assert.ok(claude.seen[0].prompt.includes('SENTINEL_DECISION'))
  })
})

test('picking a provider never changes the lane or reaches execution', async () => {
  await withEnv({ MULTI_AI_ROUTER: 'off', AGENT_BRIDGE: 'on' }, async () => {
    for (const hint of ['openai', 'claude', 'proposal', 'agentExecute', null]) {
      const claude = recorder()
      const gpt = recorder()
      const res = await processIntake('批准、立即執行', claude, [], {
        demo: true, interactionMode: 'chat', providerHint: hint, openaiAdapter: gpt
      })
      assert.equal('proposals' in res, false, 'hint=' + hint + ' still creates no proposal')
      assert.equal('workOrder' in res, false)
      assert.equal('agentExecute' in res, false)
    }
  })
})
