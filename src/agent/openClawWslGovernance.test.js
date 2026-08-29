'use strict'

/**
 * openClawWslGovernance.test.js — ONE DIRECTORY, ALL THE WAY THROUGH.
 *
 * This is the load-bearing test of C2-B1, and it exists because of a specific, plausible
 * mistake: OpenClaw lives inside WSL and cannot see the Windows clone, so the tempting
 * design is to copy the clone in, run there, and keep verifying the Windows copy. Every C1
 * guarantee would then pass VACUOUSLY — the verifier would be reading a directory the
 * executor never touched, and a read-only check aimed at an untouched directory always says
 * "clean". It would be indistinguishable from a working audit.
 *
 * So the property pinned here is the boring one that prevents it: the path prepare() returns
 * is the path the worker is handed, is the path sandboxState and repoChanges measure, is the
 * path cleanup removes — and it is a POSIX path inside the distro, never a Windows path.
 */

const os = require('os')
const fs = require('fs')
const path = require('path')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-c2b1-gov-'))

const test = require('node:test')
const assert = require('node:assert')

const { createAgentRunner } = require('../agent/agentRunner')
const { createOpenClawWorker } = require('../agent/openClawWorker')
const { hashWorkOrder } = require('../agent/workOrder')

const APPROVED = '4511f7deeb279b189642b3b812b56250ce518d98'
const MOVED = 'e034ccc5cc89409375f538ce2a6b7a30f2d14700'
const WSL_DIR = '/home/openclaw/.aroma/sandboxes/appr_gov'
const IDENTITY = { projectId: 'aroma-agent-backend', repoFullName: 'Louielui/aroma-agent-backend' }

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
  branch: 'agent/appr_gov',
  approvalId: 'appr_gov'
}, over)

const CLEAN_SANDBOX = {
  headSha: APPROVED,
  currentBranch: 'agent/appr_gov',
  remotes: [],
  indexFlagged: [],
  indexDrift: [],
  dotGitIsRealDir: true,
  topLevelOk: true,
  gitDirOk: true,
  commonDirOk: true
}

/**
 * A WSL workspace stand-in that RECORDS every directory each method was asked about, so the
 * test can assert they are all the same one. The real provider is exercised against the real
 * distro in openClawWslWorkspace.live.test.js; here the question is wiring, not git.
 */
function recordingWslWorkspace (over = {}) {
  const seen = { prepare: null, containment: [], sandboxState: [], repoChanges: [], cleanup: [] }
  return {
    seen,
    prepare: (approvalId) => {
      seen.prepare = { approvalId, dir: WSL_DIR }
      return { dir: WSL_DIR, branch: 'agent/appr_gov', baseSha: over.baseSha || APPROVED }
    },
    containmentCheck: (d) => { seen.containment.push(d); return d },
    sandboxState: (d) => { seen.sandboxState.push(d); return Object.assign({}, CLEAN_SANDBOX, over.sandbox || {}) },
    repoChanges: (d) => { seen.repoChanges.push(d); return over.changes || [] },
    diffStat: () => '', diffPatch: () => '',
    cleanup: (d) => { seen.cleanup.push(d); return { ok: true } }
  }
}

function governed (over = {}) {
  const spy = { transport: 0, cloneDirs: [] }
  const audits = []
  const workspace = recordingWslWorkspace(over)
  const worker = createOpenClawWorker({
    transport: async (brief, ctx) => { spy.transport++; spy.cloneDirs.push(ctx.cloneDir); return { ok: true, exit: 0, result: 'audit complete' } },
    testRunner: async () => ({ ok: true, code: 0 })
  })
  const runner = createAgentRunner({
    repoRoot: process.cwd(),
    projectId: IDENTITY.projectId,
    repoFullName: IDENTITY.repoFullName,
    worker,
    workspace,
    auditLog: { append: (a) => audits.push(a) },
    writePatch: (id, text) => ({ ok: true, path: 'C:/tmp/p.patch', bytes: text.length }),
    checkCredentials: () => ({ canRun: true, state: 'ok', warning: null, refusal: null, refreshExpiresAt: null, daysLeft: 9, accessTokenValid: true, subscription: 'x' })
  })
  return { runner, workspace, spy, audits }
}

const run = async (g, wo) => {
  const o = wo || workOrder()
  return g.runner.run({ workOrder: o, who: 'louie', approvedHash: hashWorkOrder(o) })
}

/* ══════════════ W13 — the load-bearing property ══════════════ */

test('W13. ⛔ prepare -> worker -> verifier -> cleanup all use the SAME WSL directory', async () => {
  const g = governed()
  const r = await run(g)
  assert.strictEqual(r.ok, true, JSON.stringify(r))

  const s = g.workspace.seen
  assert.strictEqual(s.prepare.dir, WSL_DIR)

  // the executor was handed exactly that path
  assert.deepStrictEqual(g.spy.cloneDirs, [WSL_DIR], 'the worker receives the prepared WSL sandbox')

  // and every verification asked about the same one
  assert.ok(s.sandboxState.length >= 2, 'verified before the transport and after it')
  for (const d of s.sandboxState) assert.strictEqual(d, WSL_DIR)
  for (const d of s.repoChanges) assert.strictEqual(d, WSL_DIR)
  for (const d of s.containment) assert.strictEqual(d, WSL_DIR)
  assert.deepStrictEqual(s.cleanup, [WSL_DIR], 'and cleanup removed that same sandbox')
})

