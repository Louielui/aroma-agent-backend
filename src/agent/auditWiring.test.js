'use strict'

/**
 * auditWiring.test.js — CAP 7 must hold in PRODUCTION, not only in tests.
 *
 * THE BUG THIS EXISTS TO PREVENT. app.js handed the agent runner
 * `opts.workerDeps && opts.workerDeps.artifactStore` — the INJECTED deps, which are
 * undefined in the real assembly. The real workerDeps (and its artifact store) were only
 * built ~60 lines later. So in production artifactStore was undefined, the runner's
 * auditLog was null, and the FIRST REAL CANARY executed with no audit record at all.
 *
 * Every existing Cap 7 test passed throughout, because every one of them injects an
 * artifactStore. That is the failure mode these tests are written against: green in the
 * suite, absent in production. So the assertions below run against the REAL composition
 * root — createApp with no injected agentRunner and no injected workerDeps — and the
 * end-to-end one writes and reads a real file through the real store.
 *
 * AROMA_ARTIFACT_DIR is redirected to a temp dir so nothing touches the repo's .aroma.
 * No paid call: the agent runner's audited refusal paths never spawn anything.
 */

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { MUST_FORBID, hashWorkOrder } = require('./workOrder')
const { createAgentRunner } = require('./agentRunner')

const APP_OPTS = { runPersistence: false, proposalPersistence: false, serviceToken: 'audit-wiring-test' }

const ORDER = Object.freeze({
  goal: 'canary',
  projectId: 'aroma-agent-backend',
  repoFullName: 'Louielui/aroma-agent-backend',
  expectedSha: 'd05527e49d2092fdf82e74efe4d96f203fcd80e9',
  allowedFiles: ['docs/canary/agent-canary.md'],
  allowedTestCommand: null,
  forbiddenActions: [...MUST_FORBID],
  timeoutSec: 120,
  costCapUsd: 0.5,
  branch: 'agent/appr_wiring',
  approvalId: 'appr_wiring'
})

/**
 * Run fn with AROMA_ARTIFACT_DIR pointed at a fresh temp dir, then clean up.
 * ASYNC AND AWAITED — a sync wrapper around an async body would run its `finally` (and
 * delete the temp dir) the moment fn returned its promise, i.e. before anything had been
 * written into it. createApp reads the env at call time, so setting it here is enough.
 */
