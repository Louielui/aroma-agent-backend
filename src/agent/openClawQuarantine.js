'use strict'

/**
 * openClawQuarantine.js — A TIMEOUT IS NOT A STOP.
 *
 * ── WHAT WAS MEASURED, AND WHY THIS FILE EXISTS ─────────────────────────────
 * C2-B2-A ran a real OpenClaw turn and tried to stop it. Three facts came back:
 *
 *   1. `openclaw tasks cancel` printed "Cancelled <taskId> (cli) run <runId>." and exited 0
 *      — three times, by runId, by taskId, and by sessionKey — while the task stayed
 *      `running`. It reports success it has not achieved.
 *   2. The turn ran to completion anyway: 255.5s, terminal state `succeeded`.
 *   3. Killing the client did not stop it either. The client died at ~t+95s with 0 bytes of
 *      stdout and the task still finished server-side.
 *
 * So there is NO mechanism available to us that terminates an OpenClaw turn on demand. Any
 * design that treats a client timeout as "the executor stopped" would be asserting something
 * we have positive evidence is false.
 *
 * ── THE SEMANTICS THIS ENCODES ──────────────────────────────────────────────
 * A client timeout means only: WE STOPPED WAITING. The executor may still be running, may
 * still be holding the sandbox open, and may still finish successfully minutes later.
 * Therefore:
 *
 *   - a timed-out run is QUARANTINED, never "failed and finished"
 *   - a late success for a quarantined approval is refused FOREVER; a tainted run cannot be
 *     rescued by a payload that arrives after we stopped trusting it
 *   - no further OpenClaw execution is authorised anywhere while a quarantined task has not
 *     been OBSERVED terminal — not the same approval, and not a different one, because the
 *     thing we cannot account for is a process, not an approval
 *   - the envelope is not deleted until terminality is observed, so we never pull a
 *     directory out from under something still writing to it
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
 * It is NOT a second task system, queue or scheduler. It records one small fact per
 * approval and answers one question — "may OpenClaw run right now?" — using the existing
 * Aroma data-dir convention. It schedules nothing and executes nothing.
 */

const fs = require('node:fs')
const path = require('node:path')
const { resolveDataDir } = require('../store/dataDir')

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

const PREPARED = 'PREPARED'
const RUNNING = 'RUNNING'
const SUCCEEDED = 'SUCCEEDED'
const CLIENT_TIMEOUT = 'CLIENT_TIMEOUT'
const QUARANTINED = 'QUARANTINED'
const TERMINAL_OBSERVED = 'TERMINAL_OBSERVED'
/**
 * ⛔ SESSION RETIREMENT IS THE PROCESS BOUNDARY — NOT DISK, NOT TERMINAL OBSERVATION.
 *
 * B1's S5 asserted that TERMINAL_OBSERVED releases the global lock. Its RATIONALE was
 * right — 'cleanup is about disk; the lock is about a process' — but its implementation
 * conflated two different things and released the lock while the session was still
 * resumable. Measured: main-session-restart-recovery skips only subagent/cron/ACP session
 * keys and scans every agent's session store, so an ordinary agent session like ours can be
 * auto-resumed from a persisted abortedLastRun flag AFTER a terminal task was observed.
 *
 * So there are three separable facts, and only the middle one is the lock:
 *   TERMINAL_OBSERVED  a task reached a terminal status — still locked, a successor may follow
 *   EXECUTOR_RETIRED   the session can no longer resume — THE PROCESS BOUNDARY, lock releases
 *   CLEANED            the envelope is gone — disk only, never gates the lock
 *
 * A failed disk removal therefore never keeps OpenClaw shut down, which is what S5 was
 * actually protecting.
 */
const EXECUTOR_RETIRED = 'EXECUTOR_RETIRED'
const CLEANED = 'CLEANED'

/**
 * Execution phases, recorded under RUNNING and carried downstream as evidence.
 *
 * ⛔ PHASE IS EVIDENCE, NEVER THE AUTHORITY FOR 'NOTHING EVER RAN'.
 * That authority is the STATE: only PREPARED proves no external spawn was attempted, because
 * the ledger does not enter RUNNING until the single durable write immediately before the
 * first spawn. Making a phase field carry that inference would put the most dangerous
 * conclusion in the system on the weakest evidence in it.
 *
 * Ordered. A phase may advance, never retreat.
 */
const PHASES = Object.freeze([
  'agent_add_attempting',
  'agent_observed',
  'turn_attempting',
  'task_observed'
])

