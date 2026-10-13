'use strict'

/**
 * openClawQuarantine.test.js — THE LOCK MUST SURVIVE THE THINGS THAT BREAK LOCKS.
 *
 * These tests exist because C2-B2-A produced positive evidence, not a worry: `tasks cancel`
 * reported "Cancelled …" with exit 0 three times while the task kept running, the turn
 * completed 255.5s later, and killing the client changed nothing. So every assertion here is
 * about refusing to believe something we have already watched be false.
 */

const os = require('os')
const fs = require('fs')
const path = require('path')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-c2b2b1-q-'))

const test = require('node:test')
const assert = require('node:assert')

const { createOpenClawQuarantine, fileStore, mergeRecord, STATES, UNACCOUNTED } = require('../agent/openClawQuarantine')

/** An isolated in-memory ledger. No unit test touches a real store. */
function memStore (seed = {}) {
  let data = JSON.parse(JSON.stringify(seed))
  return {
    read: () => JSON.parse(JSON.stringify(data)),
    write: (all) => { data = JSON.parse(JSON.stringify(all)) },
    peek: () => data
  }
}

/**
 * ⛔ A FAKE SESSION-RETIREMENT PROOF, AND IT IS FAKE ON PURPOSE.
 *
 * Retiring an executor asserts the session can no longer auto-resume. Nothing available in
 * production proves that — there is no OpenClaw primitive that neutralises a session without
 * pruning its workspace — so the ledger's default verifier refuses everything and production
 * fails closed. Tests inject this so the transition CONTRACT can be exercised without
 * pretending the blocker is solved.
 */
const fakeRetirementProof = (approvalId) => ({ approvalId, sessionRetired: true })
const verifyFakeRetirement = (proof, expect) =>
  !!proof && proof.sessionRetired === true && proof.approvalId === expect.approvalId

const mk = (seed) => {
  const store = memStore(seed)
  return {
    q: createOpenClawQuarantine({ store, verifyRetirementProof: verifyFakeRetirement }),
    store
  }
}

/** Drive a record all the way to CLEANED, through the retirement boundary. */
const retireAndClean = (q, id) => {
  q.retire(id, fakeRetirementProof(id))
  q.markCleaned(id)
}

/* ══════════════ Q1 — timeout becomes quarantine, never failure-and-done ══════════════ */

test('Q1. a client timeout drives RUNNING -> CLIENT_TIMEOUT -> QUARANTINED', () => {
  const { q } = mk()
  q.begin('appr_1')
  assert.strictEqual(q.state('appr_1'), STATES.PREPARED)
  q.markRunning('appr_1', { agentId: 'aroma-appr_1', sessionKey: 'agent:aroma-appr_1:appr_1', phase: 'executor_launch_attempting' })
  assert.strictEqual(q.state('appr_1'), STATES.RUNNING)
  q.markClientTimeout('appr_1')
  assert.strictEqual(q.state('appr_1'), STATES.CLIENT_TIMEOUT)
  q.quarantine('appr_1')
  assert.strictEqual(q.state('appr_1'), STATES.QUARANTINED)
})

test('Q1b. the happy path still reaches CLEANED', () => {
  const { q } = mk()
  q.begin('appr_ok')
  q.markRunning('appr_ok', { agentId: 'aroma-appr_ok', sessionKey: 'agent:aroma-appr_ok:appr_ok', phase: 'executor_launch_attempting' })
  q.markSucceeded('appr_ok')
  q.observeTerminal('appr_ok', 'succeeded')
  retireAndClean(q, 'appr_ok')
  assert.strictEqual(q.state('appr_ok'), STATES.CLEANED)
})

/* ══════════════ Q2 — late success is refused forever ══════════════ */

test('Q2. ⛔ a late success is refused for a tainted approval, permanently', () => {
  // Measured: the executor keeps running after we stop waiting, and it CAN finish
  // successfully. That payload is evidence it outlived our supervision, not evidence the
  // run was clean.
  const { q } = mk()
  q.begin('appr_t')
  q.markRunning('appr_t', { agentId: 'aroma-appr_t', sessionKey: 'agent:aroma-appr_t:appr_t', phase: 'executor_launch_attempting' })
  q.markClientTimeout('appr_t')

  assert.throws(() => q.markSucceeded('appr_t'), /never accepted for a tainted run/)

  q.quarantine('appr_t')
  assert.throws(() => q.markSucceeded('appr_t'), /never accepted for a tainted run/)

  // even after terminality is observed, the run does not retroactively become a success
  q.observeTerminal('appr_t', 'succeeded')
  assert.throws(() => q.markSucceeded('appr_t'), /illegal quarantine transition/)
  retireAndClean(q, 'appr_t')
  assert.throws(() => q.markSucceeded('appr_t'), /illegal quarantine transition/)
  assert.strictEqual(q.state('appr_t'), STATES.CLEANED)
})

test('Q2b. every forbidden transition is refused by construction', () => {
  const { q } = mk()
  q.begin('a1')
  assert.throws(() => q.markSucceeded('a1'), /illegal quarantine transition PREPARED -> SUCCEEDED/)
  // PREPARED may reach TERMINAL_OBSERVED (a run refused before the executor started), but
  // NEVER by way of an unaccepted 'succeeded' — that must go through markSucceeded first.
  assert.throws(() => q.observeTerminal('a1', 'succeeded'), /must pass through markSucceeded/)
  assert.throws(() => retireAndClean(q, 'a1'), /illegal quarantine transition/)
  assert.throws(() => q.quarantine('a1'), /illegal quarantine transition/)

  // and an unknown approval has no transitions at all
  assert.throws(() => q.markRunning('never_began', { agentId: 'aroma-never_began', sessionKey: 'agent:aroma-never_began:never_began', phase: 'executor_launch_attempting' }), /has no quarantine record/)
})

test('Q2c. only a real terminal task status counts as an observation', () => {
  const { q } = mk()
  q.begin('a2'); q.markRunning('a2', { agentId: 'aroma-a2', sessionKey: 'agent:aroma-a2:a2', phase: 'executor_launch_attempting' }); q.markClientTimeout('a2'); q.quarantine('a2')
  for (const bad of ['running', 'queued', 'done', 'ok', '', null, undefined]) {
    assert.throws(() => q.observeTerminal('a2', bad), /not a terminal OpenClaw task status/)
  }
  for (const good of ['succeeded', 'failed', 'timed_out', 'cancelled', 'lost']) {
    const { q: q2 } = mk()
    q2.begin('x'); q2.markRunning('x', { agentId: 'aroma-x', sessionKey: 'agent:aroma-x:x', phase: 'executor_launch_attempting' }); q2.markClientTimeout('x'); q2.quarantine('x')
    q2.observeTerminal('x', good)
    assert.strictEqual(q2.state('x'), STATES.TERMINAL_OBSERVED, good)
  }
})

/* ══════════════ Q3 — the lock is global ══════════════ */

test('Q3. ⛔ a DIFFERENT approval is blocked while any quarantine is live', () => {
  // The unaccounted-for thing is a process. A fresh approvalId does not make it safe to
  // start a second turn alongside one that never stopped.
  const { q } = mk()
  q.begin('appr_a'); q.markRunning('appr_a', { agentId: 'aroma-appr_a', sessionKey: 'agent:aroma-appr_a:appr_a', phase: 'executor_launch_attempting' }); q.markClientTimeout('appr_a'); q.quarantine('appr_a')

  const gate = q.canStart('appr_b')
  assert.strictEqual(gate.ok, false)
  assert.match(gate.reason, /locked out while approval 'appr_a' is QUARANTINED/)
  assert.deepStrictEqual(gate.blockedBy, [{ approvalId: 'appr_a', state: STATES.QUARANTINED }])
  assert.throws(() => q.begin('appr_b'), /locked out/)
})

test('Q3b. a merely RUNNING approval also holds the lock', () => {
  const { q } = mk()
  q.begin('appr_a'); q.markRunning('appr_a', { agentId: 'aroma-appr_a', sessionKey: 'agent:aroma-appr_a:appr_a', phase: 'executor_launch_attempting' })
  assert.strictEqual(q.canStart('appr_b').ok, false)
})

test('Q3c. the same approvalId is never reused, even after a clean finish', () => {
  const { q } = mk()
  q.begin('appr_a'); q.markRunning('appr_a', { agentId: 'aroma-appr_a', sessionKey: 'agent:aroma-appr_a:appr_a', phase: 'executor_launch_attempting' }); q.markSucceeded('appr_a')
  q.observeTerminal('appr_a', 'succeeded'); retireAndClean(q, 'appr_a')
  const gate = q.canStart('appr_a')
  assert.strictEqual(gate.ok, false)
  assert.match(gate.reason, /already has a quarantine record .*approvals are never reused/)
})

/* ══════════════ Q4 — the lock survives a restart ══════════════ */

