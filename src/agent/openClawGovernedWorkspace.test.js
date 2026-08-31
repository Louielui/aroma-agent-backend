'use strict'

/**
 * openClawGovernedWorkspace.test.js — THE CLEANUP CONTRACT, THROUGH THE REAL AgentRunner.
 *
 * ── THE DEFECT THIS EXISTS TO CATCH ─────────────────────────────────────────
 * The production-proven AgentRunner calls:
 *
 *     try { workspace.cleanup(prepared.dir) } catch (_) {}
 *
 * ONE argument, return value ignored, exception swallowed. The first version of the WSL
 * workspace required `cleanup(dir, { terminal: true })`. Composed together, EVERY cleanup
 * would have been refused and every refusal discarded — leaking every envelope silently
 * while the tranche report claimed no AgentRunner change was needed.
 *
 * These tests run the REAL createAgentRunner against the REAL governed adapter, because the
 * defect only existed at the seam between them. A fake runner asserting the adapter's own
 * API would have proven nothing about the thing that was broken.
 */

const os = require('os')
const fs = require('fs')
const path = require('path')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-c2b2b1-gov-'))

const test = require('node:test')
const assert = require('node:assert')

const { createAgentRunner } = require('../agent/agentRunner')
const { createOpenClawGovernedWorkspace } = require('../agent/openClawGovernedWorkspace')
const { createOpenClawQuarantine, STATES } = require('../agent/openClawQuarantine')
const { hashWorkOrder } = require('../agent/workOrder')

const APPROVED = '4511f7deeb279b189642b3b812b56250ce518d98'
const MOVED = 'e034ccc5cc89409375f538ce2a6b7a30f2d14700'
const APPROVAL = 'appr_gov'
const ENV_DIR = '/home/openclaw/.aroma/sandboxes/' + APPROVAL
const REPO_DIR = ENV_DIR + '/repo'
const IDENTITY = { projectId: 'aroma-agent-backend', repoFullName: 'Louielui/aroma-agent-backend' }

const fakeRetirementProof = (approvalId) => ({ approvalId, sessionRetired: true })
const verifyFakeRetirement = (proof, expect) =>
  !!proof && proof.sessionRetired === true && proof.approvalId === expect.approvalId

const memLedger = () => {
  let data = {}
  return { read: () => JSON.parse(JSON.stringify(data)), write: (d) => { data = JSON.parse(JSON.stringify(d)) } }
}

const workOrder = (over = {}) => Object.assign({
  goal: 'audit the helper',
  projectId: IDENTITY.projectId,
  repoFullName: IDENTITY.repoFullName,
  expectedSha: APPROVED,
  allowedFiles: ['src/foo.js'],
  allowedTestCommand: null,
  forbiddenActions: ['commit', 'push', 'PR', 'merge', 'deploy'],
  timeoutSec: 120,
  costCapUsd: 0.5,
  branch: 'agent/' + APPROVAL,
  approvalId: APPROVAL
}, over)

const CLEAN_SANDBOX = {
  headSha: APPROVED,
  currentBranch: 'agent/' + APPROVAL,
  remotes: [],
  indexFlagged: [],
  indexDrift: [],
  dotGitIsRealDir: true,
  topLevelOk: true,
  gitDirOk: true,
  commonDirOk: true
}

/**
 * A stand-in for the WSL workspace that records what it was asked to remove. The real
 * provider is exercised against the real distro elsewhere; here the question is the SEAM
 * between AgentRunner, the adapter and the ledger.
 */
