'use strict'

/**
 * executionTruth.test.js — P1-C1c. One Owner execution decision → one Run → one
 * canonical lifecycle → one terminal truth.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE TWO-LEDGER FAULT. Confirming an approval created a durable Run and then handed
 * the sealed order to the runner without ever touching that Run again. The Run stayed at
 * TASK_CREATED forever while the only record of the execution lived in a memory Map that
 * a restart emptied. The Owner had two ledgers and no way to tell which one was true.
 *
 * ⛔ ORDER IS THE CONTRACT, not an implementation detail. The claim must be durable
 * BEFORE the runner is called, and AGENT_FINISHED must be durable BEFORE the terminal —
 * otherwise the crash windows this tranche exists to close are still open.
 *
 * Deterministic: real Run store on a temp file, real Proposal store, INJECTED runner and
 * worker. ZERO real spawn, ZERO CLI, ZERO paid call, ZERO network.
 *
 *   Run: node --test src/agent/executionTruth.test.js
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createRunStore, AGENT_EXECUTOR } = require('../run/store')
const { createProposalStore } = require('../coo/proposal')
const { createConfirmService } = require('./confirmService')
const { createAgentRunner } = require('./agentRunner')
const { hashWorkOrder, canonicalWorkOrder } = require('./workOrder')
const { deriveStatus } = require('../run/run')

function tmpFile () { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-xtruth-')); return path.join(d, 'aroma-runs.json') }
const developLlm = async () => ({ intent: 'develop', task: 'do a thing', targetProject: 'backend' })
const WO = (over = {}) => Object.assign({
  goal: 'tidy one helper',
  projectId: 'aroma-agent-backend',
  repoFullName: 'Louielui/aroma-agent-backend',
  expectedSha: 'd05527e49d2092fdf82e74efe4d96f203fcd80e9',
  allowedFiles: ['src/foo.js'],
  allowedTestCommand: null,
  forbiddenActions: ['commit', 'push', 'PR', 'merge', 'deploy'],
  timeoutSec: 60,
  costCapUsd: 1,
  approvalId: 'appr_truth1'
}, over)

/** Agent-only authorization — the live production shape: develop off, worker off. */
const AGENT_ONLY = () => ({ status: 'authorized', agentBridgeAuthorized: true, developAuthorized: false, workerAuthorized: false })

/** Let the runner's promise chain settle. */
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve)) }

async function harness (opts = {}) {
  const runStore = createRunStore({
    dispatcher: async () => {},
    authorizeDispatch: () => false,
    persistence: opts.persistence || tmpFile(),
    resultEvidence: opts.resultEvidence
  })
  const proposalStore = createProposalStore({ runStore, persistence: false })
  const { proposal } = await proposalStore.propose({ conversationId: 'c1', message: 'build', llm: developLlm })

  const runnerCalls = []
  const agentRunner = opts.agentRunner || {
    run: async (input) => {
      runnerCalls.push(input)
      if (opts.throws) throw new Error('boom')
      return opts.result === undefined ? { ok: true, output: { branch: 'agent/x' } } : opts.result
    }
  }
  const audits = []
  const svc = createConfirmService({
    proposalStore,
    authorize: opts.authorize || AGENT_ONLY,
    agentRunner,
    owner: 'louie',
    auditFn: (e) => audits.push(e),
    claimAgent: opts.claimAgent || ((id, f) => runStore.claimAgent(id, f)),
    appendAgentStage: (id, s, f) => runStore.appendAgentStage(id, s, f)
  })
  return { runStore, proposalStore, svc, proposalId: proposal.id, runnerCalls, audits }
}

const stagesOf = (runStore, runId) => runStore.getRun(runId).timeline.map((e) => e.stage)

/* ═══ one decision, one Run ════════════════════════════════════════════════ */

