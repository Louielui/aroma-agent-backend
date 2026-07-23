'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { splitIdentity, MARKER } = require('../../../../src/core/memory/shadow/identityShadow')
const { PERSONA_IDENTITY } = require('../../../../src/persona/xiangxiang')

test('marker occurs exactly once in the real frozen PERSONA_IDENTITY', () => {
  assert.equal(MARKER, '\n\n1. 思考順序:')
  assert.notEqual(PERSONA_IDENTITY.indexOf(MARKER), -1)
  assert.equal(PERSONA_IDENTITY.indexOf(MARKER), PERSONA_IDENTITY.lastIndexOf(MARKER))
})

test('split reconstitutes PERSONA_IDENTITY byte-for-byte', () => {
  const { frozenIdentityText, remainder } = splitIdentity(PERSONA_IDENTITY)
  assert.equal(frozenIdentityText + remainder, PERSONA_IDENTITY) // exact recomposition
  assert.ok(frozenIdentityText.length > 0 && remainder.startsWith(MARKER))
})

test('Identity prefix excludes Personality / Business Context / Runtime sections', () => {
  const { frozenIdentityText, remainder } = splitIdentity(PERSONA_IDENTITY)
  // Identity prefix must NOT contain markers of the other domains:
  assert.equal(frozenIdentityText.includes('1. 思考順序:'), false) // Operating Principles / Personality
  assert.equal(frozenIdentityText.includes('Aroma Central Kitchen'), false) // Stable Business Context
  assert.equal(frozenIdentityText.includes('即時事實'), false) // Runtime & Governance Awareness
  // but the remainder does carry them
  assert.ok(remainder.includes('1. 思考順序:'))
  assert.ok(remainder.includes('即時事實'))
  // Identity prefix keeps the who-am-I opening
  assert.ok(frozenIdentityText.includes('AI 營運長'))
})

test('split contract errors: missing marker / multiple markers', () => {
  assert.throws(() => splitIdentity('no marker here'), (e) => e.code === 'IDENTITY_SPLIT_CONTRACT_ERROR')
  assert.throws(() => splitIdentity('a' + MARKER + 'b' + MARKER + 'c'), (e) => e.code === 'IDENTITY_SPLIT_CONTRACT_ERROR')
  assert.throws(() => splitIdentity(''), (e) => e.code === 'IDENTITY_SPLIT_CONTRACT_ERROR')
})
