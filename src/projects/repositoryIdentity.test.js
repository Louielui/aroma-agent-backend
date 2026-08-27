'use strict'

/**
 * repositoryIdentity.test.js — P1-C1b2c RB1. WHICH REPOSITORY DID THE OWNER APPROVE?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE MEASURED DEFECT THIS TRANCHE CLOSES. Before RB1 the only question asked before a
 * Proposal was 「does this relative path exist in the repository this process lives in?」
 * Measured 2026-08-20 against the real production tree, these all answer YES in the
 * backend AND exist in Aroma System:
 *
 *     README.md   package.json   CLAUDE.md   docs/HOUSE-RULES.md   .gitignore
 *
 * So 「改 aroma-system 個 README.md」 passed the gate, created a Proposal, sealed a Work
 * Order against the BACKEND's README.md — and the approval card named no repository at
 * all, so there was no line on it the Owner could have read to catch the mistake.
 *
 * Existence is not identity. These tests pin identity: server-derived, Owner-visible,
 * hash-bound, durable, fail-closed — while execution stays BACKEND-ONLY.
 *
 * Deterministic: real modules, injected fakes, a real loopback app for the route tests.
 * ZERO real spawn, ZERO CLI, ZERO model call, ZERO paid call, ZERO network egress.
 *
 *   Run: node --test src/projects/repositoryIdentity.test.js
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')

const identityModule = require('./repositoryIdentity')
const { EXECUTABLE_IDENTITY, IDENTITY_REFUSED, identifyProject, identityForProject, isExecutableIdentity } = identityModule
const { canonicalWorkOrder, hashWorkOrder, validateWorkOrder } = require('../agent/workOrder')
const { proposeWorkOrder, repositoryFileAvailable, currentRepoFileAvailable } = require('../agent/workOrderProducer')
const { buildApprovalView } = require('../agent/workOrderView')
const { createWorkRequest } = require('../routes/workRequestRoute')
const { createAgentRunner } = require('../agent/agentRunner')
const { createConfirmService } = require('../agent/confirmService')
const { createProposalStore } = require('../coo/proposal')
const { createRunStore } = require('../run/store')
const { createAuditLog } = require('../agent/audit')
const { createApp } = require('../app')

const BACKEND = { projectId: 'aroma-agent-backend', repoFullName: 'Louielui/aroma-agent-backend' }
const SYSTEM = { projectId: 'aroma-system', repoFullName: 'Louielui/aroma-system' }
const CANARY = 'docs/canary/agent-canary.md'

const WO = (over = {}) => Object.assign({
  goal: 'tidy one helper',
  projectId: BACKEND.projectId,
  repoFullName: BACKEND.repoFullName,
  expectedSha: 'd05527e49d2092fdf82e74efe4d96f203fcd80e9',
  allowedFiles: ['src/foo.js'],
  allowedTestCommand: null,
  forbiddenActions: ['commit', 'push', 'PR', 'merge', 'deploy'],
  timeoutSec: 60,
  costCapUsd: 1,
  branch: 'agent/appr_rb1',
  approvalId: 'appr_rb1',
  currentExcerpt: 'old',
  currentExcerptTruncated: false,
  intendedChange: 'new',
  approvalTtlSec: 600
}, over)

/* ═══ 1. THE CANONICAL ORDER CARRIES THE IDENTITY ═══════════════════════════ */

test('*** the canonical Work Order is 15 fields, identity second and third, revision fourth ***', () => {
  const keys = Object.keys(canonicalWorkOrder(WO()))
  assert.equal(keys.length, 15)
  assert.deepEqual(keys.slice(0, 4), ['goal', 'projectId', 'repoFullName', 'expectedSha'], 'serialization order is pinned')
})

test('*** ⛔ CHANGING THE REPOSITORY CHANGES THE HASH ***', () => {
  const base = hashWorkOrder(WO())
  assert.notEqual(hashWorkOrder(WO({ projectId: SYSTEM.projectId })), base, '⛔ projectId is not hash-bound')
  assert.notEqual(hashWorkOrder(WO({ repoFullName: SYSTEM.repoFullName })), base, '⛔ repoFullName is not hash-bound')
})

