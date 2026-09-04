'use strict'

/**
 * openClawExecutorLauncher.js — THE ONE MODULE THAT ORDERS THE TWO LEDGERS AROUND A LAUNCH.
 *
 * ── WHAT THIS IS ─────────────────────────────────────────────────────────────
 * The sequencer for the NEW isolated executor path. It measures the prepared workspace,
 * records executor identity, opens the global lock, records launch intent, and only then
 * asks an injected seam to start a unit — then records only what it positively observes.
 * It is the sole spawn owner of the isolated path. The legacy transport still exists,
 * untouched, and is not composed with this module; global single-owner status arrives only
 * with the B4 cutover that removes it atomically.
 *
 * ── WHAT THIS IS NOT (B3) ────────────────────────────────────────────────────
 * Inert by construction: NO child_process, NO spawn, NO systemd-run, NO OpenClaw CLI, NO
 * default launch or stop adapter, NO real WSL write path. Every external action is an
 * injected seam with no production fallback; run() refuses before touching either ledger if
 * a required seam is missing. It is composed nowhere.
 *
 * ⛔ B4a REMOVED ONE OF THE THREE INTERLOCKS. BE HONEST ABOUT WHAT IS LEFT.
 * Until B4a, `executor_launch_attempting` was not in the ledger's vocabulary, so markRunning
 * refused this module outright — a third, independent reason it could not activate. B4a made
 * that phase canonical, so that refusal is gone. Two interlocks remain, and both are load
 * bearing: this module is CONSTRUCTED NOWHERE (there is no composition root anywhere outside
 * src/agent, and src/app.js does not import OpenClaw at all), and EVERY execution seam is
 * injected with NO default, so even a constructed launcher refuses before touching either
 * ledger. Both are asserted mechanically by test, not left to be remembered.
 *
 * ── THE DURABLE ORDER (the whole point) ─────────────────────────────────────
 *   quarantine.markRunning   (RUNNING — the lock becomes execution-bearing)
 *   instances.launchAttempted (LAUNCH_ATTEMPTED — a unit may exist from here on)
 *   launchUnit               (the only external write on this path)
 * strictly in that order, synchronously, with no await between the first two and no
 * unrelated operation between the second and the launch. PREPARED is not in the quarantine's
 * UNACCOUNTED set, so any other order leaves a window in which a live executor is not
 * covered by the lock. If markRunning throws, nothing later happens. If launchAttempted
 * throws, no launch happens. If the launch itself throws or answers ambiguously, NOTHING is
 * reset: the records stay execution-bearing and the caller is told the outcome is ambiguous.
 *
 * ── AUTHORITY ────────────────────────────────────────────────────────────────
 * A predicted control group is never written. Only a positive observation, read back through
 * the reader contract, reaches the instance record. Identity is the approvalId the caller
 * passes; nothing is parsed out of a path. recover() may stop, and may ask the verifier for a
 * diagnostic — it never retires. Retirement authority is B4's.
 *
 * ── POSITIVE ACKNOWLEDGEMENT ─────────────────────────────────────────────────
 * A launch or a stop counts as answered only by the exact shape `{ ok: true, unitName }` with
 * the derived unit name, as OWN properties. null, false, `{}`, `{ ok: false }`, a wrong unit,
 * a string 'true' — all of them are UNKNOWN. An answer that cannot even be INSPECTED without
 * throwing (a throwing getter, a Proxy trap, a revoked Proxy) is UNKNOWN too, never a crash.
 * An unacknowledged stop never reaches the verifier, and stop success is never read as
 * retirement.
 *
 * ── SEAMS ARE CAPTURED ONCE ──────────────────────────────────────────────────
 * Every dependency is read from `deps` exactly once, at construction. The set of missing
 * seams is fixed then, and run()/recover() call only the captured functions. Assigning,
 * deleting or re-answering a getter on `deps` afterwards changes nothing for this launcher.
 */

const { derivedPathsFor, unitNameFor, instanceIdFor, instanceMarkerFor, STATES, SAFE_ID } = require('./openClawInstanceManager')
const { expectedAgentIdFor, expectedSessionKeyFor } = require('./openClawQuarantine')
const C = require('./openClawReaderContracts')

/** The isolated-executor phase — since B4a, the ledger's canonical opening phase. */
const PHASE_EXECUTOR_LAUNCH_ATTEMPTING = 'executor_launch_attempting'
const PROTECTED_PORT = 18789

