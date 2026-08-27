'use strict'

/**
 * executionRevisionGate.test.js — THE CLONE MUST START WHERE THE OWNER LOOKED.
 *
 * ── WHAT B2-A COULD NOT DO ──────────────────────────────────────────────────
 * B2-A proved WHAT the Owner approved: a commit, and an excerpt read from that commit. It
 * cannot prove what the EXECUTION starts from, because the clone does not exist yet at
 * approval time — it is made later, from whatever the repository has become since.
 *
 * So the approved revision is compared against the clone's OWN measured base, before any
 * worker runs and before any file is touched.
 *
 * ── WHY A MISMATCH IS TERMINAL ──────────────────────────────────────────────
 * It is not a race to recover from. A mismatch means the Owner approved a different
 * revision than the one about to be edited — the excerpt on his card described other bytes.
 * Rebasing, refreshing, retrying, or writing the observed sha back into the sealed order
 * would each silently move what he agreed to. Only a NEW Work Order may continue.
 */

const os = require('os')
const fs = require('fs')
const path = require('path')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-b2b-test-'))

const test = require('node:test')
const assert = require('node:assert')
const crypto = require('node:crypto')

const { createAgentRunner } = require('../agent/agentRunner')
const { createFeatureBranchWorkspace } = require('../agent/featureBranchWorkspace')
const { createAuditLog } = require('../agent/audit')
const { hashWorkOrder } = require('../agent/workOrder')

const APPROVED = 'd05527e49d2092fdf82e74efe4d96f203fcd80e9'
const MOVED = 'cdb3a5f57db464dca61833c7e14c310338518ad7'
const IDENTITY = { projectId: 'aroma-agent-backend', repoFullName: 'Louielui/aroma-agent-backend' }

const workOrder = (over = {}) => Object.assign({
  goal: 'tidy one helper',
  projectId: IDENTITY.projectId,
  repoFullName: IDENTITY.repoFullName,
  expectedSha: APPROVED,
  allowedFiles: ['src/foo.js'],
  allowedTestCommand: null,
  forbiddenActions: ['commit', 'push', 'PR', 'merge', 'deploy'],
  timeoutSec: 120,
  costCapUsd: 0.5,
  branch: 'agent/appr_b2b',
  approvalId: 'appr_b2b'
}, over)

/** Counts every side effect the gate is supposed to prevent. */
function harness (over = {}) {
  const calls = { prepare: 0, invoke: 0, patchWrites: 0, cleanup: 0, git: [] }
  const audits = []

  const worker = {
    invoke: async () => {
      calls.invoke++
      if (over.workerThrows) throw new Error('boom')
      return Object.assign({
        ok: true,
        output: {
          risks: [], warnings: [], branch: 'agent/appr_b2b',
          filesChanged: ['src/foo.js'], diffSummary: ' src/foo.js | 1 +',
          testResults: null, exit: 0,
          patchText: over.patchText !== undefined ? over.patchText : 'diff --git a/src/foo.js\n+x\n'
        }
      }, over.workerResult || {})
    }
  }

  const workspace = over.workspace || {
    prepare: () => {
      calls.prepare++
      return { dir: 'C:/tmp/clone', branch: 'agent/appr_b2b', baseSha: over.baseSha || APPROVED }
    },
    cleanup: () => { calls.cleanup++ }
  }

  const runner = createAgentRunner({
    repoRoot: process.cwd(),
    projectId: IDENTITY.projectId,
    repoFullName: IDENTITY.repoFullName,
    worker,
    workspace,
    auditLog: { append: (r) => { audits.push(r) } },
    writePatch: (id, text) => { calls.patchWrites++; return over.patchWriteFails ? { ok: false, reason: 'write_failed' } : { ok: true, path: 'C:/tmp/p.patch', bytes: text.length } },
    checkCredentials: () => ({ canRun: true, state: 'ok', warning: null, refusal: null, refreshExpiresAt: null, daysLeft: 9, accessTokenValid: true, subscription: 'x' })
  })

  return { runner, calls, audits }
}

const run = async (h, wo) => { const o = wo || workOrder(); return h.runner.run({ workOrder: o, who: 'louie', approvedHash: hashWorkOrder(o) }) }

/* ══════════ A / B — the workspace measures its own base ══════════ */