test('Q4. ⛔ quarantine survives a backend restart', () => {
  // A crash is exactly when you most need to remember that something may still be running.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-q-restart-'))
  const file = path.join(dir, 'openclaw-quarantine.json')

  const first = createOpenClawQuarantine({ store: fileStore({ file }) })
  first.begin('appr_r'); first.markRunning('appr_r', { agentId: 'aroma-appr_r', sessionKey: 'agent:aroma-appr_r:appr_r', phase: 'executor_launch_attempting' }); first.markClientTimeout('appr_r'); first.quarantine('appr_r')

  // a completely fresh instance, as after a process restart — no shared memory
  const second = createOpenClawQuarantine({ store: fileStore({ file }) })
  assert.strictEqual(second.state('appr_r'), STATES.QUARANTINED)
  assert.strictEqual(second.canStart('appr_other').ok, false, 'the lock is still held after restart')
  assert.throws(() => second.markSucceeded('appr_r'), /never accepted for a tainted run/)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('Q4b. ⛔ an unreadable ledger fails CLOSED, it does not report "nothing quarantined"', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-q-corrupt-'))
  const file = path.join(dir, 'openclaw-quarantine.json')
  fs.writeFileSync(file, '{ this is not json', 'utf8')

  const q = createOpenClawQuarantine({ store: fileStore({ file }) })
  assert.throws(() => q.canStart('appr_x'), /quarantine ledger unreadable/)

  fs.rmSync(dir, { recursive: true, force: true })
})

/* ══════════════ Q5/Q6 — cleanup is gated, and evidence survives it ══════════════ */

test('Q5. RETIREMENT is what permits cleanup — terminal observation does not', () => {
  const { q } = mk()
  q.begin('appr_c'); q.markRunning('appr_c', { agentId: 'aroma-appr_c', sessionKey: 'agent:aroma-appr_c:appr_c', phase: 'executor_launch_attempting' }); q.markClientTimeout('appr_c'); q.quarantine('appr_c')

  const denied = q.mayCleanup('appr_c')
  assert.strictEqual(denied.ok, false)
  assert.match(denied.reason, /requires an observed terminal task status/)

  q.observeTerminal('appr_c', 'succeeded')
  const stillDenied = q.mayCleanup('appr_c')
  assert.strictEqual(stillDenied.ok, false, 'a terminal task does not permit removing an executed workspace')
  assert.match(stillDenied.reason, /has not been retired/)

  q.retire('appr_c', fakeRetirementProof('appr_c'))
  assert.deepStrictEqual(q.mayCleanup('appr_c'), { ok: true })
})

test('Q5b. ⛔ cleanup alone cannot release a non-terminal quarantine', () => {
  // Deleting a directory does not stop a process. If tidying up could clear the lock,
  // tidying up would masquerade as containment.
  const { q } = mk()
  q.begin('appr_d'); q.markRunning('appr_d', { agentId: 'aroma-appr_d', sessionKey: 'agent:aroma-appr_d:appr_d', phase: 'executor_launch_attempting' }); q.markClientTimeout('appr_d'); q.quarantine('appr_d')

  assert.throws(() => q.markCleaned('appr_d'), /illegal quarantine transition QUARANTINED -> CLEANED/)
  assert.throws(() => q.retire('appr_d', fakeRetirementProof('appr_d')), /illegal quarantine transition QUARANTINED -> EXECUTOR_RETIRED/)
  assert.strictEqual(q.canStart('appr_e').ok, false, 'the lock is still held')
})

test('Q6. cleanup does not erase the historical quarantine evidence', () => {
  const { q, store } = mk()
  q.begin('appr_h'); q.markRunning('appr_h', { agentId: 'aroma-appr_h', sessionKey: 'agent:aroma-appr_h:appr_h', phase: 'executor_launch_attempting' }); q.markClientTimeout('appr_h')
  q.quarantine('appr_h', { note: 'client stopped waiting at 300s' })
  q.observeTerminal('appr_h', 'succeeded')
  retireAndClean(q, 'appr_h')

  const rec = q.record('appr_h')
  assert.strictEqual(rec.state, STATES.CLEANED)
  assert.strictEqual(rec.taskStatus, 'succeeded', 'the observed status is retained')
  assert.strictEqual(rec.note, 'client stopped waiting at 300s', 'the quarantine reason is retained')
  assert.ok(rec.startedAt && rec.updatedAt)
  assert.ok(Object.keys(store.peek()).includes('appr_h'), 'the record is not deleted')
})

test('Q6b. the lock is released by RETIREMENT, not by observation', () => {
  const { q } = mk()
  q.begin('appr_1'); q.markRunning('appr_1', { agentId: 'aroma-appr_1', sessionKey: 'agent:aroma-appr_1:appr_1', phase: 'executor_launch_attempting' }); q.markClientTimeout('appr_1'); q.quarantine('appr_1')
  assert.strictEqual(q.canStart('appr_2').ok, false)

  q.observeTerminal('appr_1', 'lost')
  assert.strictEqual(q.canStart('appr_2').ok, false, 'a terminal task does not end the SESSION')

  q.retire('appr_1', fakeRetirementProof('appr_1'))
  assert.strictEqual(q.canStart('appr_2').ok, true, 'retirement is the process boundary')
  q.markCleaned('appr_1')
  assert.strictEqual(q.canStart('appr_2').ok, true)
})

/* ══════════════ L1..L6 — the ledger fails CLOSED on semantic corruption ══════════════ */

/**
 * Review found the original read() fell back to `{}` whenever the parsed JSON was not a
 * plain object. `[]`, `null`, `"abc"` and `123` are all VALID JSON — so all four became
 * "no quarantine", and "no quarantine" is the single answer that authorises another run.
 * Truncation or a partial write can produce exactly those shapes.
 */
function ledgerWith (contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-q-bad-'))
  const file = path.join(dir, 'openclaw-quarantine.json')
  fs.writeFileSync(file, contents, 'utf8')
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

test('L1..L6. valid JSON of the wrong shape is never read as an empty ledger', () => {
  const cases = [
    ['L1 array', '[]', /not an object \(got array\)/],
    ['L2 null', 'null', /not an object \(got object\)/],
    ['L3 string', '"abc"', /not an object \(got string\)/],
    ['L4 number', '123', /not an object \(got number\)/],
    ['L4b null record', '{"appr_x": null}', /record 'appr_x' is not an object/],
    ['L4c scalar record', '{"appr_x": 7}', /record 'appr_x' is not an object/],
    ['L5 unknown state', '{"appr_x": {"approvalId":"appr_x","state":"GARBAGE"}}', /unknown state 'GARBAGE'/],
    ['L5b missing state', '{"appr_x": {"approvalId":"appr_x"}}', /unknown state 'undefined'/],
    ['L6 key mismatch', '{"appr_x": {"approvalId":"appr_y","state":"RUNNING"}}', /declares approvalId 'appr_y'/],
    ['L6b unsafe key', '{"../escape": {"approvalId":"../escape","state":"RUNNING"}}', /unsafe approvalId key/]
  ]
  for (const [name, contents, re] of cases) {
    const l = ledgerWith(contents)
    const q = createOpenClawQuarantine({ store: fileStore({ file: l.file }) })
    assert.throws(() => q.canStart('appr_new'), re, name + ' (canStart)')
    assert.throws(() => q.unaccounted(), re, name + ' (unaccounted)')
    assert.throws(() => q.begin('appr_new'), re, name + ' (begin)')
    l.cleanup()
  }
})

test('L7. a genuinely empty ledger is still empty — only ENOENT means that', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-q-none-'))
  const q = createOpenClawQuarantine({ store: fileStore({ file: path.join(dir, 'nope.json') }) })
  assert.deepStrictEqual(q.unaccounted(), [])
  assert.strictEqual(q.canStart('appr_x').ok, true)

  const empty = ledgerWith('{}')
  const q2 = createOpenClawQuarantine({ store: fileStore({ file: empty.file }) })
  assert.strictEqual(q2.canStart('appr_x').ok, true, 'an explicitly empty object is legitimate')
  empty.cleanup()
  fs.rmSync(dir, { recursive: true, force: true })
})

/* ══════════════ T1..T7 — a normally-failing run must be able to END ══════════════ */

test('T1/T2/T3. RUNNING + an observed FAILURE reaches TERMINAL_OBSERVED', () => {
  // Without this edge a task that ends `failed` while we are still watching stayed RUNNING
  // and held the global lock forever — found in review, and it would have bricked OpenClaw
  // on the first genuinely failing run.
  for (const status of ['failed', 'timed_out', 'cancelled', 'lost']) {
    const { q } = mk()
    q.begin('appr_f'); q.markRunning('appr_f', { agentId: 'aroma-appr_f', sessionKey: 'agent:aroma-appr_f:appr_f', phase: 'executor_launch_attempting' })
    q.observeTerminal('appr_f', status)
    assert.strictEqual(q.state('appr_f'), STATES.TERMINAL_OBSERVED, status)
    assert.strictEqual(q.record('appr_f').taskStatus, status)
  }
})

test('T4. a failed terminal observation does NOT by itself release the lock', () => {
  const { q } = mk()
  q.begin('appr_f'); q.markRunning('appr_f', { agentId: 'aroma-appr_f', sessionKey: 'agent:aroma-appr_f:appr_f', phase: 'executor_launch_attempting' })
  assert.strictEqual(q.canStart('appr_next').ok, false, 'held while running')

  q.observeTerminal('appr_f', 'failed')
  assert.strictEqual(q.state('appr_f'), STATES.TERMINAL_OBSERVED)
  assert.strictEqual(q.canStart('appr_next').ok, false,
    'the task ended, but the session may still auto-resume — still held')

  q.retire('appr_f', fakeRetirementProof('appr_f'))
  assert.strictEqual(q.canStart('appr_next').ok, true)
})

test('T5. an observed "succeeded" cannot BYPASS markSucceeded()', () => {
  // A task ending successfully is a fact about OpenClaw's scheduler. Accepting its output is
  // a separate decision that belongs to markSucceeded, after the result was received and
  // verified. Letting observation stand in for acceptance would record a run we never
  // validated as a good one.
  const { q } = mk()
  q.begin('appr_s'); q.markRunning('appr_s', { agentId: 'aroma-appr_s', sessionKey: 'agent:aroma-appr_s:appr_s', phase: 'executor_launch_attempting' })
  assert.throws(() => q.observeTerminal('appr_s', 'succeeded'), /must pass through markSucceeded/)
  assert.strictEqual(q.state('appr_s'), STATES.RUNNING, 'and the state is unchanged')

  q.markSucceeded('appr_s')
  q.observeTerminal('appr_s', 'succeeded')
  assert.strictEqual(q.state('appr_s'), STATES.TERMINAL_OBSERVED)
})

test('T6. SUCCEEDED contradicted by a failing observation is refused', () => {
  const { q } = mk()
  q.begin('appr_c'); q.markRunning('appr_c', { agentId: 'aroma-appr_c', sessionKey: 'agent:aroma-appr_c:appr_c', phase: 'executor_launch_attempting' }); q.markSucceeded('appr_c')
  for (const bad of ['failed', 'timed_out', 'cancelled', 'lost']) {
    assert.throws(() => q.observeTerminal('appr_c', bad), /is SUCCEEDED but the observed task status/)
  }
  assert.strictEqual(q.state('appr_c'), STATES.SUCCEEDED)
})

test('T7. a late "succeeded" after a timeout is STILL refused — the fix did not widen it', () => {
  const { q } = mk()
  q.begin('appr_t'); q.markRunning('appr_t', { agentId: 'aroma-appr_t', sessionKey: 'agent:aroma-appr_t:appr_t', phase: 'executor_launch_attempting' }); q.markClientTimeout('appr_t'); q.quarantine('appr_t')
  assert.throws(() => q.markSucceeded('appr_t'), /never accepted for a tainted run/)
  q.observeTerminal('appr_t', 'succeeded')
  assert.strictEqual(q.state('appr_t'), STATES.TERMINAL_OBSERVED)
  assert.notStrictEqual(q.state('appr_t'), STATES.SUCCEEDED)
})

/* ══════════════ grants ══════════════ */

test('G1. a retired grant cannot be forged, and is only issued once RETIRED', () => {
  const { q } = mk()
  q.begin('appr_g'); q.markRunning('appr_g', { agentId: 'aroma-appr_g', sessionKey: 'agent:aroma-appr_g:appr_g', phase: 'executor_launch_attempting' })
  assert.throws(() => q.retiredGrant('appr_g'), /requires the executor to be RETIRED/)

  q.observeTerminal('appr_g', 'failed'); q.retire('appr_g', fakeRetirementProof('appr_g'))
  const grant = q.retiredGrant('appr_g')
  assert.strictEqual(q.verifyGrant(grant, { approvalId: 'appr_g', kind: 'executor-retired' }), true)
  assert.strictEqual(grant.approvalId, 'appr_g')

  for (const forged of [
    null, undefined, true, 'appr_g', {},
    { approvalId: 'appr_g' },
    { approvalId: 'appr_g', state: STATES.TERMINAL_OBSERVED },
    Object.freeze({ approvalId: 'appr_g', state: STATES.TERMINAL_OBSERVED }),
    JSON.parse(JSON.stringify(grant))
  ]) {
    assert.strictEqual(q.verifyGrant(forged, { approvalId: 'appr_g', kind: 'executor-retired' }), false, 'a literal must never verify')
  }
})

/* ══════════════ G1..G3 — grants are bound to ONE ledger instance ══════════════ */

test('G2. ⛔ a grant from a DIFFERENT ledger is refused, same approvalId and all', () => {
  // The first version kept one module-global WeakSet, which proved only "some quarantine
  // instance in this process issued this". Two ledgers in one process — a fixture beside
  // production, or two composed lanes — would have honoured each other's grants.
  const a = createOpenClawQuarantine({ store: memStore(), verifyRetirementProof: verifyFakeRetirement })
  const b = createOpenClawQuarantine({ store: memStore(), verifyRetirementProof: verifyFakeRetirement })

  for (const q of [a, b]) {
    q.begin('appr_same'); q.markRunning('appr_same', { agentId: 'aroma-appr_same', sessionKey: 'agent:aroma-appr_same:appr_same', phase: 'executor_launch_attempting' }); q.observeTerminal('appr_same', 'failed'); q.retire('appr_same', fakeRetirementProof('appr_same'))
  }
  const ga = a.retiredGrant('appr_same')
  const gb = b.retiredGrant('appr_same')

  assert.strictEqual(a.verifyGrant(ga, { approvalId: 'appr_same', kind: 'executor-retired' }), true, 'its own grant verifies')
  assert.strictEqual(b.verifyGrant(gb, { approvalId: 'appr_same', kind: 'executor-retired' }), true)
  assert.strictEqual(b.verifyGrant(ga, { approvalId: 'appr_same', kind: 'executor-retired' }), false, 'a cross-ledger grant must NOT verify')
  assert.strictEqual(a.verifyGrant(gb, { approvalId: 'appr_same', kind: 'executor-retired' }), false)
  assert.strictEqual(ga.approvalId, gb.approvalId, 'and they name the same approval, so only the brand distinguishes them')
})

test('G3. ⛔ there is no process-global verifier to export', () => {
  const mod = require('../agent/openClawQuarantine')
  assert.strictEqual(typeof mod.verifyGrant, 'undefined',
    'a module-level verifier would re-open the cross-ledger hole')
  const src = fs.readFileSync(path.join(__dirname, 'openClawQuarantine.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.ok(!/^const ISSUED_GRANTS/m.test(code), 'no module-global grant set may exist')
})

test('G4. the two grant kinds are mechanically distinguishable', () => {
  const q = createOpenClawQuarantine({ store: memStore(), verifyRetirementProof: verifyFakeRetirement })
  q.begin('appr_pre'); q.abortPreExecution('appr_pre')
  const pre = q.preExecutionGrant('appr_pre')

  q.begin('appr_run'); q.markRunning('appr_run', { agentId: 'aroma-appr_run', sessionKey: 'agent:aroma-appr_run:appr_run', phase: 'executor_launch_attempting' }); q.observeTerminal('appr_run', 'lost'); q.retire('appr_run', fakeRetirementProof('appr_run'))
  const term = q.retiredGrant('appr_run')

  assert.strictEqual(pre.kind, 'pre-execution')
  assert.strictEqual(term.kind, 'executor-retired')
  assert.notStrictEqual(pre.kind, term.kind)
})

/* ══════════════ PE1..PE5 — truthful evidence when nothing ever ran ══════════════ */

test('PE3/PE4. a pre-execution abort records no taskStatus, because there was no task', () => {
  // The first version called observeTerminal(id, 'cancelled') to reach cleanup, writing a
  // record claiming OpenClaw's scheduler cancelled a task that was never created.
  const q = createOpenClawQuarantine({ store: memStore() })
  q.begin('appr_rev')
  q.abortPreExecution('appr_rev', { reason: 'revision_moved' })

  const rec = q.record('appr_rev')
  assert.strictEqual(rec.state, STATES.PRE_EXECUTION_ABORTED)
  assert.strictEqual(rec.reason, 'revision_moved', 'the real reason is recorded')
  assert.strictEqual('taskStatus' in rec, false, 'NO taskStatus may exist for a task that never did')
})

test('PE5. ⛔ RUNNING can never use the pre-execution abort path', () => {
  // Once an executor has started, only a genuinely observed status will do — otherwise the
  // convenient path becomes a way to discard an unaccounted-for process.
  const q = createOpenClawQuarantine({ store: memStore() })
  q.begin('appr_r'); q.markRunning('appr_r', { agentId: 'aroma-appr_r', sessionKey: 'agent:aroma-appr_r:appr_r', phase: 'executor_launch_attempting' })
  assert.throws(() => q.abortPreExecution('appr_r'), /illegal quarantine transition RUNNING -> PRE_EXECUTION_ABORTED/)
  assert.throws(() => q.failPreparation('appr_r'), /illegal quarantine transition RUNNING -> PREPARATION_FAILED/)
  assert.throws(() => q.preExecutionGrant('appr_r'), /requires that no executor ever started/)

  for (const from of ['markClientTimeout', 'quarantine']) {
    const q2 = createOpenClawQuarantine({ store: memStore() })
    q2.begin('a'); q2.markRunning('a', { agentId: 'aroma-a', sessionKey: 'agent:aroma-a:a', phase: 'executor_launch_attempting' }); q2.markClientTimeout('a')
    if (from === 'quarantine') q2.quarantine('a')
    assert.throws(() => q2.abortPreExecution('a'), /illegal quarantine transition/)
    assert.throws(() => q2.preExecutionGrant('a'), /requires that no executor ever started/)
  }
})

test('PE6. a preparation failure is recorded honestly and releases nothing it should not', () => {
  const q = createOpenClawQuarantine({ store: memStore() })
  q.begin('appr_pf')
  q.failPreparation('appr_pf', { reason: 'refuse: clone failed (network unreachable)' })

  const rec = q.record('appr_pf')
  assert.strictEqual(rec.state, STATES.PREPARATION_FAILED)
  assert.match(rec.reason, /clone failed/)
  assert.strictEqual('taskStatus' in rec, false)

  // nothing ran, so it holds no lock — a different approval may proceed
  assert.strictEqual(q.canStart('appr_other').ok, true, 'a failed preparation must not block the world')
  // but the failed approvalId itself is never reused
  assert.strictEqual(q.canStart('appr_pf').ok, false)
  assert.match(q.canStart('appr_pf').reason, /approvals are never reused/)
})

/* ══════════════ S1..S6 — SUCCEEDED holds the lock until the executor is OBSERVED ══════════════ */

/**
 * This design separates RESULT ACCEPTED (SUCCEEDED) from EXECUTOR OBSERVED TERMINAL, because
 * C2-B2-A proved a returned result does not prove the executor stopped. The workspace already
 * honoured that — cleanup is refused while SUCCEEDED — but UNACCOUNTED omitted SUCCEEDED, so
 * canStart() would authorise a SECOND OpenClaw execution in the window between markSucceeded()
 * and observeTerminal(). Two halves of one invariant disagreeing, with the permissive half
 * winning at exactly the wrong moment.
 */

test('S1. ⛔ a different approval is blocked while the first is merely SUCCEEDED', () => {
  const { q } = mk()
  q.begin('appr_1'); q.markRunning('appr_1', { agentId: 'aroma-appr_1', sessionKey: 'agent:aroma-appr_1:appr_1', phase: 'executor_launch_attempting' }); q.markSucceeded('appr_1')

  const gate = q.canStart('appr_2')
  assert.strictEqual(gate.ok, false, 'a returned result is not proof the executor stopped')
  assert.match(gate.reason, /locked out while approval 'appr_1' is SUCCEEDED/)
  assert.deepStrictEqual(gate.blockedBy, [{ approvalId: 'appr_1', state: STATES.SUCCEEDED }])
  assert.throws(() => q.begin('appr_2'), /locked out/)
})

test('S2. ⛔ the SUCCEEDED lock survives a restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-q-succ-'))
  const file = path.join(dir, 'openclaw-quarantine.json')

  const first = createOpenClawQuarantine({ store: fileStore({ file }) })
  first.begin('appr_s'); first.markRunning('appr_s', { agentId: 'aroma-appr_s', sessionKey: 'agent:aroma-appr_s:appr_s', phase: 'executor_launch_attempting' }); first.markSucceeded('appr_s')

  // a completely fresh instance, as after a backend restart
  const second = createOpenClawQuarantine({ store: fileStore({ file }) })
  assert.strictEqual(second.state('appr_s'), STATES.SUCCEEDED)
  assert.strictEqual(second.canStart('appr_other').ok, false, 'the lock is still held after restart')
  assert.deepStrictEqual(second.unaccounted().map((r) => r.approvalId), ['appr_s'])

  fs.rmSync(dir, { recursive: true, force: true })
})

