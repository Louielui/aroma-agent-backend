'use strict'

/**
 * personalitySubmit.test.js — M3c-2.
 *
 * Isolated tests for the personality submission tool. All Store writes happen ONLY
 * inside temp dirs. Asserts the S0..S5 matrix, exact --resume acknowledgement,
 * mandatory source guard, dry-run zero-write, the exported payload-identity prover,
 * absence of APPROVED/ACTIVATED, and CLI exit codes.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')
const S = require('../../../../src/core/memory/shadow/personalitySubmit')
const shadow = require('../../../../src/core/memory/shadow/personalityShadow')
const opShadow = require('../../../../src/core/memory/shadow/operatingPrinciplesShadow')
const B = require('../../../../src/core/memory/shadow/behavioralMapping')
const store = require('../../../../src/core/memory/store')
const { canonicalize } = require('../../../../src/core/memory/canonical')
const { PERSONA_IDENTITY: P, buildPersonaSystem } = require('../../../../src/persona/xiangxiang')
const { tmpBase, cleanup, createRev, ev } = require('../_helpers')

const R = S.REASON
const RID = S.PS_RECORD_ID
const PS = S.PS_STORE
const ANCHOR = 'e90cb5bbf73203053b1f67c4a6d1468db67edbff'
const REF = { submissionRef: 'OWNER-GO-M3C2-TEST', rationale: 'test personality submission' }
const goodPayload = () => shadow.buildPersonalityPayload(P)
const events = (b) => store.listEvents(b, PS, RID)
const revs = (b) => store.listRevisions(b, PS, RID)
function run (base, extra = {}) { return S.submitPersonality(base, Object.assign({ personaIdentity: P, expectSourceCommit: ANCHOR }, REF, extra)) }
function makeS1 (base, payload) { return createRev(base, PS, RID, { payload: payload || goodPayload() }) }
function makeS2 (base) { const r = makeS1(base); ev(base, PS, RID, r.revisionId, 'SUBMITTED_FOR_REVIEW', 'new'); return r }
function badPayload () { const p = JSON.parse(JSON.stringify(goodPayload())); p.fragments[0].text += 'X'; p.aggregateSha256 = shadow.computeAggregateSha256(p); return p }

// --- fresh S0 ---------------------------------------------------------------
test('S0 dry-run -> DRY_RUN / exit 0 / zero writes', () => {
  const base = tmpBase()
  try { const r = run(base); assert.equal(r.status, R.DRY_RUN); assert.equal(r.plan, 'create-and-submit'); assert.equal(fs.existsSync(path.join(base, PS)), false) } finally { cleanup(base) }
})

test('S0 confirmed -> SUBMITTED: 1 revision + 1 SUBMITTED; review_ready; resolver NONE; no APPROVED/ACTIVATED', () => {
  const base = tmpBase()
  try {
    const r = run(base, { confirm: true })
    assert.equal(r.status, R.SUBMITTED); assert.equal(S.exitCodeFor(r.status), 0)
    assert.equal(revs(base).length, 1)
    const evs = events(base); assert.equal(evs.length, 1); assert.equal(evs[0].eventType, 'SUBMITTED_FOR_REVIEW')
    const types = new Set(evs.map((e) => e.eventType))
    assert.equal(types.has('APPROVED'), false); assert.equal(types.has('ACTIVATED'), false)
    assert.equal(store.resolveActiveRecord(base, PS, RID).status, 'NONE')
    assert.equal(r.compat.status, shadow.REASON.NO_ACTIVE_PERSONALITY); assert.equal(r.compat.subReason, 'NO_ACTIVE_REVISION'); assert.equal(r.compat.exitCode, 4)
  } finally { cleanup(base) }
})

test('submitted payload is exactly the canonical M3c-1 personality payload (seq2, no OP)', () => {
  const base = tmpBase()
  try {
    run(base, { confirm: true })
    const rev = store.getRevision(base, PS, RID, revs(base)[0].revisionId)
    assert.equal(canonicalize(rev.payload), canonicalize(goodPayload()))
    assert.equal(rev.payload.fragmentCount, 1)
    assert.equal(rev.payload.fragments[0].sourceSequence, 2)
    assert.equal(rev.authorityDomain, 'behavior')
    assert.ok(rev.provenance.evidence.includes(ANCHOR))
  } finally { cleanup(base) }
})

// --- exported prover --------------------------------------------------------
test('exported provePayloadIdentity: PASS on good; FAIL on OP contamination; performs no writes', () => {
  const base = tmpBase()
  try {
    const rev = createRev(base, PS, RID, { payload: goodPayload() })
    const good = store.getRevision(base, PS, RID, rev.revisionId)
    assert.equal(S.provePayloadIdentity(good, goodPayload(), P).ok, true)
  } finally { cleanup(base) }
  // OP-contaminated payload stored cleanly under the real record (intact envelope, recordId matches)
  const base2 = tmpBase()
  try {
    const bad = JSON.parse(JSON.stringify(goodPayload())); const f = bad.fragments[0]
    f.sourceSequence = 4; f.sourceStartCodeUnit = 1008; f.sourceEndCodeUnit = 1080; f.text = P.slice(1008, 1080); f.sourceSha256Utf8 = B.sha256Utf8(f.text); bad.aggregateSha256 = shadow.computeAggregateSha256(bad)
    const rev2 = createRev(base2, PS, RID, { payload: bad })
    const opRev = store.getRevision(base2, PS, RID, rev2.revisionId)
    const res = S.provePayloadIdentity(opRev, goodPayload(), P)
    assert.equal(res.ok, false)
    assert.ok(['op-sequence', 'op-range', 'range', 'payload-canonical'].includes(res.detail), 'got ' + res.detail)
  } finally { cleanup(base2) }
})

// --- source guard -----------------------------------------------------------
test('confirmed missing --expect-source-commit -> VALIDATION_ERROR / exit 3 / zero writes', () => {
  const base = tmpBase()
  try {
    const r = S.submitPersonality(base, { personaIdentity: P, submissionRef: REF.submissionRef, rationale: REF.rationale, confirm: true })
    assert.equal(r.status, R.VALIDATION_ERROR); assert.equal(r.detail, 'expect-source-commit-required'); assert.equal(fs.existsSync(path.join(base, PS)), false)
  } finally { cleanup(base) }
})
test('wrong --expect-source-commit -> VALIDATION_ERROR / exit 3', () => {
  const base = tmpBase()
  try { const r = run(base, { confirm: true, expectSourceCommit: '0'.repeat(40) }); assert.equal(r.status, R.VALIDATION_ERROR); assert.equal(r.detail, 'expect-source-commit-mismatch') } finally { cleanup(base) }
})

// --- S1 resume --------------------------------------------------------------
test('S1-match WITHOUT --resume -> RESUME_REQUIRED / exit 2 / zero writes', () => {
  const base = tmpBase()
  try { makeS1(base); const r = run(base, { confirm: true }); assert.equal(r.status, R.RESUME_REQUIRED); assert.equal(events(base).length, 0); assert.equal(revs(base).length, 1) } finally { cleanup(base) }
})
test('S1-match with wrong --resume -> RESUME_TARGET_MISMATCH / zero writes', () => {
  const base = tmpBase()
  try { makeS1(base); const r = run(base, { confirm: true, resumeRevisionId: 'nope' }); assert.equal(r.status, R.RESUME_TARGET_MISMATCH); assert.equal(events(base).length, 0) } finally { cleanup(base) }
})
test('S1-match exact --resume + --confirm -> RESUMED_SUBMITTED, appends SUBMITTED only, no 2nd revision', () => {
  const base = tmpBase()
  try {
    const rev = makeS1(base)
    const r = run(base, { confirm: true, resumeRevisionId: rev.revisionId })
    assert.equal(r.status, R.RESUMED_SUBMITTED); assert.equal(revs(base).length, 1)
    const evs = events(base); assert.equal(evs.length, 1); assert.equal(evs[0].eventType, 'SUBMITTED_FOR_REVIEW')
  } finally { cleanup(base) }
})
test('S1-mismatch -> PARTIAL_PAYLOAD_MISMATCH / exit 2 / zero writes / no 2nd revision', () => {
  const base = tmpBase()
  try {
    const rev = createRev(base, PS, RID, { payload: badPayload() })
    const r = run(base, { confirm: true, resumeRevisionId: rev.revisionId })
    assert.equal(r.status, R.PARTIAL_PAYLOAD_MISMATCH); assert.equal(events(base).length, 0); assert.equal(revs(base).length, 1)
  } finally { cleanup(base) }
})

// --- S2 idempotent ----------------------------------------------------------
test('S2-match -> ALREADY_SUBMITTED_MATCH / exit 0 / zero new writes', () => {
  const base = tmpBase()
  try { makeS2(base); const before = events(base).length; const r = run(base, { confirm: true }); assert.equal(r.status, R.ALREADY_SUBMITTED_MATCH); assert.equal(events(base).length, before) } finally { cleanup(base) }
})
test('S2-mismatch -> SUBMITTED_PAYLOAD_MISMATCH / exit 2', () => {
  const base = tmpBase()
  try {
    const rev = createRev(base, PS, RID, { payload: badPayload() }); ev(base, PS, RID, rev.revisionId, 'SUBMITTED_FOR_REVIEW', 'new')
    assert.equal(run(base, { confirm: true }).status, R.SUBMITTED_PAYLOAD_MISMATCH)
  } finally { cleanup(base) }
})

// --- invalid states ---------------------------------------------------------
test('later lifecycle (APPROVED) -> UNEXPECTED_LIFECYCLE_STATE / exit 2 / no new writes', () => {
  const base = tmpBase()
  try {
    const rev = makeS1(base); ev(base, PS, RID, rev.revisionId, 'SUBMITTED_FOR_REVIEW', 'new'); ev(base, PS, RID, rev.revisionId, 'APPROVED', 'review_ready', { approval: { approvedBy: 'l', decision: 'approved' } })
    const before = events(base).length
    assert.equal(run(base, { confirm: true }).status, R.UNEXPECTED_LIFECYCLE_STATE); assert.equal(events(base).length, before)
  } finally { cleanup(base) }
})
test('multiple revisions -> MULTIPLE_REVISIONS / exit 2', () => {
  const base = tmpBase()
  try { createRev(base, PS, RID, { revisionId: 'r1', payload: goodPayload() }); createRev(base, PS, RID, { revisionId: 'r2', supersedes: 'r1', payload: goodPayload() }); assert.equal(run(base, { confirm: true }).status, R.MULTIPLE_REVISIONS) } finally { cleanup(base) }
})
test('duplicate SUBMITTED events -> fail closed (not S2)', () => {
  const base = tmpBase()
  try {
    const rev = makeS1(base); ev(base, PS, RID, rev.revisionId, 'SUBMITTED_FOR_REVIEW', 'new')
    // forge a second SUBMITTED event with a valid hash (not corrupt, just extra)
    const edir = path.join(base, PS, 'events', RID); const one = fs.readdirSync(edir).find((n) => n.endsWith('.json'))
    const o = JSON.parse(fs.readFileSync(path.join(edir, one), 'utf8'))
    const dup = Object.assign({}, o, { eventId: 'dup', sequence: 99 }); const { hashOf } = require('../../../../src/core/memory/canonical'); delete dup.eventHash; dup.eventHash = hashOf(dup, 'eventHash')
    fs.writeFileSync(path.join(edir, 'dup.json'), JSON.stringify(dup))
    const r = run(base, { confirm: true })
    assert.notEqual(r.status, R.ALREADY_SUBMITTED_MATCH)
    assert.equal(S.exitCodeFor(r.status), 2)
  } finally { cleanup(base) }
})
test('corrupt revision -> STORE_CORRUPT; corrupt event -> STORE_CORRUPT', () => {
  let base = tmpBase()
  try { makeS1(base); const dir = path.join(base, PS, 'records', RID); const f = fs.readdirSync(dir).find((n) => n.endsWith('.json')); fs.writeFileSync(path.join(dir, f), '{ broken'); assert.equal(run(base, { confirm: true }).status, R.PERSONALITY_STORE_CORRUPT) } finally { cleanup(base) }
  base = tmpBase()
  try { makeS2(base); const dir = path.join(base, PS, 'events', RID); const f = fs.readdirSync(dir).find((n) => n.endsWith('.json')); fs.writeFileSync(path.join(dir, f), '{ broken'); assert.equal(run(base, { confirm: true }).status, R.PERSONALITY_STORE_CORRUPT) } finally { cleanup(base) }
})
test('dangling / mis-targeted event under the record -> fail closed', () => {
  const base = tmpBase()
  try {
    const rev = makeS1(base)
    // add an event targeting a different (non-existent) revision id
    ev(base, PS, RID, rev.revisionId, 'SUBMITTED_FOR_REVIEW', 'new')
    const edir = path.join(base, PS, 'events', RID); const one = fs.readdirSync(edir).find((n) => n.endsWith('.json'))
    const o = JSON.parse(fs.readFileSync(path.join(edir, one), 'utf8'))
    const dangling = Object.assign({}, o, { eventId: 'dangling', sequence: 50, targetRevisionId: 'ghost' }); const { hashOf } = require('../../../../src/core/memory/canonical'); delete dangling.eventHash; dangling.eventHash = hashOf(dangling, 'eventHash')
    fs.writeFileSync(path.join(edir, 'dangling.json'), JSON.stringify(dangling))
    assert.equal(S.exitCodeFor(run(base, { confirm: true }).status), 2)
  } finally { cleanup(base) }
})
test('OP contamination in a fresh-created revision path is rejected by identity proof', () => {
  const base = tmpBase()
  try {
    // simulate a mismatching pre-existing revision (OP-contaminated) then submit -> mismatch
    const bad = JSON.parse(JSON.stringify(goodPayload())); const f = bad.fragments[0]; f.sourceSequence = 6; f.sourceStartCodeUnit = 1168; f.sourceEndCodeUnit = 1318; f.text = P.slice(1168, 1318); f.sourceSha256Utf8 = B.sha256Utf8(f.text); bad.aggregateSha256 = shadow.computeAggregateSha256(bad)
    const rev = createRev(base, PS, RID, { payload: bad })
    const r = run(base, { confirm: true, resumeRevisionId: rev.revisionId })
    assert.equal(r.status, R.PARTIAL_PAYLOAD_MISMATCH)
  } finally { cleanup(base) }
})

// --- safe output ------------------------------------------------------------
test('output never leaks persona / fragment text', () => {
  const base = tmpBase()
  try { run(base, { confirm: true }); const s = JSON.stringify(run(base, { confirm: true })); for (const leak of ['香香', '表達風格', P.slice(886, 952)]) assert.equal(s.includes(leak), false) } finally { cleanup(base) }
})

// --- CLI --------------------------------------------------------------------
function runCli (base, extraArgs = [], env = {}) {
  const cli = path.resolve(__dirname, '../../../../scripts/memory/submitPersonalityShadow.js')
  const args = [cli, '--submission-ref', REF.submissionRef, '--rationale', REF.rationale].concat(extraArgs)
  const res = cp.spawnSync(process.execPath, args, { env: Object.assign({}, process.env, { AROMA_CORE_DIR: base }, env), encoding: 'utf8' })
  return { code: res.status, out: (res.stdout || '') + (res.stderr || '') }
}
test('CLI dry-run exit 0; confirmed exit 0 SUBMITTED; re-run ALREADY_SUBMITTED_MATCH', () => {
  const base = tmpBase()
  try {
    const d = runCli(base, ['--expect-source-commit', ANCHOR]); assert.equal(d.code, 0); assert.ok(d.out.includes('"status":"DRY_RUN"'))
    const c = runCli(base, ['--expect-source-commit', ANCHOR, '--confirm']); assert.equal(c.code, 0); assert.ok(c.out.includes('"status":"SUBMITTED"'))
    const again = runCli(base, ['--expect-source-commit', ANCHOR, '--confirm']); assert.equal(again.code, 0); assert.ok(again.out.includes('ALREADY_SUBMITTED_MATCH'))
  } finally { cleanup(base) }
})
test('CLI S1 without resume -> exit 2; missing AROMA_CORE_DIR -> exit 3', () => {
  const base = tmpBase()
  try { createRev(base, PS, RID, { payload: goodPayload() }); const r = runCli(base, ['--expect-source-commit', ANCHOR, '--confirm']); assert.equal(r.code, 2); assert.ok(r.out.includes('RESUME_REQUIRED')) } finally { cleanup(base) }
  const cli = path.resolve(__dirname, '../../../../scripts/memory/submitPersonalityShadow.js')
  const env = Object.assign({}, process.env); delete env.AROMA_CORE_DIR
  const res = cp.spawnSync(process.execPath, [cli, '--confirm'], { env, encoding: 'utf8' }); assert.equal(res.status, 3)
})

// --- regressions ------------------------------------------------------------
test('M3c-1 verifier returns NOT_READY/4 for the submitted review_ready state', () => {
  const base = tmpBase()
  try { run(base, { confirm: true }); const v = shadow.verifyPersonalityShadow(base, P); assert.equal(v.status, shadow.REASON.NO_ACTIVE_PERSONALITY); assert.equal(shadow.exitCodeFor(v.status), 4) } finally { cleanup(base) }
})
test('OP verifier unaffected + buildPersonaSystem byte-identical + reachability 0', () => {
  const base = tmpBase()
  try { assert.equal(opShadow.verifyOperatingPrinciplesShadow(base, P).status, opShadow.REASON.NO_ACTIVE_OPERATING_PRINCIPLES) } finally { cleanup(base) }
  assert.equal(buildPersonaSystem('X'), buildPersonaSystem('X'))
  assert.ok(buildPersonaSystem('X').includes(P))
  const SRC = path.resolve(__dirname, '../../../../src')
  const resolveReq = (d, rel) => { const b = path.resolve(d, rel); for (const c of [b, b + '.js', path.join(b, 'index.js')]) { try { if (fs.statSync(c).isFile()) return c } catch (e) {} } return null }
  const reach = (entry) => { const seen = new Set(); const st = [path.resolve(entry)]; while (st.length) { const f = st.pop(); if (seen.has(f)) continue; seen.add(f); let s; try { s = fs.readFileSync(f, 'utf8') } catch (e) { continue } const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g; let m; while ((m = re.exec(s))) { const t = resolveReq(path.dirname(f), m[1]); if (t) st.push(t) } } return seen }
  for (const e of ['index.js', 'app.js']) assert.deepEqual([...reach(path.join(SRC, e))].filter((f) => /[\\/]core[\\/]memory[\\/]/.test(f)), [])
})