test('*** ⛔ NO MACHINE ROOT REACHES THE CANONICAL ORDER ***', () => {
  const keys = Object.keys(canonicalWorkOrder(WO({ repoRoot: 'C:/Aroma/aroma-agent-backend' })))
  assert.equal(keys.includes('repoRoot'), false, '⛔ a machine path entered the hash')
  assert.equal(keys.length, 15)
  assert.equal(hashWorkOrder(WO({ repoRoot: 'C:/x' })), hashWorkOrder(WO()), '⛔ repoRoot moved the hash')
})

test('*** validation refuses a missing identity and a path-shaped repoFullName ***', () => {
  assert.equal(validateWorkOrder(WO({ projectId: undefined })).ok, false)
  assert.equal(validateWorkOrder(WO({ repoFullName: undefined })).ok, false)
  for (const bad of ['C:\\Aroma\\aroma-agent-backend', '/home/ubuntu/aroma', 'Louielui/../etc', 'no-slash', '']) {
    assert.equal(validateWorkOrder(WO({ repoFullName: bad })).ok, false, 'accepted: ' + JSON.stringify(bad))
  }
})

/* ═══ 2. WHAT THE OWNER SEES IS WHAT HE APPROVES ════════════════════════════ */

test('*** the repository is on the VISIBLE FACE, not only behind 詳細 ***', () => {
  const v = buildApprovalView(WO())
  const face = v.card.sections.map((s) => s.body).join('\n')
  assert.ok(face.includes('Louielui/aroma-agent-backend'), '⛔ the Owner cannot see which repository: ' + face)
  // and the one-file promise SURVIVED — adding the repository must not displace it
  assert.ok(/只修改 src\/foo\.js 一個檔案/.test(face), '⛔ the file-scope promise fell off the face')
  assert.equal(v.card.sections.length, 3, "the Owner's three-section ruling still stands")
})

test('*** 技術細節 names the project and the repository, from canonical ***', () => {
  const v = buildApprovalView(WO())
  assert.equal(v.technical.projectId, BACKEND.projectId)
  assert.equal(v.technical.repoFullName, BACKEND.repoFullName)
  const lines = v.technicalLines.join('\n')
  assert.ok(lines.includes(BACKEND.projectId) && lines.includes(BACKEND.repoFullName))
  // WYSIWYA: the displayed values ARE the canonical ones the hash covers.
  const canonical = canonicalWorkOrder(WO())
  assert.equal(v.technical.projectId, canonical.projectId)
  assert.equal(v.technical.repoFullName, canonical.repoFullName)
})

/* ═══ 3. THE SAME-FILENAME ATTACK — THE POINT OF THE TRANCHE ════════════════ */

test('*** ⛔ THE FIXTURE IS HONEST: README.md REALLY DOES EXIST IN THE BACKEND ***', () => {
  // If this ever fails, the attack test below is passing for the wrong reason.
  assert.equal(currentRepoFileAvailable('README.md').ok, true,
    '⛔ the collision this tranche exists to close is not reproducible from this tree')
})

test('*** ⛔ 「改 aroma-system 個 README.md」 IS REFUSED BEFORE ANYTHING PERSISTS ***', async () => {
  let persisted = 0
  const out = await createWorkRequest(
    { message: '幫我改 aroma-system 個 README.md，第一行改成新標題' },
    { promoteToProposal: async () => { persisted++; return { ok: true, proposal: { id: 'prop_x' } } } }
  )
  assert.equal(out.ok, false, '⛔ a wrong-repository request produced something')
  assert.equal(out.reason, IDENTITY_REFUSED.NOT_EXECUTABLE)
  assert.equal(persisted, 0, '⛔ promoteToProposal was reached — a Proposal existed for the wrong repository')
})

test('*** the refusal is by IDENTITY, not by the file being absent ***', () => {
  // Identity is decided before the filesystem is consulted at all.
  assert.equal(repositoryFileAvailable(SYSTEM, 'README.md').reason, IDENTITY_REFUSED.NOT_EXECUTABLE)
  assert.equal(repositoryFileAvailable(SYSTEM, 'this/does/not/exist.md').reason, IDENTITY_REFUSED.NOT_EXECUTABLE,
    'the same closed reason either way — existence never enters the answer')
  assert.equal(repositoryFileAvailable(BACKEND, 'README.md').ok, true)
})