test('S3. SUCCEEDED holds BOTH the cleanup gate and the execution lock', () => {
  // The two must agree. Previously cleanup refused while the lock was open.
  const { q } = mk()
  q.begin('appr_b'); q.markRunning('appr_b', { agentId: 'aroma-appr_b', sessionKey: 'agent:aroma-appr_b:appr_b', phase: 'executor_launch_attempting' }); q.markSucceeded('appr_b')

  assert.strictEqual(q.mayCleanup('appr_b').ok, false, 'cleanup refused')
  assert.strictEqual(q.canStart('appr_next').ok, false, 'and the lock is held too')
})

test('S4. observation advances the record but does not release the lock', () => {
  const { q } = mk()
  q.begin('appr_c'); q.markRunning('appr_c', { agentId: 'aroma-appr_c', sessionKey: 'agent:aroma-appr_c:appr_c', phase: 'executor_launch_attempting' }); q.markSucceeded('appr_c')
  assert.strictEqual(q.canStart('appr_next').ok, false)

  q.observeTerminal('appr_c', 'succeeded')
  assert.strictEqual(q.state('appr_c'), STATES.TERMINAL_OBSERVED)
  assert.strictEqual(q.canStart('appr_next').ok, false, 'observation alone is not the boundary')

  q.retire('appr_c', fakeRetirementProof('appr_c'))
  assert.strictEqual(q.canStart('appr_next').ok, true)
})

