'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ClaudeAdapter } = require('./ClaudeAdapter');
const { MockAdapter } = require('./MockAdapter');
const { AdapterOptionError, UnsupportedCapabilityError, assertResponseFormat } = require('./adapterErrors');
const { parseU1DraftResponse } = require('../intake/u1DraftPrompt');
const { U1_DRAFT_SCHEMA, U1_DRAFT_SCHEMA_NAME } = require('../intake/u1DraftSchema');

/* ---- a capturing fake transport (axios.post-shaped) so no network is used ---- */
function makeTransport(responseData) {
  const calls = [];
  const post = async (url, data, cfg) => {
    calls.push({ url, data, cfg });
    return { data: responseData };
  };
  return { calls, post };
}
const FAKE_API_DATA = {
  content: [{ text: '{"ok":true}' }],
  usage: { input_tokens: 5, output_tokens: 7 },
  model: 'test-model',
};
const RF = { type: 'json_schema', name: U1_DRAFT_SCHEMA_NAME, schema: U1_DRAFT_SCHEMA };

/* =============================== assertResponseFormat ======================= */

test('assertResponseFormat accepts a valid contract', () => {
  assert.equal(assertResponseFormat(RF), RF);
});

for (const [label, bad] of [
  ['non-object', 42],
  ['null', null],
  ['wrong type', { type: 'text', name: 'x', schema: {} }],
  ['empty name', { type: 'json_schema', name: '   ', schema: {} }],
  ['missing name', { type: 'json_schema', schema: {} }],
  ['non-object schema', { type: 'json_schema', name: 'x', schema: 'nope' }],
]) {
  test(`assertResponseFormat rejects ${label} with MALFORMED_RESPONSE_FORMAT`, () => {
    assert.throws(() => assertResponseFormat(bad), (e) =>
      e instanceof AdapterOptionError && e.code === 'MALFORMED_RESPONSE_FORMAT');
  });
}

/* ================================ ClaudeAdapter ============================= */

test('ClaudeAdapter maps responseFormat -> output_config.format {type,schema} with NO name, NO beta header', async () => {
  const tr = makeTransport(FAKE_API_DATA);
  const a = new ClaudeAdapter({ apiKey: 'test-key', model: 'test-model', transport: tr.post });
  const res = await a.complete('hello', { system: 's', maxTokens: 10, temperature: 0.1, responseFormat: RF });

  assert.equal(tr.calls.length, 1);
  const body = tr.calls[0].data;
  // exact GA shape: output_config.format = { type, schema } — name absent
  assert.deepEqual(Object.keys(body.output_config), ['format']);
  assert.deepEqual(Object.keys(body.output_config.format).sort(), ['schema', 'type']);
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.equal(body.output_config.format.schema, U1_DRAFT_SCHEMA);
  assert.ok(!('name' in body.output_config.format), 'Anthropic format must NOT carry name');

  // no beta / structured-outputs header
  const headerKeys = Object.keys(tr.calls[0].cfg.headers).sort();
  assert.deepEqual(headerKeys, ['Content-Type', 'anthropic-version', 'x-api-key']);
  for (const k of headerKeys) assert.ok(!/beta|structured/i.test(k), `no beta/structured header (${k})`);

  // .text returned unchanged from content[0].text (no normalization)
  assert.equal(res.text, '{"ok":true}');
});

test('ClaudeAdapter WITHOUT responseFormat => legacy body (no output_config) + exact legacy headers', async () => {
  const tr = makeTransport(FAKE_API_DATA);
  const a = new ClaudeAdapter({ apiKey: 'test-key', model: 'test-model', transport: tr.post });
  await a.complete('hello', { system: 's', maxTokens: 10, temperature: 0.1 });

  const body = tr.calls[0].data;
  assert.ok(!('output_config' in body), 'legacy request must have no output_config');
  assert.deepEqual(Object.keys(tr.calls[0].cfg.headers).sort(), ['Content-Type', 'anthropic-version', 'x-api-key']);
});

test('ClaudeAdapter rejects malformed responseFormat BEFORE any network access', async () => {
  const tr = makeTransport(FAKE_API_DATA);
  const a = new ClaudeAdapter({ apiKey: 'test-key', model: 'test-model', transport: tr.post });
  await assert.rejects(
    () => a.complete('hi', { responseFormat: { type: 'text', name: 'x', schema: {} } }),
    (e) => e instanceof AdapterOptionError && e.code === 'MALFORMED_RESPONSE_FORMAT');
  assert.equal(tr.calls.length, 0, 'transport must NOT be called on malformed responseFormat');
});