function fakeWslWorkspace (over = {}) {
  const removed = []
  const api = { removeFails: !!over.removeFails }
  const seen = { prepare: [], cleanupOpts: [], ops: [] }

  /**
   * ⛔ THE IDENTITY BASELINE, WITH THE REAL PROVIDER'S LIFETIME.
   *
   * The real openClawWslWorkspace keeps a PREPARED baseline per directory — the envelope
   * path and its device:inode — and every removal is gated on it: no baseline, no removal,
   * because there is nothing left to identity-check the envelope against and deleting an
   * unverified directory is the one thing that must never happen. It drops the baseline ONLY
   * on a successful rm, and keeps it across a failed one so a transient failure stays
   * retryable.
   *
   * This fake used to have no baseline at all, so it would happily "remove" the same
   * directory twice. A test built on that could claim a second cleanup succeeds when against
   * the real provider it cannot — which is exactly the false claim C7 used to make.
   */
  const PREPARED = new Map()

  function remove (dir, opts, expectedKind, label) {
    seen.cleanupOpts.push(opts)
    if (!PREPARED.has(dir)) {
      return { ok: false, reason: 'refuse: no prepared sandbox baseline for this workspace' }
    }
    if (api.removeFails) return { ok: false, retryable: true, reason: 'rm: device or resource busy' }
    seen.ops.push({ label, expectedKind, kind: opts.grant && opts.grant.kind })
    if (!opts.grant || typeof opts.grant !== 'object') {
      return { ok: false, reason: `refuse: ${label} requires a '${expectedKind}' grant from the governing quarantine ledger` }
    }
    if (opts.grant.kind !== expectedKind) {
      return { ok: false, reason: `refuse: ${label} requires a '${expectedKind}' grant, got '${opts.grant.kind}'` }
    }
    // success drops the baseline, exactly as the real provider does
    PREPARED.delete(dir)
    removed.push(ENV_DIR)
    return { ok: true, removed: ENV_DIR }
  }

  return Object.assign(api, {
    removed,
    seen,
    prepare: (approvalId) => {
      seen.prepare.push(approvalId)
      PREPARED.set(REPO_DIR, { approvalId, envelope: ENV_DIR })
      return { dir: REPO_DIR, branch: 'agent/' + approvalId, baseSha: over.baseSha || APPROVED }
    },
    hasBaseline: (dir) => PREPARED.has(dir),
    // Each operation fixes its own expected grant kind, exactly as the real provider does,
    // so the adapter cannot quietly pass the wrong authority to the wrong operation.
    discardPreparedSandbox: (dir, opts = {}) => remove(dir, opts, 'pre-execution', 'discarding a prepared sandbox'),
    cleanupAfterExecution: (dir, opts = {}) => remove(dir, opts, 'executor-retired', 'cleanup after execution'),
    containmentCheck: (d) => d,
    envelopeContainmentCheck: (d) => d,
    sandboxState: () => Object.assign({}, CLEAN_SANDBOX, over.sandbox || {}),
    repoChanges: () => over.changes || [],
    diffStat: () => '',
    diffPatch: () => ''
  })
}

function governed (over = {}) {
  const quarantine = createOpenClawQuarantine({ store: memLedger(), verifyRetirementProof: verifyFakeRetirement })
  const wsl = fakeWslWorkspace(over)
  const cleanupResults = []
  const workspace = createOpenClawGovernedWorkspace({
    workspace: wsl, quarantine, onCleanupResult: (r) => cleanupResults.push(r),
    retirementProofFor: fakeRetirementProof
  })

  const spy = { transport: 0, cloneDirs: [], contracts: [] }
  const worker = {
    id: 'openclaw',
    capabilities: ['openclaw_repo_audit'],
    // AgentRunner calls: worker.invoke('AgentBridge', 1, { workOrder, workspace, cloneDir, branch })
    invoke: async (contract, version, ctx) => {
      spy.transport++
      spy.contracts.push({ contract, version })
      spy.cloneDirs.push(ctx.cloneDir)
      // a real transport would mark the ledger; do the same here
      quarantine.markRunning(APPROVAL, { agentId: 'aroma-' + APPROVAL, sessionKey: 'agent:aroma-' + APPROVAL + ':' + APPROVAL, phase: 'agent_add_attempting' })
      quarantine.markSucceeded(APPROVAL)
      return { ok: true, exit: 0, result: 'audit complete', output: {} }
    }
  }

  const runner = createAgentRunner({
    repoRoot: process.cwd(),
    projectId: IDENTITY.projectId,
    repoFullName: IDENTITY.repoFullName,
    worker,
    workspace,
    auditLog: { append: () => {} },
    writePatch: (id, text) => ({ ok: true, path: 'C:/tmp/p.patch', bytes: text.length }),
    checkCredentials: () => ({ canRun: true, state: 'ok', warning: null, refusal: null, refreshExpiresAt: null, daysLeft: 9, accessTokenValid: true, subscription: 'x' })
  })
  return { runner, workspace, quarantine, wsl, spy, cleanupResults }
}

const run = async (g, wo) => {
  const o = wo || workOrder()
  return g.runner.run({ workOrder: o, who: 'louie', approvedHash: hashWorkOrder(o) })
}

/* ══════════════ the call shape AgentRunner actually uses ══════════════ */

test('C0. ⛔ the adapter accepts AgentRunner\'s ONE-ARGUMENT cleanup(dir)', () => {
  // The exact shape at agentRunner.js: `workspace.cleanup(prepared.dir)`.
  const g = governed()
  assert.strictEqual(g.workspace.cleanup.length, 1, 'cleanup takes exactly one declared argument')

  const src = fs.readFileSync(path.join(__dirname, 'agentRunner.js'), 'utf8')
  const calls = src.match(/workspace\.cleanup\([^)]*\)/g) || []
  assert.ok(calls.length > 0, 'AgentRunner must still be calling cleanup')
  for (const c of calls) {
    assert.strictEqual(c, 'workspace.cleanup(prepared.dir)',
      `AgentRunner's call shape changed to ${c} — the adapter contract must be revisited`)
  }
})

/* ══════════════ C1 — revision mismatch, before any executor ══════════════ */

