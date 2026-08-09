'use strict'

// modelRouter.test.js — Multi-AI Router v0. Deterministic; injected fake adapters ONLY.
// NO live OpenAI call, NO live Anthropic call, NO paid call, no key set.

const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-router-test-'))

const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')

const { selectPrimaryProvider, resolveMultiAiRouter } = require('./modelRouter')
const { OpenAIAdapter, createOpenAIAdapterIfConfigured, normalizeStopReason, extractText, OPENAI_RESPONSES_URL } = require('../adapters/OpenAIAdapter')
const { processIntake } = require('../intake/intakeService')
const { parseDistillResponse } = require('../intake/distillPrompt')
const { CONVERSATION_CONTRACT } = require('../persona/conversationContract')
const { PERSONA_IDENTITY, CONTEXT_CARD_GUARD, ACTION_HONESTY_GUARD } = require('../persona/xiangxiang')
const { SYSTEM_PROMPT } = require('../intake/distillPrompt')

const CHAT = JSON.stringify({ intent: 'chit_chat', mode: 'chat', reply: 'ok' })
const COMMIT = JSON.stringify({ intent: 'task', mode: 'commit', reply: 'r', decision: { statement: 's', rationale: 'r' }, tasks: [{ title: 't', note: '', capability: 'coding' }], risks: [], next_step: '' })
const ON = () => { process.env.MULTI_AI_ROUTER = 'on' }

afterEach(() => {
  delete process.env.MULTI_AI_ROUTER; delete process.env.OPENAI_MODEL; delete process.env.OPENAI_API_KEY
  delete process.env.READ_ACCESS; delete process.env.CONTEXT_DRIVE; delete process.env.DECISION_RECALL
  delete process.env.CONVERSATION_CONTRACT
})

/** Recording fake adapter (stands in for a provider; never touches a network). */
function fake (text, extra = {}) {
  const calls = []
  return { calls, async complete (prompt, o) { calls.push({ prompt, system: o && o.system, maxTokens: o && o.maxTokens }); return Object.assign({ text, usage: { inputTokens: 11, outputTokens: 22, totalTokens: 33 }, model: 'fake-gpt', latencyMs: 5 }, extra) } }
}
function boom () { const calls = []; return { calls, async complete (p, o) { calls.push({ prompt: p }); throw new Error('provider exploded') } } }

/* ── flag + selection rule ────────────────────────────────────────────────── */
// ⛔ A4 OFF FOR THIS FILE — it asserts NON-A4 contracts.
// A4-FINAL1 withholds a FINAL that no verifier has validated, and 'no verifier wired' is one
// of the fail-closed cases by Owner ruling. With A4 on and no verifier injected, every direct
// answer in this file would be withheld and every assertion about the reply would fail — which
// says nothing about the contract under test. Pinned so these keep proving what they were
// written to prove. See a4FinalObligation.test.js for the gate's own coverage.
process.env.A4_KNOWLEDGE_ROUTING = 'off'
test('flag is fail-closed: unset/empty/invalid -> off', () => {
  for (const bad of [undefined, '', 'ON', 'On', 'true', '1', 'yes']) {
    assert.equal(resolveMultiAiRouter(bad === undefined ? {} : { MULTI_AI_ROUTER: bad }), 'off', String(bad))
  }
  assert.equal(resolveMultiAiRouter({ MULTI_AI_ROUTER: 'on' }), 'on')
})

test('flag OFF -> claude for EVERY lane', () => {
  for (const mode of ['chat', 'proposal', 'email_draft', undefined, 'CHAT']) {
    assert.equal(selectPrimaryProvider({}, { interactionMode: mode }), 'claude', String(mode))
  }
})

test('flag ON -> openai ONLY for the exact chat lane', () => {
  const env = { MULTI_AI_ROUTER: 'on' }
  assert.equal(selectPrimaryProvider(env, { interactionMode: 'chat' }), 'openai')
  for (const mode of ['proposal', 'email_draft', undefined, 'CHAT', 'chat ', 'Chat']) {
    assert.equal(selectPrimaryProvider(env, { interactionMode: mode }), 'claude', String(mode))
  }
})

