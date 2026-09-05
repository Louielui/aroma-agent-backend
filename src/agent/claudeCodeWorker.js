'use strict'

/**
 * claudeCodeWorker.js — the real dispatcher behind runEnquiry.
 *
 * Spawns the SAME CLI the Agent Bridge already uses, with the same env allow-list and no shell.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHAT `--allowedTools` IS, AND WHAT IT IS NOT. (Correction, 2026-09-05.)
 *
 * This file used to describe `--allowedTools` as "a fence made of absence". It is not one. The
 * CLI reference states it plainly: `--allowedTools` names "tools that execute without prompting
 * for permission", and those tools stay "available in context" — then says outright: "To
 * restrict which tools are available, use `--tools` instead."
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── WHAT ACTUALLY CONFINES THIS DISPATCH ─────────────────────────────────────
 *   --restricted            removes the tools that run commands or code, and WebFetch, unless
 *                           named individually in --tools; CONFINES THE BUILT-IN FILE TOOLS TO
 *                           THE WORKING DIRECTORIES; loads only managed settings and
 *                           --settings; refuses bypassPermissions; refuses cloud sessions.
 *   --tools                 the availability allow-list, comma separated.
 *   --strict-mcp-config     with an empty server map, so no MCP server is loaded.
 *   --permission-mode       explicit, so a settings file cannot supply a wider defaultMode.
 *   --max-turns             an agentic-turn bound the CLI enforces and errors on.
 *   --json-schema           the result contract; the CLI validates and re-prompts, and the
 *                           validated object comes back in `structured_output`.
 *
 * ⛔ STILL NOT PROVEN, so the list above is not read as a guarantee: that `--restricted` leaves
 * the CLI's login untouched; that no MANAGED settings exist here (restricted still loads them,
 * so only USER and PROJECT settings are excluded); that `--max-budget-usd` binds under
 * subscription auth; and that a real CLI process tree dies when asked. Each needs a live run.
 *
 * ── THE RESULT CONTRACT IS THE DOCUMENTED ONE ────────────────────────────────
 * Per the structured-outputs documentation, a run succeeded only when the result message has
 * `subtype === 'success'` AND carries `structured_output`. The docs are explicit that a
 * `success` subtype WITHOUT `structured_output` must be treated as a failure, and that a failed
 * structured output arrives as `error_max_structured_output_retries`. An earlier version of
 * this file GUESSED the payload out of `result` — an object, or a JSON string, whichever
 * turned up. That guess is gone.
 *
 * ── TERMINATION: TWO DIFFERENT CLAIMS, KEPT APART ────────────────────────────
 *   observedPidsGone       every pid we actually saw is verifiably gone — a fact we can check
 *   descendantsTerminated  the whole process TREE stopped — a fact we currently CANNOT check,
 *                          because we have no tree boundary (no job object, no cgroup). It is
 *                          therefore UNKNOWN on every path, and saying otherwise would be a
 *                          claim about processes nobody enumerated.
 */

const { spawn } = require('node:child_process')
const fsDefault = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { resolveAgentCliCommand, buildChildEnv } = require('./agentBridgeWorker')
const { assertSandboxUnderTmpdir, assertMintedWorkspace } = require('../workers/workspace/tmpdirSandbox')
const {
  ENQUIRY_JSON_SCHEMA, validateEnquiryPayload, verifyCitations, isInside, deepFreeze
} = require('./enquirySchema')

/** An enquiry asks questions. It does not change files. FIXED. */
const READ_ONLY_TOOLS = deepFreeze(['Read', 'Grep', 'Glob'])

/** Under `--restricted` these are the only non-managed settings the CLI reads. */
const FIXED_SETTINGS = deepFreeze({ permissions: { defaultMode: 'default' } })

/** No MCP server, stated as data rather than as an absence. */
const EMPTY_MCP_CONFIG = deepFreeze({ mcpServers: {} })

/**
 * ⛔ THE ARGV IS BUILT FROM THESE PRIVATE STRINGS, SERIALISED ONCE AT LOAD, so an export edited
 * after require cannot change what reaches the CLI. The objects are deep frozen as well.
 */
const SETTINGS_JSON = JSON.stringify(FIXED_SETTINGS)
const MCP_JSON = JSON.stringify(EMPTY_MCP_CONFIG)
const SCHEMA_JSON = JSON.stringify(ENQUIRY_JSON_SCHEMA)
const TOOLS_CSV = READ_ONLY_TOOLS.join(',')

