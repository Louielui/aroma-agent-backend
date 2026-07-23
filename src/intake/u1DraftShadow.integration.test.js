'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildU1DraftPrompt,
  parseU1DraftResponse,
  DistillParseError,
  DISTILL_PARSE_REASON,
} = require('./u1DraftPrompt');
const { U1_DRAFT_SCHEMA_NAME } = require('./u1DraftSchema');

// Isolate the truth store to an OS temp dir BEFORE requiring intakeService, so
// recordLLMUsage()/hubClient writes never touch the repo's data/aroma-truth.json
// (which would break the exact 5-file changed-set and rollback ownership).
const os = require('node:os');

const previousDataDir = process.env.AROMA_DATA_DIR;
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-u1-integration-'));
process.env.AROMA_DATA_DIR = testDataDir;

test.after(() => {
  fs.rmSync(testDataDir, { recursive: true, force: true });
  if (previousDataDir === undefined) {
    delete process.env.AROMA_DATA_DIR;
  } else {
    process.env.AROMA_DATA_DIR = previousDataDir;
  }
});

// Real entrypoint under test (the ONLY export of intakeService).
// processIntake(message, adapter, history = [], opts = {})
// MUST remain AFTER AROMA_DATA_DIR is set.
const { processIntake } = require('./intakeService');

/* --------------------------- controlled adapters --------------------------- */

// Records every complete() call so we can assert prompt/system/opts and count.
function makeRecordingAdapter(textForCall) {
  const calls = [];
  return {
    calls,
    async complete(prompt, opts) {
      calls.push({ prompt, opts });
      const text = typeof textForCall === 'function' ? textForCall(calls.length) : textForCall;
      return {
        text,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        model: 'fake-u1-model',
        latencyMs: 1,
      };
    },
  };
}

// A valid U1 draft-shadow JSON response (mode=ask), for flag-ON tests.
function u1AskJson() {
  return JSON.stringify({
    mode: 'ask',
    understanding: {
      recipient: { name: null, email: null, confidence: 'low' },
      purpose: { value: null, confidence: 'low' },
      tone: { value: null, confidence: 'low' },
      constraints: [],
      understandingSignals: [
        { classification: 'TEMPORARY', statement: 'unclear intent', source: 'current_message', confidence: 'low' },
      ],
    },
    restatement: 'I am not yet sure what you want.',
    clarifyingQuestion: 'Could you clarify the recipient and goal?',
    draft: null,
  });
}

// An injectable persona source (existing opts.personaSource seam).
function makePersonaSource(marker) {
  return {
    runtimePersonaCalls: 0,
    runtimePersona() {
      this.runtimePersonaCalls += 1;
      return { personaText: marker };
    },
  };
}

// A red-line-blocked message. Uses English banking/password terms that the
// existing red-line policy patterns match (bank account / account number /
// password), so checkRedLine reliably blocks it.
const BLOCKED_MESSAGE = 'My TD bank account number is 1234567 and my password is hunter2';
const VALID_UUID = '11111111-2222-4333-8444-555555555555';

/* ==========================================================================
 * F1 — REAL red-line: adapter (model) is never called for blocked input.
 * Only the model call is asserted zero; red-line path legitimately calls
 * logRedLineBlock and attempts recordLLMUsage(...).catch(...).
 * ======================================================================== */

test('F1 real red-line: blocked===true and adapter/model call count === 0', async () => {
  const adapter = makeRecordingAdapter(u1AskJson());
  const personaSource = makePersonaSource('MARKER_F1');
  const res = await processIntake(BLOCKED_MESSAGE, adapter, [], {
    u1DraftShadow: true,
    requestId: VALID_UUID,
    personaSource,
  });
  assert.equal(res.blocked, true);
  assert.equal(adapter.calls.length, 0); // model never called on blocked input
});

/* ==========================================================================
 * G1 — flag OFF / non-boolean-true: existing pipeline preserved, U1 not entered.
 * Each subtest uses an INDEPENDENT adapter (no shared call state).
 * The adapter returns an existing distill-schema response so the legacy path
 * behaves normally. We assert:
 *   - result.stage !== 'SHADOW_ONLY'   (U1 branch not taken)
 *   - adapter.calls.length === 1        (pipeline reached the distill model call)
 *   - adapter.calls[0].opts.system does NOT contain 'DRAFT PROPOSAL SHADOW'
 *   - personaSource.runtimePersona was NOT called by a U1 branch
 * ======================================================================== */

