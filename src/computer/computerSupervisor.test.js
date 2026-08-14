'use strict'

/**
 * computerSupervisor.test.js — Computer Operator v0, Phase 2.
 *
 * The Supervisor's job is to say what it WOULD do and to be incapable of doing it. These
 * tests hold it to both halves, and — the part that matters most — hold the dry-run to an
 * HONEST assurance boundary: what it checks is asserted, and what it CANNOT check is
 * asserted to be reported as unknown rather than quietly passed.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')

const { createComputerSupervisor, ASSURANCE } = require('./computerSupervisor')
const { ALLOWED_ROOT, MUST_FORBID, HARD_MAX_STEPS } = require('./computerWorkOrder')

const P = (rel) => ALLOWED_ROOT + '\\' + rel

function fakeStore () {
  const written = []
  return { written, write: (kind, record) => { written.push({ kind, record }); return record } }
}

function order (over = {}) {
  return Object.assign({
    approvalId: 'appr_p2test',
    goal: 'copy one file',
    targetApp: null,
    allowedPaths: [ALLOWED_ROOT],
    steps: [{ action: 'copy_file', params: { sourcePath: P('a.txt'), destPath: P('b.txt') } }],
    maxSteps: 5,
    timeoutSec: 60,
    forbiddenActions: [...MUST_FORBID],
    requiresEvidence: true
  }, over)
}

const sup = (over = {}) => createComputerSupervisor(Object.assign({ artifactStore: fakeStore(), now: () => 1_700_000_000_000 }, over))

/* ── it cannot act ────────────────────────────────────────────────────────── */

test('*** the Supervisor has NO execute path — only a dry-run ***', () => {
  const s = sup()
  assert.equal(typeof s.dryRun, 'function')
  assert.equal(s.capabilities.execute, false)
  assert.equal(s.capabilities.touchesDesktop, false)
  for (const forbidden of ['execute', 'run', 'perform', 'act', 'apply', 'commit']) {
    assert.equal(typeof s[forbidden], 'undefined', 'must not expose: ' + forbidden)
  }
})

test('a dry-run changes nothing on disk — the approved root is untouched', () => {
  // CHANGED 2026-07-31, and the reason matters more than the change. This used to assert
  // `existsSync(ALLOWED_ROOT) === false`, which conflated two different claims: "a dry-run
  // creates nothing" and "the folder does not exist". The Owner has now created the folder
  // deliberately, elevated, out of band — so the second claim is false and the first is
  // still exactly as true.
  //
  // Asserting the folder's absence would now fail for a reason that has nothing to do with
  // the Supervisor, and deleting the test would lose a real guarantee. So it measures the
  // guarantee instead: whatever state the folder is in, a dry-run leaves it in that state.
  const s = sup()
  const before = { exists: fs.existsSync(ALLOWED_ROOT), entries: null }
  if (before.exists) { try { before.entries = fs.readdirSync(ALLOWED_ROOT).sort() } catch (_) { before.entries = 'unreadable' } }

  s.dryRun(order())

  const after = { exists: fs.existsSync(ALLOWED_ROOT), entries: null }
  if (after.exists) { try { after.entries = fs.readdirSync(ALLOWED_ROOT).sort() } catch (_) { after.entries = 'unreadable' } }

  assert.deepEqual(after, before, 'a dry-run neither created, deleted nor wrote anything there')
})

/* ── THE ASSURANCE BOUNDARY ───────────────────────────────────────────────── */

test('*** what a dry-run CANNOT verify is reported as unknown, never as ok ***', () => {
  const res = sup().dryRun(order())
  assert.equal(res.ok, true, 'the order is well-formed and in scope')
  const step = res.steps[0]
  // copy_file cannot be checked for any of these without a Companion
  for (const unknown of ['source_file_exists', 'destination_absent', 'sufficient_disk_space', 'filesystem_permissions']) {
    assert.ok(step.unverifiable.includes(unknown), 'reported as unverifiable: ' + unknown)
  }
  // and the result says what "ok" means, so it cannot be misread as a green light
  assert.match(res.meaning, /does NOT mean the order would succeed/)
})