/* ================================= MockAdapter ============================= */

test('MockAdapter with responseFormat returns a deterministic fixture that PARSES', async () => {
  const m = new MockAdapter();
  const r = await m.complete('anything', { responseFormat: RF });
  const parsed = parseU1DraftResponse(r.text); // must not throw
  assert.equal(parsed.mode, 'draft_proposal');
  assert.equal(parsed.understanding.recipient.name, 'Rob');
  assert.equal(parsed.understanding.recipient.email, null);
});

test('MockAdapter WITHOUT responseFormat keeps legacy behaviour (returns text string)', async () => {
  const m = new MockAdapter();
  const r = await m.complete('Louie 現在說:「你好」');
  assert.equal(typeof r.text, 'string');
  assert.ok(r.text.length > 0);
});

test('MockAdapter({supportsStructuredOutput:false}) fails closed on responseFormat', async () => {
  const m = new MockAdapter({ supportsStructuredOutput: false });
  await assert.rejects(
    () => m.complete('x', { responseFormat: RF }),
    (e) => e instanceof UnsupportedCapabilityError && e.code === 'STRUCTURED_OUTPUT_UNSUPPORTED');
});

/* ── THE OPENAI ADAPTER HONOURS THE CONTRACT (it used to ignore it) ────────── */
// The chat lane runs GPT as primary. This adapter had no responseFormat branch at all —
// no support, and no error either — so a schema-dependent feature would have degraded to
// unconstrained prose for the provider answering most turns, silently. These pin the fix.

const { OpenAIAdapter } = require('./OpenAIAdapter');

function capturingOpenAI (captured) {
  const a = new OpenAIAdapter({ apiKey: 'k', model: 'gpt-test' });
  a._post = async (url, body) => {
    captured.body = body;
    return { status: 200, data: { output: [{ content: [{ type: 'output_text', text: '{"ok":true}' }] }], usage: { input_tokens: 1, output_tokens: 1 } } };
  };
  return a;
}

const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { directAnswer: { type: 'string' } }, required: ['directAnswer']
};

test('*** OpenAI: responseFormat becomes text.format with strict:true ***', async () => {
  const captured = {};
  await capturingOpenAI(captured).complete('hi', {
    responseFormat: { type: 'json_schema', name: 'answer_plan', schema: PLAN_SCHEMA }
  });
  assert.ok(captured.body.text, 'the request must carry a format instruction');
  assert.strictEqual(captured.body.text.format.type, 'json_schema');
  assert.strictEqual(captured.body.text.format.name, 'answer_plan');
  assert.strictEqual(captured.body.text.format.strict, true, 'strict is the API-layer guarantee');
  assert.deepStrictEqual(captured.body.text.format.schema, PLAN_SCHEMA);
});

test('*** OpenAI: no responseFormat → nothing is sent "just in case" ***', async () => {
  const captured = {};
  await capturingOpenAI(captured).complete('hi', {});
  assert.strictEqual('text' in captured.body, false);
});

test('*** OpenAI: a malformed responseFormat throws BEFORE any network call ***', async () => {
  const captured = {};
  const a = capturingOpenAI(captured);
  for (const bad of [{}, { type: 'json' }, { type: 'json_schema', name: '', schema: {} }, { type: 'json_schema', name: 'n' }]) {
    await assert.rejects(() => a.complete('hi', { responseFormat: bad }),
      (e) => e instanceof AdapterOptionError && e.code === 'MALFORMED_RESPONSE_FORMAT');
  }
  assert.strictEqual(captured.body, undefined, 'nothing may reach the network');
});

test('*** no adapter may silently ignore responseFormat ***', async () => {
  // The contract's own words. Every adapter either honours it or fails closed; passing it
  // and getting unconstrained prose back is the one outcome that must be impossible.
  const captured = {};
  const rf = { type: 'json_schema', name: 'n', schema: PLAN_SCHEMA };
  await capturingOpenAI(captured).complete('hi', { responseFormat: rf });
  assert.ok(captured.body.text && captured.body.text.format, 'OpenAI honours it');
  const mock = new (require('./MockAdapter').MockAdapter)({ supportsStructuredOutput: false });
  await assert.rejects(() => mock.complete('hi', { responseFormat: rf }),
    (e) => e instanceof UnsupportedCapabilityError, 'an adapter that cannot honour it fails closed');
});
