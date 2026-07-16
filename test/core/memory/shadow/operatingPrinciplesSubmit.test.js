'use strict'

/**
 * operatingPrinciplesSubmit.test.js — M3b-2.
 *
 * Isolated tests for the submission tooling. All Store writes happen ONLY inside
 * temp dirs. Asserts the S0..S5 state matrix, exact --resume acknowledgement,
 * dry-run zero-write, source-commit derivation, absence of APPROVED/ACTIVATED,
 * CLI exit codes, and that writes stay confined to the target temp Store.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')
const S = require('../../../../src/core/memory/shadow/operatingPrinciplesSubmit')
const shadow = require('../../../../src/core/memory/shadow/operatingPrinciplesShadow')
const B = require('../../../../src/core/memory/shadow/behavioralMapping')
const store = require('../../../../src/core/memory/store')
const { PERSONA_IDENTITY: P } = require('../../../../src/persona/xiangxiang')
const { tmpBase, cleanup, createRev, ev } = require('../_helpers')

const R = S.REASON
const RID = S.OP_RECORD_ID
const OPS = S.OP_STORE
const REF = { submissionRef: 'OWNER-GO-M3B2-TEST', rationale: 'test submission' }

function run (base, extra = {}) {
  return S.submitOperatingPrinciples(base, Object.assign({ personaIdentity: P }, REF, extra))
}
function goodPayload () { return shadow.buildOperatingPrinciplesPayload(P) }
function events (base) { return store.listEvents(base, OPS, RID) }
function revs (base) { return store.listRevisions(base, OPS, RID) }

// --- source-of-record -------------------------------------------------------
test('source-of-record is derived from the M3a anchor, not operator input', () => {
  const sor = S.resolveSourceOfRecord(P)
  assert.equal(sor.sourceCommit, B.SOURCE_COMMIT)
  assert.equal(sor.sourceCommit, 'e90cb5bbf73203053b1f67c4a6d1468db67edbff')
})

test('--expect-source-commit mismatch -> VALIDATION_ERROR / exit 3 / zero writes', () => {
  const base = tmpBase()
  try {
    const r = run(base, { confirm: true, expectSourceCommit: '0'.repeat(40) })
    assert.equal(r.status, R.VALIDATION_ERROR)
    assert.equal(S.exitCodeFor(r.status), 3)
    assert.equal(fs.existsSync(path.join(base, OPS)), false)
  } finally { cleanup(base) }
})

// --- S0 fresh ---------------------------------------------------------------
test('S0 dry-run (no --confirm) -> DRY_RUN / exit 0 / zero writes', () => {
  const base = tmpBase()
  try {
    const r = run(base)
    assert.equal(r.status, R.DRY_RUN)
    assert.equal(r.plan, 'create-and-submit')
    assert.equal(S.exitCodeFor(r.status), 0)
    assert.equal(fs.existsSync(path.join(base, OPS)), false)
  } finally { cleanup(base) }
})

test('S0 confirmed -> SUBMITTED: one revision + one SUBMITTED event, no APPROVED/ACTIVATED', () => {
  const base = tmpBase()
  try {
    const r = run(base, { confirm: true })
    assert.equal(r.status, R.SUBMITTED)
    assert.equal(S.exitCodeFor(r.status), 0)
    // exactly one revision
    assert.equal(revs(base).length, 1)
    // exactly one event, and it is SUBMITTED_FOR_REVIEW only
    const evs = events(base)
    assert.equal(evs.length, 1)
    assert.equal(evs[0].eventType, 'SUBMITTED_FOR_REVIEW')
    const types = new Set(evs.map((e) => e.eventType))
    assert.equal(types.has('APPROVED'), false)
    assert.equal(types.has('ACTIVATED'), false)
    assert.equal(types.has('ADMITTED'), false)
    // derived state review_ready
    const st = store.resolveActiveRecord(base, OPS, RID)
    assert.equal(st.status, 'NONE') // not active (approval/activation withheld)
    // compat: M3b-1 verifier reports NOT_READY / NO_ACTIVE_REVISION / exit 4 — but submit is 0
    assert.equal(r.compat.status, shadow.REASON.NO_ACTIVE_OPERATING_PRINCIPLES)
    assert.equal(r.compat.subReason, 'NO_ACTIVE_REVISION')
    assert.equal(r.compat.exitCode, 4)
  } finally { cleanup(base) }
})

test('submitted revision stores the anchor-derived sourceCommit (not branch HEAD)', () => {
  const base = tmpBase()
  try {
    run(base, { confirm: true })
    const rev = store.getRevision(base, OPS, RID, revs(base)[0].revisionId)
    assert.ok(rev.provenance.evidence.includes(B.SOURCE_COMMIT))
    assert.equal(rev.provenance.derivedFrom, 'PERSONA_IDENTITY')
  } finally { cleanup(base) }
})

test('submitted payload byte-matches the canonical M3b-1 builder payload', () => {
  const base = tmpBase()
  try {
    run(base, { confirm: true })
    const rev = store.getRevision(base, OPS, RID, revs(base)[0].revisionId)
    const { canonicalize } = require('../../../../src/core/memory/canonical')
    assert.equal(canonicalize(rev.payload), canonicalize(goodPayload()))
    assert.equal(rev.payload.fragments.length, 8)
    assert.equal(rev.payload.fragments.some((f) => f.sourceSequence === 2), false)
  } finally { cleanup(base) }
})

// --- S1 revision-only (resume) ---------------------------------------------
// Build an S1-match state: create the revision only (no SUBMITTED event).
function makeS1 (base) { return createRev(base, OPS, RID, { payload: goodPayload() }) }

test('S1-match WITHOUT --resume -> RESUME_REQUIRED / exit 2 / zero new writes', () => {
  const base = tmpBase()
  try {
    makeS1(base)
    const before = events(base).length
    const r = run(base, { confirm: true })
    assert.equal(r.status, R.RESUME_REQUIRED)
    assert.equal(S.exitCodeFor(r.status), 2)
    assert.equal(events(base).length, before) // zero writes (still no event)
    assert.equal(revs(base).length, 1)
  } finally { cleanup(base) }
})

test('S1-match with WRONG --resume id -> RESUME_TARGET_MISMATCH / exit 2 / zero writes', () => {
  const base = tmpBase()
  try {
    makeS1(base)
    const r = run(base, { confirm: true, resumeRevisionId: 'not-the-real-id' })
    assert.equal(r.status, R.RESUME_TARGET_MISMATCH)
    assert.equal(events(base).length, 0)
    assert.equal(revs(base).length, 1)
  } finally { cleanup(base) }
})

test('S1-match with EXACT --resume dry-run -> DRY_RUN plan resume-submit / zero writes', () => {
  const base = tmpBase()
  try {
    const rev = makeS1(base)
    const r = run(base, { resumeRevisionId: rev.revisionId }) // no confirm
    assert.equal(r.status, R.DRY_RUN)
    assert.equal(r.plan, 'resume-submit')
    assert.equal(events(base).length, 0)
  } finally { cleanup(base) }
})

test('S1-match with EXACT --resume + --confirm -> RESUMED_SUBMITTED, appends SUBMITTED only, NO second revision', () => {
  const base = tmpBase()
  try {
    const rev = makeS1(base)
    const r = run(base, { confirm: true, resumeRevisionId: rev.revisionId })
    assert.equal(r.status, R.RESUMED_SUBMITTED)
    assert.equal(S.exitCodeFor(r.status), 0)
    assert.equal(revs(base).length, 1) // NO second revision
    const evs = events(base)
    assert.equal(evs.length, 1)
    assert.equal(evs[0].eventType, 'SUBMITTED_FOR_REVIEW')
    assert.equal(r.revisionId, rev.revisionId)
  } finally { cleanup(base) }
})

test('S1-MISMATCH (different payload) -> PARTIAL_PAYLOAD_MISMATCH / exit 2 / zero writes / no second revision', () => {
  const base = tmpBase()
  try {
    const bad = JSON.parse(JSON.stringify(goodPayload())); bad.fragments[0].text += 'X'; bad.aggregateSha256 = shadow.computeAggregateSha256(bad)
    const rev = createRev(base, OPS, RID, { payload: bad })
    const r = run(base, { confirm: true, resumeRevisionId: rev.revisionId })
    assert.equal(r.status, R.PARTIAL_PAYLOAD_MISMATCH)
    assert.equal(S.exitCodeFor(r.status), 2)
    assert.equal(events(base).length, 0)
    assert.equal(revs(base).length, 1)
  } finally { cleanup(base) }
})

// --- S2 already submitted ---------------------------------------------------
function makeS2 (base) {
  const rev = createRev(base, OPS, RID, { payload: goodPayload() })
  ev(base, OPS, RID, rev.revisionId, 'SUBMITTED_FOR_REVIEW', 'new')
  return rev
}

test('S2-match -> ALREADY_SUBMITTED_MATCH / exit 0 / zero new writes (idempotent)', () => {
  const base = tmpBase()
  try {
    makeS2(base)
    const evBefore = events(base).length
    const r = run(base, { confirm: true })
    assert.equal(r.status, R.ALREADY_SUBMITTED_MATCH)
    assert.equal(S.exitCodeFor(r.status), 0)
    assert.equal(events(base).length, evBefore) // no new event
    assert.equal(revs(base).length, 1)
  } finally { cleanup(base) }
})

test('S2-MISMATCH -> SUBMITTED_PAYLOAD_MISMATCH / exit 2', () => {
  const base = tmpBase()
  try {
    const bad = JSON.parse(JSON.stringify(goodPayload())); bad.classificationApprovalRef = 'OWNER-WRONG'; bad.aggregateSha256 = shadow.computeAggregateSha256(bad)
    const rev = createRev(base, OPS, RID, { payload: bad })
    ev(base, OPS, RID, rev.revisionId, 'SUBMITTED_FOR_REVIEW', 'new')
    const r = run(base, { confirm: true })
    assert.equal(r.status, R.SUBMITTED_PAYLOAD_MISMATCH)
    assert.equal(S.exitCodeFor(r.status), 2)
  } finally { cleanup(base) }
})

// --- S3 later lifecycle state ----------------------------------------------
test('S3 already APPROVED -> UNEXPECTED_LIFECYCLE_STATE / exit 2 / no new writes', () => {
  const base = tmpBase()
  try {
    const rev = createRev(base, OPS, RID, { payload: goodPayload() })
    ev(base, OPS, RID, rev.revisionId, 'SUBMITTED_FOR_REVIEW', 'new')
    ev(base, OPS, RID, rev.revisionId, 'APPROVED', 'review_ready', { approval: { approvedBy: 'l', decision: 'approved' } })
    const evBefore = events(base).length
    const r = run(base, { confirm: true })
    assert.equal(r.status, R.UNEXPECTED_LIFECYCLE_STATE)
    assert.equal(S.exitCodeFor(r.status), 2)
    assert.equal(events(base).length, evBefore)
  } finally { cleanup(base) }
})

// --- S4 multiple revisions --------------------------------------------------
test('S4 multiple revisions -> MULTIPLE_REVISIONS / exit 2 / never a third revision', () => {
  const base = tmpBase()
  try {
    createRev(base, OPS, RID, { revisionId: 'r1', payload: goodPayload() })
    createRev(base, OPS, RID, { revisionId: 'r2', supersedes: 'r1', payload: goodPayload() })
    const r = run(base, { confirm: true })
    assert.equal(r.status, R.MULTIPLE_REVISIONS)
    assert.equal(S.exitCodeFor(r.status), 2)
    assert.equal(revs(base).length, 2) // unchanged
  } finally { cleanup(base) }
})

// --- S5 corruption ----------------------------------------------------------
test('S5 corrupt target revision -> STORE_CORRUPT / exit 2', () => {
  const base = tmpBase()
  try {
    makeS1(base)
    const dir = path.join(base, OPS, 'records', RID)
    const f = fs.readdirSync(dir).find((n) => n.endsWith('.json'))
    fs.writeFileSync(path.join(dir, f), '{ broken')
    const r = run(base, { confirm: true })
    assert.equal(r.status, R.STORE_CORRUPT)
    assert.equal(S.exitCodeFor(r.status), 2)
  } finally { cleanup(base) }
})

test('S5 corrupt event -> STORE_CORRUPT', () => {
  const base = tmpBase()
  try {
    makeS2(base)
    const dir = path.join(base, OPS, 'events', RID)
    const f = fs.readdirSync(dir).find((n) => n.endsWith('.json'))
    fs.writeFileSync(path.join(dir, f), '{ broken')
    assert.equal(run(base, { confirm: true }).status, R.STORE_CORRUPT)
  } finally { cleanup(base) }
})

// --- validation / anchor ----------------------------------------------------
test('confirmed write missing --submission-ref -> VALIDATION_ERROR / exit 3 / zero writes', () => {
  const base = tmpBase()
  try {
    const r = S.submitOperatingPrinciples(base, { personaIdentity: P, rationale: 'x', confirm: true })
    assert.equal(r.status, R.VALIDATION_ERROR)
    assert.equal(S.exitCodeFor(r.status), 3)
    assert.equal(fs.existsSync(path.join(base, OPS)), false)
  } finally { cleanup(base) }
})

test('broken M3a mapping -> MAPPING_CONTRACT_ERROR / exit 3', () => {
  const base = tmpBase()
  try {
    const r = S.submitOperatingPrinciples(base, { personaIdentity: 'not-the-persona', submissionRef: 'x', rationale: 'y', confirm: true })
    assert.equal(r.status, R.MAPPING_CONTRACT_ERROR)
    assert.equal(S.exitCodeFor(r.status), 3)
  } finally { cleanup(base) }
})

// --- write confinement + no forbidden events across the whole flow ----------
test('writes stay confined to the target OP store; only SUBMITTED_FOR_REVIEW is ever emitted', () => {
  const base = tmpBase()
  try {
    run(base, { confirm: true })
    // only the operating-principles store dir was created under base
    assert.deepEqual(fs.readdirSync(base).sort(), [OPS])
    // the tool's declared emit set is exactly [SUBMITTED_FOR_REVIEW]
    assert.deepEqual(S.EMITTED_EVENT_TYPES, ['SUBMITTED_FOR_REVIEW'])
    // no identity store touched
    assert.equal(fs.existsSync(path.join(base, 'identity')), false)
  } finally { cleanup(base) }
})

// --- CLI exit codes ---------------------------------------------------------
function runCli (base, extraArgs = [], env = {}) {
  const cli = path.resolve(__dirname, '../../../../scripts/memory/submitOperatingPrinciplesShadow.js')
  const args = [cli, '--submission-ref', REF.submissionRef, '--rationale', REF.rationale].concat(extraArgs)
  const res = cp.spawnSync(process.execPath, args, { env: Object.assign({}, process.env, { AROMA_CORE_DIR: base }, env), encoding: 'utf8' })
  return { code: res.status, out: (res.stdout || '') + (res.stderr || '') }
}

test('CLI dry-run S0 -> exit 0, no writes', () => {
  const base = tmpBase()
  try {
    const r = runCli(base)
    assert.equal(r.code, 0)
    assert.ok(r.out.includes('"status":"DRY_RUN"'))
    assert.equal(fs.existsSync(path.join(base, OPS)), false)
  } finally { cleanup(base) }
})

test('CLI confirmed S0 -> exit 0 SUBMITTED; re-run without resume -> exit 2 RESUME_REQUIRED... wait: after submit it is S2', () => {
  const base = tmpBase()
  try {
    const r1 = runCli(base, ['--confirm'])
    assert.equal(r1.code, 0)
    assert.ok(r1.out.includes('"status":"SUBMITTED"'))
    // re-run: now S2-match -> idempotent success
    const r2 = runCli(base, ['--confirm'])
    assert.equal(r2.code, 0)
    assert.ok(r2.out.includes('"status":"ALREADY_SUBMITTED_MATCH"'))
  } finally { cleanup(base) }
})

test('CLI S1 without resume -> exit 2 RESUME_REQUIRED', () => {
  const base = tmpBase()
  try {
    createRev(base, OPS, RID, { payload: goodPayload() })
    const r = runCli(base, ['--confirm'])
    assert.equal(r.code, 2)
    assert.ok(r.out.includes('RESUME_REQUIRED'))
  } finally { cleanup(base) }
})

test('CLI exit 3 on missing AROMA_CORE_DIR', () => {
  const cli = path.resolve(__dirname, '../../../../scripts/memory/submitOperatingPrinciplesShadow.js')
  const env = Object.assign({}, process.env); delete env.AROMA_CORE_DIR
  const res = cp.spawnSync(process.execPath, [cli, '--confirm'], { env, encoding: 'utf8' })
  assert.equal(res.status, 3)
  assert.ok(((res.stdout || '') + (res.stderr || '')).includes('CONFIG_ERROR'))
})

test('CLI output never leaks fragment / persona text', () => {
  const base = tmpBase()
  try {
    const r = runCli(base, ['--confirm'])
    for (const leak of ['香香', '思考順序', P.slice(807, 886)]) assert.equal(r.out.includes(leak), false)
  } finally { cleanup(base) }
})
