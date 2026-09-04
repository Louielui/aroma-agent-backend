'use strict'

/**
 * openClawTransport.js — THE EXECUTION SEAM, AND IT IS INERT.
 *
 * ⛔ THIS MODULE CANNOT RUN OPENCLAW, AND THAT IS DELIBERATE.
 * There is NO default CLI runner and NO child_process import here. A runner must be injected,
 * and with none the transport refuses. Activation is still blocked on an unsolved problem
 * (below), so a module that could reach the real CLI by omission — a forgotten default, an
 * env var, a "just for testing" fallback — would be one edit away from doing so.
 *
 * ── THE BLOCKER THIS DOES NOT SOLVE ─────────────────────────────────────────
 * Measured in C2-B2-A and confirmed in the installed build: a terminal task does NOT prove the
 * session is finished. `main-session-restart-recovery` skips only subagent/cron/ACP session
 * keys and scans every agent's session store, so an ordinary agent session like ours can be
 * auto-resumed from a persisted `abortedLastRun` flag after we observed a terminal status. No
 * OpenClaw primitive neutralises a session without pruning its workspace.
 *
 * Nothing here papers over that. There is no polling delay, no grace period, no "not found
 * twice means gone", no elapsed-time threshold. Retirement requires a proof this module never
 * manufactures.
 *
 * ── WHAT IT DOES ENCODE ─────────────────────────────────────────────────────
 * The ordering that must be right before any of it is switched on:
 *
 *   1. approvalId comes from governedWorkspace.approvalFor(cloneDir) — an authoritative
 *      lookup, NEVER parsed out of the path. Deriving governance identity from a string is
 *      the trust this programme has already removed twice.
 *   2. agentId and sessionKey are DETERMINISTIC functions of approvalId, so the identifier
 *      needed to reconcile a crashed run exists before anything is spawned.
 *   3. markRunning is the LAST synchronous act before the first spawn. The ledger is durable
 *      on disk before any external boundary is crossed.
 *   4. A client timeout means only that we stopped waiting: CLIENT_TIMEOUT -> QUARANTINED,
 *      never "the executor stopped".
 *   5. Exit codes are never sufficient. Measured three times in this programme:
 *      `git push --dry-run` exits 0 on auth failure; `openclaw agent --json` exits 1 with
 *      EMPTY stdout on early failure; `openclaw tasks show <unknown>` exits 0 and prints
 *      "Task not found". Output is parsed; status is corroboration at best.
 */

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

/** Deterministic, and computable before any spawn — which is what makes crash recovery possible. */
const agentIdFor = (approvalId) => `aroma-${approvalId}`
const sessionKeyFor = (approvalId) => `agent:${agentIdFor(approvalId)}:${approvalId}`

/**
 * ⛔ THE ONLY LOOKUP THIS LANE EVER ASKS ABOUT, WRITTEN OUT AS A GRAMMAR.
 *
 * `tasks show` is only ever called with a session key this module derived, and that key has
 * exactly one shape: agent:aroma-<approvalId>:<approvalId>, with the SAME approvalId twice
 * and approvalId drawn from the ledger's own safe-id alphabet ([A-Za-z0-9_-]{1,64}).
 *
 * An earlier version matched the lookup as \S+, which enforces nothing: "Task not found: x.",
 * "Task not found: ../../foo" and "Task not found: anything" were all read as a clean,
 * accounted-for "no such task". That is the answer that lets a record be closed out, so the
 * one thing it must not accept is output about some other lookup — or output that merely
 * resembles the message. No taskId or runId form is recognised, because this reconciler never
 * asks by one.
 */
const NOT_FOUND_LOOKUP = /^Task not found: agent:aroma-([A-Za-z0-9_-]{1,64}):([A-Za-z0-9_-]{1,64})$/

/**
 * Validate a success payload. The shape is the one MEASURED from a real turn in C2-B2-A:
 *
 *   { runId, status:"ok", summary:"completed",
 *     result:{ payloads:[{text,mediaUrl}], meta:{ aborted:false, ... } } }
 *
 * ⛔ WHOLE-STDOUT PARSE, NOT A SUBSTRING SEARCH. Scanning for the first `{` would happily
 * accept JSON embedded in a warning banner, which is exactly how a partial or interleaved
 * write gets read as a result.
 */
function parseSuccess (stdout) {
  const raw = typeof stdout === 'string' ? stdout : ''
  if (raw.trim() === '') return { ok: false, reason: 'empty stdout: --json produced no result' }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return { ok: false, reason: `stdout is not whole JSON (${(e && e.message) || 'parse failed'})` }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'result is not a JSON object' }
  }
  if (parsed.status !== 'ok') return { ok: false, reason: `status is '${parsed.status}', not 'ok'` }
  if (typeof parsed.runId !== 'string' || parsed.runId === '') {
    return { ok: false, reason: 'runId is missing or not a string' }
  }
  const result = parsed.result
  if (!result || typeof result !== 'object') return { ok: false, reason: 'result is missing' }
  const payloads = result.payloads
  if (!Array.isArray(payloads) || payloads.length === 0 || typeof payloads[0].text !== 'string') {
    return { ok: false, reason: 'result.payloads[0].text is missing' }
  }
  const meta = result.meta
  if (!meta || typeof meta !== 'object') return { ok: false, reason: 'result.meta is missing' }
  // An aborted run is not a success, whatever else the payload says.
  if (meta.aborted !== false) return { ok: false, reason: `result.meta.aborted is ${JSON.stringify(meta.aborted)}, not false` }

  return { ok: true, runId: parsed.runId, text: payloads[0].text, summary: parsed.summary || null }
}

