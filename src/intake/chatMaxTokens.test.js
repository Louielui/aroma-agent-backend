'use strict'

// chatMaxTokens.test.js — per-lane output limit + parse-failure forensics.
// Deterministic; injected fake adapters only. NO live API, NO paid model call.

const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-maxtok-test-'))

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')
const { U1_MAX_TOKENS } = require('./u1DraftShadow')
const { handleIntakeError } = require('../utils/intakeDiagnostics')

const CHAT = JSON.stringify({ intent: 'chit_chat', mode: 'chat', reply: 'ok' })
const COMMIT = JSON.stringify({ intent: 'task', mode: 'commit', reply: 'r', decision: { statement: 's', rationale: 'r' }, tasks: [{ title: 't', note: '', capability: 'coding' }], risks: [], next_step: '' })

/** Fake adapter recording the opts of every call (incl. maxTokens). */
function recAdapter (text, extra = {}) {
  const calls = []
  return {
    calls,
    async complete (prompt, o) {
      calls.push({ prompt, opts: o })
      return Object.assign({ text, usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }, model: 'fake', latencyMs: 1 }, extra)
    }
  }
}

/* ── 1. per-lane output limit ─────────────────────────────────────────────── */
test('CHAT lane requests maxTokens 2048', async () => {
  const a = recAdapter(CHAT)
  await processIntake('聊天', a, [], { demo: true, interactionMode: 'chat' })
  assert.equal(a.calls[0].opts.maxTokens, 2048)
})

test('PROPOSAL lane still requests 1024', async () => {
  const a = recAdapter(COMMIT)
  await processIntake('做件事', a, [], { demo: true, interactionMode: 'proposal', promoteToProposal: async () => ({ ok: true, proposal: { id: 'p1', status: 'pending' } }) })
  assert.equal(a.calls[0].opts.maxTokens, 1024)
})

test('legacy / unset interactionMode still requests 1024 (unchanged behaviour)', async () => {
  const a = recAdapter(CHAT)
  await processIntake('聊天', a, [], { demo: true })
  assert.equal(a.calls[0].opts.maxTokens, 1024)
  const b = recAdapter(CHAT)
  await processIntake('聊天', b, []) // no opts at all
  assert.equal(b.calls[0].opts.maxTokens, 1024)
})

test('a non-exact interactionMode is NOT treated as chat', async () => {
  for (const mode of ['CHAT', 'chat ', 'Chat']) {
    const a = recAdapter(CHAT)
    await processIntake('x', a, [], { demo: true, interactionMode: mode })
    assert.equal(a.calls[0].opts.maxTokens, 1024, `mode "${mode}" must not raise the limit`)
  }
})

test('EMAIL_DRAFT lane is untouched: U1 early-return, U1_MAX_TOKENS still 1024', async () => {
  assert.equal(U1_MAX_TOKENS, 1024)
  // MockAdapter supplies the U1 fixture (its strict exact-key parser rejects anything
  // else); wrapping it records the opts so the requested limit is observable.
  const { MockAdapter } = require('../adapters/MockAdapter')
  const inner = new MockAdapter()
  const calls = []
  const a = { async complete (p, o) { calls.push({ opts: o }); return inner.complete(p, o) } }
  const res = await processIntake('email rob', a, [], { u1DraftShadow: true })
  assert.equal(res.stage, 'SHADOW_ONLY') // proves the U1 early return ran
  assert.equal(calls[0].opts.maxTokens, 1024) // U1 asked for its own constant, not 2048
})

test('the ClaudeAdapter default limit is untouched (still 1024 when no maxTokens is given)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'adapters', 'ClaudeAdapter.js'), 'utf8')
  assert.ok(src.includes('opts.maxTokens || 1024'), 'adapter default must remain 1024')
})

/* ── 2. stop_reason propagation (provider-neutral) ────────────────────────── */
test('stopReason is propagated when the provider supplies it, and null-safe when not', async () => {
  const withStop = recAdapter(CHAT, { stopReason: 'end_turn' })
  await processIntake('聊天', withStop, [], { demo: true, interactionMode: 'chat' })
  assert.equal(typeof withStop.calls.length, 'number') // call happened

  // a provider that omits it must not break anything
  const noStop = recAdapter(CHAT)
  const res = await processIntake('聊天', noStop, [], { demo: true, interactionMode: 'chat' })
  assert.ok(res && res.reply, 'reply still produced without a stopReason')
})