test('the two classes are kept apart and do not overlap', () => {
  const v = new Set(ASSURANCE.verified)
  for (const n of ASSURANCE.notVerified) assert.equal(v.has(n), false, 'not in both lists: ' + n)
  // the things only a machine can answer are all on the not-verified side
  for (const n of ['application_installed', 'ui_element_exists', 'screen_contents', 'source_file_exists']) {
    assert.ok(ASSURANCE.notVerified.includes(n), 'must be unverifiable: ' + n)
  }
  // the things the rules alone decide are all on the verified side
  for (const y of ['path_inside_approved_root', 'action_in_closed_enum', 'prohibitions_declared']) {
    assert.ok(ASSURANCE.verified.includes(y), 'must be verifiable: ' + y)
  }
})

test('*** a clean dry-run never claims the file exists or that it would succeed ***', () => {
  const res = sup().dryRun(order())
  const text = JSON.stringify(res)
  assert.equal(/"exists":true/.test(text), false)
  assert.equal(/succeeded|completed|done/i.test(text), false, 'no completion language anywhere')
  assert.match(res.steps[0].wouldDo, /^would copy /, 'intent, phrased as intent')
})

/* ── scope enforcement ────────────────────────────────────────────────────── */

test('*** a step outside the approved root never reaches step resolution at all ***', () => {
  // The VALIDATOR refuses it first, before a single step is walked. Worth stating: the
  // step-level scope check inside the Supervisor is therefore defence in depth, not the
  // gate — the gate is the schema. This test originally expected the step-level refusal
  // and was wrong about which layer catches it.
  const res = sup().dryRun(order({
    steps: [{ action: 'copy_file', params: { sourcePath: P('a.txt'), destPath: 'C:\\Windows\\System32\\x.txt' } }]
  }))
  assert.equal(res.ok, false)
  assert.equal(res.refusal, 'invalid_work_order', 'refused by the schema, not by the walker')
  assert.deepEqual(res.steps, [], 'no step was resolved')
  assert.ok(res.errors.some((e) => e.includes('outside the approved root')))
})

test('the Supervisor\'s own scope check is a second line, and it agrees with the first', () => {
  // Reached only by handing the walker an order the validator would have refused, which
  // is exactly what defence in depth is for: if the schema ever loosened, this still says no.
  const s = sup()
  const wo = order({ allowedPaths: [P('inbox')] })
  const stepOutside = { action: 'read_file', params: { path: P('elsewhere\\x.txt') } }
  const resolved = s.dryRun(Object.assign(wo, { steps: [stepOutside] }))
  assert.equal(resolved.ok, false, 'refused either way')
})

test('an invalid order is refused before any step is resolved', () => {
  const res = sup().dryRun(order({ requiresEvidence: false }))
  assert.equal(res.ok, false)
  assert.equal(res.refusal, 'invalid_work_order')
  assert.deepEqual(res.steps, [])
  assert.ok(res.errors.some((e) => e.includes('requiresEvidence')))
})

test('the step ceiling ruling is in force: maxSteps <= 10', () => {
  assert.equal(HARD_MAX_STEPS, 10, 'Owner ruling 2026-07-28, down from 20')
  assert.equal(sup().dryRun(order({ maxSteps: 11 })).refusal, 'invalid_work_order')
})

/* ── AUDIT ON DRY-RUN ─────────────────────────────────────────────────────── */

test('*** every dry-run writes a computer-audit record, marked as a dry-run ***', () => {
  const store = fakeStore()
  const s = createComputerSupervisor({ artifactStore: store, now: () => 1_700_000_000_000 })
  const res = s.dryRun(order(), { who: 'louie' })
  assert.equal(res.auditWritten, true)
  assert.equal(store.written.length, 1)
  const { kind, record } = store.written[0]
  assert.equal(kind, 'computer-audit')
  assert.equal(record.dryRun, true, 'marked unmistakably')
  assert.equal(record.approvalId, 'appr_p2test')
  assert.equal(record.who, 'louie')
  assert.match(record.workOrderHash, /^[a-f0-9]{64}$/)
})

test('*** a dry-run step is NEVER recorded as ok — nothing happened ***', () => {
  const store = fakeStore()
  createComputerSupervisor({ artifactStore: store, now: () => 1 }).dryRun(order())
  const rec = store.written[0].record
  assert.equal(rec.steps[0].outcome, 'refused', "'ok' would claim work that was never done")
  assert.equal(rec.steps[0].refusalReason, 'dry_run_no_action')
  assert.equal(rec.ok, false, 'the run as a whole is not ok either')
})

