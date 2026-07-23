'use strict'

/**
 * intakeErrorBoundary.test.js — B2-2 Slice B (service + HTTP).
 *
 * Proves: typed errors carry correlationId and propagate un-flattened; the router
 * emits the stable safe client contract with correct status (500/503) and never
 * leaks raw/provider/stack/path/detail; OFF success path unchanged (3-arg call,
 * requestId present, no top-level detail); demo opts are not lost when requestId
 * is threaded in.
 *
 *   Run: node --test src/routes/intakeErrorBoundary.test.js
 */

const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')

// Throwaway store BEFORE requiring the service.
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-sliceb-test-'))

const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

const { processIntake } = require('../intake/intakeService')
const { IntakeUpstreamError } = require('../intake/intakeErrors')
const { DistillParseError } = require('../intake/distillPrompt')
const adapterFactory = require('../adapters/adapterFactory')
const intakeRouter = require('./intakeRouter')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function adapterReturning (text) {
  return { async complete () { return { text, model: 'stub', latencyMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } } }
}
function adapterThrowing (err) {
  return { async complete () { throw err } }
}

// ── service level: typed errors carry correlationId, propagate un-flattened ──
test('service: malformed output → DistillParseError, carries the supplied requestId', async () => {
  let caught
  try {
    await processIntake('hi', adapterReturning('LEAK_sk-ant-SECRET not json'), [], { requestId: '00000000-0000-4000-8000-00000000000a' })
  } catch (e) { caught = e }
  assert.ok(caught instanceof DistillParseError, 'type preserved (not flattened to generic Error)')
  assert.equal(caught.correlationId, '00000000-0000-4000-8000-00000000000a')
  assert.equal(caught.reason, 'invalid_json')
})

test('service: non-HTTP caller with no requestId still gets a generated correlationId', async () => {
  let caught
  try { await processIntake('hi', adapterReturning('nope'), []) } catch (e) { caught = e }
  assert.ok(caught instanceof DistillParseError)
  assert.match(caught.correlationId, UUID)
})

test('service: invalid supplied requestId is NEVER used — a fresh UUID is generated', async () => {
  for (const bad of ['', 'not-a-uuid', 123, null, {}]) {
    let caught
    try { await processIntake('hi', adapterReturning('nope'), [], { requestId: bad }) } catch (e) { caught = e }
    assert.ok(caught instanceof DistillParseError)
    assert.match(caught.correlationId, UUID, `invalid requestId ${JSON.stringify(bad)} should be replaced`)
    assert.notEqual(caught.correlationId, bad)
  }
  // A valid UUID is honoured verbatim.
  let ok
  try { await processIntake('hi', adapterReturning('nope'), [], { requestId: '11111111-2222-4333-8444-555555555555' }) } catch (e) { ok = e }
  assert.equal(ok.correlationId, '11111111-2222-4333-8444-555555555555')
})

test('service: provider failure → IntakeUpstreamError (typed, carries id + cause)', async () => {
  const provErr = new Error('provider blew up sk-ant-SECRET /home/ubuntu/x')
  let caught
  try { await processIntake('hi', adapterThrowing(provErr), [], { requestId: '00000000-0000-4000-8000-00000000000b' }) } catch (e) { caught = e }
  assert.ok(caught instanceof IntakeUpstreamError)
  assert.equal(caught.correlationId, '00000000-0000-4000-8000-00000000000b')
  assert.equal(caught.cause, provErr)
})

test('service: demo opts (contextCard, promoteToProposal) survive alongside requestId', async () => {
  const commit = { intent: 'task', mode: 'commit', reply: 'ok', decision: { statement: 's', rationale: 'r' }, tasks: [{ title: 't1', note: '', capability: 'coding' }], risks: [], next_step: '' }
  const promoteCalls = []
  const res = await processIntake('x', adapterReturning(JSON.stringify(commit)), [], {
    requestId: '00000000-0000-4000-8000-00000000000c',
    demo: true,
    contextCard: { note: 'hello' },
    promoteToProposal: async (taskId) => { promoteCalls.push(taskId); return { ok: true, proposal: { id: 'p1', taskId } } }
  })
  assert.equal(res.requestId, '00000000-0000-4000-8000-00000000000c')
  assert.equal(res.demoOutcome, 'execution_proposal')
  assert.equal(promoteCalls.length, 1, 'promoteToProposal was invoked (opt not lost)')
  assert.ok(Array.isArray(res.contextCardWarnings), 'contextCard path ran (opt not lost)')
  assert.deepEqual(res.proposals, [{ id: 'p1', taskId: promoteCalls[0] }])
})

