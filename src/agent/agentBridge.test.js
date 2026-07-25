'use strict'

// agentBridge.test.js — Agent Bridge v0. Deterministic, ZERO paid calls, ZERO real
// clone/claude. Injected runner + fake git prove every security cap by structure.

const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const { test } = require('node:test')
const assert = require('node:assert/strict')

const WO = require('./workOrder')
const { resolveAgentBridge, authorizeExecution } = require('./agentAuthorization')
const { createFeatureBranchWorkspace } = require('./featureBranchWorkspace')
const { createAgentBridgeWorker } = require('./agentBridgeWorker')
const { createAuditLog } = require('./audit')
const { createWorkerRunner } = require('../workers/runWorkerInBackground')
const { createArtifactStore } = require('../store/artifactStore')
const { buildResultView, findExecutionByProposalId, findResultByTaskId } = require('../api/executionResultView')

const validWO = () => ({
  goal: 'add a small helper', allowedFiles: ['src/foo.js'], allowedTestCommand: null,
  forbiddenActions: ['commit', 'push', 'PR', 'merge', 'deploy'], timeoutSec: 60, costCapUsd: 1, approvalId: 'appr_1'
})
const okClaude = async () => ({ status: 0, stdout: JSON.stringify({ subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0.01 }), stderr: '', timedOut: false })
function fakeWorkspace (over = {}) {
  return {
    containmentCheck: over.containmentCheck || ((t) => t || '/tmp/aroma-sandbox-agent-x'),
    permissionMode: over.permissionMode || (() => 'acceptEdits'),
    filesChanged: over.filesChanged || (() => ['src/foo.js']),
    diffStat: over.diffStat || (() => ' src/foo.js | 2 +-'),
    remotes: over.remotes || (() => []),
    currentBranch: over.currentBranch || (() => 'agent/appr_1'),
    addDirs: (d) => [d]
  }
}

/* ───────────────────────── workOrder validation (Cap 5) ───────────────────── */
test('workOrder: a well-formed order validates', () => {
  assert.equal(WO.validateWorkOrder(validWO()).ok, true)
})
test('workOrder: rejects missing/empty required fields', () => {
  assert.equal(WO.validateWorkOrder({}).ok, false)
  assert.equal(WO.validateWorkOrder(Object.assign(validWO(), { allowedFiles: [] })).ok, false)
  assert.equal(WO.validateWorkOrder(Object.assign(validWO(), { timeoutSec: 0 })).ok, false)
  assert.equal(WO.validateWorkOrder(Object.assign(validWO(), { costCapUsd: -1 })).ok, false)
  assert.equal(WO.validateWorkOrder(Object.assign(validWO(), { approvalId: 'bad id!' })).ok, false)
})
test('workOrder: must declare commit/push/PR/merge/deploy forbidden', () => {
  assert.equal(WO.validateWorkOrder(Object.assign(validWO(), { forbiddenActions: ['commit'] })).ok, false)
})
test('workOrder: absolute / traversing / forbidden files are un-allowlistable', () => {
  // Every one of these must be REJECTED by validation (the real guarantee).
  for (const f of ['/etc/passwd', 'C:/x', '../secret', '.env', 'src/app.js', 'src/agent/audit.js', 'src/agent/agentAuthorization.js', 'src/store/store.js', '.aroma/x']) {
    assert.equal(WO.validateWorkOrder(Object.assign(validWO(), { allowedFiles: [f] })).ok, false, `${f} must be rejected`)
  }
  // Pattern-forbidden (sensitive) files are additionally flagged by isForbiddenFile.
  for (const f of ['../secret', '.env', 'src/app.js', 'src/agent/audit.js', 'src/agent/agentAuthorization.js', 'src/store/store.js', '.aroma/x']) {
    assert.equal(WO.isForbiddenFile(f), true, `${f} must be forbidden`)
  }
})
test('workOrder: isFileAllowed + deterministic hash', () => {
  const wo = validWO()
  assert.equal(WO.isFileAllowed(wo, 'src/foo.js'), true)
  assert.equal(WO.isFileAllowed(wo, 'src/bar.js'), false)
  assert.equal(WO.isFileAllowed(wo, 'src/app.js'), false) // forbidden even if listed elsewhere
  assert.equal(WO.hashWorkOrder(wo), WO.hashWorkOrder(validWO()))
})