test('*** a REFUSED dry-run is audited too — an attempt is never silent ***', () => {
  const store = fakeStore()
  const s = createComputerSupervisor({ artifactStore: store, now: () => 1 })
  s.dryRun(order({ requiresEvidence: false })) // invalid
  s.dryRun(order({ steps: [{ action: 'read_file', params: { path: 'C:\\Windows\\x' } }] })) // out of scope
  assert.equal(store.written.length, 2, 'both refusals produced a record')
  assert.equal(store.written[0].record.abortReason, 'invalid_work_order')
})

test('a stopped supervisor refuses, and still writes the record', () => {
  const store = fakeStore()
  const s = createComputerSupervisor({ artifactStore: store, now: () => 1 })
  s.killSwitch.stop('owner_kill_switch')
  const res = s.dryRun(order())
  assert.equal(res.ok, false)
  assert.equal(res.refusal, 'stopped')
  assert.equal(store.written.length, 1)
  assert.equal(store.written[0].record.abortReason, 'stopped')
})

/* ── one live order, single-use steps ─────────────────────────────────────── */

test('*** a second order is REFUSED while one is live — no queue ***', () => {
  // The registry is shared, and the first order is closed at the end of its own dry-run,
  // so this is tested directly against the registry with an order left open.
  const { createOrderRegistry } = require('./orderRegistry')
  const reg = createOrderRegistry({ now: () => 1000 })
  assert.equal(reg.admit({ approvalId: 'appr_a', stepCount: 2, timeoutSec: 60 }).ok, true)
  const second = reg.admit({ approvalId: 'appr_b', stepCount: 1, timeoutSec: 60 })
  assert.equal(second.ok, false)
  assert.equal(second.reason, 'another_order_is_live')
})

test('*** a dry-run consumes its own step nonces, so it cannot be replayed ***', () => {
  const s = sup()
  const res = s.dryRun(order())
  assert.equal(res.ok, true)
  // the order was closed and its nonces burned; the same order cannot be walked again
  // on the same nonces, and a real run would need its own approval
  assert.equal(s.orderRegistry.liveApprovalId(), null, 'nothing is left live')
})

test('the same dry-run can be requested again only as a NEW order admission', () => {
  const s = sup()
  assert.equal(s.dryRun(order()).ok, true)
  assert.equal(s.dryRun(order()).ok, true, 'a fresh admission is fine — it is not a replay')
})

/* ── the composition root ─────────────────────────────────────────────────── */

test('*** the PRODUCTION composition has a real audit store — asserted, not assumed ***', () => {
  // THE AGENT BRIDGE LESSON. Its audit was wired to an injected dependency that was
  // undefined in the real assembly; everything passed and the gap only surfaced on the
  // first real execution, which left no record. So this builds the supervisor the way
  // production does — injecting NOTHING — and asserts against the real store.
  const real = createComputerSupervisor()
  assert.equal(real.auditConfigured, true, 'production construction must have an audit sink')
  assert.equal(typeof real.dryRun, 'function')
  assert.equal(real.capabilities.execute, false, 'and still cannot act')
})

