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
  q.markRunning('appr_1', { agentId: 'aroma-appr_1', sessionKey: 'agent:aroma-appr_1:appr_1', phase: 'agent_add_attempting' })
  assert.strictEqual(q.state('appr_1'), STATES.RUNNING)
  q.markClientTimeout('appr_1')
  assert.strictEqual(q.state('appr_1'), STATES.CLIENT_TIMEOUT)
  q.quarantine('appr_1')
  assert.strictEqual(q.state('appr_1'), STATES.QUARANTINED)
})

test('Q1b. the happy path still reaches CLEANED', () => {
  const { q } = mk()
  q.begin('appr_ok')
  q.markRunning('appr_ok', { agentId: 'aroma-appr_ok', sessionKey: 'agent:aroma-appr_ok:appr_ok', phase: 'agent_add_attempting' })
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
  q.markRunning('appr_t', { agentId: 'aroma-appr_t', sessionKey: 'agent:aroma-appr_t:appr_t', phase: 'agent_add_attempting' })
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
  assert.throws(() => q.markRunning('never_began', { agentId: 'aroma-never_began', sessionKey: 'agent:aroma-never_began:never_began', phase: 'agent_add_attempting' }), /has no quarantine record/)
})

test('Q2c. only a real terminal task status counts as an observation', () => {
  const { q } = mk()
  q.begin('a2'); q.markRunning('a2', { agentId: 'aroma-a2', sessionKey: 'agent:aroma-a2:a2', phase: 'agent_add_attempting' }); q.markClientTimeout('a2'); q.quarantine('a2')
  for (const bad of ['running', 'queued', 'done', 'ok', '', null, undefined]) {
    assert.throws(() => q.observeTerminal('a2', bad), /not a terminal OpenClaw task status/)
  }
  for (const good of ['succeeded', 'failed', 'timed_out', 'cancelled', 'lost']) {
    const { q: q2 } = mk()
    q2.begin('x'); q2.markRunning('x', { agentId: 'aroma-x', sessionKey: 'agent:aroma-x:x', phase: 'agent_add_attempting' }); q2.markClientTimeout('x'); q2.quarantine('x')
    q2.observeTerminal('x', good)
    assert.strictEqual(q2.state('x'), STATES.TERMINAL_OBSERVED, good)
  }
})

/* ══════════════ Q3 — the lock is global ══════════════ */

test('Q3. ⛔ a DIFFERENT approval is blocked while any quarantine is live', () => {
  // The unaccounted-for thing is a process. A fresh approvalId does not make it safe to
  // start a second turn alongside one that never stopped.
  const { q } = mk()
  q.begin('appr_a'); q.markRunning('appr_a', { agentId: 'aroma-appr_a', sessionKey: 'agent:aroma-appr_a:appr_a', phase: 'agent_add_attempting' }); q.markClientTimeout('appr_a'); q.quarantine('appr_a')

  const gate = q.canStart('appr_b')
  assert.strictEqual(gate.ok, false)
  assert.match(gate.reason, /locked out while approval 'appr_a' is QUARANTINED/)
  assert.deepStrictEqual(gate.blockedBy, [{ approvalId: 'appr_a', state: STATES.QUARANTINED }])
  assert.throws(() => q.begin('appr_b'), /locked out/)
})

test('Q3b. a merely RUNNING approval also holds the lock', () => {
  const { q } = mk()
  q.begin('appr_a'); q.markRunning('appr_a', { agentId: 'aroma-appr_a', sessionKey: 'agent:aroma-appr_a:appr_a', phase: 'agent_add_attempting' })
  assert.strictEqual(q.canStart('appr_b').ok, false)
})

test('Q3c. the same approvalId is never reused, even after a clean finish', () => {
  const { q } = mk()
  q.begin('appr_a'); q.markRunning('appr_a', { agentId: 'aroma-appr_a', sessionKey: 'agent:aroma-appr_a:appr_a', phase: 'agent_add_attempting' }); q.markSucceeded('appr_a')
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
  first.begin('appr_r'); first.markRunning('appr_r', { agentId: 'aroma-appr_r', sessionKey: 'agent:aroma-appr_r:appr_r', phase: 'agent_add_attempting' }); first.markClientTimeout('appr_r'); first.quarantine('appr_r')

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
  q.begin('appr_c'); q.markRunning('appr_c', { agentId: 'aroma-appr_c', sessionKey: 'agent:aroma-appr_c:appr_c', phase: 'agent_add_attempting' }); q.markClientTimeout('appr_c'); q.quarantine('appr_c')

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
  q.begin('appr_d'); q.markRunning('appr_d', { agentId: 'aroma-appr_d', sessionKey: 'agent:aroma-appr_d:appr_d', phase: 'agent_add_attempting' }); q.markClientTimeout('appr_d'); q.quarantine('appr_d')

  assert.throws(() => q.markCleaned('appr_d'), /illegal quarantine transition QUARANTINED -> CLEANED/)
  assert.throws(() => q.retire('appr_d', fakeRetirementProof('appr_d')), /illegal quarantine transition QUARANTINED -> EXECUTOR_RETIRED/)
  assert.strictEqual(q.canStart('appr_e').ok, false, 'the lock is still held')
})

