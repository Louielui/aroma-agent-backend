'use strict'

/**
 * openClawLifecycle.test.js — THE HARDENING THAT IS INDEPENDENT OF THE OPEN BLOCKER.
 *
 * Activation is still blocked: no OpenClaw primitive neutralises a session without pruning
 * its workspace, so a terminal task cannot prove a session is finished. Nothing here pretends
 * otherwise. What IS testable is the ordering and the refusals — the parts that must already
 * be right before anything is switched on, and the parts that must fail closed while it is not.
 *
 * Everything external is injected. There is no real CLI, no child_process, no model call.
 */

const os = require('os')
const fs = require('fs')
const path = require('path')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-b2b1-life-'))

const test = require('node:test')
const assert = require('node:assert')

const { createOpenClawQuarantine, expectedAgentIdFor, expectedSessionKeyFor, STATES, PHASES, UNACCOUNTED } = require('../agent/openClawQuarantine')
const { createOpenClawTransport, parseSuccess, parseTaskStatus, agentIdFor, sessionKeyFor } = require('../agent/openClawTransport')
const { createOpenClawReconciler } = require('../agent/openClawReconciler')
const { createOpenClawWslWorkspace } = require('../agent/openClawWslWorkspace')

const APPROVAL = 'appr_life'
const ENV_DIR = '/home/openclaw/.aroma/sandboxes/' + APPROVAL
const REPO_DIR = ENV_DIR + '/repo'

const memStore = () => {
  let d = {}
  return { read: () => JSON.parse(JSON.stringify(d)), write: (x) => { d = JSON.parse(JSON.stringify(x)) }, peek: () => d }
}
const fakeProof = (id) => ({ approvalId: id, sessionRetired: true })
const verifyFake = (p, e) => !!p && p.sessionRetired === true && p.approvalId === e.approvalId
const ledger = (opts = {}) => createOpenClawQuarantine(Object.assign({ store: memStore() }, opts))

/**
 * A confirmation seam standing in for the later probe. Positive structured evidence, NOT an
 * exit code: it names the agent and the workspace it is bound to.
 */
const confirmOk = async ({ agentId, envelope }) => ({ exists: true, agentId, workspace: envelope })
const confirmMissing = async () => ({ exists: false })

/** A governed-workspace stand-in that only has to answer "who owns this clone". */
const owner = (approvalId, dir) => ({ approvalId, cloneDir: dir, approvalFor: (d) => (d === dir ? approvalId : null) })

/* ══════════════ PART 1 — removeEnvelope retryability ══════════════ */

function wslFake (over = {}) {
  const calls = []
  const ok = (out) => ({ status: 0, stdout: out === undefined ? '' : out, stderr: '', timedOut: false })
  const live = new Set()
  return (argv) => {
    // X4-B1: the mechanic receives the LINUX argv directly — no prefix to strip
    const a = argv
    calls.push(a.join(' '))
    if (a[0] === 'mkdir') { live.add(a[a.length - 1]); return ok() }
    if (a[0] === 'rm') {
      if (over.rmFails) return { status: 1, stdout: '', stderr: 'rm: device or resource busy', timedOut: false }
      for (const k of Array.from(live)) if (k === a[a.length - 1] || k.startsWith(a[a.length - 1] + '/')) live.delete(k)
      return ok()
    }
    if (a[0] === 'stat') return ok('2049:400\n')
    if (a[0] === 'test') return { status: live.has(a[a.length - 1]) ? 0 : 1, stdout: '', stderr: '', timedOut: false }
    if (a[0] === 'readlink') return ok(a[a.length - 1] + '\n')
    if (a[0] === 'git') {
      const g = a.slice(1); let i = 0; while (g[i] === '-c') i += 2
      const sub = g[i] === '-C' ? g.slice(i + 2) : g.slice(i)
      const j = sub.join(' ')
      if (sub[0] === 'clone' || sub[0] === 'checkout') return ok()
      if (j === 'remote') return ok('')
      if (j === 'rev-parse HEAD') return ok('4511f7deeb279b189642b3b812b56250ce518d98\n')
      if (j === 'rev-parse --abbrev-ref HEAD') return ok('agent/' + APPROVAL + '\n')
      if (j === 'rev-parse --show-toplevel') return ok(REPO_DIR + '\n')
      if (j === 'rev-parse --absolute-git-dir') return ok(REPO_DIR + '/.git\n')
      if (j.startsWith('rev-parse --path-format=absolute')) return ok(REPO_DIR + '/.git\n')
      return ok('')
    }
    return ok('')
  }
}

