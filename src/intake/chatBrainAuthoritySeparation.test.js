'use strict'

/**
 * chatBrainAuthoritySeparation.test.js — C3 closeout.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE FIRST C3 SEAM WAS TOO BROAD, AND THE TESTS FOR IT COULD NOT SEE WHY.
 *
 * `getAdapterForLane('chat')` correctly kept email_draft, the proposal / work-order lane,
 * the legacy intent classifier and the dispatch worker off the chat pin. But the goal
 * decomposer runs on the TURN adapter, and on a chat turn the turn adapter IS the
 * Owner-facing brain — so raising the chat model silently re-benchmarked the component that
 * decides which sources a turn may narrow to. B emits a plan, never prose; the Owner reads
 * nothing it produces. It is a control role and it keeps the control model.
 *
 * ⛔ SO THESE TESTS WATCH ROLES, NOT SETTINGS. The file above this one proves the FACTORY
 * hands out the right adapter per lane. That is necessary and not sufficient: it cannot see
 * what happens once both adapters are inside one turn. These drive the real `processIntake`
 * with two distinguishable adapters and ask, per model call, WHICH ONE ANSWERED.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   Run: node --test src/intake/chatBrainAuthoritySeparation.test.js
 */

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

const { processIntake } = require('./intakeService')
const { A4_ROLES } = require('./a4Runtime')
const { createDemoRouter } = require('../routes/demoRouter')
const { getAdapterForLane, CHAT_MODEL_ENV } = require('../adapters/adapterFactory')

const HAIKU = 'claude-haiku-4-5-20251001'
const OPUS = 'claude-opus-5'

/* ═══ a tagged adapter: it records every call and says which role it answered ═══ */

function tagged (tag, replies) {
  let i = 0
  return {
    tag,
    calls: [],
    async complete (prompt, opts = {}) {
      this.calls.push({ schema: opts.responseFormat ? opts.responseFormat.name : null })
      const body = replies[Math.min(i, replies.length - 1)]
      i++
      return {
        text: typeof body === 'string' ? body : JSON.stringify(body),
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        model: tag, latencyMs: 1, stopReason: 'end_turn'
      }
    }
  }
}

const PLAN = { facts: [] }                                                     // B's envelope
const ANSWER = { intent: 'question', mode: 'chat', reply: '好', nextRead: null }
const READ = (cap) => ({ intent: 'question', mode: 'chat', reply: '睇睇先', nextRead: { capability: cap } })

const row = (sourceId, title) => ({
  source: 'drive', sourceId, title, originalDate: '2026-08-19', content: 'sanitised',
  retrievedAt: '2026-08-21', link: null, trust: 'live', error: null
})
const ROWS = [row('f1', 'SANITISED-DOC-A'), row('f2', 'SANITISED-DOC-B')]

function stubConnector (rows) {
  return {
    async read (source) {
      if (source !== 'drive') throw new Error('not wired')
      return { asOf: '2026-08-21', source, count: rows.length, results: rows }
    }
  }
}

const BASE_ENV = {
  GOAL_DECOMPOSER: 'on', MULTI_AI_ROUTER: 'off', A4_KNOWLEDGE_ROUTING: 'off',
  READ_ACCESS: 'on', CONTEXT_DRIVE: 'on', CONTEXT_GMAIL: 'off', CONTEXT_CALENDAR: 'off',
  CONVERSATION_DEMO: 'on', DECISION_RECALL: 'off', CONVERSATION_RECALL: 'off',
  TURN_ROUTER: 'off', XIANGXIARCHIVE: 'off'
}