test('Q6. cleanup does not erase the historical quarantine evidence', () => {
  const { q, store } = mk()
  q.begin('appr_h'); q.markRunning('appr_h', { agentId: 'aroma-appr_h', sessionKey: 'agent:aroma-appr_h:appr_h', phase: 'agent_add_attempting' }); q.markClientTimeout('appr_h')
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
  q.begin('appr_1'); q.markRunning('appr_1', { agentId: 'aroma-appr_1', sessionKey: 'agent:aroma-appr_1:appr_1', phase: 'agent_add_attempting' }); q.markClientTimeout('appr_1'); q.quarantine('appr_1')
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
    q.begin('appr_f'); q.markRunning('appr_f', { agentId: 'aroma-appr_f', sessionKey: 'agent:aroma-appr_f:appr_f', phase: 'agent_add_attempting' })
    q.observeTerminal('appr_f', status)
    assert.strictEqual(q.state('appr_f'), STATES.TERMINAL_OBSERVED, status)
    assert.strictEqual(q.record('appr_f').taskStatus, status)
  }
})

test('T4. a failed terminal observation does NOT by itself release the lock', () => {
  const { q } = mk()
  q.begin('appr_f'); q.markRunning('appr_f', { agentId: 'aroma-appr_f', sessionKey: 'agent:aroma-appr_f:appr_f', phase: 'agent_add_attempting' })
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
  q.begin('appr_s'); q.markRunning('appr_s', { agentId: 'aroma-appr_s', sessionKey: 'agent:aroma-appr_s:appr_s', phase: 'agent_add_attempting' })
  assert.throws(() => q.observeTerminal('appr_s', 'succeeded'), /must pass through markSucceeded/)
  assert.strictEqual(q.state('appr_s'), STATES.RUNNING, 'and the state is unchanged')

  q.markSucceeded('appr_s')
  q.observeTerminal('appr_s', 'succeeded')
  assert.strictEqual(q.state('appr_s'), STATES.TERMINAL_OBSERVED)
})

test('T6. SUCCEEDED contradicted by a failing observation is refused', () => {
  const { q } = mk()
  q.begin('appr_c'); q.markRunning('appr_c', { agentId: 'aroma-appr_c', sessionKey: 'agent:aroma-appr_c:appr_c', phase: 'agent_add_attempting' }); q.markSucceeded('appr_c')
  for (const bad of ['failed', 'timed_out', 'cancelled', 'lost']) {
    assert.throws(() => q.observeTerminal('appr_c', bad), /is SUCCEEDED but the observed task status/)
  }
  assert.strictEqual(q.state('appr_c'), STATES.SUCCEEDED)
})

test('T7. a late "succeeded" after a timeout is STILL refused — the fix did not widen it', () => {
  const { q } = mk()
  q.begin('appr_t'); q.markRunning('appr_t', { agentId: 'aroma-appr_t', sessionKey: 'agent:aroma-appr_t:appr_t', phase: 'agent_add_attempting' }); q.markClientTimeout('appr_t'); q.quarantine('appr_t')
  assert.throws(() => q.markSucceeded('appr_t'), /never accepted for a tainted run/)
  q.observeTerminal('appr_t', 'succeeded')
  assert.strictEqual(q.state('appr_t'), STATES.TERMINAL_OBSERVED)
  assert.notStrictEqual(q.state('appr_t'), STATES.SUCCEEDED)
})

/* ══════════════ grants ══════════════ */