test('*** ⛔ ONE APPROVAL CREATES EXACTLY ONE RUN — never one per lane ***', async () => {
  const h = await harness()
  const out = h.svc.confirmProposalAction({ proposalId: h.proposalId, agentExecute: true, workOrder: WO(), approvedHash: hashWorkOrder(WO()), entryPoint: 'test' })
  await settle()
  assert.equal(h.runStore.listRuns().length, 1, 'the Agent lane attaches to the Run, it does not open a second one')
  assert.ok(out.body.runId)
})

test('*** the Run carries approvalId from CREATION, before the claim ***', async () => {
  const h = await harness({ agentRunner: { run: async () => ({ ok: true, output: {} }) } })
  const out = h.svc.confirmProposalAction({ proposalId: h.proposalId, agentExecute: true, workOrder: WO({ approvalId: 'appr_link' }), approvedHash: 'h', entryPoint: 'test' })
  const r = h.runStore.getRun(out.body.runId)
  assert.equal(r.approvalId, 'appr_link')
  assert.equal(h.runStore.findByApprovalId('appr_link').run.id, out.body.runId)
})

test('*** a NON-agent confirm still works and its Run has approvalId null ***', async () => {
  const h = await harness()
  const out = h.svc.confirmProposalAction({ proposalId: h.proposalId, entryPoint: 'test' })
  assert.equal(out.body.proposalStatus, 'confirmed')
  assert.equal(h.runStore.getRun(out.body.runId).approvalId, null)
  assert.equal(h.runnerCalls.length, 0, 'an ordinary confirm cannot start the agent')
})

/* ═══ the claim precedes the runner ════════════════════════════════════════ */

test('*** ⛔ AGENT_CLAIMED IS DURABLE BEFORE agentRunner.run IS CALLED ***', async () => {
  const seen = []
  const h = await harness({
    agentRunner: {
      run: async (input) => {
        // Observed from INSIDE the runner: by now the claim must already be on the Run.
        seen.push(stagesOf(h.runStore, input.runId))
        return { ok: true, output: {} }
      }
    }
  })
  h.svc.confirmProposalAction({ proposalId: h.proposalId, agentExecute: true, workOrder: WO(), approvedHash: 'h', entryPoint: 'test' })
  await settle()
  assert.equal(seen.length, 1)
  assert.ok(seen[0].includes('AGENT_CLAIMED'), '⛔ the runner was called before the claim was durable')
  assert.ok(seen[0].includes('AGENT_SELECTED'))
})

test('*** the runner is told which Run it belongs to ***', async () => {
  const h = await harness()
  const out = h.svc.confirmProposalAction({ proposalId: h.proposalId, agentExecute: true, workOrder: WO(), approvedHash: 'h', entryPoint: 'test' })
  await settle()
  assert.equal(h.runnerCalls[0].runId, out.body.runId)
})

test('*** ⛔ CLAIM FLUSH FAILURE → agentRunner.run IS NEVER CALLED ***', async () => {
  const h = await harness({ claimAgent: () => ({ status: 'dispatch_claim_failed' }) })
  const out = h.svc.confirmProposalAction({ proposalId: h.proposalId, agentExecute: true, workOrder: WO(), approvedHash: 'h', entryPoint: 'test' })
  await settle()
  assert.equal(h.runnerCalls.length, 0, '⛔ an execution that could not be recorded must not happen')
  assert.equal(out.agentHandedOff, false)
  assert.equal(out.body.dispatchStatus, 'agent_execute_claim_failed')
})

test('*** a SECOND attempt on the same Run is refused in BOTH windows ***', async () => {
  const wo = WO()

  // (a) MID-FLIGHT — the runner has been called and has not returned. The claim is the
  //     only thing standing between one execution and two, and it holds.
  let release
  let calls = 0
  const midFlight = await harness({ agentRunner: { run: () => { calls++; return new Promise((resolve) => { release = () => resolve({ ok: true, output: {} }) }) } } })
  const inFlight = midFlight.svc.confirmProposalAction({ proposalId: midFlight.proposalId, agentExecute: true, workOrder: wo, approvedHash: 'h', entryPoint: 'test' })
  await settle()
  assert.equal(calls, 1)
  assert.equal(midFlight.runStore.claimAgent(inFlight.body.runId, { approvalId: wo.approvalId, workOrderHash: 'h' }).status,
    'already_dispatched', 'a claim already obtained — not a liveness assertion, exactly as its twins')
  release(); await settle()

  // (b) AFTER IT SETTLED — the Run is terminal, so the refusal is the stronger one.
  assert.equal(midFlight.runStore.claimAgent(inFlight.body.runId, { approvalId: wo.approvalId, workOrderHash: 'h' }).status,
    'already_completed')
  assert.equal(calls, 1, 'still exactly one execution')
})

