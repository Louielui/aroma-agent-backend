'use strict'

/**
 * personaClosure.test.js — GO-1 acceptance tests for the Persona Closure
 * builder + verifier. Hermetic: seeds a byte-identical persona triple into a
 * throwaway temp core-dir (reusing test/core/memory/_helpers), builds/verifies,
 * and asserts fail-closed behaviour. No artifact is written; core-data is never
 * touched (these tests only touch os.tmpdir()).
 *
 *   Run: node --test src/persona/personaClosure.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { tmpBase, cleanup, createRev, activateIdentityLike } = require('../../test/core/memory/_helpers')
const store = require('../core/memory/store')
const op = require('../core/memory/shadow/operatingPrinciplesShadow')
const ps = require('../core/memory/shadow/personalityShadow')
const { PERSONA_IDENTITY: P } = require('./xiangxiang')
const { buildPersonaClosure, verifyPersonaClosure, computeStoreIdentityHash } = require('./personaClosure')
const { resolveReleaseRef, resolveSupersede, computeWritePath, main: cliMain } = require('../../scripts/persona/buildPersonaClosure')

const HEX40 = '1234567890abcdef1234567890abcdef12345678'
const FIXED = { generatedAt: '2026-01-01T00:00:00.000Z', generatorCommit: 'testcommit0000000000000000000000000000000' }
const GOOD_REF = { releaseCommit: HEX40, installAuthorization: 'a6-install-authorized-xxxxxxx', relationship: 'REFERENCE_ONLY' }
const CLEAN_PROV = { workingTreeClean: true, builderInCommit: true, builderPath: 'scripts/persona/buildPersonaClosure.js', builderSha256: 'a'.repeat(64), verifierPath: 'scripts/persona/verifyPersonaClosure.js', verifierSha256: 'b'.repeat(64) }

function seedActive (base, s, recordId, payload) {
  const rev = createRev(base, s, recordId, { payload })
  activateIdentityLike(base, s, recordId, rev.revisionId)
  return rev
}
// A full byte-identical READY triple (same recipe personaSourceIntegration.test.js proves READY).
function seedTriple (base) {
  seedActive(base, 'identity', 'xiangxiang-identity', { format: 'verbatim', section: 'identity', text: P.slice(0, 807) })
  seedActive(base, op.OP_STORE, op.OP_RECORD_ID, op.buildOperatingPrinciplesPayload(P))
  seedActive(base, ps.PERSONALITY_STORE, ps.PERSONALITY_RECORD_ID, ps.buildPersonalityPayload(P))
}
// Overwrite one artifact JSON's hash field on disk to simulate tamper/corruption.
function tamperFirstJson (base, s, sub, recordId, field) {
  const dir = path.join(store.storeDir(base, s), sub, recordId)
  const file = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))[0]
  const p = path.join(dir, file)
  const j = JSON.parse(fs.readFileSync(p, 'utf8'))
  j[field] = 'deadbeef' + String(j[field] || '').slice(8)
  fs.writeFileSync(p, JSON.stringify(j))
}

// 1
test('valid three-domain closure -> VERIFIED, productionPersonaMode NOT_VERIFIED', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    const { gen, closure } = buildPersonaClosure({ coreDir: base, ...FIXED })
    assert.equal(closure.overallResult, 'VERIFIED')
    assert.equal(closure.productionPersonaMode, 'NOT_VERIFIED')
    assert.equal(closure.hybrid.byteIdentical, true)
    assert.equal(Object.keys(closure.domains).length, 3)
    for (const k of ['identity', 'operatingPrinciples', 'personality']) assert.equal(closure.domains[k].lifecycleState, 'ACTIVE')
    assert.ok(typeof closure.closurePayloadHash === 'string' && closure.closurePayloadHash.length === 64)
    assert.equal(closure.closureId, gen)
  } finally { cleanup(base) }
})

// 2
test('inactive/mismatched revision -> rejected, no file', () => {
  const base = tmpBase()
  try {
    // identity submitted but NOT activated -> not ACTIVE
    const rev = createRev(base, 'identity', 'xiangxiang-identity', { payload: { format: 'verbatim', section: 'identity', text: P.slice(0, 807) } })
    store.recordEvent(base, 'identity', { recordId: 'xiangxiang-identity', targetRevisionId: rev.revisionId, eventType: 'SUBMITTED_FOR_REVIEW', actor: 'x', approval: null, rationale: 'r', expectedPreviousState: 'new', timestampLabel: 'L' })
    seedActive(base, op.OP_STORE, op.OP_RECORD_ID, op.buildOperatingPrinciplesPayload(P))
    seedActive(base, ps.PERSONALITY_STORE, ps.PERSONALITY_RECORD_ID, ps.buildPersonalityPayload(P))
    assert.throws(() => buildPersonaClosure({ coreDir: base, ...FIXED }), (e) => e.code === 'DOMAIN_NOT_ACTIVE')
  } finally { cleanup(base) }
})

// 3 — a tampered event makes the build FAIL CLOSED (rejected). Because the store's
//     resolveActiveRecord pre-filters hash-invalid events, the active revision loses
//     its ACTIVATED event and the domain resolves non-ACTIVE; either that gate
//     (DOMAIN_NOT_ACTIVE/NO_ACTIVATED_EVENT) or the explicit verifyEvent
//     (EVENT_VERIFY_FAILED) rejects it. No closure is produced.
const EVENT_REJECT = ['EVENT_VERIFY_FAILED', 'DOMAIN_NOT_ACTIVE', 'NO_ACTIVATED_EVENT', 'ACTIVATED_MISMATCH']
test('invalid event (tampered eventHash) -> rejected (fail-closed)', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    tamperFirstJson(base, 'identity', 'events', 'xiangxiang-identity', 'eventHash')
    assert.throws(() => buildPersonaClosure({ coreDir: base, ...FIXED }), (e) => e && EVENT_REJECT.includes(e.code))
  } finally { cleanup(base) }
})

// 4 — a tampered revision contentHash makes the build FAIL CLOSED (rejected): the
//     resolver drops the hash-invalid revision (DOMAIN_NOT_ACTIVE) or the explicit
//     verifyRevision rejects it (REVISION_VERIFY_FAILED). No closure is produced.
const REV_REJECT = ['REVISION_VERIFY_FAILED', 'DOMAIN_NOT_ACTIVE', 'DOMAIN_REVISION_MISSING']
test('content-hash mismatch (tampered revision) -> rejected (fail-closed)', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    tamperFirstJson(base, 'personality', 'records', ps.PERSONALITY_RECORD_ID, 'contentHash')
    assert.throws(() => buildPersonaClosure({ coreDir: base, ...FIXED }), (e) => e && REV_REJECT.includes(e.code))
  } finally { cleanup(base) }
})

// 5
test('missing evidence (store absent) -> rejected with explicit reason', () => {
  const base = tmpBase()
  try {
    seedActive(base, 'identity', 'xiangxiang-identity', { format: 'verbatim', section: 'identity', text: P.slice(0, 807) })
    seedActive(base, op.OP_STORE, op.OP_RECORD_ID, op.buildOperatingPrinciplesPayload(P))
    // personality store never seeded
    assert.throws(() => buildPersonaClosure({ coreDir: base, ...FIXED }), (e) => e.code === 'DOMAIN_NOT_ACTIVE' && /personality/.test(e.detail))
  } finally { cleanup(base) }
})

// 6
test('deterministic output — same seed + same generatedAt -> identical hash and gen', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    const a = buildPersonaClosure({ coreDir: base, ...FIXED })
    const b = buildPersonaClosure({ coreDir: base, ...FIXED })
    assert.equal(a.gen, b.gen)
    assert.equal(a.closure.closurePayloadHash, b.closure.closurePayloadHash)
  } finally { cleanup(base) }
})

// 7
test('no persona text leakage — serialized closure contains no persona payload text', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    const { closure } = buildPersonaClosure({ coreDir: base, ...FIXED })
    const serialized = JSON.stringify(closure)
    assert.ok(!serialized.includes(P.slice(0, 40)), 'must not contain identity/persona prose')
    assert.ok(!serialized.includes(P.slice(200, 240)), 'must not contain persona prose (mid)')
  } finally { cleanup(base) }
})

// 8
test('no Memory mutation — storeIdentityHash identical before/after a build', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    const before = computeStoreIdentityHash(base)
    buildPersonaClosure({ coreDir: base, ...FIXED })
    const after = computeStoreIdentityHash(base)
    assert.equal(before, after)
  } finally { cleanup(base) }
})

// 9
test('no write handle — build succeeds with all fs write ops disabled (hermetic no-write proof)', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    const realFs = require('fs')
    const writeMethods = ['writeFileSync', 'renameSync', 'appendFileSync', 'writeSync', 'mkdirSync', 'rmSync', 'unlinkSync', 'truncateSync', 'ftruncateSync']
    const saved = {}
    for (const m of writeMethods) { saved[m] = realFs[m]; realFs[m] = () => { throw new Error('WRITE_FORBIDDEN:' + m) } }
    try {
      const { closure } = buildPersonaClosure({ coreDir: base, ...FIXED })
      assert.equal(closure.overallResult, 'VERIFIED') // built with zero writes
    } finally { for (const m of writeMethods) realFs[m] = saved[m] }
  } finally { cleanup(base) }
})

// 10
test('verifier round-trip — PASS on good closure; FAIL on any single mutated field', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    const { closure } = buildPersonaClosure({ coreDir: base, ...FIXED })
    assert.equal(verifyPersonaClosure(closure, { coreDir: base }).ok, true)

    // mutate a content field -> payload-hash recompute mismatch -> FAIL
    const m1 = JSON.parse(JSON.stringify(closure)); m1.domains.identity.contentHash = 'deadbeef'
    assert.equal(verifyPersonaClosure(m1, { coreDir: base }).ok, false)

    // mutate the stored payload hash itself -> FAIL
    const m2 = JSON.parse(JSON.stringify(closure)); m2.closurePayloadHash = 'f'.repeat(64)
    assert.equal(verifyPersonaClosure(m2, { coreDir: base }).ok, false)

    // mutate the active revision id -> native re-read drift -> FAIL
    const m3 = JSON.parse(JSON.stringify(closure)); m3.domains.personality.activeRevisionId = '00000000-0000-0000-0000-000000000000'
    assert.equal(verifyPersonaClosure(m3, { coreDir: base }).ok, false)
  } finally { cleanup(base) }
})

// ── Case B Step 1: release-ref flags, provenance, supersedes ──────────────────
// 11 three flags valid structured input (CLI combinatorial)
test('resolveReleaseRef: all three flags present + valid -> structured value', () => {
  const r = resolveReleaseRef(['--release-commit', HEX40, '--install-auth', 'x', '--release-relationship', 'REFERENCE_ONLY'])
  assert.equal(r.ok, true)
  assert.deepEqual(r.value, { releaseCommit: HEX40, installAuthorization: 'x', relationship: 'REFERENCE_ONLY' })
})
// 12 all absent -> null allowed
test('resolveReleaseRef: no flags -> null', () => {
  const r = resolveReleaseRef([])
  assert.equal(r.ok, true); assert.equal(r.value, null)
})
// 13 partial -> rejected
test('resolveReleaseRef: partial flags -> RELEASE_REF_PARTIAL', () => {
  assert.equal(resolveReleaseRef(['--release-commit', HEX40]).error, 'RELEASE_REF_PARTIAL')
  assert.equal(resolveReleaseRef(['--release-commit', HEX40, '--install-auth', 'x']).error, 'RELEASE_REF_PARTIAL')
})
// 14 invalid/short commit -> rejected (builder value validation)
test('builder: short/invalid release commit -> RELEASE_COMMIT_INVALID', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    assert.throws(() => buildPersonaClosure({ coreDir: base, ...FIXED, productionReleaseReference: { ...GOOD_REF, releaseCommit: 'abc123' } }), (e) => e.code === 'RELEASE_COMMIT_INVALID')
  } finally { cleanup(base) }
})
// 15 relationship != REFERENCE_ONLY -> rejected
test('builder: relationship != REFERENCE_ONLY -> RELATIONSHIP_INVALID', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    assert.throws(() => buildPersonaClosure({ coreDir: base, ...FIXED, productionReleaseReference: { ...GOOD_REF, relationship: 'SUPERSEDES' } }), (e) => e.code === 'RELATIONSHIP_INVALID')
  } finally { cleanup(base) }
})
// 16 valid productionReleaseReference recorded
test('builder: valid productionReleaseReference recorded (REFERENCE_ONLY)', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    const { closure } = buildPersonaClosure({ coreDir: base, ...FIXED, productionReleaseReference: GOOD_REF })
    assert.deepEqual(closure.productionReleaseReference, GOOD_REF)
    assert.equal(closure.productionPersonaMode, 'NOT_VERIFIED') // relationship does not change mode
  } finally { cleanup(base) }
})
// 17 real generation with clean tree + builder-in-commit + 40hex -> COMPLETE, no throw
test('builder: real + clean + builderInCommit + 40hex -> generatorProvenance COMPLETE', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    const { closure } = buildPersonaClosure({ coreDir: base, generatedAt: FIXED.generatedAt, generatorCommit: HEX40, mode: 'real', provenance: CLEAN_PROV })
    assert.equal(closure.generatorProvenance, 'COMPLETE')
    assert.equal(closure.generator.builderSha256, CLEAN_PROV.builderSha256)
    assert.equal(closure.generator.verifierSha256, CLEAN_PROV.verifierSha256)
  } finally { cleanup(base) }
})
// 18 dirty-tree real generation -> rejected
test('builder: real + dirty tree -> PROVENANCE_INCOMPLETE', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    assert.throws(() => buildPersonaClosure({ coreDir: base, generatedAt: FIXED.generatedAt, generatorCommit: HEX40, mode: 'real', provenance: { ...CLEAN_PROV, workingTreeClean: false } }), (e) => e.code === 'PROVENANCE_INCOMPLETE')
  } finally { cleanup(base) }
})
// 19 source commit not containing builder -> rejected
test('builder: real + builder NOT in commit -> PROVENANCE_INCOMPLETE', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    assert.throws(() => buildPersonaClosure({ coreDir: base, generatedAt: FIXED.generatedAt, generatorCommit: HEX40, mode: 'real', provenance: { ...CLEAN_PROV, builderInCommit: false } }), (e) => e.code === 'PROVENANCE_INCOMPLETE')
  } finally { cleanup(base) }
})
// 20 dry-run stamps generatorProvenance INCOMPLETE (and never requires clean tree)
test('builder: dry-run dirty -> generatorProvenance INCOMPLETE (no throw)', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    const { closure } = buildPersonaClosure({ coreDir: base, generatedAt: FIXED.generatedAt, generatorCommit: HEX40, mode: 'dry-run', provenance: { ...CLEAN_PROV, workingTreeClean: false } })
    assert.equal(closure.generatorProvenance, 'INCOMPLETE')
  } finally { cleanup(base) }
})
// 21 supersedes valid (prior exists + hash matches) -> recorded; prior file NOT modified
test('builder: supersedes valid path+hash -> recorded; prior artifact unchanged', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    const priorPath = path.join(base, 'prior-PERSONA-CLOSURE.json') // stand-in prior artifact (in temp)
    const prior = { closurePayloadHash: 'c'.repeat(64), note: 'prior' }
    fs.writeFileSync(priorPath, JSON.stringify(prior))
    const before = fs.readFileSync(priorPath)
    const sup = { closurePath: priorPath, closurePayloadHash: 'c'.repeat(64), reason: 'GENERATOR_PROVENANCE_INCOMPLETE' }
    const { closure } = buildPersonaClosure({ coreDir: base, ...FIXED, supersedes: sup })
    assert.deepEqual(closure.supersedes, sup)
    assert.ok(Buffer.compare(before, fs.readFileSync(priorPath)) === 0, 'prior artifact byte-identical (read-only)')
  } finally { cleanup(base) }
})
// 22 supersedes wrong hash -> rejected
test('builder: supersedes wrong hash -> SUPERSEDES_PRIOR_MISMATCH', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    const priorPath = path.join(base, 'prior2.json')
    fs.writeFileSync(priorPath, JSON.stringify({ closurePayloadHash: 'c'.repeat(64) }))
    assert.throws(() => buildPersonaClosure({ coreDir: base, ...FIXED, supersedes: { closurePath: priorPath, closurePayloadHash: 'd'.repeat(64), reason: 'GENERATOR_PROVENANCE_INCOMPLETE' } }), (e) => e.code === 'SUPERSEDES_PRIOR_MISMATCH')
  } finally { cleanup(base) }
})
// 23 supersedes wrong reason -> rejected
test('builder: supersedes wrong reason -> SUPERSEDES_REASON_INVALID', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    const priorPath = path.join(base, 'prior3.json')
    fs.writeFileSync(priorPath, JSON.stringify({ closurePayloadHash: 'c'.repeat(64) }))
    assert.throws(() => buildPersonaClosure({ coreDir: base, ...FIXED, supersedes: { closurePath: priorPath, closurePayloadHash: 'c'.repeat(64), reason: 'BECAUSE' } }), (e) => e.code === 'SUPERSEDES_REASON_INVALID')
  } finally { cleanup(base) }
})
// 24 resolveSupersede partial -> rejected
test('resolveSupersede: partial -> SUPERSEDE_PARTIAL; none -> null; both -> value', () => {
  assert.equal(resolveSupersede(['--supersede-path', 'x']).error, 'SUPERSEDE_PARTIAL')
  assert.equal(resolveSupersede([]).value, null)
  const r = resolveSupersede(['--supersede-path', 'x.json', '--supersede-hash', 'e'.repeat(64)])
  assert.equal(r.ok, true); assert.equal(r.value.reason, 'GENERATOR_PROVENANCE_INCOMPLETE')
})
// 25 computeWritePath: base vs supersede (non-overwritable, unique)
test('computeWritePath: base for first; unique supersede path under <gen>/supersedes', () => {
  const gen = 'ec5ebf6d-281dc25a-fe6d54be'
  assert.equal(computeWritePath('/out', gen, null, HEX40, '2026-01-01T00:00:00Z'), path.join('/out', gen))
  const sp = computeWritePath('/out', gen, { closurePayloadHash: 'x' }, HEX40, '2026-07-19T20:09:33.123Z')
  assert.ok(sp.includes(path.join(gen, 'supersedes')))
  assert.ok(sp.endsWith('1234567890ab-20260719200933'), 'discriminator = generatorCommit12 + compact timestamp: ' + sp)
})
// 26 CLI dry-run writes NO file (fs writes disabled -> main still returns 0)
test('CLI dry-run writes no file (all fs writes disabled)', () => {
  const base = tmpBase()
  try {
    seedTriple(base)
    const realFs = require('fs')
    const savedEnv = process.env.AROMA_CORE_DIR; process.env.AROMA_CORE_DIR = base
    const savedLog = console.log; const savedErr = console.error; console.log = () => {}; console.error = () => {}
    const writeMethods = ['writeFileSync', 'renameSync', 'appendFileSync', 'mkdirSync']
    const saved = {}; for (const m of writeMethods) { saved[m] = realFs[m]; realFs[m] = () => { throw new Error('WRITE_FORBIDDEN:' + m) } }
    try {
      const rc = cliMain(['--dry-run'])
      assert.equal(rc, 0, 'dry-run returns 0 with zero writes')
    } finally {
      for (const m of writeMethods) realFs[m] = saved[m]
      console.log = savedLog; console.error = savedErr
      if (savedEnv === undefined) delete process.env.AROMA_CORE_DIR; else process.env.AROMA_CORE_DIR = savedEnv
    }
  } finally { cleanup(base) }
})
