'use strict'

/**
 * phaseTiming.test.js — L1. WHERE DID THE TURN SPEND ITS TIME, AND DID ASKING CHANGE IT?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE MEASURED INCIDENT. requestId db383e13-86bd-455c-8169-c38401fd549c, 2026-08-21
 * 07:59 local: the Owner typed 「你好」 and waited 15,226 ms server-side. The logs could
 * prove the main model call (6,345 ms), the final-obligation gate (2,889 ms) and the
 * total — and nothing else. The remaining 5,958 ms, 39% of the turn, contained a goal
 * decomposer model call that logged its outcome without its duration, and a prompt build
 * that was never timed at all.
 *
 * L1 adds the missing measurements and NOTHING ELSE. These tests exist to prove exactly
 * that second half: the greeting still makes the same three model calls, in the same
 * order, producing the same bytes, whether or not anything is watching.
 *
 * ⛔ THREE MODEL CALLS IS NOT ENDORSED HERE. `*** the greeting still costs THREE model
 * calls ***` is a PRESERVATION test: it pins today's cost so a later tranche can be shown
 * to have changed it deliberately. It is the thing to fix, recorded as a fact.
 *
 * Deterministic: scripted adapters, injected clock, injected sink. ZERO real provider
 * call, ZERO paid call, ZERO connector call, ZERO network.
 *
 *   Run: node --test src/intake/phaseTiming.test.js
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  PHASE, PHASES, ROLE, ROLES, OUTCOME, ALLOWED, PHASE_CONTAINMENT,
  emitPhase, timePhase, timePhaseSync, startTimer
} = require('../utils/phaseTiming')
const { processIntake } = require('./intakeService')
const { A4_FLAG } = require('./a4Contract')

/* ═══ a deterministic clock and a capturing sink ═══════════════════════════ */

/** Advances only when the test says so — no sleeps, no wall-clock dependence. */
function fakeClock (start = 1000) {
  let t = start
  const clock = () => t
  clock.advance = (ms) => { t += ms }
  return clock
}

function capture () {
  const records = []
  return {
    records,
    sink: (_tag, body) => records.push(JSON.parse(body)),
    of: (phase) => records.filter((r) => r.phase === phase),
    roles: () => records.filter((r) => r.phase === PHASE.MODEL_CALL).map((r) => r.role)
  }
}

/* ═══ 1. THE HELPER ITSELF ═════════════════════════════════════════════════ */

test('*** a phase records exactly the injected interval, from a monotonic clock ***', async () => {
  const clock = fakeClock()
  const cap = capture()
  const out = await timePhase(
    { requestId: 'r1', phase: PHASE.MODEL_CALL, role: ROLE.GOAL_DECOMPOSER },
    async () => { clock.advance(4321); return 'value' },
    { clock, sink: cap.sink })

  assert.equal(out, 'value', 'the awaited value passes through untouched')
  assert.equal(cap.records.length, 1)
  assert.equal(cap.records[0].durationMs, 4321, 'the measured interval IS the injected one')
  assert.equal(cap.records[0].outcome, OUTCOME.OK)
  assert.equal(cap.records[0].requestId, 'r1')
})

test('*** a THROWN phase is still timed, and the error is rethrown unchanged ***', async () => {
  const clock = fakeClock()
  const cap = capture()
  const boom = new Error('provider exploded')
  await assert.rejects(
    () => timePhase({ requestId: 'r1', phase: PHASE.MODEL_CALL, role: ROLE.GOAL_DECOMPOSER },
      async () => { clock.advance(777); throw boom }, { clock, sink: cap.sink }),
    (e) => e === boom, '⛔ the wrapper must not swallow or replace the error')
  assert.equal(cap.records[0].durationMs, 777, '「slow then failed」 is not 「failed instantly」')
  assert.equal(cap.records[0].outcome, OUTCOME.ERROR)
})

test('*** the sync twin behaves identically ***', () => {
  const clock = fakeClock()
  const cap = capture()
  const v = timePhaseSync({ requestId: 'r1', phase: PHASE.DECISION_RECALL, within: PHASE.PROMPT_BUILD },
    () => { clock.advance(12); return 42 }, { clock, sink: cap.sink })
  assert.equal(v, 42)
  assert.equal(cap.records[0].durationMs, 12)
  assert.equal(cap.records[0].within, PHASE.PROMPT_BUILD)
})

test('*** startTimer measures from call to call ***', () => {
  const clock = fakeClock()
  const elapsed = startTimer(clock)
  clock.advance(250)
  assert.equal(Math.round(elapsed()), 250)
})

/* ═══ 2. THE PRIVACY FENCE IS STRUCTURAL ═══════════════════════════════════ */

