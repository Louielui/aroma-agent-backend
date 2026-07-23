'use strict';

/**
 * U1 Draft Shadow — orchestrator.
 *
 * Owns the SINGLE adapter.complete(...) call and the server-fixed output.
 * Structurally isolated: this module imports ONLY the pure prompt/parser module.
 * It does NOT import (and therefore cannot reach) any of:
 *   Gmail, Gateway, filesystem-write utilities, Memory store,
 *   Proposal Store, Run Store, Dispatcher.
 * The U1 branch returns before any of those could run.
 *
 * Adapter contract (LOCKED):
 *   adapter.complete(prompt, { system, maxTokens, temperature })
 *     -> { text, usage: { inputTokens, outputTokens, totalTokens }, model, latencyMs }
 *   We parse llmResult.text.
 *
 * Error semantics (LOCKED):
 *   adapter failure        -> wrapped in IntakeUpstreamError(requestId)
 *   parser/schema failure  -> DistillParseError propagates (thrown outward)
 *
 * Server-fixed fields (LOCKED) — appended ONLY after successful parse:
 *   stage = 'SHADOW_ONLY'
 *   gmailDraftCreated = false
 *   persistentMemoryWritten = false
 */

const { buildU1DraftPrompt, parseU1DraftResponse } = require('./u1DraftPrompt');
const { U1_DRAFT_SCHEMA, U1_DRAFT_SCHEMA_NAME } = require('./u1DraftSchema');

// Existing upstream-error contract (verified: src/intake/intakeErrors.js).
// IntakeUpstreamError is constructed with an OBJECT: { correlationId, cause }.
const { IntakeUpstreamError } = require('./intakeErrors');

const U1_MAX_TOKENS = 1024;
const U1_TEMPERATURE = 0.2;

const SERVER_FIXED = Object.freeze({
  stage: 'SHADOW_ONLY',
  gmailDraftCreated: false,
  persistentMemoryWritten: false,
});

/**
 * runU1DraftShadow — orchestration.
 *
 * @param {object} args
 * @param {string} args.instruction
 * @param {object} args.adapter        - injected LLM adapter with .complete(prompt, opts)
 * @param {Array}  [args.history]
 * @param {string} args.requestId
 * @param {string} [args.personaText]  - resolved runtime persona text (read-only)
 * @returns {Promise<object>} shadow result: ParsedU1Draft + server-fixed fields
 *
 * Throws:
 *   IntakeUpstreamError   on adapter failure
 *   DistillParseError     on parse/schema violation (propagated)
 */
async function runU1DraftShadow({ instruction, adapter, history, requestId, personaText }) {
  const { system, prompt } = buildU1DraftPrompt({ instruction, history, personaText });

  let llmResult;
  try {
    llmResult = await adapter.complete(prompt, {
      system,
      maxTokens: U1_MAX_TOKENS,
      temperature: U1_TEMPERATURE,
      // Vendor-neutral structured output (U1 ONLY). An adapter that cannot honor
      // it fails closed (thrown here -> IntakeUpstreamError); it is never ignored.
      // The raw text still flows through the UNCHANGED parseU1DraftResponse below.
      responseFormat: { type: 'json_schema', name: U1_DRAFT_SCHEMA_NAME, schema: U1_DRAFT_SCHEMA },
    });
  } catch (cause) {
    // Adapter failure ONLY -> IntakeUpstreamError(requestId). Do not leak internals.
    throw new IntakeUpstreamError({ correlationId: requestId, cause });
  }

  const rawText = llmResult ? llmResult.text : undefined;
  // parseU1DraftResponse throws DistillParseError on ANY violation (incl. wrong type).
  // It does NOT take a correlationId; the outer processIntake supplies requestId
  // when a thrown DistillParseError has no correlation yet.
  const parsed = parseU1DraftResponse(rawText);

  // Append server-fixed fields ONLY after successful parse. requestId is also
  // server-appended here (never from the model — the parser's exact-key check
  // rejects a model-supplied requestId as an unknown key). The three authority
  // fields cannot be model-supplied either (rejected as authority keys), so all
  // appended fields are authoritative.
  return {
    ...parsed,
    requestId,
    stage: SERVER_FIXED.stage,
    gmailDraftCreated: SERVER_FIXED.gmailDraftCreated,
    persistentMemoryWritten: SERVER_FIXED.persistentMemoryWritten,
  };
}

module.exports = {
  runU1DraftShadow,
  U1_MAX_TOKENS,
  U1_TEMPERATURE,
  SERVER_FIXED,
};