test('S5. ⛔ SESSION RETIREMENT is the process boundary — not disk, not observation', () => {
  // This test previously asserted that TERMINAL_OBSERVED releases the lock. Its RATIONALE was
  // right and is preserved below: cleanup is about disk, the lock is about a process, and a
  // failed removal must never keep OpenClaw shut down. But its IMPLEMENTATION released the
  // lock while the session could still be auto-resumed — measured in the installed build,
  // where main-session-restart-recovery skips only subagent/cron/ACP keys and scans every
  // agent's session store. So the two facts it conflated are now separated properly.
  const { q } = mk()
  q.begin('appr_d'); q.markRunning('appr_d', { agentId: 'aroma-appr_d', sessionKey: 'agent:aroma-appr_d:appr_d', phase: 'executor_launch_attempting' }); q.markClientTimeout('appr_d')
  q.quarantine('appr_d'); q.observeTerminal('appr_d', 'lost')

  // (1) terminal observation alone is NOT the boundary
  assert.strictEqual(q.state('appr_d'), STATES.TERMINAL_OBSERVED)
  assert.strictEqual(q.canStart('appr_next').ok, false)
  assert.deepStrictEqual(q.unaccounted().map((r) => r.approvalId), ['appr_d'])

  // (2) retirement IS the boundary, and it releases WITHOUT any disk work
  q.retire('appr_d', fakeRetirementProof('appr_d'))
  assert.strictEqual(q.state('appr_d'), STATES.EXECUTOR_RETIRED, 'not yet CLEANED')
  assert.strictEqual(q.canStart('appr_next').ok, true, 'a failed removal can never hold the lock')
  assert.deepStrictEqual(q.unaccounted(), [])

  // (3) disk cleanup is downstream and changes nothing about the lock
  q.markCleaned('appr_d')
  assert.strictEqual(q.canStart('appr_next').ok, true)
})

test('S6. the no-executor states never hold the lock, because no executor existed', () => {
  for (const drive of ['abortPreExecution', 'failPreparation']) {
    const { q } = mk()
    q.begin('appr_n')
    q[drive]('appr_n', { reason: 'synthetic' })
    assert.strictEqual(q.canStart('appr_other').ok, true, `${drive} must not hold the lock`)
    assert.deepStrictEqual(q.unaccounted(), [])
    // and the record is still truthful about what happened
    assert.strictEqual('taskStatus' in q.record('appr_n'), false)
  }
})

test('S7. every state either holds the lock or does not, deliberately', () => {
  // A table, so a future state cannot be added without someone deciding which side it is on.
  assert.deepStrictEqual(UNACCOUNTED.slice().sort(), [
    STATES.CLIENT_TIMEOUT, STATES.QUARANTINED, STATES.RUNNING, STATES.SUCCEEDED,
    STATES.TERMINAL_OBSERVED, STATES.EXECUTOR_GONE_OBSERVED
  ].sort())
  for (const free of [STATES.PREPARED, STATES.EXECUTOR_RETIRED, STATES.PRE_EXECUTION_ABORTED,
    STATES.PREPARATION_FAILED, STATES.CLEANED]) {
    assert.ok(!UNACCOUNTED.includes(free), `${free} must not hold the execution lock`)
  }
  assert.ok(UNACCOUNTED.includes(STATES.TERMINAL_OBSERVED),
    'a terminal task does not prove the session is finished')
  assert.ok(UNACCOUNTED.includes(STATES.EXECUTOR_GONE_OBSERVED),
    'an OS observation that the executor is gone does NOT release the lock')
})

/* ══════════════ A — AUTHORITY: what the module decides, a caller cannot supply ══════════════ */

/**
 * ⛔ THE LEDGER IS THE AUDIT TRAIL, SO ITS OWN FIELDS CANNOT BE CALLER-SUPPLIED.
 *
 * Every transition used to end in Object.assign({}, prev, meta, { state: next }) — caller
 * metadata merged in the middle. Only 'state' was protected by position. A caller passing
 * { phase: 'task_observed' } or { taskStatus: 'succeeded' } as ordinary metadata wrote
 * straight into the fields the retirement gate and the CLEANED provenance check read, which
 * means the evidence could be authored by the thing being audited.
 */
test('A1. ⛔ every authoritative field is refused as caller metadata, at every entry point', () => {
  const KEY = 'appr_auth'
  const AGENT = 'aroma-' + KEY
  const SESSION = 'agent:' + AGENT + ':' + KEY

  // Each entry point, with the setup that makes the call legal in the first place.
  const at = {
    prepared: (q) => { q.begin(KEY) },
    running: (q) => { at.prepared(q); q.markRunning(KEY, { agentId: AGENT, sessionKey: SESSION, phase: 'executor_launch_attempting' }) },
    timedOut: (q) => { at.running(q); q.markClientTimeout(KEY) },
    quarantined: (q) => { at.timedOut(q); q.quarantine(KEY) },
    succeeded: (q) => { at.running(q); q.markSucceeded(KEY) },
    observed: (q) => { at.succeeded(q); q.observeTerminal(KEY, 'succeeded') },
    retired: (q) => { at.observed(q); q.retire(KEY, fakeRetirementProof(KEY)) }
  }

  const ENTRIES = [
    // name, setup, call(q, meta), keys it must refuse
    // agentId/sessionKey/phase are markRunning's own validated ARGUMENTS, checked against
    // the derivation in A3b; the remaining authoritative fields must still be refused here.
    ['markRunning', at.prepared, (q, m) => q.markRunning(KEY, Object.assign({ agentId: AGENT, sessionKey: SESSION, phase: 'executor_launch_attempting' }, m)),
      ['state', 'taskStatus', 'approvalId', 'updatedAt', 'cleanedFrom']],
    ['advancePhase', at.running, (q, m) => q.advancePhase(KEY, 'agent_observed', m), null],
    ['markSucceeded', at.running, (q, m) => q.markSucceeded(KEY, m), null],
    ['markClientTimeout', at.running, (q, m) => q.markClientTimeout(KEY, m), null],
    ['quarantine', at.timedOut, (q, m) => q.quarantine(KEY, m), null],
    ['observeTerminal', at.succeeded, (q, m) => q.observeTerminal(KEY, 'succeeded', m), null],
    ['retire', at.observed, (q, m) => q.retire(KEY, fakeRetirementProof(KEY), m), null],
    ['abortPreExecution', at.prepared, (q, m) => q.abortPreExecution(KEY, m), null],
    ['failPreparation', at.prepared, (q, m) => q.failPreparation(KEY, m), null],
    ['markCleaned', at.retired, (q, m) => q.markCleaned(KEY, m), null]
  ]
  const ALL_KEYS = ['state', 'phase', 'taskStatus', 'approvalId', 'updatedAt', 'cleanedFrom', 'agentId', 'sessionKey']
  const FORGED = {
    state: 'CLEANED',
    phase: 'task_observed',
    taskStatus: 'succeeded',
    approvalId: 'appr_someone_else',
    updatedAt: 0,
    cleanedFrom: 'EXECUTOR_RETIRED',
    agentId: 'aroma-someone_else',
    sessionKey: 'agent:aroma-someone_else:someone_else'
  }

  let checked = 0
  for (const [name, setup, call, only] of ENTRIES) {
    for (const key of (only || ALL_KEYS)) {
      const { q, store } = mk()
      setup(q)
      const before = JSON.stringify(store.peek())

      assert.throws(
        () => call(q, { [key]: FORGED[key] }),
        new RegExp("'" + key + "' is authoritative"),
        name + ' must refuse a caller-supplied ' + key
      )
      // ⛔ AND THE REFUSAL IS TOTAL: the transition did not half-happen.
      assert.strictEqual(JSON.stringify(store.peek()), before,
        name + ': the ledger must be untouched after refusing ' + key)
      checked++
    }
  }
  assert.strictEqual(checked, 5 + 9 * 8, 'every entry point was actually exercised')
})

test('A2. ordinary metadata still lands, and the module still authors its own fields', () => {
  const KEY = 'appr_auth2'
  const SESSION = 'agent:aroma-' + KEY + ':' + KEY
  const { q } = mk()

  q.begin(KEY)
  q.markRunning(KEY, { sessionKey: SESSION, phase: 'executor_launch_attempting', agentId: 'aroma-' + KEY, note: 'first spawn' })
  let rec = q.record(KEY)
  assert.strictEqual(rec.note, 'first spawn', 'non-reserved metadata is preserved')
  assert.strictEqual(rec.agentId, 'aroma-' + KEY)
  assert.strictEqual(rec.state, STATES.RUNNING, 'and the module wrote the state')
  assert.strictEqual(rec.phase, 'executor_launch_attempting', 'and the phase, after validating it')
  assert.strictEqual(rec.agentId, 'aroma-' + KEY, 'and the derived identity')
  assert.strictEqual(rec.sessionKey, SESSION)

  // ⛔ and a later transition cannot rewrite the identity a crash would be found by
  assert.throws(() => q.advancePhase(KEY, 'turn_attempting', { sessionKey: 'agent:aroma-elsewhere:x' }),
    /'sessionKey' is authoritative/)
  assert.throws(() => q.markSucceeded(KEY, { agentId: 'aroma-elsewhere' }), /'agentId' is authoritative/)
  assert.strictEqual(q.record(KEY).sessionKey, SESSION, 'identity is unchanged after both refusals')

  q.advancePhase(KEY, 'turn_attempting', { note: 'turn dispatched' })
  rec = q.record(KEY)
  assert.strictEqual(rec.phase, 'turn_attempting')
  assert.strictEqual(rec.note, 'turn dispatched')

  q.markSucceeded(KEY)
  q.observeTerminal(KEY, 'succeeded', { note: 'tasks show' })
  assert.strictEqual(q.record(KEY).taskStatus, 'succeeded', 'taskStatus comes from the observation ARGUMENT')
})

test('A3. ⛔ markRunning validates the opening phase rather than accepting one', () => {
  const KEY = 'appr_auth3'
  const SESSION = 'agent:aroma-' + KEY + ':' + KEY
  for (const bad of ['agent_observed', 'turn_attempting', 'task_observed', undefined, '', 'nonsense']) {
    const { q, store } = mk()
    q.begin(KEY)
    assert.throws(() => q.markRunning(KEY, { agentId: 'aroma-' + KEY, sessionKey: SESSION, phase: bad }), /must open at phase/, String(bad))
    assert.strictEqual(store.peek()[KEY].state, STATES.PREPARED, 'and RUNNING was not entered')
  }
})

test('A3b. ⛔ markRunning requires the DERIVED identity, not merely a non-empty one', () => {
  const KEY = 'appr_auth3b'
  const AGENT = 'aroma-' + KEY
  const SESSION = 'agent:' + AGENT + ':' + KEY
  const P = 'executor_launch_attempting'

  // "some non-empty string" was the old check. A key that does not correspond to the agent
  // about to be spawned is worse than none: reconciliation queries it, is told the task does
  // not exist, and closes out a run that is still alive.
  const BAD = [
    ['no identity at all', { phase: P }],
    ['sessionKey only', { phase: P, sessionKey: SESSION }],
    ['agentId only', { phase: P, agentId: AGENT }],
    ['empty sessionKey', { phase: P, agentId: AGENT, sessionKey: '' }],
    ['someone else\'s agent', { phase: P, agentId: 'aroma-other', sessionKey: SESSION }],
    ['someone else\'s session', { phase: P, agentId: AGENT, sessionKey: 'agent:aroma-other:other' }],
    ['session for a different approval', { phase: P, agentId: AGENT, sessionKey: 'agent:' + AGENT + ':other' }],
    ['non-string', { phase: P, agentId: AGENT, sessionKey: 12345 }]
  ]
  for (const [name, meta] of BAD) {
    const { q, store } = mk()
    q.begin(KEY)
    assert.throws(() => q.markRunning(KEY, meta), /requires the derived (agentId|sessionKey)/, name)
    assert.strictEqual(store.peek()[KEY].state, STATES.PREPARED, name + ': RUNNING was not entered')
  }

  const { q } = mk()
  q.begin(KEY)
  q.markRunning(KEY, { agentId: AGENT, sessionKey: SESSION, phase: P })
  assert.strictEqual(q.record(KEY).agentId, AGENT)
  assert.strictEqual(q.record(KEY).sessionKey, SESSION)
})