/**
 * ⛔ TWO STATES FOR "NOTHING EVER RAN", BECAUSE NO TASK EXISTED TO HAVE A STATUS.
 *
 * The first version reached cleanup by calling observeTerminal(id, 'cancelled') when the
 * revision gate refused before the executor. That wrote contradictory evidence: a record
 * claiming an OpenClaw task status of `cancelled` for a task that was never created. The
 * audit trail would have said the scheduler cancelled something that never existed.
 *
 * PRE_EXECUTION_ABORTED — the run was refused before any executor started (revision gate).
 * PREPARATION_FAILED    — the sandbox itself could not be built.
 *
 * Neither carries a taskStatus, because there was no task. Neither is reachable from
 * RUNNING: once an executor has started, only a real observed status will do.
 */
const PRE_EXECUTION_ABORTED = 'PRE_EXECUTION_ABORTED'
const PREPARATION_FAILED = 'PREPARATION_FAILED'

const STATES = Object.freeze({
  PREPARED, RUNNING, SUCCEEDED, CLIENT_TIMEOUT, QUARANTINED, TERMINAL_OBSERVED,
  PRE_EXECUTION_ABORTED, PREPARATION_FAILED, EXECUTOR_RETIRED, CLEANED
})

/**
 * States in which an OpenClaw process may still be alive and unaccounted for.
 * These are what hold the global execution lock.
 *
 * ⛔ SUCCEEDED BELONGS HERE, AND ITS ABSENCE WAS A CONTRADICTION.
 *
 * This design deliberately separates RESULT ACCEPTED (`SUCCEEDED`) from EXECUTOR OBSERVED
 * TERMINAL (`TERMINAL_OBSERVED`), because C2-B2-A proved a returned result does not prove
 * the executor stopped. The workspace honours that: cleanup is refused while SUCCEEDED.
 *
 * But the lock did not. With SUCCEEDED omitted here, the window between markSucceeded() and
 * observeTerminal() let canStart() authorise a SECOND OpenClaw execution while the first
 * executor was still unproven — so the two halves of the same invariant disagreed, and the
 * more permissive half would have won at exactly the wrong moment.
 *
 * TERMINAL_OBSERVED is here for the same reason, established later: a terminal task does not
 * prove the SESSION is finished, because it may still be auto-resumed. The lock releases only
 * at EXECUTOR_RETIRED, or on a genuine no-executor state. SUCCEEDED, TERMINAL_OBSERVED and
 * EXECUTOR_RETIRED all remain distinct: collapsing any of them discards the distinction that
 * makes this correct.
 */
const UNACCOUNTED = Object.freeze([RUNNING, SUCCEEDED, CLIENT_TIMEOUT, QUARANTINED, TERMINAL_OBSERVED])

/** The terminal task statuses OpenClaw itself reports. Anything else is not an observation. */
const TERMINAL_TASK_STATUSES = Object.freeze(['succeeded', 'failed', 'timed_out', 'cancelled', 'lost'])

/** Terminal statuses that represent a run which did NOT succeed. */
const TERMINAL_FAILURE_STATUSES = Object.freeze(['failed', 'timed_out', 'cancelled', 'lost'])

const KNOWN_STATES = Object.freeze(Object.values(STATES))

/**
 * ⛔ TERMINALITY IS ISSUED, NOT ASSERTED — AND BY ONE SPECIFIC LEDGER.
 *
 * Review found that a `{ terminal: true }` boolean lets whoever calls cleanup declare the
 * executor finished — precisely the claim nobody is in a position to make, since C2-B2-A
 * proved the client cannot tell. A grant is a branded object issued ONLY after a terminal
 * fact has been recorded, so a literal can never satisfy it.
 *
 * ⛔ AND THE BRAND IS PER-INSTANCE, NOT PER-PROCESS.
 * The first version kept one module-global WeakSet and exported a module-level verifier.
 * That proved only "SOME quarantine instance in this process issued this grant" — not "the
 * ledger actually governing THIS workspace issued it". Two ledgers in one process (a test
 * fixture beside production, or two composed lanes) would have honoured each other's grants.
 * Each instance now owns a private brand, and the workspace is wired to that exact
 * instance's verifier closure. There is deliberately no process-global verifier to export.
 *
 * Grants carry a `kind` so the removal paths stay mechanically distinguishable:
 *   'executor-retired'   the session can no longer resume — the ONLY authority to remove an
 *                        envelope that actually executed
 *   'pre-execution'      no executor ever started, so there was never a task at all
 * ⛔ THERE IS DELIBERATELY NO 'terminal-observed' GRANT.
 * An earlier revision let terminal observation authorise removing an executed envelope. That
 * was too weak: the session can still be auto-resumed, so the workspace may still be needed
 * by a live successor. Removing it would delete a workspace out from under a running
 * executor. Only RETIREMENT — the session provably unable to resume — authorises that, and a
 * weaker credential is not left lying around to be reached for by mistake.
 */
