'use strict'

/**
 * openClawGovernance.test.js — IDENTITY IN THE ORG CHART, AND NO WAY AROUND B2.
 *
 * Two halves, and the second is the one that matters.
 *
 * The registry half is ordinary: OpenClaw exists once, is not connected, and owns six
 * capabilities that collide with nobody.
 *
 * The integration half asks the question a new executor always raises — whether the
 * governance built for the previous one still applies. A different executor is exactly the
 * shape of thing that quietly acquires an exemption: it arrives with its own module, its
 * own tests, its own vocabulary, and nobody notices that the gate in between was written
 * against the old one. So OpenClaw is driven THROUGH the real agentRunner here, and the
 * B2 revision gate is proven to stop it just as dead as it stops Claude Code.
 */

const os = require('os')
const fs = require('fs')
const path = require('path')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-c1-gov-test-'))

const test = require('node:test')
const assert = require('node:assert')

const {
  WORKERS, listWorkers, getWorker, workerForCapability, normalizeCapability, buildCapabilityIndex
} = require('../workers/registry')
const { createOpenClawWorker } = require('../agent/openClawWorker')
const { createAgentRunner } = require('../agent/agentRunner')
const { hashWorkOrder } = require('../agent/workOrder')

/** A pristine sandbox for the governance harness. */
const CLEAN_GOV = () => ({ headSha: APPROVED, currentBranch: 'agent/appr_c1', remotes: [], indexFlagged: [], indexDrift: [], dotGitIsRealDir: true, topLevelOk: true, gitDirOk: true, commonDirOk: true })

const OPENCLAW_CAPS = [
  'openclaw_repo_audit', 'openclaw_code_review', 'openclaw_test_run',
  'openclaw_log_inspection', 'openclaw_document_analysis'
]

/**
 * Withdrawn for the local-read-only lane. Kept named here so its ABSENCE is asserted rather
 * than merely happening: a capability that quietly reappears would re-open the read+network
 * combination that C2-B2-A ruled out, and nothing else in the suite would notice.
 */
const WITHDRAWN_CAPS = ['openclaw_web_research']

/* ═══════════════════════ REGISTRY IDENTITY ═══════════════════════ */

test('R1/R2/R3/R4. OpenClaw exists exactly once, external, and NOT connected', () => {
  const found = WORKERS.filter((w) => w.id === 'openclaw')
  assert.strictEqual(found.length, 1)
  const w = found[0]
  assert.strictEqual(w.id, 'openclaw')
  assert.strictEqual(w.engine, 'external')
  assert.strictEqual(w.connected, false, 'C1 ships identity, never the ability to run')
  assert.strictEqual(w.provider, 'OpenClaw')
})

test('R4b. the Architect remains the ONLY connected worker', () => {
  // If OpenClaw were ever flipped on by accident, this is the line that notices.
  const connected = listWorkers().filter((w) => w.connected).map((w) => w.id)
  assert.deepStrictEqual(connected, ['architect'])
})

test('R5/R6. the lane capabilities are present and globally unique after normalization', () => {
  const w = getWorker('openclaw')
  for (const c of OPENCLAW_CAPS) assert.ok(w.capabilities.includes(c), `${c} must be declared`)
  assert.strictEqual(w.capabilities.length, OPENCLAW_CAPS.length)
  for (const c of WITHDRAWN_CAPS) {
    assert.ok(!w.capabilities.includes(c), `${c} must NOT be declared in the local-read-only lane`)
  }

  // Uniqueness is proven the way the registry itself proves it: the index loses nothing.
  const declarations = WORKERS.reduce((n, x) => n + x.capabilities.length, 0)
  assert.strictEqual(buildCapabilityIndex(WORKERS).size, declarations)
  for (const c of OPENCLAW_CAPS) assert.strictEqual(normalizeCapability(c), c, 'already normal form')
})

