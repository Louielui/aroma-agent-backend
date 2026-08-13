'use strict'

/**
 * reasoningLoop.test.js — the bounded Reason → Read → Observe → Reason → Final loop.
 *
 * > **Owner: 「Can Aroma encounter a question it cannot answer immediately, decide what
 * > existing information it needs, retrieve it itself, reason again using that result, and
 * > return the final answer within the same user turn?」**
 *
 * Every test here uses a DETERMINISTIC fake model and a fake reader. No paid call, no network.
 * The loop is provider-neutral by construction: it is handed a `callModel` function and never
 * learns which provider is behind it.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { runReasoningLoop, MAX_REASONING_STEPS, STOP } = require('./reasoningLoop')

/** A model that returns a scripted decision per step, recording what it was shown. */
function fakeModel (script) {
  const calls = []
  return {
    calls,
    fn: async ({ observations, step }) => {
      calls.push({ step, observations: observations.map((o) => ({ capability: o.capability, ok: o.ok })) })
      const d = script[calls.length - 1]
      if (!d) throw new Error('model called more times than scripted: ' + calls.length)
      return d
    }
  }
}

/** A reader that returns a scripted observation per capability. */
function fakeReader (byCapability) {
  const calls = []
  return {
    calls,
    fn: async ({ capability }) => {
      calls.push(capability)
      const r = byCapability[capability]
      if (typeof r === 'function') return r()
      return r
    }
  }
}

const CAPS = ['aroma_system', 'gmail']
const base = (over) => Object.assign({
  capabilities: CAPS,
  callModel: async () => ({ type: 'final', result: { reply: 'x' } }),
  executeRead: async () => ({ ok: true, summary: 's' })
}, over)

const FINAL = (reply) => ({ type: 'final', result: { reply } })
const READ = (capability, args) => ({ type: 'read', capability, args: args || {} })

/* ═══ 1. DIRECT ANSWER — ONE CALL, NO READ ═══════════════════════════════════ */

test('*** 1. FINAL on step 1 → exactly one model call, no read ***', async () => {
  const m = fakeModel([FINAL('答咗')])
  const r = fakeReader({})
  const out = await runReasoningLoop(base({ callModel: m.fn, executeRead: r.fn }))
  assert.equal(m.calls.length, 1, 'a direct question must not be forced through three calls')
  assert.equal(r.calls.length, 0, 'and must not read anything')
  assert.equal(out.stopReason, STOP.FINAL)
  assert.equal(out.steps, 1)
  assert.equal(out.result.reply, '答咗')
})

/* ═══ 2 + 9. ONE READ, AND THE OBSERVATION REACHES CALL 2 ════════════════════ */

test('*** 2+9. READ → observation → FINAL: two model calls, and call 2 SEES the data ***', async () => {
  const m = fakeModel([READ('aroma_system'), FINAL('done')])
  const r = fakeReader({ aroma_system: { ok: true, summary: '199 rows' } })
  const out = await runReasoningLoop(base({ callModel: m.fn, executeRead: r.fn }))

  assert.equal(m.calls.length, 2, 'exactly two model calls')
  assert.equal(r.calls.length, 1)
  assert.deepEqual(r.calls, ['aroma_system'])

  // ⛔ THE POINT OF THE WHOLE PHASE. Step 1 saw nothing; step 2 saw the read.
  assert.deepEqual(m.calls[0].observations, [], 'step 1 has no observations')
  assert.deepEqual(m.calls[1].observations, [{ capability: 'aroma_system', ok: true }],
    'step 2 receives what step 1 asked for — the Owner never carries it')
  assert.equal(out.observations[0].summary, '199 rows', 'and the payload survives intact')
  assert.equal(out.steps, 2)
})

/* ═══ 3. TWO READS ═══════════════════════════════════════════════════════════ */

test('*** 3. READ → READ → FINAL: three decisions, two reads, both observations carried ***', async () => {
  const m = fakeModel([READ('aroma_system'), READ('gmail'), FINAL('done')])
  const r = fakeReader({ aroma_system: { ok: true, summary: 'a' }, gmail: { ok: true, summary: 'b' } })
  const out = await runReasoningLoop(base({ callModel: m.fn, executeRead: r.fn }))
  assert.equal(m.calls.length, 3)
  assert.deepEqual(r.calls, ['aroma_system', 'gmail'])
  assert.equal(m.calls[2].observations.length, 2, 'the final call sees BOTH reads')
  assert.equal(out.stopReason, STOP.FINAL)
})