test('P1. ⛔ a FAILED envelope removal keeps the identity baseline, so cleanup stays retryable', () => {
  // This used to read `PREPARED.delete(dir)` before the rm status was checked. A transient
  // failure — a busy file, a full disk — then destroyed the baseline, every retry hit "no
  // prepared sandbox baseline", and the envelope was orphaned with no way back.
  const q = ledger()
  const ws = createOpenClawWslWorkspace({ wslRunner: wslFake({ rmFails: true }), verifyGrant: (g, e) => q.verifyGrant(g, e) })
  const p = ws.prepare(APPROVAL)

  q.begin(APPROVAL); q.abortPreExecution(APPROVAL)
  const grant = q.preExecutionGrant(APPROVAL)

  const first = ws.discardPreparedSandbox(p.dir, { grant })
  assert.strictEqual(first.ok, false)
  assert.strictEqual(first.retryable, true, 'a failed removal must say it can be retried')

  // the baseline survived, so the SAME identity-checked call can be made again
  const second = ws.discardPreparedSandbox(p.dir, { grant })
  assert.strictEqual(second.ok, false)
  assert.strictEqual(second.retryable, true)
  assert.ok(!/no prepared sandbox baseline/.test(second.reason), 'the baseline must NOT have been dropped')
})

test('P1b. a SUCCESSFUL removal does drop the baseline', () => {
  const q = ledger()
  const ws = createOpenClawWslWorkspace({ wslRunner: wslFake(), verifyGrant: (g, e) => q.verifyGrant(g, e) })
  const p = ws.prepare(APPROVAL)
  q.begin(APPROVAL); q.abortPreExecution(APPROVAL)

  assert.strictEqual(ws.discardPreparedSandbox(p.dir, { grant: q.preExecutionGrant(APPROVAL) }).ok, true)
  const again = ws.discardPreparedSandbox(p.dir, { grant: q.preExecutionGrant(APPROVAL) })
  assert.strictEqual(again.ok, false)
  assert.match(again.reason, /no prepared sandbox baseline/, 'a completed cleanup has nothing left to verify')
  // ⛔ AND THE REAL PROVIDER DOES NOT CALL THIS RETRYABLE.
  // It sets retryable:true only on a genuine rm failure. A dropped baseline is permanent, and
  // the governed layer must not invent retryability the provider never claimed.
  assert.notStrictEqual(again.retryable, true, 'a dropped baseline cannot be retried into existence')
})

/* ══════════════ PART 2 — the execution boundary ══════════════ */

test('P2. ⛔ markRunning is durable BEFORE the first injected spawn, and not before that', () => {
  const q = ledger()
  const seen = []
  const cli = async (argv) => {
    // captured at the moment of the FIRST external call
    seen.push({ argv: argv.slice(0, 2), stateAtSpawn: q.state(APPROVAL), recAtSpawn: q.record(APPROVAL) })
    return { status: 0, stdout: '{}', stderr: '', timedOut: false }
  }
  const t = createOpenClawTransport({ cli, confirmAgent: confirmOk, governedWorkspace: owner(APPROVAL, REPO_DIR), quarantine: q })

  q.begin(APPROVAL)
  assert.strictEqual(q.state(APPROVAL), STATES.PREPARED, 'PREPARED until the boundary')

  return t.transport('brief', { cloneDir: REPO_DIR, branch: 'agent/' + APPROVAL }).then(() => {
    assert.ok(seen.length > 0, 'the CLI was reached')
    const first = seen[0]
    assert.strictEqual(first.stateAtSpawn, STATES.RUNNING, 'RUNNING before the first spawn, not after')
    assert.strictEqual(first.recAtSpawn.phase, 'executor_launch_attempting')
    assert.strictEqual(first.recAtSpawn.sessionKey, sessionKeyFor(APPROVAL), 'the lookup key is durable pre-spawn')
    assert.strictEqual(first.recAtSpawn.agentId, agentIdFor(APPROVAL))
  })
})

test('P2b. ⛔ an INERT transport never enters RUNNING — nothing could have spawned', () => {
  // The previous version of this test asserted the opposite, and it was wrong. If no external
  // runner exists then no spawn was possible, so a ledger claiming an execution had begun
  // would hold the global lock over a run that provably never had a chance to start — and
  // would destroy the one thing PREPARED exists to prove. Option 2 only works if RUNNING is
  // entered when a spawn is genuinely imminent.
  const cases = [
    ['no cli runner', { confirmAgent: confirmOk }],
    ['no confirmation seam', { cli: async () => ({ status: 0, stdout: '{}' }) }],
    ['neither', {}]
  ]
  return Promise.all(cases.map(async ([name, wiring]) => {
    const q = ledger()
    const t = createOpenClawTransport(Object.assign(
      { governedWorkspace: owner(APPROVAL, REPO_DIR), quarantine: q }, wiring))
    q.begin(APPROVAL)

    const r = await t.transport('brief', { cloneDir: REPO_DIR })
    assert.strictEqual(r.ok, false, name)
    assert.match(r.error, /inert/, name)

    assert.strictEqual(q.state(APPROVAL), STATES.PREPARED, name + ': must remain never-started')
    assert.strictEqual('phase' in q.record(APPROVAL), false, name + ': PREPARED carries no phase')
    assert.strictEqual(q.canStart('appr_other').ok, true, name + ': and holds no lock')

    // and the truthful no-executor path is still available afterwards
    q.abortPreExecution(APPROVAL, { reason: 'transport inert' })
    assert.strictEqual(q.state(APPROVAL), STATES.PRE_EXECUTION_ABORTED)
  }))
})