test('A. prepare() returns baseSha measured from the CLONE head', () => {
  const seen = []
  const git = (args, cwd) => {
    seen.push({ j: args.join(' '), cwd })
    if (args[0] === 'remote') return { status: 0, stdout: '', stderr: '' }
    if (args.join(' ') === 'rev-parse HEAD') return { status: 0, stdout: APPROVED + '\n', stderr: '' }
    if (args.join(' ').startsWith('rev-parse --abbrev-ref')) return { status: 0, stdout: 'agent/appr_1\n', stderr: '' }
    return { status: 0, stdout: '', stderr: '' }
  }
  const ws = createFeatureBranchWorkspace({ repoRoot: process.cwd(), gitRunner: git })
  const prepared = ws.prepare('appr_1')
  assert.strictEqual(prepared.baseSha, APPROVED)

  // Measured INSIDE the clone. A rev-parse run in the live repo would answer a different
  // question — where the source is now — and would agree with itself even after a move.
  const headCall = seen.find((c) => c.j === 'rev-parse HEAD')
  assert.ok(headCall, 'prepare must ask the clone for its HEAD')
  assert.strictEqual(headCall.cwd, prepared.dir, 'baseSha must come from the clone, not the live repo')
  fs.rmSync(prepared.dir, { recursive: true, force: true })
})

test('B. an unreadable or malformed clone HEAD fails prepare() closed', () => {
  const mk = (headOut) => createFeatureBranchWorkspace({
    repoRoot: process.cwd(),
    gitRunner: (args) => {
      if (args[0] === 'remote') return { status: 0, stdout: '', stderr: '' }
      if (args.join(' ') === 'rev-parse HEAD') return headOut
      if (args.join(' ').startsWith('rev-parse --abbrev-ref')) return { status: 0, stdout: 'agent/appr_1\n', stderr: '' }
      return { status: 0, stdout: '', stderr: '' }
    }
  })
  assert.throws(() => mk({ status: 1, stdout: '', stderr: 'fatal' }).prepare('appr_1'), /clone HEAD unreadable/)
  assert.throws(() => mk({ status: 0, stdout: 'not-a-sha\n', stderr: '' }).prepare('appr_1'), /not a full commit sha/)
  assert.throws(() => mk({ status: 0, stdout: '\n', stderr: '' }).prepare('appr_1'), /not a full commit sha/)
  assert.throws(() => mk({ status: 0, stdout: APPROVED.toUpperCase() + '\n', stderr: '' }).prepare('appr_1'), /not a full commit sha/)
})

/* ══════════ C — a matching revision may run ══════════ */

test('C. expectedSha === observedBaseSha: the worker runs', async () => {
  const h = harness({ baseSha: APPROVED })
  const r = await run(h)
  assert.strictEqual(r.ok, true, JSON.stringify(r))
  assert.strictEqual(h.calls.invoke, 1)
})

/* ══════════ D–H — a mismatch is terminal ══════════ */

test('D. expectedSha !== observedBaseSha: the run fails with revision_moved', async () => {
  const h = harness({ baseSha: MOVED })
  const r = await run(h)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error, 'revision_moved')
  // ONE authority location: output, the same place a matched run puts them and the only
  // place agentResultView reads. Top-level copies are what lost this evidence downstream.
  assert.strictEqual(r.output.expectedSha, APPROVED)
  assert.strictEqual(r.output.observedBaseSha, MOVED)
  assert.strictEqual(r.output.revisionMatch, false)
  for (const f of ['expectedSha', 'observedBaseSha', 'revisionMatch']) {
    assert.ok(!(f in r), `${f} must not be duplicated at result top level`)
  }
})

test('E. a mismatch invokes the worker exactly ZERO times', async () => {
  const h = harness({ baseSha: MOVED })
  await run(h)
  assert.strictEqual(h.calls.invoke, 0, 'no worker may see a workspace at the wrong revision')
})

test('G. a mismatch writes no patch', async () => {
  const h = harness({ baseSha: MOVED })
  await run(h)
  assert.strictEqual(h.calls.patchWrites, 0, 'nothing was produced, so nothing may be written')
})

test('H. a mismatch does not rebase, fetch, refresh or retry — and cleans up', async () => {
  const gitCalls = []
  const h = harness({
    workspace: {
      prepare: () => ({ dir: 'C:/tmp/clone', branch: 'agent/appr_b2b', baseSha: MOVED }),
      cleanup: () => { gitCalls.push('cleanup') },
      // If the runner ever tried to repair the situation it would need one of these.
      fetch: () => { gitCalls.push('fetch') },
      rebase: () => { gitCalls.push('rebase') }
    }
  })
  const r = await run(h)
  assert.strictEqual(r.error, 'revision_moved')
  assert.ok(!gitCalls.includes('fetch'), 'no refresh may be attempted')
  assert.ok(!gitCalls.includes('rebase'), 'no rebase may be attempted')
  assert.ok(gitCalls.includes('cleanup'), 'the refused workspace is still removed')
  assert.strictEqual(h.calls.invoke, 0)
})

