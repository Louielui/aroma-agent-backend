'use strict'

/**
 * adapter.test.js — unit tests for the Worker Adapter contract helpers.
 *
 * Uses the built-in Node test runner (node:test), no extra dependencies.
 *   Run: node --test src/capability/
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { validateAdapter, createResult } = require('./adapter')

test('validateAdapter throws when invoke is missing', () => {
  assert.throws(() => validateAdapter({ health: () => ({}) }), TypeError)
})

test('validateAdapter throws when health is missing', () => {
  assert.throws(() => validateAdapter({ invoke: () => ({}) }), TypeError)
})

test('validateAdapter throws when a method is not a function', () => {
  assert.throws(() => validateAdapter({ invoke: 'nope', health: () => ({}) }), TypeError)
  assert.throws(() => validateAdapter({ invoke: () => ({}), health: 42 }), TypeError)
})

test('validateAdapter passes for a well-formed adapter and returns it', () => {
  const adapter = { invoke: () => ({}), health: () => ({}) }
  assert.equal(validateAdapter(adapter), adapter)
})

test('createResult fills safe defaults', () => {
  const r = createResult()
  assert.equal(r.ok, false)
  assert.deepEqual(r.output, {})
  assert.equal(r.error, null)
  assert.equal(r.cost, 0)
  assert.equal(r.latencyMs, 0)
})

test('createResult preserves provided values', () => {
  const r = createResult({ ok: true, output: { a: 1 }, error: 'boom', cost: 3, latencyMs: 12 })
  assert.equal(r.ok, true)
  assert.deepEqual(r.output, { a: 1 })
  assert.equal(r.error, 'boom')
  assert.equal(r.cost, 3)
  assert.equal(r.latencyMs, 12)
})
