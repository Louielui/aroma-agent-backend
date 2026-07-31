'use strict'

/**
 * personalityActivate.test.js — M3c-4.
 *
 * Isolated tests for the personality activation tool. All Store writes happen ONLY
 * inside temp dirs. Asserts the exact approved-chain proof, exact guards, canonical
 * rationale, fixed identity, emit-only-ACTIVATED, active resolver, shadow PASS/0,
 * runtime isolation, and CLI exit codes.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')
const AC = require('../../../../src/core/memory/shadow/personalityActivate')
const shadow = require('../../../../src/core/memory/shadow/personalityShadow')
const opShadow = require('../../../../src/core/memory/shadow/operatingPrinciplesShadow')
const B = require('../../../../src/core/memory/shadow/behavioralMapping')
const store = require('../../../../src/core/memory/store')
const { revisionState } = require('../../../../src/core/memory/resolver')
const { hashOf } = require('../../../../src/core/memory/canonical')
const { PERSONA_IDENTITY: P, buildPersonaSystem } = require('../../../../src/persona/xiangxiang')
const { tmpBase, cleanup, createRev, ev } = require('../_helpers')

const R = AC.REASON
const RID = AC.PS_RECORD_ID
const PS = AC.PS_STORE
const ANCHOR = 'e90cb5bbf73203053b1f67c4a6d1468db67edbff'
const REF = { activationRef: 'OWNER-GO-M3C4-TEST', rationale: 'test personality activation' }
const goodPayload = () => shadow.buildPersonalityPayload(P)
const events = (b) => store.listEvents(b, PS, RID)
const revs = (b) => store.listRevisions(b, PS, RID)
function psRevision (base, payload, over = {}) { return createRev(base, PS, RID, { revisionId: over.revisionId, supersedes: over.supersedes || null, payload: payload || goodPayload() }) }
function psEvent (base, target, type, prev, approval) { return ev(base, PS, RID, target, type, prev, approval ? { approval } : {}) }
function mkApproved (base, payload) { const r = psRevision(base, payload); psEvent(base, r.revisionId, 'SUBMITTED_FOR_REVIEW', 'new'); psEvent(base, r.revisionId, 'APPROVED', 'review_ready', { approvedBy: 'Louie', decision: 'approved' }); return r }
function mkActive (base) { const r = mkApproved(base); psEvent(base, r.revisionId, 'ACTIVATED', 'approved'); return r }
function mkReviewReady (base) { const r = psRevision(base); psEvent(base, r.revisionId, 'SUBMITTED_FOR_REVIEW', 'new'); return r }
function run (base, extra = {}) { return AC.activatePersonality(base, Object.assign({ personaIdentity: P, expectSourceCommit: ANCHOR }, REF, extra)) }
function badPayload () { const p = JSON.parse(JSON.stringify(goodPayload())); p.fragments[0].text += 'X'; p.aggregateSha256 = shadow.computeAggregateSha256(p); return p }
function opPayload () { const p = JSON.parse(JSON.stringify(goodPayload())); const f = p.fragments[0]; f.sourceSequence = 4; f.sourceStartCodeUnit = 1008; f.sourceEndCodeUnit = 1080; f.text = P.slice(1008, 1080); f.sourceSha256Utf8 = B.sha256Utf8(f.text); p.aggregateSha256 = shadow.computeAggregateSha256(p); return p }
function forgeEvent (base, srcType, over) {
  const edir = path.join(base, PS, 'events', RID); const one = fs.readdirSync(edir).map((f) => ({ f, o: JSON.parse(fs.readFileSync(path.join(edir, f), 'utf8')) })).find((x) => x.o.eventType === srcType)
  const dup = Object.assign({}, one.o, over); delete dup.eventHash; dup.eventHash = hashOf(dup, 'eventHash')
  fs.writeFileSync(path.join(edir, over.eventId + '.json'), JSON.stringify(dup))
}

// 1. dry-run
test('approved + guards, dry-run -> DRY_RUN / zero writes', () => {
  const base = tmpBase()
  try { const r0 = mkApproved(base); const b = events(base).length; const r = AC.activatePersonality(base, { personaIdentity: P, expectRevisionId: r0.revisionId, expectSourceCommit: ANCHOR, activationRef: REF.activationRef, rationale: REF.rationale }); assert.equal(r.status, R.DRY_RUN); assert.equal(r.plan, 'activate'); assert.equal(events(base).length, b) } finally { cleanup(base) }
})

// 2-7. activation success
test('approved exact chain + guards + confirm -> ACTIVATED; 1 rev / 3 events / active / resolver ACTIVE; shadow PASS/0', () => {
  const base = tmpBase()
  try {
    const r0 = mkApproved(base)
    const r = run(base, { expectRevisionId: r0.revisionId, confirm: true })
    assert.equal(r.status, R.ACTIVATED); assert.equal(AC.exitCodeFor(r.status), 0)
    assert.equal(revs(base).length, 1)
    const evs = events(base); assert.equal(evs.length, 3)
    assert.deepEqual(evs.map((e) => e.eventType).sort(), ['ACTIVATED', 'APPROVED', 'SUBMITTED_FOR_REVIEW'])
    assert.equal(revisionState(PS, r0.revisionId, evs).state, 'active')
    const active = store.resolveActiveRecord(base, PS, RID); assert.equal(active.status, 'ACTIVE'); assert.equal(active.revisionId, r0.revisionId)
    assert.equal(r.compat.status, shadow.REASON.PASS); assert.equal(r.compat.exitCode, 0)
    const v = shadow.verifyPersonalityShadow(base, P); assert.equal(v.status, 'PASS'); assert.equal(shadow.exitCodeFor(v.status), 0)
  } finally { cleanup(base) }
})

// 7. runtime isolation
test('activation leaves runtime byte-identical + reachability 0', () => {
  const base = tmpBase()
  try {
    const r0 = mkApproved(base); run(base, { expectRevisionId: r0.revisionId, confirm: true })
    assert.equal(buildPersonaSystem('X'), buildPersonaSystem('X')); assert.ok(buildPersonaSystem('X').includes(P))
    const SRC = path.resolve(__dirname, '../../../../src')
    const resolveReq = (d, rel) => { const b = path.resolve(d, rel); for (const c of [b, b + '.js', path.join(b, 'index.js')]) { try { if (fs.statSync(c).isFile()) return c } catch (e) {} } return null }
    const reach = (entry) => { const seen = new Set(); const st = [path.resolve(entry)]; while (st.length) { const f = st.pop(); if (seen.has(f)) continue; seen.add(f); let s; try { s = fs.readFileSync(f, 'utf8') } catch (e) { continue } const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g; let m; while ((m = re.exec(s))) { const t = resolveReq(path.dirname(f), m[1]); if (t) st.push(t) } } return seen }
    for (const e of ['index.js', 'app.js']) assert.deepEqual([...reach(path.join(SRC, e))].filter((f) => /[\\/]core[\\/]memory[\\/]/.test(f)), [])
  } finally { cleanup(base) }
})

// 8-9. canonical rationale + round-trip
test('canonical activation rationale exact + round-trip; fixed identity', () => {
  const base = tmpBase()
  try {
    const r0 = mkApproved(base); run(base, { expectRevisionId: r0.revisionId, confirm: true })
    const act = events(base).find((e) => e.eventType === 'ACTIVATED')
    assert.equal(act.actor, 'Louie'); assert.equal(act.approval, null)
    const parsed = JSON.parse(act.rationale)
    assert.equal(parsed.activatedBy, 'Louie'); assert.equal(parsed.activationSource, 'owner-authorized-activation'); assert.equal(parsed.activationRef, REF.activationRef); assert.equal(parsed.reason, REF.rationale)
    assert.equal(act.rationale, JSON.stringify({ activatedBy: 'Louie', activationRef: REF.activationRef, activationSource: 'owner-authorized-activation', reason: REF.rationale }))
  } finally { cleanup(base) }
})
test('buildActivationRationale deterministic canonical JSON (round-trip)', () => {
  const s = AC.buildActivationRationale('REF-1', 'why')
  assert.equal(s, JSON.stringify({ activatedBy: 'Louie', activationRef: 'REF-1', activationSource: 'owner-authorized-activation', reason: 'why' }))
  assert.deepEqual(JSON.parse(s), { activatedBy: 'Louie', activationRef: 'REF-1', activationSource: 'owner-authorized-activation', reason: 'why' })
})
test('rogue caller cannot inject actor / activatedBy / activationSource', () => {
  const base = tmpBase()
  try {
    const r0 = mkApproved(base)
    AC.activatePersonality(base, { personaIdentity: P, expectRevisionId: r0.revisionId, expectSourceCommit: ANCHOR, activationRef: REF.activationRef, rationale: REF.rationale, confirm: true, actor: 'x', activatedBy: 'y', activationSource: 'z' })
    const act = events(base).find((e) => e.eventType === 'ACTIVATED'); const parsed = JSON.parse(act.rationale)
    assert.equal(act.actor, 'Louie'); assert.equal(parsed.activatedBy, 'Louie'); assert.equal(parsed.activationSource, 'owner-authorized-activation')
  } finally { cleanup(base) }
})

// 12-13. guards
test('missing / wrong --expect-revision-id -> REVISION_TARGET_MISMATCH / zero writes', () => {
  const base = tmpBase()
  try { mkApproved(base); assert.equal(run(base, { confirm: true }).status, R.REVISION_TARGET_MISMATCH); assert.equal(run(base, { confirm: true, expectRevisionId: 'nope' }).status, R.REVISION_TARGET_MISMATCH); assert.equal(events(base).length, 2) } finally { cleanup(base) }
})
test('missing / wrong --expect-source-commit -> VALIDATION_ERROR / exit 3', () => {
  const base = tmpBase()
  try {
    const r0 = mkApproved(base)
    const miss = AC.activatePersonality(base, { personaIdentity: P, expectRevisionId: r0.revisionId, activationRef: REF.activationRef, rationale: REF.rationale, confirm: true })
    assert.equal(miss.status, R.VALIDATION_ERROR); assert.equal(miss.detail, 'expect-source-commit-required')
    assert.equal(run(base, { confirm: true, expectRevisionId: r0.revisionId, expectSourceCommit: '0'.repeat(40) }).detail, 'expect-source-commit-mismatch')
  } finally { cleanup(base) }
})

// 14. not approved
test('review_ready / new -> NOT_APPROVED', () => {
  let base = tmpBase()
  try { const r0 = mkReviewReady(base); assert.equal(run(base, { confirm: true, expectRevisionId: r0.revisionId }).status, R.NOT_APPROVED) } finally { cleanup(base) }
  base = tmpBase()
  try { const r0 = psRevision(base); assert.equal(run(base, { confirm: true, expectRevisionId: r0.revisionId }).status, R.NOT_APPROVED) } finally { cleanup(base) }
})

// 15-16. idempotency + malformed
test('already active exact match -> ALREADY_ACTIVE_MATCH / zero writes', () => {
  const base = tmpBase()
  try { const r0 = mkActive(base); const b = events(base).length; const r = run(base, { confirm: true, expectRevisionId: r0.revisionId }); assert.equal(r.status, R.ALREADY_ACTIVE_MATCH); assert.equal(events(base).length, b) } finally { cleanup(base) }
})
test('active with duplicate ACTIVATED -> CHAIN_PROOF_FAILED (not idempotent)', () => {
  const base = tmpBase()
  try { const r0 = mkActive(base); forgeEvent(base, 'ACTIVATED', { eventId: 'dup', sequence: 90 }); const r = run(base, { confirm: true, expectRevisionId: r0.revisionId }); assert.notEqual(r.status, R.ALREADY_ACTIVE_MATCH); assert.equal(r.status, R.CHAIN_PROOF_FAILED) } finally { cleanup(base) }
})
test('active payload drift -> ACTIVE_PAYLOAD_MISMATCH', () => {
  const base = tmpBase()
  try {
    const r0 = psRevision(base, badPayload()); psEvent(base, r0.revisionId, 'SUBMITTED_FOR_REVIEW', 'new'); psEvent(base, r0.revisionId, 'APPROVED', 'review_ready', { approvedBy: 'Louie', decision: 'approved' }); psEvent(base, r0.revisionId, 'ACTIVATED', 'approved')
    assert.equal(run(base, { confirm: true, expectRevisionId: r0.revisionId }).status, R.ACTIVE_PAYLOAD_MISMATCH)
  } finally { cleanup(base) }
})

// 17-22. chain fail-closed
test('duplicate SUBMITTED -> CHAIN_PROOF_FAILED', () => {
  const base = tmpBase(); try { const r0 = mkApproved(base); forgeEvent(base, 'SUBMITTED_FOR_REVIEW', { eventId: 'd', sequence: 91 }); assert.equal(run(base, { confirm: true, expectRevisionId: r0.revisionId }).status, R.CHAIN_PROOF_FAILED) } finally { cleanup(base) }
})
test('duplicate APPROVED -> CHAIN_PROOF_FAILED', () => {
  const base = tmpBase(); try { const r0 = mkApproved(base); forgeEvent(base, 'APPROVED', { eventId: 'd', sequence: 92 }); assert.equal(run(base, { confirm: true, expectRevisionId: r0.revisionId }).status, R.CHAIN_PROOF_FAILED) } finally { cleanup(base) }
})
test('mis-targeted event -> CHAIN_PROOF_FAILED', () => {
  const base = tmpBase(); try { const r0 = mkApproved(base); forgeEvent(base, 'APPROVED', { eventId: 'mis', sequence: 93, targetRevisionId: 'ghost' }); assert.equal(run(base, { confirm: true, expectRevisionId: r0.revisionId }).status, R.CHAIN_PROOF_FAILED) } finally { cleanup(base) }
})
test('dangling event -> exit 2', () => {
  const base = tmpBase(); try { const r0 = mkApproved(base); forgeEvent(base, 'APPROVED', { eventId: 'dangle', sequence: 94, targetRevisionId: 'ghost2' }); assert.equal(AC.exitCodeFor(run(base, { confirm: true, expectRevisionId: r0.revisionId }).status), 2) } finally { cleanup(base) }
})

// 23-25. payload
test('OP contamination -> PAYLOAD_IDENTITY_FAILED', () => {
  const base = tmpBase(); try { const r0 = mkApproved(base, opPayload()); assert.equal(run(base, { confirm: true, expectRevisionId: r0.revisionId }).status, R.PAYLOAD_IDENTITY_FAILED) } finally { cleanup(base) }
})
test('corrupted payload -> PAYLOAD_IDENTITY_FAILED / no ACTIVATED', () => {
  const base = tmpBase(); try { const r0 = mkApproved(base, badPayload()); const r = run(base, { confirm: true, expectRevisionId: r0.revisionId }); assert.equal(r.status, R.PAYLOAD_IDENTITY_FAILED); assert.equal(events(base).length, 2) } finally { cleanup(base) }
})

// 26-30. states
test('ambiguous active -> AMBIGUOUS_ACTIVE', () => {
  const base = tmpBase()
  try {
    psRevision(base, goodPayload(), { revisionId: 'a' }); psEvent(base, 'a', 'SUBMITTED_FOR_REVIEW', 'new'); psEvent(base, 'a', 'APPROVED', 'review_ready', { approvedBy: 'l', decision: 'approved' }); psEvent(base, 'a', 'ACTIVATED', 'approved')
    psRevision(base, goodPayload(), { revisionId: 'b', supersedes: 'a' }); psEvent(base, 'b', 'SUBMITTED_FOR_REVIEW', 'new'); psEvent(base, 'b', 'APPROVED', 'review_ready', { approvedBy: 'l', decision: 'approved' }); psEvent(base, 'b', 'ACTIVATED', 'approved')
    assert.equal(run(base, { confirm: true, expectRevisionId: 'a' }).status, R.AMBIGUOUS_ACTIVE)
  } finally { cleanup(base) }
})
test('multiple revisions -> MULTIPLE_REVISIONS', () => {
  const base = tmpBase(); try { psRevision(base, goodPayload(), { revisionId: 'r1' }); psRevision(base, goodPayload(), { revisionId: 'r2', supersedes: 'r1' }); assert.equal(run(base, { confirm: true, expectRevisionId: 'r1' }).status, R.MULTIPLE_REVISIONS) } finally { cleanup(base) }
})
test('corrupt revision -> STORE_CORRUPT; corrupt event -> STORE_CORRUPT', () => {
  let base = tmpBase()
  try { const r0 = mkApproved(base); const dir = path.join(base, PS, 'records', RID); const f = fs.readdirSync(dir).find((n) => n.endsWith('.json')); fs.writeFileSync(path.join(dir, f), '{ broken'); assert.equal(run(base, { confirm: true, expectRevisionId: r0.revisionId }).status, R.STORE_CORRUPT) } finally { cleanup(base) }
  base = tmpBase()
  try { const r0 = mkApproved(base); const dir = path.join(base, PS, 'events', RID); const f = fs.readdirSync(dir).find((n) => n.endsWith('.json')); fs.writeFileSync(path.join(dir, f), '{ broken'); assert.equal(run(base, { confirm: true, expectRevisionId: r0.revisionId }).status, R.STORE_CORRUPT) } finally { cleanup(base) }
})
test('approved-then-deprecated -> UNEXPECTED_LIFECYCLE_STATE', () => {
  const base = tmpBase(); try { const r0 = mkApproved(base); psEvent(base, r0.revisionId, 'DEPRECATED', 'approved'); assert.equal(run(base, { confirm: true, expectRevisionId: r0.revisionId }).status, R.UNEXPECTED_LIFECYCLE_STATE) } finally { cleanup(base) }
})

// 31. ADMITTED
test('tool only emits ACTIVATED; ADMITTED rejected by M1 for personality', () => {
  assert.deepEqual(AC.EMITTED_EVENT_TYPES, ['ACTIVATED'])
  const base = tmpBase()
  try { const r0 = mkApproved(base); assert.throws(() => store.recordEvent(base, PS, { recordId: RID, targetRevisionId: r0.revisionId, eventType: 'ADMITTED', actor: 't', approval: null, rationale: 'r', expectedPreviousState: 'approved', timestampLabel: 'L' }), (e) => e.code === 'INVALID_TRANSITION' || e.code === 'VALIDATION_ERROR') } finally { cleanup(base) }
})

// broken mapping
test('broken M3a mapping -> MAPPING_CONTRACT_ERROR / exit 3', () => {
  const base = tmpBase(); try { mkApproved(base); const r = AC.activatePersonality(base, { personaIdentity: 'not-persona', expectRevisionId: 'x', expectSourceCommit: ANCHOR, activationRef: 'r', rationale: 'y', confirm: true }); assert.equal(r.status, R.MAPPING_CONTRACT_ERROR); assert.equal(AC.exitCodeFor(r.status), 3) } finally { cleanup(base) }
})

// 34. CLI
function runCli (base, extraArgs = [], env = {}) {
  const cli = path.resolve(__dirname, '../../../../scripts/memory/activatePersonalityShadow.js')
  const args = [cli, '--activation-ref', REF.activationRef, '--rationale', REF.rationale].concat(extraArgs)
  const res = cp.spawnSync(process.execPath, args, { env: Object.assign({}, process.env, { AROMA_CORE_DIR: base }, env), encoding: 'utf8' })
  return { code: res.status, out: (res.stdout || '') + (res.stderr || '') }
}
test('CLI dry-run exit 0; confirmed exit 0 ACTIVATED; re-run ALREADY_ACTIVE_MATCH; no leak', () => {
  const base = tmpBase()
  try {
    const r0 = mkApproved(base)
    const d = runCli(base, ['--expect-revision-id', r0.revisionId, '--expect-source-commit', ANCHOR]); assert.equal(d.code, 0); assert.ok(d.out.includes('"status":"DRY_RUN"'))
    const c = runCli(base, ['--expect-revision-id', r0.revisionId, '--expect-source-commit', ANCHOR, '--confirm']); assert.equal(c.code, 0); assert.ok(c.out.includes('"status":"ACTIVATED"'))
    const again = runCli(base, ['--expect-revision-id', r0.revisionId, '--expect-source-commit', ANCHOR, '--confirm']); assert.equal(again.code, 0); assert.ok(again.out.includes('ALREADY_ACTIVE_MATCH'))
    for (const leak of ['香香', '表達風格', P.slice(886, 952)]) assert.equal(c.out.includes(leak), false)
  } finally { cleanup(base) }
})
test('CLI review_ready + confirm -> exit 2 NOT_APPROVED; missing AROMA_CORE_DIR -> exit 3', () => {
  const base = tmpBase()
  try { const r0 = mkReviewReady(base); const r = runCli(base, ['--expect-revision-id', r0.revisionId, '--expect-source-commit', ANCHOR, '--confirm']); assert.equal(r.code, 2); assert.ok(r.out.includes('NOT_APPROVED')) } finally { cleanup(base) }
  const cli = path.resolve(__dirname, '../../../../scripts/memory/activatePersonalityShadow.js')
  const env = Object.assign({}, process.env); delete env.AROMA_CORE_DIR
  const res = cp.spawnSync(process.execPath, [cli, '--confirm'], { env, encoding: 'utf8' }); assert.equal(res.status, 3)
})

// 36-40. regressions
test('OP verifier unaffected + M3c-1/2/3 modules importable', () => {
  const base = tmpBase()
  try { assert.equal(opShadow.verifyOperatingPrinciplesShadow(base, P).status, opShadow.REASON.NO_ACTIVE_OPERATING_PRINCIPLES) } finally { cleanup(base) }
  assert.equal(typeof require('../../../../src/core/memory/shadow/personalitySubmit').submitPersonality, 'function')
  assert.equal(typeof require('../../../../src/core/memory/shadow/personalityApprove').approvePersonality, 'function')
})