test('C1. revision mismatch: no worker runs, and the envelope IS removed', async () => {
  // Nothing executed, so nothing can be holding the envelope. Refusing here would leak a
  // sandbox for a run that never started.
  const g = governed({ baseSha: MOVED })
  const r = await run(g)

  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error, 'revision_moved')
  assert.strictEqual(g.spy.transport, 0, 'the executor is never reached')

  assert.deepStrictEqual(g.wsl.removed, [ENV_DIR], 'the whole envelope is removed')
  assert.strictEqual(g.quarantine.state(APPROVAL), STATES.CLEANED)
  const last = g.cleanupResults[g.cleanupResults.length - 1]
  assert.strictEqual(last.ok, true)
  assert.strictEqual(last.why, 'pre-execution')

  // PE3/PE4 — the historical record says what really happened, and invents no task status
  const rec = g.quarantine.record(APPROVAL)
  assert.strictEqual(rec.reason, 'no executor was ever started')
  assert.strictEqual('taskStatus' in rec, false, 'no task existed, so no taskStatus may be recorded')
  assert.ok(g.cleanupResults.every((x) => x.why !== 'terminal observed'), 'the terminal-observed path is not used here')
})

/* ══════════════ normal terminal run ══════════════ */

test('C2. ⛔ an EXECUTED envelope survives TERMINAL_OBSERVED, and is removed only once RETIRED', async () => {
  const g = governed()
  const r = await run(g)
  assert.strictEqual(r.ok, true, JSON.stringify(r))
  assert.deepStrictEqual(g.spy.cloneDirs, [REPO_DIR], 'the worker receives the REPO, not the envelope')

  // The run reached SUCCEEDED, so AgentRunner's cleanup ran — and was refused, because the
  // task's terminal status has not been observed yet.
  assert.strictEqual(g.quarantine.state(APPROVAL), STATES.SUCCEEDED)
  assert.deepStrictEqual(g.wsl.removed, [])

  // ⛔ AND EVEN AT TERMINAL_OBSERVED THE ENVELOPE MUST SURVIVE.
  // The global lock stops Aroma dispatching a NEW run; it does nothing to stop the OpenClaw
  // Gateway auto-resuming THIS session, and a resumed successor would still need this
  // workspace. Removing it here would delete a directory out from under a live executor.
  g.quarantine.observeTerminal(APPROVAL, 'succeeded')
  const refused = g.workspace.cleanup(REPO_DIR)
  assert.strictEqual(refused.ok, false)
  assert.strictEqual(refused.state, STATES.TERMINAL_OBSERVED)
  assert.match(refused.reason, /has not been retired/)
  assert.strictEqual(refused.retryable, true)
  assert.deepStrictEqual(g.wsl.removed, [], 'no removal primitive may be called')
  assert.strictEqual(g.workspace.approvalFor(REPO_DIR), APPROVAL, 'the OWNER mapping is preserved')
  assert.strictEqual(g.quarantine.canStart('appr_other').ok, false, 'and the lock is still held')

  // Only retirement authorises removal, and then the whole envelope goes.
  g.quarantine.retire(APPROVAL, fakeRetirementProof(APPROVAL))
  const done = g.workspace.cleanup(REPO_DIR)
  assert.strictEqual(done.ok, true, JSON.stringify(done))
  assert.deepStrictEqual(g.wsl.removed, [ENV_DIR])
  assert.strictEqual(g.quarantine.state(APPROVAL), STATES.CLEANED)
  assert.strictEqual(g.workspace.approvalFor(REPO_DIR), null)

  // every removal carried an executor-retired grant, never a terminal one
  for (const op of g.wsl.seen.ops) {
    if (op.label === 'cleanup after execution') assert.strictEqual(op.kind, 'executor-retired')
  }
})

test('C2b. ⛔ EXECUTOR_RETIRED releases the process lock BEFORE any disk work', () => {
  // Cleanup is about disk; the lock is about a process. A failed removal must never reopen a
  // process question it has nothing to do with.
  const q = createOpenClawQuarantine({ store: memLedger(), verifyRetirementProof: verifyFakeRetirement })
  const wsl = fakeWslWorkspace()
  const gw = createOpenClawGovernedWorkspace({ workspace: wsl, quarantine: q, retirementProofFor: fakeRetirementProof })
  const prepared = gw.prepare(APPROVAL)
  q.markRunning(APPROVAL, { agentId: 'aroma-' + APPROVAL, sessionKey: 'agent:aroma-' + APPROVAL + ':' + APPROVAL, phase: 'agent_add_attempting' })
  q.markSucceeded(APPROVAL); q.observeTerminal(APPROVAL, 'succeeded')

  assert.strictEqual(q.canStart('appr_other').ok, false)
  q.retire(APPROVAL, fakeRetirementProof(APPROVAL))
  assert.strictEqual(q.canStart('appr_other').ok, true, 'the SESSION is retired; disk is irrelevant to that')
  assert.deepStrictEqual(wsl.removed, [], 'and nothing has been removed yet')

  assert.strictEqual(gw.cleanup(prepared.dir).ok, true)
})