// A minimal valid EXISTING distill-schema response so the legacy STEP 2+ path
// can proceed without throwing. Mirrors the fields the distill parser expects.
function legacyDistillJson() {
  // Canonical legacy distill response (valid mode 'chat'; not relying on fallback).
  return JSON.stringify({
    mode: 'chat',
    intent: 'context',
    reply: 'ok',
  });
}

for (const flagVal of [undefined, false, 1, 'true', {}, []]) {
  test(`G1 flag OFF/non-true (${JSON.stringify(flagVal)}): legacy path, U1 not entered`, async () => {
    const adapter = makeRecordingAdapter(legacyDistillJson());
    const personaSource = makePersonaSource('MARKER_G1');
    const opts = { requestId: VALID_UUID, personaSource };
    if (flagVal !== undefined) opts.u1DraftShadow = flagVal;

    const res = await processIntake('普通訊息', adapter, [], opts);

    assert.notEqual(res.stage, 'SHADOW_ONLY'); // U1 branch NOT taken
    assert.equal(adapter.calls.length, 1);     // reached the distill model call
    assert.ok(
      !adapter.calls[0].opts.system.includes('DRAFT PROPOSAL SHADOW'),
      'legacy distill system prompt must not be the U1 shadow prompt'
    );
    assert.equal(personaSource.runtimePersonaCalls, 0, 'U1 persona seam must not run when flag is off');
  });
}

/* ==========================================================================
 * G2 — flag ON (=== true): U1 runs via real processIntake and early-returns.
 * Persona marker is asserted on opts.system (the runU1DraftShadow system arg),
 * NOT on the prompt positional argument.
 * ======================================================================== */

test('G2 flag ON: U1 uses runtimePersona().personaText and early-returns SHADOW_ONLY', async () => {
  const adapter = makeRecordingAdapter(u1AskJson());
  const personaSource = makePersonaSource('MARKER_XYZ');

  const res = await processIntake('回覆某人', adapter, [], {
    u1DraftShadow: true,
    requestId: VALID_UUID,
    personaSource,
  });

  // persona seam used exactly once
  assert.equal(personaSource.runtimePersonaCalls, 1);

  // exactly one model call, with U1 system + persona marker in opts.system
  assert.equal(adapter.calls.length, 1);
  assert.ok(adapter.calls[0].opts.system.includes('DRAFT PROPOSAL SHADOW'), 'U1 system prompt expected');
  assert.ok(adapter.calls[0].opts.system.includes('MARKER_XYZ'), 'persona marker must be in opts.system');
  assert.equal(adapter.calls[0].opts.maxTokens, 1024);
  assert.equal(adapter.calls[0].opts.temperature, 0.2);

  // U1 early-return shape (server-fixed + server-appended requestId)
  assert.equal(res.stage, 'SHADOW_ONLY');
  assert.equal(res.requestId, VALID_UUID);
  assert.equal(res.gmailDraftCreated, false);
  assert.equal(res.persistentMemoryWritten, false);
  assert.ok(res.mode === 'ask' || res.mode === 'draft_proposal');
});

/* ==========================================================================
 * ZERO-MUTATION — three layers (not just result fields):
 *   L1 real entrypoint returns U1-only stage SHADOW_ONLY (above, G2).
 *   L2 the U1-only result shape (stage=SHADOW_ONLY + server-appended requestId)
 *      proves the flag-ON call returned THROUGH U1; the legacy path does not
 *      produce these fields. (The legacy parser is permissive and may normalize
 *      an arbitrary object, so it is not relied on to reject.)
 *   L3 structural reachability: the mount sits AFTER red-line blocked return and
 *      BEFORE STEP 2 / persistIntake / dispatch, each anchor exactly once and in order.
 * ======================================================================== */

test('L2 U1-only result shape proves the flag-ON call returned through U1', async () => {
  // The legacy parser is permissive and may normalize an arbitrary JSON object
  // rather than reject it, so "legacy would reject" is NOT the proof here.
  // The proof is the authoritative U1-only result shape — specifically
  // stage='SHADOW_ONLY' plus the server-appended requestId — which the legacy
  // path does not produce.
  const adapter = makeRecordingAdapter(u1AskJson());
  const personaSource = makePersonaSource('MARKER_L2');
  const res = await processIntake('x', adapter, [], {
    u1DraftShadow: true,
    requestId: VALID_UUID,
    personaSource,
  });
  assert.equal(res.stage, 'SHADOW_ONLY');
  assert.equal(res.requestId, VALID_UUID);
});

