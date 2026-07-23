'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const store = require('../../../../src/core/memory/store')
const { verifyIdentityShadow, seedIdentity, REASON, IDENTITY_RECORD_ID } = require('../../../../src/core/memory/shadow/identityShadow')
const { tmpBase, cleanup } = require('../_helpers')

// Synthetic persona (deterministic, isolated) that satisfies the marker contract.
const FAKE = 'WHO I AM — 香香, AI COO.' + '\n\n1. 思考順序:' + 'principles + business context + runtime awareness'
const SEED_OPTS = { approvalRef: 'gate/2026', rationale: 'M2 migration', sourceCommit: 'a8d230b998bb547578d70e602b318a91493a9595' }

function seed (base, persona) { return seedIdentity(base, { personaIdentity: persona, ...SEED_OPTS }) }

test('PASS after a valid seed; metadata is safe (no Identity text) and carries hashes', () => {
  const base = tmpBase()
  try {
    seed(base, FAKE)
    const v = verifyIdentityShadow(base, FAKE)
    assert.equal(v.status, REASON.PASS)
    assert.equal(v.reconstituteOk, true)
    assert.match(v.hFrozenIdentity, /^[a-f0-9]{64}$/)
    assert.match(v.hShadow, /^[a-f0-9]{64}$/)
    const s = JSON.stringify(v)
    assert.equal(s.includes('WHO I AM'), false) // never leaks Identity text
    assert.equal(s.includes('香香'), false)
  } finally { cleanup(base) }
})

test('IDENTITY_TEXT_MISMATCH: valid active revision but text differs (exact-string, not hash-masked)', () => {
  const base = tmpBase()
  try {
    seed(base, FAKE)
    const DRIFTED = 'WHO I AM — 香香, AI COO (edited).' + '\n\n1. 思考順序:' + 'principles + business context + runtime awareness'
    assert.equal(verifyIdentityShadow(base, DRIFTED).status, REASON.IDENTITY_TEXT_MISMATCH)
  } finally { cleanup(base) }
})

test('NO_ACTIVE_IDENTITY when nothing is seeded', () => {
  const base = tmpBase()
  try {
    store.createRevision(base, 'personality', { recordId: 'x', selectors: { tags: [], links: [] }, provenance: { source: 's', author: 'a', evidence: [] }, payload: { v: 1 }, createdAtLabel: 'L' }) // unrelated store
    assert.equal(verifyIdentityShadow(base, FAKE).status, REASON.NO_ACTIVE_IDENTITY)
  } finally { cleanup(base) }
})

test('AMBIGUOUS_ACTIVE_IDENTITY when two identity revisions are both active', () => {
  const base = tmpBase()
  try {
    seed(base, FAKE) // r1 active
    // craft a SECOND active revision for the same record (bypassing the seeder duplicate guard)
    const { splitIdentity } = require('../../../../src/core/memory/shadow/identityShadow')
    const { frozenIdentityText } = splitIdentity(FAKE)
    const r2 = store.createRevision(base, 'identity', { recordId: IDENTITY_RECORD_ID, revisionId: 'r2', selectors: { tags: [], links: [] }, provenance: { source: 's', author: 'a', evidence: [] }, payload: { format: 'verbatim', section: 'identity', text: frozenIdentityText }, createdAtLabel: 'L' })
    store.recordEvent(base, 'identity', { recordId: IDENTITY_RECORD_ID, targetRevisionId: r2.revisionId, eventType: 'SUBMITTED_FOR_REVIEW', actor: 'x', rationale: 'r', expectedPreviousState: 'new', timestampLabel: 'L' })
    store.recordEvent(base, 'identity', { recordId: IDENTITY_RECORD_ID, targetRevisionId: r2.revisionId, eventType: 'APPROVED', actor: 'x', approval: { approvedBy: 'Louie', decision: 'approved' }, rationale: 'r', expectedPreviousState: 'review_ready', timestampLabel: 'L' })
    store.recordEvent(base, 'identity', { recordId: IDENTITY_RECORD_ID, targetRevisionId: r2.revisionId, eventType: 'ACTIVATED', actor: 'x', rationale: 'r', expectedPreviousState: 'approved', timestampLabel: 'L' })
    assert.equal(verifyIdentityShadow(base, FAKE).status, REASON.AMBIGUOUS_ACTIVE_IDENTITY)
  } finally { cleanup(base) }
})

