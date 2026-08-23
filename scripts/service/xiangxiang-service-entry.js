'use strict'
/**
 * xiangxiang-service-entry.js — THE HEADLESS SEAM, AND NOTHING ELSE.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THIS IS NOT A SECOND SERVER. It resolves the production repo, moves into it, applies the
 * one runtime contract, checks the install-time values are actually present, and then requires
 * the ORDINARY production entrypoint. No http server here, no health endpoint, no route, no
 * second copy of anything the application already does. If this file ever grows one, the
 * service and the interactive process stop being the same assistant.
 *
 * ⛔ AND src/index.js IS UNTOUCHED. Ownership moved by adding a caller, not by teaching the
 * application about services. That is what keeps `bootCommit` honest: the app still reads
 * `.git/HEAD` from the repo root it runs out of, and because that root IS the production repo,
 * the answer is the same SHA production already reports.
 *
 * ⛔ CWD IS LOAD-BEARING, NOT COSMETIC. `src/app.js:18` calls `require('dotenv').config()`,
 * which reads `<cwd>/.env`. The superseded service set its working directory to a ProgramData
 * folder, so it would have read a different .env — a different OpenAI key, a different Aroma
 * System key, or none at all. Changing into the repo is what preserves credential resolution
 * exactly as production has it today.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const path = require('node:path')
const fs = require('node:fs')

const { PRODUCTION_REPO, STABLE_ENV, FORBIDDEN_ENV } = require('./runtimeContract')
const { checkInstallTimeEnv, preflightReport } = require('./serviceEnvPreflight')
const { readServiceEnvFile, serviceEnvReport } = require('./serviceEnvFile')
const { checkMainBranch, branchGuardReport } = require('./mainBranchGuard')

/**
 * ⛔ THE REPO IS A CONSTANT, NOT AN INPUT.
 *
 * This used to honour `process.env.AROMA_SERVICE_REPO`, which meant anything able to set a
 * machine or service environment variable could point the resident service at a different
 * tree — and any directory containing `src/index.js` would have booted, under production's
 * service identity, reporting whatever `bootCommit` that tree happened to carry. A test seam
 * is not worth an ambient redirect of production identity, so there is no longer one here:
 * fixtures inject `deps.resolveRepo` instead, which cannot be reached from the environment.
 */
function resolveRepo () {
  const root = PRODUCTION_REPO
  const entry = path.join(root, 'src', 'index.js')
  if (!fs.existsSync(entry)) throw new Error('service entry: no production entrypoint at ' + entry)
  return { root, entry }
}

/**
 * Apply the stable contract.
 *
 * ⛔ THE AMBIENT ENVIRONMENT DOES NOT WIN. Every stable key is SET, not defaulted: a `||=`
 * would let a stale machine-scope variable silently override the port or the provider, and the
 * resulting process would be misconfigured in a way nothing logs. The forbidden keys are
 * DELETED for the same reason — the superseded service's data and artifact roots must not reach
 * the application even if something upstream still exports them.
 *
 * ⛔ AND IT RUNS AFTER service.env, ON PURPOSE. The credential file cannot move the port or any
 * other runtime switch; the allowlist refuses such a key outright, and this ordering means even
 * a future hole there could not take effect.
 */
function applyRuntimeContract (env, stable = STABLE_ENV, forbidden = FORBIDDEN_ENV) {
  for (const [k, v] of Object.entries(stable)) env[k] = v
  for (const k of forbidden) delete env[k]
  return env
}

/**
 * Load the service-only credential file, if one is configured.
 *
 * ⛔ A REJECTED FILE STOPS THE PROCESS. An unknown key means the installer believed they were
 * configuring something; starting anyway would hide that belief rather than correct it. Values
 * already present in the environment are not overwritten.
 */
function loadServiceEnvFile (env = process.env, readFile = undefined) {
  const result = readServiceEnvFile(env.AROMA_SERVICE_ENV_FILE, readFile)
  if (!result.ok) return result
  for (const [k, v] of Object.entries(result.values)) {
    if (env[k] === undefined || env[k] === '') env[k] = v
  }
  return result
}

/** Everything except the final require, so a test can exercise it without booting a server. */
function prepare (env = process.env, deps = {}) {
  const { root, entry } = (deps.resolveRepo || resolveRepo)()
  const branch = (deps.checkMainBranch || checkMainBranch)(root, deps)
  const serviceEnv = loadServiceEnvFile(env, deps.readFile)
  applyRuntimeContract(env)
  return { root, entry, branch, serviceEnv, preflight: checkInstallTimeEnv(env) }
}

function main (env = process.env, deps = {}) {
  const log = deps.log || console.log
  const err = deps.error || console.error
  const chdir = deps.chdir || process.chdir
  const prepared = prepare(env, deps)

  // ⛔ THE BRANCH IS CHECKED BEFORE ANYTHING ELSE MATTERS. Credentials being perfect is no
  // reason to serve unreviewed code, and an unattended boot-time process is precisely where
  // 「whatever happens to be checked out」 would go unnoticed.
  err(branchGuardReport(prepared.branch))
  if (!prepared.branch.ok) {
    throw new Error('service entry: refusing to serve a repo that is not on main — state=' +
      prepared.branch.state + ' ref=' + (prepared.branch.ref || 'none') +
      '. Nothing was checked out, reset or repaired; put the tree back on main and start again.')
  }

  err(serviceEnvReport(prepared.serviceEnv))
  if (!prepared.serviceEnv.ok) {
    if (prepared.serviceEnv.readable === false) {
      throw new Error('service entry: AROMA_SERVICE_ENV_FILE is configured but could not be read. ' +
        'Ambient credentials may not stand in for a file the installer chose; check the path and its ACL.')
    }
    throw new Error('service entry: service.env rejected — unexpectedKeys=' +
      (prepared.serviceEnv.unexpectedKeys.join(',') || 'none') +
      ' duplicateKeys=' + (prepared.serviceEnv.duplicateKeys.join(',') || 'none') +
      ' malformedLineCount=' + prepared.serviceEnv.malformedLineCount)
  }

  err(preflightReport(prepared.preflight))
  if (!prepared.preflight.ok) {
    // ⛔ FAIL CLOSED, LOUDLY, ON stderr. WinSW keeps stderr, so this line is the whole of a
    // headless diagnosis: which key was missing, and nothing whatsoever about its value.
    throw new Error('service entry: missing install-time value(s): ' + prepared.preflight.missing.join(', '))
  }

  chdir(prepared.root)
  log('[AROMA-SERVICE] owner=windows-service repo=' + prepared.root + ' entry=' + prepared.entry)
  return (deps.start || require)(prepared.entry)
}

module.exports = { resolveRepo, applyRuntimeContract, loadServiceEnvFile, prepare, main }

/* the boot path — exercised by installation, never by a unit test */
if (require.main === module) main()