/* ══════════════ A4 — CLEANED must not be able to lie about where it came from ══════════════ */

/**
 * ⛔ 'CLEANED' IS THE ONE STATE THAT ANSWERS NO FURTHER QUESTIONS.
 *
 * It holds no lock, blocks nothing, and needs no envelope. Two very different histories end
 * there: a run that never started, and a run that executed and was then retired. If the
 * record does not say WHICH, then a row claiming CLEANED is indistinguishable from a run that
 * was quietly dropped — and CLEANED is exactly the state an attacker or a corrupted write
 * would choose. So provenance is validated on every read.
 */
test('A4. ⛔ a CLEANED record with unaccountable provenance is refused on READ', () => {
  const BAD = [
    ['no provenance at all', { state: 'CLEANED' }],
    ['provenance that is not a no-executor state or retirement', { state: 'CLEANED', cleanedFrom: 'RUNNING' }],
    ['provenance that is not a state at all', { state: 'CLEANED', cleanedFrom: 'yes' }],
    ['retired but with no execution phase', { state: 'CLEANED', cleanedFrom: 'EXECUTOR_RETIRED', agentId: 'aroma-appr_bad', sessionKey: 'agent:aroma-appr_bad:appr_bad', taskStatus: 'succeeded' }],
    ['retired but with an invalid phase', { state: 'CLEANED', cleanedFrom: 'EXECUTOR_RETIRED', phase: 'made_up', agentId: 'aroma-appr_bad', sessionKey: 'agent:aroma-appr_bad:appr_bad', taskStatus: 'succeeded' }],
    ['retired but with no session identity', { state: 'CLEANED', cleanedFrom: 'EXECUTOR_RETIRED', phase: 'task_observed', taskStatus: 'succeeded' }],
    ['retired but with an agentId for someone else', { state: 'CLEANED', cleanedFrom: 'EXECUTOR_RETIRED', phase: 'task_observed', agentId: 'aroma-other', sessionKey: 'agent:aroma-appr_bad:appr_bad', taskStatus: 'succeeded' }],
    ['retired but with a sessionKey for someone else', { state: 'CLEANED', cleanedFrom: 'EXECUTOR_RETIRED', phase: 'task_observed', agentId: 'aroma-appr_bad', sessionKey: 'agent:aroma-other:other', taskStatus: 'succeeded' }],
    ['retired but the task never reached a terminal status', { state: 'CLEANED', cleanedFrom: 'EXECUTOR_RETIRED', phase: 'task_observed', agentId: 'aroma-appr_bad', sessionKey: 'agent:aroma-appr_bad:appr_bad' }],
    ['retired with a non-terminal task status', { state: 'CLEANED', cleanedFrom: 'EXECUTOR_RETIRED', phase: 'task_observed', agentId: 'aroma-appr_bad', sessionKey: 'agent:aroma-appr_bad:appr_bad', taskStatus: 'running' }],
    ['never ran, yet claims a phase', { state: 'CLEANED', cleanedFrom: 'PRE_EXECUTION_ABORTED', phase: 'turn_attempting' }],
    ['never ran, yet claims a task status', { state: 'CLEANED', cleanedFrom: 'PREPARATION_FAILED', taskStatus: 'succeeded' }],
    ['never ran, yet names a session', { state: 'CLEANED', cleanedFrom: 'PRE_EXECUTION_ABORTED', sessionKey: 'agent:aroma-appr_bad:appr_bad' }],
    ['never ran, yet names an agent', { state: 'CLEANED', cleanedFrom: 'PREPARATION_FAILED', agentId: 'aroma-appr_bad' }],
    ['never ran, yet carries a runId', { state: 'CLEANED', cleanedFrom: 'PRE_EXECUTION_ABORTED', runId: 'run_123' }]
  ]

  for (const [name, rec] of BAD) {
    const { q } = mk({ appr_bad: Object.assign({ approvalId: 'appr_bad', updatedAt: '2026-08-28T00:00:00.000Z' }, rec) })
    // ⛔ EVERY READ PATH, not just the one that happens to be called first. The gate that
    // matters is canStart(): if a corrupt row could be read as CLEANED it would silently stop
    // blocking, which is the failure that unlocks execution.
    assert.throws(() => q.canStart('appr_new'), /CLEANED record/, name + ' via canStart')
    assert.throws(() => q.unaccounted(), /CLEANED record/, name + ' via unaccounted')
    assert.throws(() => q.state('appr_bad'), /CLEANED record/, name + ' via state')
    assert.throws(() => q.record('appr_bad'), /CLEANED record/, name + ' via record')
  }
})

test('A5. both legitimate histories read cleanly, and are distinguishable', () => {
  const good = {
    never_ran: {
      approvalId: 'never_ran', state: 'CLEANED', cleanedFrom: 'PRE_EXECUTION_ABORTED', updatedAt: 'x'
    },
    prep_failed: {
      approvalId: 'prep_failed', state: 'CLEANED', cleanedFrom: 'PREPARATION_FAILED', updatedAt: 'x'
    },
    executed: {
      approvalId: 'executed', state: 'CLEANED', cleanedFrom: 'EXECUTOR_RETIRED',
      phase: 'task_observed', agentId: 'aroma-executed',
      sessionKey: 'agent:aroma-executed:executed', taskStatus: 'succeeded', updatedAt: 'x'
    }
  }
  const { q } = mk(good)
  assert.strictEqual(q.canStart('appr_new').ok, true, 'CLEANED rows block nothing')
  assert.deepStrictEqual(q.unaccounted(), [])
  assert.strictEqual(q.record('never_ran').cleanedFrom, 'PRE_EXECUTION_ABORTED')
  assert.strictEqual(q.record('executed').cleanedFrom, 'EXECUTOR_RETIRED')
  assert.strictEqual(q.record('never_ran').taskStatus, undefined, 'a run that never started has no task status')
  assert.strictEqual(q.record('never_ran').sessionKey, undefined, 'and names no session')
  assert.strictEqual(q.record('never_ran').agentId, undefined, 'and no agent')
  assert.strictEqual(q.record('executed').agentId, 'aroma-executed', 'while the executed one is accounted for in full')
  assert.strictEqual(q.record('executed').taskStatus, 'succeeded')
})

test('A6. the provenance a real transition writes is itself accountable', () => {
  // Not a hand-written fixture: drive the two real paths and re-read them through the
  // same validation the corrupt fixtures above are caught by.
  const a = mk(); a.q.begin('appr_x'); a.q.abortPreExecution('appr_x', { reason: 'no executor' }); a.q.markCleaned('appr_x')
  assert.strictEqual(a.q.record('appr_x').cleanedFrom, STATES.PRE_EXECUTION_ABORTED)

  const b = mk(); const K = 'appr_y'
  b.q.begin(K)
  b.q.markRunning(K, { agentId: 'aroma-' + K, sessionKey: 'agent:aroma-' + K + ':' + K, phase: 'executor_launch_attempting' })
  b.q.advancePhase(K, 'task_observed')
  b.q.markSucceeded(K); b.q.observeTerminal(K, 'succeeded')
  retireAndClean(b.q, K)
  assert.strictEqual(b.q.record(K).cleanedFrom, STATES.EXECUTOR_RETIRED)
  assert.strictEqual(b.q.record(K).phase, 'task_observed', 'the execution evidence survives into CLEANED')
  assert.strictEqual(b.q.record(K).agentId, 'aroma-' + K, 'with the identity it would be found by')
  assert.strictEqual(b.q.record(K).sessionKey, 'agent:aroma-' + K + ':' + K)
  assert.strictEqual(b.q.record(K).taskStatus, 'succeeded', 'and the terminal status it ended at')
})

test('A7. ⛔ the record merge itself puts the module\u2019s values above caller metadata', () => {
  // Reached directly, because it cannot be reached through the public API: assertNoReservedKeys
  // throws first, so meta and authoritative always have disjoint keys by the time put() merges
  // them. That made a swapped-argument mutation survive the entire suite. The ordering is the
  // second line of defence and is tested as one.
  const forged = {
    state: 'CLEANED',
    phase: 'task_observed',
    taskStatus: 'succeeded',
    cleanedFrom: 'EXECUTOR_RETIRED',
    note: 'ordinary metadata'
  }
  const authoritative = { state: 'RUNNING', phase: 'executor_launch_attempting' }
  const stamp = { approvalId: 'appr_real', updatedAt: '2026-08-28T00:00:00.000Z' }

  const out = mergeRecord({ startedAt: 'earlier', state: 'PREPARED' }, forged, authoritative, stamp)

  assert.strictEqual(out.state, 'RUNNING', 'the module authors the state, not the caller')
  assert.strictEqual(out.phase, 'executor_launch_attempting', 'and the phase')
  assert.strictEqual(out.approvalId, 'appr_real', 'the identity stamp outranks everything')
  assert.strictEqual(out.updatedAt, stamp.updatedAt)
  assert.strictEqual(out.startedAt, 'earlier', 'and the previous record still shows through')
  assert.strictEqual(out.note, 'ordinary metadata', 'while ordinary metadata is preserved')
})

test('A8. ⛔ the reserved list covers every field the module authors', () => {
  // The two defences are only independent if they cover the same fields. If an authoritative
  // field is ever added without reserving it, the throw stops firing for that field and the
  // merge order silently becomes the only guard — which is how this class of defect returns.
  const AUTHORED = ['state', 'phase', 'taskStatus', 'approvalId', 'updatedAt', 'cleanedFrom', 'agentId', 'sessionKey']
  const { q } = mk()
  q.begin('appr_cover')
  q.markRunning('appr_cover', { agentId: 'aroma-appr_cover', sessionKey: 'agent:aroma-appr_cover:appr_cover', phase: 'executor_launch_attempting' })
  for (const key of AUTHORED) {
    assert.throws(
      () => q.markSucceeded('appr_cover', { [key]: 'anything' }),
      new RegExp("'" + key + "' is authoritative"),
      key + ' is authored by the module, so it must also be reserved'
    )
  }
})

/* ══════════════ B4a — THE OS OBSERVATION, AND THE SECOND VERIFICATION ══════════════ */

const {
  PHASES, LEGACY_PHASES, READABLE_PHASES, phaseIndex, EXECUTION_BEARING
} = require('../agent/openClawQuarantine')