test('*** a Run another lane already claimed → needs_review, runner 0 calls ***', async () => {
  for (const foreign of ['claimDispatch', 'claimWorker']) {
    const h = await harness({
      claimAgent: (id, f) => {
        // Simulate drift: the other lane got there first.
        if (foreign === 'claimDispatch') h.runStore.claimDispatch(id); else h.runStore.claimWorker(id)
        return h.runStore.claimAgent(id, f)
      }
    })
    const out = h.svc.confirmProposalAction({ proposalId: h.proposalId, agentExecute: true, workOrder: WO(), approvedHash: 'h', entryPoint: 'test' })
    await settle()
    assert.equal(h.runnerCalls.length, 0, foreign + ': no second lane may run')
    assert.equal(out.body.dispatchStatus, 'agent_execute_needs_review')
  }
})

test('*** ⛔ A REFUSED CLAIM IS NEVER REPORTED AS agent_execute_accepted ***', async () => {
  const map = {
    already_dispatched: 'agent_execute_already_claimed',
    already_completed: 'agent_execute_already_completed',
    needs_review: 'agent_execute_needs_review',
    dispatch_claim_failed: 'agent_execute_claim_failed'
  }
  for (const [claimStatus, expected] of Object.entries(map)) {
    const h = await harness({ claimAgent: () => ({ status: claimStatus }) })
    const out = h.svc.confirmProposalAction({ proposalId: h.proposalId, agentExecute: true, workOrder: WO(), approvedHash: 'h', entryPoint: 'test' })
    assert.equal(out.body.dispatchStatus, expected)
    assert.notEqual(out.body.dispatchStatus, 'agent_execute_accepted')
    assert.equal(out.agentHandedOff, false)
    assert.equal(h.runnerCalls.length, 0)
  }
})

test('*** a refused claim does NOT fall back to Develop or the Worker ***', async () => {
  const h = await harness({ claimAgent: () => ({ status: 'needs_review' }) })
  const out = h.svc.confirmProposalAction({ proposalId: h.proposalId, agentExecute: true, workOrder: WO(), approvedHash: 'h', entryPoint: 'test' })
  const t = stagesOf(h.runStore, out.body.runId)
  assert.equal(t.includes('DISPATCH_CLAIMED'), false)
  assert.equal(t.includes('WORKER_CLAIMED'), false)
})

/* ═══ the canonical terminals ══════════════════════════════════════════════ */

test('*** live SUCCESS timeline: CLAIMED → SELECTED → FINISHED(ok) → SUCCEEDED ***', async () => {
  const h = await harness({ result: { ok: true, output: { branch: 'agent/x' } } })
  const out = h.svc.confirmProposalAction({ proposalId: h.proposalId, agentExecute: true, workOrder: WO(), approvedHash: 'h', entryPoint: 'test' })
  await settle()
  const t = stagesOf(h.runStore, out.body.runId)
  assert.deepEqual(t, ['TASK_CREATED', 'AGENT_CLAIMED', 'AGENT_SELECTED', 'AGENT_FINISHED', 'SUCCEEDED'])
  assert.equal(deriveStatus(h.runStore.getRun(out.body.runId)), 'succeeded')
})

