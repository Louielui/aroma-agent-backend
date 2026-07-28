'use strict'

/**
 * companion-entry.js — Computer Operator v0, Phase 3a. The runnable Companion.
 *
 * Runs in the interactive session of the AromaOperator account. It connects to the
 * Service's named pipe, answers with a refusal, and exits when told to or when the
 * channel goes away.
 *
 * ── IT STILL HAS ZERO CAPABILITY ──────────────────────────────────────────────
 * This file adds a transport and a lifecycle. It adds NO ability to observe or act:
 * every capability in the register is false, and the code to move a mouse, read a screen
 * or open an app is not present in this process. Phase 3b adds observation only, behind
 * its own GO.
 *
 * ── IT RUNS FROM A STAGED COPY, NOT FROM THE REPO ─────────────────────────────
 * deploy-companion.ps1 copies this file and the three modules it needs into
 * C:\Aroma\ComputerOperator-Companion, and DENIES the operator account access to the
 * repo. The repo holds .env — API keys, the Owner password — and the governance code
 * itself. An operator account that can read those is not contained, whatever the process
 * does or does not do.
 *
 * Exit codes are the evidence: 0 = told to stop, 3 = channel lost. A Companion that
 * survives either is a bug.
 */

const path = require('node:path')

const { createCompanion } = require(path.join(__dirname, 'companion.js'))
const { createCompanionEndpoint } = require(path.join(__dirname, 'ipcChannel.js'))

const pipeName = process.argv[2]
if (!pipeName) {
  console.error('COMPANION FATAL: no pipe name given')
  process.exit(2)
}

const log = (event, extra) => {
  // One line per event, allowlisted fields only. Never a screen, never a path, never a
  // credential — this process has access to none of those, and the log must not become
  // the first place that changes.
  const rec = Object.assign({ event, at: new Date().toISOString(), pid: process.pid }, extra || {})
  console.log('[COMPANION] ' + JSON.stringify(rec))
}

const companion = createCompanion({
  onAudit: (a) => log('refused', { action: a.action, reason: a.refusalReason })
})

const endpoint = createCompanionEndpoint({
  name: pipeName,
  onMessage: (msg) => {
    const reply = companion.handle(msg)
    if (msg && msg.type === 'abort') {
      log('aborted', { by: 'service' })
      // Told to stop: stop. There is no acknowledgement-then-continue path.
      setTimeout(() => { endpoint.close(); process.exit(0) }, 50)
    }
    return reply
  }
})

endpoint.connect()
  .then(() => {
    log('connected', { pipe: pipeName, capabilities: companion.capabilities })
    log('ready', { anyCapabilityEnabled: Object.values(companion.capabilities).some(Boolean) })
  })
  .catch((err) => {
    console.error('COMPANION FATAL: could not connect: ' + (err && err.message))
    process.exit(2)
  })

// The channel going away IS the OS kill switch: the Windows service stopping, or this
// account logging out, destroys the pipe. There is no reconnect — a Companion that can
// rejoin after being stopped has not been stopped.
const watchdog = setInterval(() => {
  if (!endpoint.isConnected()) {
    log('channel_lost', { action: 'exiting' })
    clearInterval(watchdog)
    process.exit(3)
  }
}, 250)

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { log('signal', { sig }); endpoint.close(); process.exit(0) })
}