test('P2d. ⛔ agent_observed requires POSITIVE evidence, never a zero exit code', async () => {
  // "the agent exists" is a claim about the world; an exit status is a claim about a process.
  // Three CLI commands in this programme have already disagreed with their own exit codes.
  const q = ledger()
  const calls = []
  const cli = async (argv) => { calls.push(argv[0]); return { status: 0, stdout: '{}', stderr: '', timedOut: false } }

  const t = createOpenClawTransport({ cli, confirmAgent: confirmMissing, governedWorkspace: owner(APPROVAL, REPO_DIR), quarantine: q })
  q.begin(APPROVAL)

  const r = await t.transport('brief', { cloneDir: REPO_DIR })
  assert.strictEqual(r.ok, false, 'exit 0 alone must not be believed')
  assert.match(r.error, /could not positively confirm agent/)

  // fail closed: the record stays execution-bearing at the phase it actually reached
  assert.strictEqual(q.state(APPROVAL), STATES.RUNNING)
  assert.strictEqual(q.record(APPROVAL).phase, 'executor_launch_attempting', 'the phase did NOT advance')
  assert.strictEqual(q.canStart('appr_other').ok, false, 'and the lock is held')
  assert.deepStrictEqual(calls, ['agents'], 'the turn was never attempted')
})

test('P2e. ⛔ confirmation must name the EXPECTED agent and workspace', async () => {
  const wrong = [
    ['different agent', async ({ envelope }) => ({ exists: true, agentId: 'aroma-someone_else', workspace: envelope })],
    ['different workspace', async ({ agentId }) => ({ exists: true, agentId, workspace: '/home/openclaw/.aroma/sandboxes/other' })],
    ['exists not true', async ({ agentId, envelope }) => ({ exists: 'yes', agentId, workspace: envelope })],
    ['empty answer', async () => ({})],
    ['no answer', async () => null]
  ]
  for (const [name, confirmAgent] of wrong) {
    const q = ledger()
    const t = createOpenClawTransport({
      cli: async () => ({ status: 0, stdout: '{}', stderr: '', timedOut: false }),
      confirmAgent, governedWorkspace: owner(APPROVAL, REPO_DIR), quarantine: q
    })
    q.begin(APPROVAL)
    const r = await t.transport('brief', { cloneDir: REPO_DIR })
    assert.strictEqual(r.ok, false, name)
    assert.strictEqual(q.record(APPROVAL).phase, 'executor_launch_attempting', name + ': phase must not advance')
  }
})

test('P2c. an unowned clone directory is refused before anything is recorded', async () => {
  const q = ledger()
  const t = createOpenClawTransport({ cli: async () => ({ status: 0 }), confirmAgent: confirmOk, governedWorkspace: owner(APPROVAL, REPO_DIR), quarantine: q })
  const r = await t.transport('brief', { cloneDir: '/home/openclaw/.aroma/sandboxes/someone_else/repo' })
  assert.strictEqual(r.ok, false)
  assert.match(r.error, /no governed approval owns this clone/)
})

/* ══════════════ PART 3 — phase validation ══════════════ */

test('P3. phases are monotonic and vocabulary-checked', () => {
  const q = ledger()
  q.begin(APPROVAL)
  q.markRunning(APPROVAL, { agentId: agentIdFor(APPROVAL), sessionKey: sessionKeyFor(APPROVAL), phase: 'executor_launch_attempting' })

  q.advancePhase(APPROVAL, 'agent_observed')
  q.advancePhase(APPROVAL, 'turn_attempting')
  assert.strictEqual(q.record(APPROVAL).phase, 'turn_attempting')

  // backwards is refused: it would rewrite history toward "less was attempted", which is
  // exactly the direction that makes an unaccounted run look safe
  assert.throws(() => q.advancePhase(APPROVAL, 'executor_launch_attempting'), /cannot move backwards/)
  assert.throws(() => q.advancePhase(APPROVAL, 'nonsense'), /unknown execution phase/)
  assert.deepStrictEqual(PHASES.slice(), ['executor_launch_attempting', 'agent_observed', 'turn_attempting', 'task_observed'])
})

