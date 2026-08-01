'use strict'

/**
 * powershellJsonRunner.js — THE production PowerShell transport. One, and only one.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * Two separate PowerShell launchers had drifted apart, and both were broken in ways that only
 * showed up when something real was driven through them:
 *
 *   . a JSON payload in argv was mangled by Windows quoting — the probe's own ops came back
 *     `bad_payload` when invoked one way and worked when invoked another;
 *   . `-File` silently failed to take effect in one shape and PowerShell printed its BANNER
 *     into stdout, which then failed to parse as JSON.
 *
 * Both are transport bugs that look like application bugs. A caller sees "bad payload" or "not
 * JSON" and starts debugging the script, which is fine and correct. So the transport becomes one
 * module, and the failure modes become explicit refusals rather than mysteries.
 *
 * ── NOTHING GOES THROUGH A COMMAND LINE ────────────────────────────────────
 * The payload never touches argv. It is JSON -> UTF-8 -> base64 -> STDIN, and base64 is ASCII,
 * so no code page, no quoting rule and no locale can alter a byte of it. argv carries only fixed
 * flags and a script path this module chose from a frozen map.
 *
 * ── THE CALLER CANNOT NAME A SCRIPT ────────────────────────────────────────
 * Script IDs are a closed enum. A caller passes 'machine-probe', not a path — so no request,
 * work order or message can ever cause an arbitrary file to be executed, and there is no string
 * concatenation anywhere near a command.
 */

const { spawnSync } = require('node:child_process')
const path = require('node:path')

/** The absolute interpreter. Never resolved from PATH: PATH is someone else's decision. */
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'

const REPO = path.resolve(__dirname, '..', '..')

/** The ONLY scripts production may run. A caller names an id; this map owns the path. */
const SCRIPTS = Object.freeze({
  'machine-probe': 'scripts/computer/probe-machine.ps1',
  'uia-canary': 'scripts/computer/uiaCanary.ps1',
  'collect-identity': 'scripts/computer/collect-identity.ps1'
})

/**
 * The one line of stdout that carries the answer.
 *
 * Everything else — banners, warnings, a stray Write-Host — is noise, and noise that PARSES is
 * far more dangerous than noise that does not. A distinctive ASCII prefix means the runner never
 * has to guess which line was the result.
 */
const ENVELOPE_PREFIX = 'AROMA_JSON_B64:'

const DEFAULT_TIMEOUT_MS = 300 * 1000

const fail = (refusal, detail) => ({ ok: false, refusal, detail: detail === undefined ? null : detail })

/** Fixed argv. No shell, no command string, no interpolation. */
function buildArgv (scriptPath) {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath]
}

function encodePayload (payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
}

/**
 * Pull the single envelope out of stdout.
 *
 * Exactly one is required. Zero means the script produced no answer — including the banner case,
 * where stdout is full of text and none of it is a result. More than one means two answers, and
 * choosing between them would be inventing a result.
 */
function extractEnvelope (stdout) {
  const lines = String(stdout || '').split(/\r?\n/)
  const envelopes = lines.filter((l) => l.startsWith(ENVELOPE_PREFIX))
  if (envelopes.length === 0) return fail('no_envelope', String(stdout || '').slice(0, 200))
  if (envelopes.length > 1) return fail('multiple_envelopes', String(envelopes.length))

  const b64 = envelopes[0].slice(ENVELOPE_PREFIX.length).trim()
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length === 0) return fail('bad_base64', b64.slice(0, 80))

  let json
  try {
    const buf = Buffer.from(b64, 'base64')
    // Round-trip check: Buffer.from is lenient and will silently drop invalid characters, so a
    // corrupted envelope could decode to something plausible. Re-encoding catches that.
    if (buf.toString('base64').replace(/=+$/, '') !== b64.replace(/=+$/, '')) return fail('bad_base64', 'not a faithful encoding')
    json = buf.toString('utf8')
  } catch (e) { return fail('bad_base64', e.message) }

  try { return { ok: true, result: JSON.parse(json) } } catch (e) { return fail('bad_json', json.slice(0, 200)) }
}

/**
 * @param {object} [deps.spawn]  injected for tests; production uses spawnSync
 */
function createPowershellJsonRunner (deps = {}) {
  const spawn = deps.spawn || spawnSync
  const repo = deps.repo || REPO
  const timeoutMs = Number.isInteger(deps.timeoutMs) ? deps.timeoutMs : DEFAULT_TIMEOUT_MS

  return {
    POWERSHELL,
    SCRIPTS,
    ENVELOPE_PREFIX,

    /**
     * @param {string} scriptId  one of SCRIPTS — never a path
     * @param {object} payload   serialised to stdin, never to argv
     */
    run (scriptId, payload) {
      const rel = SCRIPTS[scriptId]
      if (!rel) return fail('unknown_script_id', String(scriptId))

      const scriptPath = path.join(repo, rel.split('/').join(path.sep))
      const argv = buildArgv(scriptPath)
      const input = encodePayload(payload === undefined ? {} : payload)

      let r
      try {
        r = spawn(POWERSHELL, argv, {
          input,
          encoding: 'utf8',
          timeout: timeoutMs,
          windowsHide: true,
          shell: false // stated rather than assumed: a shell would reintroduce quoting
        })
      } catch (e) { return fail('spawn_failed', e.message) }

      if (!r) return fail('spawn_failed', 'no result')
      if (r.error) return fail(r.error.code === 'ETIMEDOUT' ? 'timeout' : 'spawn_failed', r.error.message)
      if (r.signal) return fail('killed', r.signal)
      if (r.status !== 0) return fail('non_zero_exit', String(r.status) + ' :: ' + String(r.stderr || '').slice(0, 200))

      const env = extractEnvelope(r.stdout)
      // stderr is carried alongside, never merged into the result — a diagnostic that can be
      // mistaken for data is how a warning becomes a value.
      if (!env.ok) return Object.assign({}, env, { stderr: String(r.stderr || '').slice(0, 400) })
      return { ok: true, result: env.result, stderr: String(r.stderr || '').slice(0, 400) }
    }
  }
}

/**
 * The production composition: ONE runner, shared. Both the machine probe and the desktop adapter
 * receive this same instance, so there is exactly one place where PowerShell is started.
 */
function buildProductionRunner (opts = {}) {
  return createPowershellJsonRunner(opts)
}

module.exports = {
  createPowershellJsonRunner, buildProductionRunner,
  POWERSHELL, SCRIPTS, ENVELOPE_PREFIX, buildArgv, encodePayload, extractEnvelope, DEFAULT_TIMEOUT_MS
}