test('C2c. ⛔ a FAILED removal at EXECUTOR_RETIRED does not regress state, and retries later', () => {
  const q = createOpenClawQuarantine({ store: memLedger(), verifyRetirementProof: verifyFakeRetirement })
  const wsl = fakeWslWorkspace({ removeFails: true })
  const gw = createOpenClawGovernedWorkspace({ workspace: wsl, quarantine: q, retirementProofFor: fakeRetirementProof })
  const prepared = gw.prepare(APPROVAL)
  q.markRunning(APPROVAL, { agentId: 'aroma-' + APPROVAL, sessionKey: 'agent:aroma-' + APPROVAL + ':' + APPROVAL, phase: 'agent_add_attempting' })
  q.markSucceeded(APPROVAL); q.observeTerminal(APPROVAL, 'succeeded')
  q.retire(APPROVAL, fakeRetirementProof(APPROVAL))

  const failed = gw.cleanup(prepared.dir)
  assert.strictEqual(failed.ok, false)
  assert.strictEqual(failed.retryable, true)
  assert.strictEqual(q.state(APPROVAL), STATES.EXECUTOR_RETIRED, 'the state must NOT regress')
  assert.strictEqual(gw.approvalFor(prepared.dir), APPROVAL, 'ownership retained for the retry')
  assert.strictEqual(q.canStart('appr_other').ok, true, 'the process lock stays released')

  // the disk recovers, and the same call now succeeds
  wsl.removeFails = false
  const ok = gw.cleanup(prepared.dir)
  assert.strictEqual(ok.ok, true, JSON.stringify(ok))
  assert.strictEqual(q.state(APPROVAL), STATES.CLEANED)
})

/* ══════════════ C3 — quarantined run keeps its envelope ══════════════ */

test('C3. ⛔ a QUARANTINED run: cleanup does NOT remove the envelope and the lock holds', async () => {
  const g = governed()
  // the run reaches the executor, then the client stops waiting
  g.quarantine.begin(APPROVAL + '_x')          // occupy nothing; separate id for clarity
  g.quarantine.markRunning(APPROVAL + '_x', {
    agentId: 'aroma-' + APPROVAL + '_x',
    sessionKey: 'agent:aroma-' + APPROVAL + '_x:' + APPROVAL + '_x',
    phase: 'agent_add_attempting'
  })
  g.quarantine.markClientTimeout(APPROVAL + '_x')
  g.quarantine.quarantine(APPROVAL + '_x')

  // AgentRunner's own cleanup call, on a live quarantined approval
  g.workspace.prepare.call
  const before = g.wsl.removed.length

  // simulate the adapter being asked to clean a repo whose approval is quarantined
  const q2 = createOpenClawQuarantine({ store: memLedger(), verifyRetirementProof: verifyFakeRetirement })
  const wsl2 = fakeWslWorkspace()
  const results = []
  const gw = createOpenClawGovernedWorkspace({ workspace: wsl2, quarantine: q2, onCleanupResult: (r) => results.push(r), retirementProofFor: fakeRetirementProof })
  const prepared = gw.prepare(APPROVAL)
  q2.markRunning(APPROVAL, { agentId: 'aroma-' + APPROVAL, sessionKey: 'agent:aroma-' + APPROVAL + ':' + APPROVAL, phase: 'agent_add_attempting' })
  q2.markClientTimeout(APPROVAL)
  q2.quarantine(APPROVAL)

  const r = gw.cleanup(prepared.dir)
  assert.strictEqual(r.ok, false, 'cleanup must refuse while the executor is unaccounted for')
  assert.match(r.reason, /the envelope is preserved until a terminal task status is observed/)
  assert.deepStrictEqual(wsl2.removed, [], 'nothing was removed')
  assert.strictEqual(q2.state(APPROVAL), STATES.QUARANTINED, 'still quarantined')
  assert.strictEqual(q2.canStart('appr_other').ok, false, 'the global lock still holds')
  assert.strictEqual(g.wsl.removed.length, before)

  // ⛔ and the refusal is REPORTED, not swallowed — AgentRunner's catch would hide it
  assert.ok(results.some((x) => x.ok === false && /preserved until a terminal/.test(x.reason)),
    'a refused cleanup must be observable')
})