/**
 * Read a task status from `tasks show <lookup> --json` output.
 *
 * ⛔ NEVER FROM THE EXIT CODE. Measured: `openclaw tasks show <unknown>` prints
 * "Task not found: …" and exits 0. A status assertion on exit code would read a missing task
 * as a healthy one.
 */
function parseTaskStatus (stdout) {
  const raw = typeof stdout === 'string' ? stdout : ''
  const trimmed = raw.trim()

  // ⛔ THE WHOLE OUTPUT MUST BE THE MEASURED CONTRACT — NOT MERELY START WITH IT.
  //
  // This used to test /^task not found\\b/i, which is a PREFIX match, so
  //     "Task not found: agent:x:y\\nWARNING: something"
  // was reported as a clean, accounted-for "no such task" while a second line nobody read
  // said otherwise. Decorated output is exactly the shape a partial or interleaved write
  // takes, and "the task does not exist" is the answer that lets a record be closed out.
  //
  // The measured contract is a single line: `Task not found: <lookup>`. It is matched
  // whole, case as measured, with a single non-blank lookup token and nothing else — no
  // prefix, no suffix, no second line, no trailer. There is no measured evidence of any
  // final punctuation, so none is accepted. Anything else is UNREADABLE, which escalates
  // rather than releases.
  const notFound = NOT_FOUND_LOOKUP.exec(trimmed)
  // the repeated id must be the SAME id: agent:aroma-a:b names no session this lane can derive
  if (notFound && notFound[1] === notFound[2]) return { found: false }

  // ⛔ NO SALVAGING JSON OUT OF A BANNER.
  // This used to slice from the first '{', so a warning line followed by JSON parsed as a
  // clean status — which is exactly the shape a partial, interleaved or decorated write
  // takes. Anything that is not WHOLE JSON is unreadable, and unreadable is not a status.
  if (trimmed === '' || trimmed[0] !== '{') return { found: false, unreadable: true }
  let t
  try {
    t = JSON.parse(trimmed)
  } catch (e) {
    return { found: false, unreadable: true }
  }
  if (!t || typeof t !== 'object' || Array.isArray(t)) return { found: false, unreadable: true }
  if (typeof t.status !== 'string' || t.status === '') return { found: false, unreadable: true }
  return { found: true, status: t.status, taskId: t.taskId || null, runId: t.runId || null }
}

/**
 * @param {{
 *   cli: function,               INJECTED. (argv, opts) -> { status, stdout, stderr, timedOut }
 *   governedWorkspace: object,
 *   quarantine: object,
 *   timeoutSec?: number
 * }} deps
 */