/* ── OpenAIAdapter shape / config ─────────────────────────────────────────── */
test('adapter maps the documented Responses shape to the shared result shape', async () => {
  let seen = null
  const a = new OpenAIAdapter({ model: 'test-model', apiKey: 'k', post: async (url, body, cfg) => { seen = { url, body, cfg }; return { data: { model: 'test-model-1', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: CHAT }] }], usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140 } } } } })
  const r = await a.complete('hello', { system: 'SYS', maxTokens: 2048 })
  assert.equal(seen.url, OPENAI_RESPONSES_URL)
  assert.equal(seen.body.model, 'test-model')
  assert.equal(seen.body.input, 'hello')
  assert.equal(seen.body.instructions, 'SYS')
  assert.equal(seen.body.max_output_tokens, 2048)
  assert.equal(seen.body.store, false) // ALWAYS false
  assert.equal(r.text, CHAT)
  assert.deepEqual(r.usage, { inputTokens: 100, outputTokens: 40, totalTokens: 140, reasoningTokens: 0 })
  assert.equal(r.model, 'test-model-1')
  assert.equal(r.stopReason, 'end_turn')
  assert.equal(typeof r.latencyMs, 'number')
})

test('stopReason normalization is faithful and null-safe', () => {
  assert.equal(normalizeStopReason({ status: 'completed' }), 'end_turn')
  assert.equal(normalizeStopReason({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }), 'max_tokens')
  assert.equal(normalizeStopReason({ status: 'incomplete', incomplete_details: { reason: 'content_filter' } }), 'content_filter')
  assert.equal(normalizeStopReason({}), null) // nothing usable -> null, never invented
  assert.equal(extractText({ output: [{ content: [{ type: 'output_text', text: 'a' }, { type: 'output_text', text: 'b' }] }] }), 'ab')
  assert.equal(extractText({}), '')
})

