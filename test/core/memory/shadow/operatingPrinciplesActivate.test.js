'use strict'

/**
 * operatingPrinciplesActivate.test.js — M3b-4.
 *
 * Isolated tests for the activation tool. All Store writes happen ONLY inside temp
 * dirs. Asserts the exact-chain proof, exact revision/source guards, canonical
 * rationale, fixed identity, emit-only-ACTIVATED, active resolver, shadow PASS/0,
 * runtime isolation, and CLI exit codes.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')
const AC = require('../../../../src/core/memory/shadow/operatingPrinciplesActivate')
const shadow = require('../../../../src/core/memory/shadow/operatingPrinciplesShadow')
const store = require('../../../../src/core/memory/store')
const { revisionState } = require('../../../../src/core/memory/resolver')
const { PERSONA_IDENTITY: P, buildPersonaSystem } = require('../../../../src/persona/xiangxiang')
const { tmpBase, cleanup, createRev, ev } = require('../_helpers')

const R = AC.REASON
const RID = AC.OP_RECORD_ID
const OPS = AC.OP_STORE
const ANCHOR = 'e90cb5bbf73203053b1f67c4a6d1468db67edbff'
const REF = { activationRef: 'OWNER-GO-M3B4-TEST', rationale: 'test activation' }
const goodPayload = () => shadow.buildOperatingPrinciplesPayload(P)
const events = (b) => store.listEvents(b, OPS, RID)
const revs = (b) => store.listRevisions(b, OPS, RID)

function opRevision (base, payload, over = {}) { return createRev(base, OPS, RID, { revisionId: over.revisionId, supersedes: over.supersedes || null, payload: payload || goodPayload() }) }
function opEvent (base, target, type, prev, approval) { return ev(base, OPS, RID, target, type, prev, approval ? { approval } : {}) }
function mkApproved (base, payload) {
  const r = opRevision(base, payload)
  opEvent(base, r.revisionId, 'SUBMITTED_FOR_REVIEW', 'new')
  opEvent(base, r.revisionId, 'APPROVED', 'review_ready', { approvedBy: 'Louie', decision: 'approved' })
  return r
}
function mkActive (base) { const r = mkApproved(base); opEvent(base, r.revisionId, 'ACTIVATED', 'approved'); return r }
function mkReviewReady (base) { const r = opRevision(base); opEvent(base, r.revisionId, 'SUBMITTED_FOR_REVIEW', 'new'); return r }
function badPayload () { const p = JSON.parse(JSON.stringify(goodPayload())); p.fragments[0].text += 'X'; p.aggregateSha256 = shadow.computeAggregateSha256(p); return p }

function run (base, extra = {}) { return AC.activateOperatingPrinciples(base, Object.assign({ personaIdentity: P, expectSourceCommit: ANCHOR }, REF, extra)) }

// 1. dry-run zero write
test('approved + guards, dry-run -> DRY_RUN / exit 0 / zero writes', () => {
  const base = tmpBase()
  try {
    const r0 = mkApproved(base); const before = events(base).length
    const r = AC.activateOperatingPrinciples(base, { personaIdentity: P, expectRevisionId: r0.revisionId, expectSourceCommit: ANCHOR, activationRef: REF.activationRef, rationale: REF.rationale }) // no confirm
    assert.equal(r.status, R.DRY_RUN); assert.equal(r.plan, 'activate'); assert.equal(AC.exitCodeFor(r.status), 0)
    assert.equal(events(base).length, before)
  } finally { cleanup(base) }
})

// 2-6. successful activation
test('approved exact chain + guards + confirm -> ACTIVATED; 1 rev / 3 events / active / resolver ACTIVE; shadow PASS/0; payload PASS', () => {
  const base = tmpBase()
  try {
    const r0 = mkApproved(base)
    const r = run(base, { expectRevisionId: r0.revisionId, confirm: true })
    assert.equal(r.status, R.ACTIVATED); assert.equal(AC.exitCodeFor(r.status), 0)
    assert.equal(revs(base).length, 1)
    const evs = events(base)
    assert.equal(evs.length, 3)
    assert.deepEqual(evs.map((e) => e.eventType).sort(), ['ACTIVATED', 'APPROVED', 'SUBMITTED_FOR_REVIEW'])
    assert.equal(revisionState(OPS, r0.revisionId, evs).state, 'active')
    const active = store.resolveActiveRecord(base, OPS, RID)
    assert.equal(active.status, 'ACTIVE'); assert.equal(active.revisionId, r0.revisionId)
    assert.equal(r.compat.status, shadow.REASON.PASS); assert.equal(r.compat.exitCode, 0)
    // shadow verifier directly = PASS/0
    const v = shadow.verifyOperatingPrinciplesShadow(base, P)
    assert.equal(v.status, 'PASS'); assert.equal(shadow.exitCodeFor(v.status), 0)
  } finally { cleanup(base) }
})

// 7. runtime isolation
test('activation leaves runtime byte-identical + reachability 0', () => {
  const base = tmpBase()
  try {
    const r0 = mkApproved(base)
    run(base, { expectRevisionId: r0.revisionId, confirm: true })
    assert.equal(buildPersonaSystem('X'), buildPersonaSystem('X'))
    assert.ok(buildPersonaSystem('X').includes(P))
    // static require-graph: index.js/app.js never reach core/memory
    const SRC = path.resolve(__dirname, '../../../../src')
    const resolveReq = (d, rel) => { const b = path.resolve(d, rel); for (const c of [b, b + '.js', path.join(b, 'index.js')]) { try { if (fs.statSync(c).isFile()) return c } catch (e) {} } return null }
    const reach = (entry) => { const seen = new Set(); const st = [path.resolve(entry)]; while (st.length) { const f = st.pop(); if (seen.has(f)) continue; seen.add(f); let s; try { s = fs.readFileSync(f, 'utf8') } catch (e) { continue } const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g; let m; while ((m = re.exec(s))) { const t = resolveReq(path.dirname(f), m[1]); if (t) st.push(t) } } return seen }
    for (const e of ['index.js', 'app.js']) assert.deepEqual([...reach(path.join(SRC, e))].filter((f) => /[\\/]core[\\/]memory[\\/]/.test(f)), [])
  } finally { cleanup(base) }
})

// 8. ADMITTED unreachable via tool + rejected by M1 directly
test('tool only ever emits ACTIVATED; ADMITTED is rejected by M1 for OP', () => {
  assert.deepEqual(AC.EMITTED_EVENT_TYPES, ['ACTIVATED'])
  const base = tmpBase()
  try {
    const r0 = mkApproved(base)
    assert.throws(() => store.recordEvent(base, OPS, { recordId: RID, targetRevisionId: r0.revisionId, eventType: 'ADMITTED', actor: 't', approval: null, rationale: 'r', expectedPreviousState: 'approved', timestampLabel: 'L' }),
      (e) => e.code === 'INVALID_TRANSITION' || e.code === 'VALIDATION_ERROR')
  } finally { cleanup(base) }
})

// 9. revision guard
test('missing / wrong --expect-revision-id -> REVISION_TARGET_MISMATCH / exit 2 / zero writes', () => {
  const base = tmpBase()
  try {
    const r0 = mkApproved(base)
    assert.equal(run(base, { confirm: true }).status, R.REVISION_TARGET_MISMATCH)
    assert.equal(run(base, { confirm: true, expectRevisionId: 'nope' }).status, R.REVISION_TARGET_MISMATCH)
    assert.equal(events(base).length, 2) // still only SUBMITTED+APPROVED
    assert.ok(r0)
  } finally { cleanup(base) }
})

// 10. source-commit guard
test('missing --expect-source-commit on --confirm -> VALIDATION_ERROR / exit 3', () => {
  const base = tmpBase()
  try {
    const r0 = mkApproved(base)
    const r = AC.activateOperatingPrinciples(base, { personaIdentity: P, expectRevisionId: r0.revisionId, activationRef: REF.activationRef, rationale: REF.rationale, confirm: true })
    assert.equal(r.status, R.VALIDATION_ERROR); assert.equal(r.detail, 'expect-source-commit-required'); assert.equal(AC.exitCodeFor(r.status), 3)
    assert.equal(events(base).length, 2)
  } finally { cleanup(base) }
})
test('wrong --expect-source-commit -> VALIDATION_ERROR / exit 3', () => {
  const base = tmpBase()
  try {
    const r0 = mkApproved(base)
    const r = run(base, { confirm: true, expectRevisionId: r0.revisionId, expectSourceCommit: '0'.repeat(40) })
    assert.equal(r.status, R.VALIDATION_ERROR); assert.equal(r.detail, 'expect-source-commit-mismatch')
  } finally { cleanup(base) }
})

// 11. review_ready / new -> NOT_APPROVED
test('review_ready -> NOT_APPROVED; new -> NOT_APPROVED', () => {
  let base = tmpBase()
  try { const r0 = mkReviewReady(base); assert.equal(run(base, { confirm: true, expectRevisionId: r0.revisionId }).status, R.NOT_APPROVED) } finally { cleanup(base) }
  base = tmpBase()
  try { const r0 = opRevision(base); assert.equal(run(base, { confirm: true, expectRevisionId: r0.revisionId }).status, R.NOT_APPROVED) } finally { cleanup(base) }
})

// 12. active exact match idempotent zero-write
test('active exact match -> ALREADY_ACTIVE_MATCH / exit 0 / zero new writes', () => {
  const base = tmpBase()
  try {
    const r0 = mkActive(base); const before = events(base).length
    const r = run(base, { confirm: true, expectRevisionId: r0.revisionId })
    assert.equal(r.status, R.ALREADY_ACTIVE_MATCH); assert.equal(AC.exitCodeFor(r.status), 0)
    assert.equal(events(base).length, before)
  } finally { cleanup(base) }
})

// 13. active but extra/duplicate event -> fail closed (NOT already-active)
test('active with a duplicate ACTIVATED -> CHAIN_PROOF_FAILED (never ALREADY_ACTIVE_MATCH)', () => {
  const base = tmpBase()
  try {
    const r0 = mkActive(base)
    // forge an extra ACTIVATED-like event file by copying the existing one (duplicate eventType, different id)
    const edir = path.join(base, OPS, 'events', RID)
    const files = fs.readdirSync(edir).filter((n) => n.endsWith('.json'))
    const actFile = files.map((f) => ({ f, o: JSON.parse(fs.readFileSync(path.join(edir, f), 'utf8')) })).find((x) => x.o.eventType === 'ACTIVATED')
    const dup = Object.assign({}, actFile.o, { eventId: 'dup-activated', sequence: 99 })
    // recompute a valid eventHash so it is not "corrupt", just an extra event
    const { hashOf } = require('../../../../src/core/memory/canonical')
    delete dup.eventHash; dup.eventHash = hashOf(dup, 'eventHash')
    fs.writeFileSync(path.join(edir, 'dup-activated.json'), JSON.stringify(dup))
    const r = run(base, { confirm: true, expectRevisionId: r0.revisionId })
    assert.equal(r.status, R.CHAIN_PROOF_FAILED); assert.equal(AC.exitCodeFor(r.status), 2)
  } finally { cleanup(base) }
})

// 14. active payload mismatch
test('active with mismatched payload -> ACTIVE_PAYLOAD_MISMATCH / exit 2', () => {
  const base = tmpBase()
  try {
    const r0 = opRevision(base, badPayload())
    opEvent(base, r0.revisionId, 'SUBMITTED_FOR_REVIEW', 'new')
    opEvent(base, r0.revisionId, 'APPROVED', 'review_ready', { approvedBy: 'Louie', decision: 'approved' })
    opEvent(base, r0.revisionId, 'ACTIVATED', 'approved')
    const r = run(base, { confirm: true, expectRevisionId: r0.revisionId })
    assert.equal(r.status, R.ACTIVE_PAYLOAD_MISMATCH); assert.equal(AC.exitCodeFor(r.status), 2)
  } finally { cleanup(base) }
})

// 15. ambiguous active
test('ambiguous active -> AMBIGUOUS_ACTIVE / exit 2', () => {
  const base = tmpBase()
  try {
    const a = opRevision(base, goodPayload(), { revisionId: 'a' }); opEvent(base, 'a', 'SUBMITTED_FOR_REVIEW', 'new'); opEvent(base, 'a', 'APPROVED', 'review_ready', { approvedBy: 'l', decision: 'approved' }); opEvent(base, 'a', 'ACTIVATED', 'approved')
    const b2 = opRevision(base, goodPayload(), { revisionId: 'b', supersedes: 'a' }); opEvent(base, 'b', 'SUBMITTED_FOR_REVIEW', 'new'); opEvent(base, 'b', 'APPROVED', 'review_ready', { approvedBy: 'l', decision: 'approved' }); opEvent(base, 'b', 'ACTIVATED', 'approved')
    assert.equal(run(base, { confirm: true, expectRevisionId: 'a' }).status, R.AMBIGUOUS_ACTIVE)
    assert.ok(b2)
  } finally { cleanup(base) }
})

// 16. multiple revisions (non-active)
test('multiple revisions -> MULTIPLE_REVISIONS / exit 2', () => {
  const base = tmpBase()
  try {
    opRevision(base, goodPayload(), { revisionId: 'r1' })
    opRevision(base, goodPayload(), { revisionId: 'r2', supersedes: 'r1' })
    assert.equal(run(base, { confirm: true, expectRevisionId: 'r1' }).status, R.MULTIPLE_REVISIONS)
  } finally { cleanup(base) }
})

// 17. corrupt revision/event
test('corrupt target revision -> STORE_CORRUPT / exit 2', () => {
  const base = tmpBase()
  try {
    const r0 = mkApproved(base)
    const dir = path.join(base, OPS, 'records', RID); const f = fs.readdirSync(dir).find((n) => n.endsWith('.json'))
    fs.writeFileSync(path.join(dir, f), '{ broken')
    assert.equal(run(base, { confirm: true, expectRevisionId: r0.revisionId }).status, R.STORE_CORRUPT)
  } finally { cleanup(base) }
})

// 18. contaminated payload on approved -> PAYLOAD_IDENTITY_FAILED
test('approved with contaminated payload -> PAYLOAD_IDENTITY_FAILED / exit 2 / no ACTIVATED', () => {
  const base = tmpBase()
  try {
    const r0 = mkApproved(base, badPayload())
    const r = run(base, { confirm: true, expectRevisionId: r0.revisionId })
    assert.equal(r.status, R.PAYLOAD_IDENTITY_FAILED); assert.equal(AC.exitCodeFor(r.status), 2)
    assert.equal(events(base).length, 2)
  } finally { cleanup(base) }
})

// 19. deprecated/superseded/rejected -> UNEXPECTED_LIFECYCLE_STATE
test('approved-then-deprecated -> UNEXPECTED_LIFECYCLE_STATE / exit 2', () => {
  const base = tmpBase()
  try {
    const r0 = mkApproved(base)
    opEvent(base, r0.revisionId, 'DEPRECATED', 'approved')
    assert.equal(run(base, { confirm: true, expectRevisionId: r0.revisionId }).status, R.UNEXPECTED_LIFECYCLE_STATE)
  } finally { cleanup(base) }
})

// 20-22. fixed actor / canonical rationale
test('confirmed ACTIVATED has fixed actor + canonical JSON rationale (round-trips; fixed identity)', () => {
  const base = tmpBase()
  try {
    const r0 = mkApproved(base)
    run(base, { confirm: true, expectRevisionId: r0.revisionId })
    const act = events(base).find((e) => e.eventType === 'ACTIVATED')
    assert.equal(act.actor, 'Louie')
    assert.equal(act.approval, null)
    const parsed = JSON.parse(act.rationale) // round-trip
    assert.equal(parsed.activatedBy, 'Louie')
    assert.equal(parsed.activationSource, 'owner-authorized-activation')
    assert.equal(parsed.activationRef, REF.activationRef)
    assert.equal(parsed.reason, REF.rationale)
    // canonical: stable key order (sorted)
    assert.equal(act.rationale, JSON.stringify({ activatedBy: 'Louie', activationRef: REF.activationRef, activationSource: 'owner-authorized-activation', reason: REF.rationale }))
  } finally { cleanup(base) }
})
test('rogue caller cannot inject activatedBy / activationSource / actor', () => {
  const base = tmpBase()
  try {
    const r0 = mkApproved(base)
    AC.activateOperatingPrinciples(base, { personaIdentity: P, expectRevisionId: r0.revisionId, expectSourceCommit: ANCHOR, activationRef: REF.activationRef, rationale: REF.rationale, confirm: true, activatedBy: 'attacker', activationSource: 'x', actor: 'x' })
    const act = events(base).find((e) => e.eventType === 'ACTIVATED')
    const parsed = JSON.parse(act.rationale)
    assert.equal(act.actor, 'Louie'); assert.equal(parsed.activatedBy, 'Louie'); assert.equal(parsed.activationSource, 'owner-authorized-activation')
  } finally { cleanup(base) }
})
test('buildActivationRationale is deterministic canonical JSON (round-trip)', () => {
  const s = AC.buildActivationRationale('REF-1', 'why')
  assert.equal(s, JSON.stringify({ activatedBy: 'Louie', activationRef: 'REF-1', activationSource: 'owner-authorized-activation', reason: 'why' }))
  assert.deepEqual(JSON.parse(s), { activatedBy: 'Louie', activationRef: 'REF-1', activationSource: 'owner-authorized-activation', reason: 'why' })
})

// broken mapping
test('broken M3a mapping -> MAPPING_CONTRACT_ERROR / exit 3', () => {
  const base = tmpBase()
  try {
    mkApproved(base)
    const r = AC.activateOperatingPrinciples(base, { personaIdentity: 'not-persona', expectRevisionId: 'x', expectSourceCommit: ANCHOR, activationRef: 'r', rationale: 'y', confirm: true })
    assert.equal(r.status, R.MAPPING_CONTRACT_ERROR); assert.equal(AC.exitCodeFor(r.status), 3)
  } finally { cleanup(base) }
})

// 23-24. CLI
function runCli (base, extraArgs = [], env = {}) {
  const cli = path.resolve(__dirname, '../../../../scripts/memory/activateOperatingPrinciplesShadow.js')
  const args = [cli, '--activation-ref', REF.activationRef, '--rationale', REF.rationale].concat(extraArgs)
  const res = cp.spawnSync(process.execPath, args, { env: Object.assign({}, process.env, { AROMA_CORE_DIR: base }, env), encoding: 'utf8' })
  return { code: res.status, out: (res.stdout || '') + (res.stderr || '') }
}
test('CLI dry-run -> exit 0; confirmed -> exit 0 ACTIVATED; re-run -> ALREADY_ACTIVE_MATCH; no leak', () => {
  const base = tmpBase()
  try {
    const r0 = mkApproved(base)
    const d = runCli(base, ['--expect-revision-id', r0.revisionId, '--expect-source-commit', ANCHOR])
    assert.equal(d.code, 0); assert.ok(d.out.includes('"status":"DRY_RUN"'))
    const c = runCli(base, ['--expect-revision-id', r0.revisionId, '--expect-source-commit', ANCHOR, '--confirm'])
    assert.equal(c.code, 0); assert.ok(c.out.includes('"status":"ACTIVATED"'))
    const again = runCli(base, ['--expect-revision-id', r0.revisionId, '--expect-source-commit', ANCHOR, '--confirm'])
    assert.equal(again.code, 0); assert.ok(again.out.includes('ALREADY_ACTIVE_MATCH'))
    for (const leak of ['香香', '思考順序', P.slice(807, 886)]) assert.equal(c.out.includes(leak), false)
  } finally { cleanup(base) }
})
test('CLI review_ready + confirm -> exit 2 NOT_APPROVED; missing AROMA_CORE_DIR -> exit 3', () => {
  const base = tmpBase()
  try {
    const r0 = mkReviewReady(base)
    const r = runCli(base, ['--expect-revision-id', r0.revisionId, '--expect-source-commit', ANCHOR, '--confirm'])
    assert.equal(r.code, 2); assert.ok(r.out.includes('NOT_APPROVED'))
  } finally { cleanup(base) }
  const cli = path.resolve(__dirname, '../../../../scripts/memory/activateOperatingPrinciplesShadow.js')
  const env = Object.assign({}, process.env); delete env.AROMA_CORE_DIR
  const res = cp.spawnSync(process.execPath, [cli, '--confirm'], { env, encoding: 'utf8' })
  assert.equal(res.status, 3); assert.ok(((res.stdout || '') + (res.stderr || '')).includes('CONFIG_ERROR'))
})