/**
 * ⛔ THE NAMING PREFIX IS GONE FROM THIS FILE. (v4.)
 * It used to stand in for provenance, and a prefix is a naming convention: anyone can mkdtemp
 * the same one in the same place. Provenance is now asked of tmpdirSandbox's private mint
 * register through assertMintedWorkspace, and nothing here reasons about names.
 */

const PERMISSION_MODE = 'default'
const DEFAULT_TIMEOUT_MS = 180000
const DEFAULT_MAX_TURNS = 8
const DEFAULT_TERMINATION_GRACE_MS = 15000
/** ⛔ ONE budget, shared by both pipes. Two separate caps are two ways to be surprised. */
const MAX_TOTAL_BYTES = 204000

const TREE = Object.freeze({ UNKNOWN: 'UNKNOWN', NOT_REQUESTED: 'NOT_REQUESTED' })
const PIDS = Object.freeze({
  CONFIRMED_GONE: 'CONFIRMED_GONE',
  UNKNOWN: 'UNKNOWN',
  NOT_OBSERVED: 'NOT_OBSERVED',
  NOT_REQUESTED: 'NOT_REQUESTED'
})

const STOP_REASON = Object.freeze({
  NONE: 'NONE', TIMEOUT: 'TIMEOUT', CANCELLED: 'CANCELLED', OUTPUT_LIMIT: 'OUTPUT_LIMIT'
})

const FAILURE = Object.freeze({
  STOPPED: 'STOPPED',
  CHILD_DID_NOT_EXIT: 'CHILD_DID_NOT_EXIT',
  NONZERO_EXIT: 'NONZERO_EXIT',
  NO_PARSABLE_JSON: 'NO_PARSABLE_JSON',
  ENVELOPE_INVALID: 'ENVELOPE_INVALID',
  CLI_REPORTED_ERROR: 'CLI_REPORTED_ERROR',
  STRUCTURED_OUTPUT_MISSING: 'STRUCTURED_OUTPUT_MISSING',
  SESSION_MISMATCH: 'SESSION_MISMATCH',
  PAYLOAD_INVALID: 'PAYLOAD_INVALID',
  CITATION_OUTSIDE_COPY: 'CITATION_OUTSIDE_COPY',
  TRUNCATED: 'TRUNCATED',
  WORKSPACE_CHANGED: 'WORKSPACE_CHANGED',
  ABORTED_BEFORE_SPAWN: 'ABORTED_BEFORE_SPAWN'
})

function failure (code, message, extra) {
  const e = new Error(message)
  e.failure = code
  if (extra) Object.assign(e, extra)
  return e
}

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
/** win32 compares paths case-insensitively; everywhere else it does not. */
const foldPath = (p) => (process.platform === 'win32' ? String(p).toLowerCase() : String(p))

/**
 * ⛔ `Number(x)` TURNS GARBAGE INTO A PLAUSIBLE NUMBER. `Number(null)` is 0, `Number('')` is 0 —
 * so a missing cost used to arrive as a confident 0.00. These readers refuse instead, and an
 * ABSENT value stays null so "unknown" survives the handoff.
 */
function readFiniteNumber (o, key, min = 0) {
  if (!hasOwn(o, key) || o[key] === undefined) return { ok: true, value: null }
  const v = o[key]
  if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, why: `${key} must be a finite number` }
  if (v < min) return { ok: false, why: `${key} must be >= ${min}` }
  return { ok: true, value: v }
}
function readInteger (o, key, min = 0) {
  if (!hasOwn(o, key) || o[key] === undefined) return { ok: true, value: null }
  const v = o[key]
  if (!Number.isInteger(v)) return { ok: false, why: `${key} must be an integer` }
  if (v < min) return { ok: false, why: `${key} must be >= ${min}` }
  return { ok: true, value: v }
}

