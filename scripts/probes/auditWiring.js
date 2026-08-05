'use strict'

/**
 * PROBE — 2026-08-05. NO model call, no writes. Not a test; see scripts/probes/README.md.
 *
 * QUESTION: is the agent audit store wired in the REAL assembly, with the REAL launcher
 * environment — as opposed to appearing wired when app.js is read?
 *
 * That exact distinction is what hid the defect after the first canary: the code looked
 * wired, `artifactStore` was undefined in real assembly, `.aroma/agent-audit/` was never
 * created, and one real execution left no record.
 *
 * HOW THIS IS DETERMINED, AND ITS LIMIT — stated plainly because it matters:
 *
 *   `src/app.js` ends with `const app = createApp()` and exports that instance, so
 *   `require('./app')` performs the SAME assembly the live process performed, with no opts
 *   and no injection. Running it here under the launcher's own environment therefore
 *   executes the identical code path with the identical inputs.
 *
 *   IT IS NOT INTROSPECTION OF PID <live>. `app.agentAuditConfigured` is not exposed over
 *   HTTP, so the running process's own value cannot be read from outside it. This is one
 *   step short of that: same code, same env, separate process. If the live process was
 *   started with a different environment than the launcher sets, this can disagree with it.
 *
 * Run:
 *   $env:AGENT_BRIDGE = 'on'   # ... and the rest of the launcher's env; see below
 *   node scripts/probes/auditWiring.js
 */

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const app = require(path.join(ROOT, 'src/app'))

const { resolveAgentBridge, authorizeExecution } = require(path.join(ROOT, 'src/agent/agentAuthorization'))
const { resolveArtifactDir } = require(path.join(ROOT, 'src/runtime/artifactDir'))

const artifactRoot = (() => {
  try { return resolveArtifactDir(process.env, path.resolve(ROOT, '.aroma')) } catch (e) { return { ok: false, reason: e && e.message } }
})()

const auditDir = artifactRoot && artifactRoot.dir ? path.join(artifactRoot.dir, 'agent-audit') : null
let auditFiles = null
try { auditFiles = auditDir ? fs.readdirSync(auditDir) : null } catch (_) { auditFiles = null }

console.log(JSON.stringify({
  probe: 'auditWiring',
  // ── THE ANSWER ──────────────────────────────────────────────────────────
  agentAuditConfigured: app.agentAuditConfigured === undefined ? null : app.agentAuditConfigured,
  // ── the surrounding facts ───────────────────────────────────────────────
  AGENT_BRIDGE: resolveAgentBridge(),
  WORKER_INVOCATION: process.env.WORKER_INVOCATION || '(unset)',
  DEVELOP_DISPATCH: process.env.DEVELOP_DISPATCH || '(unset)',
  COMPUTER_OPERATOR: process.env.COMPUTER_OPERATOR || '(unset)',
  artifactRootOk: !!(artifactRoot && artifactRoot.ok),
  artifactRootReason: (artifactRoot && artifactRoot.reason) || null,
  auditDirExists: !!auditFiles,
  auditRecordCount: auditFiles ? auditFiles.length : null,
  authorization: (() => {
    try {
      return authorizeExecution({
        worker: process.env.WORKER_INVOCATION === 'on' ? 'on' : 'off',
        develop: process.env.DEVELOP_DISPATCH === 'on' ? 'on' : 'off',
        agent: resolveAgentBridge(),
        computer: process.env.COMPUTER_OPERATOR === 'on' ? 'on' : 'off',
        dispatcherConfigured: false,
        agentRunnerConfigured: app.agentAuditConfigured === true
      })
    } catch (e) { return { error: e && e.message } }
  })()
}, null, 2))
