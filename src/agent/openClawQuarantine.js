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
const CLEANED = 'CLEANED'

const STATES = Object.freeze({
  PREPARED, RUNNING, SUCCEEDED, CLIENT_TIMEOUT, QUARANTINED, TERMINAL_OBSERVED, CLEANED
})

/**
 * States in which an OpenClaw process may still be alive and unaccounted for.
 * These are what hold the global execution lock.
 */
const UNACCOUNTED = Object.freeze([RUNNING, CLIENT_TIMEOUT, QUARANTINED])

/** The terminal task statuses OpenClaw itself reports. Anything else is not an observation. */
const TERMINAL_TASK_STATUSES = Object.freeze(['succeeded', 'failed', 'timed_out', 'cancelled', 'lost'])

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
      try {
        const raw = fs.readFileSync(file, 'utf8')
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
      } catch (e) {
        // A missing file is an empty ledger. A CORRUPT file is not: reporting "nothing is
        // quarantined" because the JSON failed to parse would fail open on the one question
        // this module exists to answer.
        if (e && e.code === 'ENOENT') return {}
        throw new Error(`refuse: quarantine ledger unreadable (${(e && e.message) || 'unknown'})`)
      }
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

  function assertId (approvalId) {
    if (typeof approvalId !== 'string' || !SAFE_ID.test(approvalId)) {
      throw new Error('quarantine requires a safe approvalId ([A-Za-z0-9_-]{1,64})')
    }
    return approvalId
  }

  const all = () => store.read()

  function put (approvalId, patch) {
    const ledger = all()
    const prev = ledger[approvalId] || {}
    ledger[approvalId] = Object.assign({}, prev, patch, { approvalId, updatedAt: now() })
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
    return put(approvalId, { state: PREPARED, startedAt: now() })
  }

  /** Legal transitions. Anything absent here is refused by construction. */
  const ALLOWED = Object.freeze({
    [PREPARED]: [RUNNING],
    [RUNNING]: [SUCCEEDED, CLIENT_TIMEOUT],
    [SUCCEEDED]: [TERMINAL_OBSERVED],
    [CLIENT_TIMEOUT]: [QUARANTINED],
    [QUARANTINED]: [TERMINAL_OBSERVED],
    [TERMINAL_OBSERVED]: [CLEANED],
    [CLEANED]: []
  })

  function transition (approvalId, next, patch = {}) {
    assertId(approvalId)
    const cur = state(approvalId)
    if (cur === null) throw new Error(`refuse: approval '${approvalId}' has no quarantine record`)
    const allowed = ALLOWED[cur] || []
    if (!allowed.includes(next)) {
      throw new Error(`refuse: illegal quarantine transition ${cur} -> ${next} for '${approvalId}'`)
    }
    return put(approvalId, Object.assign({ state: next }, patch))
  }

  const markRunning = (approvalId, meta = {}) => transition(approvalId, RUNNING, meta)

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
    return transition(approvalId, TERMINAL_OBSERVED, Object.assign({ taskStatus }, meta))
  }

  /**
   * ⛔ CLEANUP CANNOT RELEASE A QUARANTINE.
   * Deleting the envelope does not stop a process, so allowing cleanup to clear the lock
   * would let tidying up masquerade as containment.
   */
  function markCleaned (approvalId, meta = {}) {
    return transition(approvalId, CLEANED, meta)
  }

  /** May the envelope be removed? Only once terminality has actually been observed. */
  function mayCleanup (approvalId) {
    const cur = state(approvalId)
    if (cur === TERMINAL_OBSERVED) return { ok: true }
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
  createOpenClawQuarantine,
  fileStore,
  STATES,
  UNACCOUNTED,
  TERMINAL_TASK_STATUSES
}