const CANON = PHASES[0]
const LEGACY = 'agent_add_attempting'
const openRunning = (q, id) => {
  q.begin(id)
  q.markRunning(id, { agentId: 'aroma-' + id, sessionKey: 'agent:aroma-' + id + ':' + id, phase: CANON })
}

/** A verifier that counts its calls and can change its mind between them. */
function countingVerifier (answers) {
  const calls = []
  const fn = (proof, expect) => {
    calls.push({ approvalId: expect && expect.approvalId })
    const a = answers.length > 1 ? answers.shift() : answers[0]
    return typeof a === 'function' ? a() : a
  }
  fn.calls = calls
  return fn
}

test('T1. ⛔ RUNNING -> EXECUTOR_RETIRED is NOT a legal edge: retirement is never one step', () => {
  const q = createOpenClawQuarantine({ store: memStore(), verifyRetirementProof: () => true })
  openRunning(q, 'appr_t1')
  assert.throws(() => q.retire('appr_t1', fakeRetirementProof('appr_t1')),
    /illegal quarantine transition RUNNING -> EXECUTOR_RETIRED/)
  assert.strictEqual(q.state('appr_t1'), STATES.RUNNING, 'and the record did not move')
  assert.strictEqual(q.canStart('appr_other').ok, false, 'the lock is still held')
})

test('T2. the whole approved path runs: RUNNING -> EXECUTOR_GONE_OBSERVED -> EXECUTOR_RETIRED -> CLEANED', () => {
  const v = countingVerifier([true])
  const q = createOpenClawQuarantine({ store: memStore(), verifyRetirementProof: v })
  openRunning(q, 'appr_t2')
  q.observeExecutorGone('appr_t2', fakeRetirementProof('appr_t2'))
  assert.strictEqual(q.state('appr_t2'), STATES.EXECUTOR_GONE_OBSERVED)
  q.retire('appr_t2', fakeRetirementProof('appr_t2'))
  assert.strictEqual(q.state('appr_t2'), STATES.EXECUTOR_RETIRED)
  q.markCleaned('appr_t2')
  assert.strictEqual(q.record('appr_t2').cleanedFrom, STATES.EXECUTOR_RETIRED)
  assert.strictEqual(v.calls.length, 2, 'the verifier was consulted at BOTH transitions')
})

test('T3. ⛔ EXECUTOR_GONE_OBSERVED HOLDS THE LOCK: observing is not releasing', () => {
  const q = createOpenClawQuarantine({ store: memStore(), verifyRetirementProof: () => true })
  openRunning(q, 'appr_t3')
  q.observeExecutorGone('appr_t3', fakeRetirementProof('appr_t3'))
  assert.ok(UNACCOUNTED.includes(STATES.EXECUTOR_GONE_OBSERVED))
  const gate = q.canStart('appr_new')
  assert.strictEqual(gate.ok, false, 'a second execution is still refused')
  assert.deepStrictEqual(gate.blockedBy, [{ approvalId: 'appr_t3', state: STATES.EXECUTOR_GONE_OBSERVED }])
  // and only after the second verification does the lock actually release
  q.retire('appr_t3', fakeRetirementProof('appr_t3'))
  assert.strictEqual(q.canStart('appr_new').ok, true)
})

test('T4. the observed-gone record is reported by unaccounted(), so nothing is quietly forgotten', () => {
  const q = createOpenClawQuarantine({ store: memStore(), verifyRetirementProof: () => true })
  openRunning(q, 'appr_t4')
  q.observeExecutorGone('appr_t4', fakeRetirementProof('appr_t4'))
  assert.deepStrictEqual(q.unaccounted().map((r) => [r.approvalId, r.state]),
    [['appr_t4', STATES.EXECUTOR_GONE_OBSERVED]])
})

test('T5. ⛔ the new state is execution-bearing: a record without a phase is refused on READ', () => {
  assert.ok(EXECUTION_BEARING.includes(STATES.EXECUTOR_GONE_OBSERVED))
  const bad = memStore({ appr_t5: { approvalId: 'appr_t5', state: STATES.EXECUTOR_GONE_OBSERVED } })
  const q = createOpenClawQuarantine({ store: bad, verifyRetirementProof: () => true })
  assert.throws(() => q.state('appr_t5'), /is EXECUTOR_GONE_OBSERVED but carries no execution phase/)
})

test('T6. ⛔ FIRST-VERIFICATION GATE: a false verifier cannot record an observed-gone executor', () => {
  const q = createOpenClawQuarantine({ store: memStore(), verifyRetirementProof: () => false })
  openRunning(q, 'appr_t6')
  assert.throws(() => q.observeExecutorGone('appr_t6', fakeRetirementProof('appr_t6')),
    /cannot record an observed-gone executor without a verified OS retirement proof/)
  assert.strictEqual(q.state('appr_t6'), STATES.RUNNING, 'nothing was written')
  // the production DEFAULT refuses too — an unwired ledger cannot even observe
  const bare = createOpenClawQuarantine({ store: memStore() })
  openRunning(bare, 'appr_t6b')
  assert.throws(() => bare.observeExecutorGone('appr_t6b', fakeRetirementProof('appr_t6b')),
    /without a verified OS retirement proof/)
  assert.strictEqual(bare.state('appr_t6b'), STATES.RUNNING)
})

test('T7. ⛔ TRUTHY IS NOT true: every non-boolean verifier answer is refused at BOTH transitions', () => {
  // Object(true) is a boxed Boolean: truthy, but not the primitive true.
  for (const truthy of [1, 'yes', {}, { ok: false }, [], 'false', Object(true)]) {
    const q = createOpenClawQuarantine({ store: memStore(), verifyRetirementProof: () => truthy })
    openRunning(q, 'appr_t7')
    assert.throws(() => q.observeExecutorGone('appr_t7', fakeRetirementProof('appr_t7')),
      /without a verified OS retirement proof/, 'observe rejects ' + JSON.stringify(String(truthy)))
    assert.strictEqual(q.state('appr_t7'), STATES.RUNNING)

    // and the same at retire(), reached through a legitimately observed record
    const q2 = createOpenClawQuarantine({ store: memStore(), verifyRetirementProof: countingVerifier([true, truthy]) })
    openRunning(q2, 'appr_t7b')
    q2.observeExecutorGone('appr_t7b', fakeRetirementProof('appr_t7b'))
    assert.throws(() => q2.retire('appr_t7b', fakeRetirementProof('appr_t7b')),
      /without a freshly verified session-retirement proof/, 'retire rejects ' + JSON.stringify(String(truthy)))
    assert.strictEqual(q2.state('appr_t7b'), STATES.EXECUTOR_GONE_OBSERVED, 'and the lock is still held')
  }
})

test('T8. ⛔ THE VERIFICATION IS FRESH: retire() invokes the verifier again, never reusing the first verdict', () => {
  const v = countingVerifier([true])
  const q = createOpenClawQuarantine({ store: memStore(), verifyRetirementProof: v })
  openRunning(q, 'appr_t8')
  q.observeExecutorGone('appr_t8', fakeRetirementProof('appr_t8'))
  assert.strictEqual(v.calls.length, 1)
  q.retire('appr_t8', fakeRetirementProof('appr_t8'))
  assert.strictEqual(v.calls.length, 2, 'retire() must call the verifier itself')
  assert.deepStrictEqual(v.calls, [{ approvalId: 'appr_t8' }, { approvalId: 'appr_t8' }],
    'and the ledger supplies the approvalId at both calls')
})

test('T9. ⛔ THE WORLD CHANGED BACK: observed gone, then LIVE at retire — the lock STAYS HELD', () => {
  const v = countingVerifier([true, false])
  const q = createOpenClawQuarantine({ store: memStore(), verifyRetirementProof: v })
  openRunning(q, 'appr_t9')
  q.observeExecutorGone('appr_t9', fakeRetirementProof('appr_t9'))
  assert.throws(() => q.retire('appr_t9', fakeRetirementProof('appr_t9')),
    /without a freshly verified session-retirement proof/)
  assert.strictEqual(q.state('appr_t9'), STATES.EXECUTOR_GONE_OBSERVED, 'the observation stands')
  assert.strictEqual(q.canStart('appr_new').ok, false, 'the executor may be alive again: still locked')
  assert.strictEqual(q.mayCleanup('appr_t9').ok, false, 'and the workspace survives')
  assert.match(q.mayCleanup('appr_t9').reason, /EXECUTOR_GONE_OBSERVED/)
})

test('T10. only a completed retirement releases the lock', () => {
  const q = createOpenClawQuarantine({ store: memStore(), verifyRetirementProof: () => true })
  openRunning(q, 'appr_t10')
  assert.strictEqual(q.canStart('x').ok, false)
  q.observeExecutorGone('appr_t10', fakeRetirementProof('appr_t10'))
  assert.strictEqual(q.canStart('x').ok, false)
  q.retire('appr_t10', fakeRetirementProof('appr_t10'))
  assert.strictEqual(q.canStart('x').ok, true)
  assert.ok(!UNACCOUNTED.includes(STATES.EXECUTOR_RETIRED))
})

test('T11. ⛔ REPEAT CALLS FAIL CLOSED: neither transition may be taken twice', () => {
  const q = createOpenClawQuarantine({ store: memStore(), verifyRetirementProof: () => true })
  openRunning(q, 'appr_t11')
  q.observeExecutorGone('appr_t11', fakeRetirementProof('appr_t11'))
  assert.throws(() => q.observeExecutorGone('appr_t11', fakeRetirementProof('appr_t11')),
    /illegal quarantine transition EXECUTOR_GONE_OBSERVED -> EXECUTOR_GONE_OBSERVED/)
  const firstStamp = q.record('appr_t11').goneObservedAt
  q.retire('appr_t11', fakeRetirementProof('appr_t11'))
  assert.throws(() => q.retire('appr_t11', fakeRetirementProof('appr_t11')),
    /illegal quarantine transition EXECUTOR_RETIRED -> EXECUTOR_RETIRED/)
  assert.strictEqual(q.record('appr_t11').goneObservedAt, firstStamp, 'the original observation is never restamped')
  assert.strictEqual(q.state('appr_t11'), STATES.EXECUTOR_RETIRED)
})

test('T12. a HISTORICAL legacy-phase record still reads, advances and retires — without being rewritten', () => {
  const seed = {
    appr_old: {
      approvalId: 'appr_old', state: STATES.RUNNING, phase: LEGACY,
      agentId: 'aroma-appr_old', sessionKey: 'agent:aroma-appr_old:appr_old', updatedAt: 'then'
    }
  }
  const store = memStore(seed)
  const q = createOpenClawQuarantine({ store, verifyRetirementProof: () => true })
  assert.strictEqual(q.state('appr_old'), STATES.RUNNING, 'the old ledger is still readable')
  q.advancePhase('appr_old', 'agent_observed')
  assert.strictEqual(q.record('appr_old').phase, 'agent_observed', 'and it can still move forward')

  // a legacy record that never advanced can still complete the whole retirement path
  const store2 = memStore(seed)
  const q2 = createOpenClawQuarantine({ store: store2, verifyRetirementProof: () => true })
  q2.observeExecutorGone('appr_old', fakeRetirementProof('appr_old'))
  q2.retire('appr_old', fakeRetirementProof('appr_old'))
  q2.markCleaned('appr_old')
  assert.strictEqual(q2.record('appr_old').cleanedFrom, STATES.EXECUTOR_RETIRED)
  assert.strictEqual(q2.record('appr_old').phase, LEGACY, 'and its historical phase was never rewritten')
})