/* ── reasoning-budget guard (GPT-5.6 family) ──────────────────────────────── */
test('reasoning effort is pinned to the cheapest setting by default (budget guard)', async () => {
  let body = null
  const a = new OpenAIAdapter({ model: 'gpt-5.6-terra', apiKey: 'k', post: async (u, b) => { body = b; return { data: { status: 'completed', output: [{ content: [{ type: 'output_text', text: CHAT }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } } } })
  await a.complete('x', { system: 'S', maxTokens: 2048 })
  assert.deepEqual(body.reasoning, { effort: 'low' }, 'effort must be sent, not left to the medium default')
  assert.equal(body.max_output_tokens, 2048)
})

test('fix (c): NO sampling parameters are sent — reasoning models reject them with HTTP 400', async () => {
  let body = null
  const a = new OpenAIAdapter({ model: 'gpt-5.6-terra', apiKey: 'k', post: async (u, b) => { body = b; return { data: { status: 'completed', output: [{ content: [{ type: 'output_text', text: CHAT }] }], usage: {} } } } })
  // the neutral adapter contract still ACCEPTS temperature (Claude uses it) — this
  // adapter must simply not forward it, nor any other sampling knob.
  await a.complete('x', { system: 'S', maxTokens: 2048, temperature: 0.3, topP: 0.9 })
  for (const banned of ['temperature', 'top_p', 'topP', 'frequency_penalty', 'presence_penalty', 'top_k']) {
    assert.equal(banned in body, false, `${banned} must NOT be sent to a reasoning model`)
  }
  // exactly the minimum documented set, nothing "just in case"
  assert.deepEqual(Object.keys(body).sort(), ['input', 'instructions', 'max_output_tokens', 'model', 'reasoning', 'store'].sort())
})

test('reasoning effort is overridable per call and via OPENAI_REASONING_EFFORT; typos ignored', async () => {
  let body = null
  const mk = (o) => new OpenAIAdapter(Object.assign({ model: 'm', apiKey: 'k', post: async (u, b) => { body = b; return { data: { status: 'completed', output: [], usage: {} } } } }, o))
  await mk({}).complete('x', { reasoningEffort: 'medium' })
  assert.deepEqual(body.reasoning, { effort: 'medium' }, 'per-call override wins')
  await mk({ reasoningEffort: null }).complete('x', {})
  assert.equal(body.reasoning, undefined, 'explicit null omits the field (provider default)')
  const viaEnv = createOpenAIAdapterIfConfigured({ OPENAI_MODEL: 'm', OPENAI_API_KEY: 'k', OPENAI_REASONING_EFFORT: 'medium' })
  assert.equal(viaEnv._reasoningEffort, 'medium', 'env override lets the Owner change effort without a deploy')
  const typo = createOpenAIAdapterIfConfigured({ OPENAI_MODEL: 'm', OPENAI_API_KEY: 'k', OPENAI_REASONING_EFFORT: 'lowest' })
  assert.equal(typo._reasoningEffort, 'low', 'an invalid value falls back to the safe default — never forwarded as a 400')
})

test('reasoning tokens are surfaced from the documented usage path (provable budget burn)', async () => {
  const a = new OpenAIAdapter({ model: 'm', apiKey: 'k', post: async () => ({ data: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [], usage: { input_tokens: 900, output_tokens: 2048, total_tokens: 2948, output_tokens_details: { reasoning_tokens: 2048 } } } }) })
  const r = await a.complete('x', { maxTokens: 2048 })
  assert.equal(r.usage.reasoningTokens, 2048, 'reasoning burn visible')
  assert.equal(r.usage.outputTokens, 2048)
  assert.equal(r.text, '', 'no visible text survived the budget')
  assert.equal(r.stopReason, 'max_tokens', 'decisive evidence for the log report')
})

test('config is fail-closed: no model or no key -> adapter unavailable, never a default id', () => {
  assert.equal(createOpenAIAdapterIfConfigured({ OPENAI_API_KEY: 'k' }), null) // no model
  assert.equal(createOpenAIAdapterIfConfigured({ OPENAI_MODEL: '  ' , OPENAI_API_KEY: 'k' }), null) // blank model
  assert.equal(createOpenAIAdapterIfConfigured({ OPENAI_MODEL: 'm' }), null) // no key
  assert.ok(createOpenAIAdapterIfConfigured({ OPENAI_MODEL: 'm', OPENAI_API_KEY: 'k' }) instanceof OpenAIAdapter)
  // Guard the real risk: no model id used as a VALUE (quoted literal / default fallback).
  // Prose mentioning a model family in a doc comment is fine and stays readable.
  const src = fs.readFileSync(path.join(__dirname, '..', 'adapters', 'OpenAIAdapter.js'), 'utf8')
  assert.ok(!/['"`]gpt-[0-9][^'"`]*['"`]/i.test(src), 'no quoted model-id literal in the adapter')
  assert.ok(!/\|\|\s*['"`]gpt/i.test(src), 'no defaulted model id')
})

test('adapter errors never leak the provider body, and the key is never returned', async () => {
  const a = new OpenAIAdapter({ model: 'm', apiKey: 'SECRET_KEY_VALUE', post: async () => { const e = new Error('boom'); e.response = { status: 429, data: { error: { message: 'SECRET_KEY_VALUE leaked?' } } }; throw e } })
  await assert.rejects(() => a.complete('x', {}), (err) => {
    assert.ok(!err.message.includes('SECRET_KEY_VALUE'), 'key never in the error')
    assert.ok(!err.message.includes('leaked'), 'provider body never in the error')
    assert.ok(err.message.includes('HTTP 429'), 'status only')
    return true
  })
})

/* ── routing through the real pipeline ────────────────────────────────────── */
test('flag OFF: GPT adapter is NEVER called; Claude handles the chat lane', async () => {
  const gpt = fake(CHAT); const claude = fake(CHAT)
  await processIntake('聊天', claude, [], { demo: true, interactionMode: 'chat', openaiAdapter: gpt })
  assert.equal(gpt.calls.length, 0)
  assert.equal(claude.calls.length, 1)
})

test('flag ON: chat -> GPT primary (Claude untouched); proposal/legacy -> Claude only', async () => {
  ON()
  const gpt = fake(CHAT); const claude = fake(CHAT)
  await processIntake('聊天', claude, [], { demo: true, interactionMode: 'chat', openaiAdapter: gpt })
  assert.equal(gpt.calls.length, 1, 'GPT was primary')
  assert.equal(claude.calls.length, 0, 'no fallback needed')

  const gpt2 = fake(COMMIT); const claude2 = fake(COMMIT)
  await processIntake('做件事', claude2, [], { demo: true, interactionMode: 'proposal', openaiAdapter: gpt2, promoteToProposal: async () => ({ ok: true, proposal: { id: 'p', status: 'pending' } }) })
  assert.equal(gpt2.calls.length, 0, 'proposal lane never routes to GPT')
  assert.equal(claude2.calls.length, 1)

  const gpt3 = fake(CHAT); const claude3 = fake(CHAT)
  await processIntake('x', claude3, [], { demo: true, openaiAdapter: gpt3 }) // legacy/unset
  assert.equal(gpt3.calls.length, 0)
  assert.equal(claude3.calls.length, 1)
})

test('flag ON but OPENAI unconfigured -> no GPT call attempted, Claude serves the turn', async () => {
  ON() // no OPENAI_MODEL / OPENAI_API_KEY
  const claude = fake(CHAT)
  const res = await processIntake('聊天', claude, [], { demo: true, interactionMode: 'chat' })
  assert.equal(claude.calls.length, 1)
  assert.ok(res && res.reply)
})

/* ── CONTEXT BOUNDARY (the owner decision) ────────────────────────────────── */
test('GPT receives persona+guards+contract+classifier AND the same recall/read-context Claude gets', async () => {
  ON()
  process.env.CONVERSATION_CONTRACT = 'on'
  process.env.DECISION_RECALL = 'on'
  // TURN_ROUTER:'off' — this asserts WHICH BLOCKS each provider receives, not routing.
  // Under routing a turn with no business intent reads nothing and there are no blocks to
  // compare. Legacy path pinned deliberately; see MAINTENANCE-BACKLOG.md M-4.
  process.env.TURN_ROUTER = 'off'
  process.env.A4_KNOWLEDGE_ROUTING = 'off' // pins the automatic-read contract
  process.env.READ_ACCESS = 'on'; process.env.CONTEXT_DRIVE = 'on'
  const recallDeps = { listDecisionsFn: () => [{ id: 'dec_SECRET', statement: 'RECALL_SENTINEL', rationale: '', status: 'active', provenance: { proposed_by: 'louie', source: 's', approved_by: null, decided_at: '2026-07-20T00:00:00Z' } }], listTasksFn: () => [] }
  const readDeps = { sources: ['drive'], connector: { read: async () => ({ asOf: 'now', source: 'drive', count: 1, results: [{ source: 'drive', sourceId: 'd1', title: 'READCTX_SENTINEL', retrievedAt: 'now', originalDate: '2026-07-01', content: 'x', link: 'l', trust: 'live', error: null }] }) } }

  const gpt = fake(CHAT); const claude = fake(CHAT)
  await processIntake('請問近況', claude, [], { demo: true, interactionMode: 'chat', openaiAdapter: gpt, contextCard: { project: 'CARD_SENTINEL' }, decisionRecallDeps: recallDeps, readContextDeps: readDeps })

  const sentToGpt = gpt.calls[0]
  // INVERTED by a later Owner decision. In v0 these three were excluded from GPT by
  // construction; the Owner has since accepted, knowingly, that his operational data goes
  // to a second vendor, so GPT now receives what Claude receives. The withholding that
  // makes that reversible is per-source configuration — see providerSharing.js and
  // contextAsymmetry.test.js — not a hard-coded exclusion here.
  assert.ok(sentToGpt.prompt.includes('RECALL_SENTINEL'), 'decision recall now reaches GPT')
  assert.ok(sentToGpt.prompt.includes('READCTX_SENTINEL'), 'read context now reaches GPT')
  assert.ok(sentToGpt.prompt.includes('CARD_SENTINEL'), 'the context card reaches GPT too')
  // ...and can still be withheld, one source at a time, without touching code
  process.env.CONTEXT_DRIVE_OPENAI = 'off'
  const gpt2 = fake(CHAT)
  await processIntake('請問近況', fake(CHAT), [], { demo: true, interactionMode: 'chat', openaiAdapter: gpt2, contextCard: { project: 'CARD_SENTINEL' }, decisionRecallDeps: recallDeps, readContextDeps: readDeps })
  assert.ok(!gpt2.calls[0].prompt.includes('READCTX_SENTINEL'), 'drive withheld from GPT on its own')
  assert.ok(gpt2.calls[0].prompt.includes('RECALL_SENTINEL'), 'while recall still reaches it')
  delete process.env.CONTEXT_DRIVE_OPENAI
  // INCLUDED for GPT
  assert.ok(sentToGpt.prompt.includes('請問近況'), 'current user turn present')
  assert.ok(sentToGpt.system.includes(PERSONA_IDENTITY), 'persona identity present')
  assert.ok(sentToGpt.system.includes(CONTEXT_CARD_GUARD), 'trusted guard present')
  assert.ok(sentToGpt.system.includes(ACTION_HONESTY_GUARD), 'honesty guard present')
  assert.ok(sentToGpt.system.includes(CONVERSATION_CONTRACT), 'conversation contract present')
  assert.ok(sentToGpt.system.endsWith(SYSTEM_PROMPT), 'classifier present and last')
})

test('Claude still receives recall + read-context on its own lane (unchanged)', async () => {
  process.env.DECISION_RECALL = 'on'
  // TURN_ROUTER:'off' — this asserts WHICH BLOCKS each provider receives, not routing.
  // Under routing a turn with no business intent reads nothing and there are no blocks to
  // compare. Legacy path pinned deliberately; see MAINTENANCE-BACKLOG.md M-4.
  process.env.TURN_ROUTER = 'off'
  process.env.A4_KNOWLEDGE_ROUTING = 'off' // pins the automatic-read contract
  process.env.READ_ACCESS = 'on'; process.env.CONTEXT_DRIVE = 'on'
  const recallDeps = { listDecisionsFn: () => [{ id: 'd1', statement: 'RECALL_SENTINEL', rationale: '', status: 'active', provenance: { proposed_by: 'l', source: 's', approved_by: null, decided_at: '2026-07-20T00:00:00Z' } }], listTasksFn: () => [] }
  const readDeps = { sources: ['drive'], connector: { read: async () => ({ asOf: 'now', source: 'drive', count: 1, results: [{ source: 'drive', sourceId: 'd1', title: 'READCTX_SENTINEL', retrievedAt: 'now', originalDate: '2026-07-01', content: 'x', link: 'l', trust: 'live', error: null }] }) } }
  const claude = fake(CHAT)
  await processIntake('近況', claude, [], { demo: true, interactionMode: 'chat', decisionRecallDeps: recallDeps, readContextDeps: readDeps })
  assert.ok(claude.calls[0].prompt.includes('RECALL_SENTINEL'))
  assert.ok(claude.calls[0].prompt.includes('READCTX_SENTINEL'))
})

/* ── FALLBACK semantics ───────────────────────────────────────────────────── */
test('GPT provider error -> Claude called exactly once; turn succeeds', async () => {
  ON()
  const gpt = boom(); const claude = fake(CHAT)
  const res = await processIntake('聊天', claude, [], { demo: true, interactionMode: 'chat', openaiAdapter: gpt })
  assert.equal(gpt.calls.length, 1)
  assert.equal(claude.calls.length, 1, 'exactly one fallback call — never a loop')
  assert.ok(res && res.reply)
})

test('GPT parse failure -> Claude once, and GPT USAGE IS RECORDED (two provider calls billed)', async () => {
  ON()
  // Capture the metrics sink (metricsLogger writes '[AROMA-METRICS] <json>' to stdout)
  // so the accounting claim is actually PROVEN, not merely asserted in prose.
  const metrics = []
  const realLog = console.log
  console.log = (...args) => { if (String(args[0]).includes('[AROMA-METRICS]')) metrics.push(String(args[1])); else realLog(...args) }
  try {
    const gpt = fake('```json\n{"intent":"chit_chat","mode":"chat","reply":"truncated', { stopReason: 'max_tokens', usage: { inputTokens: 500, outputTokens: 2048, totalTokens: 2548 }, model: 'gpt-under-test' })
    const claude = fake(CHAT, { model: 'claude-under-test' })
    const res = await processIntake('聊天', claude, [], { demo: true, interactionMode: 'chat', openaiAdapter: gpt })
    assert.equal(gpt.calls.length, 1)
    assert.equal(claude.calls.length, 1, 'exactly one fallback')
    assert.ok(res && res.reply, 'Claude served the turn')

    const gptEntry = metrics.find((m) => m.includes('gpt-under-test'))
    const claudeEntry = metrics.find((m) => m.includes('claude-under-test'))
    assert.ok(gptEntry, 'GPT usage recorded even though its output failed to parse')
    assert.ok(JSON.parse(gptEntry).output_tokens === 2048, 'GPT output tokens accounted')
    assert.ok(claudeEntry, 'Claude usage recorded SEPARATELY')
    assert.notEqual(gptEntry, claudeEntry, 'two distinct billed calls')
  } finally { console.log = realLog }
})

test('GPT fails AND Claude fails -> the existing safe error propagates (no loop)', async () => {
  ON()
  const gpt = boom(); const claude = boom()
  await assert.rejects(
    () => processIntake('聊天', claude, [], { demo: true, interactionMode: 'chat', openaiAdapter: gpt }),
    (err) => { assert.equal(err.name, 'IntakeUpstreamError'); return true }
  )
  assert.equal(gpt.calls.length, 1)
  assert.equal(claude.calls.length, 1)
})

/* ── ENVELOPE COMPATIBILITY against the EXISTING parser ───────────────────── */
test('envelope fixtures: which shapes the existing strict parser accepts / rejects', () => {
  const clean = CHAT
  const fenced = '```json\n' + CHAT + '\n```'
  const bareFence = '```\n' + CHAT + '\n```'
  const badLang = '```javascript\n' + CHAT + '\n```'
  const truncated = '```json\n{"intent":"chit_chat","mode":"chat","reply":"cut off'
  const prose = '好的,以下是 JSON:\n' + CHAT

  assert.equal(parseDistillResponse(clean).mode, 'chat') // PASS
  assert.equal(parseDistillResponse(fenced).mode, 'chat') // PASS (```json accepted)
  assert.equal(parseDistillResponse(bareFence).mode, 'chat') // PASS (empty tag accepted)
  assert.throws(() => parseDistillResponse(badLang), (e) => { assert.equal(e.reason, 'fence_malformed'); return true })
  assert.throws(() => parseDistillResponse(truncated), (e) => { assert.equal(e.reason, 'fence_malformed'); return true })
  assert.throws(() => parseDistillResponse(prose), (e) => { assert.equal(e.reason, 'invalid_json'); return true })
})
