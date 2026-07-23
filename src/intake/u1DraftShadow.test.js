'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildU1DraftPrompt,
  parseU1DraftResponse,
  DistillParseError,
  DISTILL_PARSE_REASON,
} = require('./u1DraftPrompt');

const { runU1DraftShadow } = require('./u1DraftShadow');
const { U1_DRAFT_SCHEMA, U1_DRAFT_SCHEMA_NAME } = require('./u1DraftSchema');

/* ----------------------- dedicated fake adapter ---------------------------- */
/**
 * Dedicated U1 fake adapter. Returns the COMPLETE real CompletionResult shape:
 *   { text, usage: { inputTokens, outputTokens, totalTokens }, model, latencyMs }
 * NOT a bare string, NOT a lone { content } / { text }-only object.
 * This is NOT the existing MockAdapter.
 */
function makeFakeAdapter({ text, throwError } = {}) {
  const calls = [];
  return {
    calls,
    async complete(prompt, opts) {
      calls.push({ prompt, opts });
      if (throwError) throw throwError;
      return {
        text: typeof text === 'string' ? text : '',
        usage: { inputTokens: 11, outputTokens: 22, totalTokens: 33 },
        model: 'fake-u1-model',
        latencyMs: 7,
      };
    },
  };
}

/* ------------------------------- fixtures ---------------------------------- */

function askJson(overrides = {}) {
  const base = {
    mode: 'ask',
    understanding: {
      recipient: { name: null, email: null, confidence: 'low' },
      purpose: { value: 'reply to a colleague', confidence: 'medium' },
      tone: { value: 'friendly', confidence: 'medium' },
      constraints: ['keep it short'],
      understandingSignals: [
        { classification: 'TEMPORARY', statement: 'wants to reply now', source: 'current_message', confidence: 'medium' },
      ],
    },
    restatement: 'You want to reply to someone, but I am not sure who.',
    clarifyingQuestion: 'Who should this email go to?',
    draft: null,
  };
  return JSON.stringify(Object.assign(base, overrides));
}

function draftJson(overrides = {}) {
  const base = {
    mode: 'draft_proposal',
    understanding: {
      recipient: { name: 'Zhang San', email: null, confidence: 'high' },
      purpose: { value: 'confirm Monday meeting', confidence: 'high' },
      tone: { value: 'casual', confidence: 'high' },
      constraints: ['available next Monday'],
      understandingSignals: [
        { classification: 'FACT', statement: 'recipient is Zhang San', source: 'current_message', confidence: 'high' },
        { classification: 'PREFERENCE', statement: 'owner prefers casual tone', source: 'persona', confidence: 'medium' },
        { classification: 'TEMPORARY', statement: 'free next Monday', source: 'current_message', confidence: 'high' },
      ],
    },
    restatement: 'Replying to Zhang San to say you are free to meet next Monday.',
    clarifyingQuestion: null,
    draft: { to: null, subject: 'Meeting next Monday', body: 'Hi Zhang San, I am free next Monday to meet.', tone: 'casual' },
  };
  return JSON.stringify(Object.assign(base, overrides));
}

/* --------------------- structured-output wiring tests ---------------------- */

test('U1 passes responseFormat exactly once with the U1 schema + name', async () => {
  const adapter = makeFakeAdapter({ text: draftJson() });
  const res = await runU1DraftShadow({ instruction: 'reply to Rob', adapter, requestId: '11111111-2222-4333-8444-555555555555' });
  assert.equal(adapter.calls.length, 1);
  const rf = adapter.calls[0].opts.responseFormat;
  assert.deepEqual(rf, { type: 'json_schema', name: U1_DRAFT_SCHEMA_NAME, schema: U1_DRAFT_SCHEMA });
  // server-fixed fields still appended after a successful parse
  assert.equal(res.stage, 'SHADOW_ONLY');
  assert.equal(res.gmailDraftCreated, false);
  assert.equal(res.persistentMemoryWritten, false);
});

test('U1 parser stays strict: a fenced JSON response still throws EXTRA_PROSE', async () => {
  const fenced = '```json\n' + draftJson() + '\n```';
  const adapter = makeFakeAdapter({ text: fenced });
  await assert.rejects(
    () => runU1DraftShadow({ instruction: 'x', adapter, requestId: '11111111-2222-4333-8444-555555555555' }),
    (e) => e instanceof DistillParseError && e.reason === DISTILL_PARSE_REASON.EXTRA_PROSE);
});