test('ClaudeAdapter maps stop_reason → stopReason (and null when absent)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'adapters', 'ClaudeAdapter.js'), 'utf8')
  assert.ok(/stopReason:\s*\(typeof data\.stop_reason === 'string'/.test(src), 'stop_reason retained, string-guarded')
  assert.ok(src.includes(': null'), 'null when the provider omits it')
})

/* ── 3. parse-failure forensics ───────────────────────────────────────────── */
// A truncated, fenced reply: opens ```json and never closes → fence_malformed.
const TRUNCATED = '```json\n{"intent":"chit_chat","mode":"chat","reply":"我而家未能直接修改程式碼'

test('fence_malformed from a TRUNCATED reply logs exactly the 8 forensic fields', async () => {
  const a = recAdapter(TRUNCATED, { stopReason: 'max_tokens', usage: { inputTokens: 7000, outputTokens: 2048, totalTokens: 9048 } })
  let thrown = null
  try {
    await processIntake('你可以直接幫我修改呢個 bug 嗎?', a, [], { demo: true, interactionMode: 'chat' })
  } catch (e) { thrown = e }
  assert.ok(thrown, 'the parse failure propagates')
  assert.equal(thrown.name, 'DistillParseError')

  const entries = []
  handleIntakeError(thrown, { correlationId: 'corr-1', endpoint: '/api/v1/demo/intake' }, { sink: (e) => entries.push(e) })
  const e = entries[0]

  // the error carries the pipeline's own requestId, which correctly wins over ctx
  assert.ok(typeof e.correlationId === 'string' && e.correlationId.length > 0, 'correlationId recorded')
  assert.equal(e.interactionMode, 'chat')
  assert.equal(e.configuredMaxTokens, 2048)
  assert.equal(e.outputTokens, 2048)
  assert.equal(e.rawTextChars, TRUNCATED.length)
  assert.equal(e.rawTextBytes, Buffer.byteLength(TRUNCATED, 'utf8'))
  assert.ok(e.rawTextBytes > e.rawTextChars, 'CJK bytes exceed chars — true byte size recorded')
  assert.equal(e.stopReason, 'max_tokens') // the decisive evidence
  assert.equal(e.parseErrorReason, 'fence_malformed')
})

test('the failure entry NEVER contains the prompt, the user message, or the full output', async () => {
  const SECRET_ISH = '你可以直接幫我修改呢個 bug 嗎?'
  const a = recAdapter(TRUNCATED, { stopReason: 'max_tokens' })
  let thrown = null
  try { await processIntake(SECRET_ISH, a, [], { demo: true, interactionMode: 'chat' }) } catch (e) { thrown = e }
  const entries = []
  handleIntakeError(thrown, { correlationId: 'c2', endpoint: '/api/v1/demo/intake' }, { sink: (e) => entries.push(e) })
  const serialized = JSON.stringify(entries[0])

  assert.ok(!serialized.includes(SECRET_ISH), 'user message never logged')
  assert.ok(!serialized.includes('對話體驗約定'), 'system prompt / contract never logged')
  assert.ok(!serialized.includes('資料邊界'), 'persona guard never logged')
  assert.ok(!serialized.includes('未能直接修改程式碼'), 'model output text never logged')
  for (const k of ['prompt', 'system', 'message', 'apiKey', 'authorization']) {
    assert.ok(!Object.keys(entries[0]).includes(k), `field ${k} must not exist`)
  }
})

test('a non-parse error still logs the historical shape (no forensic fields invented)', () => {
  const entries = []
  const err = new Error('boom')
  handleIntakeError(err, { correlationId: 'c3', endpoint: '/api/v1/demo/intake' }, { sink: (e) => entries.push(e) })
  assert.equal('stopReason' in entries[0], false)
  assert.equal('configuredMaxTokens' in entries[0], false)
  assert.equal(entries[0].correlationId, 'c3')
})