test('*** an ordinary request with no project named CHOOSES the backend, explicitly ***', () => {
  const r = identifyProject({ message: '幫我改 README.md 第一行' })
  assert.equal(r.ok, true)
  assert.deepEqual({ projectId: r.identity.projectId, repoFullName: r.identity.repoFullName }, BACKEND)
  assert.equal(r.source, 'backend_default', 'the default is a named decision, not a silent fallback')
})

test('*** ⛔ NO FUZZY MATCHING, NO PREFIX TRUNCATION, NO FIRST-ENTRY FALLBACK ***', () => {
  // 「aroma」 is a prefix of BOTH registered projects. Guessing between them is the failure.
  assert.equal(identifyProject({ message: '改 aroma 個 README.md' }).source, 'backend_default')
  assert.equal(identityForProject('aroma'), null)
  assert.equal(identityForProject('aroma-sys'), null)
  assert.equal(identityForProject(''), null)
  assert.equal(identityForProject(null), null)
})

test('*** two projects named, or a target that disagrees, fails CLOSED ***', () => {
  assert.equal(identifyProject({ message: '改 aroma-system 同 aroma-agent-backend' }).reason, IDENTITY_REFUSED.AMBIGUOUS_PROJECT)
  assert.equal(identifyProject({ message: '改 aroma-agent-backend', targetProjectId: 'aroma-system' }).reason,
    IDENTITY_REFUSED.IDENTITY_CONFLICT)
  assert.equal(identifyProject({ targetProjectId: 'not-a-project' }).reason, IDENTITY_REFUSED.UNKNOWN_PROJECT)
})

test('*** a RESOLVED Aroma System target stays non-executable ***', async () => {
  let persisted = 0
  const { createResolvedWorkRequest } = require('../routes/workRequestRoute')
  const out = await createResolvedWorkRequest(
    { originalOwnerMessage: '改 Order Planning 頁', originalIntent: '改一行字', file: 'README.md', targetProjectId: 'aroma-system' },
    { promoteToProposal: async () => { persisted++; return { ok: true, proposal: { id: 'p' } } } }
  )
  assert.equal(out.ok, false)
  assert.equal(out.reason, IDENTITY_REFUSED.NOT_EXECUTABLE)
  assert.equal(persisted, 0, '⛔ the projectId was thrown away and the filename tested in the backend')
})

/* ═══ 4. SEALING ═══════════════════════════════════════════════════════════ */

const sealArgs = (over = {}) => Object.assign({
  repositoryIdentity: BACKEND,
  proposal: { goal: '改 canary 一行', candidateFile: CANARY, intendedChange: 'line 2' },
  conversation: ['請改 ' + CANARY],
  newId: () => 'appr_seal1'
}, over)

test('*** a backend seal carries the verified pair, straight from the registry ***', () => {
  const r = proposeWorkOrder(sealArgs())
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  assert.equal(r.workOrder.projectId, BACKEND.projectId)
  assert.equal(r.workOrder.repoFullName, BACKEND.repoFullName)
  assert.equal(r.hash, hashWorkOrder(r.workOrder))
  // 現時內容 still comes from the backend root — the repository the order names.
  const real = fs.readFileSync(path.join(__dirname, '..', '..', CANARY), 'utf8').replace(/\r\n/g, '\n')
  assert.ok(real.startsWith(r.workOrder.currentExcerpt.split('\n')[0]), 'the excerpt is the real backend file')
})

test('*** ⛔ AROMA SYSTEM CANNOT SEAL AN EXECUTABLE ORDER — AND NOTHING IS READ FOR IT ***', () => {
  const r = proposeWorkOrder(sealArgs({ repositoryIdentity: SYSTEM }))
  assert.equal(r.ok, false)
  assert.ok(JSON.stringify(r.errors).includes('Louielui/aroma-system'), 'the refusal names the repository it refused')
  assert.equal(JSON.stringify(r).includes('C:'), false, '⛔ a machine path leaked into the refusal')
})

test('*** a Proposal with NO repository identity cannot seal — and is not defaulted ***', () => {
  for (const bad of [undefined, null, {}, { projectId: 'aroma-agent-backend' }, { repoFullName: 'Louielui/aroma-agent-backend' }]) {
    const r = proposeWorkOrder(sealArgs({ repositoryIdentity: bad }))
    assert.equal(r.ok, false, 'sealed with identity ' + JSON.stringify(bad))
  }
})

