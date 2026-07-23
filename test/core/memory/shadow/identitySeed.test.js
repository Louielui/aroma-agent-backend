'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const store = require('../../../../src/core/memory/store')
const { seedIdentity, verifyIdentityShadow, REASON, IDENTITY_RECORD_ID, MARKER } = require('../../../../src/core/memory/shadow/identityShadow')
const { tmpBase, cleanup } = require('../_helpers')

const FAKE = 'WHO I AM' + MARKER + 'rest'
const OPTS = { approvalRef: 'gate/2026', rationale: 'M2 migration', sourceCommit: 'a8d230b998bb547578d70e602b318a91493a9595' }

test('seed then verify -> PASS; approval & activation are separate events', () => {
  const base = tmpBase()
  try {
    const r = seedIdentity(base, { personaIdentity: FAKE, ...OPTS })
    assert.equal(r.seeded, true)
    assert.equal(verifyIdentityShadow(base, FAKE).status, REASON.PASS)
    const events = store.listEvents(base, 'identity', IDENTITY_RECORD_ID)
    const types = events.map((e) => e.eventType)
    assert.deepEqual(types, ['SUBMITTED_FOR_REVIEW', 'APPROVED', 'ACTIVATED']) // approval != activation, separate artifacts
  } finally { cleanup(base) }
})

test('approval metadata is fixed (Louie / owner-authorized-migration), not arbitrary', () => {
  const base = tmpBase()
  try {
    seedIdentity(base, { personaIdentity: FAKE, ...OPTS })
    const approved = store.listEvents(base, 'identity', IDENTITY_RECORD_ID).find((e) => e.eventType === 'APPROVED')
    assert.equal(approved.approval.approvedBy, 'Louie')
    assert.equal(approved.approval.approvalSource, 'owner-authorized-migration')
    assert.equal(approved.approval.reviewRef, 'gate/2026')
  } finally { cleanup(base) }
})

test('missing/invalid approval metadata is rejected', () => {
  const base = tmpBase()
  try {
    assert.throws(() => seedIdentity(base, { personaIdentity: FAKE, rationale: 'r', sourceCommit: 'a8d230b998bb547578d70e602b318a91493a9595' }), (e) => e.code === 'VALIDATION_ERROR') // no approvalRef
    assert.throws(() => seedIdentity(base, { personaIdentity: FAKE, approvalRef: 'x', sourceCommit: 'a8d230b998bb547578d70e602b318a91493a9595' }), (e) => e.code === 'VALIDATION_ERROR') // no rationale
    assert.throws(() => seedIdentity(base, { personaIdentity: FAKE, approvalRef: 'x', rationale: 'r', sourceCommit: 'not-a-commit!' }), (e) => e.code === 'VALIDATION_ERROR') // bad source commit
  } finally { cleanup(base) }
})

test('--source-commit requires a FULL 40-char hex SHA (provenance strength)', () => {
  const { looksLikeCommit } = require('../../../../src/core/memory/shadow/identityShadow')
  const full = 'a8d230b998bb547578d70e602b318a91493a9595' // 40
  assert.equal(full.length, 40)
  assert.equal(looksLikeCommit('a8d230b'), false) // 7 abbreviated -> refuse
  assert.equal(looksLikeCommit(full.slice(0, 39)), false) // 39 -> refuse
  assert.equal(looksLikeCommit(full), true) // 40 valid -> accept
  assert.equal(looksLikeCommit(full + 'a'), false) // 41 -> refuse
  assert.equal(looksLikeCommit('g'.repeat(40)), false) // non-hex -> refuse
  assert.equal(looksLikeCommit('A8D230B998BB547578D70E602B318A91493A9595'), true) // uppercase accepted
  // and the seeder enforces it end-to-end
  const base = tmpBase()
  try {
    assert.throws(() => seedIdentity(base, { personaIdentity: FAKE, approvalRef: 'x', rationale: 'r', sourceCommit: 'a8d230b' }), (e) => e.code === 'VALIDATION_ERROR')
  } finally { cleanup(base) }
})

test('duplicate seed is refused while any revision exists', () => {
  const base = tmpBase()
  try {
    seedIdentity(base, { personaIdentity: FAKE, ...OPTS })
    assert.throws(() => seedIdentity(base, { personaIdentity: FAKE, ...OPTS }), (e) => e.code === 'IDENTITY_ALREADY_SEEDED')
  } finally { cleanup(base) }
})

test('partial migration (revision written, not activated): preserved, NOT active, verifier NO_ACTIVE, re-seed refused, no auto-cleanup', () => {
  const base = tmpBase()
  try {
    const { splitIdentity } = require('../../../../src/core/memory/shadow/identityShadow')
    const { frozenIdentityText } = splitIdentity(FAKE)
    // simulate a crash after createRevision (+ SUBMITTED_FOR_REVIEW) but before APPROVED
    const rev = store.createRevision(base, 'identity', { recordId: IDENTITY_RECORD_ID, selectors: { category: 'identity', tags: ['identity'], links: [] }, provenance: { source: 'migrated-from-persona-constant', author: 'Louie', evidence: ['a8d230b998bb547578d70e602b318a91493a9595'] }, payload: { format: 'verbatim', section: 'identity', text: frozenIdentityText }, createdAtLabel: 'L' })
    store.recordEvent(base, 'identity', { recordId: IDENTITY_RECORD_ID, targetRevisionId: rev.revisionId, eventType: 'SUBMITTED_FOR_REVIEW', actor: 'seeder', rationale: 'r', expectedPreviousState: 'new', timestampLabel: 'L' })

    // artifacts preserved
    assert.ok(fs.existsSync(path.join(base, 'identity', 'records', IDENTITY_RECORD_ID, `${rev.revisionId}.json`)))
    // NOT active
    assert.equal(store.resolveActiveRecord(base, 'identity', IDENTITY_RECORD_ID).status, 'NONE')
    // verifier: NO_ACTIVE_IDENTITY (not corrupt, not mismatch)
    assert.equal(verifyIdentityShadow(base, FAKE).status, REASON.NO_ACTIVE_IDENTITY)
    // re-seed refused (a revision already exists) -> no auto-cleanup, no resume in M2
    assert.throws(() => seedIdentity(base, { personaIdentity: FAKE, ...OPTS }), (e) => e.code === 'IDENTITY_ALREADY_SEEDED')
    // artifacts still there
    assert.equal(store.listRevisions(base, 'identity', IDENTITY_RECORD_ID).length, 1)
  } finally { cleanup(base) }
})

test('seed CLI without --confirm is a safe DRY RUN (no writes)', () => {
  const base = tmpBase()
  const cli = require('../../../../scripts/memory/seedIdentityShadow')
  const savedDir = process.env.AROMA_CORE_DIR
  try {
    process.env.AROMA_CORE_DIR = base
    const code = cli.main(['--approval-ref', 'x', '--rationale', 'r', '--source-commit', 'a8d230b998bb547578d70e602b318a91493a9595']) // no --confirm
    assert.equal(code, 0)
    // nothing written
    assert.equal(fs.existsSync(path.join(base, 'identity', 'records', IDENTITY_RECORD_ID)), false)
  } finally {
    if (savedDir === undefined) delete process.env.AROMA_CORE_DIR; else process.env.AROMA_CORE_DIR = savedDir
    cleanup(base)
  }
})