test('*** live FAILURE timeline ends AGENT_FINISHED(ok:false) → FAILED ***', async () => {
  const h = await harness({ result: { ok: false, error: 'refuse: out of scope', output: {} } })
  const out = h.svc.confirmProposalAction({ proposalId: h.proposalId, agentExecute: true, workOrder: WO(), approvedHash: 'h', entryPoint: 'test' })
  await settle()
  const r = h.runStore.getRun(out.body.runId)
  assert.deepEqual(r.timeline.map((e) => e.stage), ['TASK_CREATED', 'AGENT_CLAIMED', 'AGENT_SELECTED', 'AGENT_FINISHED', 'FAILED'])
  assert.equal(r.timeline.find((e) => e.stage === 'AGENT_FINISHED').facts.ok, false)
  assert.equal(deriveStatus(r), 'failed')
})

test('*** a runner that THROWS still settles the Run — never left dangling ***', async () => {
  const h = await harness({ throws: true })
  const out = h.svc.confirmProposalAction({ proposalId: h.proposalId, agentExecute: true, workOrder: WO(), approvedHash: 'h', entryPoint: 'test' })
  await settle()
  const r = h.runStore.getRun(out.body.runId)
  assert.equal(deriveStatus(r), 'failed')
  assert.equal(r.timeline.find((e) => e.stage === 'FAILED').facts.error, 'runner_error')
})

test('*** ⛔ AGENT_FINISHED IS DURABLE BEFORE THE TERMINAL — the crash bridge ***', async () => {
  // Order proven from the timeline itself: if the terminal were appended first, or in the
  // same write, a process dying between them would leave nothing to recover from.
  const h = await harness({ result: { ok: true, output: {} } })
  const out = h.svc.confirmProposalAction({ proposalId: h.proposalId, agentExecute: true, workOrder: WO(), approvedHash: 'h', entryPoint: 'test' })
  await settle()
  const t = stagesOf(h.runStore, out.body.runId)
  assert.ok(t.indexOf('AGENT_FINISHED') < t.indexOf('SUCCEEDED'), '⛔ the outcome must be recorded before it is declared terminal')
  assert.ok(t.indexOf('AGENT_FINISHED') >= 0)
})

test('*** ⛔ AGENT SUCCESS USES SUCCEEDED, NEVER COMPLETED ***', async () => {
  const h = await harness({ result: { ok: true, output: { branch: 'agent/x' } } })
  const out = h.svc.confirmProposalAction({ proposalId: h.proposalId, agentExecute: true, workOrder: WO(), approvedHash: 'h', entryPoint: 'test' })
  await settle()
  const t = stagesOf(h.runStore, out.body.runId)
  assert.equal(t.includes('COMPLETED'), false,
    '⛔ COMPLETED means "applied, with a backup to roll back to" — this lane makes no backup')
  assert.ok(t.includes('SUCCEEDED'))
})

test('*** and COMPLETED still demands its backupRef — unchanged by this tranche ***', () => {
  const { createRun, appendStage } = require('../run/run')
  const r = createRun({ owner: 'louie' })
  assert.throws(() => appendStage(r.id, 'COMPLETED', {}), /backupRef/)
  assert.throws(() => appendStage(r.id, 'COMPLETED', { executor: AGENT_EXECUTOR }), /backupRef/,
    '⛔ an agent-shaped fact bag must not satisfy COMPLETED')
})

test('*** the success terminal names its executor and its approval ***', async () => {
  const h = await harness({ result: { ok: true, output: {} } })
  const out = h.svc.confirmProposalAction({ proposalId: h.proposalId, agentExecute: true, workOrder: WO({ approvalId: 'appr_named' }), approvedHash: 'h', entryPoint: 'test' })
  await settle()
  const term = h.runStore.getRun(out.body.runId).timeline.find((e) => e.stage === 'SUCCEEDED')
  assert.equal(term.facts.executor, AGENT_EXECUTOR)
  assert.equal(term.facts.approvalId, 'appr_named')
})

test('*** canonical truth does not depend on ownerApprovalStore existing at all ***', async () => {
  // No recordResult / recordExecutionStart injected anywhere in this file. The Run still
  // reaches a terminal, which is the entire point of the tranche.
  const h = await harness({ result: { ok: true, output: {} } })
  const out = h.svc.confirmProposalAction({ proposalId: h.proposalId, agentExecute: true, workOrder: WO(), approvedHash: 'h', entryPoint: 'test' })
  await settle()
  assert.equal(deriveStatus(h.runStore.getRun(out.body.runId)), 'succeeded')
})