test('*** ⛔ NO CONTENT CAN REACH A LATENCY RECORD, EVEN IF A CALLER PASSES IT ***', () => {
  const cap = capture()
  const rec = emitPhase({
    requestId: 'r1',
    phase: PHASE.MODEL_CALL,
    role: ROLE.MAIN,
    durationMs: 5,
    // Every one of these is a leak a future caller could attempt. None may survive.
    message: '你好',
    prompt: 'SYSTEM: you are…',
    system: 'persona bytes',
    response: '你好，Louie。',
    text: 'reply text',
    history: [{ role: 'user', content: '你好' }],
    rows: [{ id: 1 }],
    items: ['a'],
    credential: 'sk-live-abc',
    token: 'ya29.secret',
    path: 'C:\\Aroma\\aroma-agent-backend\\.env'
  }, cap.sink)

  for (const banned of ['message', 'prompt', 'system', 'response', 'text', 'history', 'rows', 'items', 'credential', 'token', 'path']) {
    assert.equal(banned in rec, false, '⛔ ' + banned + ' reached the latency record')
  }
  assert.deepEqual(Object.keys(rec).filter((k) => !ALLOWED.includes(k)), [], '⛔ a non-allowlisted key survived')
  const line = JSON.stringify(cap.records[0])
  for (const needle of ['你好', 'sk-live', 'ya29', 'C:\\\\Aroma', 'persona bytes']) {
    assert.equal(line.includes(needle), false, '⛔ content leaked into the emitted line: ' + needle)
  }
})

test('*** the vocabulary is closed — unknown phases and roles are refused ***', () => {
  const cap = capture()
  assert.equal(emitPhase({ requestId: 'r', phase: 'not_a_phase', durationMs: 1 }, cap.sink), null)
  assert.equal(emitPhase({ requestId: 'r', phase: PHASE.MODEL_CALL }, cap.sink), null, 'no duration → no record')
  const rec = emitPhase({ requestId: 'r', phase: PHASE.MODEL_CALL, durationMs: 1, role: 'invented_role' }, cap.sink)
  assert.equal('role' in rec, false, 'an unknown role is dropped rather than logged')
  assert.equal(cap.records.length, 1, 'only the one valid record was emitted')
})

test('*** containment is declared as data, so sums cannot silently double-count ***', () => {
  for (const [inner, outer] of Object.entries(PHASE_CONTAINMENT)) {
    assert.ok(PHASES.includes(inner) && PHASES.includes(outer))
    assert.equal(outer, PHASE.PROMPT_BUILD)
  }
  // model_call(goal_decomposer) is nested too, but only in that role — the main call is not.
  assert.ok(ROLES.includes(ROLE.GOAL_DECOMPOSER) && ROLES.includes(ROLE.MAIN) && ROLES.includes(ROLE.FINAL_VERIFIER))
})

/* ═══ 3. THE GREETING, END TO END, WITH NOTHING REAL ═══════════════════════ */

const REQ = '11111111-2222-4333-8444-555555555555'
const GREETING = '你好'
const REPLY = '你好，Louie。最近如何？'

/** The goal decomposer asks first; the main call answers. Scripted, in order. */
function greetingAdapter () {
  const calls = []
  return {
    calls,
    async complete (prompt, opts = {}) {
      calls.push({ schemaName: opts.responseFormat ? opts.responseFormat.name : null })
      // Call 1 = goal decomposer (a plan with no facts, exactly as the real greeting produced).
      // Call 2 = the main reply envelope.
      const body = calls.length === 1
        ? { facts: [] }
        : { intent: 'question', mode: 'chat', reply: REPLY, nextRead: null, answerPlan: null }
      return { text: JSON.stringify(body), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'spy', latencyMs: 1, stopReason: 'end_turn' }
    }
  }
}

const BASE_ENV = {
  READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', TURN_ROUTER: 'on', MULTI_AI_ROUTER: 'off',
  GOAL_DECOMPOSER: 'on', [A4_FLAG]: 'on'
}

async function withEnv (over, fn) {
  const prev = {}
  const all = Object.assign({}, BASE_ENV, over)
  for (const k of Object.keys(all)) { prev[k] = process.env[k]; if (all[k] === null) delete process.env[k]; else process.env[k] = all[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(all)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k] }
  }
}

/** One greeting turn. `observe` false = no collector at all (the production default shape). */
async function greetTurn ({ observe = true, verifier } = {}) {
  const adapter = greetingAdapter()
  const cap = capture()
  const verifierCalls = []
  const finalVerifier = async (input) => { verifierCalls.push(input); return (verifier || { decision: 'allow_final', question: null }) }
  const out = await processIntake(GREETING, adapter, [], Object.assign({
    demo: true,
    interactionMode: 'chat',
    providerHint: 'claude',
    requestId: REQ,
    readContextDeps: { finalVerifier }
  }, observe ? { latencySink: cap.sink } : {}))
  return { out, adapter, cap, verifierCalls }
}