test('H2. the sealed Work Order is NOT mutated by a mismatch', async () => {
  const wo = workOrder()
  const before = JSON.stringify(wo)
  await run(harness({ baseSha: MOVED }), wo)
  assert.strictEqual(JSON.stringify(wo), before, 'the observed sha must never be written into the order')
  assert.strictEqual(wo.expectedSha, APPROVED)
})

/* ══════════ I / J / K / L — the record ══════════ */

test('I. the mismatch audit carries BOTH shas and revisionMatch=false', async () => {
  const h = harness({ baseSha: MOVED })
  await run(h)
  assert.strictEqual(h.audits.length, 1)
  const a = h.audits[0]
  assert.strictEqual(a.expectedSha, APPROVED)
  assert.strictEqual(a.observedBaseSha, MOVED)
  assert.strictEqual(a.revisionMatch, false)
})

test('J. a matched successful run records both shas and revisionMatch=true', async () => {
  const h = harness({ baseSha: APPROVED })
  const r = await run(h)
  assert.strictEqual(r.output.expectedSha, APPROVED)
  assert.strictEqual(r.output.observedBaseSha, APPROVED)
  assert.strictEqual(r.output.revisionMatch, true)
})

test('K. a matched run whose WORKER FAILS still records revisionMatch=true', async () => {
  // Revision identity and worker success are separate facts. A failed run that verified its
  // revision must not read as one that never did.
  const h = harness({ baseSha: APPROVED, workerThrows: true })
  const r = await run(h)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.output.revisionMatch, true)
  assert.strictEqual(r.output.observedBaseSha, APPROVED)
})

test('L. the matched-run audit carries the same revision facts', async () => {
  const h = harness({ baseSha: APPROVED })
  await run(h)
  const a = h.audits[0]
  assert.strictEqual(a.expectedSha, APPROVED)
  assert.strictEqual(a.observedBaseSha, APPROVED)
  assert.strictEqual(a.revisionMatch, true)
})

test('L2. a failure BEFORE the clone existed records no invented sha', async () => {
  const h = harness({ workspace: { prepare: () => { throw new Error('no space') }, cleanup: () => {} } })
  await run(h)
  const a = h.audits[0]
  // Nothing is passed at all — and Q2 proves the real record turns that absence into null.
  assert.ok(a.expectedSha == null, 'an absent fact is never back-filled')
  assert.ok(a.observedBaseSha == null)
  assert.ok(a.revisionMatch == null)
})

/* ══════════ M–Q — patch identity ══════════ */

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex')

test('M. patchSha256 is the sha256 of the EXACT patch text', async () => {
  const text = 'diff --git a/src/foo.js b/src/foo.js\n+one\n'
  const h = harness({ baseSha: APPROVED, patchText: text })
  const r = await run(h)
  assert.strictEqual(r.output.patchSha256, sha256(text))
  assert.match(r.output.patchSha256, /^[0-9a-f]{64}$/)
})

test('N. a LINE-ENDING change alters patchSha256 — nothing is normalized', async () => {
  const lf = 'diff --git a/x b/x\n+one\n'
  const crlf = 'diff --git a/x b/x\r\n+one\r\n'
  const a = await run(harness({ baseSha: APPROVED, patchText: lf }))
  const b = await run(harness({ baseSha: APPROVED, patchText: crlf }))
  assert.notStrictEqual(a.output.patchSha256, b.output.patchSha256,
    'normalizing here would let two different patches share one identity')
  assert.strictEqual(b.output.patchSha256, sha256(crlf))
})

test('O. an empty / no-change patch has patchSha256 = null', async () => {
  const r = await run(harness({ baseSha: APPROVED, patchText: '' }))
  assert.strictEqual(r.output.patchSha256, null, "'no change' must not look like 'not recorded'")
})

test('P. a patch WRITE FAILURE still keeps the digest of what the worker produced', async () => {
  const text = 'diff --git a/x b/x\n+one\n'
  const h = harness({ baseSha: APPROVED, patchText: text, patchWriteFails: true })
  const r = await run(h)
  assert.strictEqual(r.output.patchSha256, sha256(text), 'the patch existed even though storing it failed')
  assert.strictEqual(r.output.patchStatus, 'write_failed', 'patchStatus already says it was not persisted')
})

