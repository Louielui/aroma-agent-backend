'use strict'

// envelopeAndAccounting.test.js
//   (a) usage is recorded for EVERY provider call that returned, exactly once, even
//       when the envelope parse fails; both providers on a fallback turn.
//   (a2) an OpenAI failure carries HTTP status + provider error type/code — never a body.
//   (b) the envelope tolerates a ``` INSIDE the payload (outermost-fence rule) while
//       every previously-rejected shape stays rejected with the SAME reason.
// Deterministic fixtures only. NO live API, NO paid call.

const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-env-acct-test-'))

const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')

const { parseDistillResponse } = require('./distillPrompt')
const { processIntake } = require('./intakeService')
const { OpenAIAdapter } = require('../adapters/OpenAIAdapter')

const CHAT_OBJ = { intent: 'chit_chat', mode: 'chat', reply: 'ok' }
const CHAT = JSON.stringify(CHAT_OBJ)

afterEach(() => { delete process.env.MULTI_AI_ROUTER; delete process.env.OPENAI_MODEL; delete process.env.OPENAI_API_KEY })

/* ═══════════ (b) ENVELOPE: outermost-fence tolerance ═══════════ */

test('(b) ACCEPTED: clean JSON, ```json fence, bare ``` fence', () => {
  assert.equal(parseDistillResponse(CHAT).mode, 'chat')
  assert.equal(parseDistillResponse('```json\n' + CHAT + '\n```').mode, 'chat')
  assert.equal(parseDistillResponse('```\n' + CHAT + '\n```').mode, 'chat')
})

test('(b) ACCEPTED: fence whose JSON string value CONTAINS ``` (the real failing case)', () => {
  const inner = JSON.stringify({ intent: 'chit_chat', mode: 'chat', reply: '你可以咁寫: ```js\nconst a = 1\n``` 就得' })
  const r = parseDistillResponse('```json\n' + inner + '\n```')
  assert.equal(r.mode, 'chat')
  assert.ok(r.reply.includes('```js'), 'the inner fence survives as payload content')
})

test('(b) ACCEPTED: multi-line code block inside the reply string', () => {
  const inner = JSON.stringify({ intent: 'chit_chat', mode: 'chat', reply: '步驟:\n```bash\nnpm test\nnode --test\n```\n完成' })
  const r = parseDistillResponse('```json\n' + inner + '\n```')
  assert.equal(r.mode, 'chat')
  assert.ok(r.reply.includes('npm test'))
})

test('(b) STILL REJECTED: no closing fence (genuine truncation) -> fence_malformed', () => {
  assert.throws(() => parseDistillResponse('```json\n{"intent":"chit_chat","mode":"chat","reply":"cut'),
    (e) => { assert.equal(e.reason, 'fence_malformed'); return true })
})

test('(b) STILL REJECTED: language tag neither empty nor json -> fence_malformed', () => {
  for (const lang of ['javascript', 'js', 'JSONX', 'python']) {
    assert.throws(() => parseDistillResponse('```' + lang + '\n' + CHAT + '\n```'),
      (e) => { assert.equal(e.reason, 'fence_malformed'); return true }, lang)
  }
  // a single-line fence with no newline at all is still malformed
  assert.throws(() => parseDistillResponse('```' + CHAT + '```'), (e) => { assert.equal(e.reason, 'fence_malformed'); return true })
})

test('(b) STILL REJECTED: payload that is not valid JSON -> invalid_json', () => {
  assert.throws(() => parseDistillResponse('```json\nnot json at all\n```'),
    (e) => { assert.equal(e.reason, 'invalid_json'); return true })
  assert.throws(() => parseDistillResponse('```json\n{"a":1,}\n```'),
    (e) => { assert.equal(e.reason, 'invalid_json'); return true })
})