test('C4. a quarantined run becomes removable only after observation AND retirement', () => {
  const q = createOpenClawQuarantine({ store: memLedger(), verifyRetirementProof: verifyFakeRetirement })
  const wsl = fakeWslWorkspace()
  const gw = createOpenClawGovernedWorkspace({ workspace: wsl, quarantine: q, retirementProofFor: fakeRetirementProof })
  const prepared = gw.prepare(APPROVAL)
  q.markRunning(APPROVAL, { agentId: 'aroma-' + APPROVAL, sessionKey: 'agent:aroma-' + APPROVAL + ':' + APPROVAL, phase: 'agent_add_attempting' })
  q.markClientTimeout(APPROVAL); q.quarantine(APPROVAL)

  assert.strictEqual(gw.cleanup(prepared.dir).ok, false, 'quarantined: nothing removed')

  q.observeTerminal(APPROVAL, 'lost')
  const stillRefused = gw.cleanup(prepared.dir)
  assert.strictEqual(stillRefused.ok, false, 'terminal observation is still not enough')
  assert.match(stillRefused.reason, /has not been retired/)
  assert.deepStrictEqual(wsl.removed, [])

  q.retire(APPROVAL, fakeRetirementProof(APPROVAL))
  const ok = gw.cleanup(prepared.dir)
  assert.strictEqual(ok.ok, true, JSON.stringify(ok))
  assert.deepStrictEqual(wsl.removed, [ENV_DIR])
  assert.strictEqual(q.state(APPROVAL), STATES.CLEANED)
  assert.strictEqual(q.canStart('appr_other').ok, true)
})

/* ══════════════ terminality source ══════════════ */