test('L3 scoped exact-call reachability: mount wiring inside runIntakePipeline', () => {
  const serviceSource = fs.readFileSync(path.join(__dirname, 'intakeService.js'), 'utf8');

  // Scope to the runIntakePipeline function body ONLY (avoid top-of-file imports
  // of persistIntake / createDispatchesForTasks polluting bare indexOf).
  const signature = 'async function runIntakePipeline (message, adapter, history, opts, requestId) {';
  const fnStart = serviceSource.indexOf(signature);
  const fnEnd = serviceSource.indexOf('\nmodule.exports = { processIntake }', fnStart);
  assert.ok(fnStart >= 0, 'runIntakePipeline signature missing');
  assert.ok(fnEnd > fnStart, 'runIntakePipeline boundary missing');
  const pipeline = serviceSource.slice(fnStart, fnEnd);

  // red-line blocked return block (scoped)
  const blockedMatch = /if\s*\(\s*redLine\.blocked\s*\)\s*\{[\s\S]*?return\s*\{[\s\S]*?blocked\s*:\s*true[\s\S]*?\n\s*\}\s*\n\s*\}/.exec(pipeline);
  assert.ok(blockedMatch, 'red-line blocked return block missing');
  const blockedEnd = blockedMatch.index + blockedMatch[0].length;

  // exact-call / exact-wiring anchors, each searched forward from the previous
  const flag = pipeline.indexOf('if (opts && opts.u1DraftShadow === true)');
  const personaSource = pipeline.indexOf('const src = (opts && opts.personaSource) || getPersonaSource()', flag);
  const runtimePersona = pipeline.indexOf('const runtimePersona = src.runtimePersona()', personaSource);
  const u1Return = pipeline.indexOf('return await runU1DraftShadow({', runtimePersona);
  const personaArgument = pipeline.indexOf('personaText: runtimePersona.personaText', u1Return);
  // ASCII-only anchor: the dash glyphs (U+2500 box-drawing) can be normalized to
  // em-dash (U+2014) during file transfer, so match on the ASCII substring which
  // cannot be corrupted and is unique in the pipeline.
  const step2 = pipeline.indexOf('STEP 2: LLM DISTILLATION');
  const persistCall = pipeline.indexOf('const persisted = await persistIntake(persistPayload)');
  const dispatchCall = pipeline.indexOf('const dispatched = createDispatchesForTasks(tasksWithCap, decisionId)');

  for (const [name, pos] of Object.entries({
    flag, personaSource, runtimePersona, u1Return, personaArgument, step2, persistCall, dispatchCall,
  })) {
    assert.ok(pos >= 0, `${name} anchor missing`);
  }

  // strict order: blocked return < flag < persona seam < runtimePersona < U1 return
  //   < personaText arg < STEP 2 < persist call < dispatch call
  assert.ok(blockedEnd < flag, 'blocked return must precede U1 flag');
  assert.ok(flag < personaSource, 'flag must precede persona source seam');
  assert.ok(personaSource < runtimePersona, 'persona source must precede runtimePersona()');
  assert.ok(runtimePersona < u1Return, 'runtimePersona() must precede U1 return');
  assert.ok(u1Return < personaArgument, 'U1 return must precede personaText argument');
  assert.ok(personaArgument < step2, 'U1 block must precede STEP 2');
  assert.ok(step2 < persistCall, 'STEP 2 must precede persist call');
  assert.ok(persistCall < dispatchCall, 'persist call must precede dispatch call');

  // Whole-pipeline uniqueness (these must be unique across the entire function):
  const flagMatches = pipeline.match(/if\s*\(\s*opts\s*&&\s*opts\.u1DraftShadow\s*===\s*true\s*\)/g) || [];
  assert.equal(flagMatches.length, 1, 'strict === true flag check must appear exactly once');
  assert.equal(pipeline.split('return await runU1DraftShadow({').length - 1, 1, 'exactly one runU1DraftShadow call');

  // The persona-source seam string ALSO appears in the existing demo block, so it
  // is NOT unique across the whole pipeline. Count it ONLY inside the U1 mount
  // block (from the flag to STEP 2), where it must appear exactly once.
  const mountBlock = pipeline.slice(flag, step2);
  assert.equal(
    mountBlock.split('const src = (opts && opts.personaSource) || getPersonaSource()').length - 1,
    1,
    'U1 mount must contain exactly one persona source seam'
  );
  assert.equal(
    mountBlock.split('const runtimePersona = src.runtimePersona()').length - 1,
    1,
    'U1 mount must resolve runtime persona exactly once'
  );
  assert.equal(
    mountBlock.split('personaText: runtimePersona.personaText').length - 1,
    1,
    'U1 mount must pass runtime personaText exactly once'
  );
});

