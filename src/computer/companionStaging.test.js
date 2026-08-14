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
  /**
   * ⛔ WIDENED IN COMMIT C, AND THE WIDENING IS THE POINT OF THE TEST.
   *
   * The 3a Companion reached three siblings. The 3b Companion delegates observation and
   * consults a gate, so its closure is four more files — and this assertion is what makes
   * that visible rather than incidental. Every addition is INERT: the flag is a string reader,
   * the gate computes and compares, observation refuses everything, and none of them touches
   * a desktop. A closure that grew without anyone noticing is what this test exists to stop.
   */
  assert.deepEqual(names, ['companion-entry.js', 'companion.js', 'computerOperatorFlag.js', 'ipcChannel.js', 'observation.js', 'sealedOrderGate.js', 'sessionBoundary.js'])
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
  // the supervisor, the audit, the work order and the registry are the Service's business.
  // If any of them appeared here, the Companion would be carrying governance code into the
  // operator account, which is the opposite of the design.
  //
  // ⛔ computerOperatorFlag.js LEFT THIS LIST IN COMMIT C, AND IT IS A SECURITY CHOICE.
  //
  // The 3b Companion asks the gate whether a restricted action is unlocked, and one of the five
  // conditions is the flag. It reads it from the REAL process environment rather than taking it
  // as an argument — precisely so a caller who assembles a Companion cannot hand it a fabricated
  // { on }. That removes an injection point, and the price is that the flag module travels into
  // the staged closure.
  //
  // It is safe to carry: it reads one environment variable, returns a string, and has no side
  // effect and no I/O. It is not governance CODE — it is the switch governance reads. Everything
  // that DECIDES anything stays Service-side and is still asserted here.
  for (const notHere of ['computerSupervisor.js', 'computerAudit.js', 'computerWorkOrder.js',
    'evidenceStore.js', 'orderRegistry.js', 'killSwitch.js']) {
    assert.equal(names.includes(notHere), false, 'must not be staged: ' + notHere)
  }
})

test('the staged copy reaches only three node builtins, each named', () => {
  const m = M.buildManifest()
  // ⛔ node:crypto joins them in Commit C: `sealedOrderGate` hashes an order to verify the
  // seal. It computes and compares — no fs, no process, no network. Still named, still three.
  assert.deepEqual(m.builtins, ['node:crypto', 'node:net', 'node:path'])
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
  // The Companion LISTENS now; this side connects. Same inversion as the deployment.
  const { createPipeConnector } = require('./ipcChannel')
  const name = 'aroma-stage-test-' + crypto.randomBytes(6).toString('hex')
  const replies = []
  const service = createPipeConnector({ name, onMessage: (m) => { replies.push(m) } })

  // The Companion starts FIRST and creates the pipe; this side then connects, retrying
  // while it comes up. Same order as the deployment.
  const child = spawn(process.execPath, [path.join(dir, 'companion-entry.js'), name], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (d) => { stderr += d })

  try {
    const deadline = Date.now() + 15000
    let connected = false
    while (!connected && Date.now() < deadline) {
      try { await service.connect(); connected = true } catch (_) { await new Promise((r) => setTimeout(r, 200)) }
    }
    assert.equal(connected, true, 'connected to the pipe the staged entry created. stderr: ' + stderr)

    const nonce = crypto.randomBytes(16).toString('hex')
    service.send({ from: 'service', to: 'companion', type: 'execute_step', approvalId: 'appr_stage', stepIndex: 0, stepNonce: nonce, step: { action: 'capture_own_screen' } })
    const d2 = Date.now() + 5000
    while (replies.length === 0 && Date.now() < d2) await new Promise((r) => setTimeout(r, 25))
    assert.ok(replies.length > 0, 'it replied. stderr: ' + stderr)
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
    try { service.close() } catch (_) {}
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

/* ── the vacuous-pass guard ───────────────────────────────────────────────── */

test('*** a binding whose target is already dead must NOT count as demonstrated ***', async () => {
  // THE PATTERN THIS EXISTS TO STOP. The first demonstration ran all three bindings
  // against one Companion; KILL 2 aborted it, so KILL 3 had nothing left to kill and
  // "gone after kill: True" passed while proving nothing. Green, but not proving what it
  // claimed. The harness must now refuse to call that a demonstration.
  const os2 = require('node:os')
  const dir = fs.mkdtempSync(path.join(os2.tmpdir(), 'aroma-vacuous-'))
  try {
    const evidence = path.join(dir, 'ev.json')
    const pipe = 'aroma-nobody-home-' + crypto.randomBytes(4).toString('hex')
    // No Companion is started at all — the pipe never exists.
    const r = spawnSync(process.execPath,
      [path.resolve(__dirname, '../../scripts/computer/demo-killswitch.js'), pipe, evidence, 'oskill', path.join(dir, 'm')],
      { encoding: 'utf8', timeout: 60000 })

    assert.notEqual(r.status, 0, 'the harness must exit non-zero when nothing was demonstrated')
    const ev = JSON.parse(fs.readFileSync(evidence, 'utf8'))
    assert.equal(ev.companionAliveBefore, false, 'it never proved anything alive')
    assert.equal(ev.demonstratedAgainstLiveCompanion, false, 'so nothing was demonstrated')
    assert.equal(ev.allPassed, false, 'and the run cannot be reported as passing')
    assert.match(r.stdout, /NOT DEMONSTRATED/, 'and it says so in words, not only in a field')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('the evidence records aliveness per binding, so a dead target is always visible', () => {
  const h = fs.readFileSync(path.resolve(__dirname, '../../scripts/computer/demo-killswitch.js'), 'utf8')
  // proven by a real round-trip, never by a process id — a pid says nothing about whether
  // the process is listening
  assert.ok(h.includes('companionAliveBefore'), 'the field exists')
  assert.ok(h.includes('demonstratedAgainstLiveCompanion'), 'and the derived verdict')
  assert.ok(/ping\/pong/.test(h), 'aliveness is a round-trip')
  assert.ok(h.includes('evidence.demonstratedAgainstLiveCompanion === true'),
    'allPassed depends on it — a passing check on a dead target still fails the run')
})

test('*** the deploy runs THREE rounds, each with a fresh Companion ***', () => {
  const ps = fs.readFileSync(path.resolve(__dirname, '../../scripts/computer/deploy-companion.ps1'), 'utf8')
  assert.match(ps, /foreach \(\$round in @\('gate','abort','oskill'\)\)/, 'one round per binding')
  assert.ok(ps.includes('Start-Companion'), 'each round starts its own Companion')
  // and the OS kill happens only AFTER the harness has confirmed the process is alive
  assert.ok(ps.includes('readyMarker'), 'the harness signals it is connected and alive')
  assert.ok(ps.includes('aliveBeforeKill'), 'the script records aliveness before killing')
  assert.match(ps, /Stop-Process -Id \$companion\.Id -Force[\s\S]{0,120}OS kill issued/,
    'the kill is issued against a process confirmed alive')
})