test('P3b. ⛔ a missing or unknown phase on an execution-bearing state FAILS CLOSED', () => {
  const bad = [
    ['missing phase', { appr_x: { approvalId: 'appr_x', state: 'RUNNING' } }, /carries no execution phase/],
    ['unknown phase', { appr_x: { approvalId: 'appr_x', state: 'RUNNING', phase: 'wat' } }, /unknown execution phase/],
    ['phase on PREPARED', { appr_x: { approvalId: 'appr_x', state: 'PREPARED', phase: 'turn_attempting' } }, /PREPARED but carries execution phase/],
    ['missing on SUCCEEDED', { appr_x: { approvalId: 'appr_x', state: 'SUCCEEDED' } }, /carries no execution phase/],
    ['missing on TERMINAL_OBSERVED', { appr_x: { approvalId: 'appr_x', state: 'TERMINAL_OBSERVED' } }, /carries no execution phase/]
  ]
  for (const [name, seed, re] of bad) {
    const q = createOpenClawQuarantine({ store: { read: () => JSON.parse(JSON.stringify(seed)), write: () => {} } })
    assert.throws(() => q.canStart('appr_new'), re, name + ' (canStart)')
    assert.throws(() => q.unaccounted(), re, name + ' (unaccounted)')
  }
})

test('P3c. markRunning refuses to open at anything but the first phase, and needs the sessionKey', () => {
  const q = ledger()
  q.begin(APPROVAL)
  assert.throws(() => q.markRunning(APPROVAL, { sessionKey: 'k', phase: 'turn_attempting' }), /must open at phase/)
  assert.throws(() => q.markRunning(APPROVAL, { sessionKey: 'k' }), /must open at phase/)
  assert.throws(() => q.markRunning(APPROVAL, { phase: 'executor_launch_attempting' }), /requires the derived agentId/)
  assert.throws(() => q.markRunning(APPROVAL, { phase: 'executor_launch_attempting', agentId: agentIdFor(APPROVAL) }),
    /requires the derived sessionKey/)
})

/* ══════════════ PART 4 — the corrected lock model ══════════════ */

test('P4. TERMINAL_OBSERVED still holds the lock; only EXECUTOR_RETIRED releases it', () => {
  const q = ledger({ verifyRetirementProof: verifyFake })
  q.begin(APPROVAL)
  q.markRunning(APPROVAL, { agentId: agentIdFor(APPROVAL), sessionKey: sessionKeyFor(APPROVAL), phase: 'executor_launch_attempting' })
  q.markSucceeded(APPROVAL)
  q.observeTerminal(APPROVAL, 'succeeded')

  assert.strictEqual(q.canStart('appr_other').ok, false, 'a terminal task is not a finished session')
  assert.ok(UNACCOUNTED.includes(STATES.TERMINAL_OBSERVED))

  q.retire(APPROVAL, fakeProof(APPROVAL))
  assert.strictEqual(q.state(APPROVAL), STATES.EXECUTOR_RETIRED)
  assert.strictEqual(q.canStart('appr_other').ok, true)
})

test('P4b. ⛔ PRODUCTION FAILS CLOSED: no retirement proof exists, so the lock cannot be released', () => {
  // The default verifier refuses everything, because no OpenClaw primitive neutralises a
  // session without pruning its workspace. This is the open activation blocker, asserted
  // rather than hidden.
  const q = ledger() // no verifyRetirementProof — the production default
  q.begin(APPROVAL)
  q.markRunning(APPROVAL, { agentId: agentIdFor(APPROVAL), sessionKey: sessionKeyFor(APPROVAL), phase: 'executor_launch_attempting' })
  q.markSucceeded(APPROVAL)
  q.observeTerminal(APPROVAL, 'succeeded')

  for (const forged of [null, undefined, true, {}, { approvalId: APPROVAL }, fakeProof(APPROVAL)]) {
    assert.throws(() => q.retire(APPROVAL, forged), /without a freshly verified session-retirement proof/)
  }
  assert.strictEqual(q.canStart('appr_other').ok, false, 'the lock stays held, which is correct')
})

/* ══════════════ PART 5 — the success contract ══════════════ */

const GOOD = JSON.stringify({
  runId: 'r-1', status: 'ok', summary: 'completed',
  result: { payloads: [{ text: 'AROMA_OK', mediaUrl: null }], meta: { aborted: false } }
})

