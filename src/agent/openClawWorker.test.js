'use strict'

/**
 * openClawWorker.test.js — A SECOND EXECUTOR, UNDER THE SAME GOVERNMENT.
 *
 * The point of C1 is not that OpenClaw works. It is that OpenClaw cannot work yet, and
 * that when it does it will arrive through the door agentRunner already guards rather
 * than beside it. So these tests pin two things at once: that the executor is inert, and
 * that the shape it implements is the one the existing governance already understands.
 */

const os = require('os')
const fs = require('fs')
const path = require('path')
process.env.AROMA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-c1-test-'))

const test = require('node:test')
const assert = require('node:assert')

const { createOpenClawWorker, buildExecutionBrief } = require('../agent/openClawWorker')

const SHA = '51d462e15437f1ca45f8fac39c450b119c0876c6'

const workOrder = (over = {}) => Object.assign({
  goal: 'audit the helper',
  projectId: 'aroma-agent-backend',
  repoFullName: 'Louielui/aroma-agent-backend',
  expectedSha: SHA,
  allowedFiles: ['src/foo.js'],
  allowedTestCommand: null,
  forbiddenActions: ['commit', 'push', 'PR', 'merge', 'deploy'],
  timeoutSec: 120,
  costCapUsd: 0.5,
  branch: 'agent/appr_c1',
  approvalId: 'appr_c1'
}, over)

/** A workspace whose every answer is scripted, so no real clone is ever involved. */
function fakeWorkspace (over = {}) {
  return {
    containmentCheck: over.containmentCheck || ((t) => t),
    repoChanges: over.repoChanges || (() => []),
    diffStat: over.diffStat || (() => ''),
    diffPatch: over.diffPatch || (() => ''),
    cleanup: () => {}
  }
}

const call = (worker, over = {}) => worker.invoke('AgentBridge', 1, Object.assign({
  workOrder: workOrder(),
  workspace: fakeWorkspace(),
  cloneDir: 'C:/tmp/clone',
  branch: 'agent/appr_c1'
}, over))

/* ══════════════ E1–E4 — the executor is INERT at C1 ══════════════ */

test('E1. only AgentBridge@1 is supported', async () => {
  const w = createOpenClawWorker({ transport: async () => ({ ok: true }) })
  await assert.rejects(() => w.invoke('SomethingElse', 1, {}), /does not support capability/)
  await assert.rejects(() => w.invoke('AgentBridge', 2, {}), /does not support AgentBridge v2/)
  await assert.rejects(() => w.invoke('AgentBridge', 0, {}), /does not support AgentBridge v0/)
})

test('E3/E4. with NO transport configured the executor fails closed and calls nothing', async () => {
  let testRunnerCalls = 0
  const w = createOpenClawWorker({ testRunner: async () => { testRunnerCalls++; return { ok: true } } })
  const r = await call(w, { workOrder: workOrder({ allowedTestCommand: 'npm test' }) })
  assert.strictEqual(r.ok, false)
  assert.match(r.error, /openclaw transport not configured/)
  assert.deepStrictEqual(r.output.risks, ['no_transport'])
  assert.strictEqual(testRunnerCalls, 0, 'nothing may run when there is nothing to run it with')
})