/* ═══ 4. EARLY STOP ══════════════════════════════════════════════════════════ */

test('*** 4. no extra call after FINAL ***', async () => {
  const m = fakeModel([READ('aroma_system'), FINAL('done')]) // script has no third entry
  const r = fakeReader({ aroma_system: { ok: true, summary: 'a' } })
  await runReasoningLoop(base({ callModel: m.fn, executeRead: r.fn }))
  assert.equal(m.calls.length, 2, 'a third call would have thrown from the fake')
})

/* ═══ 5. STEP LIMIT ══════════════════════════════════════════════════════════ */

test('*** 5. reads are stopped at MAX_REASONING_STEPS, then ONE reserved call to compose ***', async () => {
  /**
   * ⛔ OWNER RULING, 2026-08-12: THE COST GUARANTEE CHANGED FROM 3 MODEL CALLS TO 4.
   *
   * This asserted `calls.length === 3` and 「NO FOURTH MODEL CALL」. The bound of 3 was a COST
   * AND LATENCY ceiling, not a correctness boundary — and a legitimate class of business
   * question was measured spending all three on necessary reads, leaving nothing to compose
   * with (requestId a389dd4d-…, three reads all ok:true, then outcome:"fallback"
   * reason:"no_plan_returned").
   *
   * ⛔ WHAT IS UNCHANGED AND STILL ASSERTED BELOW: reads are still bounded at 3. The fourth
   * call is synthesis ONLY — a read decision in it is refused — so this is not the entry to a
   * further read loop. `MAX_REASONING_STEPS` is still 3 and still means 「reads」.
   */
  assert.equal(MAX_REASONING_STEPS, 3, 'the READ bound is explicit and is still three')
  const m = fakeModel([READ('aroma_system'), READ('gmail'), READ('aroma_system'), READ('gmail')])
  const r = fakeReader({ aroma_system: { ok: true, summary: 'a' }, gmail: { ok: true, summary: 'b' } })
  const out = await runReasoningLoop(base({ callModel: m.fn, executeRead: r.fn }))
  assert.equal(m.calls.length, 4, 'three reads plus ONE reserved compose call — and never five')
  assert.equal(r.calls.length, 3, '⛔ still exactly three READS — the fourth call cannot read')
  // This model answers READ on every call, including the reserved one, so it composes nothing.
  assert.equal(out.stopReason, STOP.STEP_LIMIT_NO_COMPOSE)
  assert.equal(out.result, null, 'and no answer is invented — the caller falls back deterministically')
  assert.equal(out.observations.length, 3, 'what WAS gathered is returned for the fallback to use')
})

/* ═══ 6. UNKNOWN TOOL — FAIL CLOSED ══════════════════════════════════════════ */

test('*** 6. an invented capability is NEVER executed ***', async () => {
  const m = fakeModel([READ('run_shell_command'), FINAL('done')])
  const r = fakeReader({})
  const out = await runReasoningLoop(base({ callModel: m.fn, executeRead: r.fn }))
  assert.equal(r.calls.length, 0, 'the reader was never called')
  assert.equal(out.observations[0].ok, false)
  assert.equal(out.observations[0].error, 'capability_not_allowed')
  assert.equal(m.calls[1].observations[0].ok, false, 'and the refusal is fed back as an observation')
})

/* ═══ 7. WRITE ATTEMPT — NEVER EXECUTED ══════════════════════════════════════ */

test('*** 7. a write/action request inside the loop is never executed ***', async () => {
  const r = fakeReader({})
  for (const bad of ['send_email', 'create_purchase_order', 'delete_invoice', 'aroma_system/draft']) {
    const m = fakeModel([READ(bad), FINAL('done')])
    const out = await runReasoningLoop(base({ callModel: m.fn, executeRead: r.fn }))
    assert.equal(r.calls.length, 0, bad + ' must not reach the reader')
    assert.equal(out.observations[0].ok, false, bad)
  }
})

test('*** an unrecognised decision TYPE is refused, not guessed ***', async () => {
  const m = fakeModel([{ type: 'execute', capability: 'aroma_system' }, FINAL('done')])
  const r = fakeReader({})
  const out = await runReasoningLoop(base({ callModel: m.fn, executeRead: r.fn }))
  assert.equal(r.calls.length, 0)
  assert.equal(out.observations[0].error, 'unknown_decision_type')
})