/**
 * ⛔ SESSION IDENTITY IS DERIVED, NEVER SUPPLIED.
 *
 * agentId and sessionKey are how a crashed run is found again: after a restart they are the
 * only handle on an executor that may still be alive. Treating them as ordinary metadata
 * meant any later transition could overwrite them — the record would then name a session
 * that was never spawned, and reconciliation would query the wrong key and conclude the task
 * did not exist. So they are computed from the approvalId, validated at the boundary, and
 * written through the authoritative channel like the phase.
 *
 * These must stay identical to the transport's own agentIdFor/sessionKeyFor. The transport
 * deliberately has no imports (it cannot be made to reach a real CLI by accident), so the
 * definitions are duplicated and pinned together by test rather than by a shared require.
 */
const expectedAgentIdFor = (approvalId) => `aroma-${approvalId}`
const expectedSessionKeyFor = (approvalId) => `agent:${expectedAgentIdFor(approvalId)}:${approvalId}`

const GRANT_EXECUTOR_RETIRED = 'executor-retired'
const GRANT_PRE_EXECUTION = 'pre-execution'

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * ⛔ SYNTACTICALLY VALID IS NOT SEMANTICALLY VALID.
 *
 * The first version parsed the ledger and fell back to `{}` whenever the result was not a
 * plain object. That is fail-OPEN in the worst possible place: `[]`, `null`, `"abc"` and
 * `123` are all valid JSON, all became "no quarantine", and "no quarantine" is the answer
 * that authorises another OpenClaw run. Truncation or a partial write could produce exactly
 * those shapes.
 *
 * Every record is therefore validated, and anything we cannot account for throws. A ledger
 * we do not understand is not an empty ledger.
 */
function assertLedger (parsed) {
  if (!isPlainObject(parsed)) {
    throw new Error(`refuse: quarantine ledger is not an object (got ${Array.isArray(parsed) ? 'array' : typeof parsed})`)
  }
  for (const key of Object.keys(parsed)) {
    if (!SAFE_ID.test(key)) throw new Error(`refuse: quarantine ledger has an unsafe approvalId key '${key}'`)
    const rec = parsed[key]
    if (!isPlainObject(rec)) {
      throw new Error(`refuse: quarantine record '${key}' is not an object (got ${rec === null ? 'null' : typeof rec})`)
    }
    if (rec.approvalId !== key) {
      throw new Error(`refuse: quarantine record '${key}' declares approvalId '${rec.approvalId}'`)
    }
    if (!KNOWN_STATES.includes(rec.state)) {
      // An unknown state must never be quietly skipped by unaccounted(): a record we cannot
      // classify might be the one holding a live executor.
      throw new Error(`refuse: quarantine record '${key}' has unknown state '${rec.state}'`)
    }
    assertPhaseFor(key, rec)
  }
  return parsed
}

/** States that mean an external spawn was attempted, so a phase MUST be present. */
const EXECUTION_BEARING = Object.freeze([
  RUNNING, SUCCEEDED, CLIENT_TIMEOUT, QUARANTINED, TERMINAL_OBSERVED, EXECUTOR_RETIRED
])

/**
 * ⛔ A PHASE WE CANNOT READ IS NOT A PHASE WE MAY IGNORE.
 *
 * On any execution-bearing state the phase is required and must be in the vocabulary. A
 * missing or unrecognised phase there means the ledger is describing a run we cannot place
 * on the timeline — and the whole point of the phase is to say how far a spawn got. Failing
 * open would let exactly the ambiguous record we most need to notice slip through
 * unaccounted().
 *
 * On PREPARED a phase must be ABSENT: PREPARED is the never-started proof, and a record
 * claiming both "nothing was attempted" and a spawn phase is self-contradictory.
 */
function assertPhaseFor (key, rec) {
  const hasPhase = rec.phase !== undefined && rec.phase !== null

  if (rec.state === PREPARED) {
    if (hasPhase) {
      throw new Error(`refuse: quarantine record '${key}' is PREPARED but carries execution phase '${rec.phase}'`)
    }
    return
  }
  if (rec.state === CLEANED) return assertCleanedProvenance(key, rec)
  if (!EXECUTION_BEARING.includes(rec.state)) return // PRE_EXECUTION_ABORTED / PREPARATION_FAILED

  if (!hasPhase) {
    throw new Error(`refuse: quarantine record '${key}' is ${rec.state} but carries no execution phase`)
  }
  if (!PHASES.includes(rec.phase)) {
    throw new Error(`refuse: quarantine record '${key}' has unknown execution phase '${rec.phase}'`)
  }
}

/** The only states a CLEANED record may have come from. */
const CLEANED_FROM = Object.freeze([PRE_EXECUTION_ABORTED, PREPARATION_FAILED, EXECUTOR_RETIRED])

/**
 * ⛔ A CLEANED RECORD MUST SAY WHICH HISTORY IT HAD, AND THE TWO MUST NOT BLUR.
 *
 * Without this, a record that ran and a record that never ran are distinguishable only by
 * which optional fields happen to remain — so a truncated or partially-written record reads
 * as the harmless kind. Provenance is required, and each kind is checked for the evidence it
 * must and must not carry.
 */