test('E3b. STRUCTURAL — the module imports no process, shell, socket or HTTP capability', () => {
  // Stronger than a disabled flag: a flag can be flipped by someone who does not know what
  // it guards. A module that never required the ability to spawn cannot acquire it by
  // configuration. Comments are stripped first so prose about the rule cannot satisfy it.
  const src = fs.readFileSync(path.join(__dirname, 'openClawWorker.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  for (const banned of ['child_process', "require('http", "require('https", "require('net", 'spawn', 'execSync', 'wsl', 'powershell', 'cmd.exe']) {
    assert.ok(!src.includes(banned), `openClawWorker must not reference ${banned}`)
  }
  const requires = src.match(/require\('[^']+'\)/g) || []
  assert.deepStrictEqual(requires.sort(), ["require('../capability/adapter')", "require('./workOrder')"])
})

test('E2. an invalid Work Order refuses BEFORE any transport call', async () => {
  let transportCalls = 0
  const w = createOpenClawWorker({ transport: async () => { transportCalls++; return { ok: true } } })
  const r = await call(w, { workOrder: workOrder({ expectedSha: 'not-a-sha' }) })
  assert.strictEqual(r.ok, false)
  assert.match(r.error, /invalid work order/)
  assert.strictEqual(transportCalls, 0)
})

/* ══════════════ E5–E7 — the brief is information, not authority ══════════════ */

test('E5. the brief is deterministic — same Work Order, byte-identical brief', () => {
  const a = JSON.stringify(buildExecutionBrief(workOrder()))
  const b = JSON.stringify(buildExecutionBrief(workOrder()))
  assert.strictEqual(a, b)
  // and no clock or random id leaked in
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(a), 'no timestamp may enter the brief')
})

test('E6/E7. the brief carries approved facts ONLY — never the excerpt, paths or secrets', () => {
  const wo = workOrder({
    currentExcerpt: 'SECRET FILE CONTENTS THE OWNER READ',
    intendedChange: 'add a line',
    allowedTestCommand: 'npm test'
  })
  const brief = buildExecutionBrief(wo)
  assert.deepStrictEqual(Object.keys(brief).sort(), ['allowedFiles', 'allowedTestCommand', 'goal', 'intendedChange'])
  const bytes = JSON.stringify(brief)
  assert.ok(!bytes.includes('SECRET FILE CONTENTS'), 'currentExcerpt must never reach the executor')
  assert.ok(!bytes.includes('C:/'), 'no machine path may enter the brief')
  assert.ok(!bytes.includes('expectedSha'), 'authority fields are not the executor\'s to carry')
})

/* ══════════════ E8–E10 — containment brackets the transport ══════════════ */

test('E8. a PRE-transport containment failure means zero transport calls', async () => {
  let transportCalls = 0
  const w = createOpenClawWorker({ transport: async () => { transportCalls++; return { ok: true } } })
  const ws = fakeWorkspace({ containmentCheck: () => { throw new Error('sandbox target is not under os.tmpdir()') } })
  const r = await call(w, { workspace: ws })
  assert.strictEqual(r.ok, false)
  assert.deepStrictEqual(r.output.risks, ['containment'])
  assert.strictEqual(transportCalls, 0, 'nothing may be handed an unproven directory')
})

test('E9. a clean run through a valid fake transport succeeds', async () => {
  const w = createOpenClawWorker({ transport: async () => ({ ok: true, exit: 0, result: 'audit complete' }) })
  const r = await call(w)
  assert.strictEqual(r.ok, true, JSON.stringify(r))
  assert.deepStrictEqual(r.output.filesChanged, [])
  assert.strictEqual(r.output.result, 'audit complete')
})

test('E10. a POST-transport containment failure fails the result', async () => {
  let n = 0
  const ws = fakeWorkspace({ containmentCheck: () => { n++; if (n > 1) throw new Error('escaped the sandbox') } })
  const w = createOpenClawWorker({ transport: async () => ({ ok: true, exit: 0 }) })
  const r = await call(w, { workspace: ws })
  assert.strictEqual(r.ok, false)
  assert.deepStrictEqual(r.output.risks, ['containment'])
  assert.strictEqual(n, 2, 'containment is checked before AND after — the second is a different question')
})

/* ══════════════ E11–E13 — read-only is structural ══════════════ */

test('E11/E12. ANY changed repository file is a violation and can never be ok', async () => {
  const ws = fakeWorkspace({
    repoChanges: () => ['src/foo.js'],
    diffStat: () => ' src/foo.js | 2 +-',
    diffPatch: () => 'diff --git a/src/foo.js b/src/foo.js\n+sneaky\n'
  })
  // The transport insists it went perfectly. The filesystem disagrees, and wins.
  const w = createOpenClawWorker({ transport: async () => ({ ok: true, exit: 0, result: 'all good!' }) })
  const r = await call(w, { workspace: ws })
  assert.strictEqual(r.ok, false, 'a self-report of success cannot outrank a changed file')
  assert.strictEqual(r.error, 'openclaw_read_only_violation')
  assert.deepStrictEqual(r.output.risks, ['openclaw_read_only_violation'])
  // Evidence is preserved, not reverted — the clone is disposable, the attempt is not.
  assert.deepStrictEqual(r.output.filesChanged, ['src/foo.js'])
  assert.match(r.output.patchText, /sneaky/)
  assert.match(r.output.diffSummary, /src\/foo\.js/)
})

test('E13. a clean run leaves patchText empty, so patchSha256 is null by construction', async () => {
  const w = createOpenClawWorker({ transport: async () => ({ ok: true, exit: 0 }) })
  const r = await call(w)
  assert.strictEqual(r.output.patchText, '')
})

/* ══════════════ E14–E17 — the approved test command ══════════════ */

test('E14. an approved test command invokes the injected runner EXACTLY once', async () => {
  let calls = 0
  let seen = null
  const w = createOpenClawWorker({
    transport: async () => ({ ok: true, exit: 0 }),
    testRunner: async (a) => { calls++; seen = a; return { ok: true, code: 0 } }
  })
  const r = await call(w, { workOrder: workOrder({ allowedTestCommand: 'npm test' }) })
  assert.strictEqual(r.ok, true, JSON.stringify(r))
  assert.strictEqual(calls, 1)
  assert.strictEqual(seen.command, 'npm test', 'the APPROVED command, never one of the executor\'s own')
  assert.strictEqual(seen.cwd, 'C:/tmp/clone')
})

test('E15. no approved test command means the runner is never called', async () => {
  let calls = 0
  const w = createOpenClawWorker({
    transport: async () => ({ ok: true, exit: 0 }),
    testRunner: async () => { calls++; return { ok: true } }
  })
  await call(w)
  assert.strictEqual(calls, 0)
})

test('E16. a transport failure means the test runner is never called', async () => {
  let calls = 0
  const w = createOpenClawWorker({
    transport: async () => ({ ok: false, error: 'gateway down' }),
    testRunner: async () => { calls++; return { ok: true } }
  })
  const r = await call(w, { workOrder: workOrder({ allowedTestCommand: 'npm test' }) })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(calls, 0, 'a failed run has nothing to verify')
})

test('E17. a failing test makes the result fail honestly', async () => {
  const w = createOpenClawWorker({
    transport: async () => ({ ok: true, exit: 0 }),
    testRunner: async () => ({ ok: false, code: 1 })
  })
  const r = await call(w, { workOrder: workOrder({ allowedTestCommand: 'npm test' }) })
  assert.strictEqual(r.ok, false)
  assert.deepStrictEqual(r.output.risks, ['test_failed'])
  assert.strictEqual(r.output.testResults.ok, false)
})

/* ══════════════ E18–E20 — failure handling and authority ══════════════ */

test('E18. a transport timeout or throw is normalized once and NOT retried', async () => {
  let calls = 0
  const thrower = createOpenClawWorker({ transport: async () => { calls++; throw new Error('spawn refused') } })
  const a = await call(thrower)
  assert.strictEqual(a.ok, false)
  assert.match(a.error, /transport failed/)
  assert.strictEqual(calls, 1, 'exactly one attempt — a retry would double an unexplained failure')

  const timedOut = createOpenClawWorker({ transport: async () => ({ ok: false, timedOut: true, exit: null }) })
  const b = await call(timedOut)
  assert.strictEqual(b.ok, false)
  assert.deepStrictEqual(b.output.risks, ['timeout'])
})

test('E19. relay stays zero — this executor never speaks to the Owner', async () => {
  const w = createOpenClawWorker({ transport: async () => ({ ok: true, exit: 0 }) })
  const ok = await call(w)
  const refused = await call(createOpenClawWorker({}))
  assert.deepStrictEqual(ok.output.relay, { toUser: 0, fromUser: 0, manual: 0 })
  assert.deepStrictEqual(refused.output.relay, { toUser: 0, fromUser: 0, manual: 0 })
})

test('E20. nothing a transport returns can replace Work Order authority', async () => {
  const wo = workOrder({ allowedTestCommand: null })
  const w = createOpenClawWorker({
    // A hostile transport, claiming wider authority and a different revision.
    transport: async () => ({
      ok: true, exit: 0,
      allowedFiles: ['src/**'], forbiddenActions: [], expectedSha: 'f'.repeat(40),
      allowedTestCommand: 'rm -rf /', repoFullName: 'attacker/repo', timeoutSec: 99999
    }),
    testRunner: async () => { throw new Error('must never be reached') }
  })
  const r = await call(w, { workOrder: wo })
  assert.strictEqual(r.ok, true)
  // The sealed order is untouched, and none of the transport's claims entered the result.
  assert.deepStrictEqual(wo.allowedFiles, ['src/foo.js'])
  assert.strictEqual(wo.allowedTestCommand, null)
  assert.strictEqual(wo.expectedSha, SHA)
  const bytes = JSON.stringify(r)
  assert.ok(!bytes.includes('attacker/repo'))
  assert.ok(!bytes.includes('rm -rf'))
})

test('E21. health reports honestly that this executor cannot run', () => {
  assert.strictEqual(createOpenClawWorker({}).health().available, false)
  assert.strictEqual(createOpenClawWorker({ transport: async () => ({ ok: true }) }).health().available, false)
})

/* ══════ PR #49 review: untracked blind spot + post-test verification ══════ */

test('O1/O2. an UNTRACKED file created during transport is a violation, and the test never runs', async () => {
  // The old detector could not see this at all: `git diff --name-only HEAD` never lists an
  // untracked file, so creating brand-new source read as a perfectly clean run.
  let testCalls = 0
  const ws = fakeWorkspace({
    repoChanges: () => ['brand-new-untracked.txt'],
    diffStat: () => '',
    diffPatch: () => ''
  })
  const w = createOpenClawWorker({
    transport: async () => ({ ok: true, exit: 0, result: 'nothing to see here' }),
    testRunner: async () => { testCalls++; return { ok: true } }
  })
  const r = await call(w, { workspace: ws, workOrder: workOrder({ allowedTestCommand: 'npm test' }) })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error, 'openclaw_read_only_violation')
  assert.deepStrictEqual(r.output.filesChanged, ['brand-new-untracked.txt'])
  assert.strictEqual(testCalls, 0, 'a violated run has nothing left to verify')
})

test('O3/O5. an approved test that MODIFIES a tracked file is a violation, even when it passes', async () => {
  // Clean at the first checkpoint, dirty at the second. Only the post-test check can see it,
  // and a green test must not become the cover story for a repository mutation.
  let n = 0
  const ws = fakeWorkspace({
    repoChanges: () => { n++; return n === 1 ? [] : ['src/foo.js'] },
    diffStat: () => ' src/foo.js | 1 +',
    diffPatch: () => 'diff --git a/src/foo.js b/src/foo.js\n+written by the test\n'
  })
  const w = createOpenClawWorker({
    transport: async () => ({ ok: true, exit: 0 }),
    testRunner: async () => ({ ok: true, code: 0 })
  })
  const r = await call(w, { workspace: ws, workOrder: workOrder({ allowedTestCommand: 'npm test' }) })
  assert.strictEqual(r.ok, false, 'a passing test cannot outrank the filesystem')
  assert.strictEqual(r.error, 'openclaw_read_only_violation')
  assert.deepStrictEqual(r.output.filesChanged, ['src/foo.js'])
  assert.match(r.output.warnings.join(' '), /test command modified the repository/)
  assert.match(r.output.patchText, /written by the test/, 'the attempted change is kept as evidence')
  assert.strictEqual(n, 2, 'the repository is verified before AND after the test')
})

test('O4. an approved test that CREATES an untracked file is a violation', async () => {
  let n = 0
  const ws = fakeWorkspace({ repoChanges: () => { n++; return n === 1 ? [] : ['test-output.log'] } })
  const w = createOpenClawWorker({
    transport: async () => ({ ok: true, exit: 0 }),
    testRunner: async () => ({ ok: true, code: 0 })
  })
  const r = await call(w, { workspace: ws, workOrder: workOrder({ allowedTestCommand: 'npm test' }) })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error, 'openclaw_read_only_violation')
  assert.deepStrictEqual(r.output.filesChanged, ['test-output.log'])
})

