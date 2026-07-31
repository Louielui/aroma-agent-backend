'use strict'

/**
 * personalityApprove.test.js — M3c-3.
 *
 * Isolated tests for the personality approval tool. All Store writes happen ONLY
 * inside temp dirs. Asserts the exact review-ready chain proof, fixed approval
 * identity, exact --expect-revision-id, dry-run zero-write, payload re-proof,
 * no-activation, post-approve APPROVED_NOT_ACTIVE compat, and CLI exit codes.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')
const AP = require('../../../../src/core/memory/shadow/personalityApprove')
const shadow = require('../../../../src/core/memory/shadow/personalityShadow')
const opShadow = require('../../../../src/core/memory/shadow/operatingPrinciplesShadow')
const B = require('../../../../src/core/memory/shadow/behavioralMapping')
const store = require('../../../../src/core/memory/store')
const { revisionState } = require('../../../../src/core/memory/resolver')
const { hashOf } = require('../../../../src/core/memory/canonical')
const { PERSONA_IDENTITY: P, buildPersonaSystem } = require('../../../../src/persona/xiangxiang')
const { tmpBase, cleanup, createRev, ev } = require('../_helpers')

const R = AP.REASON
const RID = AP.PS_RECORD_ID
const PS = AP.PS_STORE
const REF = { approvalRef: 'OWNER-GO-M3C3-TEST', rationale: 'test personality approval' }
const goodPayload = () => shadow.buildPersonalityPayload(P)
const events = (b) => store.listEvents(b, PS, RID)
const revs = (b) => store.listRevisions(b, PS, RID)
function psRevision (base, payload, over = {}) { return createRev(base, PS, RID, { revisionId: over.revisionId, supersedes: over.supersedes || null, payload: payload || goodPayload() }) }
function psEvent (base, target, type, prev, approval) { return ev(base, PS, RID, target, type, prev, approval ? { approval } : {}) }
function mkReviewReady (base, payload) { const r = psRevision(base, payload); psEvent(base, r.revisionId, 'SUBMITTED_FOR_REVIEW', 'new'); return r }
function mkApproved (base) { const r = mkReviewReady(base); psEvent(base, r.revisionId, 'APPROVED', 'review_ready', { approvedBy: 'Louie', decision: 'approved' }); return r }
function mkActive (base) { const r = mkApproved(base); psEvent(base, r.revisionId, 'ACTIVATED', 'approved'); return r }
function run (base, extra = {}) { return AP.approvePersonality(base, Object.assign({ personaIdentity: P }, REF, extra)) }
function badPayload () { const p = JSON.parse(JSON.stringify(goodPayload())); p.fragments[0].text += 'X'; p.aggregateSha256 = shadow.computeAggregateSha256(p); return p }
function opPayload () { const p = JSON.parse(JSON.stringify(goodPayload())); const f = p.fragments[0]; f.sourceSequence = 4; f.sourceStartCodeUnit = 1008; f.sourceEndCodeUnit = 1080; f.text = P.slice(1008, 1080); f.sourceSha256Utf8 = B.sha256Utf8(f.text); p.aggregateSha256 = shadow.computeAggregateSha256(p); return p }

// --- dry-run + approve ------------------------------------------------------
test('review_ready + exact --expect-revision-id, dry-run -> DRY_RUN / zero writes', () => {
  const base = tmpBase()
  try { const r0 = mkReviewReady(base); const b = events(base).length; const r = run(base, { expectRevisionId: r0.revisionId }); assert.equal(r.status, R.DRY_RUN); assert.equal(r.plan, 'approve'); assert.equal(events(base).length, b) } finally { cleanup(base) }
})
test('review_ready exact chain + guards + confirm -> APPROVED; 1 rev / 2 events; approved; resolver NONE; no ACTIVATED', () => {
  const base = tmpBase()
  try {
    const r0 = mkReviewReady(base)
    const r = run(base, { expectRevisionId: r0.revisionId, confirm: true })
    assert.equal(r.status, R.APPROVED); assert.equal(AP.exitCodeFor(r.status), 0)
    assert.equal(revs(base).length, 1)
    const evs = events(base); assert.equal(evs.length, 2)
    assert.deepEqual(evs.map((e) => e.eventType).sort(), ['APPROVED', 'SUBMITTED_FOR_REVIEW'])
    const ap = evs.find((e) => e.eventType === 'APPROVED').approval
    assert.equal(ap.approvedBy, 'Louie'); assert.equal(ap.approvalSource, 'owner-authorized-approval'); assert.equal(ap.decision, 'approved'); assert.equal(ap.reviewRef, REF.approvalRef); assert.equal(ap.rationale, REF.rationale)
    assert.equal(evs.find((e) => e.eventType === 'APPROVED').actor, 'Louie')
    assert.equal(revisionState(PS, r0.revisionId, evs).state, 'approved')
    assert.equal(store.resolveActiveRecord(base, PS, RID).status, 'NONE')
    assert.equal(new Set(evs.map((e) => e.eventType)).has('ACTIVATED'), false)
    assert.equal(r.compat.status, shadow.REASON.NO_ACTIVE_PERSONALITY); assert.equal(r.compat.subReason, 'APPROVED_NOT_ACTIVE'); assert.equal(r.compat.exitCode, 4)
  } finally { cleanup(base) }
})
test('rogue caller cannot inject approval identity', () => {
  const base = tmpBase()
  try {
    const r0 = mkReviewReady(base)
    AP.approvePersonality(base, { personaIdentity: P, expectRevisionId: r0.revisionId, approvalRef: REF.approvalRef, rationale: REF.rationale, confirm: true, approvedBy: 'attacker', approvalSource: 'x', decision: 'y', actor: 'z' })
    const ap = events(base).find((e) => e.eventType === 'APPROVED')
    assert.equal(ap.actor, 'Louie'); assert.equal(ap.approval.approvedBy, 'Louie'); assert.equal(ap.approval.approvalSource, 'owner-authorized-approval'); assert.equal(ap.approval.decision, 'approved')
  } finally { cleanup(base) }
})

// --- guards -----------------------------------------------------------------
test('missing / wrong --expect-revision-id -> REVISION_TARGET_MISMATCH / exit 2 / zero writes', () => {
  const base = tmpBase()
  try { mkReviewReady(base); assert.equal(run(base, { confirm: true }).status, R.REVISION_TARGET_MISMATCH); assert.equal(run(base, { confirm: true, expectRevisionId: 'nope' }).status, R.REVISION_TARGET_MISMATCH); assert.equal(events(base).length, 1) } finally { cleanup(base) }
})
test('confirmed missing --approval-ref -> VALIDATION_ERROR / exit 3 / zero writes', () => {
  const base = tmpBase()
  try { const r0 = mkReviewReady(base); const r = AP.approvePersonality(base, { personaIdentity: P, rationale: 'x', confirm: true, expectRevisionId: r0.revisionId }); assert.equal(r.status, R.VALIDATION_ERROR); assert.equal(AP.exitCodeFor(r.status), 3); assert.equal(events(base).length, 1) } finally { cleanup(base) }
})
test('review_ready with corrupted payload -> PAYLOAD_IDENTITY_FAILED / exit 2 / no APPROVED', () => {
  const base = tmpBase()
  try { const r0 = mkReviewReady(base, badPayload()); const r = run(base, { confirm: true, expectRevisionId: r0.revisionId }); assert.equal(r.status, R.PAYLOAD_IDENTITY_FAILED); assert.equal(events(base).length, 1) } finally { cleanup(base) }
})
test('review_ready with OP contamination -> PAYLOAD_IDENTITY_FAILED', () => {
  const base = tmpBase()
  try { const r0 = mkReviewReady(base, opPayload()); const r = run(base, { confirm: true, expectRevisionId: r0.revisionId }); assert.equal(r.status, R.PAYLOAD_IDENTITY_FAILED) } finally { cleanup(base) }
})

// --- state matrix -----------------------------------------------------------
test('new (submitted absent) -> NOT_SUBMITTED / exit 2', () => {
  const base = tmpBase()
  try { const r0 = psRevision(base); assert.equal(run(base, { confirm: true, expectRevisionId: r0.revisionId }).status, R.NOT_SUBMITTED); assert.equal(events(base).length, 0) } finally { cleanup(base) }
})
test('active / later -> UNEXPECTED_LIFECYCLE_STATE', () => {
  const base = tmpBase()
  try { const r0 = mkActive(base); const b = events(base).length; assert.equal(run(base, { confirm: true, expectRevisionId: r0.revisionId }).status, R.UNEXPECTED_LIFECYCLE_STATE); assert.equal(events(base).length, b) } finally { cleanup(base) }
})
test('multiple revisions -> MULTIPLE_REVISIONS', () => {
  const base = tmpBase()
  try { psRevision(base, goodPayload(), { revisionId: 'r1' }); psRevision(base, goodPayload(), { revisionId: 'r2', supersedes: 'r1' }); assert.equal(run(base, { confirm: true, expectRevisionId: 'r1' }).status, R.MULTIPLE_REVISIONS) } finally { cleanup(base) }
})
test('corrupt revision -> STORE_CORRUPT; corrupt event -> STORE_CORRUPT', () => {
  let base = tmpBase()
  try { const r0 = mkReviewReady(base); const dir = path.join(base, PS, 'records', RID); const f = fs.readdirSync(dir).find((n) => n.endsWith('.json')); fs.writeFileSync(path.join(dir, f), '{ broken'); assert.equal(run(base, { confirm: true, expectRevisionId: r0.revisionId }).status, R.STORE_CORRUPT) } finally { cleanup(base) }
  base = tmpBase()
  try { const r0 = mkReviewReady(base); const dir = path.join(base, PS, 'events', RID); const f = fs.readdirSync(dir).find((n) => n.endsWith('.json')); fs.writeFileSync(path.join(dir, f), '{ broken'); assert.equal(run(base, { confirm: true, expectRevisionId: r0.revisionId }).status, R.STORE_CORRUPT) } finally { cleanup(base) }
})

// --- exact-chain fail-closed ------------------------------------------------
function forgeEvent (base, srcType, over) {
  const edir = path.join(base, PS, 'events', RID); const one = fs.readdirSync(edir).map((f) => ({ f, o: JSON.parse(fs.readFileSync(path.join(edir, f), 'utf8')) })).find((x) => x.o.eventType === srcType)
  const dup = Object.assign({}, one.o, over); delete dup.eventHash; dup.eventHash = hashOf(dup, 'eventHash')
  fs.writeFileSync(path.join(edir, over.eventId + '.json'), JSON.stringify(dup))
}
test('duplicate SUBMITTED -> CHAIN_PROOF_FAILED (review-ready chain not exact)', () => {
  const base = tmpBase()
  try { const r0 = mkReviewReady(base); forgeEvent(base, 'SUBMITTED_FOR_REVIEW', { eventId: 'dup', sequence: 90 }); assert.equal(run(base, { confirm: true, expectRevisionId: r0.revisionId }).status, R.CHAIN_PROOF_FAILED) } finally { cleanup(base) }
})
test('duplicate APPROVED -> CHAIN_PROOF_FAILED (approved chain not exact, not idempotent)', () => {
  const base = tmpBase()
  try { const r0 = mkApproved(base); forgeEvent(base, 'APPROVED', { eventId: 'dup', sequence: 91 }); const r = run(base, { confirm: true, expectRevisionId: r0.revisionId }); assert.notEqual(r.status, R.ALREADY_APPROVED_MATCH); assert.equal(r.status, R.CHAIN_PROOF_FAILED) } finally { cleanup(base) }
})
test('mis-targeted event -> CHAIN_PROOF_FAILED', () => {
  const base = tmpBase()
  try { const r0 = mkReviewReady(base); forgeEvent(base, 'SUBMITTED_FOR_REVIEW', { eventId: 'mis', sequence: 92, targetRevisionId: 'ghost' }); assert.equal(run(base, { confirm: true, expectRevisionId: r0.revisionId }).status, R.CHAIN_PROOF_FAILED) } finally { cleanup(base) }
})
test('dangling event (revision removed) -> STORE_CORRUPT or CHAIN_PROOF_FAILED', () => {
  const base = tmpBase()
  try { const r0 = mkReviewReady(base); forgeEvent(base, 'SUBMITTED_FOR_REVIEW', { eventId: 'extra', sequence: 93, targetRevisionId: 'ghost2' }); const r = run(base, { confirm: true, expectRevisionId: r0.revisionId }); assert.equal(AP.exitCodeFor(r.status), 2) } finally { cleanup(base) }
})

// --- idempotency ------------------------------------------------------------
test('already approved exact match -> ALREADY_APPROVED_MATCH / exit 0 / zero writes', () => {
  const base = tmpBase()
  try { const r0 = mkApproved(base); const b = events(base).length; const r = run(base, { confirm: true, expectRevisionId: r0.revisionId }); assert.equal(r.status, R.ALREADY_APPROVED_MATCH); assert.equal(events(base).length, b) } finally { cleanup(base) }
})
test('already approved with mismatched payload -> APPROVED_PAYLOAD_MISMATCH', () => {
  const base = tmpBase()
  try {
    const r0 = psRevision(base, badPayload()); psEvent(base, r0.revisionId, 'SUBMITTED_FOR_REVIEW', 'new'); psEvent(base, r0.revisionId, 'APPROVED', 'review_ready', { approvedBy: 'Louie', decision: 'approved' })
    assert.equal(run(base, { confirm: true, expectRevisionId: r0.revisionId }).status, R.APPROVED_PAYLOAD_MISMATCH)
  } finally { cleanup(base) }
})

// --- mapping ----------------------------------------------------------------
test('broken M3a mapping -> MAPPING_CONTRACT_ERROR / exit 3', () => {
  const base = tmpBase()
  try { mkReviewReady(base); const r = AP.approvePersonality(base, { personaIdentity: 'not-persona', expectRevisionId: 'x', approvalRef: 'r', rationale: 'y', confirm: true }); assert.equal(r.status, R.MAPPING_CONTRACT_ERROR); assert.equal(AP.exitCodeFor(r.status), 3) } finally { cleanup(base) }
})

// --- emits only APPROVED ----------------------------------------------------
test('the tool only ever emits APPROVED', () => { assert.deepEqual(AP.EMITTED_EVENT_TYPES, ['APPROVED']) })

// --- CLI --------------------------------------------------------------------
function runCli (base, extraArgs = [], env = {}) {
  const cli = path.resolve(__dirname, '../../../../scripts/memory/approvePersonalityShadow.js')
  const args = [cli, '--approval-ref', REF.approvalRef, '--rationale', REF.rationale].concat(extraArgs)
  const res = cp.spawnSync(process.execPath, args, { env: Object.assign({}, process.env, { AROMA_CORE_DIR: base }, env), encoding: 'utf8' })
  return { code: res.status, out: (res.stdout || '') + (res.stderr || '') }
}
test('CLI dry-run exit 0; confirmed exit 0 APPROVED; re-run ALREADY_APPROVED_MATCH; no leak', () => {
  const base = tmpBase()
  try {
    const r0 = mkReviewReady(base)
    const d = runCli(base, ['--expect-revision-id', r0.revisionId]); assert.equal(d.code, 0); assert.ok(d.out.includes('"status":"DRY_RUN"'))
    const c = runCli(base, ['--expect-revision-id', r0.revisionId, '--confirm']); assert.equal(c.code, 0); assert.ok(c.out.includes('"status":"APPROVED"'))
    const again = runCli(base, ['--expect-revision-id', r0.revisionId, '--confirm']); assert.equal(again.code, 0); assert.ok(again.out.includes('ALREADY_APPROVED_MATCH'))
    for (const leak of ['香香', '表達風格', P.slice(886, 952)]) assert.equal(c.out.includes(leak), false)
  } finally { cleanup(base) }
})
test('CLI review_ready without --expect-revision-id -> exit 2; missing AROMA_CORE_DIR -> exit 3', () => {
  const base = tmpBase()
  try { mkReviewReady(base); const r = runCli(base, ['--confirm']); assert.equal(r.code, 2); assert.ok(r.out.includes('REVISION_TARGET_MISMATCH')) } finally { cleanup(base) }
  const cli = path.resolve(__dirname, '../../../../scripts/memory/approvePersonalityShadow.js')
  const env = Object.assign({}, process.env); delete env.AROMA_CORE_DIR
  const res = cp.spawnSync(process.execPath, [cli, '--confirm'], { env, encoding: 'utf8' }); assert.equal(res.status, 3)
})

// --- regressions ------------------------------------------------------------
test('post-approve personality shadow verifier = APPROVED_NOT_ACTIVE / exit 4', () => {
  const base = tmpBase()
  try { const r0 = mkReviewReady(base); run(base, { confirm: true, expectRevisionId: r0.revisionId }); const v = shadow.verifyPersonalityShadow(base, P); assert.equal(v.status, shadow.REASON.NO_ACTIVE_PERSONALITY); assert.equal(v.subReason, 'APPROVED_NOT_ACTIVE'); assert.equal(shadow.exitCodeFor(v.status), 4) } finally { cleanup(base) }
})
test('OP verifier unaffected + buildPersonaSystem byte-identical + reachability 0', () => {
  const base = tmpBase()
  try { assert.equal(opShadow.verifyOperatingPrinciplesShadow(base, P).status, opShadow.REASON.NO_ACTIVE_OPERATING_PRINCIPLES) } finally { cleanup(base) }
  assert.equal(buildPersonaSystem('X'), buildPersonaSystem('X')); assert.ok(buildPersonaSystem('X').includes(P))
  const SRC = path.resolve(__dirname, '../../../../src')
  const resolveReq = (d, rel) => { const b = path.resolve(d, rel); for (const c of [b, b + '.js', path.join(b, 'index.js')]) { try { if (fs.statSync(c).isFile()) return c } catch (e) {} } return null }
  const reach = (entry) => { const seen = new Set(); const st = [path.resolve(entry)]; while (st.length) { const f = st.pop(); if (seen.has(f)) continue; seen.add(f); let s; try { s = fs.readFileSync(f, 'utf8') } catch (e) { continue } const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g; let m; while ((m = re.exec(s))) { const t = resolveReq(path.dirname(f), m[1]); if (t) st.push(t) } } return seen }
  for (const e of ['index.js', 'app.js']) assert.deepEqual([...reach(path.join(SRC, e))].filter((f) => /[\\/]core[\\/]memory[\\/]/.test(f)), [])
})
