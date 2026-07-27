'use strict'

// intakeOutcomeLog.test.js — Observability v1. Deterministic; NO live API, NO paid call.
// Proves: one line per request on EVERY path (success / parse failure / early failure),
// no double-logging, stopReason present on success, and that no prompt / user content /
// model output / credential can ever reach the line.

const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-obs-test-'))

const http = require('node:http')
const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')

const { logIntakeOutcome, project, FIELDS } = require('./intakeOutcomeLog')
const { createDemoRouter } = require('../routes/demoRouter')
const { DistillParseError } = require('../intake/distillPrompt')
const express = require('express')

const CHAT = JSON.stringify({ intent: 'chit_chat', mode: 'chat', reply: 'REPLY_SENTINEL' })
const USER = 'USER_MESSAGE_SENTINEL'
const KEY = 'sk-ant-KEY_SENTINEL'

afterEach(() => { delete process.env.MULTI_AI_ROUTER })

/* ── the projection itself ────────────────────────────────────────────────── */
test('projection is an ALLOWLIST: unknown keys dropped, long strings dropped (never truncated in)', () => {
  const e = project({
    correlationId: 'cid', endpoint: '/x', interactionMode: 'chat', provider: 'claude',
    outcome: 'success', httpStatus: 200, latencyMs: 5, inputTokens: 10, outputTokens: 2,
    stopReason: 'end_turn', parseResult: 'ok', fallbackUsed: false, errorCode: null,
    prompt: 'LEAK', userMessage: 'LEAK', modelOutput: 'LEAK', apiKey: KEY // ← must vanish
  })
  assert.equal(e.event, 'INTAKE_OUTCOME')
  for (const bad of ['prompt', 'userMessage', 'modelOutput', 'apiKey']) assert.ok(!(bad in e), `${bad} must be dropped`)
  assert.ok(!JSON.stringify(e).includes('LEAK'))
  assert.ok(!JSON.stringify(e).includes(KEY))
  // an over-long "enum" is dropped entirely, not truncated into the log
  assert.equal(project({ provider: 'x'.repeat(65) }).provider, null)
  assert.equal(project({ provider: 'claude' }).provider, 'claude')
  // numbers must be numbers
  assert.equal(project({ inputTokens: 'many' }).inputTokens, null)
  assert.deepEqual(Object.keys(e).sort(), ['event', 'timestamp', ...FIELDS].sort())
})

test('logIntakeOutcome never throws, even on a hostile sink or input', () => {
  assert.doesNotThrow(() => logIntakeOutcome(null, { sink: () => { throw new Error('sink down') } }))
  assert.doesNotThrow(() => logIntakeOutcome(undefined))
  const seen = []
  logIntakeOutcome({ outcome: 'success' }, { sink: (e) => seen.push(e) })
  assert.equal(seen.length, 1)
})

/* ── end-to-end through the real route ────────────────────────────────────── */
function appWith (processIntakeFn, getAdapterFn = () => ({ async complete () { return {} } })) {
  const app = express()
  app.use(express.json())
  app.locals.conversationDemo = true
  app.use(createDemoRouter({ getAdapterFn, processIntakeFn }))
  return app
}
function post (app, body) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const data = JSON.stringify(body)
      const req = http.request({ port: server.address().port, path: '/api/v1/demo/intake', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (r) => {
        let b = ''; r.on('data', (d) => { b += d }); r.on('end', () => { server.close(); resolve({ status: r.statusCode, body: b }) })
      })
      req.on('error', (e) => { server.close(); reject(e) })
      req.end(data)
    })
  })
}
function captureOutcomes () {
  const lines = []
  const real = console.log
  console.log = (...a) => { if (String(a[0]).includes('[AROMA-INTAKE-OUTCOME]')) lines.push(JSON.parse(String(a[1]))); else real(...a) }
  return { lines, restore: () => { console.log = real } }
}