test('W13b. ⛔ no WINDOWS path is ever executed or verified', async () => {
  // The vacuous-verification failure mode has a signature: a Windows path appearing anywhere
  // in the executed/verified set. This asserts its absence directly.
  const g = governed()
  await run(g)
  const s = g.workspace.seen
  const everyPath = [s.prepare.dir, ...g.spy.cloneDirs, ...s.sandboxState, ...s.repoChanges, ...s.containment, ...s.cleanup]
  for (const p of everyPath) {
    assert.ok(p.startsWith('/'), `every path must be POSIX, got ${p}`)
    assert.ok(!/^[A-Za-z]:/.test(p), `no Windows drive path may appear: ${p}`)
    assert.ok(!p.includes('\\'), `no Windows separator may appear: ${p}`)
    assert.ok(!p.includes('/mnt/c'), `the Windows filesystem must never be the sandbox: ${p}`)
  }
  assert.ok(s.prepare.dir.startsWith('/home/openclaw/.aroma/sandboxes/'), 'strictly beneath the fixed WSL sandbox root')
})

/* ══════════════ B2 still governs, unchanged ══════════════ */

test('W14. a revision mismatch stops OpenClaw before the WSL sandbox is ever used', async () => {
  const g = governed({ baseSha: MOVED })
  const r = await run(g)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error, 'revision_moved')
  assert.strictEqual(g.spy.transport, 0, 'the executor is never reached')
  assert.strictEqual(r.output.expectedSha, APPROVED)
  assert.strictEqual(r.output.observedBaseSha, MOVED)
  assert.strictEqual(r.output.revisionMatch, false)
  assert.deepStrictEqual(g.workspace.seen.cleanup, [WSL_DIR], 'the refused sandbox is still removed')
})

test('W15. baseSha comes from the WSL clone, and expectedSha is never rewritten to match', async () => {
  // If main moved after approval, B2 must still refuse — the mirror representing current
  // main is not a reason to update what the Owner approved.
  const wo = workOrder()
  const before = JSON.stringify(wo)
  const g = governed({ baseSha: MOVED })
  await run(g, wo)
  assert.strictEqual(JSON.stringify(wo), before, 'the sealed order is untouched')
  assert.strictEqual(wo.expectedSha, APPROVED)
})

test('W16. a read-only violation inside the WSL sandbox still fails the run', async () => {
  const g = governed({ changes: ['.env'] })
  const r = await run(g)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error, 'openclaw_read_only_violation')
  assert.deepStrictEqual(r.output.filesChanged, ['.env'])
  assert.strictEqual(r.output.revisionMatch, true, 'B2 entry evidence survives')
})

test('W17. a sandbox that stops being the sandbox still fails the run', async () => {
  for (const [name, patch, risk] of [
    ['HEAD moved', { headSha: MOVED }, 'workspace_revision_violation'],
    ['git-dir redirected', { gitDirOk: false }, 'workspace_isolation_violation'],
    ['remote reappeared', { remotes: ['attacker'] }, 'workspace_isolation_violation'],
    ['skip-worktree set', { indexFlagged: [{ tag: 'S', file: 'x' }] }, 'workspace_index_violation']
  ]) {
    const g = governed({ sandbox: patch })
    const r = await run(g)
    assert.strictEqual(r.ok, false, name)
    assert.deepStrictEqual(r.output.risks, [risk], `${name} -> ${risk}`)
  }
})

test('W18. OpenClaw is still not connected and nothing was wired into production', () => {
  const { getWorker, listWorkers } = require('../workers/registry')
  assert.strictEqual(getWorker('openclaw').connected, false)
  assert.deepStrictEqual(listWorkers().filter((w) => w.connected).map((w) => w.id), ['architect'])

  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')
  assert.ok(!app.includes('openClawWslWorkspace'), 'the WSL workspace must not be constructed at startup')
  assert.ok(!app.includes('createOpenClawWorker'), 'the OpenClaw worker must not be constructed at startup')
})

test('W19. the existing Windows workspace provider is untouched', () => {
  // featureBranchWorkspace is production-proven for AgentBridge. A shared implementation
  // would put Claude's proven path at risk for OpenClaw's benefit.
  const src = fs.readFileSync(path.join(__dirname, 'featureBranchWorkspace.js'), 'utf8')
  assert.ok(!src.includes('wsl.exe'), 'no WSL launcher may appear in the Windows provider')
  assert.ok(!src.includes('OpenClawGateway'), 'no distro name may appear in the Windows provider')
  assert.ok(src.includes('assertSandboxUnderTmpdir'), 'its Windows containment brake is still there')
})