async function withEnv (vars, fn) {
  const all = Object.assign({}, BASE_ENV, vars)
  const saved = {}
  for (const k of Object.keys(all)) {
    saved[k] = Object.prototype.hasOwnProperty.call(process.env, k) ? process.env[k] : undefined
    if (all[k] === null) delete process.env[k]; else process.env[k] = all[k]
  }
  try { return await fn() } finally {
    for (const k of Object.keys(all)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

/** One chat turn with a brain and a separate control adapter. */
async function chatTurn ({ brainReplies, controlReplies = [PLAN], separate = true, extraOpts = {} }) {
  const brain = tagged(OPUS, brainReplies)
  const control = tagged(HAIKU, controlReplies)
  const opts = Object.assign({
    demo: true, interactionMode: 'chat', providerHint: 'claude', requestId: 'req_c3c'
  }, separate ? { controlAdapter: control } : {}, extraOpts)
  const res = await processIntake('幫我睇下 Drive 有咩文件', brain, [], opts)
  return { res, brain, control }
}

/* ═══ 1 + 3. THE TWO ROLES SPLIT, IN ONE REAL TURN ═════════════════════════ */

describe('C3C (1,3) the brain answers and the decomposer does not follow it', () => {
  test('*** ⛔ the MAIN chat call lands on the chat brain ***', async () => {
    await withEnv({}, async () => {
      const { brain } = await chatTurn({ brainReplies: [ANSWER] })
      assert.equal(brain.calls.length, 1, 'exactly the main call, on the brain')
    })
  })

  test('*** ⛔ the GOAL DECOMPOSER lands on the CONTROL adapter, never the brain ***', async () => {
    await withEnv({}, async () => {
      const { brain, control } = await chatTurn({ brainReplies: [ANSWER] })
      // ⛔ IDENTIFIED BY SCHEMA, NOT BY POSITION. A count says two adapters were used; the
      // schema name says WHICH ROLE each one answered, which is the actual claim.
      assert.deepEqual(control.calls.map((c) => c.schema), ['goal_plan'],
        '⛔ the control adapter did not answer the decomposer')
      assert.equal(brain.calls.some((c) => c.schema === 'goal_plan'), false,
        '⛔ B borrowed the Owner-facing brain')
      assert.equal(brain.calls.length, 1)
    })
  })

  test('*** ⛔ NO DUPLICATED MODEL CALL — the turn still costs what it cost ***', async () => {
    // The separation moves a call between two already-constructed adapters. It must not add
    // one: two adapters, still exactly two provider calls on a plain chat turn.
    await withEnv({}, async () => {
      const { brain, control } = await chatTurn({ brainReplies: [ANSWER] })
      assert.equal(brain.calls.length + control.calls.length, 2)
    })
  })

  test('*** with B off, the control adapter is never asked anything at all ***', async () => {
    await withEnv({ GOAL_DECOMPOSER: 'off' }, async () => {
      const { brain, control } = await chatTurn({ brainReplies: [ANSWER] })
      assert.equal(control.calls.length, 0)
      assert.equal(brain.calls.length, 1)
    })
  })
})

/* ═══ 2. POST-READ REASONING STAYS ON THE BRAIN ════════════════════════════ */

describe('C3C (2) post-read reasoning and the reserved compose stay on the brain', () => {
  test('*** ⛔ every call after the read is answered by the chat brain ***', async () => {
    await withEnv({ A4_KNOWLEDGE_ROUTING: 'on' }, async () => {
      const brain = tagged(OPUS, [READ('drive'), ANSWER, ANSWER, ANSWER])
      const control = tagged(HAIKU, [PLAN])
      await processIntake('幫我睇下 Drive 有咩文件', brain, [], {
        demo: true, interactionMode: 'chat', providerHint: 'claude',
        controlAdapter: control,
        readContextDeps: { sources: ['drive'], connector: stubConnector(ROWS) }
      })
      // The read turn is main + at least one post-read reasoning call. All of them are the brain.
      // ⛔ THE LOOP IS SEEN TO HAVE RUN. Call 1 asks for the read (`distill_with_read_decision`),
      // call 2 is the post-read answer (`distill_with_answer_plan`). If the loop had not run,
      // the second schema would simply be absent and a count-only assertion would not notice.
      const schemas = brain.calls.map((c) => c.schema)
      assert.ok(schemas.includes('distill_with_read_decision'), 'no read was requested: ' + schemas)
      assert.ok(schemas.includes('distill_with_answer_plan'), 'no post-read call happened: ' + schemas)
      assert.deepEqual(control.calls.map((c) => c.schema), ['goal_plan'],
        '⛔ the control adapter answered something other than exactly the decomposer')
      assert.equal(schemas.includes('goal_plan'), false, '⛔ B ran on the brain')
    })
  })
})

/* ═══ 4–7 + 12–13. EVERY OTHER AUTHORITY IS UNMOVED ═══════════════════════ */

describe('C3C (4,5,6,7) no other lane or role follows the chat pin', () => {
  test('*** ⛔ email_draft, proposal and the no-lane path all resolve to CLAUDE_MODEL ***', async () => {
    const saved = { p: process.env.LLM_PROVIDER, m: process.env.CLAUDE_MODEL, c: process.env[CHAT_MODEL_ENV] }
    delete process.env.LLM_PROVIDER
    process.env.CLAUDE_MODEL = HAIKU
    process.env[CHAT_MODEL_ENV] = OPUS
    try {
      assert.equal(getAdapterForLane('email_draft')._model, HAIKU)
      assert.equal(getAdapterForLane('proposal')._model, HAIKU)
      assert.equal(getAdapterForLane()._model, HAIKU)       // legacy /intake, intent classifier
      assert.equal(getAdapterForLane('chat')._model, OPUS)  // and the brain did move
    } finally {
      if (saved.p === undefined) delete process.env.LLM_PROVIDER; else process.env.LLM_PROVIDER = saved.p
      if (saved.m === undefined) delete process.env.CLAUDE_MODEL; else process.env.CLAUDE_MODEL = saved.m
      if (saved.c === undefined) delete process.env[CHAT_MODEL_ENV]; else process.env[CHAT_MODEL_ENV] = saved.c
    }
  })

  test('*** ⛔ the dispatch worker keeps its existing injected authority — the TURN adapter ***', () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const src = fs.readFileSync(path.join(__dirname, 'intakeService.js'), 'utf8')
    assert.match(src, /executeDispatch\(dispatch\.id, adapter, \{ decisionStatement \}\)/,
      '⛔ the dispatch worker was handed something other than the turn adapter')
    // And that path is unreachable from chat: a chat turn returns before persist/dispatch.
    assert.match(src, /if \(interactionMode === 'chat' && distilled\.mode === 'commit'\)/,
      'the chat commit-coercion gate must still stand in front of the dispatch tail')
  })

  test('*** ⛔ the legacy /intake route names no lane, so it cannot reach the pin ***', () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'intakeRouter.js'), 'utf8')
    assert.doesNotMatch(src, /getAdapterForLane|controlAdapter|CLAUDE_CHAT_MODEL/,
      '⛔ the legacy route acquired chat-lane model authority')
    assert.match(src, /getAdapter\(\)/, 'it must keep the ordinary factory call')
  })

  test('*** ⛔ 12/13 — no controlAdapter means the decomposer keeps the turn adapter ***', async () => {
    // This is production today, and it must be byte-identical to the turn before C3 existed:
    // one adapter, both roles, exactly as `phaseTiming.test.js` has always pinned it.
    await withEnv({}, async () => {
      const { brain, control } = await chatTurn({ brainReplies: [PLAN, ANSWER], separate: false })
      assert.equal(control.calls.length, 0, 'nothing was injected, so nothing was diverted')
      assert.deepEqual(brain.calls.map((c) => c.schema), ['goal_plan', 'distill_with_answer_plan'],
        'B and the main call, both on the one turn adapter — production today')
    })
  })
})

