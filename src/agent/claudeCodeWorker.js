'use strict'

/**
 * claudeCodeWorker.js — the real dispatcher behind runEnquiry.
 *
 * Spawns the SAME CLI the Agent Bridge already uses, with the same fence: an explicit
 * `--allowedTools` grant and no shell. What it adds is the one thing the enquiry needs —
 * **session continuity**, so round 2 does not have to be handed round 1's findings as text.
 *
 * ── THE GRANT IS PER DISPATCH, NEVER A WIDENED DEFAULT ───────────────────────
 * `buildAllowedTools()` in agentBridgeWorker returns a fixed `['Read','Edit','Write']`, and
 * that array is a **fence made of absence**: the worker cannot drive a browser because the
 * capability was never handed to it, not because a rule forbids it.
 *
 * So the tools here are a PARAMETER with a read-only default. A caller that wants more must
 * say so at the call site, per enquiry — the moment it becomes a process-wide default, the
 * fence stops existing for every dispatch including the ones nobody reviewed.
 *
 * ── READ-ONLY BY DEFAULT ─────────────────────────────────────────────────────
 * An enquiry is a question, not a change. `Read` alone is the default; `Edit`/`Write` are not
 * granted unless a caller asks, and asking is visible in the enquiry record.
 */

const { spawn } = require('node:child_process')
const { resolveAgentCliCommand, buildChildEnv } = require('./agentBridgeWorker')

/** An enquiry asks questions. It does not change files. */
const READ_ONLY_TOOLS = Object.freeze(['Read', 'Grep', 'Glob'])

const DEFAULT_TIMEOUT_MS = 180000
const MAX_OUTPUT = 200000

/**
 * @param {object} options
 * @param {string[]} [options.allowedTools] per-dispatch grant. Default: read-only.
 * @param {string}   [options.cwd]          where the CLI runs
 * @param {number}   [options.timeoutMs]
 * @param {function} [options.spawnFn]      injected in tests; no test ever spawns a real CLI
 */
function createClaudeCodeWorker (options = {}) {
  const allowedTools = Array.isArray(options.allowedTools) ? options.allowedTools : READ_ONLY_TOOLS
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS
  const spawnFn = typeof options.spawnFn === 'function' ? options.spawnFn : spawn
  const cwd = options.cwd || process.cwd()
  // Injected in tests so an unresolvable CLI can be exercised without touching the machine.
  const resolveFn = typeof options.resolveFn === 'function' ? options.resolveFn : resolveAgentCliCommand

  /**
   * Build the argument ARRAY — never a shell string. `--session-id` opens the conversation on
   * round 1; `--resume` continues the SAME one afterwards, which is what keeps the worker's
   * context on its own side instead of in a paste.
   */
  function buildArgs ({ goal, sessionId, resume }) {
    const args = ['-p', String(goal || '')]
    if (resume) args.push('--resume', String(resume))
    else if (sessionId) args.push('--session-id', String(sessionId))
    args.push('--allowedTools', allowedTools.join(' '))
    args.push('--output-format', 'json')
    return args
  }

  /** @returns {Promise<{sessionId, result, costUsd, numTurns, isError}>} */
  async function dispatch ({ goal, sessionId, resume }) {
    // resolveAgentCliCommand returns { ok, command, reason } — NOT a bare string. Treating it
    // as one produced a spawn error four levels away from the cause, which the enquiry then
    // reported faithfully as 「中途失敗」 without being able to say why. Read the shape.
    const resolved = resolveFn(process.env)
    // No fallback to a bare 'claude': a command that cannot start is not a fallback, it is a
    // failure that arrives later and less clearly.
    if (!resolved || resolved.ok !== true) {
      throw new Error('agent CLI not resolvable — ' + ((resolved && resolved.reason) || 'unknown reason'))
    }
    const command = resolved.command

    const args = buildArgs({ goal, sessionId, resume })

    return new Promise((resolve, reject) => {
      let out = ''
      let killed = false
      const child = spawnFn(command, args, {
        cwd,
        shell: false,
        env: buildChildEnv(process.env),
        stdio: ['ignore', 'pipe', 'pipe']
      })
      const timer = setTimeout(() => { killed = true; try { child.kill() } catch (_) {} }, timeoutMs)
      timer.unref && timer.unref()

      child.stdout.on('data', (d) => { if (out.length < MAX_OUTPUT) out += String(d) })
      child.stderr.on('data', (d) => { if (out.length < MAX_OUTPUT) out += String(d) })
      child.on('error', (e) => { clearTimeout(timer); reject(e) })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (killed) return reject(new Error('agent CLI timed out after ' + timeoutMs + 'ms'))
        let parsed = null
        try {
          // The CLI prints one JSON object with --output-format json.
          const line = out.split('\n').reverse().find((l) => l.trim().startsWith('{'))
          parsed = JSON.parse(line)
        } catch (_) { /* handled below */ }
        if (!parsed) {
          return reject(new Error('agent CLI produced no parsable JSON (exit ' + code + '): ' + out.slice(0, 300)))
        }
        resolve({
          sessionId: parsed.session_id || sessionId || resume || null,
          result: typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result ?? null),
          costUsd: Number(parsed.total_cost_usd || 0),
          numTurns: Number(parsed.num_turns || 0),
          isError: parsed.is_error === true
        })
      })
    })
  }

  return { dispatch, buildArgs, allowedTools }
}

module.exports = { createClaudeCodeWorker, READ_ONLY_TOOLS }