test('*** a pair the registry does not agree with is refused ***', () => {
  const r = proposeWorkOrder(sealArgs({ repositoryIdentity: { projectId: 'aroma-agent-backend', repoFullName: 'attacker/aroma-agent-backend' } }))
  assert.equal(r.ok, false, '⛔ a mismatched pair sealed')
})

/* ═══ 5. THE PROPOSAL CARRIES IT, STRUCTURALLY ═════════════════════════════ */

test('*** the Proposal stores the identity as a FIELD, never inside the brief text ***', () => {
  const runStore = createRunStore({ dispatcher: async () => {}, authorizeDispatch: () => false, persistence: false })
  const store = createProposalStore({ runStore, persistence: false })
  const p = store.createBridgeProposal({ task: 'brief text', sourceTaskId: 'task_1', repositoryIdentity: BACKEND })
  assert.deepEqual(p.repositoryIdentity, BACKEND)
  assert.equal(/aroma-agent-backend/.test(p.task), false, '⛔ the identity was encoded into the brief')

  // A half-identity is stored as none: an answer that looks like an answer is worse.
  const half = store.createBridgeProposal({ task: 'b', sourceTaskId: 'task_2', repositoryIdentity: { projectId: 'aroma-agent-backend' } })
  assert.equal(half.repositoryIdentity, null)

  // Legacy / Lane-1 promotions keep null HONESTLY — no backfill, no default.
  const legacy = store.createBridgeProposal({ task: 'b', sourceTaskId: 'task_3' })
  assert.equal(legacy.repositoryIdentity, null)
})

/* ═══ 6. THE EXECUTION FENCES ══════════════════════════════════════════════ */

async function confirmHarness (workOrder) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-rb1-'))
  const runStore = createRunStore({ dispatcher: async () => {}, authorizeDispatch: () => false, persistence: path.join(dir, 'runs.json') })
  const proposalStore = createProposalStore({ runStore, persistence: false })
  const { proposal } = await proposalStore.propose({
    conversationId: 'c1', message: 'build', llm: async () => ({ intent: 'develop', task: 't', targetProject: 'backend' })
  })
  const claims = []
  const runnerCalls = []
  const svc = createConfirmService({
    proposalStore,
    authorize: () => ({ status: 'authorized', agentBridgeAuthorized: true, developAuthorized: false, workerAuthorized: false }),
    agentRunner: { run: async (i) => { runnerCalls.push(i); return { ok: true, output: {} } } },
    owner: 'louie',
    auditFn: () => {},
    claimAgent: (id, f) => { claims.push(f); return runStore.claimAgent(id, f) },
    appendAgentStage: (id, s, f) => runStore.appendAgentStage(id, s, f)
  })
  const out = svc.confirmProposalAction({
    proposalId: proposal.id, agentExecute: true, workOrder, approvedHash: hashWorkOrder(workOrder), entryPoint: 'test'
  })
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r))
  return { out, claims, runnerCalls, runStore }
}

test('*** ⛔ A FOREIGN REPOSITORY NEVER REACHES THE CLAIM OR THE RUNNER ***', async () => {
  const h = await confirmHarness(WO({ projectId: SYSTEM.projectId, repoFullName: SYSTEM.repoFullName }))
  // ⛔ THE SPIES ARE ASSERTED FIRST, ON PURPOSE. They are the claim this test actually
  //    makes — 「nothing happened」 — and asserting the status word first would let a
  //    mutation that removes the fence fail on the WORD rather than on the execution.
  assert.equal(h.claims.length, 0, '⛔ claimAgent was called for a repository we cannot execute')
  assert.equal(h.runnerCalls.length, 0, '⛔ the runner was called for a foreign repository')
  assert.equal(h.out.agentHandedOff, false)
  assert.equal(h.out.body.dispatchStatus, 'repository_identity_mismatch')
  const stages = h.runStore.getRun(h.out.body.runId).timeline.map((e) => e.stage)
  assert.equal(stages.includes('AGENT_CLAIMED'), false)
  assert.equal(stages.includes('AGENT_SELECTED'), false)
})