test('R7. a duplicate against ANY existing worker still refuses to build', () => {
  const mk = (id, caps) => ({ id, role: id, provider: id, engine: 'external', connected: false, capabilities: caps })
  // One collision per existing owner, including OpenClaw itself.
  for (const taken of ['ops', 'coding', 'code_review', 'browser', 'terminal', 'openclaw_repo_audit']) {
    assert.throws(() => buildCapabilityIndex([...WORKERS, mk('intruder', [taken])]), /ambiguous worker registry/,
      `${taken} must still be refused as a duplicate`)
  }
})

test('R8/R9/R10. lookup resolves OpenClaw, and unknown capabilities still fail closed', () => {
  assert.strictEqual(getWorker('openclaw').id, 'openclaw')
  for (const c of OPENCLAW_CAPS) assert.strictEqual(workerForCapability(c).id, 'openclaw')
  assert.strictEqual(workerForCapability('  OpenClaw_Code_Review  ').id, 'openclaw', 'matching stays normalized')
  for (const unknown of ['openclaw', 'openclaw_deploy', 'quantum', '', null, undefined]) {
    assert.strictEqual(workerForCapability(unknown), null, `${JSON.stringify(unknown)} must not route`)
  }
})

test('R8b. ⛔ a web-research request REFUSES AT ROUTING, before any executor exists', () => {
  // §9's narrowest fail-closed mechanism, asserted rather than argued. Withdrawing the
  // capability means Step A's routing resolves it to null, so the refusal happens before a
  // workspace is prepared and before any executor or model is reached. The alternative —
  // keeping the capability and denying the web tools underneath it — would ACCEPT the
  // request and then silently do the work without the tools it named.
  for (const c of WITHDRAWN_CAPS) {
    assert.strictEqual(workerForCapability(c), null, `${c} must not route to any worker`)
    assert.strictEqual(workerForCapability('  ' + c.toUpperCase() + '  '), null,
      'and normalization must not smuggle it back in')
  }
  // it is genuinely gone from the registry, not merely unrouted
  const declared = WORKERS.flatMap((w) => w.capabilities)
  for (const c of WITHDRAWN_CAPS) assert.ok(!declared.includes(c), `${c} must not be declared by ANY worker`)
})

test('R11. routing to OpenClaw yields a worker that CANNOT execute', () => {
  // The dispatcher only ever executes connected && engine==='llm'. Work addressed to
  // OpenClaw therefore waits honestly instead of being promoted to whoever could act —
  // which is the Step A property, still holding with a seventh worker in the table.
  const w = workerForCapability('openclaw_repo_audit')
  assert.strictEqual(w.connected, false)
  assert.notStrictEqual(w.engine, 'llm')
})

/* ═══════════════════ B2 STILL GOVERNS A NEW EXECUTOR ═══════════════════ */

const APPROVED = '51d462e15437f1ca45f8fac39c450b119c0876c6'
const MOVED = 'd05527e49d2092fdf82e74efe4d96f203fcd80e9'
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
  branch: 'agent/appr_c1',
  approvalId: 'appr_c1'
}, over)

/** The REAL agentRunner, driving the REAL OpenClaw executor over a fake transport. */
/** Same harness, but with the executor test runner injectable for the throw cases. */
function governedWith (over = {}) { return governed(over) }