test('*** the greeting still costs THREE model calls — pinned, not endorsed ***', async () => {
  await withEnv({}, async () => {
    const t = await greetTurn()
    // adapter.complete covers goal_decomposer + main; the verifier is the third, injected.
    assert.equal(t.adapter.calls.length, 2, 'goal decomposer + main reply on the main adapter')
    assert.equal(t.verifierCalls.length, 1, 'the final verifier is the third model call')

    const roles = t.cap.roles()
    assert.equal(roles.filter((r) => r === ROLE.GOAL_DECOMPOSER).length, 1)
    assert.equal(roles.filter((r) => r === ROLE.MAIN).length, 1)
    assert.equal(roles.filter((r) => r === ROLE.FINAL_VERIFIER).length, 1)
    assert.equal(roles.length, 3, '⛔ MODEL_CALL_COUNT changed: ' + JSON.stringify(roles))
    assert.equal(roles.filter((r) => r === ROLE.REASONING_STEP).length, 0, 'the reasoning loop stays out of a greeting')
  })
})

test('*** MODEL_CALL_COUNT is countable from telemetry alone, without parsing prose ***', async () => {
  await withEnv({}, async () => {
    const t = await greetTurn()
    const calls = t.cap.of(PHASE.MODEL_CALL)
    assert.equal(calls.length, 3)
    for (const c of calls) {
      assert.ok(ROLES.includes(c.role), 'every model_call names a closed role')
      assert.equal(c.requestId, REQ, 'every record correlates to the turn')
      assert.ok(Number.isFinite(c.durationMs))
    }
  })
})

test('*** the goal decomposer is timed, and its own log line now carries durationMs ***', async () => {
  await withEnv({}, async () => {
    const t = await greetTurn()
    const goal = t.cap.of(PHASE.MODEL_CALL).filter((r) => r.role === ROLE.GOAL_DECOMPOSER)
    assert.equal(goal.length, 1, 'one attempt, one timing record')
    assert.equal(goal[0].within, PHASE.PROMPT_BUILD, 'declared as nested, so it is not added twice')
    assert.ok(Number.isFinite(goal[0].durationMs))
  })
})

test('*** prompt_build is measured, and a CACHE HIT emits nothing ***', async () => {
  await withEnv({}, async () => {
    const t = await greetTurn()
    const builds = t.cap.of(PHASE.PROMPT_BUILD)
    assert.ok(builds.length >= 1, 'the prompt build is measured at least once')
    // A greeting builds one prompt; any further buildPromptFor call is a cache hit and silent.
    assert.equal(builds.length, t.adapter.calls.length - 1 || 1,
      'prompt_build records track real builds, not cache reads: ' + builds.length)
    for (const b of builds) assert.equal(b.requestId, REQ)
  })
})

/* ═══ 4. ZERO BEHAVIOUR DRIFT ══════════════════════════════════════════════ */

test('*** ⛔ OBSERVING THE TURN DOES NOT CHANGE THE TURN ***', async () => {
  await withEnv({}, async () => {
    const observed = await greetTurn({ observe: true })
    const silent = await greetTurn({ observe: false })

    // The business result must be identical with and without a collector attached.
    assert.equal(silent.cap.records.length, 0, 'no collector → nothing captured')
    assert.equal(observed.out.reply, silent.out.reply, '⛔ reply bytes drifted')
    assert.equal(observed.out.reply, REPLY, 'and it is still the real reply')
    assert.equal(observed.out.mode, silent.out.mode, '⛔ mode drifted')
    assert.equal(observed.out.intent, silent.out.intent, '⛔ intent drifted')
    assert.equal(observed.adapter.calls.length, silent.adapter.calls.length, '⛔ model call COUNT drifted')
    assert.deepEqual(observed.adapter.calls, silent.adapter.calls, '⛔ model call ORDER or schema drifted')
    assert.equal(observed.verifierCalls.length, silent.verifierCalls.length, '⛔ verifier call count drifted')
    assert.deepEqual(observed.verifierCalls, silent.verifierCalls, '⛔ what the verifier was asked drifted')
  })
})

test('*** the greeting reads nothing and enters no reasoning step ***', async () => {
  await withEnv({}, async () => {
    const t = await greetTurn()
    assert.equal(t.cap.of(PHASE.LIVE_READ_CONTEXT).length, 0, 'a greeting performs no live read')
    assert.equal(t.cap.roles().filter((r) => r === ROLE.REASONING_STEP).length, 0)
  })
})

test('*** no latency record from a real turn carries Owner or provider content ***', async () => {
  await withEnv({}, async () => {
    const t = await greetTurn()
    assert.ok(t.cap.records.length > 0, 'there is something to check')
    for (const r of t.cap.records) {
      assert.deepEqual(Object.keys(r).filter((k) => !ALLOWED.includes(k)), [],
        '⛔ a non-allowlisted key appeared: ' + JSON.stringify(Object.keys(r)))
      const line = JSON.stringify(r)
      assert.equal(line.includes(GREETING), false, '⛔ the Owner message leaked')
      assert.equal(line.includes(REPLY), false, '⛔ the reply leaked')
      assert.equal(/[A-Za-z]:\\\\/.test(line), false, '⛔ an absolute path leaked')
    }
  })
})