/* ═══ the runner's own phase truth + audit link ════════════════════════════ */

const runnerHarness = (over = {}) => {
  const phases = []
  const audits = []
  const runner = createAgentRunner({ projectId: 'aroma-agent-backend', repoFullName: 'Louielui/aroma-agent-backend', command: 'C:/fake/claude.exe',
    workspace: over.workspace || { prepare: () => ({ dir: 'C:/tmp/clone', branch: 'agent/x' }), cleanup: () => {} },
    worker: over.worker || { invoke: async () => ({ ok: true, output: { filesChanged: [], exit: 0 } }) },
    // ⛔ AN ARTIFACT STORE, NOT AN auditLog. Injecting the log itself would skip
    //    audit.js entirely and these tests would be asserting on the arguments the
    //    runner passes — not on the RECORD that actually reaches disk, which is the
    //    thing recovery has to match on.
    artifactStore: { write: (kind, record) => { audits.push(Object.assign({ kind }, record)); return record }, list: () => [] },
    checkCredentials: over.checkCredentials || (() => ({ canRun: true, state: 'ok', refreshExpiresAt: null, daysLeft: 9, accessTokenValid: true, subscription: null })),
    writePatch: () => ({ ok: true, path: 'C:/tmp/p.patch', bytes: 3 }),
    onPhase: (approvalId, phase, runId) => phases.push({ approvalId, phase, runId })
  })
  return { runner, phases, audits }
}

test('*** the runner emits `running` ONLY when the worker is actually invoked ***', async () => {
  const { runner, phases } = runnerHarness()
  const wo = WO()
  await runner.run({ runId: 'run_p1', workOrder: wo, approvedHash: hashWorkOrder(wo), who: 'louie' })
  const names = phases.map((p) => p.phase)
  assert.deepEqual(names, ['preparing', 'running', 'verifying', 'done'])
  assert.equal(phases.filter((p) => p.phase === 'running').length, 1, 'exactly once per attempt')
  assert.ok(phases.every((p) => p.runId === 'run_p1'), 'every phase names its Run')
})

test('*** ⛔ A CREDENTIAL REFUSAL NEVER EMITS `running` — nothing was spawned ***', async () => {
  const { runner, phases } = runnerHarness({
    checkCredentials: () => ({ canRun: false, refusal: 'login expired', state: 'expired', refreshExpiresAt: null, daysLeft: 0, accessTokenValid: false, subscription: null })
  })
  const wo = WO()
  const result = await runner.run({ runId: 'run_p2', workOrder: wo, approvedHash: hashWorkOrder(wo), who: 'louie' })
  assert.equal(result.ok, false)
  const names = phases.map((p) => p.phase)
  assert.equal(names.includes('running'), false, '⛔ "the agent ran" would be written about an attempt that never started')
  assert.equal(names.includes('preparing'), false, 'it refused before even cloning')
  assert.deepEqual(names, ['failed'])
})

test('*** a workspace refusal reaches `preparing` but never `running` ***', async () => {
  const { runner, phases } = runnerHarness({ workspace: { prepare: () => { throw new Error('no space') }, cleanup: () => {} } })
  const wo = WO()
  await runner.run({ runId: 'run_p3', workOrder: wo, approvedHash: hashWorkOrder(wo), who: 'louie' })
  assert.deepEqual(phases.map((p) => p.phase), ['preparing', 'failed'])
})

test('*** ⛔ EVERY AGENT-AUDIT RECORD CARRIES ITS runId — the reverse link ***', async () => {
  const { runner, audits } = runnerHarness()
  const wo = WO()
  await runner.run({ runId: 'run_aud', workOrder: wo, approvedHash: hashWorkOrder(wo), who: 'louie' })
  assert.equal(audits.length, 1)
  assert.equal(audits[0].runId, 'run_aud')
  assert.equal(audits[0].approvalId, wo.approvalId)
})