/**
 * The record merge, as a pure function — SECOND LINE OF DEFENCE, AND DELIBERATELY REACHABLE.
 *
 * Precedence is prev < caller metadata < this module's validated values < the identity stamp.
 * The FIRST line of defence is assertNoReservedKeys(), which throws before a caller value for
 * an authoritative field ever reaches this merge. That is also why the ordering here cannot be
 * observed through the public API: by the time put() runs, meta and authoritative have disjoint
 * keys by construction.
 *
 * A mutation that swapped these two arguments therefore survived the whole suite — not because
 * the ordering does not matter, but because nothing could see it. Weaken the reserved list by
 * one key, or add an authoritative field and forget to reserve it, and this ordering becomes
 * the only thing standing between caller metadata and the audit trail. So it is exported and
 * tested on its own terms rather than left as an untested comment.
 */
function mergeRecord (prev, meta, authoritative, stamp) {
  return Object.assign({}, prev, meta, authoritative, stamp)
}

function assertCleanedProvenance (key, rec) {
  const from = rec.cleanedFrom
  if (!CLEANED_FROM.includes(from)) {
    throw new Error(`refuse: CLEANED record '${key}' has missing or unknown provenance '${from}'`)
  }
  if (from === EXECUTOR_RETIRED) {
    // ⛔ AN EXECUTED HISTORY IS ACCOUNTED FOR IN FULL, OR NOT ACCEPTED.
    // A truncated one — a phase but no identity, or identity but no terminal status — is a
    // record that cannot answer "what happened to that executor", which is the only reason
    // this row is kept after its envelope is gone.
    if (!PHASES.includes(rec.phase)) {
      throw new Error(`refuse: CLEANED record '${key}' came from EXECUTOR_RETIRED but has no valid execution phase`)
    }
    if (rec.agentId !== expectedAgentIdFor(key)) {
      throw new Error(`refuse: CLEANED record '${key}' came from EXECUTOR_RETIRED but its agentId is not the derived one (got '${rec.agentId}')`)
    }
    if (rec.sessionKey !== expectedSessionKeyFor(key)) {
      throw new Error(`refuse: CLEANED record '${key}' came from EXECUTOR_RETIRED but its sessionKey is not the derived one (got '${rec.sessionKey}')`)
    }
    if (!TERMINAL_TASK_STATUSES.includes(rec.taskStatus)) {
      throw new Error(`refuse: CLEANED record '${key}' came from EXECUTOR_RETIRED but its task never reached a terminal status (got '${rec.taskStatus}')`)
    }
    return
  }
  // ⛔ NO EXECUTOR EVER RAN, SO NO EXECUTION EVIDENCE OF ANY KIND MAY APPEAR.
  // Identity counts as execution evidence: a sessionKey on a run that never started names a
  // session nobody created, and it is exactly what a corrupted or forged row would carry to
  // look like an ordinary completed run.
  for (const field of ['phase', 'taskStatus', 'sessionKey', 'agentId', 'runId']) {
    if (rec[field] !== undefined && rec[field] !== null) {
      throw new Error(`refuse: CLEANED record '${key}' came from ${from} but claims execution evidence ${field}='${rec[field]}'`)
    }
  }
}

/**
 * A file-backed store using the existing data-dir convention, which already redirects test
 * processes away from the Owner's production store.
 *
 * ⛔ PERSISTENCE IS THE POINT, NOT A CONVENIENCE.
 * If this lived only in memory, a backend restart would forget that an OpenClaw task may
 * still be running — and the very next request would be authorised into exactly the state
 * this module exists to prevent. A crash is when you most need to remember.
 */
function fileStore (opts = {}) {
  const file = opts.file || path.join(resolveDataDir(), 'openclaw-quarantine.json')
  return {
    read () {
      let raw
      try {
        raw = fs.readFileSync(file, 'utf8')
      } catch (e) {
        // ⛔ ENOENT IS THE ONLY CONDITION THAT MEANS "EMPTY LEDGER".
        // Any other read failure is an unknown, and an unknown must not be reported as
        // "nothing is quarantined" — that is the one answer that unlocks execution.
        if (e && e.code === 'ENOENT') return {}
        throw new Error(`refuse: quarantine ledger unreadable (${(e && e.message) || 'unknown'})`)
      }
      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch (e) {
        throw new Error(`refuse: quarantine ledger unreadable (${(e && e.message) || 'unknown'})`)
      }
      return assertLedger(parsed)
    },
    write (all) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, JSON.stringify(all, null, 2), 'utf8')
    },
    file
  }
}

/**
 * @param {{ store?: {read:function,write:function}, now?: function }} options
 *   `store` is injected by tests so no unit test touches a real ledger.
 */