test('T13. ⛔ THE LEGACY PHASE IS NOT WRITABLE: it cannot open a run nor be advanced to', () => {
  const q = createOpenClawQuarantine({ store: memStore(), verifyRetirementProof: () => true })
  q.begin('appr_t13')
  assert.throws(() => q.markRunning('appr_t13', {
    agentId: 'aroma-appr_t13', sessionKey: 'agent:aroma-appr_t13:appr_t13', phase: LEGACY
  }), new RegExp('markRunning must open at phase .' + CANON + '.'))
  assert.strictEqual(q.state('appr_t13'), STATES.PREPARED, 'nothing opened')
  openRunning(q, 'appr_t13b')
  assert.throws(() => q.advancePhase('appr_t13b', LEGACY), /unknown execution phase 'agent_add_attempting'/)
  assert.strictEqual(q.record('appr_t13b').phase, CANON)
})

test('T14. ⛔ HISTORY IS NEVER MIGRATED: reading a legacy record does not rewrite the bytes on disk', () => {
  const store = memStore({
    appr_hist: {
      approvalId: 'appr_hist', state: STATES.RUNNING, phase: LEGACY,
      agentId: 'aroma-appr_hist', sessionKey: 'agent:aroma-appr_hist:appr_hist', updatedAt: 'then'
    }
  })
  const before = JSON.stringify(store.peek())
  const q = createOpenClawQuarantine({ store, verifyRetirementProof: () => true })
  q.state('appr_hist'); q.record('appr_hist'); q.unaccounted(); q.canStart('appr_other')
  assert.strictEqual(JSON.stringify(store.peek()), before, 'pure reads wrote nothing at all')
  q.observeExecutorGone('appr_hist', fakeRetirementProof('appr_hist'))
  assert.strictEqual(store.peek().appr_hist.phase, LEGACY, 'and a write elsewhere still did not touch the phase')
})

test('T15. ⛔ goneObservedAt is the ledger own stamp and cannot be supplied by a caller', () => {
  const q = createOpenClawQuarantine({ store: memStore(), verifyRetirementProof: () => true })
  openRunning(q, 'appr_t15')
  assert.throws(() => q.observeExecutorGone('appr_t15', fakeRetirementProof('appr_t15'), { goneObservedAt: 'yesterday' }),
    /'goneObservedAt' is authoritative and cannot be supplied/)
  assert.strictEqual(q.state('appr_t15'), STATES.RUNNING, 'the forged attempt wrote nothing')
  q.observeExecutorGone('appr_t15', fakeRetirementProof('appr_t15'), { note: 'ordinary metadata is fine' })
  const rec = q.record('appr_t15')
  assert.match(rec.goneObservedAt, /^\d{4}-\d{2}-\d{2}T/, 'the module stamped it')
  assert.strictEqual(rec.note, 'ordinary metadata is fine')
})

test('T16. ⛔ an observed-gone record can never be cleaned directly: it must retire first', () => {
  const q = createOpenClawQuarantine({ store: memStore(), verifyRetirementProof: () => true })
  openRunning(q, 'appr_t16')
  q.observeExecutorGone('appr_t16', fakeRetirementProof('appr_t16'))
  assert.strictEqual(q.mayCleanup('appr_t16').ok, false)
  assert.throws(() => q.markCleaned('appr_t16'),
    /illegal quarantine transition EXECUTOR_GONE_OBSERVED -> CLEANED/)
  // and the provenance vocabulary was not widened to admit it
  const forged = memStore({
    appr_bad: { approvalId: 'appr_bad', state: STATES.CLEANED, cleanedFrom: STATES.EXECUTOR_GONE_OBSERVED }
  })
  const q2 = createOpenClawQuarantine({ store: forged, verifyRetirementProof: () => true })
  assert.throws(() => q2.state('appr_bad'), /missing or unknown provenance 'EXECUTOR_GONE_OBSERVED'/)
})

test('T17. the phase vocabulary is exactly one canonical list plus a read-only history', () => {
  assert.deepStrictEqual(PHASES.slice(),
    ['executor_launch_attempting', 'agent_observed', 'turn_attempting', 'task_observed'])
  assert.deepStrictEqual(LEGACY_PHASES.slice(), [LEGACY])
  assert.deepStrictEqual(READABLE_PHASES.slice(), PHASES.concat(LEGACY_PHASES))
  assert.ok(!PHASES.includes(LEGACY), 'the legacy name is not canonical vocabulary')
  assert.strictEqual(phaseIndex(LEGACY), 0, 'it occupies the opening slot for monotonicity only')
  assert.strictEqual(phaseIndex(CANON), 0)
  assert.strictEqual(phaseIndex('task_observed'), 3)
  assert.strictEqual(phaseIndex('not_a_phase'), -1)
  assert.ok(Object.isFrozen(PHASES) && Object.isFrozen(LEGACY_PHASES) && Object.isFrozen(READABLE_PHASES))
})

