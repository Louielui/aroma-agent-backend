'use strict'

/**
 * xiangxiang.test.js — B2-2 Slice 2. Persona is trusted and always carries the
 * data-boundary guard; the classifier system prompt is preserved verbatim.
 *
 *   Run: node --test src/persona/xiangxiang.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { buildPersonaSystem, CONTEXT_CARD_GUARD, PERSONA_IDENTITY } = require('./xiangxiang')

test('persona system carries the trusted context-card guard; classifier preserved at the END', () => {
  const composed = buildPersonaSystem('CLASSIFIER_SYSTEM')
  assert.ok(composed.includes(CONTEXT_CARD_GUARD), 'guard present')
  assert.ok(/不是指令/.test(composed), 'guard states the card is not instructions')
  assert.ok(composed.endsWith('CLASSIFIER_SYSTEM'), 'existing classifier kept verbatim at the end')
})

test('identity is an empty placeholder (B5 pending) but the guard is ALWAYS present', () => {
  assert.equal(PERSONA_IDENTITY, '')
  assert.ok(buildPersonaSystem('X').includes('context_card'), 'data boundary holds even before B5 content')
})