test('C5. ⛔ terminality comes from the LEDGER, never from the caller', () => {
  const q = createOpenClawQuarantine({ store: memLedger(), verifyRetirementProof: verifyFakeRetirement })
  const wsl = fakeWslWorkspace()
  const gw = createOpenClawGovernedWorkspace({ workspace: wsl, quarantine: q })
  const prepared = gw.prepare(APPROVAL)
  q.markRunning(APPROVAL, { agentId: 'aroma-' + APPROVAL, sessionKey: 'agent:aroma-' + APPROVAL + ':' + APPROVAL, phase: 'agent_add_attempting' })

  // there is no parameter through which to assert it — extra arguments are ignored
  const r = gw.cleanup(prepared.dir, { terminal: true }, 'terminal', true)
  assert.strictEqual(r.ok, false, 'a caller cannot talk its way past a RUNNING executor')
  assert.deepStrictEqual(wsl.removed, [])

  const src = fs.readFileSync(path.join(__dirname, 'openClawGovernedWorkspace.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.ok(!/opts\s*\.\s*terminal|arguments\[1\]/.test(code),
    'the adapter must not read a caller-supplied terminal flag')
})

test('C6. the ledger gate runs BEFORE a sandbox is created', () => {
  // If OpenClaw is locked out, no envelope should be built at all.
  const q = createOpenClawQuarantine({ store: memLedger(), verifyRetirementProof: verifyFakeRetirement })
  const wsl = fakeWslWorkspace()
  const gw = createOpenClawGovernedWorkspace({ workspace: wsl, quarantine: q })

  q.begin('appr_live'); q.markRunning('appr_live', { agentId: 'aroma-appr_live', sessionKey: 'agent:aroma-appr_live:appr_live', phase: 'agent_add_attempting' })
  assert.throws(() => gw.prepare(APPROVAL), /locked out/)
  assert.deepStrictEqual(wsl.seen.prepare, [], 'no sandbox may be prepared while locked out')
})

/* ══════════════ PF1..PF7 — a FAILED prepare must not orphan anything ══════════════ */

/**
 * prepare() can fail after the envelope exists — a refused clone, a failed branch checkout,
 * a surviving remote. It THROWS rather than returning, so there is no dir to clean up with
 * and AgentRunner never calls cleanup because prepare never returned. Review found the
 * result: a partial envelope on disk and a ledger row stuck at PREPARED, which held nothing
 * open but made the approvalId permanently unusable while telling nobody why.
 */
function failingPrepareWorkspace (over = {}) {
  const aborted = []
  const removed = []
  return {
    aborted,
    removed,
    prepare: () => { throw new Error(over.message || 'refuse: clone failed (network unreachable)') },
    abortPrepare: (approvalId, opts = {}) => {
      // the real primitive refuses without a grant from the governing ledger
      if (!opts.grant || typeof opts.grant !== 'object') {
        return { ok: false, reason: 'refuse: abortPrepare requires a grant issued by the quarantine ledger' }
      }
      aborted.push({ approvalId, kind: opts.grant.kind })
      return { ok: true, removed: '/home/openclaw/.aroma/sandboxes/' + approvalId }
    },
    discardPreparedSandbox: (dir, opts = {}) => {
      if (!opts.grant) return { ok: false, reason: 'no grant' }
      removed.push(dir)
      return { ok: true, removed: dir }
    },
    containmentCheck: (d) => d,
    envelopeContainmentCheck: (d) => d,
    sandboxState: () => CLEAN_SANDBOX,
    repoChanges: () => [],
    diffStat: () => '',
    diffPatch: () => ''
  }
}

function governedFailing (over = {}) {
  const quarantine = createOpenClawQuarantine({ store: memLedger(), verifyRetirementProof: verifyFakeRetirement })
  const wsl = failingPrepareWorkspace(over)
  const cleanupResults = []
  const workspace = createOpenClawGovernedWorkspace({
    workspace: wsl, quarantine, onCleanupResult: (r) => cleanupResults.push(r)
  })
  const spy = { transport: 0 }
  const worker = {
    id: 'openclaw',
    capabilities: ['openclaw_repo_audit'],
    invoke: async () => { spy.transport++; return { ok: true, exit: 0, result: 'x', output: {} } }
  }
  const runner = createAgentRunner({
    repoRoot: process.cwd(),
    projectId: IDENTITY.projectId,
    repoFullName: IDENTITY.repoFullName,
    worker,
    workspace,
    auditLog: { append: () => {} },
    writePatch: () => ({ ok: true, path: 'C:/tmp/p.patch', bytes: 1 }),
    checkCredentials: () => ({ canRun: true, state: 'ok', warning: null, refusal: null, refreshExpiresAt: null, daysLeft: 9, accessTokenValid: true, subscription: 'x' })
  })
  return { runner, workspace, quarantine, wsl, spy, cleanupResults }
}

test('PF1/PF2/PF3/PF4. a failing prepare: run refused, envelope rolled back, ledger honest, no worker', async () => {
  const g = governedFailing()
  const r = await run(g)

  // PF1 — AgentRunner surfaces the refusal rather than proceeding
  assert.strictEqual(r.ok, false)
  assert.match(r.error, /^workspace_refused/, JSON.stringify(r))

  // PF4 — nothing executed
  assert.strictEqual(g.spy.transport, 0)

  // PF2 — the partial envelope was rolled back, by approvalId and with a grant
  assert.deepStrictEqual(g.wsl.aborted, [{ approvalId: APPROVAL, kind: 'pre-execution' }])

  // PF3 — the ledger says what actually happened, and carries no invented task status
  const rec = g.quarantine.record(APPROVAL)
  assert.strictEqual(rec.state, STATES.CLEANED)
  assert.match(rec.reason, /clone failed/)
  assert.strictEqual('taskStatus' in rec, false, 'no task ever existed, so no task status')

  // and the rollback outcome is reported, never silent
  assert.ok(g.cleanupResults.some((x) => x.why === 'preparation-failed' && x.ok === true))
})

test('PF5. another approval can start after a preparation failure', async () => {
  const g = governedFailing()
  await run(g)
  // nothing ran, so nothing is unaccounted for — the world is not blocked
  assert.deepStrictEqual(g.quarantine.unaccounted(), [])
  assert.strictEqual(g.quarantine.canStart('appr_other').ok, true)
})

test('PF6. ⛔ the failed approvalId itself can never be reused', async () => {
  const g = governedFailing()
  await run(g)
  const gate = g.quarantine.canStart(APPROVAL)
  assert.strictEqual(gate.ok, false)
  assert.match(gate.reason, /approvals are never reused/)
  assert.throws(() => g.workspace.prepare(APPROVAL), /approvals are never reused/)
})

test('PF7. ⛔ rollback is derived from the approvalId, never from the thrown error', async () => {
  // A thrown message is attacker-influenced input, and the rollback ends in `rm -rf`.
  const g = governedFailing({ message: 'refuse: clone failed for /etc and /home/openclaw' })
  await run(g)
  assert.deepStrictEqual(g.wsl.aborted.map((a) => a.approvalId), [APPROVAL],
    'the rollback target is the approvalId, never a path parsed out of the message')

  // and the real primitive refuses anything that is not a safe approvalId
  const { createOpenClawWslWorkspace } = require('../agent/openClawWslWorkspace')
  const q = createOpenClawQuarantine({ store: memLedger(), verifyRetirementProof: verifyFakeRetirement })
  const raw = createOpenClawWslWorkspace({
    wslRunner: () => ({ status: 0, stdout: '', stderr: '', timedOut: false }),
    verifyTerminalGrant: (x) => q.verifyTerminalGrant(x)
  })
  q.begin('appr_safe'); q.abortPreExecution('appr_safe')
  const grant = q.preExecutionGrant('appr_safe')
  for (const bad of ['../escape', '/etc', 'a/b', '', 'x'.repeat(65)]) {
    const res = raw.abortPrepare(bad, { grant })
    assert.strictEqual(res.ok, false, `${JSON.stringify(bad)} must be refused`)
  }
  // and a grant naming a different approval is refused
  assert.strictEqual(raw.abortPrepare('appr_other', { grant }).ok, false)
})

/* ══════════════ C7 — the ledger is written before ownership is released ══════════════ */

/**
 * ⛔ OWNERSHIP IS WHAT MAKES A RETRY POSSIBLE, SO IT IS RELEASED LAST.
 *
 * finish() used to do OWNER.delete(dir) and then markCleaned(). If the ledger write threw,
 * the mapping from directory to approvalId was already gone, so no later call could find the
 * approval again: the record sat mid-transition at EXECUTOR_RETIRED with its envelope already
 * deleted, and the only thing that could have reconciled the two had been discarded first.
 */
test('C7. ⛔ a ledger failure AFTER removal is NOT retryable, and is not dressed up as one', () => {
  /**
   * ⛔ THIS CASE HAS NO AUTOMATIC RECONCILIATION IN THIS TRANCHE. SAID PLAINLY.
   *
   * finish() removes the envelope and then records CLEANED. If the ledger write fails, the
   * disk is already gone — and the real WSL provider dropped its identity baseline on that
   * successful rm, so no later cleanup can replay the removal: it returns "no prepared
   * sandbox baseline" forever after. There is therefore nothing for a retry to DO.
   *
   * An earlier version of this test asserted the opposite: that once the ledger recovered,
   * the same gw.cleanup(dir) call would close the record out. It passed only because the
   * fake workspace had no baseline and would remove the same directory twice. Against the
   * real provider that is false, and a test asserting a recovery path that cannot exist is
   * worse than no test.
   *
   * What is kept is what is true and what is safe: the envelope is gone, the record is NOT
   * CLEANED, ownership is retained so the approval stays findable and accountable, and the
   * outcome is reported non-retryable. Closing it out requires a person — there is no safe
   * automatic primitive here, because inventing one would mean either a second cleanup
   * authority or bypassing the identity verifier, and both are worse than a manual step.
   */
  const real = createOpenClawQuarantine({ store: memLedger(), verifyRetirementProof: verifyFakeRetirement })
  let ledgerBroken = true
  const q = Object.assign({}, real, {
    markCleaned: (id, meta) => {
      if (ledgerBroken) throw new Error('ledger unwritable: EROFS')
      return real.markCleaned(id, meta)
    }
  })

  const wsl = fakeWslWorkspace()
  const results = []
  const gw = createOpenClawGovernedWorkspace({ workspace: wsl, quarantine: q, onCleanupResult: (r) => results.push(r) })
  const prepared = gw.prepare(APPROVAL)
  q.markRunning(APPROVAL, { agentId: 'aroma-' + APPROVAL, sessionKey: 'agent:aroma-' + APPROVAL + ':' + APPROVAL, phase: 'agent_add_attempting' })
  q.markSucceeded(APPROVAL); q.observeTerminal(APPROVAL, 'succeeded')
  q.retire(APPROVAL, fakeRetirementProof(APPROVAL))

  const r = gw.cleanup(prepared.dir)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.diskRemoved, true, 'the envelope really is gone')
  assert.strictEqual(r.ledgerRecorded, false)
  assert.strictEqual(r.ownerRetained, true)
  assert.strictEqual(r.retryable, false, 'NOT an ordinary disk retry, and must not be reported as one')
  assert.deepStrictEqual(wsl.removed, [ENV_DIR])
  assert.strictEqual(results[results.length - 1].ok, false, 'and it was reported, not swallowed')

  // the approval stays findable, and the record stays accountable rather than silently CLEANED
  assert.strictEqual(gw.approvalFor(prepared.dir), APPROVAL)
  assert.strictEqual(real.state(APPROVAL), STATES.EXECUTOR_RETIRED)

  // ⛔ AND THE REMOVAL CANNOT BE REPLAYED, EVEN ONCE THE LEDGER RECOVERS.
  // This is the assertion the old test got backwards.
  assert.strictEqual(wsl.hasBaseline(prepared.dir), false, 'the successful rm dropped the baseline')
  ledgerBroken = false
  const again = gw.cleanup(prepared.dir)
  assert.strictEqual(again.ok, false, 'a second cleanup CANNOT succeed against real provider semantics')
  assert.match(again.reason, /no prepared sandbox baseline/)
  // ⛔ AND IT MUST NOT CONTRADICT THE FIRST ANSWER.
  // The first result said retryable:false. A blanket default in finish() used to turn this
  // second one into retryable:true, so the API told the caller to keep retrying an operation
  // the provider can never perform again.
  assert.strictEqual(again.retryable, false, 'a missing baseline is not something a retry can fix')
  assert.strictEqual(real.state(APPROVAL), STATES.EXECUTOR_RETIRED, 'so the record is still not CLEANED')
  assert.strictEqual(gw.approvalFor(prepared.dir), APPROVAL, 'and it remains findable for manual reconciliation')
  assert.deepStrictEqual(wsl.removed, [ENV_DIR], 'nothing was removed a second time')
})

