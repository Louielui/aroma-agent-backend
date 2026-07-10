'use strict'

/**
 * registry.test.js — unit tests for the Capability Registry.
 *
 * Uses the built-in Node test runner (node:test), no extra dependencies.
 *   Run: node --test src/capability/
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const registry = require('./registry')
const { getCapability, listActive, isRoutable, register } = registry

test('getCapability returns the typed contract', () => {
  const apply = getCapability('Apply', 1)

  // shape of the typed contract
  assert.equal(apply.id, 'Apply')
  assert.equal(apply.version, 1)
  assert.equal(apply.lifecycle, 'active')
  assert.equal(apply.risk_tier, 'medium')
  assert.equal(apply.approval_default, true) // medium risk → approval by default
  assert.equal(typeof apply.input_schema, 'object')
  assert.equal(typeof apply.output_schema, 'object')
  assert.equal(apply.input_schema.type, 'object')
  assert.equal(apply.output_schema.type, 'object')

  // contract is immutable
  assert.ok(Object.isFrozen(apply))

  // high-risk seeds carry an approval default too
  assert.equal(getCapability('Deploy', 1).risk_tier, 'high')
  assert.equal(getCapability('Rollback', 1).approval_default, true)
})

test('listActive returns only active capabilities and all seeds are active', () => {
  const active = listActive()
  assert.equal(active.length, 13)
  assert.ok(active.every(c => c.lifecycle === 'active'))
  const ids = active.map(c => c.id)
  assert.ok(['Think', 'Plan', 'Deploy', 'Learn', 'Monitor'].every(id => ids.includes(id)))
})

test('isRoutable is true for active, false for retired, and warns for deprecated', () => {
  // active seed → routable, no warning
  assert.equal(isRoutable('Think', 1), true)

  // retired → NOT routable
  register({ id: 'Analyze', version: 2, lifecycle: 'retired', risk_tier: 'none' })
  assert.equal(isRoutable('Analyze', 2), false)

  // deprecated → still routable, but warns
  register({ id: 'Analyze', version: 3, lifecycle: 'deprecated', risk_tier: 'none' })

  const original = console.warn
  let warned = 0
  let warnedMsg = ''
  console.warn = (msg) => { warned++; warnedMsg = String(msg) }
  try {
    assert.equal(isRoutable('Analyze', 3), true)
  } finally {
    console.warn = original
  }
  assert.equal(warned, 1)
  assert.match(warnedMsg, /deprecated/)
})

test('unknown version is rejected', () => {
  assert.throws(() => getCapability('Think', 99), RangeError)
  assert.throws(() => getCapability('DoesNotExist', 1), RangeError)
  // unknown (id, version) is simply not routable — no throw
  assert.equal(isRoutable('Think', 99), false)
})