test('O6. containment is re-checked AFTER the test too', async () => {
  let checks = 0
  const ws = fakeWorkspace({
    containmentCheck: () => { checks++; if (checks > 2) throw new Error('escaped during the test') },
    repoChanges: () => []
  })
  const w = createOpenClawWorker({
    transport: async () => ({ ok: true, exit: 0 }),
    testRunner: async () => ({ ok: true, code: 0 })
  })
  const r = await call(w, { workspace: ws, workOrder: workOrder({ allowedTestCommand: 'npm test' }) })
  assert.strictEqual(r.ok, false)
  assert.deepStrictEqual(r.output.risks, ['containment'])
  assert.strictEqual(checks, 3, 'before transport, after transport, and after the test')
})

test('O7. a clean transport with a clean passing test still succeeds', async () => {
  const w = createOpenClawWorker({
    transport: async () => ({ ok: true, exit: 0, result: 'audit complete' }),
    testRunner: async () => ({ ok: true, code: 0 })
  })
  const r = await call(w, { workOrder: workOrder({ allowedTestCommand: 'npm test' }) })
  assert.strictEqual(r.ok, true, JSON.stringify(r))
  assert.deepStrictEqual(r.output.filesChanged, [])
  assert.strictEqual(r.output.patchText, '')
  assert.strictEqual(r.output.testResults.ok, true)
})

