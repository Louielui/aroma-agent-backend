'use strict'

/**
 * policy.test.js — unit tests for the Policy Engine.
 *
 * Uses the built-in Node test runner (node:test), no extra dependencies.
 *   Run: node --test src/capability/
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { evaluate, listRules } = require('./policy')

test('Apply to dev returns allow with requires_backup true', () => {
  const result = evaluate({ capabilityId: 'Apply', version: 1, target: 'dev' })
  assert.equal(result.verdict, 'allow')
  assert.equal(result.requires_backup, true)
  assert.equal(result.rule_id, 'apply-dev-auto')
})

test('Deploy to production returns require_approval', () => {
  const result = evaluate({ capabilityId: 'Deploy', version: 1, target: 'production' })
  assert.equal(result.verdict, 'require_approval')
  assert.equal(result.rule_id, 'prod-deploy-approval')
})

test('Rollback to production returns require_approval', () => {
  const result = evaluate({ capabilityId: 'Rollback', version: 1, target: 'production' })
  assert.equal(result.verdict, 'require_approval')
  assert.equal(result.rule_id, 'prod-deploy-approval')
})

test('data_domains including banking returns deny', () => {
  const result = evaluate({
    capabilityId: 'Report',
    version: 1,
    target: null,
    context: { data_domains: ['banking'] }
  })
  assert.equal(result.verdict, 'deny')
  assert.equal(result.rule_id, 'deny-sensitive-data')
})

test('description mentioning SIN returns deny', () => {
  const result = evaluate({
    capabilityId: 'Report',
    version: 1,
    target: null,
    context: { description: 'Export the customer SIN into a spreadsheet' }
  })
  assert.equal(result.verdict, 'deny')
  assert.equal(result.rule_id, 'deny-sensitive-data')
})

test('deny beats a would-be allow (banking + Apply to dev is denied first)', () => {
  const result = evaluate({
    capabilityId: 'Apply',
    version: 1,
    target: 'dev',
    context: { data_domains: ['banking'] }
  })
  // Apply-to-dev would allow, but deny-sensitive-data sits earlier in the table.
  assert.equal(result.verdict, 'deny')
  assert.equal(result.rule_id, 'deny-sensitive-data')
})

test('unmatched low-risk capability (Report) returns allow', () => {
  const result = evaluate({ capabilityId: 'Report', version: 1, target: null })
  assert.equal(result.verdict, 'allow')
  assert.equal(result.rule_id, 'default-allow')
  assert.equal(result.requires_backup, false)
})

test('high-risk capability with no other matching rule returns require_approval', () => {
  // Deploy is high risk; with target null neither the prod nor apply rules match,
  // so the high-risk safety net applies.
  const result = evaluate({ capabilityId: 'Deploy', version: 1, target: null })
  assert.equal(result.verdict, 'require_approval')
  assert.equal(result.rule_id, 'high-risk-approval')
})

test('evaluate throws for an unknown capability', () => {
  assert.throws(() => evaluate({ capabilityId: 'DoesNotExist', version: 1, target: null }), RangeError)
})

test('listRules returns the ordered rule table, deny first', () => {
  const rules = listRules()
  assert.equal(rules[0].rule_id, 'deny-sensitive-data')
  assert.equal(rules[rules.length - 1].rule_id, 'default-allow')
  assert.ok(rules.every(r => typeof r.reason === 'string' && typeof r.requires_backup === 'boolean'))
})