function createClaudeCodeWorker (options = {}) {
  // ⛔ ESCALATION IS REFUSED AT CONSTRUCTION, NOT FILTERED LATER. `sandboxRoot` is included:
  // naming your own trusted root is the escalation the workspace check exists to prevent.
  for (const forbidden of ['allowedTools', 'tools', 'permissionMode', 'settings', 'mcpConfig', 'addDir', 'bare', 'sandboxRoot']) {
    if (hasOwn(options, forbidden)) {
      throw new Error(`refuse: '${forbidden}' is not configurable — the tool, settings and workspace policy is fixed in claudeCodeWorker`)
    }
  }

  const workspace = options.workspace
  if (!workspace || typeof workspace.containmentCheck !== 'function') {
    throw new Error('refuse: claudeCodeWorker requires the trusted workspace provider that prepared the copy (it must expose containmentCheck)')
  }
  const cwd = options.cwd
  if (typeof cwd !== 'string' || cwd === '') {
    throw new Error('refuse: claudeCodeWorker requires an explicit cwd — the disposable copy, never the caller\'s process directory')
  }

  const fsImpl = options.fs || fsDefault
  const realpathFn = options.realpath

  /**
   * ⛔ PROVENANCE IS CHECKED — AND ITS BOUNDARY IS STATED. (Closed 2026-09-05.)
   *
   * Until v3 this said provenance was NOT proven, and it was right: the naming prefix was
   * standing in for origin, and a prefix is a naming convention. `tmpdirSandbox` now keeps a
   * module-private register of the workspaces its own `prepare()` actually completed, and
   * `assertMintedWorkspace` is asked of THAT MODULE rather than of the provider — so a fake
   * provider, a hand-made directory with the same name, another provider's sandbox, and a
   * half-built sandbox from a failed prepare are all equally refused.
   *
   * What is checked here: the provider's containment check, our independent re-assertion of the
   * same brake, the mint register, that it is a real directory, that it does not contain this
   * repository, and — from construction through every dispatch — that the directory OBJECT
   * (dev+ino) has not changed.
   *
   * ⚠ WHAT IT IS NOT: in-process provenance for a trusted creation path, not OS isolation. A
   * hostile process running as the same user can still create, move or replace directories
   * whatever this register says. That boundary is deliberate and is not widened here.
   *
   * ⚠ CONSEQUENCE, DISCLOSED: only providers created by `createTmpdirSandbox` carry a register.
   * `featureBranchWorkspace` mints its own sandboxes and is NOT registered, so a worker handed
   * that provider is refused today. Teaching it to register is its own change, in its own gate.
   */
  function verifyWorkspace () {
    let safe
    try { safe = workspace.containmentCheck(cwd) } catch (e) {
      throw new Error('refuse: the workspace provider rejected this cwd — ' + ((e && e.message) || 'containmentCheck failed'))
    }
    if (typeof safe !== 'string' || safe === '') {
      throw new Error('refuse: the workspace provider did not return a canonical path for this cwd')
    }
    // Independent of the provider, so a stubbed one cannot be the only thing standing here.
    const brake = assertSandboxUnderTmpdir(cwd)
    // ⛔ PROVENANCE, ASKED OF THE MODULE RATHER THAN OF THE PROVIDER.
    // This replaces the naming-prefix check, which only ever proved that someone had chosen the
    // right name. assertMintedWorkspace consults tmpdirSandbox's own private register: the
    // directory must be one THIS provider's prepare() actually completed, the root must still be
    // the same object it was when minted, and a subdirectory is accepted only when it really
    // sits inside that root once symlinks and junctions are resolved.
    const minted = assertMintedWorkspace(workspace, cwd)
    let st = null
    try { st = fsImpl.statSync(minted.path) } catch (_) { st = null }
    if (!st || typeof st.isDirectory !== 'function' || !st.isDirectory()) {
      throw new Error('refuse: cwd does not exist as a directory — ' + cwd)
    }
    const repoRoot = path.resolve(__dirname, '..', '..')
    if (isInside(minted.path, repoRoot, realpathFn)) {
      throw new Error('refuse: cwd contains this repository — the enquiry must run against a copy, not the live checkout')
    }
    if (foldPath(minted.path) !== foldPath(brake)) {
      throw new Error('refuse: the provider and the mint register disagree about which directory this is')
    }
    // ⛔ THE OBJECT, NOT THE NAME. A path string can be removed and recreated between
    // construction and dispatch and still compare equal; dev+ino cannot. Measured on this
    // machine: a recreated directory at the same path gets a different ino on win32 too.
    return { path: minted.path, root: minted.root, dev: minted.dev, ino: minted.ino }
  }

  const boundWorkspace = verifyWorkspace()

  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS
  const graceMs = Number.isFinite(options.terminationGraceMs) ? options.terminationGraceMs : DEFAULT_TERMINATION_GRACE_MS
  // How long a close waits for the kill verdict. Bounded, small, and never open-ended.
  const killGraceMs = Number.isFinite(options.killGraceMs) ? options.killGraceMs : Math.min(2000, graceMs)
  const maxTurns = Number.isInteger(options.maxTurns) && options.maxTurns > 0 ? options.maxTurns : DEFAULT_MAX_TURNS
  const maxBudgetUsd = Number.isFinite(options.maxBudgetUsd) && options.maxBudgetUsd > 0 ? options.maxBudgetUsd : null
  const allowResume = options.allowResume === true
  const spawnFn = typeof options.spawnFn === 'function' ? options.spawnFn : spawn
  const resolveFn = typeof options.resolveFn === 'function' ? options.resolveFn : resolveAgentCliCommand
  const listDescendants = typeof options.listDescendants === 'function' ? options.listDescendants : null
  const isAlive = typeof options.isAlive === 'function' ? options.isAlive : defaultIsAlive
  const killTreeFn = typeof options.killTreeFn === 'function' ? options.killTreeFn : defaultKillTree

  /**
   * ⛔ SESSIONS ARE REGISTERED BY OUTCOME, NEVER BY ARGUMENT CONSTRUCTION.
   * The previous version added the id inside buildArgs, so merely BUILDING an argv — something
   * a test, a dry run or a caller inspecting the command could do — granted resume rights to a
   * session that had never been opened. Registration now happens only when a dispatch comes
   * back successful and the CLI reports that same session id.
   */
  const establishedSessions = new Set()

  function buildArgs ({ goal, sessionId, resume, maxTurns: requestedTurns }) {
    if (resume) {
      if (!allowResume) {
        throw new Error('refuse: resuming a session requires allowResume — the first controlled task opens a NEW session')
      }
      if (!establishedSessions.has(String(resume))) {
        throw new Error('refuse: session ' + String(resume) + ' was never established by this enquiry — a resumable session must be one this worker actually opened')
      }
    }
    // A per-dispatch bound may only TIGHTEN. A ceiling a caller can raise is not a ceiling.
    const turns = Number.isInteger(requestedTurns) && requestedTurns > 0 ? Math.min(maxTurns, requestedTurns) : maxTurns

    const args = ['--restricted', '-p', String(goal || '')]
    if (resume) args.push('--resume', String(resume))
    else if (sessionId) args.push('--session-id', String(sessionId))

    args.push('--tools', TOOLS_CSV)
    // One argv element per tool: the reference shows these as separate arguments, and a single
    // space-joined element may parse as one unknown tool name. Never verified, never relied on.
    for (const tool of READ_ONLY_TOOLS) args.push('--allowedTools', tool)
    args.push('--permission-mode', PERMISSION_MODE)
    args.push('--settings', SETTINGS_JSON)
    args.push('--strict-mcp-config', '--mcp-config', MCP_JSON)
    args.push('--max-turns', String(turns))
    if (maxBudgetUsd !== null) args.push('--max-budget-usd', String(maxBudgetUsd))
    args.push('--json-schema', SCHEMA_JSON)
    args.push('--output-format', 'json')
    return args
  }

  /**
   * The documented result contract. Separate from the schema payload, because they are two
   * different documents: the envelope is the CLI's report about the run, `structured_output` is
   * the model's answer that the CLI already validated against our schema.
   */
  function readEnvelope (envelope, expectedSession) {
    if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
      return { code: FAILURE.ENVELOPE_INVALID, why: 'the CLI envelope is not a JSON object' }
    }
    // ⛔ REQUIRED, NOT "CHECKED IF PRESENT". An envelope with no `type` was being accepted, so
    // any JSON object with the right handful of fields could pass as a result message.
    if (!hasOwn(envelope, 'type') || envelope.type !== 'result') {
      return { code: FAILURE.ENVELOPE_INVALID, why: `expected a result message, got type ${JSON.stringify(envelope.type)}` }
    }
    const subtype = envelope.subtype
    if (typeof subtype !== 'string' || subtype === '') {
      return { code: FAILURE.ENVELOPE_INVALID, why: 'the result message carries no subtype' }
    }
    if (subtype !== 'success') {
      return { code: FAILURE.CLI_REPORTED_ERROR, why: `the run ended with subtype '${subtype.slice(0, 60)}'` }
    }
    // ⛔ TYPE FIRST, THEN MEANING. `is_error: "false"` is a string, and a string is neither true
    // nor a report we understand — the old check compared against `true` and let every other
    // value through, so "false" and "yes" were equally invisible. A field we cannot read is a
    // failure, not an absence.
    if (hasOwn(envelope, 'is_error')) {
      if (typeof envelope.is_error !== 'boolean') {
        return { code: FAILURE.ENVELOPE_INVALID, why: `is_error must be a boolean, got ${JSON.stringify(envelope.is_error)}` }
      }
      // A CONTRADICTION IS A FAILURE, NOT A TIE-BREAK: the two halves of the CLI's own report
      // disagree, and neither is safe to believe.
      if (envelope.is_error === true) {
        return { code: FAILURE.ENVELOPE_INVALID, why: 'the envelope says subtype success AND is_error true' }
      }
    }
    if (hasOwn(envelope, 'errors')) {
      if (!Array.isArray(envelope.errors)) {
        return { code: FAILURE.ENVELOPE_INVALID, why: 'errors must be an array when present' }
      }
      if (envelope.errors.length > 0) {
        return { code: FAILURE.CLI_REPORTED_ERROR, why: `the result carries ${envelope.errors.length} error(s)` }
      }
    }
    const cost = readFiniteNumber(envelope, 'total_cost_usd')
    if (!cost.ok) return { code: FAILURE.ENVELOPE_INVALID, why: cost.why }
    const turns = readInteger(envelope, 'num_turns')
    if (!turns.ok) return { code: FAILURE.ENVELOPE_INVALID, why: turns.why }

    // ⛔ THE ANSWER MUST NAME ITS OWN SESSION, AND IT MUST BE OURS.
    // The previous version accepted a missing session_id and then filled the gap with the id we
    // had ASKED for — manufacturing the very identity it was supposed to verify, and (worse)
    // handing that invented id resume rights. An unidentified answer is now a failure.
    const sid = envelope.session_id
    if (typeof sid !== 'string' || sid === '') {
      return { code: FAILURE.ENVELOPE_INVALID, why: 'session_id must be a non-empty string; an unidentified result is not ours to accept' }
    }
    if (!expectedSession || sid !== expectedSession) {
      return { code: FAILURE.SESSION_MISMATCH, why: `the CLI answered for session '${sid}' but '${expectedSession || '(none requested)'}' was requested` }
    }
    // ⛔ THE DOCUMENTED CARRIER, NOT A GUESS. Docs: "the result message includes a
    // structured_output field with validated data", and "A result can also end with subtype
    // success but no structured_output value … Treat that case as a failure as well."
    if (!hasOwn(envelope, 'structured_output') || envelope.structured_output === null || envelope.structured_output === undefined) {
      return { code: FAILURE.STRUCTURED_OUTPUT_MISSING, why: 'the run reported success but produced no structured_output' }
    }
    const payload = envelope.structured_output
    if (typeof payload !== 'object' || Array.isArray(payload)) {
      return { code: FAILURE.STRUCTURED_OUTPUT_MISSING, why: 'structured_output is not a JSON object' }
    }
    return { ok: true, sessionId: sid, costUsd: cost.value, numTurns: turns.value, payload }
  }

  async function dispatch ({ goal, sessionId, resume, signal, maxTurns: requestedTurns } = {}) {
    // ⛔ AN ALREADY-ABORTED SIGNAL MUST NOT REACH A SPAWN. Starting a process in order to kill
    // it immediately is not cancellation.
    if (signal && signal.aborted) {
      throw failure(FAILURE.ABORTED_BEFORE_SPAWN, 'refuse: the abort signal was already aborted before dispatch')
    }

    const resolved = resolveFn(process.env)
    if (!resolved || resolved.ok !== true) {
      throw new Error('agent CLI not resolvable — ' + ((resolved && resolved.reason) || 'unknown reason'))
    }

    // TOCTOU: the directory verified at construction may not be the same OBJECT now.
    let now
    try { now = verifyWorkspace() } catch (e) {
      throw failure(FAILURE.WORKSPACE_CHANGED, 'refuse: the workspace no longer verifies — ' + e.message)
    }
    if (now.path !== boundWorkspace.path || now.dev !== boundWorkspace.dev || now.ino !== boundWorkspace.ino) {
      throw failure(FAILURE.WORKSPACE_CHANGED,
        'refuse: the workspace directory is not the object this worker was bound to ' +
        `(bound ${boundWorkspace.dev}:${boundWorkspace.ino}, found ${now.dev}:${now.ino})`)
    }

    const expectedSession = resume ? String(resume) : (sessionId ? String(sessionId) : null)
    const args = buildArgs({ goal, sessionId, resume, maxTurns: requestedTurns })

    return new Promise((resolve, reject) => {
      const chunks = { stdout: [], stderr: [] }
      let totalBytes = 0
      let stdoutBytes = 0
      let stderrBytes = 0
      let truncated = false
      let stopReason = STOP_REASON.NONE
      let terminationRequested = false
      let killIssued = 'NOT_REQUESTED'
      let directChildExited = false
      let observedPidsGone = PIDS.NOT_REQUESTED
      let observedBefore = null
      let settled = false
      // ⛔ TWO DEADLINES, TWO JOBS, AND THEY MUST NOT OUTLIVE EACH OTHER.
      //   exitTimer  bounds "will the child exit at all?"  — meaningless once it has
      //   killTimer  bounds "will the kill verdict arrive?" — the only wait left after a close
      // v5 armed the exit deadline and then, on close, started waiting for the kill verdict
      // WITHOUT disarming it. With terminationGrace 30ms and the verdict due at 40ms, the exit
      // deadline fired first and reported CHILD_DID_NOT_EXIT about a child that had already
      // exited at 20ms — a false statement produced by a timer nobody cancelled.
      let exitTimer = null
      let killTimer = null
      let killWaiters = []
      const clearTimers = () => {
        if (exitTimer) { clearTimeout(exitTimer); exitTimer = null }
        if (killTimer) { clearTimeout(killTimer); killTimer = null }
      }
      const settleKill = (state) => {
        if (killIssued !== 'REQUESTED') return   // exactly once; a late duplicate changes nothing
        killIssued = state
        const waiting = killWaiters; killWaiters = []
        for (const w of waiting) w()
      }
      const whenKillKnown = (cb) => {
        if (killIssued !== 'REQUESTED') return cb()
        let done = false
        const fire = () => { if (!done) { done = true; cb() } }
        killWaiters.push(fire)
        // ⛔ A DEADLINE, NOT A CONCLUSION. If no verdict arrives we record UNKNOWN — never
        // ISSUED, and never the in-flight 'REQUESTED', which describes a question rather than
        // an answer.
        killTimer = setTimeout(() => { if (killIssued === 'REQUESTED') killIssued = 'UNKNOWN'; fire() }, killGraceMs)
        killTimer.unref && killTimer.unref()
      }

      const child = spawnFn(resolved.command, args, {
        cwd: boundWorkspace.path,
        shell: false,
        env: buildChildEnv(process.env),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32'
      })

      const termination = () => Object.freeze({
        terminationRequested,
        killIssued,
        directChildExited,
        observedPidsGone,
        // ⛔ ALWAYS UNKNOWN once a stop was requested. We have no tree boundary — no job object,
        // no cgroup — so "the tree stopped" is a claim nothing here can support.
        descendantsTerminated: terminationRequested ? TREE.UNKNOWN : TREE.NOT_REQUESTED,
        stopReason,
        truncated
      })

      /** Only a definite "not there" counts as gone; a failed query is UNKNOWN. */
      const checkObservedPids = () => {
        if (!Array.isArray(observedBefore)) return PIDS.UNKNOWN
        if (observedBefore.length === 0) return PIDS.NOT_OBSERVED
        for (const pid of observedBefore) {
          let alive
          try { alive = isAlive(pid) } catch (_) { return PIDS.UNKNOWN }
          if (alive !== false) return PIDS.UNKNOWN
        }
        return PIDS.CONFIRMED_GONE
      }

      // ⛔ ONE SETTLEMENT PER DISPATCH, AND EVERY TIMER DIES WITH IT. A late or duplicate
      // callback after this point changes nothing: no second reject, no second resolve, no
      // rewritten result.
      const finish = (fn) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        clearTimers()
        if (signal) { try { signal.removeEventListener('abort', onAbort) } catch (_) {} }
        fn()
      }

      const requestTermination = (reason) => {
        if (terminationRequested) return
        terminationRequested = true
        stopReason = reason
        observedPidsGone = PIDS.UNKNOWN
        if (listDescendants && child.pid) {
          try { observedBefore = listDescendants(child.pid) } catch (_) { observedBefore = null }
        }
        // ⛔ NOT FIRE-AND-FORGET, AND ORDER-SAFE. The kill result and the child's close can
        // arrive in either order; recording the kill outcome must never re-settle the promise.
        // ⛔ 'REQUESTED' IS RECORDED THE MOMENT WE ASK. Leaving it at NOT_REQUESTED until the
        // callback arrived meant a kill we had genuinely issued was reported as never requested
        // whenever the child closed first — the one ordering that actually happens.
        killIssued = 'REQUESTED'
        try {
          killTreeFn(child, (err) => settleKill(err ? 'FAILED' : 'ISSUED'))
        } catch (_) { settleKill('FAILED') }
        exitTimer = setTimeout(() => {
          // ⛔ NEVER ABOUT A CHILD THAT HAS EXITED. The close handler disarms this, and this
          // guard is the second lock: CHILD_DID_NOT_EXIT is a claim about a process still
          // running, and directChildExited already says otherwise.
          if (directChildExited) return
          if (killIssued === 'REQUESTED') killIssued = 'UNKNOWN'
          observedPidsGone = checkObservedPids()
          finish(() => reject(failure(FAILURE.CHILD_DID_NOT_EXIT,
            'agent CLI did not exit within ' + graceMs + 'ms of ' + stopReason.toLowerCase() +
            ' (kill ' + killIssued + ', observed pids ' + observedPidsGone + ')',
            { termination: termination() })))
        }, graceMs)
        exitTimer.unref && exitTimer.unref()
      }

      const timer = setTimeout(() => requestTermination(STOP_REASON.TIMEOUT), timeoutMs)
      timer.unref && timer.unref()
      const onAbort = () => requestTermination(STOP_REASON.CANCELLED)
      if (signal) signal.addEventListener('abort', onAbort, { once: true })

      /**
       * ⛔ ONE SHARED BYTE BUDGET, BUFFERS, AND A REAL COPY.
       * Two separate caps let each pipe stay under its own limit while the pair blew past what
       * we meant to hold. Characters mis-measure multibyte output, and decoding per chunk splits
       * a character across a boundary. `subarray` would keep the whole oversized chunk alive
       * through its backing store, so the slice is COPIED.
       * The pipes keep draining after the cap, or the child blocks on a full pipe.
       */
      const collect = (which) => (d) => {
        const buf = Buffer.isBuffer(d) ? d : Buffer.from(String(d))
        const room = MAX_TOTAL_BYTES - totalBytes
        if (room <= 0) { markTruncated(); return }
        const take = Math.min(room, buf.length)
        chunks[which].push(Buffer.from(buf.subarray(0, take)))
        totalBytes += take
        if (which === 'stdout') stdoutBytes += take; else stderrBytes += take
        if (take < buf.length) markTruncated()
      }
      const markTruncated = () => {
        if (truncated) return
        truncated = true
        requestTermination(STOP_REASON.OUTPUT_LIMIT)
      }
      child.stdout.on('data', collect('stdout'))
      child.stderr.on('data', collect('stderr'))

      child.on('error', (e) => finish(() => reject(e)))

      child.on('close', (code) => {
        directChildExited = true
        // ⛔ DISARM THE EXIT DEADLINE FIRST. Its question — "will it exit?" — has just been
        // answered, and leaving it armed is what produced CHILD_DID_NOT_EXIT for a child that
        // had already exited. From here only the kill verdict is still outstanding, and only
        // killGraceMs bounds it.
        if (exitTimer) { clearTimeout(exitTimer); exitTimer = null }
        // A stop is only fully described once the kill verdict is in; without it the report
        // would say "we asked" and never say what happened.
        if (terminationRequested) return whenKillKnown(() => onClosed(code))
        onClosed(code)
      })

      const onClosed = (code) => {
        if (terminationRequested) observedPidsGone = checkObservedPids()
        const stdout = Buffer.concat(chunks.stdout).toString('utf8')
        const stderrText = Buffer.concat(chunks.stderr).toString('utf8')
        const diagnostics = Object.freeze({
          exitCode: code, stdoutBytes, stderrBytes, totalBytes,
          // Diagnostics only. stderr is NEVER a result source.
          stderrTail: stderrText.slice(-2000)
        })

        finish(() => {
          const fail = (codeName, msg) => reject(failure(codeName, msg, { termination: termination(), diagnostics }))

          if (truncated) {
            return fail(FAILURE.TRUNCATED, 'agent CLI output exceeded the shared byte cap; the result is incomplete' +
              (terminationRequested ? ' (terminated: kill ' + killIssued + ', observed pids ' + observedPidsGone + ')' : ''))
          }
          if (terminationRequested) {
            return fail(FAILURE.STOPPED, 'agent CLI stopped: ' + stopReason.toLowerCase() +
              ' (kill ' + killIssued + ', observed pids ' + observedPidsGone + ')')
          }
          if (code !== 0) return fail(FAILURE.NONZERO_EXIT, 'agent CLI exited ' + code)

          // ⛔ THE WHOLE OF STDOUT MUST BE THE JSON. Scanning for the last line that looks like
          // JSON would let anything printed before or after the envelope pass unnoticed — and
          // whatever printed it was not accounted for.
          let envelope = null
          try { envelope = JSON.parse(stdout.trim()) } catch (_) { envelope = null }
          if (envelope === null || typeof envelope !== 'object') {
            return fail(FAILURE.NO_PARSABLE_JSON,
              'stdout is not a single JSON document (' + stdout.trim().length + ' chars); leading or trailing output is not ignored')
          }

          const env = readEnvelope(envelope, expectedSession)
          if (!env.ok) return fail(env.code, 'the CLI result did not satisfy its contract: ' + env.why)

          const valid = validateEnquiryPayload(env.payload)
          if (!valid.ok) return fail(FAILURE.PAYLOAD_INVALID, 'structured_output failed validation: ' + valid.reason + ' — ' + valid.detail)

          const cites = verifyCitations(env.payload, { cwd: boundWorkspace.path, realpath: realpathFn })
          if (!cites.ok) return fail(FAILURE.PAYLOAD_INVALID, 'citations could not be verified: ' + cites.detail)
          if (cites.outside > 0) {
            return fail(FAILURE.CITATION_OUTSIDE_COPY, cites.outside + ' citation(s) point outside the disposable copy')
          }

          // ⛔ REGISTERED ONLY NOW, AND ONLY FROM THE CLI'S OWN REPORT. Falling back to the id
          // we requested would grant resume rights to a session the CLI never confirmed.
          establishedSessions.add(String(env.sessionId))

          resolve(Object.freeze({
            sessionId: env.sessionId,
            payload: env.payload,
            // The formal interface the runner carries forward, named once here.
            answer: env.payload.answer,
            citations: cites.rows,
            notEstablished: env.payload.notEstablished,
            evidence: cites.evidence,
            citationsConfirmed: cites.confirmed,
            citationsUnverified: cites.unverified,
            costUsd: env.costUsd,   // null means UNKNOWN, never 0
            numTurns: env.numTurns,
            exitCode: code,
            termination: termination(),
            diagnostics
          }))
        })
      }
    })
  }

  return { dispatch, buildArgs, tools: READ_ONLY_TOOLS, cwd: boundWorkspace.path, maxTurns, allowResume }
}

