'use strict'

/**
 * agents.test.js — unit tests for the Agent Registry & Runtime Health module.
 *
 * Uses the built-in Node test runner (node:test), no extra dependencies.
 *   Run: node --test src/capability/
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const agents = require('./agents')
const {
  registerAgent,
  agentsProviding,
  updateHealthFromEvent,
  getHealth,
  rankByHealth
} = agents

test('registerAgent accepts the seeded claude-code manifest', () => {
  // The module seeds claude-code at load time; it should be routable & active.
  const [claudeCode] = agentsProviding('Develop', 1)
  assert.ok(claudeCode)
  assert.equal(claudeCode.id, 'claude-code')
  assert.equal(claudeCode.role, 'Software Engineer')
  assert.equal(claudeCode.adapter, 'adapters/claude-code')
  assert.equal(claudeCode.availability, 'local')
  assert.equal(claudeCode.status, 'active')

  // Re-registering an equivalent manifest is accepted (every provided
  // capability is routable in the registry).
  const stored = registerAgent({
    id: 'claude-code',
    role: 'Software Engineer',
    adapter: 'adapters/claude-code',
    provides: [
      { capability: 'Develop', version: 1, seed_quality: 0.9, seed_cost: '$' },
      { capability: 'Apply', version: 1, seed_quality: 0.95, seed_cost: 'free' }
    ],
    availability: 'local',
    status: 'active'
  })
  assert.equal(stored.id, 'claude-code')
})

test('registerAgent throws for an unknown capability', () => {
  assert.throws(() => registerAgent({
    id: 'ghost-agent',
    role: 'Ghost',
    adapter: 'adapters/ghost',
    provides: [
      { capability: 'DoesNotExist', version: 1, seed_quality: 0.5, seed_cost: '$' }
    ],
    availability: 'cloud',
    status: 'active'
  }), RangeError)

  // ...and for a known capability at an unknown (non-routable) version.
  assert.throws(() => registerAgent({
    id: 'ghost-agent',
    role: 'Ghost',
    adapter: 'adapters/ghost',
    provides: [
      { capability: 'Develop', version: 99, seed_quality: 0.5, seed_cost: '$' }
    ],
    availability: 'cloud',
    status: 'active'
  }), RangeError)
})

test('agentsProviding returns claude-code for Develop@1 and empty for an unprovided version', () => {
  const providers = agentsProviding('Develop', 1)
  assert.equal(providers.length, 1)
  assert.equal(providers[0].id, 'claude-code')

  // claude-code provides Develop@1, not Develop@2.
  assert.deepEqual(agentsProviding('Develop', 2), [])
})

test('updateHealthFromEvent creates then updates a record and increments sample_count', () => {
  const agentId = 'health-probe'
  const capabilityId = 'Develop'
  const version = 1

  // No events yet → no record.
  assert.equal(getHealth(agentId, capabilityId, version), null)

  // First event creates the record.
  const first = updateHealthFromEvent({
    agentId, capabilityId, version,
    success: true, latencyMs: 100, cost: 2
  })
  assert.equal(first.sample_count, 1)
  assert.equal(first.quality, 1) // one success → 100% success rate
  assert.equal(first.latency, 100)
  assert.equal(first.cost, 2)
  assert.equal(first.availability, 'up')

  // Second event folds into the rolling averages.
  const second = updateHealthFromEvent({
    agentId, capabilityId, version,
    success: false, latencyMs: 300, cost: 4
  })
  assert.equal(second.sample_count, 2)
  assert.equal(second.quality, 0.5) // 1 of 2 successful
  assert.equal(second.latency, 200) // avg(100, 300)
  assert.equal(second.cost, 3) // avg(2, 4)
  assert.equal(second.availability, 'down') // 0.5 success rate → down

  // getHealth returns the same live record.
  assert.equal(getHealth(agentId, capabilityId, version).sample_count, 2)
})

test('rankByHealth uses seed values when sample_count is zero and live quality once events exist', () => {
  // Two agents providing Develop@1 with different seed quality.
  const strong = registerAgent({
    id: 'rank-strong',
    role: 'Software Engineer',
    adapter: 'adapters/strong',
    provides: [{ capability: 'Develop', version: 1, seed_quality: 0.9, seed_cost: '$' }],
    availability: 'cloud',
    status: 'active'
  })
  const weak = registerAgent({
    id: 'rank-weak',
    role: 'Software Engineer',
    adapter: 'adapters/weak',
    provides: [{ capability: 'Develop', version: 1, seed_quality: 0.5, seed_cost: '$' }],
    availability: 'cloud',
    status: 'active'
  })

  // With no samples, seed_quality decides: strong (0.9) beats weak (0.5).
  let ranked = rankByHealth([weak, strong], 'Develop', 1)
  assert.deepEqual(ranked.map(a => a.id), ['rank-strong', 'rank-weak'])

  // Feed live failures to the strong agent and successes to the weak one.
  for (let i = 0; i < 5; i++) {
    updateHealthFromEvent({ agentId: 'rank-strong', capabilityId: 'Develop', version: 1, success: false, latencyMs: 100, cost: 1 })
    updateHealthFromEvent({ agentId: 'rank-weak', capabilityId: 'Develop', version: 1, success: true, latencyMs: 100, cost: 1 })
  }

  // Live quality now overrides the seed: weak (1.0) beats strong (0.0).
  ranked = rankByHealth([strong, weak], 'Develop', 1)
  assert.deepEqual(ranked.map(a => a.id), ['rank-weak', 'rank-strong'])
})