test('U1 accepts a clean raw JSON response (draft_proposal) through the unchanged parser', async () => {
  const adapter = makeFakeAdapter({ text: draftJson() });
  const res = await runU1DraftShadow({ instruction: 'x', adapter, requestId: '11111111-2222-4333-8444-555555555555' });
  assert.equal(res.mode, 'draft_proposal');
  assert.equal(res.clarifyingQuestion, null);
  assert.equal(typeof res.draft.body, 'string');
});

/* ------------------------------ prompt tests ------------------------------- */

test('buildU1DraftPrompt is pure and returns { system, prompt }', () => {
  const a = buildU1DraftPrompt({ instruction: 'hello', history: [], personaText: 'p' });
  const b = buildU1DraftPrompt({ instruction: 'hello', history: [], personaText: 'p' });
  assert.deepEqual(a, b);
  assert.equal(typeof a.system, 'string');
  assert.equal(typeof a.prompt, 'string');
  assert.ok(a.system.includes('DRAFT PROPOSAL SHADOW'));
  assert.ok(a.prompt.includes('hello'));
});

test('buildU1DraftPrompt embeds persona text read-only', () => {
  const { system } = buildU1DraftPrompt({ instruction: 'x', personaText: 'PERSONA-MARKER-XYZ' });
  assert.ok(system.includes('PERSONA-MARKER-XYZ'));
});

test('U1 hardening: system prompt states the raw-JSON / no-code-fence output rule', () => {
  const { system } = buildU1DraftPrompt({ instruction: 'x', personaText: 'p' });
  assert.ok(system.includes('OUTPUT FORMAT'));
  assert.ok(system.includes('code fences'));
  assert.ok(system.includes('```json'));
  assert.ok(system.includes('FIRST output character MUST be "{"'));
  assert.ok(system.includes('LAST output character MUST be "}"'));
});

test('U1 hardening: system prompt gives first-person owner-voice tone guidance', () => {
  const { system } = buildU1DraftPrompt({ instruction: 'x', personaText: 'p' });
  assert.ok(system.includes('VOICE'));
  assert.ok(system.includes("OWNER'S voice"));
  assert.ok(system.includes('first person'));
  assert.ok(system.includes('TONE'));
  assert.ok(system.includes('minimal filler'));
});

test('U1 negative lock: markdown-fenced JSON is STILL rejected (parser not loosened)', () => {
  const fenced = '```json\n' + draftJson() + '\n```';
  assert.throws(() => parseU1DraftResponse(fenced), (e) =>
    e instanceof DistillParseError && e.reason === DISTILL_PARSE_REASON.EXTRA_PROSE);
  const barefence = '```\n' + draftJson() + '\n```';
  assert.throws(() => parseU1DraftResponse(barefence), (e) =>
    e instanceof DistillParseError && e.reason === DISTILL_PARSE_REASON.EXTRA_PROSE);
});

/* ------------------------- A. understanding extract ------------------------ */

test('A1/A2 draft_proposal parses recipient/purpose/tone/constraints + signals', () => {
  const parsed = parseU1DraftResponse(draftJson());
  assert.equal(parsed.understanding.recipient.name, 'Zhang San');
  assert.equal(parsed.understanding.recipient.email, null); // never guessed
  assert.equal(parsed.understanding.purpose.value, 'confirm Monday meeting');
  assert.equal(parsed.understanding.tone.value, 'casual');
  assert.deepEqual(parsed.understanding.constraints, ['available next Monday']);
  assert.equal(parsed.understanding.understandingSignals.length, 3);
  for (const s of parsed.understanding.understandingSignals) {
    assert.ok(['FACT', 'PREFERENCE', 'TEMPORARY'].includes(s.classification));
    assert.ok(['current_message', 'session_context', 'persona'].includes(s.source));
    assert.ok(['high', 'medium', 'low'].includes(s.confidence));
    assert.equal(typeof s.statement, 'string');
  }
});

test('A3 classifications FACT/PREFERENCE/TEMPORARY are distinguished', () => {
  const parsed = parseU1DraftResponse(draftJson());
  const kinds = parsed.understanding.understandingSignals.map((s) => s.classification);
  assert.ok(kinds.includes('FACT'));
  assert.ok(kinds.includes('PREFERENCE'));
  assert.ok(kinds.includes('TEMPORARY'));
});

