'use strict'

/**
 * openClawComposition.js — THE OFFLINE COMPOSITION ROOT.
 *
 * Every OpenClaw module was written to be constructed nowhere. This is the one place that
 * constructs them, and it is deliberately still unreachable: nothing in src/ requires this
 * file, src/app.js has no OpenClaw reference, and the worker registry's OpenClaw row remains
 * connected:false. Requiring this module builds nothing and touches nothing — it exports a
 * factory, never an instance.
 *
 * ── WHAT ESCAPES, AND WHAT DOES NOT ─────────────────────────────────────────
 * The facade exposes OPERATIONS, never the authority behind them. Handing back the wired
 * quarantine would hand back `retire()` and `observeExecutorGone()` themselves: a caller could
 * retire an executor without stopping it, without an acknowledgement, without the coordinator
 * and without the re-entrancy guard. So no raw ledger, store, launcher, verifier, adapter,
 * seam, coordinator or token is reachable from the returned object, and every value handed
 * out is a detached, deep-frozen, null-prototype copy.
 *
 * ── ONE LOCK, FOR EVERY MUTATION ────────────────────────────────────────────
 * Both ledgers are whole-document read-modify-write with no CAS. Two processes writing them
 * lose each other's updates, and that is true of ANY mutating path — launching, aborting,
 * recovering, and reconciling (which writes through observeTerminal). So all of them, plus
 * status() which must read both ledgers together, run inside ONE critical section under ONE
 * fixed scope. The scope deliberately does not include the approvalId: different approvals
 * still rewrite the same two documents.
 *
 * ⛔ AND THE COORDINATOR IS NOT SUPPLIED HERE. B4b defines and tests the contract with fakes;
 * the production implementation, and the proof that it is exclusive across processes, is
 * B4c's. Without it every mutating operation refuses before touching anything.
 *
 * ── B4c, EXPLICITLY DEFERRED ────────────────────────────────────────────────
 *   · the production ledgerCoordinator and its cross-process exclusivity proof
 *   · governedWorkspace/wslWorkspace composition — and B4c MUST route their ledger-mutating
 *     prepare/cleanup paths through this same 'openclaw-ledgers-v1' scope, or the lock has a
 *     hole exactly where quarantine.begin() and markCleaned() live
 *   · the protected-gateway baseline for protectedInstancesOk
 *   · real allocateGatewayPort / launchUnit / observeControlGroup / stopUnit
 *   · API key + EnvironmentFile, systemd unit files, src/app.js mount, the legacy transport
 *     cutover, any real launch, any live model turn, deployment
 */

const { createOpenClawInstanceStore } = require('./openClawInstanceStore')
const { createOpenClawInstanceManager, unitNameFor, STATES: I } = require('./openClawInstanceManager')
const Q = require('./openClawQuarantine')
const { createOpenClawOsAdapters } = require('./openClawOsAdapters')
const { createOpenClawRetirementVerifier } = require('./openClawRetirementVerifier')
const { createOpenClawExecutorLauncher, OUTCOME: L } = require('./openClawExecutorLauncher')
const { createOpenClawReconciler } = require('./openClawReconciler')

/** ⛔ ONE scope for both documents. Never per-approval: they share the same two files. */
const LEDGER_SCOPE = 'openclaw-ledgers-v1'

/** The eight authoritative readers the verifier must have, or it can only answer UNKNOWN. */
const VERIFIER_READERS = Object.freeze([
  'readControlGroup', 'listPids', 'readStatus', 'readEnviron',
  'readCwd', 'readFds', 'statPath', 'readUnit'
])

/** The four seams that write to the OS. None of them has an implementation in this repo yet. */
const EXECUTION_SEAMS = Object.freeze(['allocateGatewayPort', 'launchUnit', 'observeControlGroup', 'stopUnit'])

