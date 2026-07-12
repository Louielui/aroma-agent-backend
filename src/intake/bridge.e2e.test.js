'use strict'

/**
 * bridge.e2e.test.js — B2-7 REAL, PAID, unattended full-chain E2E.
 *
 * Proves (not infers) the entire bridge chain end to end:
 *   intake Task → promote → Proposal(linkState=ready) → confirm → scheduleWorker
 *   → real `claude -p` in a TmpdirSandbox → Execution Artifact → Result Artifact
 *   → Result Read API → provenance traces back to sourceTaskId + confirmation.
 *
 * DOUBLE-GATED (spends real tokens): runs ONLY when BOTH switches are set in the
 * invoking shell — WORKER_INVOCATION=on AND RUN_PAID_E2E=1. Missing either → the
 * test SKIPS: no `claude` call, nothing spent. The switches are read from the
 * environment and are NEVER written to the repo or any persistent config.
 *
 *   Enable:  WORKER_INVOCATION=on RUN_PAID_E2E=1 node --test src/intake/bridge.e2e.test.js
 *   Default: node --test   (skipped — zero cost)
 *
 * A FREE capability probe (`claude --version`, no model call) runs BEFORE any
 * paid step; if it fails the test fails cleanly without spending. Completion is
 * itself the proof of relay 0/0/0: stdin is closed and bypassPermissions issues
 * no Allow prompt, so if any step needed a human it would hang and fail.
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const cp = require('node:child_process')

// TEST-ONLY truth-store dir, chosen BEFORE requiring store.js (its data dir is
// resolved at module load). Only a path string here — the dir is created lazily
// by the first store write, so a SKIPPED run creates nothing. Never the repo data/.
process.env.AROMA_DATA_DIR = path.join(os.tmpdir(), `aroma-bridge-e2e-data-${process.pid}`)
process.env.LLM_PROVIDER = 'mock' // keep any legacy path offline; promote/confirm make no LLM call anyway

const { test } = require('node:test')
const assert = require('node:assert/strict')

const { createApp } = require('../app')
const store = require('../store/store')
const { createArtifactStore } = require('../store/artifactStore')
const { createClaudeWorker } = require('../workers/claudeWorker')
const { createWorkerRunner } = require('../workers/runWorkerInBackground')

const PAID = process.env.RUN_PAID_E2E === '1'
const FLAG_ON = process.env.WORKER_INVOCATION === 'on'
const GATED = PAID && FLAG_ON
const SKIP = GATED ? false : 'set WORKER_INVOCATION=on AND RUN_PAID_E2E=1 to run the paid bridge E2E'

const { TEST_SERVICE_TOKEN: TOKEN } = require('../api/_serviceTokenFixture') // B2-15: explicit test token (not a secret); never logged

// A trivial, safe, self-contained sandbox action → cheap + near-deterministic.
const TASK_TITLE = 'Create hello.txt containing OK'
const TASK_NOTE = [
  'Run exactly these commands in the current working directory, and nothing else:',
  "printf 'OK' > hello.txt",
  'git add hello.txt',
  'git commit -m "bridge e2e: prove full chain"',
  'Do not create, modify, or delete any other file. Do not print anything else.'
].join('\n')

// The bare `claude` on Windows is a bash script; spawn(shell:false) needs the exe.
function resolveClaudeCommand () {
  if (process.platform !== 'win32') return 'claude'
  const exe = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
  return fs.existsSync(exe) ? exe : 'claude'
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

test('REAL paid bridge E2E — Task→promote→confirm→worker→Result API, full provenance', { skip: SKIP, timeout: 240000 }, async () => {
  // ── STEP 2: FREE capability probe FIRST — no model call, no spend ────────────
  const command = resolveClaudeCommand()
  const probe = cp.spawnSync(command, ['--version'], { encoding: 'utf8' })
  const probeOk = !probe.error && probe.status === 0
  console.log('claude probe :', probeOk ? `OK (${(probe.stdout || '').trim()})` : `FAILED (${probe.error ? probe.error.message : 'exit ' + probe.status})`)
  assert.ok(probeOk, 'claude capability probe failed — aborting BEFORE any paid step (nothing spent)')

  // ── Build the app with the REAL worker + an injected artifact store ──────────
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-bridge-e2e-art-'))
  const artifactStore = createArtifactStore({ baseDir: base })
  const worker = createClaudeWorker({ command })                       // real spawn: cwd=sandbox, stdin closed
  const runner = createWorkerRunner({ worker, artifactStore, sandboxRoot: os.tmpdir() }) // real git-init TmpdirSandbox
  // NOTE: WORKER_INVOCATION is required 'on' by the gate — we do NOT set it here.
  // The Result Read endpoint reads artifacts from workerDeps.artifactStore, so it
  // must be the SAME store the runner writes to — inject BOTH (as the production
  // default workerDeps does). Injecting only { runner } → /result 503.
  const built = createApp({ serviceToken: TOKEN, dispatcher: async () => {}, workerDeps: { runner, artifactStore }, proposalPersistence: false, runPersistence: false })
  const server = built.listen(0)
  const { port } = server.address()
  const origin = `http://127.0.0.1:${port}`
  const t0 = Date.now()

  async function api (method, url, token) {
    const headers = { 'content-type': 'application/json' }
    if (token) headers.authorization = `Bearer ${token}`
    const res = await fetch(`${origin}${url}`, { method, headers, body: method === 'POST' ? '{}' : undefined })
    return { status: res.status, json: await res.json() }
  }

  let sandbox = null
  try {
    // ── STEP 3a: a REAL intake Task in the test-only data dir ──────────────────
    const { task_ids: [taskId] } = store.persistIntake({
      decision: { statement: 'bridge e2e', rationale: 'prove the full chain' },
      tasks: [{ title: TASK_TITLE, note: TASK_NOTE }]
    })

    // ── STEP 3b: PROMOTE (token) — builds a ready Proposal, binds, does NOT confirm/start
    const prom = await api('POST', `/api/v1/intake/tasks/${taskId}/proposal`, TOKEN)
    assert.equal(prom.status, 200)
    const pid = prom.json.proposalId
    assert.equal(prom.json.linkState, 'ready')

    const pView = (await api('GET', `/api/v1/proposals/${pid}`)).json
    assert.equal(pView.sourceTaskId, taskId, 'proposal.sourceTaskId === the intake task')
    assert.equal(pView.status, 'pending', 'promote never confirms — status still pending')
    assert.equal(pView.linkState, 'ready')
    assert.equal(pView.briefSerializationVersion, 'v1')

    // promote did NOT start a worker: no Execution yet, via the API AND the store
    const before = (await api('GET', `/api/v1/proposals/${pid}/result`)).json
    assert.equal(before.status, 'pending')
    assert.equal(before.executionId, null)
    assert.equal(artifactStore.list('tasks').length, 0, 'no Execution artifact before confirm')
    assert.equal(artifactStore.list('results').length, 0, 'no Result artifact before confirm')

    // ── STEP 3c: REAL confirm — the sole authorization point ───────────────────
    const conf = await api('POST', `/api/v1/proposals/${pid}/confirm`, TOKEN)
    assert.equal(conf.status, 201)
    assert.ok(conf.json.runId, 'confirm returns a runId')

    // ── STEP 3d: poll the Result Read API (NOT artifacts) until terminal ───────
    let view = null
    const deadline = Date.now() + 120000
    while (Date.now() < deadline) {
      const r = (await api('GET', `/api/v1/proposals/${pid}/result`)).json
      if (r.status === 'succeeded' || r.status === 'failed') { view = r; break }
      await sleep(1000)
    }
    const elapsedMs = Date.now() - t0
    assert.ok(view, `worker did not finish within 120s (elapsed ${elapsedMs}ms)`)

    // Corroborating sandbox-effect evidence via the injected store (NOT the API
    // path proof): locate the real sandbox + verify the file/commit landed.
    const resultArtifact = artifactStore.list('results')[0]
    const execution = resultArtifact ? artifactStore.read('tasks', resultArtifact.taskId) : null
    sandbox = execution ? execution.sandbox : null
    const filePath = sandbox ? path.join(sandbox, 'hello.txt') : null
    const fileExists = !!(filePath && fs.existsSync(filePath))
    const content = fileExists ? fs.readFileSync(filePath, 'utf8') : null
    const gitLog = sandbox ? cp.spawnSync('git', ['log', '--pretty=%H%n%s', '-1'], { cwd: sandbox, encoding: 'utf8' }) : { stdout: '' }
    const [commitSha = '', commitMsg = ''] = (gitLog.stdout || '').trim().split('\n')

    // ── EVIDENCE ───────────────────────────────────────────────────────────────
    console.log('\n================== B2-7 BRIDGE E2E EVIDENCE ==================')
    console.log('task id      :', taskId)
    console.log('proposal id  :', pid, '| sourceTaskId:', pView.sourceTaskId, '| linkState:', pView.linkState)
    console.log('API status   :', view.status, '| ok:', view.ok, '| exitCode:', view.exitCode)
    console.log('executionId  :', view.executionId, '(Result → Execution, via API)')
    console.log('proposal     :', JSON.stringify(view.proposal), '(via /result projection)')
    console.log('relay        :', JSON.stringify(view.relay), '(unattended completion = 0/0/0)')
    console.log('resultSummary:', JSON.stringify(view.resultSummary))
    console.log('cost usd     :', view.cost == null ? 'cost not reported by CLI' : view.cost)
    console.log('sandbox      :', sandbox)
    console.log('file exists  :', fileExists, '| content:', JSON.stringify(content))
    console.log('commit       :', commitSha.slice(0, 12), commitMsg)
    console.log('elapsed ms   :', elapsedMs)
    console.log('=============================================================\n')

    // ── STEP 4: FULL-CHAIN ASSERTIONS (all via the API) ─────────────────────────
    assert.equal(view.status, 'succeeded', 'Result Read API reports succeeded')
    assert.equal(view.ok, true, 'result ok:true')
    assert.equal(view.exitCode, 0, 'exitCode 0')
    assert.ok(view.executionId, 'Result → Execution linkage (executionId) resolves via API')
    // Proposal provenance carried on the /result projection — the REAL confirm act
    assert.equal(view.proposal.id, pid)
    assert.equal(view.proposal.status, 'confirmed')
    assert.ok(view.proposal.confirmedBy, 'real confirmedBy present (not fabricated)')
    assert.ok(view.proposal.confirmedAt, 'real confirmedAt present (not fabricated)')
    // Proposal → sourceTaskId, and the same confirm provenance on the proposal read
    const pAfter = (await api('GET', `/api/v1/proposals/${pid}`)).json
    assert.equal(pAfter.sourceTaskId, taskId, 'Result → Proposal → sourceTaskId resolves')
    assert.equal(pAfter.confirmedBy, view.proposal.confirmedBy)
    assert.equal(pAfter.confirmedAt, view.proposal.confirmedAt)
    // relay 0/0/0 — no stdin, no prompt, no manual carry
    assert.deepEqual(view.relay, { toUser: 0, fromUser: 0, manual: 0 })
    // API executionId ties to the real Execution artifact (cross-check, corroborating)
    if (execution) assert.equal(view.executionId, execution.id)
    // sandbox effect: the trivial action actually happened
    assert.ok(fileExists, 'hello.txt created in the TmpdirSandbox')
    assert.equal(content, 'OK', 'hello.txt content is exactly "OK"')
    assert.ok(commitSha.length >= 7, 'a git commit exists in the sandbox')
  } finally {
    server.close()
    if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true })
    fs.rmSync(base, { recursive: true, force: true })
    fs.rmSync(process.env.AROMA_DATA_DIR, { recursive: true, force: true }) // test-only truth dir
  }
})