test('P5. the success contract accepts only the measured shape', () => {
  assert.strictEqual(parseSuccess(GOOD).ok, true)
  assert.strictEqual(parseSuccess(GOOD).runId, 'r-1')

  const rejects = [
    ['', /empty stdout/],
    ['   ', /empty stdout/],
    ['not json', /not whole JSON/],
    ['[]', /not a JSON object/],
    [JSON.stringify({ status: 'ok', result: { payloads: [{ text: 'x' }], meta: { aborted: false } } }), /runId is missing/],
    [JSON.stringify({ runId: 'r', status: 'error', result: {} }), /status is 'error'/],
    [JSON.stringify({ runId: 'r', status: 'ok' }), /result is missing/],
    [JSON.stringify({ runId: 'r', status: 'ok', result: { payloads: [], meta: { aborted: false } } }), /payloads\[0\]\.text is missing/],
    [JSON.stringify({ runId: 'r', status: 'ok', result: { payloads: [{ text: 'x' }] } }), /result\.meta is missing/],
    [JSON.stringify({ runId: 'r', status: 'ok', result: { payloads: [{ text: 'x' }], meta: { aborted: true } } }), /aborted is true/],
    // a banner in front of valid JSON must NOT be salvaged
    ['WARNING: something\n' + GOOD, /not whole JSON/]
  ]
  for (const [raw, re] of rejects) {
    const r = parseSuccess(raw)
    assert.strictEqual(r.ok, false, JSON.stringify(raw).slice(0, 60))
    assert.match(r.reason, re)
  }
})