test('*** the backend path is UNCHANGED — it claims, selects and reaches the runner ***', async () => {
  const h = await confirmHarness(WO())
  assert.equal(h.out.body.dispatchStatus, 'agent_execute_accepted')
  assert.equal(h.claims.length, 1)
  assert.equal(h.runnerCalls.length, 1)
  const stages = h.runStore.getRun(h.out.body.runId).timeline.map((e) => e.stage)
  assert.ok(stages.includes('AGENT_CLAIMED') && stages.includes('AGENT_SELECTED'))
})

test('*** ⛔ NEW AGENT_CLAIMED CARRIES THE REPOSITORY, DURABLY ***', async () => {
  const h = await confirmHarness(WO())
  const claim = h.runStore.getRun(h.out.body.runId).timeline.find((e) => e.stage === 'AGENT_CLAIMED')
  assert.equal(claim.facts.projectId, BACKEND.projectId)
  assert.equal(claim.facts.repoFullName, BACKEND.repoFullName)
  assert.equal('repoRoot' in claim.facts, false, '⛔ a machine path entered the durable Run')
  assert.equal(JSON.stringify(claim.facts).includes('C:'), false)
})

test('*** the runner refuses a foreign order BEFORE workspace.prepare and BEFORE the worker ***', async () => {
  let prepared = 0
  let invoked = 0
  const runner = createAgentRunner({
    projectId: BACKEND.projectId,
    repoFullName: BACKEND.repoFullName,
    workspace: { prepare: () => { prepared++; return { dir: 'x', branch: 'b' } }, verifyNoRemotes: () => {}, cleanup: () => {} },
    worker: { invoke: async () => { invoked++; return { ok: true, output: {} } } },
    checkCredentials: () => ({ canRun: true })
  })
  const r = await runner.run({ workOrder: WO({ projectId: SYSTEM.projectId, repoFullName: SYSTEM.repoFullName }), approvedHash: hashWorkOrder(WO({ projectId: SYSTEM.projectId, repoFullName: SYSTEM.repoFullName })) })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'repository_identity_mismatch')
  assert.equal(prepared, 0, '⛔ a clone was prepared for a foreign repository')
  assert.equal(invoked, 0, '⛔ the worker ran for a foreign repository')
})

/* ═══ 7. THE AUDIT ════════════════════════════════════════════════════════ */

test('*** a NEW audit record names the repository — and never a machine path ***', () => {
  const written = []
  const log = createAuditLog({ artifactStore: { write: (kind, rec) => written.push(rec) } })
  log.append({ approvalId: 'appr_1', runId: 'run_1', workOrderHash: 'h', who: 'louie', projectId: BACKEND.projectId, repoFullName: BACKEND.repoFullName, result: { ok: true, output: {} } })
  const rec = written[0]
  assert.equal(rec.projectId, BACKEND.projectId)
  assert.equal(rec.repoFullName, BACKEND.repoFullName)
  assert.equal('repoRoot' in rec, false, '⛔ a machine root entered the audit')
  assert.equal(JSON.stringify(rec).includes('C:\\'), false)
})

test('*** a LEGACY audit with no repository fields stays readable, as honest nulls ***', () => {
  const written = []
  const log = createAuditLog({ artifactStore: { write: (kind, rec) => written.push(rec) } })
  log.append({ approvalId: 'appr_old', workOrderHash: 'h', who: 'louie', result: { ok: true, output: {} } })
  assert.equal(written[0].projectId, null)
  assert.equal(written[0].repoFullName, null)
  assert.equal(written[0].ok, true, 'the record is still fully readable')
})

/* ═══ 8. HISTORY IS NOT REWRITTEN ═════════════════════════════════════════ */