const OUTCOME = Object.freeze({
  REFUSED: 'refused',                         // nothing was written; nothing ran
  LAUNCH_AMBIGUOUS: 'launch-ambiguous',       // ledgers say launch attempted; the launch answer was unusable
  LAUNCHED_UNOBSERVED: 'launched-unobserved', // launched, but no positive cgroup — unretirable by construction
  OBSERVED: 'observed',                       // launched and the cgroup positively observed
  PRE_LAUNCH_RECOVERY_NOT_WIRED: 'pre-launch-recovery-not-wired',
  STOP_UNKNOWN: 'stop-unknown',
  UNRETIRABLE_NO_OBSERVED_CGROUP: 'unretirable-no-observed-cgroup',
  STOP_ISSUED_RETIREMENT_NOT_WIRED: 'stop-issued-retirement-not-wired'
})

const LAUNCH_SEAMS = Object.freeze(['statPath', 'allocateGatewayPort', 'launchUnit', 'observeControlGroup', 'readControlGroup'])

const data = () => Object.create(null)
const result = (fields) => { const o = data(); for (const k of Object.keys(fields)) o[k] = fields[k]; return Object.freeze(o) }

function assertId (approvalId) {
  if (typeof approvalId !== 'string' || !SAFE_ID.test(approvalId)) {
    throw new Error('refuse: unsafe approvalId ' + JSON.stringify(String(approvalId).slice(0, 40)))
  }
}

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

/**
 * The ONLY answer that counts as a positive acknowledgement from launchUnit / stopUnit:
 * an object carrying OWN `ok === true` and OWN `unitName === <the derived unit>`.
 * Everything else — null, undefined, booleans, {}, ok:false, ok:'true', a wrong unit — is not.
 */
function positiveAck (answer, unitName) {
  // ⛔ THE INSPECTION ITSELF MUST NEVER THROW. A throwing getter, a Proxy trap, or a revoked
  // Proxy would otherwise escape this helper and propagate out of run()/recover() as a crash —
  // turning an unusable answer into an exception instead of a fail-closed UNKNOWN, at the exact
  // moment a unit may be alive. Any exception raised while inspecting means NOT acknowledged.
  try {
    if (answer === null || typeof answer !== 'object') return false
    if (!hasOwn(answer, 'ok') || answer.ok !== true) return false
    if (!hasOwn(answer, 'unitName') || answer.unitName !== unitName) return false
    return true
  } catch (e) {
    return false
  }
}

/**
 * @param {{
 *   instances: object,               REQUIRED — the instance manager
 *   quarantine: object,              REQUIRED — must provide markRunning
 *   statPath?: function,             (path) -> raw stat result (reader contract)
 *   allocateGatewayPort?: function,  () -> number
 *   launchUnit?: function,           (spec) -> { ok:true, unitName }
 *   observeControlGroup?: function,  (unitName) -> string | null
 *   readControlGroup?: function,     (cgroupPath) -> raw control-group result (reader contract)
 *   stopUnit?: function,             (unitName) -> { ok:true, unitName }  (anything else = STOP_UNKNOWN)
 *   retirementVerifier?: object      { evaluate } — DIAGNOSTIC only in B3
 * }} deps — every external action is injected; there is no default for any of them.
 *           Each key is read EXACTLY ONCE, here. `deps` is never consulted again.
 */
