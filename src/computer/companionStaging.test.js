'use strict'

/**
 * companionStaging.test.js — the staged Companion must be SELF-CONTAINED.
 *
 * The deploy failed on `Cannot find module ...\scripts\computer\ipcChannel.js`. The
 * staged list was hand-written; the harness's was wrong; and nothing checked either. The
 * dangerous version of that bug is the one that does NOT fail loudly: a Companion missing
 * one file falls back to resolving elsewhere, and "elsewhere" is the repo it is denied —
 * so it surfaces inside the operator account as a permission error that looks like a
 * containment problem and is actually a packaging bug.
 *
 * So the manifest is derived from the real require graph, and this proves the result by
 * COPYING ONLY THOSE FILES into a temp directory and running the entry from there. If
 * anything is missing, the process cannot fall back to the repo, because a temp directory
 * has no path to it.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync, spawn } = require('node:child_process')

const M = require('../../scripts/computer/companionManifest')

/* ── the graph is complete ────────────────────────────────────────────────── */

test('*** the manifest resolves every dependency — nothing is MISSING ***', () => {
  const m = M.buildManifest()
  assert.deepEqual(m.missing, [], 'every relative require resolved to a real file')
  assert.ok(m.files.length >= 4, 'entry plus its dependencies')
  const names = m.files.map((f) => f.name).sort()
  assert.deepEqual(names, ['companion-entry.js', 'companion.js', 'ipcChannel.js', 'sessionBoundary.js'])
})

test('extension-less requires are resolved — the case that broke the first walker', () => {
  // companion.js does `require('./sessionBoundary')` with no .js. The first version of the
  // walker only tried the literal name and reported it MISSING.
  assert.ok(M.sourceOf('sessionBoundary'), 'resolves without the extension')
  assert.ok(M.sourceOf('sessionBoundary.js'), 'and with it')
  assert.equal(M.stagedName('sessionBoundary'), 'sessionBoundary.js', 'staged flat, always with .js')
})

test('the staged graph pulls in NOTHING beyond the Companion', () => {
  const m = M.buildManifest()
  const names = m.files.map((f) => f.name)
  // the supervisor, the audit, the work order and the flag are the Service's business.
  // If any of them appeared here, the Companion would be carrying governance code into
  // the operator account, which is the opposite of the design.
  for (const notHere of ['computerSupervisor.js', 'computerAudit.js', 'computerWorkOrder.js',
    'computerOperatorFlag.js', 'evidenceStore.js', 'orderRegistry.js', 'killSwitch.js']) {
    assert.equal(names.includes(notHere), false, 'must not be staged: ' + notHere)
  }
})

test('the staged copy reaches only two node builtins', () => {
  const m = M.buildManifest()
  assert.deepEqual(m.builtins, ['node:net', 'node:path'])
  // net is the named pipe; path is path joining. No fs, no child_process, no http.
  for (const banned of ['node:fs', 'node:child_process', 'node:http', 'node:https', 'node:os']) {
    assert.equal(m.builtins.includes(banned), false, 'staged Companion must not use ' + banned)
  }
})

/* ── it actually runs from a directory containing only those files ────────── */

function stageToTemp () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-stage-'))
  for (const f of M.buildManifest().files) fs.copyFileSync(f.src, path.join(dir, f.name))
  return dir
}

test('*** the staged copy LOADS with no access to the repo ***', () => {
  const dir = stageToTemp()
  try {
    // --check parses and resolves nothing; requiring is the real test. Run a tiny probe
    // that requires the entry's dependencies from the staged directory only.
    const probe = path.join(dir, 'probe.js')
    fs.writeFileSync(probe, [
      "const c = require('./companion.js')",
      "const i = require('./ipcChannel.js')",
      "const s = require('./sessionBoundary.js')",
      "console.log(JSON.stringify({",
      "  companion: typeof c.createCompanion,",
      "  channel: typeof i.createCompanionEndpoint,",
      "  boundary: Array.isArray(s.ROLES),",
      "  anyCapability: c.anyCapabilityEnabled()",
      "}))"
    ].join('\n'))
    const r = spawnSync(process.execPath, [probe], { cwd: dir, encoding: 'utf8', timeout: 15000 })
    assert.equal(r.status, 0, 'staged modules load standalone. stderr: ' + (r.stderr || ''))
    const out = JSON.parse(r.stdout.trim())
    assert.equal(out.companion, 'function')
    assert.equal(out.channel, 'function')
    assert.equal(out.boundary, true)
    assert.equal(out.anyCapability, false, 'still zero capability when staged')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('*** the staged ENTRY connects and refuses, from the staged directory ***', async () => {
  // The end-to-end proof: run the real entry file out of the temp staging directory,
  // against a real pipe, and confirm it answers. Nothing here reads the repo.
  const dir = stageToTemp()
  const { createServiceEndpoint } = require('./ipcChannel')
  const name = 'aroma-stage-test-' + crypto.randomBytes(6).toString('hex')
  const replies = []
  const service = createServiceEndpoint({ name, onMessage: (m) => replies.push(m) })
  await service.listen()

  const child = spawn(process.execPath, [path.join(dir, 'companion-entry.js'), name], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (d) => { stderr += d })

  try {
    const deadline = Date.now() + 10000
    while (service.connectionCount() === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50))
    assert.equal(service.connectionCount(), 1, 'the staged entry connected. stderr: ' + stderr)

    const nonce = crypto.randomBytes(16).toString('hex')
    service.send({ from: 'service', to: 'companion', type: 'execute_step', approvalId: 'appr_stage', stepIndex: 0, stepNonce: nonce, step: { action: 'capture_own_screen' } })
    const d2 = Date.now() + 5000
    while (replies.length === 0 && Date.now() < d2) await new Promise((r) => setTimeout(r, 25))
    assert.ok(replies.length > 0, 'it replied')
    assert.equal(replies[0].ok, false)
    assert.equal(replies[0].refusal, 'no_capability_enabled', 'still refuses everything')
  } finally {
    // Wait for the child to actually EXIT before removing the directory. rmSync failed
    // with EPERM because the killed process still held the staging directory open — the
    // assertions had all passed by then, so the test reported a failure that was purely
    // its own teardown.
    const exited = new Promise((r) => child.once('exit', r))
    child.kill('SIGKILL')
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))])
    await service.close()
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch (_) { /* temp dir; the OS reclaims it */ }
  }
})

/* ── the deploy script stages exactly the manifest ────────────────────────── */

test('*** deploy-companion.ps1 stages the DERIVED list, not a hand-written one ***', () => {
  const ps = fs.readFileSync(path.resolve(__dirname, '../../scripts/computer/deploy-companion.ps1'), 'utf8')
  assert.ok(ps.includes('companionManifest.js'), 'the deploy asks the manifest tool')
  // and no longer carries the hand-written list that was wrong
  assert.equal(/'companion\.js','ipcChannel\.js','sessionBoundary\.js','killSwitch\.js'/.test(ps), false,
    'the hand-written staging list is gone')
})

test('the harness requires from src/, because it runs as the Owner and is never staged', () => {
  const h = fs.readFileSync(path.resolve(__dirname, '../../scripts/computer/demo-killswitch.js'), 'utf8')
  assert.ok(h.includes("'..', '..', 'src', 'computer'"), 'harness resolves against src/computer')
  const names = M.buildManifest().files.map((f) => f.name)
  assert.equal(names.includes('demo-killswitch.js'), false, 'the harness is not staged')
})
