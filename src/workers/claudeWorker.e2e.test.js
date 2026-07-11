'use strict'

/**
 * claudeWorker.e2e.test.js — B2-1 Step 4. The ONE real, PAID, unattended
 * end-to-end. It spends real Claude tokens, so it is GATED: it runs ONLY when
 * RUN_PAID_E2E=1. Absent the guard it SKIPS (fail closed) — the normal suite
 * never makes a paid call.
 *
 *   Enable:  RUN_PAID_E2E=1 node --test src/workers/claudeWorker.e2e.test.js
 *   Default: node --test  (this test is skipped)
 *
 * It drives the REAL confirm flow: seed a proposal whose task is the Capability
 * Verification Task, confirm it over HTTP (WORKER_INVOCATION=on), and let the
 * real worker spawn `claude` inside a fresh git-init'd os.tmpdir sandbox — with
 * cwd=sandbox and stdin CLOSED. The test completing on its own is the proof of
 * relay 0/0/0: nothing can supply input, so if any step needed a human it would
 * hang and fail.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const cp = require('node:child_process')

const app = require('../app')
const { createApp } = app
const { createArtifactStore } = require('../store/artifactStore')
const { createClaudeWorker } = require('./claudeWorker')
const { createWorkerRunner } = require('./runWorkerInBackground')

const PAID = process.env.RUN_PAID_E2E === '1'
const TOKEN = 'svc-token-aroma-os'

// The bare `claude` on Windows is a bash script; spawn(shell:false) needs the real
// exe. On other platforms the PATH `claude` works.
function resolveClaudeCommand () {
  if (process.platform !== 'win32') return 'claude'
  const exe = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
  return fs.existsSync(exe) ? exe : 'claude'
}

const VERIFICATION_TASK = [
  'Run exactly these commands in the current working directory, and nothing else:',
  "printf 'Hello Aroma' > hello-aroma.txt",
  'git add hello-aroma.txt',
  'git commit -m "test: prove headless worker invocation"',
  'Do not create, modify, or delete any other file. Do not print anything else.'
].join('\n')

async function waitFor (predicate, ms) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (predicate()) return true
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}

test('REAL paid unattended E2E — Capability Verification Task', { skip: PAID ? false : 'set RUN_PAID_E2E=1 to run the paid E2E', timeout: 240000 }, async () => {
  process.env.WORKER_INVOCATION = 'on'
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-e2e-store-'))
  const store = createArtifactStore({ baseDir: base })
  const command = resolveClaudeCommand()
  const worker = createClaudeWorker({ command })                 // real spawn runner (cwd=sandbox, stdin closed)
  const runner = createWorkerRunner({ worker, artifactStore: store, sandboxRoot: os.tmpdir() }) // real git-init prepareSandbox
  const built = createApp({ dispatcher: async () => {}, workerDeps: { runner }, proposalPersistence: false })
  const server = built.listen(0)
  const t0 = Date.now()
  try {
    // Seed + confirm (confirm is the authorising gate; confirmedBy/At = provenance)
    const developLlm = async () => ({ intent: 'develop', task: VERIFICATION_TASK, targetProject: 'frontend' })
    const { proposal } = await built.locals.proposalStore.propose({ conversationId: 'e2e', message: 'verify worker', llm: developLlm })
    const pid = proposal.id

    const { port } = server.address()
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/proposals/${pid}/confirm`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: '{}'
    })
    assert.equal(res.status, 201)

    const landed = await waitFor(() => store.list('results').length > 0, 210000)
    const elapsedMs = Date.now() - t0
    assert.ok(landed, 'the worker Result Artifact must land (unattended) within the timeout')

    const result = store.list('results')[0]
    const execution = store.read('tasks', result.taskId)
    const proposalNow = built.locals.proposalStore.getProposal(execution.proposalId)
    const sandbox = execution.sandbox

    // Filesystem + git evidence, gathered from the sandbox
    const filePath = path.join(sandbox, 'hello-aroma.txt')
    const fileExists = fs.existsSync(filePath)
    const content = fileExists ? fs.readFileSync(filePath, 'utf8') : null
    const gitLog = cp.spawnSync('git', ['log', '--pretty=%H%n%s', '-1'], { cwd: sandbox, encoding: 'utf8' })
    const [commitSha = '', commitMsg = ''] = (gitLog.stdout || '').trim().split('\n')
    const resultsDir = path.join(base, 'results')
    const resultPath = path.join(resultsDir, fs.readdirSync(resultsDir)[0])
    const readBack = JSON.parse(fs.readFileSync(resultPath, 'utf8'))

    // ---- EVIDENCE ----
    console.log('\n===================== B2-1 E2E EVIDENCE =====================')
    console.log('command      :', `${command} -p "<task>" --add-dir ${sandbox} --permission-mode bypassPermissions --output-format json`)
    console.log('cwd (sandbox):', sandbox, '(stdin: ignore/closed)')
    console.log('exit code    :', result.exit)
    console.log('file exists  :', fileExists, '| content bytes:', JSON.stringify(content))
    console.log('commit SHA   :', commitSha)
    console.log('commit msg   :', commitMsg)
    console.log('result path  :', resultPath)
    console.log('result JSON  :', JSON.stringify({ ok: readBack.ok, exit: readBack.exit, taskId: readBack.taskId, proposalId: readBack.proposalId, relay: readBack.relay, cost: readBack.cost }))
    console.log('CHAIN        : result.taskId=' + result.taskId + ' -> execution.proposalId=' + execution.proposalId + ' -> proposal.status=' + proposalNow.status)
    console.log('confirmedBy  :', proposalNow.confirmedBy, '| confirmedAt:', proposalNow.confirmedAt)
    console.log('relay        :', JSON.stringify(result.relay), '(unattended completion = 0/0/0)')
    console.log('cost usd     :', result.cost)
    console.log('elapsed ms   :', elapsedMs)
    console.log('=============================================================\n')

    // ---- ASSERTIONS ----
    assert.equal(result.exit, 0, 'exit code 0')
    assert.equal(result.ok, true, 'result ok')
    assert.ok(fileExists, 'hello-aroma.txt exists in the sandbox')
    assert.equal(content, 'Hello Aroma', 'content exactly "Hello Aroma"')
    assert.ok(commitSha.length >= 7, 'a git commit exists in the sandbox')
    assert.equal(commitMsg, 'test: prove headless worker invocation', 'exact commit message')
    assert.equal(readBack.ok, true, 'Result Artifact readable JSON with ok:true')

    // full chain resolves
    assert.ok(execution, 'result.taskId resolves to an Execution Artifact')
    assert.equal(execution.proposalId, pid)
    assert.equal(proposalNow.status, 'confirmed')
    assert.ok(proposalNow.confirmedBy, 'real confirmedBy present')
    assert.ok(proposalNow.confirmedAt, 'real confirmedAt present')
    assert.equal(execution.approval.confirmedBy, proposalNow.confirmedBy)
    assert.equal(execution.approval.confirmedAt, proposalNow.confirmedAt)

    // relay 0/0/0 (mechanically enforced: stdin closed, bypassPermissions => no Allow prompt)
    assert.deepEqual(result.relay, { toUser: 0, fromUser: 0, manual: 0 })

    fs.rmSync(sandbox, { recursive: true, force: true })
  } finally {
    delete process.env.WORKER_INVOCATION
    server.close()
    fs.rmSync(base, { recursive: true, force: true })
  }
})