function createOpenClawExecutorLauncher (deps = {}) {
  // ── single read of every dependency: one property access per key, at construction ──
  const instances = deps.instances
  const quarantine = deps.quarantine
  if (!instances || typeof instances.prepare !== 'function' || typeof instances.launchAttempted !== 'function' ||
      typeof instances.observeControlGroup !== 'function' || typeof instances.observePids !== 'function' ||
      typeof instances.requestStop !== 'function' || typeof instances.record !== 'function') {
    throw new TypeError('openClawExecutorLauncher requires the instance manager')
  }
  if (!quarantine || typeof quarantine.markRunning !== 'function') {
    throw new TypeError('openClawExecutorLauncher requires the quarantine ledger')
  }
  const captureSeam = (name) => { const v = deps[name]; return typeof v === 'function' ? v : null }
  const statPath = captureSeam('statPath')
  const allocateGatewayPort = captureSeam('allocateGatewayPort')
  const launchUnit = captureSeam('launchUnit')
  const observeControlGroup = captureSeam('observeControlGroup')
  const readControlGroup = captureSeam('readControlGroup')
  const stopUnit = captureSeam('stopUnit')
  const verifierDep = deps.retirementVerifier
  const verifier = verifierDep && typeof verifierDep.evaluate === 'function' ? verifierDep : null

  /**
   * The captured launch seams, frozen, and the missing set computed ONCE from them. A seam
   * missing at construction is missing for the life of this launcher; a seam present at
   * construction is the function run() will call, whatever happens to `deps` later.
   */
  const CAPTURED = Object.freeze(Object.assign(data(), { statPath, allocateGatewayPort, launchUnit, observeControlGroup, readControlGroup }))
  const MISSING_LAUNCH_SEAMS = Object.freeze(LAUNCH_SEAMS.filter((n) => CAPTURED[n] === null))

  /** Measure one governed path: raw stat -> reader contract -> exact strings, or null. */
  function measure (p) {
    let raw
    try { raw = statPath(p) } catch (e) { return null }
    const st = C.parseStatResult(raw)
    if (st === null || st.kind !== 'ok' || st.exists !== true) return null
    const o = data(); o.dev = st.dev; o.ino = st.ino; return o
  }

  /** The launch specification: data only, derived from identity. No secrets, no argv. */
  function buildLaunchSpec (approvalId, paths, gatewayPort) {
    return result({
      approvalId,
      instanceId: instanceIdFor(approvalId),
      unitName: unitNameFor(approvalId),
      instanceMarker: instanceMarkerFor(approvalId),
      gatewayPort,
      stateRoot: paths.stateRoot,
      configPath: paths.configPath,
      envelopeRoot: paths.envelopeRoot,
      repoRoot: paths.repoRoot
    })
  }

  /**
   * One approved launch, from measurement to positive observation. Synchronous, so the
   * durable order is a property of the source text, not of scheduling.
   */
  function run (approvalId) {
    assertId(approvalId)

    // ── refuse before touching EITHER ledger if any execution seam was missing at construction ──
    const missing = MISSING_LAUNCH_SEAMS
    if (missing.length) {
      return result({ ok: false, outcome: OUTCOME.REFUSED, approvalId, reason: 'execution seam not configured: ' + missing.join(', ') })
    }

    // ── pre-execution measurements: identity from the caller, paths from the derivation ──
    const paths = derivedPathsFor(approvalId)
    const envelopeObject = measure(paths.envelopeRoot)
    if (envelopeObject === null) return result({ ok: false, outcome: OUTCOME.REFUSED, approvalId, reason: 'envelope identity could not be measured' })
    const repoObject = measure(paths.repoRoot)
    if (repoObject === null) return result({ ok: false, outcome: OUTCOME.REFUSED, approvalId, reason: 'repo identity could not be measured' })

    let gatewayPort
    try { gatewayPort = allocateGatewayPort() } catch (e) { gatewayPort = null }
    if (!Number.isInteger(gatewayPort) || gatewayPort <= 0 || gatewayPort > 65535 || gatewayPort === PROTECTED_PORT) {
      return result({ ok: false, outcome: OUTCOME.REFUSED, approvalId, reason: 'no usable gateway port was allocated' })
    }

    // still pre-execution: the durable identity record, before any lock and any launch
    instances.prepare(approvalId, { gatewayPort, envelopeObject, repoObject })

    const spec = buildLaunchSpec(approvalId, paths, gatewayPort)

    // ══════════════ THE BOUNDARY — strictly ordered, synchronous ══════════════
    // 1. RUNNING first: from here the global lock covers whatever happens next.
    quarantine.markRunning(approvalId, {
      agentId: expectedAgentIdFor(approvalId),
      sessionKey: expectedSessionKeyFor(approvalId),
      phase: PHASE_EXECUTOR_LAUNCH_ATTEMPTING
    })
    // 2. launch intent, durable, before the launch.
    instances.launchAttempted(approvalId)
    // 3. the launch — the only external write on this path.
    let launched
    try {
      launched = launchUnit(spec)
    } catch (e) {
      // ⛔ NEVER RESET. A unit may exist. The ledgers stay execution-bearing / launch-attempted.
      return result({ ok: false, outcome: OUTCOME.LAUNCH_AMBIGUOUS, approvalId, unitName: spec.unitName, reason: 'launchUnit threw: ' + ((e && e.message) || 'unknown') })
    }
    if (!positiveAck(launched, spec.unitName)) {
      return result({ ok: false, outcome: OUTCOME.LAUNCH_AMBIGUOUS, approvalId, unitName: spec.unitName, reason: 'launchUnit answered ambiguously' })
    }
    // ═══════════════════════════════════════════════════════════════════════════

    // ── positive observation only: a predicted path is never written ──
    let observedPath
    try { observedPath = observeControlGroup(spec.unitName) } catch (e) { observedPath = null }
    if (typeof observedPath !== 'string' || observedPath === '' || observedPath[0] !== '/') {
      return result({ ok: false, outcome: OUTCOME.LAUNCHED_UNOBSERVED, approvalId, unitName: spec.unitName, reason: 'control group could not be observed' })
    }
    let cg
    try { cg = C.parseControlGroupResult(readControlGroup(observedPath)) } catch (e) { cg = null }
    if (cg === null || cg.kind !== 'ok' || cg.exists !== true) {
      return result({ ok: false, outcome: OUTCOME.LAUNCHED_UNOBSERVED, approvalId, unitName: spec.unitName, reason: 'observed control group could not be read back' })
    }
    instances.observeControlGroup(approvalId, observedPath)
    if (cg.procs.length > 0) instances.observePids(approvalId, cg.procs)

    return result({ ok: true, outcome: OUTCOME.OBSERVED, approvalId, unitName: spec.unitName, controlGroup: observedPath, pids: cg.procs.slice() })
  }

  /**
   * B3 recovery: stop what the durable record says may exist, and report. NO retirement
   * authority here — quarantine.retire is B4's, and nothing below can reach it.
   */
  function recover (approvalId) {
    assertId(approvalId)
    const rec = instances.record(approvalId)
    if (!rec) return result({ ok: false, outcome: OUTCOME.REFUSED, approvalId, reason: 'no instance record' })

    if (rec.state === STATES.PREPARED) {
      // nothing was launched; the pre-launch abort is an Owner-authorised B4 path
      return result({ ok: false, outcome: OUTCOME.PRE_LAUNCH_RECOVERY_NOT_WIRED, approvalId, reason: 'pre-launch recovery authority is not wired until B4' })
    }
    if (stopUnit === null) {
      return result({ ok: false, outcome: OUTCOME.REFUSED, approvalId, reason: 'execution seam not configured: stopUnit' })
    }

    // stop intent is durable BEFORE the stop is issued
    if (rec.state !== STATES.STOP_REQUESTED) instances.requestStop(approvalId)
    const unitName = unitNameFor(approvalId)
    let answer
    try {
      answer = stopUnit(unitName)
    } catch (e) {
      return result({ ok: false, outcome: OUTCOME.STOP_UNKNOWN, approvalId, unitName, reason: 'stopUnit failed: ' + ((e && e.message) || 'unknown') })
    }
    // ⛔ only the exact positive acknowledgement counts. Anything else is UNKNOWN: the record
    // stays STOP_REQUESTED, the verifier is NOT consulted, and nothing below claims a stop.
    if (!positiveAck(answer, unitName)) {
      return result({ ok: false, outcome: OUTCOME.STOP_UNKNOWN, approvalId, unitName, reason: 'stopUnit did not positively acknowledge ' + unitName })
    }

    const after = instances.record(approvalId)
    if (!after || !after.observedControlGroup) {
      return result({ ok: false, outcome: OUTCOME.UNRETIRABLE_NO_OBSERVED_CGROUP, approvalId, unitName, reason: 'no control group was ever observed; retirement is unprovable' })
    }

    // diagnostic readiness only — the verdict is reported, never acted on
    let diagnostic = null
    if (verifier) {
      try {
        const v = verifier.evaluate({ approvalId, instanceId: after.instanceId })
        diagnostic = result({ verdict: v && v.verdict, ok: v && v.ok === true, reason: v && v.reason })
      } catch (e) {
        diagnostic = result({ verdict: null, ok: false, reason: 'verifier threw: ' + ((e && e.message) || 'unknown') })
      }
    }
    return result({ ok: false, outcome: OUTCOME.STOP_ISSUED_RETIREMENT_NOT_WIRED, approvalId, unitName, verifierDiagnostic: diagnostic, reason: 'stop issued; retirement authority is wired in B4' })
  }

  return Object.freeze({ run, recover, buildLaunchSpec, OUTCOME, PHASE: PHASE_EXECUTOR_LAUNCH_ATTEMPTING })
}

module.exports = {
  createOpenClawExecutorLauncher,
  OUTCOME,
  PHASE_EXECUTOR_LAUNCH_ATTEMPTING,
  LAUNCH_SEAMS,
  PROTECTED_PORT
}