/* ----------------------------- B. ask path -------------------------------- */

test('B1 ask mode: draft null, non-empty restatement + clarifyingQuestion', () => {
  const parsed = parseU1DraftResponse(askJson());
  assert.equal(parsed.mode, 'ask');
  assert.equal(parsed.draft, null);
  assert.ok(parsed.restatement.length > 0);
  assert.ok(parsed.clarifyingQuestion.length > 0);
});

test('B2 ask mode with a draft is rejected (mode/draft inconsistent)', () => {
  const bad = askJson({ draft: { to: null, subject: 's', body: 'b', tone: 't' } });
  assert.throws(() => parseU1DraftResponse(bad), (e) =>
    e instanceof DistillParseError && e.reason === DISTILL_PARSE_REASON.MODE_DRAFT_INCONSISTENT);
});

/* ---------------------------- C. draft path ------------------------------- */

test('C1 draft_proposal: draft object complete', () => {
  const parsed = parseU1DraftResponse(draftJson());
  assert.equal(parsed.mode, 'draft_proposal');
  assert.equal(typeof parsed.draft.subject, 'string');
  assert.equal(typeof parsed.draft.body, 'string');
  assert.equal(typeof parsed.draft.tone, 'string');
});

test('C2 draft_proposal with a clarifyingQuestion is rejected', () => {
  const bad = draftJson({ clarifyingQuestion: 'why?' });
  assert.throws(() => parseU1DraftResponse(bad), (e) =>
    e instanceof DistillParseError && e.reason === DISTILL_PARSE_REASON.MODE_DRAFT_INCONSISTENT);
});

/* -------------------- D. server-fixed & anti-forgery ---------------------- */

test('D1 server-fixed fields appended after successful parse (ask)', async () => {
  const adapter = makeFakeAdapter({ text: askJson() });
  const res = await runU1DraftShadow({ instruction: 'reply someone', adapter, history: [], requestId: 'rid-1', personaText: 'p' });
  assert.equal(res.stage, 'SHADOW_ONLY');
  assert.equal(res.gmailDraftCreated, false);
  assert.equal(res.persistentMemoryWritten, false);
  assert.equal(res.requestId, 'rid-1'); // server-appended requestId
  assert.equal(res.mode, 'ask');
});

test('D1 server-fixed fields appended after successful parse (draft)', async () => {
  const adapter = makeFakeAdapter({ text: draftJson() });
  const res = await runU1DraftShadow({ instruction: 'reply Zhang', adapter, history: [], requestId: 'rid-2', personaText: 'p' });
  assert.equal(res.stage, 'SHADOW_ONLY');
  assert.equal(res.gmailDraftCreated, false);
  assert.equal(res.persistentMemoryWritten, false);
  assert.equal(res.requestId, 'rid-2'); // server-appended requestId
  assert.equal(res.mode, 'draft_proposal');
});

test('D2 model output containing stage is rejected as authority key', () => {
  const bad = draftJson({ stage: 'SENT' });
  assert.throws(() => parseU1DraftResponse(bad), (e) =>
    e instanceof DistillParseError && e.reason === DISTILL_PARSE_REASON.AUTHORITY_KEY);
});

test('D2 model output containing gmailDraftCreated is rejected', () => {
  const bad = draftJson({ gmailDraftCreated: true });
  assert.throws(() => parseU1DraftResponse(bad), (e) =>
    e instanceof DistillParseError && e.reason === DISTILL_PARSE_REASON.AUTHORITY_KEY);
});

test('D2 model output containing proposalCreated is rejected', () => {
  const bad = draftJson({ proposalCreated: true });
  assert.throws(() => parseU1DraftResponse(bad), (e) =>
    e instanceof DistillParseError && e.reason === DISTILL_PARSE_REASON.AUTHORITY_KEY);
});

test('D4 server-appended requestId matches the caller requestId', async () => {
  const adapter = makeFakeAdapter({ text: draftJson() });
  const res = await runU1DraftShadow({ instruction: 'x', adapter, history: [], requestId: 'req-123', personaText: 'p' });
  assert.equal(res.requestId, 'req-123');
});

test('D4 model-supplied requestId is rejected as unknown key', () => {
  const bad = draftJson({ requestId: 'forged-by-model' });
  assert.throws(() => parseU1DraftResponse(bad), (e) =>
    e instanceof DistillParseError && e.reason === DISTILL_PARSE_REASON.UNKNOWN_KEY);
});

