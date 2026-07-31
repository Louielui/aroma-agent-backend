'use strict'

/**
 * operatingPrinciplesApprove.test.js — M3b-3.
 *
 * Isolated tests for the approval tool. All Store writes happen ONLY inside temp
 * dirs. Asserts the state matrix, fixed approval identity, exact --expect-revision-id,
 * dry-run zero-write, payload re-proof before approving, absence of ACTIVATED, the
 * post-approve APPROVED_NOT_ACTIVE compat, and CLI exit codes.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')
const AP = require('../../../../src/core/memory/shadow/operatingPrinciplesApprove')
const shadow = require('../../../../src/core/memory/shadow/operatingPrinciplesShadow')
const store = require('../../../../src/core/memory/store')
const { revisionState } = require('../../../../src/core/memory/resolver')
const { PERSONA_IDENTITY: P } = require('../../../../src/persona/xiangxiang')
const { tmpBase, cleanup, createRev, ev } = require('../_helpers')

const R = AP.REASON
const RID = AP.OP_RECORD_ID
const OPS = AP.OP_STORE
const REF = { approvalRef: 'OWNER-GO-M3B3-TEST', rationale: 'test approval' }
const goodPayload = () => shadow.buildOperatingPrinciplesPayload(P)
const events = (b) => store.listEvents(b, OPS, RID)
const revs = (b) => store.listRevisions(b, OPS, RID)

function opRevision (base, payload, over = {}) {
  return createRev(base, OPS, RID, { revisionId: over.revisionId, supersedes: over.supersedes || null, payload: payload || goodPayload() })
}
function opEvent (base, target, type, prev, approval) { return ev(base, OPS, RID, target, type, prev, approval ? { approval } : {}) }
function mkReviewReady (base, payload) { const r = opRevision(base, payload); opEvent(base, r.revisionId, 'SUBMITTED_FOR_REVIEW', 'new'); return r }
function mkApproved (base) { const r = mkReviewReady(base); opEvent(base, r.revisionId, 'APPROVED', 'review_ready', { approvedBy: 'Louie', decision: 'approved', approvalSource: 'owner-authorized-approval' }); return r }
function mkActive (base) { const r = mkApproved(base); opEvent(base, r.revisionId, 'ACTIVATED', 'approved'); return r }

function run (base, extra = {}) { return AP.approveOperatingPrinciples(base, Object.assign({ personaIdentity: P }, REF, extra)) }
function badPayload () { const p = JSON.parse(JSON.stringify(goodPayload())); p.fragments[0].text += 'X'; p.aggregateSha256 = shadow.computeAggregateSha256(p); return p }

// --- DRY-RUN + approve (happy path) -----------------------------------------
test('review_ready + exact --expect-revision-id, dry-run -> DRY_RUN plan approve / zero writes', () => {
  const base = tmpBase()
  try {
    const r0 = mkReviewReady(base)
    const before = events(base).length
    const r = run(base, { expectRevisionId: r0.revisionId }) // no confirm
    assert.equal(r.status, R.DRY_RUN); assert.equal(r.plan, 'approve'); assert.equal(AP.exitCodeFor(r.status), 0)
    assert.equal(events(base).length, before) // zero writes
  } finally { cleanup(base) }
})

test('review_ready + exact --expect-revision-id + --confirm -> APPROVED (fixed identity, no ACTIVATED)', () => {
  const base = tmpBase()
  try {
    const r0 = mkReviewReady(base)
    const r = run(base, { expectRevisionId: r0.revisionId, confirm: true })
    assert.equal(r.status, R.APPROVED); assert.equal(AP.exitCodeFor(r.status), 0)
    assert.equal(revs(base).length, 1) // no new revision
    const evs = events(base)
    assert.equal(evs.length, 2)
    assert.deepEqual(evs.map((e) => e.eventType).sort(), ['APPROVED', 'SUBMITTED_FOR_REVIEW'])
    // fixed approval identity
    const ap = evs.find((e) => e.eventType === 'APPROVED').approval
    assert.equal(ap.approvedBy, 'Louie'); assert.equal(ap.approvalSource, 'owner-authorized-approval'); assert.equal(ap.decision, 'approved')
    assert.equal(ap.reviewRef, REF.approvalRef)
    // derived state approved; resolver NONE (not active)
    assert.equal(revisionState(OPS, r0.revisionId, evs).state, 'approved')
    assert.equal(store.resolveActiveRecord(base, OPS, RID).status, 'NONE')
    // no ACTIVATED/ADMITTED
    const types = new Set(evs.map((e) => e.eventType))
    assert.equal(types.has('ACTIVATED'), false); assert.equal(types.has('ADMITTED'), false)
    // compat = APPROVED_NOT_ACTIVE / exit 4 (but approve itself is exit 0)
    assert.equal(r.compat.status, shadow.REASON.NO_ACTIVE_OPERATING_PRINCIPLES)
    assert.equal(r.compat.subReason, 'APPROVED_NOT_ACTIVE')
    assert.equal(r.compat.exitCode, 4)
  } finally { cleanup(base) }
})

test('caller cannot inject approval identity — it is fixed', () => {
  const base = tmpBase()
  try {
    const r0 = mkReviewReady(base)
    // even if a caller passed rogue fields, the tool ignores them (no such opts exist)
    run(base, { expectRevisionId: r0.revisionId, confirm: true, approvedBy: 'attacker', approvalSource: 'x', decision: 'y' })
    const ap = events(base).find((e) => e.eventType === 'APPROVED').approval
    assert.equal(ap.approvedBy, 'Louie'); assert.equal(ap.approvalSource, 'owner-authorized-approval'); assert.equal(ap.decision, 'approved')
  } finally { cleanup(base) }
})

// --- guards -----------------------------------------------------------------
test('review_ready WITHOUT --expect-revision-id -> REVISION_TARGET_MISMATCH / exit 2 / zero writes', () => {
  const base = tmpBase()
  try {
    mkReviewReady(base)
    const r = run(base, { confirm: true })
    assert.equal(r.status, R.REVISION_TARGET_MISMATCH); assert.equal(AP.exitCodeFor(r.status), 2)
    assert.equal(events(base).length, 1) // still only SUBMITTED
  } finally { cleanup(base) }
})

test('review_ready with WRONG --expect-revision-id -> REVISION_TARGET_MISMATCH / zero writes', () => {
  const base = tmpBase()
  try {
    mkReviewReady(base)
    const r = run(base, { confirm: true, expectRevisionId: 'not-the-id' })
    assert.equal(r.status, R.REVISION_TARGET_MISMATCH)
    assert.equal(events(base).length, 1)
  } finally { cleanup(base) }
})

test('confirmed approve missing --approval-ref -> VALIDATION_ERROR / exit 3 / zero writes', () => {
  const base = tmpBase()
  try {
    const r0 = mkReviewReady(base)
    const r = AP.approveOperatingPrinciples(base, { personaIdentity: P, rationale: 'x', confirm: true, expectRevisionId: r0.revisionId })
    assert.equal(r.status, R.VALIDATION_ERROR); assert.equal(AP.exitCodeFor(r.status), 3)
    assert.equal(events(base).length, 1)
  } finally { cleanup(base) }
})

test('review_ready with corrupted payload -> PAYLOAD_IDENTITY_FAILED / exit 2 (never approve bad content)', () => {
  const base = tmpBase()
  try {
    const r0 = mkReviewReady(base, badPayload())
    const r = run(base, { confirm: true, expectRevisionId: r0.revisionId })
    assert.equal(r.status, R.PAYLOAD_IDENTITY_FAILED); assert.equal(AP.exitCodeFor(r.status), 2)
    assert.equal(events(base).length, 1) // no APPROVED written
  } finally { cleanup(base) }
})

// --- state matrix refusals --------------------------------------------------
test('new (submitted absent) -> NOT_SUBMITTED / exit 2', () => {
  const base = tmpBase()
  try {
    opRevision(base) // revision only, no SUBMITTED event
    const r = run(base, { confirm: true, expectRevisionId: revs(base)[0].revisionId })
    assert.equal(r.status, R.NOT_SUBMITTED); assert.equal(AP.exitCodeFor(r.status), 2)
    assert.equal(events(base).length, 0)
  } finally { cleanup(base) }
})

test('no store / no revision -> NOT_SUBMITTED', () => {
  const base = tmpBase()
  try { assert.equal(run(base, { confirm: true, expectRevisionId: 'x' }).status, R.NOT_SUBMITTED) } finally { cleanup(base) }
})

test('already approved (matching) -> ALREADY_APPROVED_MATCH / exit 0 / zero new writes', () => {
  const base = tmpBase()
  try {
    const r0 = mkApproved(base)
    const before = events(base).length
    const r = run(base, { confirm: true, expectRevisionId: r0.revisionId })
    assert.equal(r.status, R.ALREADY_APPROVED_MATCH); assert.equal(AP.exitCodeFor(r.status), 0)
    assert.equal(events(base).length, before) // no new event
  } finally { cleanup(base) }
})

test('already approved with mismatched payload -> APPROVED_PAYLOAD_MISMATCH / exit 2', () => {
  const base = tmpBase()
  try {
    const r0 = opRevision(base, badPayload())
    opEvent(base, r0.revisionId, 'SUBMITTED_FOR_REVIEW', 'new')
    opEvent(base, r0.revisionId, 'APPROVED', 'review_ready', { approvedBy: 'Louie', decision: 'approved' })
    const r = run(base, { confirm: true, expectRevisionId: r0.revisionId })
    assert.equal(r.status, R.APPROVED_PAYLOAD_MISMATCH); assert.equal(AP.exitCodeFor(r.status), 2)
  } finally { cleanup(base) }
})

test('active / later state -> UNEXPECTED_LIFECYCLE_STATE / exit 2 / no new writes', () => {
  const base = tmpBase()
  try {
    const r0 = mkActive(base)
    const before = events(base).length
    const r = run(base, { confirm: true, expectRevisionId: r0.revisionId })
    assert.equal(r.status, R.UNEXPECTED_LIFECYCLE_STATE); assert.equal(AP.exitCodeFor(r.status), 2)
    assert.equal(events(base).length, before)
  } finally { cleanup(base) }
})

test('multiple revisions -> MULTIPLE_REVISIONS / exit 2', () => {
  const base = tmpBase()
  try {
    opRevision(base, goodPayload(), { revisionId: 'r1' })
    opRevision(base, goodPayload(), { revisionId: 'r2', supersedes: 'r1' })
    assert.equal(run(base, { confirm: true, expectRevisionId: 'r1' }).status, R.MULTIPLE_REVISIONS)
  } finally { cleanup(base) }
})

test('corrupt target revision/event -> STORE_CORRUPT / exit 2', () => {
  const base = tmpBase()
  try {
    const r0 = mkReviewReady(base)
    const dir = path.join(base, OPS, 'records', RID)
    const f = fs.readdirSync(dir).find((n) => n.endsWith('.json'))
    fs.writeFileSync(path.join(dir, f), '{ broken')
    assert.equal(run(base, { confirm: true, expectRevisionId: r0.revisionId }).status, R.STORE_CORRUPT)
  } finally { cleanup(base) }
})

// --- anchor / mapping -------------------------------------------------------
test('--expect-source-commit mismatch -> VALIDATION_ERROR / exit 3 / zero writes', () => {
  const base = tmpBase()
  try {
    const r0 = mkReviewReady(base)
    const r = run(base, { confirm: true, expectRevisionId: r0.revisionId, expectSourceCommit: '0'.repeat(40) })
    assert.equal(r.status, R.VALIDATION_ERROR); assert.equal(AP.exitCodeFor(r.status), 3)
    assert.equal(events(base).length, 1)
  } finally { cleanup(base) }
})

test('broken M3a mapping -> MAPPING_CONTRACT_ERROR / exit 3', () => {
  const base = tmpBase()
  try {
    mkReviewReady(base)
    const r = AP.approveOperatingPrinciples(base, { personaIdentity: 'not-persona', approvalRef: 'x', rationale: 'y', confirm: true, expectRevisionId: 'z' })
    assert.equal(r.status, R.MAPPING_CONTRACT_ERROR); assert.equal(AP.exitCodeFor(r.status), 3)
  } finally { cleanup(base) }
})

// --- only APPROVED is ever emitted ------------------------------------------
test('the tool only ever emits APPROVED', () => {
  assert.deepEqual(AP.EMITTED_EVENT_TYPES, ['APPROVED'])
})

// --- CLI exit codes ---------------------------------------------------------
function runCli (base, extraArgs = [], env = {}) {
  const cli = path.resolve(__dirname, '../../../../scripts/memory/approveOperatingPrinciplesShadow.js')
  const args = [cli, '--approval-ref', REF.approvalRef, '--rationale', REF.rationale].concat(extraArgs)
  const res = cp.spawnSync(process.execPath, args, { env: Object.assign({}, process.env, { AROMA_CORE_DIR: base }, env), encoding: 'utf8' })
  return { code: res.status, out: (res.stdout || '') + (res.stderr || '') }
}

test('CLI dry-run review_ready -> exit 0 DRY_RUN, no writes', () => {
  const base = tmpBase()
  try {
    const r0 = mkReviewReady(base)
    const r = runCli(base, ['--expect-revision-id', r0.revisionId])
    assert.equal(r.code, 0); assert.ok(r.out.includes('"status":"DRY_RUN"'))
    assert.equal(events(base).length, 1)
  } finally { cleanup(base) }
})

test('CLI confirmed -> exit 0 APPROVED; re-run -> exit 0 ALREADY_APPROVED_MATCH', () => {
  const base = tmpBase()
  try {
    const r0 = mkReviewReady(base)
    const r1 = runCli(base, ['--expect-revision-id', r0.revisionId, '--confirm'])
    assert.equal(r1.code, 0); assert.ok(r1.out.includes('"status":"APPROVED"'))
    const r2 = runCli(base, ['--expect-revision-id', r0.revisionId, '--confirm'])
    assert.equal(r2.code, 0); assert.ok(r2.out.includes('ALREADY_APPROVED_MATCH'))
  } finally { cleanup(base) }
})

test('CLI review_ready without --expect-revision-id + --confirm -> exit 2', () => {
  const base = tmpBase()
  try {
    mkReviewReady(base)
    const r = runCli(base, ['--confirm'])
    assert.equal(r.code, 2); assert.ok(r.out.includes('REVISION_TARGET_MISMATCH'))
  } finally { cleanup(base) }
})

test('CLI exit 3 on missing AROMA_CORE_DIR', () => {
  const cli = path.resolve(__dirname, '../../../../scripts/memory/approveOperatingPrinciplesShadow.js')
  const env = Object.assign({}, process.env); delete env.AROMA_CORE_DIR
  const res = cp.spawnSync(process.execPath, [cli, '--confirm'], { env, encoding: 'utf8' })
  assert.equal(res.status, 3); assert.ok(((res.stdout || '') + (res.stderr || '')).includes('CONFIG_ERROR'))
})

test('CLI output never leaks fragment / persona text', () => {
  const base = tmpBase()
  try {
    const r0 = mkReviewReady(base)
    const r = runCli(base, ['--expect-revision-id', r0.revisionId, '--confirm'])
    for (const leak of ['香香', '思考順序', P.slice(807, 886)]) assert.equal(r.out.includes(leak), false)
  } finally { cleanup(base) }
})