test('CORRUPT precedence: a corrupt identity revision -> IDENTITY_STORE_CORRUPT, never downgraded to NO_ACTIVE', () => {
  const base = tmpBase()
  try {
    const r = seed(base, FAKE)
    const p = path.join(base, 'identity', 'records', IDENTITY_RECORD_ID, `${r.revisionId}.json`)
    fs.writeFileSync(p, 'garbage-not-json', 'utf8') // corrupt the only revision
    assert.equal(verifyIdentityShadow(base, FAKE).status, REASON.IDENTITY_STORE_CORRUPT)
  } finally { cleanup(base) }
})

test('CORRUPT precedence: a corrupt identity lifecycle event -> IDENTITY_STORE_CORRUPT', () => {
  const base = tmpBase()
  try {
    seed(base, FAKE)
    const evDir = path.join(base, 'identity', 'events', IDENTITY_RECORD_ID)
    const anEvent = fs.readdirSync(evDir).filter((f) => f.endsWith('.json'))[0]
    fs.writeFileSync(path.join(evDir, anEvent), '{ broken', 'utf8')
    assert.equal(verifyIdentityShadow(base, FAKE).status, REASON.IDENTITY_STORE_CORRUPT)
  } finally { cleanup(base) }
})

test('unrelated record corruption in the identity store does not block xiangxiang-identity', () => {
  const base = tmpBase()
  try {
    seed(base, FAKE)
    // an unrelated identity record, then corrupt it
    const other = store.createRevision(base, 'identity', { recordId: 'some-other-identity', selectors: { tags: [], links: [] }, provenance: { source: 's', author: 'a', evidence: [] }, payload: { v: 1 }, createdAtLabel: 'L' })
    fs.writeFileSync(path.join(base, 'identity', 'records', 'some-other-identity', `${other.revisionId}.json`), 'garbage', 'utf8')
    assert.equal(verifyIdentityShadow(base, FAKE).status, REASON.PASS) // xiangxiang-identity still verifies
  } finally { cleanup(base) }
})

test('CLI exit codes against the REAL persona constant: PASS->0, mismatch->2, config-missing->3', () => {
  const cli = require('../../../../scripts/memory/verifyIdentityShadow')
  const { PERSONA_IDENTITY } = require('../../../../src/persona/xiangxiang')
  const { MARKER } = require('../../../../src/core/memory/shadow/identityShadow')
  const savedDir = process.env.AROMA_CORE_DIR
  const passBase = tmpBase()
  const mismatchBase = tmpBase()
  try {
    // config missing -> 3
    delete process.env.AROMA_CORE_DIR
    assert.equal(cli.main(), 3)

    // PASS -> 0 : seed the real Identity prefix
    seedIdentity(passBase, { personaIdentity: PERSONA_IDENTITY, ...SEED_OPTS })
    process.env.AROMA_CORE_DIR = passBase
    assert.equal(cli.main(), 0)

    // mismatch -> 2 : seed a drifted persona (extra char before the marker), verify vs real
    const drifted = PERSONA_IDENTITY.replace(MARKER, 'X' + MARKER) // still exactly one marker
    seedIdentity(mismatchBase, { personaIdentity: drifted, ...SEED_OPTS })
    process.env.AROMA_CORE_DIR = mismatchBase
    assert.equal(cli.main(), 2)
  } finally {
    if (savedDir === undefined) delete process.env.AROMA_CORE_DIR; else process.env.AROMA_CORE_DIR = savedDir
    cleanup(passBase); cleanup(mismatchBase)
  }
})