test('D2 sent/approved/executed/persistentMemoryWritten all rejected', () => {
  for (const k of ['sent', 'approved', 'executed', 'persistentMemoryWritten']) {
    const bad = draftJson({ [k]: true });
    assert.throws(() => parseU1DraftResponse(bad), (e) =>
      e instanceof DistillParseError && e.reason === DISTILL_PARSE_REASON.AUTHORITY_KEY, `key ${k} should be rejected`);
  }
});

test('D3 server-fixed values cannot be overridden by model text', async () => {
  // Even if the model tried to set false->true via a normal key, the parser would
  // reject authority keys; here we confirm the shadow always stamps the fixed values.
  const adapter = makeFakeAdapter({ text: draftJson() });
  const res = await runU1DraftShadow({ instruction: 'x', adapter, history: [], requestId: 'rid-3', personaText: 'p' });
  assert.equal(res.gmailDraftCreated, false);
  assert.equal(res.persistentMemoryWritten, false);
  assert.equal(res.stage, 'SHADOW_ONLY');
});

/* --------------------------- E. parser strictness -------------------------- */

test('E1 malformed JSON rejected', () => {
  assert.throws(() => parseU1DraftResponse('{ not json'), (e) =>
    e instanceof DistillParseError &&
    (e.reason === DISTILL_PARSE_REASON.MALFORMED_JSON || e.reason === DISTILL_PARSE_REASON.EXTRA_PROSE));
});

test('E2 extra prose / markdown fence rejected', () => {
  const fenced = '```json\n' + draftJson() + '\n```';
  assert.throws(() => parseU1DraftResponse(fenced), (e) =>
    e instanceof DistillParseError && e.reason === DISTILL_PARSE_REASON.EXTRA_PROSE);
  const withProse = 'Here is your draft: ' + draftJson();
  assert.throws(() => parseU1DraftResponse(withProse), (e) =>
    e instanceof DistillParseError && e.reason === DISTILL_PARSE_REASON.EXTRA_PROSE);
});

test('E3 duplicate keys at top level rejected', () => {
  const dup = '{"mode":"ask","mode":"draft_proposal","understanding":{},"restatement":"x","clarifyingQuestion":"y","draft":null}';
  assert.throws(() => parseU1DraftResponse(dup), (e) =>
    e instanceof DistillParseError && e.reason === DISTILL_PARSE_REASON.DUPLICATE_KEY);
});

test('E3 duplicate keys nested rejected', () => {
  const dup = '{"mode":"ask","understanding":{"recipient":{"name":null,"name":"x","email":null,"confidence":"low"},"purpose":{"value":null,"confidence":"low"},"tone":{"value":null,"confidence":"low"},"constraints":[],"understandingSignals":[{"classification":"FACT","statement":"s","source":"persona","confidence":"low"}]},"restatement":"r","clarifyingQuestion":"q","draft":null}';
  assert.throws(() => parseU1DraftResponse(dup), (e) =>
    e instanceof DistillParseError && e.reason === DISTILL_PARSE_REASON.DUPLICATE_KEY);
});

test('E3 escaped-equivalent duplicate at top level rejected', () => {
  // "mode" and "\u006dode" decode to the same key; must be rejected by the scanner.
  const dup = '{"mode":"ask","\\u006dode":"draft_proposal","understanding":{"recipient":{"name":null,"email":null,"confidence":"low"},"purpose":{"value":null,"confidence":"low"},"tone":{"value":null,"confidence":"low"},"constraints":[],"understandingSignals":[{"classification":"FACT","statement":"s","source":"persona","confidence":"low"}]},"restatement":"r","clarifyingQuestion":"q","draft":null}';
  assert.throws(() => parseU1DraftResponse(dup), (e) =>
    e instanceof DistillParseError && e.reason === DISTILL_PARSE_REASON.DUPLICATE_KEY);
});

test('E3 escaped-equivalent duplicate nested rejected', () => {
  // nested "statement" vs "\u0073tatement" — same key after decode, must reject.
  const dup = '{"mode":"ask","understanding":{"recipient":{"name":null,"email":null,"confidence":"low"},"purpose":{"value":null,"confidence":"low"},"tone":{"value":null,"confidence":"low"},"constraints":[],"understandingSignals":[{"classification":"FACT","statement":"first","\\u0073tatement":"second","source":"persona","confidence":"low"}]},"restatement":"r","clarifyingQuestion":"q","draft":null}';
  assert.throws(() => parseU1DraftResponse(dup), (e) =>
    e instanceof DistillParseError && e.reason === DISTILL_PARSE_REASON.DUPLICATE_KEY);
});

