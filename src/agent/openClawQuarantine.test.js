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

const { createOpenClawQuarantine, fileStore, isTerminalGrant, STATES } = require('../agent/openClawQuarantine')

/** An isolated in-memory ledger. No unit test touches a real store. */
function memStore (seed = {}) {
  let data = JSON.parse(JSON.stringify(seed))
  return {
    read: () => JSON.parse(JSON.stringify(data)),
    write: (all) => { data = JSON.parse(JSON.stringify(all)) },
    peek: () => data
  }
}

const mk = (seed) => {
  const store = memStore(seed)
  return { q: createOpenClawQuarantine({ store }), store }
}

/* ══════════════ Q1 — timeout becomes quarantine, never failure-and-done ══════════════ */

test('Q1. a client timeout drives RUNNING -> CLIENT_TIMEOUT -> QUARANTINED', () => {
  const { q } = mk()
  q.begin('appr_1')
  assert.strictEqual(q.state('appr_1'), STATES.PREPARED)
  q.markRunning('appr_1')
  assert.strictEqual(q.state('appr_1'), STATES.RUNNING)
  q.markClientTimeout('appr_1')
  assert.strictEqual(q.state('appr_1'), STATES.CLIENT_TIMEOUT)
  q.quarantine('appr_1')
  assert.strictEqual(q.state('appr_1'), STATES.QUARANTINED)
})

test('Q1b. the happy path still reaches CLEANED', () => {
  const { q } = mk()
  q.begin('appr_ok')
  q.markRunning('appr_ok')
  q.markSucceeded('appr_ok')
  q.observeTerminal('appr_ok', 'succeeded')
  q.markCleaned('appr_ok')
  assert.strictEqual(q.state('appr_ok'), STATES.CLEANED)
})

/* ══════════════ Q2 — late success is refused forever ══════════════ */

test('Q2. ⛔ a late success is refused for a tainted approval, permanently', () => {
  // Measured: the executor keeps running after we stop waiting, and it CAN finish
  // successfully. That payload is evidence it outlived our supervision, not evidence the
  // run was clean.
  const { q } = mk()
  q.begin('appr_t')
  q.markRunning('appr_t')
  q.markClientTimeout('appr_t')

  assert.throws(() => q.markSucceeded('appr_t'), /never accepted for a tainted run/)

  q.quarantine('appr_t')
  assert.throws(() => q.markSucceeded('appr_t'), /never accepted for a tainted run/)

  // even after terminality is observed, the run does not retroactively become a success
  q.observeTerminal('appr_t', 'succeeded')
  assert.throws(() => q.markSucceeded('appr_t'), /illegal quarantine transition/)
  q.markCleaned('appr_t')
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
  assert.throws(() => q.markCleaned('a1'), /illegal quarantine transition/)
  assert.throws(() => q.quarantine('a1'), /illegal quarantine transition/)

  // and an unknown approval has no transitions at all
  assert.throws(() => q.markRunning('never_began'), /has no quarantine record/)
})

test('Q2c. only a real terminal task status counts as an observation', () => {
  const { q } = mk()
  q.begin('a2'); q.markRunning('a2'); q.markClientTimeout('a2'); q.quarantine('a2')
  for (const bad of ['running', 'queued', 'done', 'ok', '', null, undefined]) {
    assert.throws(() => q.observeTerminal('a2', bad), /not a terminal OpenClaw task status/)
  }
  for (const good of ['succeeded', 'failed', 'timed_out', 'cancelled', 'lost']) {
    const { q: q2 } = mk()
    q2.begin('x'); q2.markRunning('x'); q2.markClientTimeout('x'); q2.quarantine('x')
    q2.observeTerminal('x', good)
    assert.strictEqual(q2.state('x'), STATES.TERMINAL_OBSERVED, good)
  }
})

/* ══════════════ Q3 — the lock is global ══════════════ */

test('Q3. ⛔ a DIFFERENT approval is blocked while any quarantine is live', () => {
  // The unaccounted-for thing is a process. A fresh approvalId does not make it safe to
  // start a second turn alongside one that never stopped.
  const { q } = mk()
  q.begin('appr_a'); q.markRunning('appr_a'); q.markClientTimeout('appr_a'); q.quarantine('appr_a')

  const gate = q.canStart('appr_b')
  assert.strictEqual(gate.ok, false)
  assert.match(gate.reason, /locked out while approval 'appr_a' is QUARANTINED/)
  assert.deepStrictEqual(gate.blockedBy, [{ approvalId: 'appr_a', state: STATES.QUARANTINED }])
  assert.throws(() => q.begin('appr_b'), /locked out/)
})

test('Q3b. a merely RUNNING approval also holds the lock', () => {
  const { q } = mk()
  q.begin('appr_a'); q.markRunning('appr_a')
  assert.strictEqual(q.canStart('appr_b').ok, false)
})

