'use strict';

/**
 * u1DraftSchema — JSON Schema for U1 Draft Shadow structured output.
 *
 * Uses ONLY the Anthropic-supported constrained-decoding subset:
 *   - additionalProperties:false on EVERY object
 *   - enums for mode / confidence / classification / source
 *   - nullable via type arrays (["string","null"], ["object","null"])
 *   - NO oneOf / anyOf / allOf / $ref / const / minLength / minItems
 *
 * SHAPE ONLY. The ask vs draft_proposal semantic mutual exclusion
 * (mode <-> draft <-> clarifyingQuestion) is NOT expressed here — it is
 * enforced authoritatively by the UNCHANGED parseU1DraftResponse
 * (src/intake/u1DraftPrompt.js). This module is decoupled from the
 * prompt/parser module on purpose (keeps that file byte-identical).
 */

const CONFIDENCE = ['high', 'medium', 'low'];

const U1_DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['mode', 'understanding', 'restatement', 'clarifyingQuestion', 'draft'],
  properties: {
    mode: { type: 'string', enum: ['ask', 'draft_proposal'] },
    understanding: {
      type: 'object',
      additionalProperties: false,
      required: ['recipient', 'purpose', 'tone', 'constraints', 'understandingSignals'],
      properties: {
        recipient: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'email', 'confidence'],
          properties: {
            name: { type: ['string', 'null'] },
            email: { type: ['string', 'null'] },
            confidence: { type: 'string', enum: CONFIDENCE },
          },
        },
        purpose: {
          type: 'object',
          additionalProperties: false,
          required: ['value', 'confidence'],
          properties: {
            value: { type: ['string', 'null'] },
            confidence: { type: 'string', enum: CONFIDENCE },
          },
        },
        tone: {
          type: 'object',
          additionalProperties: false,
          required: ['value', 'confidence'],
          properties: {
            value: { type: ['string', 'null'] },
            confidence: { type: 'string', enum: CONFIDENCE },
          },
        },
        constraints: { type: 'array', items: { type: 'string' } },
        understandingSignals: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['classification', 'statement', 'source', 'confidence'],
            properties: {
              classification: { type: 'string', enum: ['FACT', 'PREFERENCE', 'TEMPORARY'] },
              statement: { type: 'string' },
              source: { type: 'string', enum: ['current_message', 'session_context', 'persona'] },
              confidence: { type: 'string', enum: CONFIDENCE },
            },
          },
        },
      },
    },
    restatement: { type: 'string' },
    clarifyingQuestion: { type: ['string', 'null'] },
    draft: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['to', 'subject', 'body', 'tone'],
      properties: {
        to: { type: ['string', 'null'] },
        subject: { type: 'string' },
        body: { type: 'string' },
        tone: { type: 'string' },
      },
    },
  },
};

const U1_DRAFT_SCHEMA_NAME = 'u1_draft_shadow';

module.exports = { U1_DRAFT_SCHEMA, U1_DRAFT_SCHEMA_NAME };