test('(b) STILL REJECTED: prose before the fence, and trailing prose after it', () => {
  assert.throws(() => parseDistillResponse('好的,以下是 JSON:\n```json\n' + CHAT + '\n```'),
    (e) => { assert.equal(e.reason, 'invalid_json'); return true }) // bare candidate -> JSON.parse rejects
  assert.throws(() => parseDistillResponse('```json\n' + CHAT + '\n```\n希望幫到你'),
    (e) => { assert.equal(e.reason, 'fence_malformed'); return true }) // does not end with a fence
})

test('(b) schema handling is UNCHANGED by the fence rule (documents the real contract)', () => {
  // PRE-EXISTING behaviour, deliberately not altered here: a JSON *object* with
  // unexpected keys is NORMALIZED to the envelope defaults rather than rejected...
  const normalized = parseDistillResponse('```json\n{"hello":"world"}\n```')
  assert.equal(normalized.mode, 'chat')
  assert.equal(normalized.intent, 'unclear')
  // ...while a non-object payload and duplicate keys are still hard rejections,
  // and they are reached THROUGH the fence, proving the wrapper rule did not
  // short-circuit any downstream validation.
  assert.throws(() => parseDistillResponse('```json\n[1,2,3]\n```'), (e) => { assert.equal(e.reason, 'not_single_object'); return true })
  assert.throws(() => parseDistillResponse('```json\n"a string"\n```'), (e) => { assert.equal(e.reason, 'not_single_object'); return true })
  assert.throws(() => parseDistillResponse('```json\n{"intent":"x","mode":"chat","reply":"a","reply":"b"}\n```'),
    (e) => { assert.equal(e.reason, 'duplicate_keys'); return true })
})

test('(b) empty response still rejected', () => {
  assert.throws(() => parseDistillResponse('   '), (e) => { assert.equal(e.reason, 'empty_response'); return true })
})

/* ═══════════ (a) ACCOUNTING ═══════════ */

function captureMetrics () {
  const lines = []
  const real = console.log
  console.log = (...a) => { if (String(a[0]).includes('[AROMA-METRICS]')) lines.push(String(a[1])); else real(...a) }
  return { lines, restore: () => { console.log = real } }
}
function fake (text, over = {}) {
  const calls = []
  return { calls, async complete (p, o) { calls.push({ p }); return Object.assign({ text, usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }, model: 'fake-claude', latencyMs: 3 }, over) } }
}

test('(a) usage recorded EXACTLY ONCE on the success path', async () => {
  const m = captureMetrics()
  try {
    const claude = fake(CHAT)
    await processIntake('聊天', claude, [], { demo: true, interactionMode: 'chat' })
    const mine = m.lines.filter((l) => l.includes('fake-claude'))
    assert.equal(mine.length, 1, `expected 1 record, got ${mine.length}`)
  } finally { m.restore() }
})

test('(a) usage IS recorded when the parse FAILS (the paid-but-unaccounted bug)', async () => {
  const m = captureMetrics()
  try {
    const claude = fake('```json\n{"intent":"chit_chat","mode":"chat","reply":"cut') // truncated → fence_malformed
    await assert.rejects(() => processIntake('聊天', claude, [], { demo: true, interactionMode: 'chat' }),
      (e) => { assert.equal(e.name, 'DistillParseError'); return true })
    const mine = m.lines.filter((l) => l.includes('fake-claude'))
    assert.equal(mine.length, 1, 'the paid call is accounted even though the turn failed')
    assert.equal(JSON.parse(mine[0]).output_tokens, 20)
  } finally { m.restore() }
})

test('(a) fallback turn records BOTH providers separately, once each', async () => {
  process.env.MULTI_AI_ROUTER = 'on'
  const m = captureMetrics()
  try {
    const gpt = fake('```json\n{"intent":"chit_chat","mode":"chat","reply":"cut', { model: 'gpt-under-test', usage: { inputTokens: 500, outputTokens: 251, totalTokens: 751 } })
    const claude = fake(CHAT)
    const res = await processIntake('聊天', claude, [], { demo: true, interactionMode: 'chat', openaiAdapter: gpt })
    assert.ok(res && res.reply, 'Claude served the turn')
    const g = m.lines.filter((l) => l.includes('gpt-under-test'))
    const c = m.lines.filter((l) => l.includes('fake-claude'))
    assert.equal(g.length, 1, 'GPT recorded once despite its parse failure')
    assert.equal(c.length, 1, 'Claude recorded once')
    assert.equal(JSON.parse(g[0]).output_tokens, 251)
  } finally { m.restore() }
})