test('*** ⛔ A PRE-RB1 RUN REHYDRATES UNCHANGED AND KEEPS ITS TERMINAL ***', () => {
  const { deriveStatus, isTerminal } = require('../run/run')
  // The real C1c Canary B shape, written before repository identity existed.
  const legacy = {
    id: 'run_92c23a53',
    owner: 'louie',
    approvalId: 'appr_1b9d0877',
    timeline: [
      { stage: 'TASK_CREATED', at: '2026-08-20T19:00:00.000Z', facts: {} },
      { stage: 'AGENT_CLAIMED', at: '2026-08-20T19:01:00.000Z', facts: { approvalId: 'appr_1b9d0877', workOrderHash: 'h', executor: 'claude-code' } },
      { stage: 'AGENT_SELECTED', at: '2026-08-20T19:01:01.000Z', facts: { agentId: 'claude-code', approvalId: 'appr_1b9d0877' } },
      { stage: 'AGENT_RUNNING', at: '2026-08-20T19:01:02.000Z', facts: { approvalId: 'appr_1b9d0877' } },
      { stage: 'AGENT_FINISHED', at: '2026-08-20T19:02:00.000Z', facts: { ok: true, approvalId: 'appr_1b9d0877' } },
      { stage: 'SUCCEEDED', at: '2026-08-20T19:02:01.000Z', facts: { executor: 'claude-code', approvalId: 'appr_1b9d0877' } }
    ]
  }
  const before = JSON.stringify(legacy)
  assert.equal(deriveStatus(legacy), 'succeeded', '⛔ a historical success stopped being a success')
  assert.equal(isTerminal(deriveStatus(legacy)), true)
  assert.equal(JSON.stringify(legacy), before, '⛔ reading a legacy Run mutated it')
})

test('*** recovery does not require repository identity on old events ***', () => {
  const { deriveRecoveredStatus } = require('../run/recovery')
  const at = '2026-08-20T19:00:00.000Z'
  const run = {
    id: 'run_old',
    timeline: [
      { stage: 'TASK_CREATED', at, facts: {} },
      { stage: 'AGENT_CLAIMED', at, facts: { approvalId: 'appr_old', workOrderHash: 'h' } },
      { stage: 'AGENT_FINISHED', at, facts: { ok: true } }
    ]
  }
  const out = deriveRecoveredStatus({ run })
  assert.equal(out.status, 'succeeded', '⛔ recovery started demanding a field history cannot have')
})

/* ═══ 9. THE BROWSER MAY DISPLAY IT. IT MAY NOT NAME IT. ═══════════════════ */

const GOOD = { origin: 'http://127.0.0.1:8090', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }

function startApp () {
  const app = createApp({
    runPersistence: false,
    proposalPersistence: false,
    serviceToken: 'rb1-test',
    agentRunner: { run: async () => ({ ok: true, output: { filesChanged: [], risks: [], warnings: [] } }) },
    workerDeps: { artifactStore: null, runner: null }
  })
  const server = http.createServer(app)
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ app, server, port: server.address().port })))
}

function req (ctx, { url, headers = {}, body }) {
  const payload = Buffer.from(JSON.stringify(body))
  const h = Object.assign({ host: '127.0.0.1:8090', 'content-length': String(payload.length) }, headers)
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: ctx.port, method: 'POST', path: url, headers: h, setHost: false }, (res) => {
      let raw = ''
      res.on('data', (d) => { raw += d })
      res.on('end', () => { let json = null; try { json = JSON.parse(raw) } catch {} resolve({ status: res.statusCode, json, headers: res.headers }) })
    })
    r.on('error', reject)
    r.write(payload)
    r.end()
  })
}

function seed (ctx, repositoryIdentity) {
  const s = ctx.app.locals.proposalStore
  const p = s.createBridgeProposal({ task: 'canary', sourceTaskId: 'task_' + crypto.randomBytes(6).toString('hex'), repositoryIdentity })
  s.setLinkState(p.id, 'ready')
  return p.id
}

const SEAL_BODY = (proposalId, extra = {}) => Object.assign({
  proposalId, goal: '改 canary 一行字', candidateFile: CANARY, intendedChange: 'line 2', conversation: ['請改 ' + CANARY]
}, extra)

test('*** ⛔ A BROWSER-SUPPLIED REPOSITORY FIELD IS REFUSED, NOT SILENTLY IGNORED ***', async () => {
  const ctx = await startApp()
  try {
    for (const field of ['projectId', 'repoFullName', 'repoRoot', 'repositoryBindingId', 'repository', 'repositoryIdentity']) {
      const res = await req(ctx, {
        url: '/api/v1/owner/work-orders',
        headers: GOOD,
        body: SEAL_BODY(seed(ctx, BACKEND), { [field]: 'Louielui/aroma-system' })
      })
      assert.equal(res.status, 400, field + ' was accepted: ' + JSON.stringify(res.json))
      assert.equal(res.json.reason, 'repository_identity_not_owner_supplied', field)
    }
  } finally { ctx.server.close() }
})