function createOpenClawTransport (deps = {}) {
  const { governedWorkspace, quarantine } = deps
  const cli = typeof deps.cli === 'function' ? deps.cli : null
  // Injected positive-evidence seam. Without it the transport is inert: a zero exit status
  // from "agents add" is never accepted as proof the agent exists.
  const confirmAgent = typeof deps.confirmAgent === 'function' ? deps.confirmAgent : null
  if (!governedWorkspace || typeof governedWorkspace.approvalFor !== 'function') {
    throw new TypeError('openClawTransport requires the governed workspace')
  }
  if (!quarantine || typeof quarantine.markRunning !== 'function') {
    throw new TypeError('openClawTransport requires the quarantine ledger')
  }

  /**
   * The transport the OpenClaw worker calls: transport(brief, { cloneDir, branch }).
   * Returns the worker's contract shape; it never throws for an execution failure.
   */
  async function transport (brief, ctx = {}) {
    const cloneDir = ctx.cloneDir

    // ── (1) identity, authoritatively ──
    const approvalId = governedWorkspace.approvalFor(cloneDir)
    if (!approvalId || !SAFE_ID.test(approvalId)) {
      return { ok: false, error: 'refuse: no governed approval owns this clone directory' }
    }
    const agentId = agentIdFor(approvalId)
    const sessionKey = sessionKeyFor(approvalId)
    const envelope = envelopeOf(cloneDir)

    // ── (2) INERTNESS IS CHECKED BEFORE THE LEDGER IS TOUCHED ──
    //
    // ⛔ IF NO SPAWN CAN HAPPEN, THE LEDGER MUST NOT SAY ONE WAS ATTEMPTED.
    // This check used to sit AFTER markRunning, so an inert transport left a record claiming
    // an execution had begun — holding the global lock over a run that provably never had a
    // chance to start, and destroying the one thing PREPARED is for. Option 2 only works if
    // RUNNING is entered when a spawn is genuinely imminent.
    if (!cli) {
      return { ok: false, error: 'refuse: openclaw cli runner not configured (transport is inert)' }
    }
    if (!confirmAgent) {
      return { ok: false, error: 'refuse: openclaw agent confirmation not configured (transport is inert)' }
    }

    // ── (3) THE DURABLE BOUNDARY ──
    // Last synchronous act before anything external. Everything below this line may crash,
    // hang, or be killed; the ledger already knows the run exists and how to find it. There is
    // no await between this write and the spawn on the next line.
    // The canonical opening phase. Duplicated as a literal because this module deliberately
    // has no imports; openClawLifecycle.test.js pins it to the ledger's PHASES[0].
    quarantine.markRunning(approvalId, { agentId, sessionKey, phase: 'executor_launch_attempting' })

    // ⛔ From this point a spawn may have happened. Every failure path below must leave the
    // ledger execution-bearing, never quietly reset.
    const agentAdd = await cli(['agents', 'add', agentId, '--workspace', envelope,
      '--non-interactive', '--json'], { phase: 'agent_add' })

    // ⛔ EXIT CODE 0 IS NOT EVIDENCE THAT THE AGENT EXISTS.
    // "agent_observed" is a claim about the world, and an exit status is a claim about a
    // process. This programme has now found three CLI commands whose exit code disagrees with
    // their outcome, so the phase only advances on POSITIVE structured confirmation that the
    // expected agent is bound to the expected workspace. The confirmation seam is injected:
    // the real implementation belongs to the later probe, and inventing an unproven
    // agents-add JSON contract here would be exactly the guess this design refuses.
    const confirmed = await confirmAgent({ agentId, envelope, addResult: agentAdd })
    if (!confirmed || confirmed.exists !== true || confirmed.agentId !== agentId || confirmed.workspace !== envelope) {
      // fail closed, and stay execution-bearing: a spawn was attempted
      return {
        ok: false,
        error: `refuse: could not positively confirm agent '${agentId}' at '${envelope}'; ` +
          `agent existence is unverified (${short(agentAdd)})`
      }
    }
    // identity was written authoritatively at markRunning and cannot be resupplied here
    quarantine.advancePhase(approvalId, 'agent_observed')

    quarantine.advancePhase(approvalId, 'turn_attempting')
    const turn = await cli(['agent', '--agent', agentId, '--session-key', sessionKey,
      '--message-file', briefPathOf(cloneDir), '--json',
      '--timeout', String(deps.timeoutSec || 600)], { phase: 'turn' })

    // ── (4) a client timeout is NOT a stop ──
    if (turn && turn.timedOut === true) {
      quarantine.markClientTimeout(approvalId, { note: 'client stopped waiting; executor state unknown' })
      // the sessionKey was recorded authoritatively at markRunning; resupplying it here
      // would be a caller writing over the one handle a restart has on this executor
      quarantine.quarantine(approvalId)
      return { ok: false, timedOut: true, error: 'openclaw client timed out; the executor may still be running' }
    }

    // ── (5) the result decides, not the exit code ──
    const parsed = parseSuccess(turn && turn.stdout)
    if (!parsed.ok) {
      return { ok: false, exit: turn ? turn.status : null, error: `openclaw result rejected: ${parsed.reason}` }
    }

    // A late success for an already-tainted approval is refused by the ledger itself.
    try {
      quarantine.markSucceeded(approvalId, { runId: parsed.runId })
    } catch (e) {
      return { ok: false, error: (e && e.message) || 'refuse: success rejected by the quarantine ledger' }
    }
    quarantine.advancePhase(approvalId, 'task_observed', { runId: parsed.runId })

    // ⛔ TERMINAL OBSERVATION AND RETIREMENT ARE NOT DONE HERE.
    // Observing the task belongs to the reconciler, and retirement needs a proof that does
    // not exist yet. Deleting the agent here would also prune the workspace out from under
    // openClawWorker's mandatory post-transport verification.
    return { ok: true, exit: turn.status, result: parsed.text, runId: parsed.runId, sessionKey }
  }

  return { transport, parseSuccess, parseTaskStatus, agentIdFor, sessionKeyFor }
}

/** The envelope is the clone's parent; derived only for argv, never for a governance decision. */
function envelopeOf (cloneDir) {
  return String(cloneDir || '').replace(/\/repo$/, '')
}
function briefPathOf (cloneDir) {
  return envelopeOf(cloneDir).replace('/sandboxes/', '/runs/') + '/brief.md'
}
function short (r) {
  if (!r) return 'no result'
  return String(r.stderr || r.stdout || r.status || '').trim().slice(0, 200)
}

module.exports = {
  createOpenClawTransport,
  parseSuccess,
  parseTaskStatus,
  agentIdFor,
  sessionKeyFor
}