test('C7b. a successful cleanup releases ownership exactly once, and cannot be replayed', () => {
  const q = createOpenClawQuarantine({ store: memLedger(), verifyRetirementProof: verifyFakeRetirement })
  const wsl = fakeWslWorkspace()
  const gw = createOpenClawGovernedWorkspace({ workspace: wsl, quarantine: q })
  const prepared = gw.prepare(APPROVAL)
  q.abortPreExecution(APPROVAL, { reason: 'never started' })

  assert.strictEqual(gw.cleanup(prepared.dir).ok, true)
  assert.strictEqual(gw.approvalFor(prepared.dir), null)
  assert.strictEqual(wsl.hasBaseline(prepared.dir), false, 'the provider dropped its baseline too')

  // AgentRunner can call cleanup again on a failure path; the second call must refuse plainly
  // rather than removing anything a second time.
  const again = gw.cleanup(prepared.dir)
  assert.strictEqual(again.ok, false)
  assert.match(again.reason, /no governed sandbox/)
  assert.deepStrictEqual(wsl.removed, [ENV_DIR], 'removal happened exactly once')
})

test('C7c. a FAILED removal keeps the baseline, so that one IS genuinely retryable', () => {
  // The contrast that makes C7 meaningful: the baseline outlives a failure, so a transient
  // disk problem stays recoverable. It is only the SUCCESSFUL removal that is unreplayable.
  const q = createOpenClawQuarantine({ store: memLedger(), verifyRetirementProof: verifyFakeRetirement })
  const wsl = fakeWslWorkspace({ removeFails: true })
  const gw = createOpenClawGovernedWorkspace({ workspace: wsl, quarantine: q })
  const prepared = gw.prepare(APPROVAL)
  q.abortPreExecution(APPROVAL, { reason: 'never started' })

  const failed = gw.cleanup(prepared.dir)
  assert.strictEqual(failed.ok, false)
  assert.strictEqual(failed.retryable, true, 'the provider said so EXPLICITLY — this is the one case that clears')
  assert.strictEqual(wsl.hasBaseline(prepared.dir), true, 'the baseline survived the failure')

  wsl.removeFails = false
  assert.strictEqual(gw.cleanup(prepared.dir).ok, true, 'and the retry really does close it out')
  assert.strictEqual(q.state(APPROVAL), STATES.CLEANED)
})