test('Q. the audit records the DIGEST and never the raw patch', async () => {
  const text = 'diff --git a/secret.js b/secret.js\n+VERY-DISTINCTIVE-SOURCE-LINE\n'
  const h = harness({ baseSha: APPROVED, patchText: text })
  await run(h)
  const a = h.audits[0]
  assert.strictEqual(a.patchSha256, sha256(text))
  const serialized = JSON.stringify(a)
  assert.ok(!serialized.includes('VERY-DISTINCTIVE-SOURCE-LINE'), 'raw patch text must never enter the audit')
  assert.ok(!serialized.includes('patchText'), 'no patchText field may survive into the record')
})

test('Q2. the real audit record persists the revision fields at top level', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-b2b-audit-'))
  const written = []
  const log = createAuditLog({ artifactStore: { write: (name, body) => { written.push({ name, body }); return { path: path.join(dir, name) } } } })
  log.append({
    approvalId: 'appr_x', runId: null, workOrderHash: 'h', who: 'louie',
    result: { ok: false, output: {} }, durationMs: 5,
    projectId: IDENTITY.projectId, repoFullName: IDENTITY.repoFullName,
    expectedSha: APPROVED, observedBaseSha: MOVED, revisionMatch: false, patchSha256: null
  })
  const rec = written[0].body
  assert.strictEqual(rec.expectedSha, APPROVED)
  assert.strictEqual(rec.observedBaseSha, MOVED)
  assert.strictEqual(rec.revisionMatch, false)
  assert.ok('patchSha256' in rec)
})

/* ══════════ R — the field that must never exist ══════════ */

test('R. no endSha is introduced', async () => {
  const r = await run(harness({ baseSha: APPROVED }))
  assert.ok(!('endSha' in r.output), 'a clone HEAD does not move during a run; endSha would be noise wearing evidence')
})

/* ══════════ PR #48 review: evidence must survive the whole read path ══════════ */

const { buildAgentResultView } = require('../agent/agentResultView')
const { createAgentBridgeWorker } = require('../agent/agentBridgeWorker')
const { createOwnerApprovalStore } = require('../agent/ownerApprovalStore')

const viewOf = (result) => buildAgentResultView({
  result,
  approvalId: 'appr_b2b',
  facts: { allowedFiles: ['src/foo.js'], allowedTestCommand: null, timeoutSec: 120, costCapUsd: 0.5, branch: 'agent/appr_b2b' }
})

test('V1. the view preserves MISMATCH revision evidence', async () => {
  const r = await run(harness({ baseSha: MOVED }))
  const v = viewOf(r)
  assert.strictEqual(v.revision.expectedSha, APPROVED)
  assert.strictEqual(v.revision.observedBaseSha, MOVED)
  assert.strictEqual(v.revision.revisionMatch, false, 'false is a FACT and must not collapse into absent')
})

test('V2. the view preserves MATCHED revision evidence and the patch digest', async () => {
  const text = 'diff --git a/x b/x\n+one\n'
  const r = await run(harness({ baseSha: APPROVED, patchText: text }))
  const v = viewOf(r)
  assert.strictEqual(v.revision.expectedSha, APPROVED)
  assert.strictEqual(v.revision.observedBaseSha, APPROVED)
  assert.strictEqual(v.revision.revisionMatch, true)
  assert.strictEqual(v.revision.patchSha256, sha256(text))
})

test('V3. a failure BEFORE the clone projects null evidence — never an invented sha', async () => {
  const r = await run(harness({ workspace: { prepare: () => { throw new Error('no space') }, cleanup: () => {} } }))
  const v = viewOf(r)
  assert.strictEqual(v.revision.expectedSha, null)
  assert.strictEqual(v.revision.observedBaseSha, null)
  assert.strictEqual(v.revision.revisionMatch, null, 'unknown must not read as "did not match"')
})

test('V4. the view reads ONLY output — a top-level copy is not a fallback', async () => {
  // If someone moves the fields back to the top level, the view must go blind rather than
  // quietly keep working from a second location. Two authorities is the defect itself.
  const forged = { ok: false, error: 'revision_moved', expectedSha: APPROVED, observedBaseSha: MOVED, revisionMatch: false, output: { risks: ['revision_moved'], warnings: [] } }
  const v = viewOf(forged)
  assert.strictEqual(v.revision.expectedSha, null)
  assert.strictEqual(v.revision.observedBaseSha, null)
  assert.strictEqual(v.revision.revisionMatch, null)
})

