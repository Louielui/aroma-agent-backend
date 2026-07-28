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
// THE COMPANION CREATES THE PIPE. Measured, not assumed: libuv gives Everyone READ ONLY
// on a named pipe, so a pipe created by the Owner cannot be opened duplex by this
// account — which is why the first deployment saw zero connections and no error. As the
// creator, this process gets full access; the elevated Service matches the
// Administrators ACE. Listening is a transport role, not authority: it still decides
// nothing and still refuses everything.
const { createPipeListener } = require(path.join(__dirname, 'ipcChannel.js'))

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

const endpoint = createPipeListener({
  name: pipeName,
  onMessage: (msg) => {
    const reply = companion.handle(msg)
    if (msg && msg.type === 'abort') {
      log('aborted', { by: 'service' })
      // Told to stop: stop. There is no acknowledgement-then-continue path. The reply is
      // returned first so the Service sees the acknowledgement before the pipe closes.
      setTimeout(() => { endpoint.close().then(() => process.exit(0)).catch(() => process.exit(0)) }, 100)
    }
    return reply
  }
})

endpoint.listen()
  .then(() => {
    log('listening', { pipe: endpoint.pipePath, capabilities: companion.capabilities })
    log('ready', { anyCapabilityEnabled: Object.values(companion.capabilities).some(Boolean) })
  })
  .catch((err) => {
    console.error('COMPANION FATAL: could not create the pipe: ' + (err && err.message))
    process.exit(2)
  })

// A Companion nobody ever connects to must not sit there forever. If the Service has not
// arrived within this window, exit — an orphan holding a pipe open in an interactive
// session is exactly the kind of thing that should not outlive the run that started it.
const IDLE_EXIT_MS = 120000
const startedAt = Date.now()
let everConnected = false
const watchdog = setInterval(() => {
  if (endpoint.connectionCount() > 0) { everConnected = true; return }
  if (everConnected) {
    // The Service went away: the OS kill switch, or the run finishing. Either way, stop.
    log('channel_lost', { action: 'exiting' })
    clearInterval(watchdog)
    endpoint.close().then(() => process.exit(3)).catch(() => process.exit(3))
    return
  }
  if (Date.now() - startedAt > IDLE_EXIT_MS) {
    log('never_connected', { action: 'exiting', waitedMs: IDLE_EXIT_MS })
    clearInterval(watchdog)
    endpoint.close().then(() => process.exit(4)).catch(() => process.exit(4))
  }
}, 250)

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { log('signal', { sig }); endpoint.close(); process.exit(0) })
}