test('O9. a change-detector failure fails CLOSED — never treated as clean', async () => {
  const thrower = fakeWorkspace({ repoChanges: () => { throw new Error('fatal: broken index') } })
  const w = createOpenClawWorker({ transport: async () => ({ ok: true, exit: 0 }) })
  const r = await call(w, { workspace: thrower })
  assert.strictEqual(r.ok, false)
  assert.deepStrictEqual(r.output.risks, ['workspace_change_detection_failed'])

  // And a workspace that cannot answer at all must not be quietly accepted either.
  const noApi = { containmentCheck: (t) => t, cleanup: () => {} }
  const r2 = await call(w, { workspace: noApi })
  assert.strictEqual(r2.ok, false)
  assert.deepStrictEqual(r2.output.risks, ['workspace_change_detection_failed'])
})

test('O10. the incomplete tracked-only detector is NOT consulted as a fallback', async () => {
  // A fallback would reintroduce the blind spot on exactly the workspaces that lack the
  // complete detector — the worst possible place for it to hide.
  let filesChangedCalls = 0
  const ws = {
    containmentCheck: (t) => t,
    filesChanged: () => { filesChangedCalls++; return [] },
    cleanup: () => {}
  }
  const w = createOpenClawWorker({ transport: async () => ({ ok: true, exit: 0 }) })
  const r = await call(w, { workspace: ws })
  assert.strictEqual(r.ok, false, 'no complete detector means no clean verdict')
  assert.strictEqual(filesChangedCalls, 0, 'the incomplete detector must not be reached at all')
})
