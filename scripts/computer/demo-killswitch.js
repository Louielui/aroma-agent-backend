'use strict'

/**
 * demo-killswitch.js — Computer Operator v0, Phase 3a. THE EVIDENCE HARNESS.
 *
 * Demonstrates ONE kill-switch binding per run, against a Companion that is PROVEN ALIVE
 * first.
 *
 * ── WHY ONE PER RUN ───────────────────────────────────────────────────────────
 * The first version demonstrated all three in sequence against a single Companion. KILL 2
 * aborted it, so by the time KILL 3 ran there was nothing left to kill — and "gone after
 * kill: True" passed while proving nothing. Green, but not proving what it claimed.
 *
 * So each binding now gets a FRESH Companion, and every run begins by proving the
 * Companion is alive with a real ping/pong round-trip — not by checking that a process id
 * exists, which says nothing about whether it is listening. `companionAliveBefore` is
 * recorded in the evidence, and a binding whose target was already dead is reported as
 * NOT DEMONSTRATED rather than as a pass.
 *
 * It performs NO desktop action and never asks the Companion to.
 *
 * Usage (invoked by deploy-companion.ps1, not by hand):
 *   node demo-killswitch.js <pipeName> <evidenceJsonPath> <gate|abort|oskill> [readyMarkerPath]
 */

const path = require('node:path')
const fs = require('node:fs')

// THIS FILE IS NOT STAGED. It runs as the OWNER, who can read the repo, so it requires
// straight from src/computer.
const SRC = path.resolve(__dirname, '..', '..', 'src', 'computer')
// The SERVICE CONNECTS; the COMPANION creates the pipe. See the DACL note in
// ipcChannel.js: libuv gives Everyone read-only on a named pipe, so the low-privilege
// account could never open duplex a pipe the Owner created.
const { createPipeConnector } = require(path.join(SRC, 'ipcChannel.js'))
const { createKillSwitch } = require(path.join(SRC, 'killSwitch.js'))