/* ═══ 8. READ FAILURE — CONTROLLED, NO RETRY STORM ═══════════════════════════ */

test('*** 8. a failed read becomes a controlled observation, and is not retried ***', async () => {
  const m = fakeModel([READ('aroma_system'), FINAL('done')])
  let n = 0
  const r = fakeReader({ aroma_system: () => { n++; throw new Error('upstream 500') } })
  const out = await runReasoningLoop(base({ callModel: m.fn, executeRead: r.fn }))
  assert.equal(n, 1, 'called ONCE — no retry loop')
  assert.equal(out.observations[0].ok, false)
  assert.equal(out.observations[0].error, 'read_failed')
  assert.equal(m.calls[1].observations[0].ok, false, 'the model is told the read failed')
  assert.equal(out.stopReason, STOP.FINAL, 'and the turn still completes')
})

test('*** a read that throws does not leak its message into the observation ***', async () => {
  const m = fakeModel([READ('aroma_system'), FINAL('done')])
  const r = fakeReader({ aroma_system: () => { throw new Error('SECRET supplier Miller 12345') } })
  const out = await runReasoningLoop(base({ callModel: m.fn, executeRead: r.fn }))
  assert.equal(JSON.stringify(out.observations[0]).includes('Miller'), false, 'no upstream content')
  assert.equal(JSON.stringify(out.observations[0]).includes('12345'), false)
})

/* ═══ 10. PROVIDER NEUTRALITY ════════════════════════════════════════════════ */

test('*** 10. the loop contains no provider-specific branch ***', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const src = fs.readFileSync(path.join(__dirname, 'reasoningLoop.js'), 'utf8')
  for (const token of ['claude', 'openai', 'gpt', 'anthropic', 'ClaudeAdapter', 'OpenAIAdapter']) {
    assert.equal(new RegExp('\\b' + token + '\\b', 'i').test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')), false,
      'provider-specific orchestration must stay behind the adapter boundary: ' + token)
  }
})

test('*** the same script yields the same trace whatever is behind callModel ***', async () => {
  const script = [READ('aroma_system'), FINAL('done')]
  const runs = []
  for (const label of ['providerA', 'providerB']) {
    const m = fakeModel(script.slice())
    const r = fakeReader({ aroma_system: { ok: true, summary: 's' } })
    const out = await runReasoningLoop(base({ callModel: m.fn, executeRead: r.fn, providerLabel: label }))
    runs.push({ steps: out.steps, stopReason: out.stopReason, reads: r.calls.slice() })
  }
  assert.deepEqual(runs[0], runs[1], 'orchestration is identical across providers')
})

/* ═══ 11. ACCOUNTING ═════════════════════════════════════════════════════════ */

test('*** 11. every model invocation is reported to the accounting hook ***', async () => {
  const recorded = []
  const m = fakeModel([READ('aroma_system'), READ('gmail'), FINAL('done')])
  const r = fakeReader({ aroma_system: { ok: true }, gmail: { ok: true } })
  await runReasoningLoop(base({
    callModel: m.fn,
    executeRead: r.fn,
    onModelCall: (info) => recorded.push(info.step)
  }))
  assert.deepEqual(recorded, [1, 2, 3], 'a three-step turn counts as THREE model invocations')
})

/* ═══ TELEMETRY IS STRUCTURAL ONLY ═══════════════════════════════════════════ */

test('*** telemetry carries no business content and no model prose ***', async () => {
  const events = []
  const m = fakeModel([READ('aroma_system'), FINAL('供應商 Miller 欠 12345 蚊')])
  const r = fakeReader({ aroma_system: { ok: true, summary: 'Napa Cabbage 18.000' } })
  await runReasoningLoop(base({ callModel: m.fn, executeRead: r.fn, onEvent: (e) => events.push(e) }))
  const blob = JSON.stringify(events)
  for (const secret of ['Miller', '12345', 'Napa', '18.000', '供應商']) {
    assert.equal(blob.includes(secret), false, 'leaked: ' + secret)
  }
  assert.ok(events.some((e) => e.decisionType === 'read'), 'the decision TYPE is recorded')
  assert.ok(events.every((e) => typeof e.reasoningStep === 'number'))
})