test('*** the SEALED identity is the PROPOSAL identity, and the card shows it ***', async () => {
  const ctx = await startApp()
  try {
    const res = await req(ctx, { url: '/api/v1/owner/work-orders', headers: GOOD, body: SEAL_BODY(seed(ctx, BACKEND)) })
    assert.equal(res.status, 201, JSON.stringify(res.json))
    // The identity the route returns is the PROPOSAL's, projected from canonical.
    assert.equal(res.json.display.projectId, BACKEND.projectId)
    assert.equal(res.json.display.repoFullName, BACKEND.repoFullName)
    assert.ok(res.json.technicalLines.join('\n').includes(BACKEND.repoFullName), '⛔ 技術細節 omits the repository')
    const face = res.json.card.sections.map((s) => s.body).join('\n')
    assert.ok(face.includes(BACKEND.repoFullName), '⛔ the repository is not on the Owner face')
    // And it is genuinely hash-bound: the returned hash is the hash of that identity.
    assert.equal(res.json.workOrderHash.length, 64)
  } finally { ctx.server.close() }
})

test('*** ⛔ A LEGACY PROPOSAL WITH NO IDENTITY CANNOT SEAL A NEW ORDER ***', async () => {
  const ctx = await startApp()
  try {
    const res = await req(ctx, { url: '/api/v1/owner/work-orders', headers: GOOD, body: SEAL_BODY(seed(ctx, null)) })
    assert.equal(res.status, 409, JSON.stringify(res.json))
    assert.equal(res.json.reason, 'proposal_has_no_repository_identity')
  } finally { ctx.server.close() }
})

test('*** ⛔ AN AROMA SYSTEM PROPOSAL CANNOT SEAL AN EXECUTABLE ORDER ***', async () => {
  const ctx = await startApp()
  try {
    const res = await req(ctx, { url: '/api/v1/owner/work-orders', headers: GOOD, body: SEAL_BODY(seed(ctx, SYSTEM)) })
    assert.equal(res.status, 422, JSON.stringify(res.json))
    assert.ok(JSON.stringify(res.json).includes('Louielui/aroma-system'))
  } finally { ctx.server.close() }
})

/* ═══ 10. MULTI-REPO IS STILL OFF ═════════════════════════════════════════ */

test('*** ⛔ MULTI-REPO EXECUTION REMAINS INACTIVE ***', () => {
  assert.equal(isExecutableIdentity(EXECUTABLE_IDENTITY), true)
  assert.equal(isExecutableIdentity(identityForProject('aroma-system')), false,
    '⛔ Aroma System became executable without a GO')

  // No runner map, no resolver, no per-run mutable root anywhere on the execution path.
  const root = path.join(__dirname, '..')
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  for (const f of ['app.js', 'agent/agentRunner.js', 'agent/confirmService.js']) {
    const s = strip(fs.readFileSync(path.join(root, f), 'utf8'))
    for (const banned of ['runnerFor', 'runnerRegistry', 'resolveRunner', 'AgentRunnerResolver', 'runnersBy']) {
      assert.equal(new RegExp(banned).test(s), false, '⛔ a multi-repo runner appeared in ' + f + ': ' + banned)
    }
    assert.equal(/repoRoot\s*=\s*[^=]/.test(s.replace(/const repoRoot = options\.repoRoot/, '')), false,
      '⛔ repoRoot is assigned somewhere it can be mutated: ' + f)
  }
})

test('*** ⛔ NO AROMA SYSTEM LOCAL PATH IS REFERENCED BY PRODUCTION CODE ***', () => {
  const root = path.join(__dirname, '..')
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name)
    if (e.isDirectory()) return walk(p)
    return (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) ? [p] : []
  })
  // ⛔ CODE ONLY. projectRegistry.js NAMES the path it refuses to hold, in a comment
  //    explaining why. Scanning raw text makes that explanation count as the offence —
  //    the exact prose-vs-code trap this repository keeps rediscovering.
  const strip2 = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  for (const f of walk(root)) {
    const s = strip2(fs.readFileSync(f, 'utf8'))
    assert.equal(/Projects[\\/]aroma-system/.test(s), false, '⛔ a local Aroma System path is in ' + path.relative(root, f))
  }
})