test('P5b. ⛔ the not-found contract is the EXACT session-key grammar, matched whole', () => {
  // Measured: `openclaw tasks show <lookup>` prints "Task not found: <lookup>" and EXITS 0.
  // The only lookup this lane ever passes is a session key it derived itself, so that is the
  // only lookup the message is recognised for.
  assert.deepStrictEqual(parseTaskStatus('Task not found: agent:aroma-a:a'), { found: false })
  assert.deepStrictEqual(parseTaskStatus('Task not found: ' + sessionKeyFor(APPROVAL)), { found: false },
    'the key this transport actually derives')
  assert.deepStrictEqual(parseTaskStatus('  Task not found: agent:aroma-a:a  '), { found: false },
    'surrounding whitespace is not decoration')

  // the full safe-id alphabet, and the longest legal approvalId
  for (const id of ['a', 'A9', 'appr_with_underscores', 'appr-with-dashes', 'a_b-C9', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']) {
    assert.deepStrictEqual(parseTaskStatus('Task not found: ' + sessionKeyFor(id)), { found: false },
      'legal approvalId: ' + id.slice(0, 12) + ' (len ' + id.length + ')')
  }

  const good = parseTaskStatus(JSON.stringify({ taskId: 't', runId: 'r', status: 'succeeded' }))
  assert.strictEqual(good.found, true)
  assert.strictEqual(good.status, 'succeeded')

  // ⛔ EVERYTHING ELSE IS UNREADABLE. "The task does not exist" is the answer that closes a
  // record out, so it is granted only to output about a lookup this lane could have made.
  for (const [name, raw] of [
    // arbitrary lookups — all of these passed the old \S+ match
    ['trailing punctuation', 'Task not found: x.'],
    ['punctuation soup', 'Task not found: abc!!!'],
    ['a path', 'Task not found: ../../foo'],
    ['an arbitrary word', 'Task not found: anything'],
    ['a bare approvalId', 'Task not found: appr_1'],
    ['an agentId rather than a session key', 'Task not found: aroma-a'],
    ['a taskId form this lane never asks by', 'Task not found: task_01H9'],
    // right shape, wrong identity
    ['mismatched repeated id', 'Task not found: agent:aroma-a:b'],
    ['mismatched by case', 'Task not found: agent:aroma-a:A'],
    ['id longer than the safe-id limit', 'Task not found: agent:aroma-' + 'a'.repeat(65) + ':' + 'a'.repeat(65)],
    ['empty id', 'Task not found: agent:aroma-:'],
    ['wrong agent prefix', 'Task not found: agent:other-a:a'],
    ['illegal character in the id', 'Task not found: agent:aroma-a.b:a.b'],
    // decoration
    ['trailing dot after a valid key', 'Task not found: agent:aroma-a:a.'],
    ['trailing word after a valid key', 'Task not found: agent:aroma-a:a EXTRA'],
    ['prefix before a valid key', 'note: Task not found: agent:aroma-a:a'],
    ['newline trailer after a valid key', 'Task not found: agent:aroma-a:a\nWARNING: something'],
    ['json trailer after a valid key', 'Task not found: agent:aroma-a:a\n{"status":"succeeded"}'],
    ['second not-found line', 'Task not found: agent:aroma-a:a\nTask not found: agent:aroma-b:b'],
    ['no lookup at all', 'Task not found'],
    ['empty lookup', 'Task not found: '],
    ['no colon', 'Task not found agent:aroma-a:a'],
    ['a sentence that merely starts the same way', 'Task not found in the queue, retrying'],
    // and the JSON side is not loosened by any of this
    ['banner then json', 'WARNING: plugins.allow is empty\n' + JSON.stringify({ status: 'succeeded' })],
    ['json then trailer', JSON.stringify({ status: 'succeeded' }) + '\ntrailing noise'],
    ['array', '[]'],
    ['empty', ''],
    ['garbage', 'garbage'],
    ['no status field', JSON.stringify({ taskId: 't' })],
    ['empty status', JSON.stringify({ status: '' })]
  ]) {
    const r = parseTaskStatus(raw)
    assert.strictEqual(r.found, false, name)
    assert.strictEqual(r.unreadable, true, name + ': must be UNREADABLE, not an accounted-for answer')
  }
})

test('P5g. ⛔ the recognised lookup grammar is the ledger\'s own safe-id alphabet', () => {
  // If the parser's idea of a legal approvalId ever drifts from the ledger's, the message
  // would be recognised for keys the ledger would refuse to hold a record for — or refused
  // for keys it does hold. Pinned, in both directions, on the boundary values.
  const LEGAL = ['a', '9', '_', '-', 'a_b-C9', 'a'.repeat(64)]
  const ILLEGAL = ['', 'a'.repeat(65), 'a.b', 'a b', 'a:b', 'a/b', 'a$b']

  for (const id of LEGAL) {
    const q = createOpenClawQuarantine({ store: memStore(), verifyRetirementProof: () => true })
    q.begin(id) // the ledger accepts it...
    assert.deepStrictEqual(parseTaskStatus('Task not found: ' + sessionKeyFor(id)), { found: false },
      '...so the parser must recognise its session key: ' + id.slice(0, 12))
  }
  for (const id of ILLEGAL) {
    const q = createOpenClawQuarantine({ store: memStore(), verifyRetirementProof: () => true })
    assert.throws(() => q.begin(id), /approvalId/, 'the ledger refuses ' + JSON.stringify(id.slice(0, 12)))
    const r = parseTaskStatus('Task not found: ' + sessionKeyFor(id))
    assert.strictEqual(r.unreadable, true, 'and the parser refuses it too: ' + JSON.stringify(id.slice(0, 12)))
  }
})

test('P5f. ⛔ the transport and the ledger derive the SAME session identity', () => {
  // The transport has no imports by design, so these two definitions are duplicated. Pinned
  // here rather than by a shared require: if they ever drift, markRunning refuses every real
  // run — the ledger would reject the very identity the transport is about to spawn under.
  for (const id of ['appr_a', 'appr_lifecycle_1', 'x', 'appr_' + 'z'.repeat(40)]) {
    assert.strictEqual(agentIdFor(id), expectedAgentIdFor(id), 'agentId derivation for ' + id)
    assert.strictEqual(sessionKeyFor(id), expectedSessionKeyFor(id), 'sessionKey derivation for ' + id)
  }
})

test('P5c. a client timeout quarantines and never reports success', async () => {
  const q = ledger()
  const cli = async (argv) => (argv[0] === 'agents'
    ? { status: 0, stdout: '{}', stderr: '', timedOut: false }
    : { status: null, stdout: '', stderr: '', timedOut: true })
  const t = createOpenClawTransport({ cli, confirmAgent: confirmOk, governedWorkspace: owner(APPROVAL, REPO_DIR), quarantine: q })
  q.begin(APPROVAL)

  const r = await t.transport('brief', { cloneDir: REPO_DIR })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.timedOut, true)
  assert.match(r.error, /may still be running/)
  assert.strictEqual(q.state(APPROVAL), STATES.QUARANTINED)
  assert.strictEqual(q.canStart('appr_other').ok, false)
})

test('P5d. ⛔ a late success after a timeout is refused by the ledger, through the transport', async () => {
  const q = ledger()
  let call = 0
  const cli = async (argv) => {
    call++
    if (argv[0] === 'agents') return { status: 0, stdout: '{}', stderr: '', timedOut: false }
    // taint the record mid-flight, exactly as a timeout path would have
    q.markClientTimeout(APPROVAL); q.quarantine(APPROVAL)
    return { status: 0, stdout: GOOD, stderr: '', timedOut: false }
  }
  const t = createOpenClawTransport({ cli, confirmAgent: confirmOk, governedWorkspace: owner(APPROVAL, REPO_DIR), quarantine: q })
  q.begin(APPROVAL)

  const r = await t.transport('brief', { cloneDir: REPO_DIR })
  assert.strictEqual(r.ok, false, 'a valid payload cannot rescue a tainted run')
  assert.match(r.error, /never accepted for a tainted run/)
  assert.strictEqual(q.state(APPROVAL), STATES.QUARANTINED)
})