/* ───────────────────── authorization matrix (two-of-three) ────────────────── */
test('resolveAgentBridge: strict on only, fail-closed', () => {
  const R = (v) => resolveAgentBridge(v === undefined ? {} : { AGENT_BRIDGE: v })
  assert.equal(R(undefined), 'off'); assert.equal(R(''), 'off'); assert.equal(R('ON'), 'off')
  assert.equal(R('true'), 'off'); assert.equal(R('off'), 'off'); assert.equal(R('on'), 'on')
})
test('authorizeExecution: any two-of-three on → configuration_conflict → zero', () => {
  const pairs = [['on', 'on', 'off'], ['on', 'off', 'on'], ['off', 'on', 'on'], ['on', 'on', 'on']]
  for (const [w, d, a] of pairs) {
    const r = authorizeExecution({ worker: w, develop: d, agent: a, dispatcherConfigured: true, agentRunnerConfigured: true })
    assert.deepEqual(r, { status: 'configuration_conflict', workerAuthorized: false, developAuthorized: false, agentBridgeAuthorized: false })
  }
})
test('authorizeExecution: single-lane, needs its runner configured', () => {
  assert.equal(authorizeExecution({ worker: 'off', develop: 'off', agent: 'on', agentRunnerConfigured: true }).agentBridgeAuthorized, true)
  assert.equal(authorizeExecution({ worker: 'off', develop: 'off', agent: 'on', agentRunnerConfigured: false }).agentBridgeAuthorized, false)
  assert.equal(authorizeExecution({ worker: 'on', develop: 'off', agent: 'off' }).status, 'worker_authorized')
  assert.equal(authorizeExecution({ worker: 'off', develop: 'on', agent: 'off', dispatcherConfigured: true }).status, 'develop_authorized')
})
test('authorizeExecution: all off → not_authorized (default dormant)', () => {
  assert.equal(authorizeExecution({ worker: 'off', develop: 'off', agent: 'off' }).status, 'not_authorized')
})

/* ─────────────── featureBranchWorkspace (Cap 3/4) — fake git ──────────────── */
function makeFakeGit ({ leaveRemote = false, changed = [] } = {}) {
  const state = { branch: null, remotes: ['origin'], changed }
  const ok = (stdout) => ({ status: 0, stdout, stderr: '' })
  const git = (args) => {
    const j = args.join(' ')
    if (args[0] === 'clone') return ok('')
    if (args[0] === 'checkout' && args.includes('-b')) { state.branch = args[args.length - 1]; return ok('') }
    if (j === 'remote') return ok(state.remotes.join('\n'))
    if (args[0] === 'remote' && args[1] === 'remove') { if (!leaveRemote) state.remotes = state.remotes.filter((r) => r !== args[2]); return ok('') }
    if (j.startsWith('rev-parse --abbrev-ref')) return ok(state.branch || '')
    if (j.startsWith('diff --name-only')) return ok(state.changed.join('\n'))
    if (j.startsWith('diff --stat')) return ok(state.changed.length ? ` ${state.changed[0]} | 1 +` : '')
    return ok('')
  }
  git._state = state
  return git
}
test('workspace.prepare: isolated clone, agent branch, remotes removed', () => {
  const ws = createFeatureBranchWorkspace({ repoRoot: process.cwd(), gitRunner: makeFakeGit() })
  const { dir, branch } = ws.prepare('appr_1')
  assert.equal(branch, 'agent/appr_1')
  assert.ok(dir.startsWith(fs.realpathSync(os.tmpdir()))) // strictly under tmpdir
  assert.equal(ws.remotes(dir).length, 0)
  assert.equal(ws.currentBranch(dir), 'agent/appr_1')
  assert.notEqual(ws.permissionMode(), 'bypassPermissions')
  fs.rmSync(dir, { recursive: true, force: true })
})
test('workspace.prepare: refuse when a remote survives removal', () => {
  const ws = createFeatureBranchWorkspace({ repoRoot: process.cwd(), gitRunner: makeFakeGit({ leaveRemote: true }) })
  assert.throws(() => ws.prepare('appr_1'), /remote .* still present/)
})
test('workspace.prepare: refuse a workspace not under tmpdir (containment)', () => {
  const ws = createFeatureBranchWorkspace({ repoRoot: process.cwd(), gitRunner: makeFakeGit(), mkdtemp: () => os.homedir() })
  assert.throws(() => ws.prepare('appr_1'), /not under os\.tmpdir/)
})
test('workspace.prepare: refuse an unsafe approvalId', () => {
  const ws = createFeatureBranchWorkspace({ repoRoot: process.cwd(), gitRunner: makeFakeGit() })
  assert.throws(() => ws.prepare('../evil'), /safe approvalId/)
})