function governed (over = {}) {
  const spy = { transport: 0, cleanup: 0 }
  const audits = []
  const worker = createOpenClawWorker({
    transport: async () => { spy.transport++; return { ok: true, exit: 0, result: 'audit complete' } },
    testRunner: over.testRunner || (async () => ({ ok: true, code: 0 }))
  })
  const runner = createAgentRunner({
    repoRoot: process.cwd(),
    projectId: IDENTITY.projectId,
    repoFullName: IDENTITY.repoFullName,
    worker,
    workspace: {
      prepare: () => ({ dir: 'C:/tmp/clone', branch: 'agent/appr_c1', baseSha: over.baseSha || APPROVED }),
      containmentCheck: (t) => t,
      filesChanged: over.filesChanged || (() => []),
      repoChanges: over.repoChanges || (() => []),
      sandboxState: over.sandboxState || (() => ({ headSha: APPROVED, currentBranch: 'agent/appr_c1', remotes: [], indexFlagged: [], indexDrift: [], dotGitIsRealDir: true, topLevelOk: true, gitDirOk: true, commonDirOk: true })),
      diffStat: () => '', diffPatch: () => '',
      cleanup: () => { spy.cleanup++ }
    },
    auditLog: { append: (a) => audits.push(a) },
    writePatch: (id, text) => ({ ok: true, path: 'C:/tmp/p.patch', bytes: text.length }),
    checkCredentials: () => ({ canRun: true, state: 'ok', warning: null, refusal: null, refreshExpiresAt: null, daysLeft: 9, accessTokenValid: true, subscription: 'x' })
  })
  return { runner, spy, audits }
}

const runGoverned = async (g, wo) => {
  const o = wo || workOrder()
  return g.runner.run({ workOrder: o, who: 'louie', approvedHash: hashWorkOrder(o) })
}

test('I1. a matched revision lets OpenClaw run under the full B2 chain', async () => {
  const g = governed({ baseSha: APPROVED })
  const r = await runGoverned(g)
  assert.strictEqual(r.ok, true, JSON.stringify(r))
  assert.strictEqual(g.spy.transport, 1)
  assert.strictEqual(r.output.revisionMatch, true)
  assert.strictEqual(r.output.expectedSha, APPROVED)
  assert.strictEqual(r.output.observedBaseSha, APPROVED)
  // Read-only: nothing changed, so B2's patch identity is null without anyone arranging it.
  assert.deepStrictEqual(r.output.filesChanged, [])
  assert.strictEqual(r.output.patchSha256, null)
  // The audit the previous tranche built still receives this executor's run.
  assert.strictEqual(g.audits.length, 1)
  assert.strictEqual(g.audits[0].expectedSha, APPROVED)
  assert.strictEqual(g.audits[0].revisionMatch, true)
  assert.strictEqual(g.spy.cleanup, 1, 'the workspace is still cleaned up')
})

test('I2. ⛔ A REVISION MISMATCH STOPS OPENCLAW DEAD — zero transport calls', async () => {
  // The whole reason this test exists: a new executor must not acquire an exemption from a
  // gate written before it existed.
  const g = governed({ baseSha: MOVED })
  const r = await runGoverned(g)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error, 'revision_moved')
  assert.strictEqual(g.spy.transport, 0, 'OpenClaw must never be reached when the revision moved')
  assert.strictEqual(r.output.expectedSha, APPROVED)
  assert.strictEqual(r.output.observedBaseSha, MOVED)
  assert.strictEqual(r.output.revisionMatch, false)
  assert.strictEqual(g.audits[0].revisionMatch, false, 'the refusal is audited with both shas')
})

test('I3. a read-only violation by OpenClaw surfaces through the runner as a failure', async () => {
  const g = governed({ baseSha: APPROVED, repoChanges: () => ['src/foo.js'] })
  const r = await runGoverned(g)
  assert.strictEqual(r.ok, false, 'the enclosing runner must not launder a violation into success')
  assert.strictEqual(r.error, 'openclaw_read_only_violation')
  assert.strictEqual(r.output.revisionMatch, true, 'the revision was verified; the read-only rule is what broke')
})

test('I4. the sealed Work Order is unchanged by a governed OpenClaw run', async () => {
  const wo = workOrder()
  const before = JSON.stringify(wo)
  await runGoverned(governed({ baseSha: APPROVED }), wo)
  assert.strictEqual(JSON.stringify(wo), before)
})