test('Q3c. the same approvalId is never reused, even after a clean finish', () => {
  const { q } = mk()
  q.begin('appr_a'); q.markRunning('appr_a'); q.markSucceeded('appr_a')
  q.observeTerminal('appr_a', 'succeeded'); q.markCleaned('appr_a')
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
  first.begin('appr_r'); first.markRunning('appr_r'); first.markClientTimeout('appr_r'); first.quarantine('appr_r')

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

test('Q5. terminal observation is what permits cleanup — nothing else does', () => {
  const { q } = mk()
  q.begin('appr_c'); q.markRunning('appr_c'); q.markClientTimeout('appr_c'); q.quarantine('appr_c')

  const denied = q.mayCleanup('appr_c')
  assert.strictEqual(denied.ok, false)
  assert.match(denied.reason, /requires an observed terminal task status/)

  q.observeTerminal('appr_c', 'succeeded')
  assert.deepStrictEqual(q.mayCleanup('appr_c'), { ok: true })
})

test('Q5b. ⛔ cleanup alone cannot release a non-terminal quarantine', () => {
  // Deleting a directory does not stop a process. If tidying up could clear the lock,
  // tidying up would masquerade as containment.
  const { q } = mk()
  q.begin('appr_d'); q.markRunning('appr_d'); q.markClientTimeout('appr_d'); q.quarantine('appr_d')

  assert.throws(() => q.markCleaned('appr_d'), /illegal quarantine transition QUARANTINED -> CLEANED/)
  assert.strictEqual(q.canStart('appr_e').ok, false, 'the lock is still held')
})

test('Q6. cleanup does not erase the historical quarantine evidence', () => {
  const { q, store } = mk()
  q.begin('appr_h'); q.markRunning('appr_h'); q.markClientTimeout('appr_h')
  q.quarantine('appr_h', { note: 'client stopped waiting at 300s' })
  q.observeTerminal('appr_h', 'succeeded')
  q.markCleaned('appr_h')

  const rec = q.record('appr_h')
  assert.strictEqual(rec.state, STATES.CLEANED)
  assert.strictEqual(rec.taskStatus, 'succeeded', 'the observed status is retained')
  assert.strictEqual(rec.note, 'client stopped waiting at 300s', 'the quarantine reason is retained')
  assert.ok(rec.startedAt && rec.updatedAt)
  assert.ok(Object.keys(store.peek()).includes('appr_h'), 'the record is not deleted')
})

test('Q6b. once released, a clean slate can start again', () => {
  const { q } = mk()
  q.begin('appr_1'); q.markRunning('appr_1'); q.markClientTimeout('appr_1'); q.quarantine('appr_1')
  assert.strictEqual(q.canStart('appr_2').ok, false)
  q.observeTerminal('appr_1', 'lost')
  assert.strictEqual(q.canStart('appr_2').ok, true, 'observation releases the global lock')
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
    q.begin('appr_f'); q.markRunning('appr_f')
    q.observeTerminal('appr_f', status)
    assert.strictEqual(q.state('appr_f'), STATES.TERMINAL_OBSERVED, status)
    assert.strictEqual(q.record('appr_f').taskStatus, status)
  }
})

test('T4. a failed terminal observation RELEASES the global execution lock', () => {
  const { q } = mk()
  q.begin('appr_f'); q.markRunning('appr_f')
  assert.strictEqual(q.canStart('appr_next').ok, false, 'held while running')
  q.observeTerminal('appr_f', 'failed')
  assert.strictEqual(q.canStart('appr_next').ok, true, 'released once terminal')
})

test('T5. an observed "succeeded" cannot BYPASS markSucceeded()', () => {
  // A task ending successfully is a fact about OpenClaw's scheduler. Accepting its output is
  // a separate decision that belongs to markSucceeded, after the result was received and
  // verified. Letting observation stand in for acceptance would record a run we never
  // validated as a good one.
  const { q } = mk()
  q.begin('appr_s'); q.markRunning('appr_s')
  assert.throws(() => q.observeTerminal('appr_s', 'succeeded'), /must pass through markSucceeded/)
  assert.strictEqual(q.state('appr_s'), STATES.RUNNING, 'and the state is unchanged')

  q.markSucceeded('appr_s')
  q.observeTerminal('appr_s', 'succeeded')
  assert.strictEqual(q.state('appr_s'), STATES.TERMINAL_OBSERVED)
})

test('T6. SUCCEEDED contradicted by a failing observation is refused', () => {
  const { q } = mk()
  q.begin('appr_c'); q.markRunning('appr_c'); q.markSucceeded('appr_c')
  for (const bad of ['failed', 'timed_out', 'cancelled', 'lost']) {
    assert.throws(() => q.observeTerminal('appr_c', bad), /is SUCCEEDED but the observed task status/)
  }
  assert.strictEqual(q.state('appr_c'), STATES.SUCCEEDED)
})

test('T7. a late "succeeded" after a timeout is STILL refused — the fix did not widen it', () => {
  const { q } = mk()
  q.begin('appr_t'); q.markRunning('appr_t'); q.markClientTimeout('appr_t'); q.quarantine('appr_t')
  assert.throws(() => q.markSucceeded('appr_t'), /never accepted for a tainted run/)
  q.observeTerminal('appr_t', 'succeeded')
  assert.strictEqual(q.state('appr_t'), STATES.TERMINAL_OBSERVED)
  assert.notStrictEqual(q.state('appr_t'), STATES.SUCCEEDED)
})

/* ══════════════ grants ══════════════ */

test('G1. a terminal grant cannot be forged, and is only issued when terminal', () => {
  const { q } = mk()
  q.begin('appr_g'); q.markRunning('appr_g')
  assert.throws(() => q.terminalGrant('appr_g'), /requires an observed terminal task status/)

  q.observeTerminal('appr_g', 'failed')
  const grant = q.terminalGrant('appr_g')
  assert.strictEqual(isTerminalGrant(grant), true)
  assert.strictEqual(grant.approvalId, 'appr_g')

  for (const forged of [
    null, undefined, true, 'appr_g', {},
    { approvalId: 'appr_g' },
    { approvalId: 'appr_g', state: STATES.TERMINAL_OBSERVED },
    Object.freeze({ approvalId: 'appr_g', state: STATES.TERMINAL_OBSERVED }),
    JSON.parse(JSON.stringify(grant))
  ]) {
    assert.strictEqual(isTerminalGrant(forged), false, 'a literal must never verify')
  }
})
