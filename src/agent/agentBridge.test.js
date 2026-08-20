'use strict'

// The worker no longer falls back to a bare 'claude' — an unresolvable CLI is a refusal.
// These tests inject a fake runner, so they name a fake absolute path explicitly.
const FAKE_CLI = 'C:/fake/claude.exe'

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
    // The four ORIGINAL fields. A fifth (computerOperatorAuthorized) was added when
    // COMPUTER_OPERATOR joined the gate; agentAuthorization.test.js proves these four
    // are byte-identical to the three-flag implementation for every combination.
    assert.deepEqual(
      { status: r.status, workerAuthorized: r.workerAuthorized, developAuthorized: r.developAuthorized, agentBridgeAuthorized: r.agentBridgeAuthorized },
      { status: 'configuration_conflict', workerAuthorized: false, developAuthorized: false, agentBridgeAuthorized: false })
    assert.equal(r.computerOperatorAuthorized, false, 'the fourth lane is refused by the same conflict')
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
  const w = createAgentBridgeWorker({ command: FAKE_CLI, runner: okClaude })
  const args = w.buildArgs(validWO(), '/tmp/aroma-sandbox-agent-x', 'acceptEdits')
  assert.ok(!args.includes('bypassPermissions'))
  assert.ok(args.includes('--permission-mode') && args.includes('acceptEdits'))
  const tools = args[args.indexOf('--allowedTools') + 1]
  assert.equal(tools, 'Read Edit Write')
  assert.ok(!/Bash|git|push/i.test(tools))
})
test('worker: happy path → ok, enriched output, zero risks', async () => {
  const w = createAgentBridgeWorker({ command: FAKE_CLI, runner: okClaude })
  const r = await w.invoke('AgentBridge', 1, { workOrder: validWO(), workspace: fakeWorkspace(), cloneDir: '/tmp/aroma-sandbox-agent-x', branch: 'agent/appr_1' })
  assert.equal(r.ok, true)
  assert.equal(r.output.branch, 'agent/appr_1')
  assert.deepEqual(r.output.filesChanged, ['src/foo.js'])
  assert.deepEqual(r.output.risks, [])
  assert.equal(r.cost, 0.01)
})
test('worker: file changed outside allowlist → ok:false + risk', async () => {
  const w = createAgentBridgeWorker({ command: FAKE_CLI, runner: okClaude })
  const ws = fakeWorkspace({ filesChanged: () => ['src/foo.js', 'src/secret.js'] })
  const r = await w.invoke('AgentBridge', 1, { workOrder: validWO(), workspace: ws, cloneDir: '/tmp/aroma-sandbox-agent-x', branch: 'agent/appr_1' })
  assert.equal(r.ok, false)
  assert.ok(r.output.risks.includes('files_outside_allowlist'))
})
test('worker: a surviving remote → ok:false + risk (no push target check)', async () => {
  const w = createAgentBridgeWorker({ command: FAKE_CLI, runner: okClaude })
  const ws = fakeWorkspace({ remotes: () => ['origin'] })
  const r = await w.invoke('AgentBridge', 1, { workOrder: validWO(), workspace: ws, cloneDir: '/tmp/x', branch: 'agent/appr_1' })
  assert.equal(r.ok, false)
  assert.ok(r.output.risks.includes('remote_present'))
})
test('worker: cost over cap → ok:false + risk', async () => {
  const dear = async () => ({ status: 0, stdout: JSON.stringify({ subtype: 'success', is_error: false, result: 'x', total_cost_usd: 5 }), stderr: '', timedOut: false })
  const w = createAgentBridgeWorker({ command: FAKE_CLI, runner: dear })
  const r = await w.invoke('AgentBridge', 1, { workOrder: validWO(), workspace: fakeWorkspace(), cloneDir: '/tmp/x', branch: 'agent/appr_1' })
  assert.equal(r.ok, false)
  assert.ok(r.output.risks.includes('cost_cap_exceeded'))
})
test('worker: timeout kill → ok:false + risk', async () => {
  const slow = async () => ({ status: 124, stdout: '', stderr: 'killed', timedOut: true })
  const w = createAgentBridgeWorker({ command: FAKE_CLI, runner: slow })
  const r = await w.invoke('AgentBridge', 1, { workOrder: validWO(), workspace: fakeWorkspace(), cloneDir: '/tmp/x', branch: 'agent/appr_1' })
  assert.equal(r.ok, false)
  assert.ok(r.output.risks.includes('timeout'))
})
test('worker: invalid work order → refuse, runner NEVER called (fail-closed)', async () => {
  let called = 0
  const spy = async () => { called++; return okClaude() }
  const w = createAgentBridgeWorker({ command: FAKE_CLI, runner: spy })
  const r = await w.invoke('AgentBridge', 1, { workOrder: { goal: '' }, workspace: fakeWorkspace(), cloneDir: '/tmp/x' })
  assert.equal(r.ok, false)
  assert.ok(r.output.risks.includes('invalid_work_order'))
  assert.equal(called, 0)
})
test('worker: bypassPermissions provider → refuse, runner NEVER called', async () => {
  let called = 0
  const spy = async () => { called++; return okClaude() }
  const w = createAgentBridgeWorker({ command: FAKE_CLI, runner: spy })
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
  const agent = createAgentBridgeWorker({ command: FAKE_CLI, runner: okClaude })
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

/* ═══ P1-C1c DELIVERY TRUTH ═══════════════════════════════════════════════
 *
 * ⛔ THE MEASURED DEFECT. The first real canary approved 「add a line after the first
 * line of docs/HOUSE-RULES.md」. The executor ran 42s, cost US$0.24, returned exit 0 /
 * subtype success, changed NOTHING — and the whole chain recorded SUCCEEDED. Forensics
 * proved two separate faults:
 *
 *   ROOT CAUSE  — `-p` carried only `workOrder.goal`, and goal is the Owner's sentence
 *                 with the FILENAME STRIPPED (intentFrom removes it for the card). The
 *                 agent was never told which file. It did not ignore an instruction;
 *                 it never received one.
 *   AMPLIFIER   — ok = claudeOk && risks.length === 0, and zero changed files added no
 *                 risk. So "the CLI finished" was allowed to mean "the change exists".
 *
 * Both are pinned below, and both are pinned SEPARATELY: fixing the prompt without
 * fixing the success rule would leave a silent no-op still reading as success.
 */

const briefOf = (w, wo) => { const a = w.buildArgs(wo, '/tmp/aroma-sandbox-agent-x', 'acceptEdits'); return a[a.indexOf('-p') + 1] }
const mutatingWO = (over = {}) => Object.assign(validWO(), { intendedChange: 'add helper' }, over)

/* ── FIX A: the executor is told what the Owner approved ─────────────────── */

test('*** the brief still carries the Owner goal ***', () => {
  const w = createAgentBridgeWorker({ command: FAKE_CLI, runner: okClaude })
  assert.ok(briefOf(w, validWO()).includes('add a small helper'))
})

test('*** ⛔ THE BRIEF NAMES THE APPROVED TARGET FILE ***', () => {
  // The single fact whose absence produced a 42-second, US$0.24 no-op.
  const w = createAgentBridgeWorker({ command: FAKE_CLI, runner: okClaude })
  assert.ok(briefOf(w, validWO()).includes('src/foo.js'), '⛔ the executor is again not told which file')
})

test('*** the brief carries intendedChange when the Owner approved one ***', () => {
  const w = createAgentBridgeWorker({ command: FAKE_CLI, runner: okClaude })
  assert.ok(briefOf(w, mutatingWO()).includes('add helper'))
})

test('*** ⛔ currentExcerpt IS NOT INJECTED INTO THE PROMPT ***', () => {
  // The agent can Read the clone. A second, truncated copy of the file in the prompt
  // is a source of truth that can disagree with the file being edited.
  const w = createAgentBridgeWorker({ command: FAKE_CLI, runner: okClaude })
  const wo = Object.assign(mutatingWO(), { currentExcerpt: 'LINE_FROM_EXCERPT_SHOULD_NOT_APPEAR' })
  assert.equal(briefOf(w, wo).includes('LINE_FROM_EXCERPT_SHOULD_NOT_APPEAR'), false)
})

test('*** the brief is DETERMINISTIC — same Work Order, same bytes ***', () => {
  const w = createAgentBridgeWorker({ command: FAKE_CLI, runner: okClaude })
  const wo = mutatingWO()
  assert.equal(briefOf(w, wo), briefOf(w, wo), 'no clock, no random, no machine path')
})

test('*** ⛔ THE SANDBOX PATH STAYS OUT OF THE SEMANTIC BRIEF ***', () => {
  const w = createAgentBridgeWorker({ command: FAKE_CLI, runner: okClaude })
  const args = w.buildArgs(mutatingWO(), '/tmp/aroma-sandbox-agent-SECRETPATH', 'acceptEdits')
  const brief = args[args.indexOf('-p') + 1]
  assert.equal(brief.includes('SECRETPATH'), false, 'the clone is an execution argument, not approved content')
  assert.equal(args[args.indexOf('--add-dir') + 1], '/tmp/aroma-sandbox-agent-SECRETPATH', 'and it is still passed as --add-dir')
})

test('*** the execution arguments and tool allowlist are UNCHANGED ***', () => {
  const w = createAgentBridgeWorker({ command: FAKE_CLI, runner: okClaude })
  const args = w.buildArgs(mutatingWO(), '/tmp/clone', 'acceptEdits')
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'acceptEdits')
  assert.equal(args[args.indexOf('--allowedTools') + 1], 'Read Edit Write')
  assert.equal(args[args.indexOf('--output-format') + 1], 'json')
  assert.equal(args.includes('--dangerously-skip-permissions'), false)
  for (const banned of ['Bash', 'git', 'WebFetch', 'WebSearch', 'Task']) {
    assert.equal(args[args.indexOf('--allowedTools') + 1].includes(banned), false, '⛔ tool widened: ' + banned)
  }
})

/* ── the forensic canary, as a deterministic fixture ─────────────────────── */

test('*** ⛔ THE CANARY FIXTURE NOW REACHES THE EXECUTOR COMPLETE ***', () => {
  const w = createAgentBridgeWorker({ command: FAKE_CLI, runner: okClaude })
  const canary = {
    goal: '第一行之後加一行： <!-- P1-C1c live canary — verification artefact only -->',
    allowedFiles: ['docs/HOUSE-RULES.md'],
    allowedTestCommand: null,
    forbiddenActions: ['commit', 'push', 'PR', 'merge', 'deploy'],
    timeoutSec: 120,
    costCapUsd: 0.5,
    approvalId: 'appr_f0df6d8d',
    intendedChange: '在第一行之後加入一行 HTML 註解：<!-- P1-C1c live canary — verification artefact only -->'
  }
  const brief = briefOf(w, canary)
  assert.ok(brief.includes('docs/HOUSE-RULES.md'), '⛔ the exact fault that produced the no-op is back')
  assert.ok(brief.includes('<!-- P1-C1c live canary — verification artefact only -->'))
})

/* ── FIX B: an approved mutation that changed nothing is not a success ───── */

test('*** ⛔ EXPLICIT intendedChange + ZERO DIFF -> ok:false, no_delivery_change ***', async () => {
  const w = createAgentBridgeWorker({ command: FAKE_CLI, runner: okClaude })
  const ws = fakeWorkspace({ filesChanged: () => [], diffStat: () => '' })
  const r = await w.invoke('AgentBridge', 1, { workOrder: mutatingWO(), workspace: ws, cloneDir: '/tmp/aroma-sandbox-agent-x', branch: 'agent/appr_1' })
  assert.equal(r.ok, false, '⛔ a no-op was reported as success again')
  assert.ok(r.output.risks.includes('no_delivery_change'))
  assert.equal(r.output.filesChanged.length, 0)
})

test('*** an approved mutation that DID change the allowed file still succeeds ***', async () => {
  const w = createAgentBridgeWorker({ command: FAKE_CLI, runner: okClaude })
  const r = await w.invoke('AgentBridge', 1, { workOrder: mutatingWO(), workspace: fakeWorkspace(), cloneDir: '/tmp/aroma-sandbox-agent-x', branch: 'agent/appr_1' })
  assert.equal(r.ok, true)
  assert.equal(r.output.risks.includes('no_delivery_change'), false)
  assert.deepEqual(r.output.filesChanged, ['src/foo.js'])
})

test('*** ⛔ CLAUDE SAYING "done" DOES NOT OUTRANK THE FILESYSTEM ***', async () => {
  // The canary's CLI returned subtype success with prose. Prose is not delivery.
  const saysDone = async () => ({ status: 0, stdout: JSON.stringify({ subtype: 'success', is_error: false, result: 'Done — I added the line as requested.', total_cost_usd: 0.24 }), stderr: '', timedOut: false })
  const w = createAgentBridgeWorker({ command: FAKE_CLI, runner: saysDone })
  const ws = fakeWorkspace({ filesChanged: () => [], diffStat: () => '' })
  const r = await w.invoke('AgentBridge', 1, { workOrder: mutatingWO(), workspace: ws, cloneDir: '/tmp/aroma-sandbox-agent-x', branch: 'agent/appr_1' })
  assert.equal(r.ok, false, '⛔ the runner believed the narration over the diff')
  assert.ok(r.output.risks.includes('no_delivery_change'))
})

test('*** BACKWARD COMPATIBLE: no intendedChange + zero diff keeps the old behaviour ***', async () => {
  // Not every machine Work Order is a mutation request, and this tranche does not
  // redefine them. Only an Owner-stated intendedChange arms the rule.
  const w = createAgentBridgeWorker({ command: FAKE_CLI, runner: okClaude })
  const ws = fakeWorkspace({ filesChanged: () => [], diffStat: () => '' })
  const wo = validWO()
  assert.equal('intendedChange' in wo, false, 'the fixture genuinely has none')
  const r = await w.invoke('AgentBridge', 1, { workOrder: wo, workspace: ws, cloneDir: '/tmp/aroma-sandbox-agent-x', branch: 'agent/appr_1' })
  assert.equal(r.output.risks.includes('no_delivery_change'), false)
  assert.equal(r.ok, true, 'pre-fix semantics preserved for a non-mutating order')
})

test('*** an empty/blank intendedChange does NOT arm the rule ***', async () => {
  const w = createAgentBridgeWorker({ command: FAKE_CLI, runner: okClaude })
  const ws = fakeWorkspace({ filesChanged: () => [], diffStat: () => '' })
  for (const blank of ['', '   ', null, undefined]) {
    const r = await w.invoke('AgentBridge', 1, { workOrder: mutatingWO({ intendedChange: blank }), workspace: ws, cloneDir: '/tmp/x', branch: 'agent/appr_1' })
    assert.equal(r.output.risks.includes('no_delivery_change'), false, JSON.stringify(blank))
  }
})

test('*** the existing structural protections are UNCHANGED ***', async () => {
  const w = createAgentBridgeWorker({ command: FAKE_CLI, runner: okClaude })
  // outside-allowlist still fails, and does so on its own reason
  const outside = await w.invoke('AgentBridge', 1, {
    workOrder: mutatingWO(),
    workspace: fakeWorkspace({ filesChanged: () => ['src/foo.js', 'src/secret.js'] }),
    cloneDir: '/tmp/x',
    branch: 'agent/appr_1'
  })
  assert.equal(outside.ok, false)
  assert.ok(outside.output.risks.includes('files_outside_allowlist'))
  assert.equal(outside.output.risks.includes('no_delivery_change'), false, 'a real diff is not an empty delivery')

  // remotes / branch protections still bite
  const remote = await w.invoke('AgentBridge', 1, { workOrder: mutatingWO(), workspace: fakeWorkspace({ remotes: () => ['origin'] }), cloneDir: '/tmp/x', branch: 'agent/appr_1' })
  assert.equal(remote.ok, false)
  assert.ok(remote.output.risks.includes('remote_present'))

  const onMain = await w.invoke('AgentBridge', 1, { workOrder: mutatingWO(), workspace: fakeWorkspace({ currentBranch: () => 'main' }), cloneDir: '/tmp/x', branch: 'agent/appr_1' })
  assert.equal(onMain.ok, false)
  assert.ok(onMain.output.risks.includes('branch_violation'))
})

test('*** the new risk enum is short and content-free ***', async () => {
  const w = createAgentBridgeWorker({ command: FAKE_CLI, runner: okClaude })
  const ws = fakeWorkspace({ filesChanged: () => [], diffStat: () => '' })
  const r = await w.invoke('AgentBridge', 1, { workOrder: mutatingWO({ intendedChange: 'rewrite the secret handling in src/foo.js' }), workspace: ws, cloneDir: '/tmp/x', branch: 'agent/appr_1' })
  assert.deepEqual(r.output.risks, ['no_delivery_change'], 'the risk is an enum, never a copy of Owner text')
  assert.equal(JSON.stringify(r.output.risks).includes('secret handling'), false)
})