test('I5. an UNTRACKED mutation by OpenClaw stays a failure through the real runner', async () => {
  // The blind-spot case, driven end to end: the enclosing runner must not launder it.
  const g = governed({ baseSha: APPROVED, repoChanges: () => ['brand-new-untracked.txt'] })
  const r = await runGoverned(g)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error, 'openclaw_read_only_violation')
  assert.deepStrictEqual(r.output.filesChanged, ['brand-new-untracked.txt'])
  // B2's evidence survives the executor-level refusal.
  assert.strictEqual(r.output.revisionMatch, true)
  assert.strictEqual(r.output.expectedSha, APPROVED)
  assert.strictEqual(g.audits[0].revisionMatch, true)
})

test('I6. a TEST-CAUSED mutation stays a failure through the real runner', async () => {
  let n = 0
  const g = governed({ baseSha: APPROVED, repoChanges: () => { n++; return n <= 2 ? [] : ['src/foo.js'] } })
  const r = await runGoverned(g, workOrder({ allowedTestCommand: 'npm test' }))
  assert.strictEqual(r.ok, false, 'a green test may not turn a mutation into success')
  assert.strictEqual(r.error, 'openclaw_read_only_violation')
  assert.strictEqual(r.output.revisionMatch, true, 'the revision was verified; read-only is what broke')
  assert.strictEqual(g.audits.length, 1, 'the attempt is still audited')
})

test('I7. an IGNORED untracked write (.env) stays a failure through the real runner', async () => {
  // The exact blind spot the final review found: --exclude-standard hid .env, so a
  // credentials file could have been written and reported clean. Driven end to end here.
  const g = governed({ baseSha: APPROVED, repoChanges: () => ['.env'] })
  const r = await runGoverned(g)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error, 'openclaw_read_only_violation')
  assert.deepStrictEqual(r.output.filesChanged, ['.env'])
  assert.strictEqual(r.output.revisionMatch, true)
  assert.strictEqual(r.output.expectedSha, APPROVED)
  assert.strictEqual(g.audits[0].revisionMatch, true)
})

test('I8. a test that mutates and then THROWS stays a read-only failure through the runner', async () => {
  let n = 0
  const g = governedWith({
    baseSha: APPROVED,
    repoChanges: () => { n++; return n <= 2 ? [] : ['data/db.json'] },
    testRunner: async () => { throw new Error('harness exploded') }
  })
  const r = await runGoverned(g, workOrder({ allowedTestCommand: 'npm test' }))
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error, 'openclaw_read_only_violation',
    'a thrown test does not turn a repository write into an ordinary test failure')
  assert.deepStrictEqual(r.output.filesChanged, ['data/db.json'])
  assert.strictEqual(r.output.revisionMatch, true, 'B2 evidence survives the executor refusal')
  assert.strictEqual(g.audits.length, 1)
})

test('I9. a transport that ADDS A REMOTE stays a failure through the real runner', async () => {
  let i = 0
  const g = governedWith({
    baseSha: APPROVED,
    sandboxState: () => { i++; return i <= 1 ? CLEAN_GOV() : Object.assign(CLEAN_GOV(), { remotes: ['attacker'] }) }
  })
  const r = await runGoverned(g)
  assert.strictEqual(r.ok, false)
  assert.deepStrictEqual(r.output.risks, ['workspace_isolation_violation'])
  assert.strictEqual(r.output.revisionMatch, true, 'B2 evidence survives an isolation refusal')
  assert.strictEqual(r.output.expectedSha, APPROVED)
  assert.strictEqual(g.audits[0].revisionMatch, true)
})

test('I10. a BRANCH SWITCH stays a failure through the real runner', async () => {
  let i = 0
  const g = governedWith({
    baseSha: APPROVED,
    sandboxState: () => { i++; return i <= 1 ? CLEAN_GOV() : Object.assign(CLEAN_GOV(), { currentBranch: 'main' }) }
  })
  const r = await runGoverned(g)
  assert.strictEqual(r.ok, false)
  assert.deepStrictEqual(r.output.risks, ['workspace_isolation_violation'])
  assert.strictEqual(r.output.observedBaseSha, APPROVED)
})

