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
  const seen = { prepare: [], cleanupOpts: [] }
  return {
    removed,
    seen,
    prepare: (approvalId) => {
      seen.prepare.push(approvalId)
      return { dir: REPO_DIR, branch: 'agent/' + approvalId, baseSha: over.baseSha || APPROVED }
    },
    cleanup: (dir, opts = {}) => {
      seen.cleanupOpts.push(opts)
      // the real provider refuses without a genuine grant; mirror that here so a missing
      // grant cannot pass unnoticed
      if (!opts.grant || typeof opts.grant !== 'object') {
        return { ok: false, reason: 'refuse: cleanup requires a terminal grant issued by the quarantine ledger' }
      }
      removed.push(ENV_DIR)
      return { ok: true, removed: ENV_DIR }
    },
    containmentCheck: (d) => d,
    envelopeContainmentCheck: (d) => d,
    sandboxState: () => Object.assign({}, CLEAN_SANDBOX, over.sandbox || {}),
    repoChanges: () => over.changes || [],
    diffStat: () => '',
    diffPatch: () => ''
  }
}

function governed (over = {}) {
  const quarantine = createOpenClawQuarantine({ store: memLedger() })
  const wsl = fakeWslWorkspace(over)
  const cleanupResults = []
  const workspace = createOpenClawGovernedWorkspace({
    workspace: wsl, quarantine, onCleanupResult: (r) => cleanupResults.push(r)
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
      quarantine.markRunning(APPROVAL)
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

test('C2. a normal run: same repo dir throughout, terminal observation permits cleanup', async () => {
  const g = governed()
  const r = await run(g)
  assert.strictEqual(r.ok, true, JSON.stringify(r))

  assert.deepStrictEqual(g.spy.cloneDirs, [REPO_DIR], 'the worker receives the REPO, not the envelope')

  // ⛔ ACCEPTING A RESULT IS NOT OBSERVING THE TASK TERMINAL.
  // The run reached SUCCEEDED, so AgentRunner's cleanup ran — and was REFUSED, because the
  // task's terminal status has not been observed yet. C2-B2-A is why: a returned result does
  // not prove the executor stopped. Inventing the observation here would be the exact
  // shortcut this design exists to refuse, so the envelope is held instead.
  assert.strictEqual(g.quarantine.state(APPROVAL), STATES.SUCCEEDED)
  assert.deepStrictEqual(g.wsl.removed, [], 'nothing removed while the task is unobserved')
  assert.ok(g.cleanupResults.some((x) => x.ok === false && /preserved until a terminal/.test(x.reason)),
    'and the refusal is reported rather than swallowed by AgentRunner\'s empty catch')

  // once the terminal status IS observed — the transport's job in a later tranche — the same
  // envelope becomes removable, whole.
  g.quarantine.observeTerminal(APPROVAL, 'succeeded')
  const done = g.workspace.cleanup(REPO_DIR)
  assert.strictEqual(done.ok, true, JSON.stringify(done))
  assert.deepStrictEqual(g.wsl.removed, [ENV_DIR], 'the whole envelope is removed')
  assert.strictEqual(g.workspace.approvalFor(REPO_DIR), null, 'ownership is released after cleanup')
  assert.strictEqual(g.quarantine.state(APPROVAL), STATES.CLEANED)

  // every cleanup carried a genuine grant, never a caller-asserted boolean
  for (const opts of g.wsl.seen.cleanupOpts) {
    assert.ok(opts.grant && opts.grant.approvalId === APPROVAL, 'a grant is always supplied')
    assert.strictEqual(opts.terminal, undefined, 'no terminal boolean is ever passed')
  }
})

/* ══════════════ C3 — quarantined run keeps its envelope ══════════════ */

test('C3. ⛔ a QUARANTINED run: cleanup does NOT remove the envelope and the lock holds', async () => {
  const g = governed()
  // the run reaches the executor, then the client stops waiting
  g.quarantine.begin(APPROVAL + '_x')          // occupy nothing; separate id for clarity
  g.quarantine.markRunning(APPROVAL + '_x')
  g.quarantine.markClientTimeout(APPROVAL + '_x')
  g.quarantine.quarantine(APPROVAL + '_x')

  // AgentRunner's own cleanup call, on a live quarantined approval
  g.workspace.prepare.call
  const before = g.wsl.removed.length

  // simulate the adapter being asked to clean a repo whose approval is quarantined
  const q2 = createOpenClawQuarantine({ store: memLedger() })
  const wsl2 = fakeWslWorkspace()
  const results = []
  const gw = createOpenClawGovernedWorkspace({ workspace: wsl2, quarantine: q2, onCleanupResult: (r) => results.push(r) })
  const prepared = gw.prepare(APPROVAL)
  q2.markRunning(APPROVAL)
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

test('C4. once terminal is observed, the same envelope becomes removable', () => {
  const q = createOpenClawQuarantine({ store: memLedger() })
  const wsl = fakeWslWorkspace()
  const gw = createOpenClawGovernedWorkspace({ workspace: wsl, quarantine: q })
  const prepared = gw.prepare(APPROVAL)
  q.markRunning(APPROVAL); q.markClientTimeout(APPROVAL); q.quarantine(APPROVAL)

  assert.strictEqual(gw.cleanup(prepared.dir).ok, false)
  q.observeTerminal(APPROVAL, 'lost')
  const ok = gw.cleanup(prepared.dir)
  assert.strictEqual(ok.ok, true, JSON.stringify(ok))
  assert.deepStrictEqual(wsl.removed, [ENV_DIR])
  assert.strictEqual(q.state(APPROVAL), STATES.CLEANED)
  assert.strictEqual(q.canStart('appr_other').ok, true, 'and the lock is released')
})

/* ══════════════ terminality source ══════════════ */

test('C5. ⛔ terminality comes from the LEDGER, never from the caller', () => {
  const q = createOpenClawQuarantine({ store: memLedger() })
  const wsl = fakeWslWorkspace()
  const gw = createOpenClawGovernedWorkspace({ workspace: wsl, quarantine: q })
  const prepared = gw.prepare(APPROVAL)
  q.markRunning(APPROVAL)

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
  const q = createOpenClawQuarantine({ store: memLedger() })
  const wsl = fakeWslWorkspace()
  const gw = createOpenClawGovernedWorkspace({ workspace: wsl, quarantine: q })

  q.begin('appr_live'); q.markRunning('appr_live')
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
    cleanup: (dir, opts = {}) => {
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
  const quarantine = createOpenClawQuarantine({ store: memLedger() })
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
  const q = createOpenClawQuarantine({ store: memLedger() })
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