/* ═══ 8–11. THE PINNED SAFETY ROLES ═══════════════════════════════════════ */

describe('C3C (8,9,10,11) the pinned roles are untouched and cannot see the setting', () => {
  test('*** ⛔ sourceIntentResolver / finalVerifier / publicQueryPlanner / recoveryWorker ***', () => {
    assert.equal(A4_ROLES.sourceIntentResolver.model, 'gpt-5.6-terra')
    assert.equal(A4_ROLES.finalVerifier.model, 'gpt-5.6-terra')
    assert.equal(A4_ROLES.publicQueryPlanner.model, 'gpt-5.6-terra')
    assert.equal(A4_ROLES.recoveryWorker.model, HAIKU)
  })

  test('*** ⛔ a4Runtime reads neither the chat setting nor the control adapter ***', () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const src = fs.readFileSync(path.join(__dirname, 'a4Runtime.js'), 'utf8')
    assert.doesNotMatch(src, /CLAUDE_CHAT_MODEL/, '⛔ a safety composer can see the canary setting')
    assert.doesNotMatch(src, /controlAdapter/, '⛔ a safety composer can see the control seam')
  })
})

/* ═══ 14–15. PROVIDER ROUTING ═════════════════════════════════════════════ */

describe('C3C (14,15) provider routing is not a model decision', () => {
  test('*** ⛔ OpenAI stays primary for chat under the router, pin or no pin ***', () => {
    const { selectPrimaryProvider } = require('../routing/modelRouter')
    const saved = process.env[CHAT_MODEL_ENV]
    try {
      const env = { MULTI_AI_ROUTER: 'on' }
      process.env[CHAT_MODEL_ENV] = OPUS
      assert.equal(selectPrimaryProvider(env, { interactionMode: 'chat' }), 'openai')
      assert.equal(selectPrimaryProvider(env, { interactionMode: 'chat', providerHint: 'claude' }), 'claude')
      assert.equal(selectPrimaryProvider(env, { interactionMode: 'proposal' }), 'claude')
      delete process.env[CHAT_MODEL_ENV]
      assert.equal(selectPrimaryProvider(env, { interactionMode: 'chat' }), 'openai',
        'removing the pin must not move a provider either')
    } finally {
      if (saved === undefined) delete process.env[CHAT_MODEL_ENV]; else process.env[CHAT_MODEL_ENV] = saved
    }
  })

  test('*** ⛔ modelRouter holds no CLAUDE_CHAT_MODEL authority ***', () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const src = fs.readFileSync(path.join(__dirname, '..', 'routing', 'modelRouter.js'), 'utf8')
    assert.doesNotMatch(src, /CLAUDE_CHAT_MODEL|controlAdapter|getAdapterForLane/,
      '⛔ the Multi-AI Router was drawn into a model decision')
  })
})