test('I11. a test that switches branch and THEN THROWS stays an isolation failure', async () => {
  let i = 0
  const g = governedWith({
    baseSha: APPROVED,
    sandboxState: () => { i++; return i <= 2 ? CLEAN_GOV() : Object.assign(CLEAN_GOV(), { currentBranch: 'main' }) },
    testRunner: async () => { throw new Error('harness exploded') }
  })
  const r = await runGoverned(g, workOrder({ allowedTestCommand: 'npm test' }))
  assert.strictEqual(r.ok, false)
  assert.deepStrictEqual(r.output.risks, ['workspace_isolation_violation'],
    'a thrown test does not downgrade a sandbox breach')
  assert.strictEqual(r.output.revisionMatch, true)
  assert.strictEqual(g.audits.length, 1, 'the attempt is still audited')
})

/* ══════ post-entry revision identity, through the REAL agentRunner ══════ */

test('I12. B2 lets it start, then the transport MOVES HEAD -> final failure', async () => {
  // The distinction this proves: revisionMatch=true means the clone STARTED from the
  // approved sha. Staying there is a separate fact, and it is the one B2 could not check.
  let i = 0
  const g = governedWith({
    baseSha: APPROVED,
    sandboxState: () => { i++; return i <= 1 ? CLEAN_GOV() : Object.assign(CLEAN_GOV(), { headSha: MOVED }) }
  })
  const r = await runGoverned(g)
  assert.strictEqual(r.ok, false)
  assert.deepStrictEqual(r.output.risks, ['workspace_revision_violation'])
  // B2's entry evidence is untouched and still says what it always said.
  assert.strictEqual(r.output.revisionMatch, true, 'it DID start from the approved revision')
  assert.strictEqual(r.output.expectedSha, APPROVED)
  assert.strictEqual(r.output.observedBaseSha, APPROVED)
  assert.strictEqual(g.audits[0].revisionMatch, true)
})

test('I13. a same-branch COMMIT by the transport is caught the same way', async () => {
  let i = 0
  const g = governedWith({
    baseSha: APPROVED,
    sandboxState: () => { i++; return i <= 1 ? CLEAN_GOV() : Object.assign(CLEAN_GOV(), { headSha: MOVED, currentBranch: 'agent/appr_c1' }) }
  })
  const r = await runGoverned(g)
  assert.strictEqual(r.ok, false)
  assert.deepStrictEqual(r.output.risks, ['workspace_revision_violation'],
    'the branch is still right and the worktree still clean — only HEAD gives it away')
})

test('I14. a test that changes the INDEX and then throws -> structural failure, not test_failed', async () => {
  let i = 0
  const g = governedWith({
    baseSha: APPROVED,
    sandboxState: () => { i++; return i <= 2 ? CLEAN_GOV() : Object.assign(CLEAN_GOV(), { indexFlagged: [{ tag: 'S', file: 'tracked.txt' }] }) },
    testRunner: async () => { throw new Error('harness exploded') }
  })
  const r = await runGoverned(g, workOrder({ allowedTestCommand: 'npm test' }))
  assert.strictEqual(r.ok, false)
  assert.deepStrictEqual(r.output.risks, ['workspace_index_violation'])
  assert.strictEqual(r.output.revisionMatch, true, 'B2 entry evidence survives')
  assert.strictEqual(g.audits.length, 1, 'the attempt is still audited')
})

test('I15. a revision mismatch at B2 ENTRY still stops OpenClaw before anything runs', async () => {
  const g = governed({ baseSha: MOVED })
  const r = await runGoverned(g)
  assert.strictEqual(r.error, 'revision_moved')
  assert.strictEqual(g.spy.transport, 0, 'the B2 gate is unchanged and still fires first')
  assert.strictEqual(r.output.revisionMatch, false)
})
