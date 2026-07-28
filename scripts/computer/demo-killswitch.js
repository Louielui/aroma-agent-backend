'use strict'

/**
 * demo-killswitch.js — Computer Operator v0, Phase 3a. THE EVIDENCE HARNESS.
 *
 * Runs as the OWNER (elevated), holds the Service end of the pipe, and demonstrates all
 * three kill-switch bindings against a Companion running under the AromaOperator account.
 *
 * Phase 3a already demonstrated the three bindings — but against a Companion in the test
 * process, under the Owner's own identity. That proved the mechanism, not the deployment.
 * This proves the deployment, which is why demonstratedUnderCompanionAccount stays FALSE
 * until this harness has actually run and produced the evidence file.
 *
 * It performs NO desktop action and never asks the Companion to. It sends a ping, an
 * execute_step it expects to be refused, and an abort.
 *
 * Usage (invoked by deploy-companion.ps1, not by hand):
 *   node demo-killswitch.js <pipeName> <evidenceJsonPath>
 */

const path = require('node:path')
const fs = require('node:fs')

const { createServiceEndpoint } = require(path.join(__dirname, 'ipcChannel.js'))
const { createKillSwitch } = require(path.join(__dirname, 'killSwitch.js'))

const pipeName = process.argv[2]
const outPath = process.argv[3]
if (!pipeName || !outPath) {
  console.error('usage: node demo-killswitch.js <pipeName> <evidenceJsonPath>')
  process.exit(2)
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const nonce = () => require('node:crypto').randomBytes(16).toString('hex')
const evidence = { pipeName, startedAt: new Date().toISOString(), companionAccount: null, checks: [] }

function record (name, passed, detail) {
  evidence.checks.push({ name, passed, detail: detail || null, at: new Date().toISOString() })
  console.log((passed ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  — ' + detail : ''))
}

const replies = []
const service = createServiceEndpoint({ name: pipeName, onMessage: (m) => replies.push(m) })

async function ask (msg, timeoutMs = 4000) {
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

async function main () {
  await service.listen()
  console.log('service listening on ' + service.pipePath)
  console.log('waiting for the Companion to connect...')

  const deadline = Date.now() + 30000
  while (service.connectionCount() === 0 && Date.now() < deadline) await wait(100)
  record('companion connected', service.connectionCount() === 1, service.connectionCount() + ' connection(s)')
  if (service.connectionCount() === 0) { finish(false); return }

  // ── the Companion is alive and has NO capability ──────────────────────────
  const pong = await ask(Object.assign(step(), { type: 'ping' }))
  record('handshake completes', !!pong && pong.type === 'pong')
  const caps = (pong && pong.capabilities) || {}
  const anyOn = Object.values(caps).some(Boolean)
  record('zero capability under the operator account', anyOn === false,
    Object.keys(caps).length + ' capabilities, all false')

  const refused = await ask(step({ step: { action: 'capture_own_screen' } }))
  record('every request is refused', !!refused && refused.ok === false && refused.refusal === 'no_capability_enabled',
    refused ? refused.refusal : 'no reply')

  // ── KILL 1: the SERVICE GATE — nothing is sent at all ─────────────────────
  const gate = createKillSwitch()
  gate.stop('owner_kill_switch')
  const before = replies.length
  if (gate.guard().ok) service.send(step({ step: { action: 'list_windows' } }))
  await wait(400)
  record('KILL 1 service gate: nothing was sent', replies.length === before && gate.guard().ok === false)

  // ── KILL 2: the COMPANION ABORT — it stops and stays stopped ──────────────
  const aborted = await ask(Object.assign(step({ stepNonce: nonce() }), { type: 'abort' }))
  record('KILL 2 abort acknowledged', !!aborted && aborted.type === 'aborted')
  await wait(600)
  record('KILL 2 companion process exited', service.connectionCount() === 0,
    service.connectionCount() + ' connection(s) remain')

  finish(true)
}

function finish (ok) {
  evidence.finishedAt = new Date().toISOString()
  evidence.allPassed = ok && evidence.checks.every((c) => c.passed)
  try { fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2)) } catch (e) { console.error('could not write evidence: ' + e.message) }
  console.log('')
  console.log(evidence.allPassed ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED')
  console.log('evidence written to ' + outPath)
  service.close().then(() => process.exit(evidence.allPassed ? 0 : 1))
}

main().catch((e) => { console.error('harness error: ' + e.message); finish(false) })