const OUTCOME = Object.freeze({
  // refusals that are genuinely zero-effect
  REFUSED_NO_COORDINATOR: 'refused-no-coordinator',
  REFUSED_REENTRANT: 'refused-reentrant',
  REFUSED_COORDINATOR_FAILED: 'refused-coordinator-failed',
  REFUSED_COORDINATOR_DID_NOT_RUN: 'refused-coordinator-did-not-run',
  REFUSED_MISSING_SEAM: 'refused-missing-seam',
  REFUSED_NO_RETIREMENT_PATH: 'refused-no-retirement-path',
  REFUSED_PRECONDITION: 'refused-precondition',
  REFUSED_UNREADABLE: 'refused-unreadable',
  REFUSED_SEQUENCE_MISMATCH: 'refused-sequence-mismatch',
  // ⛔ outcomes that must never be mistaken for a refusal
  COORDINATOR_FAILED_AFTER_OPERATION: 'coordinator-failed-after-operation',
  COORDINATOR_FAILED_DURING_OPERATION: 'coordinator-failed-during-operation',
  COORDINATOR_PROTOCOL_VIOLATION_AFTER_OPERATION: 'coordinator-protocol-violation-after-operation',
  // operational results
  LAUNCHED: 'launched',
  LAUNCH_REFUSED: 'launch-refused',
  PRE_EXECUTION_ABORTED: 'pre-execution-aborted',
  ALREADY_ABORTED: 'already-aborted',
  RETIRED: 'retired',
  ALREADY_RETIRED: 'already-retired',
  ALREADY_RETIRED_WITH_SEQUENCE_MISMATCH: 'already-retired-with-sequence-mismatch',
  CONTAINED_HANDOFF: 'contained-handoff',
  CONTAINED_HANDOFF_REISSUED: 'contained-handoff-reissued',
  STOP_NOT_ACKNOWLEDGED: 'stop-not-acknowledged',
  UNRETIRABLE: 'unretirable',
  OBSERVE_REFUSED: 'observe-refused',
  RETIRE_REFUSED: 'retire-refused',
  NOTHING_TO_DO: 'nothing-to-do'
})

const data = () => Object.create(null)
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

/** A detached, deep-frozen, null-prototype copy. Nothing live is ever handed out. */
function detach (value) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    const a = []
    for (let i = 0; i < value.length; i++) Object.defineProperty(a, i, { value: detach(value[i]), enumerable: true })
    return Object.freeze(a)
  }
  const o = data()
  for (const k of Object.keys(value)) o[k] = detach(value[k])
  return Object.freeze(o)
}
const result = (fields) => detach(Object.assign({}, fields))

/**
 * ⛔ TOTAL, AND NON-THROWING FOR EVERY POSSIBLE THROWN VALUE.
 *
 * JavaScript lets anything be thrown, and reading `.message` off a hostile object can itself
 * throw — a getter, a Proxy trap, a revoked Proxy. This function runs at exactly the moment we
 * are reporting durable truth after a failure, so if IT threw, the structured result would be
 * replaced by a crash and the caller would learn nothing about what had already been written.
 * Every branch is guarded and every failure degrades to a bounded 'unknown'.
 */
function msg (e) {
  try {
    if (e === null) return 'null'
    if (e === undefined) return 'undefined'
    const t = typeof e
    if (t === 'string') return e.slice(0, 300)
    if (t === 'number' || t === 'boolean' || t === 'bigint') return String(e).slice(0, 300)
    if (t === 'symbol') { try { return String(e).slice(0, 300) } catch (_) { return 'unknown' } }
    if (t === 'function') return 'function'
    let m
    try { m = e.message } catch (_) { m = undefined }
    if (typeof m === 'string' && m !== '') return m.slice(0, 300)
    try {
      const s = String(e)
      return typeof s === 'string' ? s.slice(0, 300) : 'unknown'
    } catch (_) { return 'unknown' }
  } catch (_) { return 'unknown' }
}

/**
 * ⛔ AN UNFORGEABLE BRAND, NOT A PROPERTY.
 *
 * A protocol violation means OUR guard fired, and the outcome it selects is different from an
 * ordinary coordinator failure. Marking that with a property would let any coordinator throw
 * `{ 'openclaw-composition-protocol-violation': true }` and choose its own outcome; reading such
 * a property off a hostile object can also throw. Membership of a private WeakSet can neither be
 * forged from outside nor observed, and WeakSet.has runs no user code.
 */
const PROTOCOL_ERRORS = new WeakSet()
function protocolError (why) {
  const e = new Error('refuse: ' + why)
  PROTOCOL_ERRORS.add(e)
  return e
}
function isProtocolViolation (e) {
  try {
    if (e === null || e === undefined) return false
    const t = typeof e
    if (t !== 'object' && t !== 'function') return false
    return PROTOCOL_ERRORS.has(e)
  } catch (_) { return false }
}

/**
 * @param {{
 *   run: function,                    REQUIRED — the exact WSL runner (a mechanic: HOW, never WHERE)
 *   ledgerCoordinator?: object,       { runExclusive(scope, fn) } — absent => every mutation refuses
 *   allocateGatewayPort?: function,   the four execution seams: captured once, no defaults
 *   launchUnit?: function,
 *   observeControlGroup?: function,
 *   stopUnit?: function,
 *   executorUid?: number,
 *   protectedInstancesOk?: function,  the retirement safety gate; absent in B4b
 *   now?: function
 * }} deps
 *
 * ⛔ THERE IS NO store / fsImpl / path INPUT, AND THAT IS THE POINT.
 * openClawInstanceStore fixes its own path so no composition site can point the ledger
 * somewhere the verifier is not looking. Accepting a store object here would hand that
 * bypass straight back. Tests redirect AROMA_DATA_DIR and read the real JSON files.
 */
