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

const OPENCLAW_CAPS = [
  'openclaw_repo_audit', 'openclaw_code_review', 'openclaw_test_run',
  'openclaw_log_inspection', 'openclaw_web_research', 'openclaw_document_analysis'
]

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

test('R5/R6. all six capabilities are present and globally unique after normalization', () => {
  const w = getWorker('openclaw')
  for (const c of OPENCLAW_CAPS) assert.ok(w.capabilities.includes(c), `${c} must be declared`)
  assert.strictEqual(w.capabilities.length, OPENCLAW_CAPS.length)

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
function governed (over = {}) {
  const spy = { transport: 0, cleanup: 0 }
  const audits = []
  const worker = createOpenClawWorker({
    transport: async () => { spy.transport++; return { ok: true, exit: 0, result: 'audit complete' } },
    testRunner: async () => ({ ok: true, code: 0 })
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
  const g = governed({ baseSha: APPROVED, filesChanged: () => ['src/foo.js'] })
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
