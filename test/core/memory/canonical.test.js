'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { canonicalize, sha256Hex, hashOf } = require('../../../src/core/memory/canonical')

test('same semantic content, different key insertion order -> identical SHA-256', () => {
  const a = { mode: 'x', decision: { statement: 's', rationale: 'r' }, tags: ['a', 'b'] }
  const b = { tags: ['a', 'b'], decision: { rationale: 'r', statement: 's' }, mode: 'x' }
  assert.equal(canonicalize(a), canonicalize(b))
  assert.equal(sha256Hex(canonicalize(a)), sha256Hex(canonicalize(b)))
  assert.match(sha256Hex(canonicalize(a)), /^[a-f0-9]{64}$/)
})

test('arrays preserve order (order is semantic)', () => {
  assert.notEqual(canonicalize([1, 2, 3]), canonicalize([3, 2, 1]))
})

test('UTF-8 content hashes deterministically', () => {
  assert.equal(sha256Hex(canonicalize({ t: '香香' })), sha256Hex(canonicalize({ t: '香香' })))
})

test('rejects undefined / function / symbol / NaN / Infinity', () => {
  for (const bad of [undefined, () => {}, Symbol('x'), NaN, Infinity, -Infinity]) {
    assert.throws(() => canonicalize(bad), (e) => e.code === 'CANONICAL_INVALID')
  }
  assert.throws(() => canonicalize({ a: undefined }), (e) => e.code === 'CANONICAL_INVALID')
  assert.throws(() => canonicalize({ a: NaN }), (e) => e.code === 'CANONICAL_INVALID')
})

test('hashOf excludes the named hash field', () => {
  const obj = { a: 1, b: 2, contentHash: 'ignore-me' }
  const h1 = hashOf(obj, 'contentHash')
  const h2 = hashOf({ a: 1, b: 2, contentHash: 'totally-different' }, 'contentHash')
  assert.equal(h1, h2) // hash independent of the excluded field
  assert.equal(h1, sha256Hex(canonicalize({ a: 1, b: 2 })))
})