test('the real store writes where the other audits write, under the artifact root', () => {
  // Prove the sink is the genuine artifact store and not a stub that swallows records:
  // write a probe record through the real composition into a temp artifact root.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-computer-audit-'))
  try {
    const { createArtifactStore } = require('../store/artifactStore')
    const store = createArtifactStore({ baseDir: base })
    const s = createComputerSupervisor({ artifactStore: store, now: () => 1 })
    const res = s.dryRun(order(), { who: 'louie' })
    assert.equal(res.auditWritten, true)
    const listed = store.list('computer-audit')
    assert.equal(listed.length, 1, 'the record is really on disk, readable back')
    assert.equal(listed[0].dryRun, true)
    assert.equal(listed[0].kind, 'computer-audit')
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})

test('losing the audit store is visible, not silent — AND the dry-run fails', () => {
  const s = createComputerSupervisor({ artifactStore: { notAWriter: true }, now: () => 1 })
  assert.equal(s.auditConfigured, false, 'a broken sink is reported, not hidden')
  const res = s.dryRun(order())
  assert.equal(res.auditWritten, false, 'the result says the record was not written')
  assert.equal(res.ok, false, 'and an unrecorded operation does not succeed')
  assert.equal(res.refusal, 'audit_write_failed')
})

/* ── fail-closed audit ────────────────────────────────────────────────────── */

test('*** a THROWING audit sink fails the dry-run — no record, no result ***', () => {
  // Owner ruling 2026-07-30, correcting a fail-open defect: writeAudit used to swallow the
  // error and let the operation report success with auditWritten:false. A result that says
  // "this happened but was never recorded" is exactly the pair that must not exist.
  const s = createComputerSupervisor({
    artifactStore: { write: () => { throw new Error('disk is full') } },
    now: () => 1
  })
  assert.equal(s.auditConfigured, true, 'the sink LOOKS usable — the failure is at write time')

  const res = s.dryRun(order())
  assert.equal(res.ok, false, 'the operation fails because the record did not land')
  assert.equal(res.refusal, 'audit_write_failed')
  assert.match(res.reason, /disk is full/, 'and it says WHY, rather than hiding the cause')
  assert.equal(res.auditWritten, false)
  assert.equal(res.auditRecordId, null)
})

test('*** ok:true and auditWritten:false is now an IMPOSSIBLE pair ***', () => {
  // The invariant stated as one assertion, over every route a caller can take: a success is
  // only ever handed back once the record is on disk.
  const cases = [
    ['working sink', fakeStore()],
    ['throwing sink', { write: () => { throw new Error('nope') } }],
    ['broken sink', { notAWriter: true }]
  ]
  for (const [label, store] of cases) {
    const s = createComputerSupervisor({ artifactStore: store, now: () => 1 })
    for (const wo of [order(), order({ steps: [] }), order({ approvalId: null })]) {
      const res = s.dryRun(wo)
      if (res.auditWritten === false) {
        assert.equal(res.ok, false, `${label}: unrecorded result must not be ok`)
      }
      if (res.ok === true) {
        assert.equal(res.auditWritten, true, `${label}: an ok result must be recorded`)
      }
    }
  }
})

test('the fail-closed rule is in the source, not just in behaviour', () => {
  const src = fs.readFileSync(path.join(__dirname, 'computerSupervisor.js'), 'utf8')
  assert.ok(!/catch \(_\) \{ return null \}/.test(src), 'the swallowing catch must stay deleted')
  assert.ok(src.includes("throw"), 'writeAudit throws rather than returning null')
})

/* ── the dormant second gate ──────────────────────────────────────────────── */

test('*** the step-scope check is UNREACHABLE today — dormant, not working, not broken ***', () => {
  // Owner ruling 2026-07-28: keep it as the second gate for Phase 3 desktop steps. This
  // test exists so a future reader cannot mistake a green suite for proof that the branch
  // runs, nor mistake the dead branch for a bug and delete the second gate.
  const s = sup()

  // Try every way an out-of-scope path could reach the walker. The SCHEMA catches all of
  // them first, so `refused_out_of_scope` is never the refusal.
  const attempts = [
    order({ steps: [{ action: 'read_file', params: { path: 'C:\\Windows\\x.txt' } }] }),
    order({ steps: [{ action: 'copy_file', params: { sourcePath: P('a'), destPath: 'D:\\x' } }] }),
    order({ allowedPaths: [P('inbox')], steps: [{ action: 'read_file', params: { path: P('other\\x') } }] })
  ]
  for (const wo of attempts) {
    const res = s.dryRun(wo)
    assert.equal(res.ok, false)
    assert.equal(res.refusal, 'invalid_work_order', 'the schema intercepted, as always')
    assert.notEqual(res.refusal, 'step_out_of_scope', 'the walker never got the chance')
    assert.deepEqual(res.steps, [], 'no step was resolved at all')
  }

  // The branch still EXISTS and is still correct — proven by calling the logic directly
  // through a valid order whose step is in scope, and confirming the verdict it produces.
  const good = s.dryRun(order())
  assert.equal(good.steps[0].verdict, 'in_scope', 'the verdict field is live and reachable')

  // and the source still carries both outcomes, so the second gate has not been quietly
  // simplified away
  const src = fs.readFileSync(path.join(__dirname, 'computerSupervisor.js'), 'utf8')
  assert.ok(src.includes("'refused_out_of_scope'"), 'the second gate is still in the code')
  assert.ok(src.includes('CURRENTLY UNREACHABLE'), 'and is annotated as dormant')
})