/* ──────────────── agentBridgeWorker (Cap 1/2/3/4/8) ───────────────────────── */
test('worker.buildArgs: NO bypassPermissions; allowedTools = Read Edit Write; no Bash', () => {
  const w = createAgentBridgeWorker({ runner: okClaude })
  const args = w.buildArgs(validWO(), '/tmp/aroma-sandbox-agent-x', 'acceptEdits')
  assert.ok(!args.includes('bypassPermissions'))
  assert.ok(args.includes('--permission-mode') && args.includes('acceptEdits'))
  const tools = args[args.indexOf('--allowedTools') + 1]
  assert.equal(tools, 'Read Edit Write')
  assert.ok(!/Bash|git|push/i.test(tools))
})
test('worker: happy path → ok, enriched output, zero risks', async () => {
  const w = createAgentBridgeWorker({ runner: okClaude })
  const r = await w.invoke('AgentBridge', 1, { workOrder: validWO(), workspace: fakeWorkspace(), cloneDir: '/tmp/aroma-sandbox-agent-x', branch: 'agent/appr_1' })
  assert.equal(r.ok, true)
  assert.equal(r.output.branch, 'agent/appr_1')
  assert.deepEqual(r.output.filesChanged, ['src/foo.js'])
  assert.deepEqual(r.output.risks, [])
  assert.equal(r.cost, 0.01)
})
test('worker: file changed outside allowlist → ok:false + risk', async () => {
  const w = createAgentBridgeWorker({ runner: okClaude })
  const ws = fakeWorkspace({ filesChanged: () => ['src/foo.js', 'src/secret.js'] })
  const r = await w.invoke('AgentBridge', 1, { workOrder: validWO(), workspace: ws, cloneDir: '/tmp/aroma-sandbox-agent-x', branch: 'agent/appr_1' })
  assert.equal(r.ok, false)
  assert.ok(r.output.risks.includes('files_outside_allowlist'))
})
test('worker: a surviving remote → ok:false + risk (no push target check)', async () => {
  const w = createAgentBridgeWorker({ runner: okClaude })
  const ws = fakeWorkspace({ remotes: () => ['origin'] })
  const r = await w.invoke('AgentBridge', 1, { workOrder: validWO(), workspace: ws, cloneDir: '/tmp/x', branch: 'agent/appr_1' })
  assert.equal(r.ok, false)
  assert.ok(r.output.risks.includes('remote_present'))
})
test('worker: cost over cap → ok:false + risk', async () => {
  const dear = async () => ({ status: 0, stdout: JSON.stringify({ subtype: 'success', is_error: false, result: 'x', total_cost_usd: 5 }), stderr: '', timedOut: false })
  const w = createAgentBridgeWorker({ runner: dear })
  const r = await w.invoke('AgentBridge', 1, { workOrder: validWO(), workspace: fakeWorkspace(), cloneDir: '/tmp/x', branch: 'agent/appr_1' })
  assert.equal(r.ok, false)
  assert.ok(r.output.risks.includes('cost_cap_exceeded'))
})
test('worker: timeout kill → ok:false + risk', async () => {
  const slow = async () => ({ status: 124, stdout: '', stderr: 'killed', timedOut: true })
  const w = createAgentBridgeWorker({ runner: slow })
  const r = await w.invoke('AgentBridge', 1, { workOrder: validWO(), workspace: fakeWorkspace(), cloneDir: '/tmp/x', branch: 'agent/appr_1' })
  assert.equal(r.ok, false)
  assert.ok(r.output.risks.includes('timeout'))
})
test('worker: invalid work order → refuse, runner NEVER called (fail-closed)', async () => {
  let called = 0
  const spy = async () => { called++; return okClaude() }
  const w = createAgentBridgeWorker({ runner: spy })
  const r = await w.invoke('AgentBridge', 1, { workOrder: { goal: '' }, workspace: fakeWorkspace(), cloneDir: '/tmp/x' })
  assert.equal(r.ok, false)
  assert.ok(r.output.risks.includes('invalid_work_order'))
  assert.equal(called, 0)
})
test('worker: bypassPermissions provider → refuse, runner NEVER called', async () => {
  let called = 0
  const spy = async () => { called++; return okClaude() }
  const w = createAgentBridgeWorker({ runner: spy })
  const ws = fakeWorkspace({ permissionMode: () => 'bypassPermissions' })
  const r = await w.invoke('AgentBridge', 1, { workOrder: validWO(), workspace: ws, cloneDir: '/tmp/x', branch: 'agent/appr_1' })
  assert.equal(r.ok, false)
  assert.ok(r.output.risks.includes('bypass_forbidden'))
  assert.equal(called, 0)
})