test('*** a refused attempt is audited WITH its runId too — refusals are not silent ***', async () => {
  const { runner, audits } = runnerHarness()
  await runner.run({ runId: 'run_bad', workOrder: WO(), approvedHash: 'not-the-hash', who: 'louie' })
  assert.equal(audits.length, 1)
  assert.equal(audits[0].runId, 'run_bad')
})

test('*** a caller with no Run records runId null — an honest absence, not a guess ***', async () => {
  const { runner, audits } = runnerHarness()
  const wo = WO()
  await runner.run({ workOrder: wo, approvedHash: hashWorkOrder(wo), who: 'louie' })
  assert.equal(audits[0].runId, null)
})

test('*** the audit record shape carries no prompt, no diff, no Owner text ***', async () => {
  const { runner, audits } = runnerHarness()
  const wo = WO()
  await runner.run({ runId: 'run_shape', workOrder: wo, approvedHash: hashWorkOrder(wo), who: 'louie' })
  const keys = Object.keys(audits[0])
  for (const banned of ['prompt', 'patchText', 'diff', 'message', 'token', 'goalText']) {
    assert.equal(keys.includes(banned), false, 'audit must not carry ' + banned)
  }
})

/* ═══ the Work Order is untouched ══════════════════════════════════════════ */

/**
 * ⛔ RB1 CHANGED THIS DELIBERATELY — 12 → 14, AND `projectId` MOVED SIDES.
 *
 * C1c froze the canonical order at 12 and banned `projectId` from the hash, because at
 * that point repository identity carried no meaning and an unused field in the hash is
 * just churn. RB1 gave it meaning: the Owner now reads the repository on his card, so it
 * must be inside the hash he approves — a value he read that the server can change is
 * exactly what WYSIWYA exists to prevent.
 *
 * What did NOT change is the half of the old fence that was always the important half:
 * EXECUTION identity and MACHINE paths still have no business in the hash. `runId` names
 * an attempt, not an authorization; `repoRoot` names one machine's folder and would tie
 * every historical hash to that box. Both stay out, and are still asserted below.
 */
test('*** Work Order canonical is exactly 15 fields — the RB1 identity pair included ***', () => {
  const keys = Object.keys(canonicalWorkOrder(WO()))
  assert.equal(keys.length, 15)
  assert.ok(keys.includes('projectId') && keys.includes('repoFullName'), 'the identity pair is canonical')
})

test('*** ⛔ REPOSITORY IDENTITY IS HASH-BOUND — AND A MACHINE ROOT STILL IS NOT ***', () => {
  const base = WO()
  const hash = hashWorkOrder(base)

  // The pair the Owner reads MUST move the hash.
  assert.notEqual(hashWorkOrder(WO({ projectId: 'aroma-system' })), hash, '⛔ projectId is not hash-bound')
  assert.notEqual(hashWorkOrder(WO({ repoFullName: 'Louielui/aroma-system' })), hash, '⛔ repoFullName is not hash-bound')

  // Execution identity and machine paths must NOT.
  for (const extra of [{ runId: 'run_x' }, { repoRoot: 'C:/somewhere' }, { repositoryId: 'r1' }, { repositoryBindingId: 'b1' }, { schemaVersion: 2 }]) {
    assert.equal(hashWorkOrder(Object.assign({}, base, extra)), hash,
      '⛔ ' + Object.keys(extra)[0] + ' entered the canonical order')
    assert.equal(Object.keys(canonicalWorkOrder(Object.assign({}, base, extra))).length, 15)
  }
})

test('*** approvalId was ALREADY canonical — C1c needed no schema change to link a Run ***', () => {
  const a = hashWorkOrder(WO({ approvalId: 'appr_a' }))
  const b = hashWorkOrder(WO({ approvalId: 'appr_b' }))
  assert.notEqual(a, b, 'the approval identity is inside the hash, which is why it can be trusted as the link')
})
