'use strict'

/**
 * turnRouterShadow.test.js — the shadow is WIRED, and it is inert.
 *
 * turnRouter.test.js proves the router's contract in isolation. This proves the two things
 * that isolation cannot:
 *   1. at TURN_ROUTER=off the pipeline is untouched — no log, no change, nothing;
 *   2. at 'shadow' a line really is emitted from a real turn, carrying what the pipeline
 *      ACTUALLY did, not a reconstruction.
 *
 * ── WHY (2) NEEDED ITS OWN TEST ──────────────────────────────────────────────
 * The shadow block is wrapped in a catch, because a telemetry observation may never break a
 * live turn. That wrapper also means a mistake inside it is INVISIBLE: my first draft read
 * `isChat` and `interactionMode`, which live in the per-provider closure and are out of
 * scope at that line. It would have thrown on every turn, been swallowed, and produced an
 * empty shadow log that looked exactly like "the Owner has not chatted yet". Days of
 * observation would have been spent collecting nothing.
 *
 * No paid call: the adapter is a fake.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')

/** A fake adapter — a plain chat reply, no Answer Plan, no network. */
function fakeAdapter (text) {
  const calls = []
  return {
    calls,
    name: 'fake',
    async complete (prompt, o) {
      calls.push({ prompt, system: o && o.system, responseFormat: o && o.responseFormat })
      return { text: JSON.stringify({ intent: 'question', mode: 'chat', reply: text || '好的。' }), provider: 'claude', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'fake' }
    }
  }
}

const withEnv = async (vars, fn) => {
  const saved = {}
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

/** Capture the shadow line off the console sink the module uses by default. */
function captureRouteLog () {
  const lines = []
  const orig = console.log
  console.log = (...a) => { if (a[0] === '[AROMA-TURN-ROUTE]') { try { lines.push(JSON.parse(a[1])) } catch (_) {} } }
  return { lines, restore: () => { console.log = orig } }
}

/* ═══ 1. OFF IS OFF ═════════════════════════════════════════════════════════ */

test('*** TURN_ROUTER unset → not a single shadow line ***', async () => {
  const cap = captureRouteLog()
  try {
    await withEnv({ TURN_ROUTER: undefined, READ_ACCESS: 'off' }, () =>
      processIntake('現在是幾點？', fakeAdapter(), [], { interactionMode: 'chat', demo: false }))
  } finally { cap.restore() }
  assert.equal(cap.lines.length, 0, 'the default must be silent AND inert')
})

test('an invalid value is off, not on', async () => {
  const cap = captureRouteLog()
  try {
    await withEnv({ TURN_ROUTER: 'true', READ_ACCESS: 'off' }, () =>
      processIntake('現在是幾點？', fakeAdapter(), [], { interactionMode: 'chat', demo: false }))
  } finally { cap.restore() }
  assert.equal(cap.lines.length, 0)
})

/* ═══ 2. SHADOW REALLY OBSERVES ════════════════════════════════════════════ */

test('*** at shadow a real turn emits a line that actually populated ***', async () => {
  const cap = captureRouteLog()
  let res
  try {
    res = await withEnv({ TURN_ROUTER: 'shadow', READ_ACCESS: 'off' }, () =>
      processIntake('現在是幾點？', fakeAdapter('目前時間我讀不到。'), [], { interactionMode: 'chat', demo: false }))
  } finally { cap.restore() }

  assert.equal(cap.lines.length, 1, 'exactly one line per turn')
  const l = cap.lines[0]
  assert.equal(l.event, 'TURN_ROUTE')
  assert.equal(l.route, 'UTILITY', 'the question that started all of this')
  assert.equal(l.utility, 'time')
  assert.equal(l.lane, 'chat', 'THE FIELD THAT WOULD HAVE BEEN NULL: read from opts, not the closure')
  assert.notEqual(l.requestId, null, 'and the turn is identifiable')
  assert.equal(typeof l.rowsRetrieved, 'number')
  assert.equal(typeof l.answerPlanForced, 'boolean')
  assert.ok(res && typeof res.reply === 'string', 'and the turn itself still completed')
})

test('*** shadow changes NOTHING about the turn ***', async () => {
  const run = (flag) => withEnv({ TURN_ROUTER: flag, READ_ACCESS: 'off' }, async () => {
    const a = fakeAdapter('固定回覆。')
    const r = await processIntake('你可以幫我做什麼？', a, [], { interactionMode: 'chat', demo: false })
    return { reply: r.reply, mode: r.mode, format: a.calls[0].responseFormat, prompt: a.calls[0].prompt, system: a.calls[0].system }
  })
  const cap = captureRouteLog()
  let off, shadow
  try { off = await run(undefined); shadow = await run('shadow') } finally { cap.restore() }

  assert.equal(shadow.reply, off.reply, 'same reply')
  assert.equal(shadow.prompt, off.prompt, 'same prompt — no read was added or removed')
  assert.equal(shadow.system, off.system, 'same system string')
  assert.deepEqual(shadow.format, off.format, 'same response format — the Answer Plan decision is untouched')
})

test('the shadow line carries no message content', async () => {
  const cap = captureRouteLog()
  const secret = '幫我睇下 SUNCO FOODS 張發票係咪 98765 蚊'
  try {
    await withEnv({ TURN_ROUTER: 'shadow', READ_ACCESS: 'off' }, () =>
      processIntake(secret, fakeAdapter(), [], { interactionMode: 'chat', demo: false }))
  } finally { cap.restore() }
  const blob = JSON.stringify(cap.lines[0])
  assert.equal(blob.includes('SUNCO'), false)
  assert.equal(blob.includes('98765'), false)
  assert.equal(blob.includes('發票係咪'), false)
  assert.equal(cap.lines[0].domain, 'invoice', 'the DOMAIN is recorded; the words are not')
})