test('SUCCESS turn → exactly one outcome line with the expected fields (incl. stopReason)', async () => {
  const c = captureOutcomes()
  try {
    const app = appWith(async (msg, adapter, hist, opts) => {
      opts.telemetry.provider = 'claude'; opts.telemetry.interactionMode = 'chat'
      opts.telemetry.inputTokens = 8258; opts.telemetry.outputTokens = 120
      opts.telemetry.stopReason = 'end_turn'; opts.telemetry.parseResult = 'ok'
      return { mode: 'chat', reply: 'REPLY_SENTINEL', requestId: 'r' }
    })
    const res = await post(app, { message: USER, interactionMode: 'chat' })
    assert.equal(res.status, 200)
    assert.equal(c.lines.length, 1, 'exactly one line')
    const e = c.lines[0]
    assert.equal(e.outcome, 'success'); assert.equal(e.httpStatus, 200)
    assert.equal(e.provider, 'claude'); assert.equal(e.interactionMode, 'chat')
    assert.equal(e.inputTokens, 8258); assert.equal(e.outputTokens, 120)
    assert.equal(e.stopReason, 'end_turn') // FIX 3: present on the SUCCESS path
    assert.equal(e.parseResult, 'ok')
    assert.ok(typeof e.latencyMs === 'number' && e.correlationId)
  } finally { c.restore() }
})

test('PARSE-FAILURE turn → outcome line present, with parseResult/parseErrorReason', async () => {
  const c = captureOutcomes()
  try {
    const app = appWith(async (msg, adapter, hist, opts) => {
      opts.telemetry.provider = 'claude'; opts.telemetry.inputTokens = 900; opts.telemetry.outputTokens = 251
      opts.telemetry.stopReason = 'end_turn'; opts.telemetry.parseResult = 'failed'; opts.telemetry.parseErrorReason = 'fence_malformed'
      // a REAL DistillParseError — classify() dispatches on instanceof, not on .name
      throw new DistillParseError('fence_malformed', { rawSample: 'x' })
    })
    const res = await post(app, { message: USER, interactionMode: 'chat' })
    assert.equal(res.status, 500) // invalid_llm_output maps to 500 (existing contract)
    assert.equal(c.lines.length, 1)
    const e = c.lines[0]
    assert.equal(e.outcome, 'handled_error') // a provider WAS contacted
    assert.equal(e.parseResult, 'failed'); assert.equal(e.parseErrorReason, 'fence_malformed')
    assert.equal(e.outputTokens, 251); assert.equal(e.errorCode, 'invalid_llm_output')
  } finally { c.restore() }
})

test('EARLY failure BEFORE the model call → outcome line STILL produced (the invisibility fix)', async () => {
  const c = captureOutcomes()
  try {
    const app = appWith(async () => { throw new Error('boom before any provider') })
    const res = await post(app, { message: USER, interactionMode: 'chat' })
    assert.ok(res.status >= 400)
    assert.equal(c.lines.length, 1, 'the previously invisible case now logs')
    assert.equal(c.lines[0].outcome, 'early_error')
    assert.equal(c.lines[0].provider, null, 'no provider was reached')
  } finally { c.restore() }
})

test('VALIDATION rejection (before adapter acquisition) → outcome line produced', async () => {
  const c = captureOutcomes()
  try {
    let called = 0
    const app = appWith(async () => { called++; return {} })
    const res = await post(app, { message: '', interactionMode: 'chat' })
    assert.equal(res.status, 400)
    assert.equal(called, 0, 'pipeline never ran')
    assert.equal(c.lines.length, 1)
    assert.equal(c.lines[0].outcome, 'validation_rejected')
    assert.equal(c.lines[0].httpStatus, 400)
  } finally { c.restore() }
})

test('NO double-logging on any path', async () => {
  const c = captureOutcomes()
  try {
    const ok = appWith(async (m, a, h, o) => { o.telemetry.provider = 'claude'; return { mode: 'chat', reply: 'x' } })
    await post(ok, { message: USER, interactionMode: 'chat' })
    await post(ok, { message: USER, interactionMode: 'proposal' })
    const bad = appWith(async () => { throw new Error('nope') })
    await post(bad, { message: USER, interactionMode: 'chat' })
    assert.equal(c.lines.length, 3, 'one line per request, never two')
  } finally { c.restore() }
})

test('SENTINEL: no prompt / user content / model output / credential in any outcome line', async () => {
  const c = captureOutcomes()
  try {
    process.env.OPENAI_API_KEY = KEY
    const app = appWith(async (msg, adapter, hist, opts) => {
      opts.telemetry.provider = 'claude'
      return { mode: 'chat', reply: 'REPLY_SENTINEL', requestId: 'r' }
    })
    await post(app, { message: USER, interactionMode: 'chat', contextCard: { project: 'CARD_SENTINEL' } })
    const all = JSON.stringify(c.lines)
    for (const bad of [USER, 'REPLY_SENTINEL', 'CARD_SENTINEL', KEY, 'sk-ant', '守燈']) {
      assert.ok(!all.includes(bad), `outcome line must never contain: ${bad}`)
    }
  } finally { c.restore(); delete process.env.OPENAI_API_KEY }
})