test('C7d. ⛔ only an EXPLICIT retryable:true is reported as retryable', () => {
  // The refusals a workspace can return are mostly permanent: a missing identity baseline, an
  // envelope that is not the prepared object, a containment refusal, a grant of the wrong
  // kind. None of them clear by waiting, and none of them carry a retryable field — so a
  // default of true was answering a question the provider never answered.
  const REFUSALS = [
    ['no baseline', { ok: false, reason: 'refuse: no prepared sandbox baseline for this workspace' }],
    ['identity mismatch', { ok: false, reason: 'refuse: the envelope is not the prepared object (a -> b)' }],
    ['containment refused', { ok: false, reason: 'refuse: envelope escapes the sandbox root' }],
    ['wrong grant kind', { ok: false, reason: "refuse: cleanup after execution requires a 'executor-retired' grant" }],
    ['explicitly not retryable', { ok: false, retryable: false, reason: 'refuse: permanent' }],
    ['nothing returned at all', undefined]
  ]
  for (const [name, refusal] of REFUSALS) {
    const q = createOpenClawQuarantine({ store: memLedger(), verifyRetirementProof: verifyFakeRetirement })
    const wsl = fakeWslWorkspace()
    wsl.discardPreparedSandbox = () => refusal
    const gw = createOpenClawGovernedWorkspace({ workspace: wsl, quarantine: q })
    const prepared = gw.prepare(APPROVAL)
    q.abortPreExecution(APPROVAL, { reason: 'never started' })

    const r = gw.cleanup(prepared.dir)
    assert.strictEqual(r.ok, false, name)
    assert.strictEqual(r.retryable, false, name + ': absent or false retryability must NOT become true')
    assert.strictEqual(q.state(APPROVAL), STATES.PRE_EXECUTION_ABORTED, name + ': and nothing was recorded CLEANED')
  }

  // the contrast, through the same path: an explicit true is honoured
  const q = createOpenClawQuarantine({ store: memLedger(), verifyRetirementProof: verifyFakeRetirement })
  const wsl = fakeWslWorkspace()
  wsl.discardPreparedSandbox = () => ({ ok: false, retryable: true, reason: 'rm: device or resource busy' })
  const gw = createOpenClawGovernedWorkspace({ workspace: wsl, quarantine: q })
  const prepared = gw.prepare(APPROVAL)
  q.abortPreExecution(APPROVAL, { reason: 'never started' })
  assert.strictEqual(gw.cleanup(prepared.dir).retryable, true, 'an explicit true is still honoured')
})
