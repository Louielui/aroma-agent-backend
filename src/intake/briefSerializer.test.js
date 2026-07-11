'use strict'

/**
 * briefSerializer.test.js — v1 determinism for the Task → brief serializer.
 * Pure, no LLM, no I/O. Run: node --test src/intake/briefSerializer.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { serializeBriefV1, BRIEF_SERIALIZATION_VERSION } = require('./briefSerializer')

test('version constant is v1', () => {
  assert.equal(BRIEF_SERIALIZATION_VERSION, 'v1')
})

test('title + note → "Title: <t>\\n\\nDetails: <n>"', () => {
  assert.equal(
    serializeBriefV1({ title: 'Add supplier table', note: 'columns: id, name' }),
    'Title: Add supplier table\n\nDetails: columns: id, name'
  )
})

test('title only (missing note) → title-only', () => {
  assert.equal(serializeBriefV1({ title: 'Add supplier table' }), 'Title: Add supplier table')
})

test('blank/whitespace note → title-only (no empty Details section)', () => {
  assert.equal(serializeBriefV1({ title: 'X', note: '   ' }), 'Title: X')
  assert.equal(serializeBriefV1({ title: 'X', note: '' }), 'Title: X')
})

test('deterministic — same input yields identical output across calls', () => {
  const t = { title: 'A', note: 'B' }
  assert.equal(serializeBriefV1(t), serializeBriefV1(t))
})

test('NO expansion / substitution — output contains ONLY the task title+note verbatim', () => {
  const out = serializeBriefV1({ title: 'Stop polling', note: 'after terminal state' })
  // exactly the two fields, nothing invented (no steps, no decision, no reply)
  assert.equal(out, 'Title: Stop polling\n\nDetails: after terminal state')
  assert.equal(out.includes('Title: Stop polling'), true)
  assert.equal(out.includes('Details: after terminal state'), true)
})