/* ───────────────────────── audit (Cap 7) ─────────────────────────────────── */
test('audit: appends one immutable record per run', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-audit-test-'))
  const store = createArtifactStore({ baseDir: dir })
  const log = createAuditLog({ artifactStore: store, clock: () => '2026-01-01T00:00:00.000Z', newId: () => 'audit_1' })
  const rec = log.append({ approvalId: 'appr_1', workOrderHash: 'abc', who: 'louie', result: { ok: true, cost: 0.01, output: { exit: 0, branch: 'agent/appr_1', filesChanged: ['src/foo.js'], risks: [] } } })
  assert.equal(rec.approvalId, 'appr_1')
  assert.equal(log.list().length, 1)
  assert.equal(log.list()[0].workOrderHash, 'abc')
  fs.rmSync(dir, { recursive: true, force: true })
})

/* ─────────── full chain: validate → workspace → worker → result → view ─────── */
test('full chain (injected): enriched result returns; sandbox/prompt NEVER projected', async () => {
  const wo = validWO()
  assert.equal(WO.validateWorkOrder(wo).ok, true)
  const ws = createFeatureBranchWorkspace({ repoRoot: process.cwd(), gitRunner: makeFakeGit({ changed: ['src/foo.js'] }) })
  const prep = ws.prepare('appr_1')
  const agent = createAgentBridgeWorker({ runner: okClaude })
  const agentResult = await agent.invoke('AgentBridge', 1, { workOrder: wo, workspace: ws, cloneDir: prep.dir, branch: prep.branch })
  assert.equal(agentResult.ok, true)

  // Reuse the existing artifact glue; the enrichment passes agent output through.
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-chain-test-'))
  const store = createArtifactStore({ baseDir })
  const wrapWorker = { invoke: async () => agentResult, health: () => ({ availability: 'up', latencyMs: 0 }) }
  const runner = createWorkerRunner({
    worker: wrapWorker, artifactStore: store,
    workspace: { prepare: () => ({ dir: prep.dir }) },
    clock: () => '2026-01-01T00:00:00.000Z', newId: (p) => `${p}_1`
  })
  await runner.run({ proposalId: 'prop_1', runId: 'run_1', task: 'add helper', approval: { confirmedBy: 'louie', confirmedAt: '2026-01-01T00:00:00.000Z' } })

  const { execution } = findExecutionByProposalId(store, 'prop_1')
  const { result } = findResultByTaskId(store, execution.id)
  const view = buildResultView({ proposalId: 'prop_1', execution, result, proposal: null })

  assert.equal(view.branch, 'agent/appr_1')
  assert.deepEqual(view.filesChanged, ['src/foo.js'])
  assert.equal(typeof view.diffSummary, 'string')
  assert.deepEqual(view.risks, [])
  assert.equal(view.status, 'succeeded')
  // allowlist discipline: the view must never expose sandbox path or the prompt/task
  const keys = Object.keys(view)
  assert.ok(!keys.includes('sandbox'))
  assert.ok(!keys.includes('task'))
  assert.ok(!JSON.stringify(view).includes(prep.dir)) // sandbox path never leaks
  fs.rmSync(prep.dir, { recursive: true, force: true })
  fs.rmSync(baseDir, { recursive: true, force: true })
})