/* ==========================================================================
 * S1 — Structured output wiring through the REAL processIntake.
 *   flag ON  => U1 supplies responseFormat (json_schema, U1 name) exactly once.
 *   flag OFF => legacy path supplies NO responseFormat.
 * ======================================================================== */

test('S1 flag ON: processIntake -> U1 supplies responseFormat with the U1 schema name', async () => {
  const adapter = makeRecordingAdapter(u1AskJson());
  const personaSource = makePersonaSource('MARKER_S1');
  const res = await processIntake('回覆某人', adapter, [], {
    u1DraftShadow: true, requestId: VALID_UUID, personaSource,
  });
  assert.equal(adapter.calls.length, 1);
  const rf = adapter.calls[0].opts.responseFormat;
  assert.ok(rf && rf.type === 'json_schema', 'responseFormat present with json_schema type');
  assert.equal(rf.name, U1_DRAFT_SCHEMA_NAME);
  assert.ok(rf.schema && rf.schema.type === 'object' && rf.schema.additionalProperties === false);
  assert.equal(res.stage, 'SHADOW_ONLY');
});

test('S1 flag OFF: legacy distill path supplies NO responseFormat', async () => {
  const adapter = makeRecordingAdapter(legacyDistillJson());
  const personaSource = makePersonaSource('MARKER_S1OFF');
  await processIntake('普通訊息', adapter, [], { requestId: VALID_UUID, personaSource });
  assert.equal(adapter.calls.length, 1);
  assert.equal(adapter.calls[0].opts.responseFormat, undefined, 'legacy call must not carry responseFormat');
});

/* ==========================================================================
 * F2 — Zero downstream mutation via IMPORT / DEPENDENCY assertions (PRESERVED).
 * ======================================================================== */

const U1_SOURCE_FILES = ['u1DraftShadow.js', 'u1DraftPrompt.js', 'u1DraftSchema.js'];

function extractRequireTargets(source) {
  const targets = [];
  const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(source)) !== null) targets.push(m[1]);
  return targets;
}

test('F2 U1 modules do not import any Gmail/Gateway/store/dispatch/memory/fs-write seam', () => {
  for (const f of U1_SOURCE_FILES) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    const targets = extractRequireTargets(src);
    // Allowed non-mutation deps:
    //   u1DraftShadow.js -> ./u1DraftPrompt (pure), ./intakeErrors (upstream-error contract)
    //   u1DraftPrompt.js -> ./distillPrompt (DistillParseError contract; pure error class)
    const ALLOWED_REQUIRES = ['./u1DraftPrompt', './u1DraftSchema', './intakeErrors', './distillPrompt'];
    for (const t of targets) {
      assert.ok(
        ALLOWED_REQUIRES.includes(t),
        `${f} requires unexpected module "${t}" (allowed: ${ALLOWED_REQUIRES.join(', ')})`
      );
    }
  }
});

test('F2 U1 modules contain no direct write/dispatch/persist call sites', () => {
  const forbiddenCallSites = [
    'persistIntake', 'createDispatchesForTasks', 'executeDispatch',
    'dispatch(', 'dispatcher.', 'gateway.', 'gmail.',
    'writeFileSync', 'writeFile(', 'proposalStore.', 'runStore.', 'memory.write', 'saveMemory',
  ];
  for (const f of U1_SOURCE_FILES) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    for (const marker of forbiddenCallSites) {
      assert.ok(!src.includes(marker), `${f} must not contain forbidden call site "${marker}"`);
    }
  }
});

/* ==========================================================================
 * R1 / R1b / R2 — regression coverage (PRESERVED).
 * ======================================================================== */

test('R1 history uses h.text (regression)', () => {
  const { prompt } = buildU1DraftPrompt({
    instruction: 'reply',
    history: [{ role: 'user', text: 'REAL_TEXT_FIELD_MARKER' }],
  });
  assert.ok(prompt.includes('REAL_TEXT_FIELD_MARKER'), 'h.text must be read into the prompt');
});

test('R1b history falls back to h.content when text absent', () => {
  const { prompt } = buildU1DraftPrompt({
    instruction: 'reply',
    history: [{ role: 'user', content: 'FALLBACK_CONTENT_MARKER' }],
  });
  assert.ok(prompt.includes('FALLBACK_CONTENT_MARKER'), 'h.content fallback must still work');
});

test('R2 malformed JSON that passes shape guard hits MALFORMED_JSON branch', () => {
  const bad = '{"mode":}';
  assert.throws(() => parseU1DraftResponse(bad), (e) =>
    e instanceof DistillParseError && e.reason === DISTILL_PARSE_REASON.MALFORMED_JSON);
});
