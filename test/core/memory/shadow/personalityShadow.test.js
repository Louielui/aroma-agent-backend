'use strict'

/**
 * personalityShadow.test.js — M3c-1.
 *
 * Isolated tests for the active-only Personality Shadow verifier + pure payload
 * builder. Fixtures are built with generic M1 primitives in temp dirs. No
 * production AROMA_CORE_DIR, no writes outside temp dirs. Verifies the single
 * seq-2 personality fragment and rejects any operating-principles contamination.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const PS = require('../../../../src/core/memory/shadow/personalityShadow')
const opShadow = require('../../../../src/core/memory/shadow/operatingPrinciplesShadow')
const B = require('../../../../src/core/memory/shadow/behavioralMapping')
const store = require('../../../../src/core/memory/store')
const { PERSONA_IDENTITY, buildPersonaSystem } = require('../../../../src/persona/xiangxiang')
const { tmpBase, cleanup, createRev, ev } = require('../_helpers')

const R = PS.REASON
const RID = PS.PERSONALITY_RECORD_ID
const PS_STORE = PS.PERSONALITY_STORE
const P = PERSONA_IDENTITY
const goodPayload = () => PS.buildPersonalityPayload(P)
const clonePayload = (p) => JSON.parse(JSON.stringify(p))

// Seed a personality revision with the given payload and drive to ACTIVE.
function seedActive (base, payload, opts = {}) {
  const rev = createRev(base, PS_STORE, RID, { revisionId: opts.revisionId, payload })
  ev(base, PS_STORE, RID, rev.revisionId, 'SUBMITTED_FOR_REVIEW', 'new')
  ev(base, PS_STORE, RID, rev.revisionId, 'APPROVED', 'review_ready', { approval: { approvedBy: 'Louie', decision: 'approved' } })
  if (!opts.stopAt || opts.stopAt === 'active') ev(base, PS_STORE, RID, rev.revisionId, 'ACTIVATED', 'approved')
  return rev
}
function seedReviewReady (base, payload) {
  const rev = createRev(base, PS_STORE, RID, { payload: payload || goodPayload() })
  ev(base, PS_STORE, RID, rev.revisionId, 'SUBMITTED_FOR_REVIEW', 'new')
  return rev
}
function verify (base) { return PS.verifyPersonalityShadow(base, P) }

// --- builder + aggregate ----------------------------------------------------
test('builder produces a closed single-fragment payload (seq 2, [886,952), no OP)', () => {
  const p = goodPayload()
  assert.equal(p.format, 'ordered-fragments')
  assert.equal(p.schemaVersion, 'personality-shadow/v1')
  assert.equal(p.section, 'personality')
  assert.equal(p.classificationApprovalRef, 'OWNER-M3-BEHAVIORAL-CLASSIFICATION-2026-07-16')
  assert.equal(p.fragmentCount, 1)
  assert.equal(p.fragments.length, 1)
  const f = p.fragments[0]
  assert.equal(f.sourceSequence, 2)
  assert.equal(f.domainOrder, 1)
  assert.equal(f.sourceStartCodeUnit, 886)
  assert.equal(f.sourceEndCodeUnit, 952)
  assert.equal(f.sourceSha256Utf8, '03a3b8625081ce859d49a80e59ed60bfe61da16e037bd01bdab3f86bd06468a5')
  assert.equal(f.fragmentClassificationRef, 'item-2-expression-style-tone')
  assert.equal(f.text, P.slice(886, 952))
  assert.equal(p.sourceCommit, 'e90cb5bbf73203053b1f67c4a6d1468db67edbff')
  assert.equal(Object.keys(p).sort().join(','), PS.ROOT_KEYS.join(','))
  assert.equal(Object.keys(f).sort().join(','), PS.FRAG_KEYS.join(','))
  for (const seq of [1, 3, 4, 5, 6, 7, 8, 9]) assert.equal(p.fragments.some((x) => x.sourceSequence === seq), false)
})

test('builder writes nothing; aggregate is canonical + tamper-sensitive', () => {
  const before = fs.readdirSync(process.cwd()).length
  const p = goodPayload()
  assert.equal(fs.readdirSync(process.cwd()).length, before)
  assert.equal(PS.computeAggregateSha256(p), p.aggregateSha256)
  const mut = clonePayload(p); mut.fragments[0].text += 'x'
  assert.notEqual(PS.computeAggregateSha256(mut), p.aggregateSha256)
})

// --- 6. PASS ----------------------------------------------------------------
test('exact active Personality -> PASS / exit 0', () => {
  const base = tmpBase()
  try {
    const rev = seedActive(base, goodPayload())
    const r = verify(base)
    assert.equal(r.status, R.PASS)
    assert.equal(PS.exitCodeFor(r.status), 0)
    assert.equal(r.activeRevisionId, rev.revisionId)
    assert.equal(r.fragmentCount, 1)
    assert.equal(r.reconstituteOk, true)
  } finally { cleanup(base) }
})

// --- 1-5. NOT_READY / exit 4 ------------------------------------------------
test('store absent -> NOT_READY / STORE_ABSENT / exit 4', () => {
  const base = tmpBase()
  try { const r = verify(base); assert.equal(r.status, R.NO_ACTIVE_PERSONALITY); assert.equal(r.subReason, 'STORE_ABSENT'); assert.equal(PS.exitCodeFor(r.status), 4) } finally { cleanup(base) }
})
test('record absent -> NOT_READY / RECORD_ABSENT', () => {
  const base = tmpBase()
  try { createRev(base, PS_STORE, 'other-record', { payload: { v: 1 } }); const r = verify(base); assert.equal(r.subReason, 'RECORD_ABSENT'); assert.equal(PS.exitCodeFor(r.status), 4) } finally { cleanup(base) }
})
test('zero revision -> NOT_READY / (record dir empty)', () => {
  const base = tmpBase()
  try {
    fs.mkdirSync(path.join(base, PS_STORE, 'records', RID), { recursive: true })
    const r = verify(base); assert.equal(r.status, R.NO_ACTIVE_PERSONALITY); assert.equal(PS.exitCodeFor(r.status), 4)
  } finally { cleanup(base) }
})
test('review_ready -> NOT_READY / NO_ACTIVE_REVISION (active-only; never PASS)', () => {
  const base = tmpBase()
  try { seedReviewReady(base); const r = verify(base); assert.equal(r.status, R.NO_ACTIVE_PERSONALITY); assert.equal(r.subReason, 'NO_ACTIVE_REVISION'); assert.equal(PS.exitCodeFor(r.status), 4) } finally { cleanup(base) }
})
test('approved-not-active -> NOT_READY / APPROVED_NOT_ACTIVE (never PASS)', () => {
  const base = tmpBase()
  try { seedActive(base, goodPayload(), { stopAt: 'approved' }); const r = verify(base); assert.equal(r.status, R.NO_ACTIVE_PERSONALITY); assert.equal(r.subReason, 'APPROVED_NOT_ACTIVE'); assert.equal(PS.exitCodeFor(r.status), 4) } finally { cleanup(base) }
})

// --- 7-9. corruption / ambiguity --------------------------------------------
test('ambiguous active -> FAIL / exit 2', () => {
  const base = tmpBase()
  try {
    createRev(base, PS_STORE, RID, { revisionId: 'a', payload: goodPayload() }); ev(base, PS_STORE, RID, 'a', 'SUBMITTED_FOR_REVIEW', 'new'); ev(base, PS_STORE, RID, 'a', 'APPROVED', 'review_ready', { approval: { approvedBy: 'l', decision: 'approved' } }); ev(base, PS_STORE, RID, 'a', 'ACTIVATED', 'approved')
    createRev(base, PS_STORE, RID, { revisionId: 'b', supersedes: 'a', payload: goodPayload() }); ev(base, PS_STORE, RID, 'b', 'SUBMITTED_FOR_REVIEW', 'new'); ev(base, PS_STORE, RID, 'b', 'APPROVED', 'review_ready', { approval: { approvedBy: 'l', decision: 'approved' } }); ev(base, PS_STORE, RID, 'b', 'ACTIVATED', 'approved')
    assert.equal(verify(base).status, R.AMBIGUOUS_ACTIVE_PERSONALITY)
  } finally { cleanup(base) }
})
test('corrupt active revision -> STORE_CORRUPT', () => {
  const base = tmpBase()
  try {
    seedActive(base, goodPayload())
    const dir = path.join(base, PS_STORE, 'records', RID); const f = fs.readdirSync(dir).find((n) => n.endsWith('.json'))
    fs.writeFileSync(path.join(dir, f), '{ broken')
    assert.equal(verify(base).status, R.PERSONALITY_STORE_CORRUPT)
  } finally { cleanup(base) }
})
test('corrupt event -> STORE_CORRUPT', () => {
  const base = tmpBase()
  try {
    seedActive(base, goodPayload())
    const dir = path.join(base, PS_STORE, 'events', RID); const f = fs.readdirSync(dir).find((n) => n.endsWith('.json'))
    fs.writeFileSync(path.join(dir, f), '{ broken')
    assert.equal(verify(base).status, R.PERSONALITY_STORE_CORRUPT)
  } finally { cleanup(base) }
})

// --- 10-13. schema / provenance / authority / recordId ----------------------
function seedMutated (base, mutate) { const p = clonePayload(goodPayload()); mutate(p); return seedActive(base, p) }

test('schema extra root key -> PAYLOAD_SCHEMA_INVALID', () => {
  const base = tmpBase(); try { seedMutated(base, (p) => { p.extra = 1 }); const r = verify(base); assert.equal(r.status, R.PERSONALITY_PAYLOAD_SCHEMA_INVALID); assert.equal(r.detail, 'root-keys') } finally { cleanup(base) }
})
test('schema missing fragment key -> PAYLOAD_SCHEMA_INVALID', () => {
  const base = tmpBase(); try { seedMutated(base, (p) => { delete p.fragments[0].text }); assert.equal(verify(base).status, R.PERSONALITY_PAYLOAD_SCHEMA_INVALID) } finally { cleanup(base) }
})
test('wrong root provenance (sourceCommit) -> FRAGMENT_MISMATCH', () => {
  const base = tmpBase(); try { seedMutated(base, (p) => { p.sourceCommit = '0'.repeat(40); p.aggregateSha256 = PS.computeAggregateSha256(p) }); const r = verify(base); assert.equal(r.status, R.PERSONALITY_FRAGMENT_MISMATCH); assert.equal(r.detail, 'record-sourceCommit') } finally { cleanup(base) }
})
test('wrong M1 authorityDomain (not behavior) -> REVISION_CORRUPT', () => {
  const base = tmpBase()
  try {
    const rev = seedActive(base, goodPayload())
    // tamper the stored revision authorityDomain and re-hash so envelope verify passes
    const fp = path.join(base, PS_STORE, 'records', RID, rev.revisionId + '.json')
    const obj = JSON.parse(fs.readFileSync(fp, 'utf8'))
    obj.authorityDomain = 'identity'
    const { hashOf } = require('../../../../src/core/memory/canonical')
    delete obj.contentHash; obj.contentHash = hashOf(obj, 'contentHash')
    fs.writeFileSync(fp, JSON.stringify(obj))
    const r = verify(base)
    assert.equal(r.status, R.PERSONALITY_REVISION_CORRUPT); assert.equal(r.detail, 'authority-domain')
  } finally { cleanup(base) }
})
test('wrong recordId store is simply absent for xiangxiang-personality -> NOT_READY', () => {
  const base = tmpBase()
  try {
    // seed under a DIFFERENT record id; the personality record itself is absent
    const rev = createRev(base, PS_STORE, 'xiangxiang-wrong', { payload: goodPayload() })
    ev(base, PS_STORE, 'xiangxiang-wrong', rev.revisionId, 'SUBMITTED_FOR_REVIEW', 'new')
    const r = verify(base)
    assert.equal(r.status, R.NO_ACTIVE_PERSONALITY); assert.equal(r.subReason, 'RECORD_ABSENT')
  } finally { cleanup(base) }
})

// --- 14-16. contamination ---------------------------------------------------
test('OP sequence contamination -> OPERATING_PRINCIPLES_DOMAIN_CONTAMINATION', () => {
  const base = tmpBase()
  try {
    seedMutated(base, (p) => {
      const f = p.fragments[0]
      f.sourceSequence = 4; f.sourceStartCodeUnit = 1008; f.sourceEndCodeUnit = 1080; f.text = P.slice(1008, 1080)
      f.sourceSha256Utf8 = B.sha256Utf8(f.text); p.aggregateSha256 = PS.computeAggregateSha256(p)
    })
    assert.equal(verify(base).status, R.OPERATING_PRINCIPLES_DOMAIN_CONTAMINATION)
  } finally { cleanup(base) }
})
test('OP range overlap (seq kept 2 but range into an OP window) -> OPERATING_PRINCIPLES_DOMAIN_CONTAMINATION', () => {
  const base = tmpBase()
  try {
    seedMutated(base, (p) => {
      const f = p.fragments[0]
      f.sourceStartCodeUnit = 900; f.sourceEndCodeUnit = 1010; f.text = P.slice(900, 1010) // overlaps OP [952,1008)
      f.sourceSha256Utf8 = B.sha256Utf8(f.text); p.aggregateSha256 = PS.computeAggregateSha256(p)
    })
    assert.equal(verify(base).status, R.OPERATING_PRINCIPLES_DOMAIN_CONTAMINATION)
  } finally { cleanup(base) }
})
test('non-behavioral range (into Identity prefix) -> NON_BEHAVIORAL_DOMAIN_CONTAMINATION', () => {
  const base = tmpBase()
  try {
    seedMutated(base, (p) => {
      const f = p.fragments[0]
      f.sourceStartCodeUnit = 10; f.sourceEndCodeUnit = 60; f.text = P.slice(10, 60)
      f.sourceSha256Utf8 = B.sha256Utf8(f.text); p.aggregateSha256 = PS.computeAggregateSha256(p)
    })
    assert.equal(verify(base).status, R.NON_BEHAVIORAL_DOMAIN_CONTAMINATION)
  } finally { cleanup(base) }
})

// --- 17-23. fragment / aggregate / reconstitution ---------------------------
test('fragmentCount !== 1 -> PAYLOAD_SCHEMA_INVALID (fail closed)', () => {
  const base = tmpBase()
  try {
    seedMutated(base, (p) => { p.fragments.push(clonePayload(p.fragments[0])); p.fragmentCount = 2; p.aggregateSha256 = PS.computeAggregateSha256(p) })
    assert.equal(verify(base).status, R.PERSONALITY_PAYLOAD_SCHEMA_INVALID)
  } finally { cleanup(base) }
})
test('wrong range (in-section, non-OP) -> FRAGMENT_MISMATCH', () => {
  const base = tmpBase()
  try {
    // shift start earlier into OP seq-1 window would be OP contamination; instead widen END by 0 is same.
    // Use a range still starting at 886 but ending short (still within [807,886)+? no) -> pick [886,951): non-OP, in-section, != mapping.
    seedMutated(base, (p) => {
      const f = p.fragments[0]; f.sourceEndCodeUnit = 951; f.text = P.slice(886, 951); f.sourceSha256Utf8 = B.sha256Utf8(f.text); p.aggregateSha256 = PS.computeAggregateSha256(p)
    })
    const r = verify(base)
    assert.equal(r.status, R.PERSONALITY_FRAGMENT_MISMATCH); assert.equal(r.detail, 'range')
  } finally { cleanup(base) }
})
test('wrong source hash -> FRAGMENT_MISMATCH', () => {
  const base = tmpBase(); try { seedMutated(base, (p) => { p.fragments[0].sourceSha256Utf8 = '0'.repeat(64); p.aggregateSha256 = PS.computeAggregateSha256(p) }); const r = verify(base); assert.equal(r.status, R.PERSONALITY_FRAGMENT_MISMATCH); assert.equal(r.detail, 'source-hash') } finally { cleanup(base) }
})
test('wrong classificationRef -> FRAGMENT_MISMATCH', () => {
  const base = tmpBase(); try { seedMutated(base, (p) => { p.fragments[0].fragmentClassificationRef = 'wrong'; p.aggregateSha256 = PS.computeAggregateSha256(p) }); const r = verify(base); assert.equal(r.status, R.PERSONALITY_FRAGMENT_MISMATCH); assert.equal(r.detail, 'classification') } finally { cleanup(base) }
})
test('wrong text (self-consistent hash, != legacy) -> FRAGMENT_MISMATCH', () => {
  const base = tmpBase()
  try {
    seedMutated(base, (p) => { const w = P.slice(886, 952).split('').reverse().join(''); p.fragments[0].text = w; p.fragments[0].sourceSha256Utf8 = B.sha256Utf8(w); p.aggregateSha256 = PS.computeAggregateSha256(p) })
    assert.equal(verify(base).status, R.PERSONALITY_FRAGMENT_MISMATCH)
  } finally { cleanup(base) }
})
test('aggregate mismatch (fields valid) -> AGGREGATE_HASH_MISMATCH', () => {
  const base = tmpBase(); try { seedMutated(base, (p) => { p.aggregateSha256 = 'a'.repeat(64) }); assert.equal(verify(base).status, R.PERSONALITY_AGGREGATE_HASH_MISMATCH) } finally { cleanup(base) }
})

// --- 24. broken mapping -----------------------------------------------------
test('broken M3a mapping -> MAPPING_CONTRACT_ERROR / exit 3', () => {
  const base = tmpBase()
  try {
    seedActive(base, goodPayload())
    const r = PS.verifyPersonalityShadow(base, P, [{ sequence: 2, authorityDomain: 'personality' }])
    assert.equal(r.status, R.MAPPING_CONTRACT_ERROR); assert.equal(PS.exitCodeFor(r.status), 3)
  } finally { cleanup(base) }
})

// --- 25-26. safe output + zero write ----------------------------------------
test('verifier output never leaks persona / fragment text', () => {
  const base = tmpBase()
  try {
    seedActive(base, goodPayload())
    const s = JSON.stringify(verify(base))
    for (const leak of ['香香', '表達風格', '思考順序', P.slice(886, 952)]) assert.equal(s.includes(leak), false)
  } finally { cleanup(base) }
})
test('verify performs no writes to the store tree', () => {
  const base = tmpBase()
  try {
    seedActive(base, goodPayload())
    const hashTree = (d) => { const out = {}; const walk = (x, rel) => { for (const n of fs.readdirSync(x)) { const p = path.join(x, n), r = rel ? rel + '/' + n : n; if (fs.statSync(p).isDirectory()) walk(p, r); else out[r] = require('crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex') } }; walk(d, ''); return out }
    const before = hashTree(base); verify(base); assert.deepEqual(hashTree(base), before)
  } finally { cleanup(base) }
})

// --- 27-30. regressions -----------------------------------------------------
test('identity + OP verifier modules unaffected (importable, deterministic)', () => {
  const base = tmpBase()
  try {
    // OP verifier still returns NOT_READY for an absent OP store (unchanged behavior)
    const opr = opShadow.verifyOperatingPrinciplesShadow(base, P)
    assert.equal(opr.status, opShadow.REASON.NO_ACTIVE_OPERATING_PRINCIPLES)
  } finally { cleanup(base) }
})
test('buildPersonaSystem byte-identical + runtime zero-reachability (incl. M3c-1)', () => {
  assert.equal(buildPersonaSystem('X'), buildPersonaSystem('X'))
  assert.ok(buildPersonaSystem('X').includes(P))
  const SRC = path.resolve(__dirname, '../../../../src')
  const resolveReq = (d, rel) => { const b = path.resolve(d, rel); for (const c of [b, b + '.js', path.join(b, 'index.js')]) { try { if (fs.statSync(c).isFile()) return c } catch (e) {} } return null }
  const reach = (entry) => { const seen = new Set(); const st = [path.resolve(entry)]; while (st.length) { const f = st.pop(); if (seen.has(f)) continue; seen.add(f); let s; try { s = fs.readFileSync(f, 'utf8') } catch (e) { continue } const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g; let m; while ((m = re.exec(s))) { const t = resolveReq(path.dirname(f), m[1]); if (t) st.push(t) } } return seen }
  for (const e of ['index.js', 'app.js']) assert.deepEqual([...reach(path.join(SRC, e))].filter((f) => /[\\/]core[\\/]memory[\\/]/.test(f)), [])
})