test('S1. STORAGE ROUND TRIP — runner -> recordResult -> getResult -> view (mismatch)', async () => {
  const store = createOwnerApprovalStore()
  const r = await run(harness({ baseSha: MOVED }))
  store.recordExecutionStart('appr_b2b', { who: 'louie' })
  store.recordResult('appr_b2b', r)
  const stored = store.getResult('appr_b2b')
  assert.strictEqual(stored.ok, true, JSON.stringify(stored))
  const v = viewOf(stored.record.result)
  assert.strictEqual(v.revision.expectedSha, APPROVED, 'the approved sha must survive storage')
  assert.strictEqual(v.revision.observedBaseSha, MOVED, 'the clone sha must survive storage')
  assert.strictEqual(v.revision.revisionMatch, false)
})

test('S2. STORAGE ROUND TRIP — matched run keeps revisionMatch=true', async () => {
  const store = createOwnerApprovalStore()
  const r = await run(harness({ baseSha: APPROVED }))
  store.recordExecutionStart('appr_b2b', { who: 'louie' })
  store.recordResult('appr_b2b', r)
  const stored = store.getResult('appr_b2b')
  assert.strictEqual(stored.ok, true, JSON.stringify(stored))
  const v = viewOf(stored.record.result)
  assert.strictEqual(v.revision.revisionMatch, true)
  assert.strictEqual(v.revision.observedBaseSha, APPROVED)
})

test('W1. REAL worker machinery: a mismatch never starts a process or the approved test', async () => {
  // The previous version counted a `calls.test` that no production path ever incremented —
  // a dead counter presented as evidence. This builds the REAL AgentBridge worker with both
  // of its injected execution seams spied, and an order carrying a real allowedTestCommand,
  // so the assertion is about machinery that could actually run.
  let processCalls = 0
  let testCalls = 0
  const worker = createAgentBridgeWorker({
    command: 'C:/fake/claude.exe',
    runner: async () => { processCalls++; return { code: 0, stdout: '', stderr: '', timedOut: false } },
    testRunner: async () => { testCalls++; return { ok: true, code: 0, stdout: '', stderr: '' } }
  })

  let patchWrites = 0
  const runner = createAgentRunner({
    repoRoot: process.cwd(),
    projectId: IDENTITY.projectId,
    repoFullName: IDENTITY.repoFullName,
    worker,
    workspace: { prepare: () => ({ dir: 'C:/tmp/clone', branch: 'agent/appr_b2b', baseSha: MOVED }), cleanup: () => {} },
    auditLog: { append: () => {} },
    writePatch: () => { patchWrites++; return { ok: true, path: 'p', bytes: 1 } },
    checkCredentials: () => ({ canRun: true, state: 'ok', warning: null, refusal: null, refreshExpiresAt: null, daysLeft: 9, accessTokenValid: true, subscription: 'x' })
  })

  const wo = workOrder({ allowedTestCommand: 'npm test' })
  const r = await runner.run({ workOrder: wo, who: 'louie', approvedHash: hashWorkOrder(wo) })

  assert.strictEqual(r.error, 'revision_moved')
  assert.strictEqual(processCalls, 0, 'no CLI process may be spawned after a revision mismatch')
  assert.strictEqual(testCalls, 0, 'the APPROVED test command must not run after a revision mismatch')
  assert.strictEqual(patchWrites, 0)
})

test('W2. the same real machinery DOES run when the revision matches', async () => {
  // Without this, W1 would pass just as well if the worker were broken or unreachable.
  let processCalls = 0
  const worker = createAgentBridgeWorker({
    command: 'C:/fake/claude.exe',
    runner: async () => { processCalls++; return { code: 0, stdout: '', stderr: '', timedOut: false } },
    testRunner: async () => ({ ok: true, code: 0, stdout: '', stderr: '' })
  })
  const runner = createAgentRunner({
    repoRoot: process.cwd(),
    projectId: IDENTITY.projectId,
    repoFullName: IDENTITY.repoFullName,
    worker,
    workspace: {
      prepare: () => ({ dir: 'C:/tmp/clone', branch: 'agent/appr_b2b', baseSha: APPROVED }),
      containmentCheck: (t) => t, permissionMode: () => 'acceptEdits',
      filesChanged: () => [], diffStat: () => '', diffPatch: () => '',
      remotes: () => [], currentBranch: () => 'agent/appr_b2b', cleanup: () => {}
    },
    auditLog: { append: () => {} },
    writePatch: () => ({ ok: true, path: 'p', bytes: 1 }),
    checkCredentials: () => ({ canRun: true, state: 'ok', warning: null, refusal: null, refreshExpiresAt: null, daysLeft: 9, accessTokenValid: true, subscription: 'x' })
  })
  const wo = workOrder()
  await runner.run({ workOrder: wo, who: 'louie', approvedHash: hashWorkOrder(wo) })
  assert.ok(processCalls > 0, 'the spy must be reachable, or W1 proves nothing')
})