/* ═══ THE WIRING THE ROUTER ACTUALLY PERFORMS ═════════════════════════════ */

describe('C3C the demo router supplies both adapters, and only on the chat lane', () => {
  function appWith (getAdapterFn, capture) {
    const app = express()
    app.use(express.json())
    app.locals.conversationDemo = true
    app.locals.promoteToProposal = async () => ({ ok: true, proposal: { id: 'p_t', status: 'pending' } })
    app.use(createDemoRouter({
      getAdapterFn,
      processIntakeFn: async (message, adapter, history, opts) => {
        capture.push({ adapter, opts: opts || {} })
        return { blocked: false, reply: 'ok', mode: 'chat' }
      }
    }))
    return app
  }
  /** ⛔ THE PIN IS SET WHILE THESE RUN. Found by MUT-C3C-6: with CLAUDE_CHAT_MODEL absent,
   *  a control adapter that wrongly followed the pin is indistinguishable from one that
   *  did not, because both asks resolve to the same model. The canary condition is the
   *  only condition under which this wiring can be observed at all. */
  async function post (app, body) {
    const server = app.listen(0)
    await new Promise((r) => server.once('listening', r))
    try {
      await fetch('http://127.0.0.1:' + server.address().port + '/api/v1/demo/intake', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
      })
    } finally { server.close() }
  }

  test('*** ⛔ chat receives the BRAIN as its adapter and the CONTROL adapter beside it ***', async () => {
    const cap = []
    const factory = (lane) => ({ providerName: 'spy', role: lane === 'chat' ? 'brain' : 'control' })
    await withEnv({ [CHAT_MODEL_ENV]: OPUS }, () =>
      post(appWith(factory, cap), { message: 'hello', interactionMode: 'chat' }))
    assert.equal(cap.length, 1)
    assert.equal(cap[0].adapter.role, 'brain')
    assert.ok(cap[0].opts.controlAdapter, '⛔ no control adapter was supplied to a chat turn')
    assert.equal(cap[0].opts.controlAdapter.role, 'control')
  })

  test('*** ⛔ no other lane is given a controlAdapter — it already IS the control adapter ***', async () => {
    for (const lane of ['email_draft', 'proposal']) {
      const cap = []
      const factory = (l) => ({ providerName: 'spy', role: l === 'chat' ? 'brain' : 'control' })
      await withEnv({ [CHAT_MODEL_ENV]: OPUS }, () =>
        post(appWith(factory, cap), { message: 'hello', interactionMode: lane }))
      assert.equal(cap.length, 1, lane)
      assert.equal(cap[0].adapter.role, 'control', lane + ' must run on the control adapter')
      assert.equal(cap[0].opts.controlAdapter, undefined,
        '⛔ ' + lane + ' was given a separation it does not need')
    }
  })
})