// ── HTTP level: real router, providers injected via the exported REGISTRY ────
const app = express()
app.use(express.json())
app.use('/api/v1/intake', intakeRouter)
const server = app.listen(0)
const PORT = server.address().port
after(() => { server.close(); fs.rmSync(process.env.AROMA_DATA_DIR, { recursive: true, force: true }) })

async function post (body) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/v1/intake`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  })
  const text = await r.text()
  let json; try { json = JSON.parse(text) } catch (_) {}
  return { status: r.status, json, text }
}

function withProvider (key, factory, fn) {
  const savedProvider = process.env.LLM_PROVIDER
  adapterFactory.REGISTRY[key] = factory
  process.env.LLM_PROVIDER = key
  return Promise.resolve().then(fn).finally(() => {
    delete adapterFactory.REGISTRY[key]
    if (savedProvider === undefined) delete process.env.LLM_PROVIDER; else process.env.LLM_PROVIDER = savedProvider
  })
}

test('HTTP: malformed output → 500 invalid_llm_output, safe body, no raw/detail leak', async () => {
  await withProvider('__malformed', () => adapterReturning('LEAK_sk-ant-SECRET this is not json'), async () => {
    const { status, json, text } = await post({ message: 'hello' })
    assert.equal(status, 500)
    assert.equal(json.error.code, 'invalid_llm_output')
    assert.equal(json.error.retryable, true)
    assert.match(json.error.correlationId, UUID)
    assert.equal('detail' in json, false)
    assert.ok(!text.includes('LEAK_sk-ant-SECRET') && !text.includes('not json'))
  })
})

test('HTTP: provider failure → 503 llm_unavailable, no provider text/path/stack', async () => {
  const provErr = new Error('boom sk-ant-SECRET at /home/ubuntu/secret.js:1')
  provErr.stack = 'Error: boom sk-ant-SECRET\n  at /home/ubuntu/secret.js:1'
  await withProvider('__throws', () => adapterThrowing(provErr), async () => {
    const { status, json, text } = await post({ message: 'hello' })
    assert.equal(status, 503)
    assert.equal(json.error.code, 'llm_unavailable')
    assert.equal(json.error.retryable, true)
    assert.match(json.error.correlationId, UUID)
    assert.ok(!text.includes('sk-ant-SECRET') && !text.includes('/home/ubuntu') && !text.includes('secret.js'))
    assert.ok(!text.toLowerCase().includes('stack'))
  })
})

test('HTTP: unknown provider (throws before service) → 500 internal_error via ctx fallback id', async () => {
  const savedProvider = process.env.LLM_PROVIDER
  process.env.LLM_PROVIDER = '__nope_provider__'
  try {
    const { status, json } = await post({ message: 'hello' })
    assert.equal(status, 500)
    assert.equal(json.error.code, 'internal_error')
    assert.equal(json.error.retryable, false)
    assert.match(json.error.correlationId, UUID)
  } finally {
    if (savedProvider === undefined) delete process.env.LLM_PROVIDER; else process.env.LLM_PROVIDER = savedProvider
  }
})

test('HTTP: OFF success unchanged — 200 with requestId, no top-level detail/error', async () => {
  await withProvider('__ok', () => adapterReturning(JSON.stringify({ intent: 'greeting', mode: 'chat', reply: 'hi' })), async () => {
    const { status, json } = await post({ message: 'hello' })
    assert.equal(status, 200)
    assert.match(json.requestId, UUID)
    assert.equal('detail' in json, false)
    assert.equal('error' in json, false)
  })
})