/**
 * Liveness by signal 0 — it tests existence without delivering anything.
 *
 * ⛔ TRI-STATE, BECAUSE "I COULD NOT TELL" IS NOT "IT IS GONE". Only ESRCH means no such
 * process. EPERM means it exists and is not ours. Anything else — EIO, EINVAL, a platform
 * refusal — is a query that failed, and the previous version returned false for all of them,
 * which is the answer that lets a live process be reported as terminated.
 *
 * @returns {boolean|null} true alive · false definitely gone · null unknown
 */
function defaultIsAlive (pid) {
  try { process.kill(pid, 0); return true } catch (e) {
    if (e && e.code === 'ESRCH') return false
    if (e && e.code === 'EPERM') return true
    return null
  }
}

/**
 * Real tree termination, with completion reported rather than assumed. Windows has no process
 * groups, so taskkill /T /F runs as an argv array with shell:false; on POSIX the child was
 * spawned detached and leads its own group.
 */
function defaultKillTree (child, done = () => {}) {
  if (!child || !child.pid) { done(new Error('no pid to terminate')); return }
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { shell: false, stdio: 'ignore' })
    let reported = false
    const once = (err) => { if (!reported) { reported = true; done(err) } }
    killer.once('error', (e) => once(e))
    killer.once('close', (code) => once(code === 0 ? null : new Error('taskkill exited ' + code)))
    return
  }
  try { process.kill(-child.pid, 'SIGTERM'); done(null) } catch (_) {
    try { child.kill('SIGTERM'); done(null) } catch (e) { done(e) }
  }
}

module.exports = {
  createClaudeCodeWorker,
  defaultKillTree,
  defaultIsAlive,
  READ_ONLY_TOOLS,
  FIXED_SETTINGS,
  EMPTY_MCP_CONFIG,
  PERMISSION_MODE,
  TREE,
  PIDS,
  STOP_REASON,
  FAILURE,
  MAX_TOTAL_BYTES
}