test('T18. the transport writes the ledger canonical opening phase — pinned, since it cannot import it', () => {
  const src = fs.readFileSync(path.join(__dirname, 'openClawTransport.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  assert.ok(code.includes("phase: '" + CANON + "'"), 'the transport opens at the canonical phase')
  assert.ok(!code.includes(LEGACY), 'and no longer mentions the legacy phase at all')
  assert.strictEqual((code.match(/markRunning\(/g) || []).length, 1, 'there is still exactly one opening site')
})

test('T19. ⛔ the TWO retirement histories are each accounted for in full, and can never be blurred', () => {
  // (a) task-observed retirement: a real terminal status, and no gone-stamp
  const a = createOpenClawQuarantine({ store: memStore(), verifyRetirementProof: () => true })
  openRunning(a, 'appr_task')
  a.observeTerminal('appr_task', 'failed')
  a.retire('appr_task', fakeRetirementProof('appr_task'))
  a.markCleaned('appr_task')
  const recA = a.record('appr_task')
  assert.strictEqual(recA.taskStatus, 'failed')
  assert.strictEqual(recA.goneObservedAt, undefined, 'no OS observation was involved')

  // (b) OS-observed retirement: a gone-stamp, and deliberately NO task status
  const b = createOpenClawQuarantine({ store: memStore(), verifyRetirementProof: () => true })
  openRunning(b, 'appr_gone')
  b.observeExecutorGone('appr_gone', fakeRetirementProof('appr_gone'))
  b.retire('appr_gone', fakeRetirementProof('appr_gone'))
  b.markCleaned('appr_gone')
  const recB = b.record('appr_gone')
  assert.match(recB.goneObservedAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.strictEqual(recB.taskStatus, undefined, 'no task existed, so none is invented')

  // ⛔ a truncated OS-observed history is refused: the stamp must be readable
  const bad1 = createOpenClawQuarantine({
    store: memStore({ appr_x: Object.assign({}, recB, { approvalId: 'appr_x', agentId: 'aroma-appr_x', sessionKey: 'agent:aroma-appr_x:appr_x', goneObservedAt: '' }) }),
    verifyRetirementProof: () => true
  })
  assert.throws(() => bad1.state('appr_x'), /observed-gone stamp is unreadable/)

  // ⛔ and a record claiming BOTH histories is refused: they are mutually exclusive
  const bad2 = createOpenClawQuarantine({
    store: memStore({ appr_y: Object.assign({}, recB, { approvalId: 'appr_y', agentId: 'aroma-appr_y', sessionKey: 'agent:aroma-appr_y:appr_y', taskStatus: 'succeeded' }) }),
    verifyRetirementProof: () => true
  })
  assert.throws(() => bad2.state('appr_y'), /claims BOTH an OS observation and a task status/)

  // ⛔ and a task-observed history with neither status nor stamp is still refused
  const bad3 = createOpenClawQuarantine({
    store: memStore({ appr_z: { approvalId: 'appr_z', state: STATES.CLEANED, cleanedFrom: STATES.EXECUTOR_RETIRED, phase: CANON, agentId: 'aroma-appr_z', sessionKey: 'agent:aroma-appr_z:appr_z' } }),
    verifyRetirementProof: () => true
  })
  assert.throws(() => bad3.state('appr_z'), /carries NEITHER a terminal task status NOR an observed-gone stamp/)
})

/* ══════════════ B4a CORRECTION — OWNERSHIP, AND EVIDENCE BEFORE THE UNLOCK ══════════════ */

/** A record shaped like a real one, so each test varies exactly one thing. */
const retiredBase = (id, extra) => Object.assign({
  approvalId: id, state: STATES.EXECUTOR_RETIRED, phase: CANON,
  agentId: 'aroma-' + id, sessionKey: 'agent:aroma-' + id + ':' + id, updatedAt: 'then'
}, extra)
const cleanedBase = (id, extra) => Object.assign(retiredBase(id, extra), {
  state: STATES.CLEANED, cleanedFrom: STATES.EXECUTOR_RETIRED
})
/**
 * ⛔ A STORE THAT DOES NOT SERIALIZE, ON PURPOSE.
 *
 * memStore round-trips through JSON, and JSON.stringify DELETES keys whose value is undefined —
 * so a record owning `goneObservedAt: undefined` silently loses the field before the validator
 * ever sees it, and the test would pass for the wrong reason. (On a real file-backed store the
 * same is true: undefined is not representable in JSON, so only the `null` variants can actually
 * arrive from disk. The undefined variants are still asserted here because the validator must be
 * correct about ownership regardless of how a record reaches it.)
 */
const rawStore = (seed) => ({ read: () => seed, write: () => {}, peek: () => seed })
const ledgerOf = (rec) => createOpenClawQuarantine({
  store: rawStore({ [rec.approvalId]: rec }), verifyRetirementProof: () => true
})

test('T20. ⛔ BLOCKER 1 — a task history that OWNS goneObservedAt is refused, even when the value is null/undefined', () => {
  for (const value of [null, undefined]) {
    const rec = cleanedBase('appr_n', { taskStatus: 'failed', goneObservedAt: value })
    assert.ok(Object.prototype.hasOwnProperty.call(rec, 'goneObservedAt'), 'the field is genuinely OWNED')
    assert.throws(() => ledgerOf(rec).state('appr_n'),
      /claims BOTH an OS observation and a task status/,
      'own goneObservedAt=' + JSON.stringify(value) + ' must not read as absent')
  }
  // the same at EXECUTOR_RETIRED, before any cleanup is involved
  for (const value of [null, undefined]) {
    const rec = retiredBase('appr_n2', { taskStatus: 'failed', goneObservedAt: value })
    assert.throws(() => ledgerOf(rec).state('appr_n2'), /claims BOTH an OS observation and a task status/)
  }
})

test('T21. ⛔ BLOCKER 1 — an OS history that OWNS taskStatus is refused, even when the value is null/undefined', () => {
  for (const value of [null, undefined]) {
    const rec = cleanedBase('appr_o', { goneObservedAt: '2026-09-04T00:00:00.000Z', taskStatus: value })
    assert.throws(() => ledgerOf(rec).state('appr_o'),
      /claims BOTH an OS observation and a task status/,
      'own taskStatus=' + JSON.stringify(value) + ' must not read as absent')
  }
  for (const value of [null, undefined]) {
    const rec = retiredBase('appr_o2', { goneObservedAt: '2026-09-04T00:00:00.000Z', taskStatus: value })
    assert.throws(() => ledgerOf(rec).state('appr_o2'), /claims BOTH an OS observation and a task status/)
  }
})

test('T22. ⛔ BLOCKER 2 — EXECUTOR_GONE_OBSERVED is refused on READ unless its stamp is own and readable', () => {
  const gone = (extra) => Object.assign({
    approvalId: 'appr_g', state: STATES.EXECUTOR_GONE_OBSERVED, phase: CANON,
    agentId: 'aroma-appr_g', sessionKey: 'agent:aroma-appr_g:appr_g'
  }, extra)
  // missing entirely
  assert.throws(() => ledgerOf(gone({})).state('appr_g'), /observed-gone stamp is missing or unreadable/)
  // present but unusable, by value or by type
  for (const bad of [null, undefined, '', 0, 1757000000000, true, {}, [], { toString: () => 'x' }]) {
    assert.throws(() => ledgerOf(gone({ goneObservedAt: bad })).state('appr_g'),
      /observed-gone stamp is missing or unreadable/, 'stamp ' + JSON.stringify(bad) + ' must be refused')
  }
  // and a legitimate one still reads
  assert.strictEqual(ledgerOf(gone({ goneObservedAt: '2026-09-04T00:00:00.000Z' })).state('appr_g'),
    STATES.EXECUTOR_GONE_OBSERVED)
})

test('T23. ⛔ EXECUTOR_GONE_OBSERVED carrying ANY own taskStatus is refused', () => {
  for (const value of ['succeeded', 'failed', null, undefined]) {
    const rec = {
      approvalId: 'appr_gt', state: STATES.EXECUTOR_GONE_OBSERVED, phase: CANON,
      agentId: 'aroma-appr_gt', sessionKey: 'agent:aroma-appr_gt:appr_gt',
      goneObservedAt: '2026-09-04T00:00:00.000Z', taskStatus: value
    }
    assert.throws(() => ledgerOf(rec).state('appr_gt'),
      /is EXECUTOR_GONE_OBSERVED but also claims a task status/, 'taskStatus=' + JSON.stringify(value))
  }
})

test('T24. ⛔ BLOCKER 2 — EXECUTOR_RETIRED with NO evidence is refused on read, so canStart() can never unlock on it', () => {
  const rec = retiredBase('appr_none')
  const q = ledgerOf(rec)
  assert.throws(() => q.state('appr_none'), /carries NEITHER a terminal task status NOR an observed-gone stamp/)
  // ⛔ the unlock path itself must refuse, not return ok:true
  assert.throws(() => q.canStart('appr_fresh'), /carries NEITHER a terminal task status NOR an observed-gone stamp/)
  assert.throws(() => q.unaccounted(), /carries NEITHER/)
  assert.throws(() => q.record('appr_none'), /carries NEITHER/)
  // the same for a CLEANED row with no history at all
  assert.throws(() => ledgerOf(cleanedBase('appr_none2')).state('appr_none2'), /carries NEITHER/)
})

test('T25. ⛔ EXECUTOR_RETIRED carrying BOTH histories is refused, at read and at the unlock gate', () => {
  const rec = retiredBase('appr_both', { taskStatus: 'failed', goneObservedAt: '2026-09-04T00:00:00.000Z' })
  const q = ledgerOf(rec)
  assert.throws(() => q.state('appr_both'), /claims BOTH an OS observation and a task status/)
  assert.throws(() => q.canStart('appr_fresh'), /claims BOTH an OS observation and a task status/)
})

test('T26. ⛔ a retired record whose single history is malformed is refused', () => {
  // OS history, unreadable stamp
  for (const bad of ['', null, undefined, 5, {}]) {
    assert.throws(() => ledgerOf(retiredBase('appr_bs', { goneObservedAt: bad })).state('appr_bs'),
      /(observed-gone stamp is unreadable|carries NEITHER)/, 'stamp ' + JSON.stringify(bad))
  }
  // task history, non-terminal status
  for (const bad of ['running', 'pending', '', 7]) {
    assert.throws(() => ledgerOf(retiredBase('appr_ts', { taskStatus: bad })).state('appr_ts'),
      /never reached a terminal status/, 'status ' + JSON.stringify(bad))
  }
})

test('T27. ⛔ no state OUTSIDE the retirement path may carry an observed-gone stamp', () => {
  const states = [
    [STATES.PREPARED, {}],
    [STATES.RUNNING, { phase: CANON }],
    [STATES.SUCCEEDED, { phase: CANON }],
    [STATES.CLIENT_TIMEOUT, { phase: CANON }],
    [STATES.QUARANTINED, { phase: CANON }],
    [STATES.TERMINAL_OBSERVED, { phase: CANON, taskStatus: 'failed' }],
    [STATES.PRE_EXECUTION_ABORTED, {}],
    [STATES.PREPARATION_FAILED, {}]
  ]
  for (const [state, extra] of states) {
    for (const value of ['2026-09-04T00:00:00.000Z', null, undefined]) {
      const rec = Object.assign({ approvalId: 'appr_s', state, goneObservedAt: value }, extra)
      if (state === STATES.RUNNING || state === STATES.SUCCEEDED || state === STATES.CLIENT_TIMEOUT ||
          state === STATES.QUARANTINED || state === STATES.TERMINAL_OBSERVED) {
        rec.agentId = 'aroma-appr_s'; rec.sessionKey = 'agent:aroma-appr_s:appr_s'
      }
      assert.throws(() => ledgerOf(rec).state('appr_s'),
        /carries an observed-gone stamp, which only a retirement may hold/,
        state + ' with goneObservedAt=' + JSON.stringify(value))
    }
  }
  // and a CLEANED row from a never-executed history may not carry one either
  const c = { approvalId: 'appr_pe', state: STATES.CLEANED, cleanedFrom: STATES.PRE_EXECUTION_ABORTED, goneObservedAt: null }
  assert.throws(() => ledgerOf(c).state('appr_pe'), /claims execution evidence goneObservedAt/)
})

test('T28. both legitimate retired histories still read, and both legitimate flows still complete', () => {
  // stored task-retired record
  const t = ledgerOf(retiredBase('appr_ok_t', { taskStatus: 'failed' }))
  assert.strictEqual(t.state('appr_ok_t'), STATES.EXECUTOR_RETIRED)
  assert.strictEqual(t.canStart('appr_fresh').ok, true, 'a properly accounted retirement releases the lock')
  // stored OS-retired record
  const o = ledgerOf(retiredBase('appr_ok_o', { goneObservedAt: '2026-09-04T00:00:00.000Z' }))
  assert.strictEqual(o.state('appr_ok_o'), STATES.EXECUTOR_RETIRED)
  assert.strictEqual(o.canStart('appr_fresh').ok, true)
  // stored CLEANED rows of both kinds
  assert.strictEqual(ledgerOf(cleanedBase('appr_ck_t', { taskStatus: 'lost' })).state('appr_ck_t'), STATES.CLEANED)
  assert.strictEqual(ledgerOf(cleanedBase('appr_ck_o', { goneObservedAt: '2026-09-04T00:00:00.000Z' })).state('appr_ck_o'), STATES.CLEANED)

  // and the two live flows, end to end, through the real transitions
  const a = createOpenClawQuarantine({ store: memStore(), verifyRetirementProof: () => true })
  openRunning(a, 'appr_flow_t')
  a.observeTerminal('appr_flow_t', 'failed'); a.retire('appr_flow_t', fakeRetirementProof('appr_flow_t')); a.markCleaned('appr_flow_t')
  assert.strictEqual(a.record('appr_flow_t').taskStatus, 'failed')
  assert.ok(!Object.prototype.hasOwnProperty.call(a.record('appr_flow_t'), 'goneObservedAt'))

  const b = createOpenClawQuarantine({ store: memStore(), verifyRetirementProof: () => true })
  openRunning(b, 'appr_flow_o')
  b.observeExecutorGone('appr_flow_o', fakeRetirementProof('appr_flow_o'))
  b.retire('appr_flow_o', fakeRetirementProof('appr_flow_o')); b.markCleaned('appr_flow_o')
  assert.ok(!Object.prototype.hasOwnProperty.call(b.record('appr_flow_o'), 'taskStatus'))
  assert.match(b.record('appr_flow_o').goneObservedAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.strictEqual(b.canStart('appr_fresh').ok, true)
})

test('T29. ⛔ the correction changed NOTHING that was already approved', () => {
  // the lock membership
  assert.ok(UNACCOUNTED.includes(STATES.EXECUTOR_GONE_OBSERVED))
  assert.ok(!UNACCOUNTED.includes(STATES.EXECUTOR_RETIRED))
  // no one-step retirement
  const q = createOpenClawQuarantine({ store: memStore(), verifyRetirementProof: () => true })
  openRunning(q, 'appr_still')
  assert.throws(() => q.retire('appr_still', fakeRetirementProof('appr_still')),
    /illegal quarantine transition RUNNING -> EXECUTOR_RETIRED/)
  // two independent strict-boolean verifications
  const v = countingVerifier([true])
  const q2 = createOpenClawQuarantine({ store: memStore(), verifyRetirementProof: v })
  openRunning(q2, 'appr_two')
  q2.observeExecutorGone('appr_two', fakeRetirementProof('appr_two'))
  q2.retire('appr_two', fakeRetirementProof('appr_two'))
  assert.strictEqual(v.calls.length, 2)
  const q3 = createOpenClawQuarantine({ store: memStore(), verifyRetirementProof: () => 1 })
  openRunning(q3, 'appr_truthy')
  assert.throws(() => q3.observeExecutorGone('appr_truthy', fakeRetirementProof('appr_truthy')), /without a verified OS retirement proof/)
  // legacy phase: readable, not writable, not migrated
  assert.ok(READABLE_PHASES.includes(LEGACY) && !PHASES.includes(LEGACY))
  const store = memStore({ appr_leg: { approvalId: 'appr_leg', state: STATES.RUNNING, phase: LEGACY, agentId: 'aroma-appr_leg', sessionKey: 'agent:aroma-appr_leg:appr_leg' } })
  const q4 = createOpenClawQuarantine({ store, verifyRetirementProof: () => true })
  q4.state('appr_leg')
  assert.strictEqual(store.peek().appr_leg.phase, LEGACY, 'still never migrated')
})