test('G1. a retired grant cannot be forged, and is only issued once RETIRED', () => {
  const { q } = mk()
  q.begin('appr_g'); q.markRunning('appr_g', { agentId: 'aroma-appr_g', sessionKey: 'agent:aroma-appr_g:appr_g', phase: 'agent_add_attempting' })
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
    q.begin('appr_same'); q.markRunning('appr_same', { agentId: 'aroma-appr_same', sessionKey: 'agent:aroma-appr_same:appr_same', phase: 'agent_add_attempting' }); q.observeTerminal('appr_same', 'failed'); q.retire('appr_same', fakeRetirementProof('appr_same'))
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

  q.begin('appr_run'); q.markRunning('appr_run', { agentId: 'aroma-appr_run', sessionKey: 'agent:aroma-appr_run:appr_run', phase: 'agent_add_attempting' }); q.observeTerminal('appr_run', 'lost'); q.retire('appr_run', fakeRetirementProof('appr_run'))
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
  q.begin('appr_r'); q.markRunning('appr_r', { agentId: 'aroma-appr_r', sessionKey: 'agent:aroma-appr_r:appr_r', phase: 'agent_add_attempting' })
  assert.throws(() => q.abortPreExecution('appr_r'), /illegal quarantine transition RUNNING -> PRE_EXECUTION_ABORTED/)
  assert.throws(() => q.failPreparation('appr_r'), /illegal quarantine transition RUNNING -> PREPARATION_FAILED/)
  assert.throws(() => q.preExecutionGrant('appr_r'), /requires that no executor ever started/)

  for (const from of ['markClientTimeout', 'quarantine']) {
    const q2 = createOpenClawQuarantine({ store: memStore() })
    q2.begin('a'); q2.markRunning('a', { agentId: 'aroma-a', sessionKey: 'agent:aroma-a:a', phase: 'agent_add_attempting' }); q2.markClientTimeout('a')
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
  q.begin('appr_1'); q.markRunning('appr_1', { agentId: 'aroma-appr_1', sessionKey: 'agent:aroma-appr_1:appr_1', phase: 'agent_add_attempting' }); q.markSucceeded('appr_1')

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
  first.begin('appr_s'); first.markRunning('appr_s', { agentId: 'aroma-appr_s', sessionKey: 'agent:aroma-appr_s:appr_s', phase: 'agent_add_attempting' }); first.markSucceeded('appr_s')

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
  q.begin('appr_b'); q.markRunning('appr_b', { agentId: 'aroma-appr_b', sessionKey: 'agent:aroma-appr_b:appr_b', phase: 'agent_add_attempting' }); q.markSucceeded('appr_b')

  assert.strictEqual(q.mayCleanup('appr_b').ok, false, 'cleanup refused')
  assert.strictEqual(q.canStart('appr_next').ok, false, 'and the lock is held too')
})

test('S4. observation advances the record but does not release the lock', () => {
  const { q } = mk()
  q.begin('appr_c'); q.markRunning('appr_c', { agentId: 'aroma-appr_c', sessionKey: 'agent:aroma-appr_c:appr_c', phase: 'agent_add_attempting' }); q.markSucceeded('appr_c')
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
  q.begin('appr_d'); q.markRunning('appr_d', { agentId: 'aroma-appr_d', sessionKey: 'agent:aroma-appr_d:appr_d', phase: 'agent_add_attempting' }); q.markClientTimeout('appr_d')
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
    STATES.TERMINAL_OBSERVED
  ].sort())
  for (const free of [STATES.PREPARED, STATES.EXECUTOR_RETIRED, STATES.PRE_EXECUTION_ABORTED,
    STATES.PREPARATION_FAILED, STATES.CLEANED]) {
    assert.ok(!UNACCOUNTED.includes(free), `${free} must not hold the execution lock`)
  }
  assert.ok(UNACCOUNTED.includes(STATES.TERMINAL_OBSERVED),
    'a terminal task does not prove the session is finished')
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
    running: (q) => { at.prepared(q); q.markRunning(KEY, { agentId: AGENT, sessionKey: SESSION, phase: 'agent_add_attempting' }) },
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
    ['markRunning', at.prepared, (q, m) => q.markRunning(KEY, Object.assign({ agentId: AGENT, sessionKey: SESSION, phase: 'agent_add_attempting' }, m)),
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
  q.markRunning(KEY, { sessionKey: SESSION, phase: 'agent_add_attempting', agentId: 'aroma-' + KEY, note: 'first spawn' })
  let rec = q.record(KEY)
  assert.strictEqual(rec.note, 'first spawn', 'non-reserved metadata is preserved')
  assert.strictEqual(rec.agentId, 'aroma-' + KEY)
  assert.strictEqual(rec.state, STATES.RUNNING, 'and the module wrote the state')
  assert.strictEqual(rec.phase, 'agent_add_attempting', 'and the phase, after validating it')
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
  const P = 'agent_add_attempting'

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
  b.q.markRunning(K, { agentId: 'aroma-' + K, sessionKey: 'agent:aroma-' + K + ':' + K, phase: 'agent_add_attempting' })
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
  const authoritative = { state: 'RUNNING', phase: 'agent_add_attempting' }
  const stamp = { approvalId: 'appr_real', updatedAt: '2026-08-28T00:00:00.000Z' }

  const out = mergeRecord({ startedAt: 'earlier', state: 'PREPARED' }, forged, authoritative, stamp)

  assert.strictEqual(out.state, 'RUNNING', 'the module authors the state, not the caller')
  assert.strictEqual(out.phase, 'agent_add_attempting', 'and the phase')
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
  q.markRunning('appr_cover', { agentId: 'aroma-appr_cover', sessionKey: 'agent:aroma-appr_cover:appr_cover', phase: 'agent_add_attempting' })
  for (const key of AUTHORED) {
    assert.throws(
      () => q.markSucceeded('appr_cover', { [key]: 'anything' }),
      new RegExp("'" + key + "' is authoritative"),
      key + ' is authored by the module, so it must also be reserved'
    )
  }
})