function createOpenClawComposition (deps = {}) {
  /**
   * ⛔ EVERY PROPERTY IS READ EXACTLY ONCE, INTO A LOCAL, AND NEVER CONSULTED AGAIN.
   *
   * `typeof deps.x === 'function' ? deps.x : null` reads the property TWICE, and a getter is
   * free to answer differently the second time — which is exactly how a hostile or merely
   * inconsistent object slips a different function past a check that already passed. So each
   * value is pulled out once and only the local is inspected. The same applies one level down:
   * `runExclusive` is taken from the coordinator once, before it is bound.
   */
  const runDep = deps.run
  const run = typeof runDep === 'function' ? runDep : null
  if (run === null) throw new TypeError('openClawComposition requires an exact WSL runner (run)')

  const coordinatorDep = deps.ledgerCoordinator
  const runExclusiveDep = (coordinatorDep === null || coordinatorDep === undefined) ? undefined : coordinatorDep.runExclusive
  const runExclusive = typeof runExclusiveDep === 'function' ? runExclusiveDep.bind(coordinatorDep) : null

  const captured = data()
  for (const name of EXECUTION_SEAMS) {
    const v = deps[name]
    captured[name] = typeof v === 'function' ? v : null
  }
  const SEAMS = Object.freeze(captured)
  const MISSING_SEAMS = Object.freeze(EXECUTION_SEAMS.filter((n) => SEAMS[n] === null))

  const protectionDep = deps.protectedInstancesOk
  const protectedInstancesOk = typeof protectionDep === 'function' ? protectionDep : null
  const executorUidDep = deps.executorUid
  const executorUid = executorUidDep
  const nowDep = deps.now
  const now = typeof nowDep === 'function' ? nowDep : undefined

  // ── the wiring itself: one direction, no cycle ──
  const instanceStore = createOpenClawInstanceStore()
  const instances = createOpenClawInstanceManager(now ? { store: instanceStore, now } : { store: instanceStore })
  const adapters = createOpenClawOsAdapters({ run })

  const verifierDeps = { instances }
  if (executorUid !== undefined) verifierDeps.executorUid = executorUid
  for (const r of VERIFIER_READERS) verifierDeps[r] = adapters[r]
  if (protectedInstancesOk) verifierDeps.protectedInstancesOk = protectedInstancesOk
  const verifier = createOpenClawRetirementVerifier(verifierDeps)

  // ⛔ verifyForQuarantine, never evaluate: the seam must answer with a literal boolean, and it
  // re-evaluates the world on every call. Nothing here may wrap, memoise or cache it — the two
  // verifications that B4a requires are two real readings of the world.
  const quarantineOpts = { verifyRetirementProof: verifier.verifyForQuarantine }
  if (now) quarantineOpts.now = now
  const quarantine = Q.createOpenClawQuarantine(quarantineOpts)

  const launcherDeps = {
    instances,
    quarantine,
    statPath: adapters.statPath,
    readControlGroup: adapters.readControlGroup,
    retirementVerifier: verifier
  }
  for (const name of EXECUTION_SEAMS) if (SEAMS[name]) launcherDeps[name] = SEAMS[name]
  const launcher = createOpenClawExecutorLauncher(launcherDeps)

  const reconciler = createOpenClawReconciler({ quarantine })

  // ⛔ derived from what was ACTUALLY WIRED into the verifier, not from what the adapters happen
  // to expose. If a reader is ever dropped from the wiring above, the capability must fall with
  // it — otherwise a verifier that can only answer UNKNOWN would still authorise a launch.
  const readersComplete = VERIFIER_READERS.every((r) => typeof verifierDeps[r] === 'function')
  const CAPABILITIES = Object.freeze(Object.assign(data(), {
    hasRunner: true,
    hasCoordinator: runExclusive !== null,
    hasProtectionGate: protectedInstancesOk !== null,
    hasVerifierReaders: readersComplete,
    canStop: SEAMS.stopUnit !== null,
    // ⛔ AN EXECUTOR THAT CANNOT BE RETIRED MUST NEVER BE STARTED.
    // Four execution seams are not enough: without the protection gate or a complete reader
    // set the verifier can only ever answer UNKNOWN, so retire() would refuse forever and the
    // global lock would be held by something nobody can account for.
    canLaunch: MISSING_SEAMS.length === 0 && protectedInstancesOk !== null &&
      readersComplete && runExclusive !== null,
    ledgerScope: LEDGER_SCOPE,
    missingSeams: Object.freeze(MISSING_SEAMS.slice())
  }))

  /* ══════════════ the one lock ══════════════ */

  let inFlight = false

  /**
   * Run one mutating operation inside the single global critical section.
   *
   * ⛔ THE PHASE MARKER IS THE HONESTY MECHANISM.
   * Only a failure raised BEFORE the callback was entered can truthfully be reported as a
   * zero-effect refusal. Once the section has begun, a stop may have been issued and a ledger
   * may have been written; calling that "refused" would be a false statement about durable
   * state, and rolling it back would be worse. So after entry we report what actually
   * happened, keep the inner outcome, and say plainly when we cannot tell.
   */
  function withLedgerLock (operation, approvalId, fn) {
    if (runExclusive === null) {
      return result({ ok: false, operation, approvalId, outcome: OUTCOME.REFUSED_NO_COORDINATOR, effects: 'none', reason: 'no ledger coordinator is configured; every mutation is refused' })
    }
    if (inFlight) {
      return result({ ok: false, operation, approvalId, outcome: OUTCOME.REFUSED_REENTRANT, effects: 'none', reason: 'a ledger operation is already in progress in this process' })
    }
    inFlight = true

    let phase = 'BEFORE'
    let calls = 0
    let returned = false
    let inner = null
    let innerCompleted = false
    /**
     * ⛔ THE SECTION RECORDS ITS OWN FAILURE BEFORE RETHROWING IT.
     *
     * A coordinator is free to CATCH what the callback throws and return normally. If the only
     * evidence of a failure were the exception propagating out of runExclusive, a swallowing
     * coordinator would erase it — and the post-checks would then read a duplicate-callback
     * violation as "never ran" and a mid-section failure as a clean result. Both would be false
     * statements about durable state. So the wrapper writes the failure down where the outer
     * code can find it regardless of what the coordinator does with the exception.
     *
     * ⛔ THE FLAG IS SEPARATE FROM THE VALUE. `throw null` is legal JavaScript, so using the
     * thrown value itself as the "did something fail" sentinel would read a genuine failure as
     * no failure at all — and then a swallowed `throw null` after entry would be returned as an
     * ordinary success. The boolean answers "did it fail"; the value is kept verbatim, whatever
     * it is, only to be described.
     */
    let sectionFailed = false
    let sectionError = null

    try {
      runExclusive(LEDGER_SCOPE, () => {
        try {
          if (returned) throw protocolError('the critical section was replayed AFTER runExclusive returned')
          calls += 1
          if (calls > 1) throw protocolError('the critical section was run more than once')
          phase = 'ENTERED'
          inner = fn()
          innerCompleted = true
          phase = 'COMPLETED'
        } catch (e) {
          if (!sectionFailed) { sectionFailed = true; sectionError = e }
          throw e
        }
      })
    } catch (e) {
      if (!sectionFailed) { sectionFailed = true; sectionError = e }
    } finally {
      returned = true
      inFlight = false
    }

    if (sectionFailed) {
      if (phase === 'BEFORE') {
        // the section never began: nothing was read, written or issued
        return result({ ok: false, operation, approvalId, outcome: OUTCOME.REFUSED_COORDINATOR_FAILED, effects: 'none', reason: msg(sectionError) })
      }
      return afterEntryFailure(operation, approvalId, sectionError, inner, innerCompleted)
    }
    // ⛔ ONLY a section that never began, and never failed, may be called "did not run".
    if (!sectionFailed && calls === 0 && phase === 'BEFORE') {
      return result({ ok: false, operation, approvalId, outcome: OUTCOME.REFUSED_COORDINATOR_DID_NOT_RUN, effects: 'none', reason: 'the coordinator never ran the critical section' })
    }
    return inner
  }

  /**
   * The section had begun, so durable effects are possible. Report the truth, keep the inner
   * outcome, and never roll anything back.
   */
  function afterEntryFailure (operation, approvalId, e, inner, innerCompleted) {
    const outcome = isProtocolViolation(e)
      ? OUTCOME.COORDINATOR_PROTOCOL_VIOLATION_AFTER_OPERATION
      : (innerCompleted ? OUTCOME.COORDINATOR_FAILED_AFTER_OPERATION : OUTCOME.COORDINATOR_FAILED_DURING_OPERATION)
    return result({
      ok: false,
      operation,
      approvalId,
      outcome,
      // ⛔ never 'none': the section ran
      effects: innerCompleted ? 'operation-completed' : 'possibly-partial',
      innerCompleted,
      innerOutcome: inner,
      reason: msg(e),
      observed: readBack(approvalId)
    })
  }

  /**
   * A DIAGNOSTIC re-read, taken after the coordinator has already failed — so it is explicitly
   * NOT a coordinated snapshot and must never be presented as one.
   */
  function readBack (approvalId) {
    const o = data()
    o.crossLedgerConsistency = 'UNVERIFIED'
    o.note = 'diagnostic re-read taken outside a valid critical section; not a consistent snapshot'
    try {
      o.quarantine = quarantine.record(approvalId)
    } catch (e) {
      o.quarantine = null
      o.quarantineUnreadable = msg(e)
      o.crossLedgerConsistency = 'UNKNOWN'
    }
    try {
      o.instance = instances.record(approvalId)
    } catch (e) {
      o.instance = null
      o.instanceUnreadable = msg(e)
      o.crossLedgerConsistency = 'UNKNOWN'
    }
    return detach(o)
  }

  /** Read both ledgers. Any read failure is a refusal that claims nothing about the lock. */
  function readPair (approvalId) {
    let q, i
    try { q = quarantine.record(approvalId) } catch (e) { return { unreadable: 'quarantine ledger unreadable: ' + msg(e) } }
    try { i = instances.record(approvalId) } catch (e) { return { unreadable: 'instance ledger unreadable: ' + msg(e) } }
    return { q, i, qState: q ? q.state : null, iState: i ? i.state : null }
  }

  const mismatch = (operation, approvalId, p, why) => result({
    ok: false,
    operation,
    approvalId,
    outcome: OUTCOME.REFUSED_SEQUENCE_MISMATCH,
    effects: 'none',
    quarantineState: p.qState,
    instanceState: p.iState,
    reason: why
  })

  const unreadable = (operation, approvalId, why) => result({
    ok: false,
    operation,
    approvalId,
    outcome: OUTCOME.REFUSED_UNREADABLE,
    effects: 'none',
    // ⛔ no lock claim: the ledger we would have to read to know is the one we cannot read
    lockClaim: 'none',
    reason: why
  })

  /* ══════════════ launch ══════════════ */

  function launchApproved (approvalId) {
    // static capability first — it cannot change inside the lock, and a launch without a
    // retirement path must never even be attempted
    if (!CAPABILITIES.canLaunch) {
      // report the MOST SPECIFIC cause: a caller that is told "no retirement path" when the
      // real problem is a missing coordinator will go looking in the wrong place.
      let why
      if (runExclusive === null) {
        why = { outcome: OUTCOME.REFUSED_NO_COORDINATOR, reason: 'no ledger coordinator is configured; every mutation is refused' }
      } else if (MISSING_SEAMS.length) {
        why = { outcome: OUTCOME.REFUSED_MISSING_SEAM, reason: 'execution seam not configured: ' + MISSING_SEAMS.join(', ') }
      } else {
        why = { outcome: OUTCOME.REFUSED_NO_RETIREMENT_PATH, reason: 'no complete retirement path: the protection gate or an authoritative reader is missing, so this executor could never be retired' }
      }
      return result(Object.assign({ ok: false, operation: 'launchApproved', approvalId, effects: 'none' }, why))
    }
    return withLedgerLock('launchApproved', approvalId, () => {
      // ⛔ every dynamic precondition is read HERE, inside the section that will also write
      const p = readPair(approvalId)
      if (p.unreadable) return unreadable('launchApproved', approvalId, p.unreadable)
      if (p.qState !== Q.STATES.PREPARED) {
        return result({ ok: false, operation: 'launchApproved', approvalId, outcome: OUTCOME.REFUSED_PRECONDITION, effects: 'none', quarantineState: p.qState, reason: 'quarantine must be exactly PREPARED; composition never calls begin()' })
      }
      if (p.i !== null) {
        return result({ ok: false, operation: 'launchApproved', approvalId, outcome: OUTCOME.REFUSED_PRECONDITION, effects: 'none', instanceState: p.iState, reason: 'an instance record already exists; a launch is never retried' })
      }
      const r = launcher.run(approvalId)
      return result({
        ok: r.outcome === L.OBSERVED,
        operation: 'launchApproved',
        approvalId,
        outcome: r.outcome === L.OBSERVED ? OUTCOME.LAUNCHED : OUTCOME.LAUNCH_REFUSED,
        effects: r.outcome === L.REFUSED ? 'none' : 'ledgers-written',
        launcher: r
      })
    })
  }

  /* ══════════════ pre-launch abort ══════════════ */

  function abortPrepared (approvalId) {
    return withLedgerLock('abortPrepared', approvalId, () => {
      const p = readPair(approvalId)
      if (p.unreadable) return unreadable('abortPrepared', approvalId, p.unreadable)

      if (p.qState === Q.STATES.PRE_EXECUTION_ABORTED) {
        if (p.iState !== null && p.iState !== I.PREPARED) {
          return mismatch('abortPrepared', approvalId, p, 'already aborted, but the instance record went past PREPARED')
        }
        return result({ ok: true, operation: 'abortPrepared', approvalId, outcome: OUTCOME.ALREADY_ABORTED, effects: 'none', reason: 'already aborted; nothing to write' })
      }
      if (p.qState !== Q.STATES.PREPARED) {
        return mismatch('abortPrepared', approvalId, p, 'pre-launch abort requires quarantine PREPARED')
      }
      // ⛔ instance may be absent (identity not yet written) or PREPARED (written, never launched).
      // Anything further means the launch boundary was crossed and this is not a pre-launch abort.
      if (p.iState !== null && p.iState !== I.PREPARED) {
        return mismatch('abortPrepared', approvalId, p, 'the instance record is past PREPARED; the launch boundary was crossed')
      }
      // ⛔ NO stopUnit. PREPARED is the only proof nothing was spawned; stopping a unit that was
      // never launched invents an OS action, and a "successful" stop would read as evidence it
      // existed. ⛔ NO execution evidence either: a PRE_EXECUTION_ABORTED history that carries
      // phase/taskStatus/sessionKey/agentId/runId/goneObservedAt is refused on the next read.
      quarantine.abortPreExecution(approvalId, { note: 'pre-launch abort' })
      return result({ ok: true, operation: 'abortPrepared', approvalId, outcome: OUTCOME.PRE_EXECUTION_ABORTED, effects: 'quarantine-written', stopIssued: false, verifierRun: false })
    })
  }

  /* ══════════════ recovery ══════════════ */

  const LAUNCHED_STATES = Object.freeze([I.LAUNCH_ATTEMPTED, I.OBSERVED, I.STOP_REQUESTED])

  function recoverInstance (approvalId) {
    return withLedgerLock('recoverInstance', approvalId, () => {
      const p = readPair(approvalId)
      if (p.unreadable) return unreadable('recoverInstance', approvalId, p.unreadable)
      if (p.q === null) return mismatch('recoverInstance', approvalId, p, 'no quarantine record')

      switch (p.qState) {
        case Q.STATES.PREPARED:
          if (p.iState !== null && p.iState !== I.PREPARED) {
            return mismatch('recoverInstance', approvalId, p, 'quarantine PREPARED but the instance record is past PREPARED')
          }
          quarantine.abortPreExecution(approvalId, { note: 'pre-launch abort during recovery' })
          return result({ ok: true, operation: 'recoverInstance', approvalId, outcome: OUTCOME.PRE_EXECUTION_ABORTED, effects: 'quarantine-written', stopIssued: false, verifierRun: false })

        case Q.STATES.PRE_EXECUTION_ABORTED:
          if (p.iState !== null && p.iState !== I.PREPARED) {
            return mismatch('recoverInstance', approvalId, p, 'aborted, but the instance record went past PREPARED')
          }
          return result({ ok: true, operation: 'recoverInstance', approvalId, outcome: OUTCOME.ALREADY_ABORTED, effects: 'none' })

        case Q.STATES.RUNNING:
          if (!LAUNCHED_STATES.includes(p.iState)) {
            return mismatch('recoverInstance', approvalId, p, 'quarantine RUNNING but nothing was ever launched')
          }
          return stopThenRetire(approvalId, p, true)

        case Q.STATES.TERMINAL_OBSERVED:
          if (!LAUNCHED_STATES.includes(p.iState)) {
            return mismatch('recoverInstance', approvalId, p, 'quarantine TERMINAL_OBSERVED but nothing was ever launched')
          }
          // ⛔ NEVER observeExecutorGone here. The record owns a taskStatus; adding a gone-stamp
          // would claim both retirement histories at once, which B4a refuses on the next read —
          // and the transition table has no TERMINAL_OBSERVED -> EXECUTOR_GONE_OBSERVED edge either.
          return stopThenRetire(approvalId, p, false)

        case Q.STATES.EXECUTOR_GONE_OBSERVED:
          if (p.iState !== I.STOP_REQUESTED) {
            return mismatch('recoverInstance', approvalId, p, 'observed gone, but the instance record is not STOP_REQUESTED')
          }
          // ⛔ no second stop and no second observation: the state itself records that the OS
          // was verified to have lost the executor, and retire() re-verifies the world anyway.
          return justRetire(approvalId, 'crash between observe and retire')

        case Q.STATES.EXECUTOR_RETIRED:
          if (p.iState === I.STOP_REQUESTED) {
            return result({ ok: true, operation: 'recoverInstance', approvalId, outcome: OUTCOME.ALREADY_RETIRED, effects: 'none' })
          }
          // the retirement is a durable fact and is NOT rolled back — but the pairing is wrong
          // and saying so is the whole point of recording it.
          return result({ ok: false, operation: 'recoverInstance', approvalId, outcome: OUTCOME.ALREADY_RETIRED_WITH_SEQUENCE_MISMATCH, effects: 'none', quarantineState: p.qState, instanceState: p.iState, reason: 'retirement stands, but the instance record does not match a completed stop' })

        case Q.STATES.SUCCEEDED:
        case Q.STATES.CLIENT_TIMEOUT:
        case Q.STATES.QUARANTINED:
          return containment(approvalId, p)

        case Q.STATES.CLEANED:
        case Q.STATES.PREPARATION_FAILED:
          return terminalPairing(approvalId, p)

        default:
          return mismatch('recoverInstance', approvalId, p, 'unhandled quarantine state')
      }
    })
  }

  /** requestStop (if needed) -> stop with a positive acknowledgement -> [observe] -> retire. */
  function stopThenRetire (approvalId, p, viaObservation) {
    /**
     * ⛔ THE LAUNCHER'S OWN ERROR FORMATTING IS NOT TOTAL, AND THIS FILE MAY NOT CHANGE IT.
     *
     * openClawExecutorLauncher catches a thrown stopUnit and describes it with
     * `(e && e.message) || 'unknown'`. Reading `.message` off a revoked Proxy or a throwing
     * getter throws AGAIN, from inside the catch — so a hostile stop answer escapes recover()
     * entirely. Left alone it would surface as a coordinator/section failure, which would be a
     * false description of what happened: the stop intent is durable, the stop is unacknowledged
     * and the lock is held. Containing it here keeps the report truthful without touching a
     * production file outside this gate's scope.
     */
    let r
    try {
      r = launcher.recover(approvalId)
    } catch (e) {
      return result({
        ok: false,
        operation: 'recoverInstance',
        approvalId,
        outcome: OUTCOME.STOP_NOT_ACKNOWLEDGED,
        // requestStop runs before the stop, so the intent may already be durable
        effects: 'possibly-partial',
        lockHeld: true,
        reason: 'the stop path threw and could not describe itself: ' + msg(e)
      })
    }
    if (r.outcome === L.REFUSED) {
      return result({ ok: false, operation: 'recoverInstance', approvalId, outcome: OUTCOME.REFUSED_MISSING_SEAM, effects: 'none', launcher: r, reason: r.reason })
    }
    if (r.outcome === L.STOP_UNKNOWN) {
      // the instance record may now be STOP_REQUESTED; that is a real, recorded effect
      return result({ ok: false, operation: 'recoverInstance', approvalId, outcome: OUTCOME.STOP_NOT_ACKNOWLEDGED, effects: 'stop-intent-recorded', lockHeld: true, launcher: r })
    }
    if (r.outcome === L.UNRETIRABLE_NO_OBSERVED_CGROUP) {
      return result({ ok: false, operation: 'recoverInstance', approvalId, outcome: OUTCOME.UNRETIRABLE, effects: 'stop-intent-recorded', lockHeld: true, launcher: r })
    }
    if (r.outcome !== L.STOP_ISSUED_RETIREMENT_NOT_WIRED) {
      return result({ ok: false, operation: 'recoverInstance', approvalId, outcome: OUTCOME.REFUSED_SEQUENCE_MISMATCH, effects: 'unknown', launcher: r, reason: 'unexpected launcher recovery outcome' })
    }

    if (viaObservation) {
      try {
        // fresh verification #1 — the ledger calls the verifier itself
        quarantine.observeExecutorGone(approvalId, { approvalId, instanceId: approvalId }, { note: 'recovery' })
      } catch (e) {
        return result({ ok: false, operation: 'recoverInstance', approvalId, outcome: OUTCOME.OBSERVE_REFUSED, effects: 'stop-issued', lockHeld: true, reason: msg(e) })
      }
    }
    return justRetire(approvalId, viaObservation ? 'recovery' : 'terminal-observed recovery')
  }

  /** fresh verification #2 (or the only one, on the task history). */
  function justRetire (approvalId, note) {
    try {
      quarantine.retire(approvalId, { approvalId, instanceId: approvalId }, { note })
    } catch (e) {
      // ⛔ the lock stays held: the world may have changed back between the two verifications
      return result({ ok: false, operation: 'recoverInstance', approvalId, outcome: OUTCOME.RETIRE_REFUSED, effects: 'no-retirement', lockHeld: true, reason: msg(e) })
    }
    return result({ ok: true, operation: 'recoverInstance', approvalId, outcome: OUTCOME.RETIRED, effects: 'quarantine-written', lockHeld: false })
  }

  /**
   * SUCCEEDED / CLIENT_TIMEOUT / QUARANTINED: there is no legal OS-history transition out of
   * these, and inventing a task status to reach TERMINAL_OBSERVED would be a forgery. So the
   * most that may happen is containment — and the lock stays held for a person to resolve.
   */
  function containment (approvalId, p) {
    if (p.iState === null || p.iState === I.PREPARED) {
      return mismatch('recoverInstance', approvalId, p, 'nothing was launched, so there is nothing to contain')
    }
    if (!CAPABILITIES.canStop) {
      return result({ ok: false, operation: 'recoverInstance', approvalId, outcome: OUTCOME.REFUSED_MISSING_SEAM, effects: 'none', lockHeld: true, reason: 'execution seam not configured: stopUnit' })
    }
    const reissued = p.iState === I.STOP_REQUESTED
    if (!reissued) {
      // ⛔ the containment stop DOES write: the intent is durable before the stop is issued
      instances.requestStop(approvalId, { note: 'containment during recovery' })
    }
    let acknowledged = false
    let stopReason = null
    try {
      const answer = SEAMS.stopUnit(unitNameFor(approvalId))
      acknowledged = isPositiveAck(answer, unitNameFor(approvalId))
    } catch (e) {
      stopReason = msg(e)
    }
    return result({
      ok: false,
      operation: 'recoverInstance',
      approvalId,
      outcome: reissued ? OUTCOME.CONTAINED_HANDOFF_REISSUED : OUTCOME.CONTAINED_HANDOFF,
      effects: reissued ? 'stop-reissued' : 'stop-intent-recorded',
      quarantineState: p.qState,
      instanceState: reissued ? p.iState : I.STOP_REQUESTED,
      stopAcknowledged: acknowledged,
      stopReason,
      // ⛔ the quarantine does NOT advance and the lock is NOT released
      lockHeld: true,
      reason: 'no legal retirement path from this state; handed to the reconciler and a person'
    })
  }

  /** CLEANED / PREPARATION_FAILED: legal pairings depend on the recorded provenance. */
  function terminalPairing (approvalId, p) {
    const from = p.qState === Q.STATES.CLEANED ? p.q.cleanedFrom : Q.STATES.PREPARATION_FAILED
    let legal
    if (from === Q.STATES.PRE_EXECUTION_ABORTED) legal = [null, I.PREPARED]
    else if (from === Q.STATES.PREPARATION_FAILED) legal = [null]
    else if (from === Q.STATES.EXECUTOR_RETIRED) legal = [I.STOP_REQUESTED]
    else legal = []

    if (!legal.includes(p.iState)) {
      return mismatch('recoverInstance', approvalId, p, `provenance ${from} does not admit instance state ${p.iState}`)
    }
    return result({ ok: true, operation: 'recoverInstance', approvalId, outcome: OUTCOME.NOTHING_TO_DO, effects: 'none', provenance: from })
  }

  /* ══════════════ read paths ══════════════ */

  function reconcile () {
    return withLedgerLock('reconcile', null, () => {
      // reconcile() writes through observeTerminal, so it belongs inside the same section
      return result({ ok: true, operation: 'reconcile', report: reconciler.reconcile() })
    })
  }

  /** Single-ledger read: no coordinator needed, and none is claimed. */
  function gate (approvalId) {
    try {
      return result(Object.assign({ operation: 'gate' }, reconciler.gate(approvalId)))
    } catch (e) {
      return unreadable('gate', approvalId, msg(e))
    }
  }

  /** Single-ledger read. */
  function listUnaccounted () {
    try {
      return detach(quarantine.unaccounted())
    } catch (e) {
      return unreadable('listUnaccounted', null, msg(e))
    }
  }

  /**
   * ⛔ TWO FILES, ONE SNAPSHOT. status() reads BOTH ledgers, and they are not one atomic
   * document — an uncoordinated pair of reads can show a new instance record beside a stale
   * quarantine record. That torn pair would be presented as "current state" and acted on. So
   * status() takes the same lock, and without a coordinator it refuses rather than guessing.
   */
  function status (approvalId) {
    return withLedgerLock('status', approvalId, () => {
      const p = readPair(approvalId)
      if (p.unreadable) return unreadable('status', approvalId, p.unreadable)
      return result({
        ok: true,
        operation: 'status',
        approvalId,
        quarantine: p.q,
        instance: p.i,
        quarantineState: p.qState,
        instanceState: p.iState,
        crossLedgerConsistency: 'COORDINATED'
      })
    })
  }

  return Object.freeze({
    launchApproved,
    abortPrepared,
    recoverInstance,
    reconcile,
    gate,
    status,
    listUnaccounted,
    capabilities: CAPABILITIES
  })
}

/** The same strict acknowledgement shape the launcher requires, applied to containment stops. */
function isPositiveAck (answer, unitName) {
  try {
    if (answer === null || typeof answer !== 'object') return false
    if (!hasOwn(answer, 'ok') || answer.ok !== true) return false
    if (!hasOwn(answer, 'unitName') || answer.unitName !== unitName) return false
    return true
  } catch (e) {
    return false
  }
}

module.exports = { createOpenClawComposition, LEDGER_SCOPE, OUTCOME, EXECUTION_SEAMS, VERIFIER_READERS }