test('(a) no prompt / user content / model output / secret appears in any recorded field', async () => {
  const m = captureMetrics()
  try {
    const SECRET = 'sk-ant-SENTINEL-KEY'
    process.env.OPENAI_API_KEY = SECRET
    const claude = fake(JSON.stringify({ intent: 'chit_chat', mode: 'chat', reply: 'REPLY_SENTINEL' }))
    await processIntake('USER_MESSAGE_SENTINEL', claude, [], { demo: true, interactionMode: 'chat' })
    const all = m.lines.join('\n')
    for (const bad of ['USER_MESSAGE_SENTINEL', 'REPLY_SENTINEL', SECRET, 'sk-ant', '心燈']) {
      assert.ok(!all.includes(bad), `metrics must never contain: ${bad}`)
    }
    const rec = JSON.parse(m.lines.find((l) => l.includes('fake-claude')))
    assert.deepEqual(Object.keys(rec).sort(), ['blocked', 'endpoint', 'input_tokens', 'latency_ms', 'model', 'output_tokens', 'request_count', 'timestamp', 'total_tokens'].sort())
  } finally { m.restore(); delete process.env.OPENAI_API_KEY }
})

/* ═══════════ (a2) PROVIDER ERROR VISIBILITY ═══════════ */

test('(a2) an OpenAI failure carries http status + provider type/code/param, never the body', async () => {
  const a = new OpenAIAdapter({ model: 'm', apiKey: 'SECRET', post: async () => { const e = new Error('x'); e.response = { status: 400, data: { error: { message: 'Unsupported parameter: temperature LEAK', type: 'invalid_request_error', code: 'unsupported_parameter', param: 'temperature' } } }; throw e } })
  await assert.rejects(() => a.complete('x', {}), (err) => {
    assert.deepEqual(err.providerDiagnostics, { httpStatus: 400, errorType: 'invalid_request_error', errorCode: 'unsupported_parameter', errorParam: 'temperature' })
    assert.ok(!err.message.includes('LEAK'), 'no provider message')
    assert.ok(!err.message.includes('SECRET'), 'no credential')
    assert.ok(!JSON.stringify(err.providerDiagnostics).includes('LEAK'))
    return true
  })
})

test('(a2) a provider omitting those fields yields null, without throwing', async () => {
  const a = new OpenAIAdapter({ model: 'm', apiKey: 'k', post: async () => { throw new Error('network down') } })
  await assert.rejects(() => a.complete('x', {}), (err) => {
    assert.deepEqual(err.providerDiagnostics, { httpStatus: null, errorType: null, errorCode: null, errorParam: null })
    return true
  })
})

test('(a2) the router log line carries the allowlisted fields and no content', async () => {
  process.env.MULTI_AI_ROUTER = 'on'
  const warns = []
  const realWarn = console.warn
  console.warn = (...a) => { warns.push(a.join(' ')) }
  try {
    const gpt = { async complete () { const e = new Error('OpenAI request failed (HTTP 400)'); e.providerDiagnostics = { httpStatus: 400, errorType: 'invalid_request_error', errorCode: 'unsupported_parameter', errorParam: 'temperature' }; throw e } }
    const claude = fake(CHAT)
    await processIntake('USER_SENTINEL', claude, [], { demo: true, interactionMode: 'chat', openaiAdapter: gpt })
    const line = warns.find((w) => w.includes('[router]'))
    assert.ok(line, 'router logged a fallback line')
    assert.ok(line.includes('http=400') && line.includes('type=invalid_request_error') && line.includes('code=unsupported_parameter') && line.includes('param=temperature'))
    assert.ok(!line.includes('USER_SENTINEL'), 'no user content in the router log')
  } finally { console.warn = realWarn }
})