test('P5e. ⛔ the transport module cannot reach a real CLI', () => {
  const src = fs.readFileSync(path.join(__dirname, 'openClawTransport.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  for (const re of [/child_process/, /\bspawnSync\b/, /\bspawn\s*\(/, /\bexecSync\b/, /wsl\.exe/, /require\s*\(/]) {
    assert.ok(!re.test(code), `openClawTransport must not contain ${re}`)
  }
})

/* ══════════════ PART 6 — the reconciler ══════════════ */

const reconciler = (q, over = {}) => createOpenClawReconciler(Object.assign({ quarantine: q }, over))

function running (q, id) {
  q.begin(id)
  q.markRunning(id, { agentId: agentIdFor(id), sessionKey: sessionKeyFor(id), phase: 'executor_launch_attempting' })
}

test('P6. an unaccounted record refuses every new execution at the boot gate', () => {
  const q = ledger()
  running(q, APPROVAL)
  const r = reconciler(q, { taskStatusFor: () => ({ found: false }) })
  const gate = r.gate('appr_new')
  assert.strictEqual(gate.ok, false)
  assert.match(gate.reason, /unaccounted OpenClaw record/)
  assert.deepStrictEqual(gate.blockedBy, [{ approvalId: APPROVAL, state: STATES.RUNNING, phase: 'executor_launch_attempting' }])
})

test('P6b. ⛔ TASK NOT FOUND never releases anything', () => {
  const q = ledger()
  running(q, APPROVAL)
  const r = reconciler(q, { taskStatusFor: () => ({ found: false }), agentExists: () => false })
  const out = r.reconcile()

  assert.strictEqual(out.executionAllowed, false)
  assert.strictEqual(out.findings[0].verdict, 'escalate')
  assert.match(out.findings[0].reason, /absence proves neither/)
  assert.match(out.findings[0].reason, /agent absent — evidence only/)
  assert.strictEqual(out.findings[0].lockReleased, false)
  assert.strictEqual(q.state(APPROVAL), STATES.RUNNING, 'the record is untouched')
})

test('P6c. ⛔ AGENT ABSENT is evidence, never authority', () => {
  const q = ledger()
  running(q, APPROVAL)
  // agent absent AND task absent — the most tempting "surely nothing ran" combination
  const r = reconciler(q, { taskStatusFor: () => ({ found: false }), agentExists: () => false })
  r.reconcile()
  assert.strictEqual(q.canStart('appr_other').ok, false, 'still locked')
})

test('P6d. a non-terminal task holds; a terminal one advances but STILL does not release', () => {
  const q = ledger()
  running(q, APPROVAL)

  const held = reconciler(q, { taskStatusFor: () => ({ found: true, status: 'running' }) }).reconcile()
  assert.strictEqual(held.findings[0].verdict, 'hold')
  assert.strictEqual(q.state(APPROVAL), STATES.RUNNING)

  const done = reconciler(q, { taskStatusFor: () => ({ found: true, status: 'failed' }) }).reconcile()
  assert.strictEqual(done.findings[0].verdict, 'locked-pending-retirement')
  assert.strictEqual(q.state(APPROVAL), STATES.TERMINAL_OBSERVED)
  assert.strictEqual(done.findings[0].lockReleased, false)
  assert.strictEqual(done.executionAllowed, false, 'no session-retirement proof exists')
})

test('P6e. an unreadable status is not a terminal one', () => {
  const q = ledger()
  running(q, APPROVAL)
  const out = reconciler(q, { taskStatusFor: () => ({ found: false, unreadable: true }) }).reconcile()
  assert.strictEqual(out.findings[0].verdict, 'escalate')
  assert.match(out.findings[0].reason, /unreadable/)
})

test('P6f. PREPARED is not unaccounted, so a never-started run blocks nothing', () => {
  const q = ledger()
  q.begin(APPROVAL)
  const out = reconciler(q, { taskStatusFor: () => ({ found: false }) }).reconcile()
  assert.strictEqual(out.unaccounted, 0)
  assert.strictEqual(out.executionAllowed, true)
  assert.strictEqual(reconciler(q, {}).gate('appr_new').ok, true)
})

test('P6g. ⛔ the reconciler cannot retire anything, and never invents a proof', () => {
  const q = ledger({ verifyRetirementProof: verifyFake })
  running(q, APPROVAL)
  reconciler(q, { taskStatusFor: () => ({ found: true, status: 'lost' }) }).reconcile()
  // even with a ledger that COULD verify a proof, the reconciler supplies none
  assert.strictEqual(q.state(APPROVAL), STATES.TERMINAL_OBSERVED)
  assert.strictEqual(q.canStart('appr_other').ok, false)

  const src = fs.readFileSync(path.join(__dirname, 'openClawReconciler.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.ok(!/\bretire\s*\(/.test(code), 'the reconciler must never call retire()')
  assert.ok(!/setTimeout|setInterval|Date\.now\(\)\s*-/.test(code), 'no delay, grace period or elapsed-time threshold')
})

/* ══════════════ the correction: retirement, not terminal observation ══════════════ */

test('R1. ⛔ the executed-cleanup operation is bound to EXACTLY one grant kind', () => {
  // A mutation that widened this operation to ALSO accept a 'terminal-observed' grant survived
  // the first mutation round — not because the defence was absent, but because no such grant
  // can be minted any more, so nothing in the suite tried. That is a coverage gap at the exact
  // boundary this correction is about, so the operation's expected kind is now pinned directly.
  const q = ledger({ verifyRetirementProof: verifyFake })
  const ws = createOpenClawWslWorkspace({ wslRunner: wslFake(), verifyGrant: (g, e) => q.verifyGrant(g, e) })
  const p = ws.prepare(APPROVAL)

  q.begin(APPROVAL)
  q.markRunning(APPROVAL, { agentId: agentIdFor(APPROVAL), sessionKey: sessionKeyFor(APPROVAL), phase: 'executor_launch_attempting' })
  q.markSucceeded(APPROVAL); q.observeTerminal(APPROVAL, 'succeeded')
  q.retire(APPROVAL, fakeProof(APPROVAL))

  // a pre-execution grant must be refused, and the refusal must name EXACTLY the one kind
  // this operation accepts — widening it to a list changes this text.
  const wrong = ws.cleanupAfterExecution(p.dir, { grant: null })
  assert.strictEqual(wrong.ok, false)
  assert.match(wrong.reason, /requires a 'executor-retired' grant/)
  assert.ok(!/terminal-observed/.test(wrong.reason), 'no weaker kind may be accepted here')

  // and the correct grant works
  assert.strictEqual(ws.cleanupAfterExecution(p.dir, { grant: q.retiredGrant(APPROVAL) }).ok, true)
})

test('R2. ⛔ a retired grant is NOT issuable at TERMINAL_OBSERVED', () => {
  // The other survivor: nothing pinned the mint boundary itself, only that RUNNING was refused.
  // Terminal observation is precisely the state someone would be tempted to accept here.
  const q = ledger({ verifyRetirementProof: verifyFake })
  q.begin(APPROVAL)
  q.markRunning(APPROVAL, { agentId: agentIdFor(APPROVAL), sessionKey: sessionKeyFor(APPROVAL), phase: 'executor_launch_attempting' })
  q.markSucceeded(APPROVAL)

  assert.throws(() => q.retiredGrant(APPROVAL), /requires the executor to be RETIRED/, 'SUCCEEDED')
  q.observeTerminal(APPROVAL, 'succeeded')
  assert.throws(() => q.retiredGrant(APPROVAL), /requires the executor to be RETIRED, not merely observed terminal/,
    'TERMINAL_OBSERVED is the tempting one, and it must still refuse')

  q.retire(APPROVAL, fakeProof(APPROVAL))
  assert.strictEqual(q.retiredGrant(APPROVAL).kind, 'executor-retired')
})

test('R3. CLEANED is reachable by two histories, and provenance survives both', () => {
  // A: nothing ever ran — no execution phase, and validation must not demand one.
  const a = ledger()
  a.begin('appr_never'); a.abortPreExecution('appr_never', { reason: 'revision_moved' }); a.markCleaned('appr_never')
  const recA = a.record('appr_never')
  assert.strictEqual(recA.state, STATES.CLEANED)
  assert.strictEqual('phase' in recA, false, 'no phase, because nothing was ever attempted')
  assert.strictEqual('taskStatus' in recA, false)
  assert.strictEqual(a.canStart('appr_other').ok, true)

  // B: it ran and was retired — the execution provenance must NOT be erased by cleanup.
  const b = ledger({ verifyRetirementProof: verifyFake })
  b.begin('appr_ran')
  b.markRunning('appr_ran', { agentId: agentIdFor('appr_ran'), sessionKey: sessionKeyFor('appr_ran'), phase: 'executor_launch_attempting' })
  b.advancePhase('appr_ran', 'task_observed')
  b.markSucceeded('appr_ran'); b.observeTerminal('appr_ran', 'succeeded')
  b.retire('appr_ran', fakeProof('appr_ran')); b.markCleaned('appr_ran')

  const recB = b.record('appr_ran')
  assert.strictEqual(recB.state, STATES.CLEANED)
  assert.strictEqual(recB.phase, 'task_observed', 'how far it got is retained')
  assert.strictEqual(recB.taskStatus, 'succeeded', 'the observed status is retained')
  assert.strictEqual(recB.sessionKey, sessionKeyFor('appr_ran'), 'the lookup key is retained')
  assert.strictEqual(b.canStart('appr_other').ok, true)
})
