'use strict'

/**
 * demoOutcome.test.js — B2-2 thin slice 1. Deterministic (no reasoning model):
 * the four canonical demo utterances' distill outputs map to the four expected
 * outcomes, plus precedence and fail-safe edge cases.
 *
 *   Run: node --test src/intake/demoOutcome.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { classifyDemoOutcome, OUTCOMES } = require('./demoOutcome')
const { DEMO_TURNS } = require('../adapters/fixtures/demoTurns')

test('the four canonical demo turns map to the four distinct outcomes', () => {
  for (const turn of DEMO_TURNS) {
    const { outcome } = classifyDemoOutcome(turn.distilled)
    assert.equal(outcome, turn.expectedOutcome, `input "${turn.input}" → ${turn.expectedOutcome}`)
  }
  const outcomes = DEMO_TURNS.map((t) => classifyDemoOutcome(t.distilled).outcome)
  assert.deepEqual(
    [...new Set(outcomes)].sort(),
    ['clarification', 'context', 'execution_proposal', 'speech'],
    'all four outcomes covered and distinct'
  )
})

test('precedence: commit → execution_proposal (execute signal never masked)', () => {
  assert.equal(classifyDemoOutcome({ mode: 'commit', intent: 'task' }).outcome, OUTCOMES.EXECUTION_PROPOSAL)
  assert.equal(classifyDemoOutcome({ mode: 'commit', intent: 'decision' }).outcome, OUTCOMES.EXECUTION_PROPOSAL)
})

test('ask → clarification', () => {
  assert.equal(classifyDemoOutcome({ mode: 'ask', intent: 'unclear' }).outcome, OUTCOMES.CLARIFICATION)
})

test('context intent → context (distinct from generic speech), in chat mode', () => {
  assert.equal(classifyDemoOutcome({ mode: 'chat', intent: 'context' }).outcome, OUTCOMES.CONTEXT)
})

test('non-context chat/recommend intents → speech', () => {
  for (const intent of ['chit_chat', 'greeting', 'question', 'brainstorm', 'advisory']) {
    assert.equal(classifyDemoOutcome({ mode: 'chat', intent }).outcome, OUTCOMES.SPEECH)
  }
  assert.equal(classifyDemoOutcome({ mode: 'recommend', intent: 'brainstorm' }).outcome, OUTCOMES.SPEECH)
})

test('fail-safe: missing / malformed input degrades to speech, never execution_proposal', () => {
  assert.equal(classifyDemoOutcome(undefined).outcome, OUTCOMES.SPEECH)
  assert.equal(classifyDemoOutcome(null).outcome, OUTCOMES.SPEECH)
  assert.equal(classifyDemoOutcome({}).outcome, OUTCOMES.SPEECH)
  assert.equal(classifyDemoOutcome({ mode: 42, intent: {} }).outcome, OUTCOMES.SPEECH)
  assert.equal(classifyDemoOutcome({ mode: 'weird', intent: 'nonsense' }).outcome, OUTCOMES.SPEECH)
})