const [pipeName, outPath, binding, readyMarker] = process.argv.slice(2)
const BINDINGS = ['gate', 'abort', 'oskill']
if (!pipeName || !outPath || !BINDINGS.includes(binding)) {
  console.error('usage: node demo-killswitch.js <pipeName> <evidenceJsonPath> <' + BINDINGS.join('|') + '> [readyMarkerPath]')
  process.exit(2)
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const nonce = () => require('node:crypto').randomBytes(16).toString('hex')

const evidence = {
  binding,
  pipeName,
  startedAt: new Date().toISOString(),
  companionAliveBefore: false, // proven by a ping/pong round-trip, never by a pid
  demonstratedAgainstLiveCompanion: false,
  checks: []
}

function record (name, passed, detail) {
  evidence.checks.push({ name, passed, detail: detail || null, at: new Date().toISOString() })
  console.log((passed ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  — ' + detail : ''))
}

const replies = []
const service = createPipeConnector({ name: pipeName, onMessage: (m) => { replies.push(m) } })

async function ask (msg, timeoutMs = 5000) {
  const before = replies.length
  service.send(msg)
  const deadline = Date.now() + timeoutMs
  while (replies.length === before && Date.now() < deadline) await wait(25)
  return replies.length > before ? replies[replies.length - 1] : null
}

const step = (over = {}) => Object.assign({
  from: 'service', to: 'companion', type: 'execute_step',
  approvalId: 'appr_3a_demo', stepIndex: 0, stepNonce: nonce()
}, over)

/** Connect to the pipe the Companion created, retrying while it comes up. */
async function connect () {
  const deadline = Date.now() + 30000
  let lastErr = null
  while (Date.now() < deadline) {
    try { await service.connect(); return true } catch (e) { lastErr = e; await wait(400) }
  }
  record('companion connected', false, 'never appeared: ' + (lastErr && lastErr.message))
  return false
}

/** THE GATE THAT MAKES EVERY RESULT MEAN SOMETHING: prove it is alive and answering. */
async function proveAlive () {
  const pong = await ask(Object.assign(step(), { type: 'ping' }))
  const alive = !!pong && pong.type === 'pong'
  evidence.companionAliveBefore = alive
  record('companion ALIVE before the demonstration (ping/pong)', alive,
    alive ? 'answered' : 'no pong — nothing to demonstrate against')
  if (alive) {
    const caps = pong.capabilities || {}
    record('zero capability under the operator account',
      Object.values(caps).some(Boolean) === false,
      Object.keys(caps).length + ' capabilities, all false')
  }
  return alive
}

async function main () {
  if (!(await connect())) return finish()
  record('companion connected', true)
  if (!(await proveAlive())) return finish()

  if (binding === 'gate') {
    // KILL 1 — the SERVICE GATE. Nothing leaves this side at all, and the Companion is
    // still alive afterwards: the gate stopped the MESSAGE, not the process.
    const gate = createKillSwitch()
    gate.stop('owner_kill_switch')
    const before = replies.length
    if (gate.guard().ok) service.send(step({ step: { action: 'list_windows' } }))
    await wait(600)
    record('KILL 1 service gate: nothing was sent', replies.length === before && gate.guard().ok === false)
    const stillPong = await ask(Object.assign(step({ stepNonce: nonce() }), { type: 'ping' }))
    record('KILL 1 companion is still alive (the gate stopped the message, not the process)',
      !!stillPong && stillPong.type === 'pong')
    evidence.demonstratedAgainstLiveCompanion = evidence.companionAliveBefore
  }

  if (binding === 'abort') {
    // KILL 2 — the COMPANION ABORT. It acknowledges, then the channel goes.
    const aborted = await ask(Object.assign(step({ stepNonce: nonce() }), { type: 'abort' }))
    record('KILL 2 abort acknowledged', !!aborted && aborted.type === 'aborted')
    const deadline = Date.now() + 8000
    while (service.isConnected() && Date.now() < deadline) await wait(100)
    record('KILL 2 companion closed the channel', service.isConnected() === false,
      service.isConnected() ? 'still connected' : 'channel gone')
    evidence.demonstratedAgainstLiveCompanion = evidence.companionAliveBefore
  }

  if (binding === 'oskill') {
    // KILL 3 — the OS FALLBACK. The Companion is alive and answering RIGHT NOW; the
    // deploy script kills the process from outside while we hold the channel open, and we
    // record the channel dropping. This is the binding that was previously never
    // demonstrated, because KILL 2 had already killed the only Companion.
    if (readyMarker) {
      try { fs.writeFileSync(readyMarker, 'alive ' + new Date().toISOString()) } catch (_) {}
    }
    console.log('waiting for the external OS kill...')
    const deadline = Date.now() + 60000
    while (service.isConnected() && Date.now() < deadline) await wait(100)
    const dropped = service.isConnected() === false
    record('KILL 3 OS fallback: the channel dropped when the process was killed externally', dropped,
      dropped ? 'channel gone' : 'still connected after 60s')
    evidence.demonstratedAgainstLiveCompanion = evidence.companionAliveBefore && dropped
  }

  finish()
}

function finish () {
  evidence.finishedAt = new Date().toISOString()
  const allChecksPassed = evidence.checks.length > 0 && evidence.checks.every((c) => c.passed)
  // A binding only counts if it was demonstrated against a Companion PROVEN alive first.
  evidence.allPassed = allChecksPassed && evidence.demonstratedAgainstLiveCompanion === true
  try { fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2)) } catch (e) { console.error('could not write evidence: ' + e.message) }
  console.log('')
  if (evidence.allPassed) console.log('BINDING ' + binding + ': DEMONSTRATED against a live Companion')
  else if (!evidence.companionAliveBefore) console.log('BINDING ' + binding + ': NOT DEMONSTRATED — the Companion was not alive to begin with')
  else console.log('BINDING ' + binding + ': FAILED')
  console.log('evidence written to ' + outPath)
  try { service.close() } catch (_) { /* the connector closes synchronously */ }
  process.exit(evidence.allPassed ? 0 : 1)
}

main().catch((e) => { console.error('harness error: ' + e.message); finish() })