test('E4 unknown key rejected', () => {
  const bad = draftJson({ somethingWeird: 1 });
  assert.throws(() => parseU1DraftResponse(bad), (e) =>
    e instanceof DistillParseError && e.reason === DISTILL_PARSE_REASON.UNKNOWN_KEY);
});

test('E5 invalid enum rejected (mode)', () => {
  const bad = draftJson({ mode: 'propose' });
  assert.throws(() => parseU1DraftResponse(bad), (e) =>
    e instanceof DistillParseError && e.reason === DISTILL_PARSE_REASON.INVALID_ENUM);
});

test('E5 invalid enum rejected (classification/source/confidence)', () => {
  const u = JSON.parse(draftJson());
  u.understanding.understandingSignals[0].classification = 'GUESS';
  assert.throws(() => parseU1DraftResponse(JSON.stringify(u)), (e) =>
    e instanceof DistillParseError && e.reason === DISTILL_PARSE_REASON.INVALID_ENUM);
});

test('E6 empty required field rejected (restatement empty)', () => {
  const bad = draftJson({ restatement: '' });
  assert.throws(() => parseU1DraftResponse(bad), (e) =>
    e instanceof DistillParseError && e.reason === DISTILL_PARSE_REASON.EMPTY_REQUIRED);
});

test('E6 empty required field rejected (no signals)', () => {
  const u = JSON.parse(draftJson());
  u.understanding.understandingSignals = [];
  assert.throws(() => parseU1DraftResponse(JSON.stringify(u)), (e) =>
    e instanceof DistillParseError && e.reason === DISTILL_PARSE_REASON.EMPTY_REQUIRED);
});

test('E7 inconsistent mode/draft combo rejected (ask + draft already covered; draft w/o object)', () => {
  const bad = draftJson({ draft: null });
  assert.throws(() => parseU1DraftResponse(bad), (e) =>
    e instanceof DistillParseError && e.reason === DISTILL_PARSE_REASON.MODE_DRAFT_INCONSISTENT);
});

/* ---------------------- F3. adapter failure semantics ---------------------- */

test('F3 adapter failure wrapped in IntakeUpstreamError with requestId', async () => {
  const boom = new Error('network down');
  const adapter = makeFakeAdapter({ throwError: boom });
  await assert.rejects(
    () => runU1DraftShadow({ instruction: 'x', adapter, history: [], requestId: 'rid-err', personaText: 'p' }),
    (e) => e.name === 'IntakeUpstreamError' && e.correlationId === 'rid-err' && e.cause === boom
  );
});

test('parse failure propagates as DistillParseError (not upstream)', async () => {
  const adapter = makeFakeAdapter({ text: '{ malformed' });
  await assert.rejects(
    () => runU1DraftShadow({ instruction: 'x', adapter, history: [], requestId: 'rid-parse', personaText: 'p' }),
    (e) => e instanceof DistillParseError
  );
});

/* ---------------------- H1. fake adapter shape check ----------------------- */

test('H1 fake adapter returns complete CompletionResult shape', async () => {
  const adapter = makeFakeAdapter({ text: askJson() });
  const r = await adapter.complete('p', { system: 's', maxTokens: 1024, temperature: 0.2 });
  assert.equal(typeof r.text, 'string');
  assert.equal(typeof r.usage.inputTokens, 'number');
  assert.equal(typeof r.usage.outputTokens, 'number');
  assert.equal(typeof r.usage.totalTokens, 'number');
  assert.equal(typeof r.model, 'string');
  assert.equal(typeof r.latencyMs, 'number');
});

test('adapter called with fixed maxTokens=1024 and temperature=0.2', async () => {
  const adapter = makeFakeAdapter({ text: askJson() });
  await runU1DraftShadow({ instruction: 'x', adapter, history: [], requestId: 'rid-opts', personaText: 'p' });
  assert.equal(adapter.calls.length, 1);
  assert.equal(adapter.calls[0].opts.maxTokens, 1024);
  assert.equal(adapter.calls[0].opts.temperature, 0.2);
  assert.equal(typeof adapter.calls[0].opts.system, 'string');
});