async function withTempArtifactDir (fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-audit-wiring-'))
  const savedDir = process.env.AROMA_ARTIFACT_DIR
  const savedFlag = process.env.AGENT_BRIDGE
  process.env.AROMA_ARTIFACT_DIR = dir
  process.env.AGENT_BRIDGE = 'on'
  const { createApp } = require('../app')
  try {
    return await fn({ dir, createApp })
  } finally {
    if (savedDir === undefined) delete process.env.AROMA_ARTIFACT_DIR; else process.env.AROMA_ARTIFACT_DIR = savedDir
    if (savedFlag === undefined) delete process.env.AGENT_BRIDGE; else process.env.AGENT_BRIDGE = savedFlag
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const auditFiles = (dir) => {
  const d = path.join(dir, 'agent-audit')
  return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.json')) : []
}

/* ── the regression itself ────────────────────────────────────────────────── */

test('THE REAL composition root builds a runner WITH an audit store', async () => {
  await withTempArtifactDir(({ createApp }) => {
    // No injected agentRunner. No injected workerDeps. This is production assembly.
    const app = createApp(APP_OPTS)
    assert.equal(app.agentRunnerConfigured, true, 'the runner is constructed with the flag on')
    assert.equal(app.agentRunner.auditConfigured, true,
      'CAP 7: the REAL runner must have an audit log — this is the assertion the canary needed')
  })
})

test('the runner and the sandbox worker share ONE artifact store instance', async () => {
  await withTempArtifactDir(({ createApp }) => {
    const app = createApp(APP_OPTS)
    assert.ok(app.artifactStore, 'the composition root exposes the store it built')
    assert.equal(app.locals.workerDeps.artifactStore, app.artifactStore,
      'the sandbox worker writes to the same store the agent audits into, so the read endpoints see both')
  })
})

test('END TO END: a refused run writes a REAL audit file through the REAL store', async () => {
  await withTempArtifactDir(async ({ dir, createApp }) => {
    const app = createApp(APP_OPTS)
    assert.deepEqual(auditFiles(dir), [], 'nothing written yet')

    // A hash mismatch is refused BEFORE any workspace or process work — so this exercises
    // the real audit path with zero fakes and zero spawning.
    const res = await app.agentRunner.run({ workOrder: ORDER, approvedHash: 'not-the-right-hash', who: 'louie' })
    assert.equal(res.ok, false)
    assert.equal(res.error, 'hash_mismatch')

    const files = auditFiles(dir)
    assert.equal(files.length, 1, 'exactly one audit record was written by the REAL wiring')
    const rec = JSON.parse(fs.readFileSync(path.join(dir, 'agent-audit', files[0]), 'utf8'))
    assert.equal(rec.kind, 'agent-audit')
    assert.equal(rec.approvalId, 'appr_wiring')
    assert.equal(rec.workOrderHash, hashWorkOrder(ORDER))
    assert.equal(rec.who, 'louie')
    assert.equal(rec.ok, false)
    assert.deepEqual(rec.risks, ['hash_mismatch'])
    // and it carries no content it should not
    const blob = JSON.stringify(rec)
    assert.ok(!/sk-|HUB_TOKEN|Bearer|currentExcerpt|goal/i.test(blob), 'the audit record carries no secret or content')
  })
})

test('BOTH outcomes are audited — success and failure — through the real store', async () => {
  await withTempArtifactDir(async ({ dir, createApp }) => {
    // The real store, taken from the real composition root. Only the workspace and worker
    // are faked, because a genuine success would clone the repo and spawn the CLI; the
    // thing under test is the AUDIT WIRING, which is real here.
    const app = createApp(APP_OPTS)
    const realStore = app.artifactStore

    const okWorkspace = {
      containmentCheck: (d) => d,
      permissionMode: () => 'acceptEdits',
      filesChanged: () => ['docs/canary/agent-canary.md'],
      diffStat: () => ' 1 file changed',
      remotes: () => [],
      currentBranch: () => 'agent/appr_wiring',
      prepare: () => ({ dir: '/tmp/clone', branch: 'agent/appr_wiring' }),
      cleanup: () => {}
    }
    const runner = createAgentRunner({ projectId: 'aroma-agent-backend', repoFullName: 'Louielui/aroma-agent-backend', checkCredentials: () => ({ canRun: true, state: 'ok', refusal: null, warning: null, refreshExpiresAt: null, daysLeft: null, accessTokenValid: true, subscription: null }), writePatch: () => ({ ok: false, reason: 'no_changes' }),
      repoRoot: process.cwd(),
      artifactStore: realStore, // ← the REAL one
      workspace: okWorkspace,
      worker: {
        invoke: async () => ({
          ok: true, cost: 0.01, latencyMs: 1200,
          output: { filesChanged: ['docs/canary/agent-canary.md'], diffSummary: ' 1 file changed', exit: 0, risks: [], warnings: [], branch: 'agent/appr_wiring' }
        })
      }
    })
    assert.equal(runner.auditConfigured, true)

    const ok = await runner.run({ workOrder: ORDER, approvedHash: hashWorkOrder(ORDER), who: 'louie' })
    assert.equal(ok.ok, true, 'the success path ran')

    const failing = createAgentRunner({ projectId: 'aroma-agent-backend', repoFullName: 'Louielui/aroma-agent-backend', checkCredentials: () => ({ canRun: true, state: 'ok', refusal: null, warning: null, refreshExpiresAt: null, daysLeft: null, accessTokenValid: true, subscription: null }), writePatch: () => ({ ok: false, reason: 'no_changes' }),
      repoRoot: process.cwd(),
      artifactStore: realStore,
      workspace: okWorkspace,
      worker: { invoke: async () => { throw new Error('worker exploded') } }
    })
    const bad = await failing.run({ workOrder: ORDER, approvedHash: hashWorkOrder(ORDER), who: 'louie' })
    assert.equal(bad.ok, false, 'the failure path ran')

    const files = auditFiles(dir)
    assert.equal(files.length, 2, 'ONE record per attempt — success AND failure')
    const recs = files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, 'agent-audit', f), 'utf8')))
    assert.deepEqual(recs.map((r) => r.ok).sort(), [false, true], 'both outcomes recorded')
    for (const r of recs) {
      assert.equal(r.approvalId, 'appr_wiring')
      assert.equal(r.workOrderHash, hashWorkOrder(ORDER))
    }
  })
})

test('an INJECTED workerDeps still wins, so tests and fakes are unaffected', async () => {
  await withTempArtifactDir(({ createApp }) => {
    const fake = { artifactStore: null, runner: null }
    const app = createApp(Object.assign({}, APP_OPTS, { workerDeps: fake }))
    assert.equal(app.locals.workerDeps, fake, 'the injected deps are used verbatim')
    assert.equal(app.artifactStore, null, 'and its (null) store is what the runner got')
    assert.equal(app.agentAuditConfigured, false, 'which a test may legitimately choose')
  })
})

test('with AGENT_BRIDGE OFF nothing is constructed and nothing is audited', () => {
  const saved = process.env.AGENT_BRIDGE
  delete process.env.AGENT_BRIDGE
  try {
    const { createApp } = require('../app')
    const app = createApp(APP_OPTS)
    assert.equal(app.agentRunnerConfigured, false)
    assert.equal(app.agentRunner, null)
    assert.equal(app.agentAuditConfigured, false)
  } finally {
    if (saved === undefined) delete process.env.AGENT_BRIDGE; else process.env.AGENT_BRIDGE = saved
  }
})