function createOpenClawQuarantine (options = {}) {
  const store = options.store || fileStore(options)
  const now = typeof options.now === 'function' ? options.now : () => new Date().toISOString()

  /**
   * THIS ledger's private grant brand. Never shared between instances and never exported,
   * so a grant proves which ledger issued it — not merely that some ledger did.
   */
  const issuedGrants = new WeakSet()

  /**
   * Injected session-retirement verifier. The default refuses EVERYTHING, so an unwired
   * ledger can never retire an executor — see retire().
   */
  const verifyRetirementProof = typeof options.verifyRetirementProof === 'function'
    ? options.verifyRetirementProof
    : () => false

  function assertId (approvalId) {
    if (typeof approvalId !== 'string' || !SAFE_ID.test(approvalId)) {
      throw new Error('quarantine requires a safe approvalId ([A-Za-z0-9_-]{1,64})')
    }
    return approvalId
  }

  /**
   * ⛔ VALIDATION LIVES HERE, NOT ONLY IN fileStore.
   *
   * It used to run inside fileStore.read(), so ANY injected store bypassed it completely — a
   * composition site could hand in a store returning records with a missing state or phase and
   * unaccounted() would quietly skip them. The validation guards a safety decision, so it
   * belongs on the path every read takes, not on one implementation of it.
   */
  const all = () => assertLedger(store.read())

  /**
   * ⛔ CALLER METADATA MAY NEVER REWRITE AUTHORITY.
   *
   * The previous shape was `Object.assign({ state: next }, patch)` — caller metadata LAST, so
   * a caller passing `{ state: 'CLEANED' }` simply overwrote the state the state machine had
   * just validated. The same held for phase and taskStatus. Every guard in this file runs
   * before that assignment, so the checks were real and the result was not.
   *
   * Two defences, deliberately both: reserved keys are REJECTED outright, so a caller cannot
   * even try; and authoritative values are applied LAST, so if a reserved key ever slipped
   * through it still could not win.
   */
  const RESERVED = Object.freeze([
    'state', 'phase', 'taskStatus', 'approvalId', 'updatedAt', 'cleanedFrom',
    // identity, for the same reason as the rest: it is evidence, not a note
    'agentId', 'sessionKey'
  ])

  function assertNoReservedKeys (meta, where) {
    if (!meta || typeof meta !== 'object') return
    for (const k of RESERVED) {
      if (Object.prototype.hasOwnProperty.call(meta, k)) {
        throw new Error(`refuse: '${k}' is authoritative and cannot be supplied as ${where} metadata`)
      }
    }
  }

  /**
   * @param {object} meta          caller metadata; reserved keys are refused
   * @param {object} authoritative values this module has validated; applied last
   */
  function put (approvalId, meta, authoritative = {}) {
    assertNoReservedKeys(meta, 'record')
    const ledger = all()
    const prev = ledger[approvalId] || {}
    ledger[approvalId] = mergeRecord(prev, meta, authoritative, { approvalId, updatedAt: now() })
    store.write(ledger)
    return ledger[approvalId]
  }

  function state (approvalId) {
    assertId(approvalId)
    const rec = all()[approvalId]
    return rec ? rec.state : null
  }

  function record (approvalId) {
    assertId(approvalId)
    return all()[approvalId] || null
  }

  /** Every approval whose executor may still be alive. */
  function unaccounted () {
    const ledger = all()
    return Object.keys(ledger)
      .filter((k) => UNACCOUNTED.includes(ledger[k].state))
      .map((k) => ledger[k])
  }

  /**
   * ⛔ THE GLOBAL LOCK. The unaccounted-for thing is a PROCESS, not an approval, so a
   * different approvalId is no safer than the same one: a second OpenClaw turn started now
   * could contend with a first that never stopped.
   */
  function canStart (approvalId) {
    assertId(approvalId)
    const live = unaccounted()
    if (live.length > 0) {
      const l = live[0]
      return {
        ok: false,
        reason: `refuse: OpenClaw execution is locked out while approval '${l.approvalId}' is ${l.state} and its task has not been observed terminal`,
        blockedBy: live.map((r) => ({ approvalId: r.approvalId, state: r.state }))
      }
    }
    const existing = record(approvalId)
    if (existing) {
      // Neither agent nor workspace is ever reused, so neither is an approvalId.
      return { ok: false, reason: `refuse: approval '${approvalId}' already has a quarantine record (${existing.state}); approvals are never reused` }
    }
    return { ok: true }
  }

  function begin (approvalId) {
    const gate = canStart(approvalId)
    if (!gate.ok) throw new Error(gate.reason)
    return put(approvalId, { startedAt: now() }, { state: PREPARED })
  }

  /**
   * Legal transitions. Anything absent here is refused by construction.
   *
   * RUNNING -> TERMINAL_OBSERVED exists because a task can genuinely end `failed`,
   * `timed_out`, `cancelled` or `lost` while we are still watching it. Without that edge a
   * normally-failing run stayed RUNNING and held the global lock FOREVER — found in review.
   * The edge is narrowed in observeTerminal so it cannot double as a success path.
   */
  const ALLOWED = Object.freeze({
    // PREPARED can end without ever running: the revision gate may refuse, or the sandbox
    // may fail to build. Neither path is available once RUNNING.
    [PREPARED]: [RUNNING, PRE_EXECUTION_ABORTED, PREPARATION_FAILED],
    [RUNNING]: [SUCCEEDED, CLIENT_TIMEOUT, TERMINAL_OBSERVED],
    [SUCCEEDED]: [TERMINAL_OBSERVED],
    [CLIENT_TIMEOUT]: [QUARANTINED],
    [QUARANTINED]: [TERMINAL_OBSERVED],
    // ⛔ TERMINAL_OBSERVED NO LONGER LEADS STRAIGHT TO CLEANED.
    // The session can still be auto-resumed, so retirement is a separate, proven step.
    [TERMINAL_OBSERVED]: [EXECUTOR_RETIRED],
    [EXECUTOR_RETIRED]: [CLEANED],
    [PRE_EXECUTION_ABORTED]: [CLEANED],
    [PREPARATION_FAILED]: [CLEANED],
    [CLEANED]: []
  })

  /** transition(), plus extra fields this module has validated and the caller may not set. */
  function transitionWith (approvalId, next, meta, authoritative) {
    assertTransition(approvalId, next)
    return put(approvalId, meta, Object.assign({}, authoritative, { state: next }))
  }

  function assertTransition (approvalId, next) {
    assertId(approvalId)
    const cur = state(approvalId)
    if (cur === null) throw new Error(`refuse: approval '${approvalId}' has no quarantine record`)
    const allowed = ALLOWED[cur] || []
    if (!allowed.includes(next)) {
      throw new Error(`refuse: illegal quarantine transition ${cur} -> ${next} for '${approvalId}'`)
    }
  }

  function transition (approvalId, next, meta = {}) {
    assertId(approvalId)
    const cur = state(approvalId)
    if (cur === null) throw new Error(`refuse: approval '${approvalId}' has no quarantine record`)
    const allowed = ALLOWED[cur] || []
    if (!allowed.includes(next)) {
      throw new Error(`refuse: illegal quarantine transition ${cur} -> ${next} for '${approvalId}'`)
    }
    return put(approvalId, meta, { state: next })
  }

  /**
   * Enter RUNNING. This is the LAST synchronous act before the first external spawn, so the
   * opening phase is written in the same durable record — there is no window in which the
   * ledger says a run started without saying how far it had got.
   */
  function markRunning (approvalId, meta = {}) {
    const phase = meta.phase
    if (phase !== PHASES[0]) {
      throw new Error(`refuse: markRunning must open at phase '${PHASES[0]}' (got '${phase}')`)
    }
    // ⛔ THE IDENTITY IS CHECKED AGAINST THE DERIVATION, NOT MERELY CHECKED FOR PRESENCE.
    // "some non-empty string" would have let a caller record a session key that does not
    // correspond to the agent it is about to spawn, which is worse than recording nothing:
    // reconciliation would query it, get "Task not found", and close out a live run.
    const agentId = expectedAgentIdFor(approvalId)
    const sessionKey = expectedSessionKeyFor(approvalId)
    if (meta.agentId !== agentId) {
      throw new Error(`refuse: markRunning requires the derived agentId '${agentId}' (got '${meta.agentId}')`)
    }
    if (meta.sessionKey !== sessionKey) {
      throw new Error(`refuse: markRunning requires the derived sessionKey '${sessionKey}' (got '${meta.sessionKey}')`)
    }
    // validated above, so all three are authoritative from here on and no later transition
    // can resupply them as metadata
    const rest = Object.assign({}, meta)
    delete rest.phase; delete rest.agentId; delete rest.sessionKey
    return transitionWith(approvalId, RUNNING, rest, { phase, agentId, sessionKey })
  }

  /**
   * Advance the execution phase. Monotonic: a phase may move forward or stay, never back.
   * A retreating phase would rewrite history in the direction of 'less was attempted', which
   * is precisely the direction that makes an unaccounted run look safe.
   */
  function advancePhase (approvalId, phase, meta = {}) {
    const idx = PHASES.indexOf(phase)
    if (idx < 0) throw new Error(`refuse: unknown execution phase '${phase}'`)
    const rec = record(approvalId)
    if (!rec) throw new Error(`refuse: approval '${approvalId}' has no quarantine record`)
    if (!EXECUTION_BEARING.includes(rec.state)) {
      throw new Error(`refuse: '${approvalId}' is ${rec.state}; only an execution-bearing record has a phase`)
    }
    const cur = PHASES.indexOf(rec.phase)
    if (cur < 0) throw new Error(`refuse: '${approvalId}' has unreadable current phase '${rec.phase}'`)
    if (idx < cur) {
      throw new Error(`refuse: execution phase cannot move backwards (${rec.phase} -> ${phase})`)
    }
    return put(approvalId, meta, { phase })
  }

  /**
   * ⛔ LATE SUCCESS IS REFUSED FOREVER.
   * Once we stopped waiting, a result arriving afterwards is not evidence the run was
   * clean — it is evidence the executor kept going after we lost sight of it. The
   * transition table has no CLIENT_TIMEOUT/QUARANTINED -> SUCCEEDED edge, and this wording
   * makes the refusal legible when it happens.
   */
  function markSucceeded (approvalId, meta = {}) {
    const cur = state(approvalId)
    if (cur === CLIENT_TIMEOUT || cur === QUARANTINED) {
      throw new Error(`refuse: '${approvalId}' is ${cur}; a late success is never accepted for a tainted run`)
    }
    return transition(approvalId, SUCCEEDED, meta)
  }

  /** We stopped waiting. This says nothing about whether the executor stopped. */
  function markClientTimeout (approvalId, meta = {}) {
    return transition(approvalId, CLIENT_TIMEOUT, meta)
  }

  function quarantine (approvalId, meta = {}) {
    return transition(approvalId, QUARANTINED, meta)
  }

  /**
   * The only exit from QUARANTINED: OpenClaw itself reporting a terminal task status.
   * Elapsed time is not an observation, and neither is our own hope.
   */
  function observeTerminal (approvalId, taskStatus, meta = {}) {
    if (!TERMINAL_TASK_STATUSES.includes(taskStatus)) {
      throw new Error(`refuse: '${taskStatus}' is not a terminal OpenClaw task status`)
    }
    const cur = state(approvalId)

    // ⛔ OBSERVING 'succeeded' IS NOT ACCEPTING A SUCCESS.
    // A task ending successfully is a fact about OpenClaw's scheduler. Accepting its output
    // is a separate decision that belongs to markSucceeded, after the result has actually
    // been received and verified. Letting observation stand in for acceptance would let a
    // run we never validated be recorded as a good one.
    if (taskStatus === 'succeeded' && (cur === RUNNING || cur === PREPARED)) {
      throw new Error(`refuse: '${approvalId}' is ${cur}; an observed 'succeeded' must pass through markSucceeded() before it can be accepted`)
    }

    // ⛔ AND A RECORDED SUCCESS CANNOT BE CONTRADICTED BY THE OBSERVATION.
    if (cur === SUCCEEDED && taskStatus !== 'succeeded') {
      throw new Error(`refuse: '${approvalId}' is SUCCEEDED but the observed task status is '${taskStatus}'`)
    }

    return transitionWith(approvalId, TERMINAL_OBSERVED, meta, { taskStatus })
  }

  /**
   * Issue an unforgeable proof that this approval's executor is terminal.
   * The workspace will not remove an envelope without one.
   */
  function issue (approvalId, kind, forState) {
    const grant = Object.freeze({ approvalId, kind, state: forState })
    issuedGrants.add(grant)
    return grant
  }

  /**
   * The only authority to remove an envelope that actually executed. Issuable ONLY once the
   * executor is retired — a terminal task status is explicitly not enough, because the
   * session may still be auto-resumed and would then need its workspace.
   */
  function retiredGrant (approvalId) {
    const cur = state(approvalId)
    if (cur !== EXECUTOR_RETIRED) {
      throw new Error(`refuse: '${approvalId}' is ${cur === null ? 'unknown' : cur}; removing an executed envelope requires the executor to be RETIRED, not merely observed terminal`)
    }
    return issue(approvalId, GRANT_EXECUTOR_RETIRED, EXECUTOR_RETIRED)
  }

  /**
   * A grant for a run that never reached an executor. Distinct in `kind` from a terminal
   * grant so the two removal paths can never be confused for one another, and unavailable
   * from RUNNING or anything downstream of it.
   */
  function preExecutionGrant (approvalId) {
    const cur = state(approvalId)
    if (cur !== PRE_EXECUTION_ABORTED && cur !== PREPARATION_FAILED) {
      throw new Error(`refuse: '${approvalId}' is ${cur === null ? 'unknown' : cur}; a pre-execution grant requires that no executor ever started`)
    }
    return issue(approvalId, GRANT_PRE_EXECUTION, cur)
  }

  /**
   * ⛔ THIS INSTANCE'S verifier — AND THE KIND IS AUTHORITY, NOT A LABEL.
   *
   * The first version checked only WeakSet membership and left `kind` sitting in the grant
   * as decoration. The two grants were therefore mechanically different as DATA but
   * identical as AUTHORITY: a genuine `terminal-observed` grant could authorise
   * abortPrepare(), which is the one operation that must only ever run when nothing has
   * executed. Membership alone answers "did this ledger issue something", not "did this
   * ledger authorise THIS".
   *
   * All three facts are now checked together, and the expected kind is supplied by the
   * OPERATION, never by whoever is calling it.
   */
  function verifyGrant (g, expect = {}) {
    if (!g || typeof g !== 'object') return false
    if (!issuedGrants.has(g)) return false
    if (g.approvalId !== expect.approvalId) return false
    const kinds = Array.isArray(expect.kind) ? expect.kind : [expect.kind]
    return kinds.includes(g.kind)
  }

  /**
   * ⛔ RETIREMENT CANNOT BE AUTHORISED BY ANY FACT WE CURRENTLY HAVE.
   *
   * Entering EXECUTOR_RETIRED asserts the session can no longer resume. Nothing available
   * today proves that: not a terminal task status, not elapsed time, not 'task not found',
   * not an absent agent, not client exit, and not a deleted workspace. Measured — there is no
   * OpenClaw primitive that neutralises a session without pruning its workspace.
   *
   * So the proof is INJECTED, and the default verifier refuses everything. Production
   * therefore fails closed and the lock stays held; tests exercise the contract with an
   * explicit fake. When a real neutralisation primitive is proven, it supplies the verifier —
   * and until then this transition is unreachable in production BY CONSTRUCTION rather than
   * by anyone remembering not to call it.
   */
  function retire (approvalId, proof, meta = {}) {
    if (!verifyRetirementProof(proof, { approvalId })) {
      throw new Error(`refuse: '${approvalId}' cannot be retired without a verified session-retirement proof; no neutralise-without-prune primitive is proven to exist`)
    }
    return transition(approvalId, EXECUTOR_RETIRED, meta)
  }

  /** No executor ever started: the revision gate refused before the worker was reached. */
  function abortPreExecution (approvalId, meta = {}) {
    return transition(approvalId, PRE_EXECUTION_ABORTED, meta)
  }

  /** The sandbox itself could not be built. */
  function failPreparation (approvalId, meta = {}) {
    return transition(approvalId, PREPARATION_FAILED, meta)
  }

  /**
   * ⛔ CLEANUP CANNOT RELEASE A QUARANTINE.
   * Deleting the envelope does not stop a process, so allowing cleanup to clear the lock
   * would let tidying up masquerade as containment.
   */
  /**
   * ⛔ CLEANED RECORDS WHERE IT CAME FROM, AND THE CALLER DOES NOT GET A VOTE.
   *
   * CLEANED is reachable by two fundamentally different histories — nothing ever ran, or it
   * ran and was retired — and the old record could not tell them apart except by guessing
   * from whichever optional fields happened to survive. Inferring history from leftovers is
   * how a corrupted record reads as a clean one. The provenance is taken from the state we
   * are actually leaving, and validated on every read.
   */
  function markCleaned (approvalId, meta = {}) {
    const from = state(approvalId)
    return transitionWith(approvalId, CLEANED, meta, { cleanedFrom: from })
  }

  /** May the envelope be removed? Only once terminality has actually been observed. */
  function mayCleanup (approvalId) {
    const cur = state(approvalId)
    // ⛔ TERMINAL_OBSERVED DOES NOT PERMIT CLEANUP OF AN EXECUTED WORKSPACE.
    // The session may still be auto-resumed and would then still need it. Only retirement,
    // or a run that never executed at all, permits removal.
    if (cur === EXECUTOR_RETIRED || cur === PRE_EXECUTION_ABORTED || cur === PREPARATION_FAILED) return { ok: true }
    if (cur === TERMINAL_OBSERVED) {
      return { ok: false, reason: `refuse: '${approvalId}' is TERMINAL_OBSERVED; the executor/session has not been retired` }
    }
    return { ok: false, reason: `refuse: '${approvalId}' is ${cur === null ? 'unknown' : cur}; cleanup requires an observed terminal task status` }
  }

  return {
    STATES,
    begin,
    markRunning,
    markSucceeded,
    markClientTimeout,
    quarantine,
    observeTerminal,
    retiredGrant,
    preExecutionGrant,
    verifyGrant,
    abortPreExecution,
    failPreparation,
    retire,
    advancePhase,
    markCleaned,
    mayCleanup,
    canStart,
    state,
    record,
    unaccounted,
    storeFile: store.file
  }
}

module.exports = {
  mergeRecord,
  expectedAgentIdFor,
  expectedSessionKeyFor,
  createOpenClawQuarantine,
  fileStore,
  assertLedger,
  STATES,
  KNOWN_STATES,
  PHASES,
  EXECUTION_BEARING,
  UNACCOUNTED,
  TERMINAL_TASK_STATUSES,
  TERMINAL_FAILURE_STATUSES,
  GRANT_EXECUTOR_RETIRED,
  GRANT_PRE_EXECUTION
}
