'use strict'

/**
 * openClawRetirementVerifier.js — OS EVIDENCE THAT AN EXECUTOR CANNOT RUN AGAIN. INERT.
 *
 * ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
 * openClawQuarantine.retire() refuses everything by default, because C2-B2-B2C measured that
 * no OpenClaw primitive neutralises a session without pruning its workspace. This module is
 * the answer: retirement is decided from the operating system — an empty control group, a
 * process table with nothing of ours in it — never from OpenClaw reporting its own absence,
 * and never from the workspace being gone.
 *
 * ── THE THINGS THAT ARE NOT EVIDENCE, EACH ONE MEASURED ─────────────────────
 *   unit gone            X2-B: the unit ends ActiveState=failed / Result=timeout on a CLEAN,
 *                        successful retirement, because a SIGTERM-resistant descendant forced
 *                        systemd to escalate. Keying on unit success would reject exactly the
 *                        case this exists to handle.
 *   process-group empty  X2-B: the detached helper had its own PGID and SID, so the gateway's
 *                        process group contained only the gateway. A PGID kill would have
 *                        missed it entirely. Only the CGROUP holds detached descendants.
 *   port free            a port is a number the OS re-issues. Absence proves nothing, and a
 *                        listener may belong to an unrelated later tenant.
 *   workspace gone       deleting a directory does not stop a process — and here the workspace
 *                        must SURVIVE, or retirement was proven by the wrong thing.
 *   elapsed time         a long-running turn is not a finished one.
 *   client exit          measured in C2-B2-A: killing the client changed nothing.
 *
 * ── V1 THREAT MODEL, AND WHEN THIS APPROVAL EXPIRES ─────────────────────────
 * V1 assumes OpenClaw and its provider/helper descendants are COOPERATIVE. Specifically it
 * assumes they do not deliberately: erase the instance marker to evade detection; migrate
 * themselves into a sibling cgroup to evade the stop; or escalate privilege to evade
 * same-UID inspection.
 *
 * That assumption is load-bearing because X2-B measured that a sibling unit's cgroup.procs IS
 * writable by uid 1000 — self-migration is POSSIBLE, not blocked. The marker scan and the
 * holder scan are what make it survivable, so they are REQUIRED and never optional.
 *
 * ⛔ THIS APPROVAL EXPIRES if OpenClaw gains arbitrary shell/exec, arbitrary user executable
 * code, untrusted executable plugins, equivalent executable browser helpers, or intentional
 * cgroupfs manipulation. At that point this verifier is invalid pending a stronger isolation
 * review, and saying so here is part of the design rather than a footnote.
 */

const C = require('./openClawReaderContracts')

const VERDICT = Object.freeze({
  RETIRED: 'RETIRED',
  LIVE: 'LIVE',
  UNKNOWN: 'UNKNOWN'
})

/** The uid the executor runs as. Everything else in the process table is not our business. */
const DEFAULT_EXECUTOR_UID = 1000

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * The retirement authority predicate, as a pure function — SECOND LINE OF DEFENCE, AND
 * DELIBERATELY REACHABLE. (Declared after VERDICT and isPlainObject, which it depends on;
 * an earlier revision placed it above them and worked only by hoisting.)
 *
 * ok and verdict are two independent statements of the same decision, and the seam requires
 * BOTH. Inside evaluate() they can never disagree, which means the verdict half of the check
 * is unobservable through the public API — a mutant that deleted it survived the whole suite.
 * Rather than leave the check asserted only by a comment, it lives here where a test can hand
 * it the impossible-today combination { ok: true, verdict: LIVE } and prove it is refused.
 */
function isRetirementAuthority (result) {
  // ⛔ OWN PROPERTIES, ON A GENUINE DATA OBJECT.
  // This is the last thing between a refusal and the global lock being released, so it does
  // not get to assume its input came from evaluate(). Object.create({ok:true,
  // verdict:'RETIRED'}) used to satisfy it — borrowed authority, on the one predicate that
  // must never be borrowed.
  if (!C.isDataObject(result)) return false
  const own = (k) => Object.prototype.hasOwnProperty.call(result, k)
  return own('ok') && result.ok === true && own('verdict') && result.verdict === VERDICT.RETIRED
}

/**
 * ⛔ EXACTLY ONE VARIANT, OR NOTHING — PURE, AND DELIBERATELY REACHABLE.
 *
 * The reader contract says a facet result is OK, GONE or UNREADABLE. The first implementation
 * asked `gone === true` first and let that win, so a contradictory
 *     { gone: true, ok: true, uid: 1000 }
 * classified as GONE — and a LIVE executor process would have been skipped on the way to
 * RETIRED. A reader that claims two things at once has not told us which is true; it has told
 * us it is broken.
 *
 * Returns 'ok' | 'gone' | 'unreadable', or null for contradictory, empty or malformed results.
 * null always becomes UNKNOWN at the call site. No variant outranks another.
 */
/** Canonical decimal string identity, matching the instance manager's representation. */
const CANONICAL_UINT = /^(0|[1-9][0-9]*)$/
const isCanonicalUint = (v) => typeof v === 'string' && CANONICAL_UINT.test(v)

/**
 * @param {{
 *   instances: object,               the instance manager (identity, never OS facts)
 *   executorUid?: number,
 *   readControlGroup?: function,     (cgroupPath) -> { exists, procs[] } | { unreadable:true }
 *
 *   ── the per-facet /proc contract (review finding F7) ──
 *   listPids?: function,             () -> { pids:[number] } | { unreadable:true }
 *   readStatus?: function,           (pid) -> { ok:true, uid:number } | { gone:true } | { unreadable:true }
 *   readEnviron?: function,          (pid) -> { ok:true, marker:string|null } | { gone:true } | { unreadable:true }
 *   readCwd?: function,              (pid) -> { ok:true, cwd:string } | { gone:true } | { unreadable:true }
 *   readFds?: function,              (pid) -> { ok:true, fds:[string] } | { gone:true } | { unreadable:true }
 *
 *   statPath?: function,             (path) -> { exists, dev:string, ino:string } | { unreadable:true }
 *   readUnit?: function,             (unitName) -> { exists, restart, activeState, subState, result, successor }
 *   listListeners?: function,        (port) -> [{ pid }]     CORROBORATING ONLY
 *   protectedInstancesOk?: function  () -> boolean           safety gate
 * }} deps
 *
 * ⛔ THERE IS NO DEFAULT READER FOR ANYTHING.
 * No child_process, no WSL runner, no systemd runner, no /proc access. A missing reader is
 * not "assume clean" — it is UNKNOWN, which fails closed.
 *
 * ⛔ AND EACH /proc FACET IS ITS OWN READER, ON PURPOSE.
 * The first version took one aggregate `inspectable` boolean per process, which collapsed
 * status, environ, cwd and fd into a single claim — a process whose fds were unreadable could
 * be scanned as clean if the reader felt generous. Each facet now answers for itself, and this
 * module decides what a failure means. A facet that says `gone` means the PID vanished (it can
 * hold nothing); a facet that says `unreadable` is a hole in the scan and yields UNKNOWN.
 * Permission denied is NEVER treated as vanished.
 */
function createOpenClawRetirementVerifier (deps = {}) {
  const { instances } = deps
  if (!instances || typeof instances.record !== 'function') {
    throw new TypeError('openClawRetirementVerifier requires the instance manager')
  }
  // ⛔ A NEGATIVE executorUid SILENTLY DISABLES THE ENTIRE SAME-UID SCAN.
  // Number.isInteger(-1) is true, so -1 was accepted — and then no real process could ever
  // match it, every executor-uid process was classified as unrelated, and a clean-looking
  // RETIRED came back with the executor still running. A misconfiguration must refuse loudly
  // at construction rather than quietly answer the wrong question forever.
  let executorUid = DEFAULT_EXECUTOR_UID
  if (Object.prototype.hasOwnProperty.call(deps, 'executorUid')) {
    if (!Number.isInteger(deps.executorUid) || deps.executorUid < 0) {
      throw new TypeError(
        'openClawRetirementVerifier requires executorUid to be an integer >= 0 (got ' +
        JSON.stringify(deps.executorUid) + ')'
      )
    }
    executorUid = deps.executorUid
  }
  const fn = (name) => (typeof deps[name] === 'function' ? deps[name] : null)

  const readControlGroup = fn('readControlGroup')
  const listPids = fn('listPids')
  const readStatus = fn('readStatus')
  const readEnviron = fn('readEnviron')
  const readCwd = fn('readCwd')
  const readFds = fn('readFds')
  const statPath = fn('statPath')
  const readUnit = fn('readUnit')
  const listListeners = fn('listListeners')
  const protectedInstancesOk = fn('protectedInstancesOk')

  const unknown = (reason, evidence) => ({ ok: false, verdict: VERDICT.UNKNOWN, reason, evidence: evidence || {} })
  const live = (reason, evidence) => ({ ok: false, verdict: VERDICT.LIVE, reason, evidence: evidence || {} })

  /**
   * Evaluate the world right now for one instance identity.
   *
   * ⛔ THE CALLER SUPPLIES IDENTITY AND NOTHING ELSE.
   * Any other property on the argument — cgroupEmpty, processGone, workspaceIntact — is never
   * read. Not validated and rejected: never read at all, so there is no field to forge.
   */
  function evaluate (identityRef = {}) {
    const approvalId = identityRef && identityRef.approvalId
    const instanceId = identityRef && identityRef.instanceId

    /* ── (1) identity resolves to exactly one durable record ── */
    let rec
    try {
      rec = instances.record(approvalId)
    } catch (e) {
      return unknown(`refuse: the instance store could not be read (${(e && e.message) || e})`)
    }
    if (!rec) return unknown(`refuse: approval '${approvalId}' has no instance record`)
    if (rec.instanceId !== instanceId) {
      return unknown(`refuse: instanceId '${instanceId}' does not match the record for '${approvalId}'`)
    }

    const evidence = { approvalId, instanceId, unitName: rec.unitName }

    /* ── (2) a control group was positively observed ── */
    // Without it we never learned where the executor actually lived, so there is nothing to
    // prove empty. A predicted path is not a substitute.
    if (!rec.observedControlGroup) {
      return unknown(`refuse: '${approvalId}' never observed a control group; retirement is unprovable`)
    }
    evidence.controlGroup = rec.observedControlGroup

    /* ── every reader must exist; a missing source is UNKNOWN, never "clean" ── */
    if (!readControlGroup || !listPids || !readStatus || !readEnviron || !readCwd || !readFds ||
        !statPath || !readUnit || !protectedInstancesOk) {
      return unknown('refuse: an authoritative evidence source is not available to this verifier')
    }

    /* ── (3) the recorded cgroup is absent, or present and empty ── */
    let cg
    try {
      cg = C.parseControlGroupResult(readControlGroup(rec.observedControlGroup))
    } catch (e) {
      return unknown(`refuse: the control group could not be read (${(e && e.message) || e})`, evidence)
    }
    if (cg === null) return unknown('refuse: the control group result does not satisfy its contract', evidence)
    if (cg.kind === 'unreadable') return unknown('refuse: the control group is unreadable', evidence)
    evidence.cgroupExists = cg.exists
    if (cg.exists === true) {
      evidence.cgroupMembers = cg.procs
      if (cg.procs.length > 0) {
        return live(`refuse: control group '${rec.observedControlGroup}' still has ${cg.procs.length} member(s)`, evidence)
      }
    }

    /* ── the process scan, facet by facet, in the required order ── */
    let listed
    try {
      listed = C.parsePidListResult(listPids())
    } catch (e) {
      return unknown(`refuse: the process list could not be read (${(e && e.message) || e})`, evidence)
    }
    if (listed === null) return unknown('refuse: the process list does not satisfy its contract', evidence)
    if (listed.kind === 'unreadable') return unknown('refuse: the process list is unreadable', evidence)
    evidence.pidCount = listed.pids.length

    const livePids = new Set()
    const relevant = []
    for (const pid of listed.pids) {
      // (2) status FIRST — the uid decides whether anything else is our business at all
      let st
      try {
        st = C.parseStatusResult(readStatus(pid))
      } catch (e) {
        return unknown(`refuse: status for pid ${pid} could not be read (${(e && e.message) || e})`, evidence)
      }
      if (st === null) {
        return unknown(
          `refuse: the status of pid ${pid} does not satisfy its contract`,
          Object.assign(evidence, { uninspectablePid: pid, facet: 'status' })
        )
      }
      // (7) an explicit `gone` means the PID vanished between listing and reading. A process
      // that no longer exists holds nothing and carries nothing, so it is safely skipped.
      if (st.kind === 'gone') continue
      // (8) permission or error is NOT vanishing. We do not know whose process this is, so
      // we cannot even decide whether it is relevant — that is a hole, not a clean result.
      if (st.kind === 'unreadable') {
        return unknown(
          `refuse: status for pid ${pid} is unreadable, so its uid is unknown and it cannot be classified`,
          Object.assign(evidence, { uninspectablePid: pid, facet: 'status' })
        )
      }
      livePids.add(pid)
      // (4) an unrelated uid needs no further inspection at all — X2-B measured 26 of 34 /proc
      // entries unreadable, all root/system owned, and treating that as doubt would make every
      // verdict UNKNOWN forever.
      if (st.uid !== executorUid) continue
      relevant.push(pid)
    }
    evidence.relevantProcessCount = relevant.length

    /* ── (4) every PID observed while active is gone ── */
    const survivors = (rec.observedPids || []).filter((pid) => livePids.has(pid))
    if (survivors.length > 0) {
      return live(`refuse: observed pid(s) ${survivors.join(', ')} are still alive`, Object.assign(evidence, { survivors }))
    }

    /* ── (5)(6) for every executor-uid process, ALL THREE facets must be readable ── */
    const owned = [rec.stateRoot, rec.configPath, rec.envelopeRoot, rec.repoRoot]
    const within = (p) => typeof p === 'string' && owned.some((root) => p === root || p.startsWith(root + '/'))
    const marked = []
    const holders = []

    for (const pid of relevant) {
      // ⛔ SEQUENTIALLY, AND A `gone` STOPS THIS PID AT ONCE.
      // Reading all three first and then asking "did ANY say gone" let a later reader's vanish
      // erase evidence an earlier reader had already produced — a marker or a held path could
      // be discarded because the process happened to exit before the third read. Stopping at
      // the point of the vanish keeps the legitimate race (the process really did exit) while
      // never throwing away an answer we already had.
      let env, cwd, fds
      let vanished = false
      for (const [facet, read, parse] of [
        ['environ', readEnviron, C.parseEnvironResult],
        ['cwd', readCwd, C.parseCwdResult],
        ['fd', readFds, C.parseFdsResult]
      ]) {
        let r
        try {
          r = parse(read(pid))
        } catch (e) {
          return unknown(`refuse: the ${facet} of pid ${pid} could not be read (${(e && e.message) || e})`, evidence)
        }
        if (r === null) {
          return unknown(
            `refuse: the ${facet} of pid ${pid} does not satisfy its contract`,
            Object.assign(evidence, { uninspectablePid: pid, facet })
          )
        }
        if (r.kind === 'gone') { vanished = true; break }
        if (r.kind === 'unreadable') {
          return unknown(
            `refuse: the ${facet} of executor-uid pid ${pid} is unreadable; same-UID scan coverage is incomplete`,
            Object.assign(evidence, { uninspectablePid: pid, facet })
          )
        }
        if (facet === 'environ') env = r
        else if (facet === 'cwd') cwd = r
        else fds = r
      }
      if (vanished) continue
      // ⛔ the marker scan: what survives the measured cgroup-migration residual
      if (env.marker === rec.instanceMarker) marked.push(pid)
      // ⛔ the holder scan: a descendant that erased its marker is still sitting in our paths
      if (within(cwd.cwd) || fds.fds.some(within)) holders.push(pid)
    }

    if (marked.length > 0) {
      return live(
        `refuse: ${marked.length} process(es) still carry the instance marker '${rec.instanceMarker}'`,
        Object.assign(evidence, { markedPids: marked })
      )
    }
    if (holders.length > 0) {
      return live(
        `refuse: ${holders.length} process(es) still hold the instance's state, config, envelope or repo`,
        Object.assign(evidence, { holderPids: holders })
      )
    }

    /* ── (7)(8) the envelope and the repo still exist, as the SAME objects ── */
    // ⛔ OBJECT IDENTITY, NOT CONTENT.
    // OpenClaw legitimately bootstraps and mutates the envelope, so a recursive content hash
    // would reject a healthy run. Content integrity of the repo is owned by the existing
    // openClawWorker / openClawWslWorkspace verification and is deliberately not re-implemented
    // here. What this proves is narrower and is what retirement needs: the directories were not
    // destroyed, and were not swapped for different ones.
    for (const [label, path, expected] of [
      ['envelope', rec.envelopeRoot, rec.envelopeObject],
      ['repo', rec.repoRoot, rec.repoObject]
    ]) {
      let st
      try {
        st = C.parseStatResult(statPath(path))
      } catch (e) {
        return unknown(`refuse: the ${label} could not be stat'd (${(e && e.message) || e})`, evidence)
      }
      if (st === null) return unknown(`refuse: the ${label} stat result does not satisfy its contract`, evidence)
      if (st.kind === 'unreadable') return unknown(`refuse: the ${label} is unreadable`, evidence)
      if (st.exists !== true) {
        return live(`refuse: the ${label} no longer exists; retirement must never be proven by deletion`, evidence)
      }
      // ⛔ EXACT STRING IDENTITY, already validated as canonical by the contract. Numbers would
      // collapse 64-bit inodes above 2^53 onto one value, on the one check whose entire purpose
      // is exactness.
      if (st.dev !== expected.dev || st.ino !== expected.ino) {
        return live(
          `refuse: the ${label} is not the prepared object (${expected.dev}:${expected.ino} -> ${st.dev}:${st.ino})`,
          evidence
        )
      }
    }
    evidence.envelopePreserved = true
    evidence.repoPreserved = true

    /* ── (9) no restart policy, and no successor ── */
    if (rec.restartPolicy !== 'no') {
      return live(`refuse: the launch contract recorded restartPolicy '${rec.restartPolicy}'`, evidence)
    }
    let unit
    try {
      unit = C.parseUnitResult(readUnit(rec.unitName))
    } catch (e) {
      return unknown(`refuse: the unit could not be read (${(e && e.message) || e})`, evidence)
    }
    if (unit === null) return unknown('refuse: the unit result does not satisfy its contract', evidence)
    if (unit.kind === 'unreadable') return unknown('refuse: the unit state is unreadable', evidence)
    // ⛔ DIAGNOSTIC ONLY. X2-B retired cleanly with ActiveState=failed / Result=timeout,
    // because escalation to SIGKILL was required. These are recorded, never decisive — nothing
    // below compares against them.
    evidence.unitActiveState = unit.activeState
    evidence.unitSubState = unit.subState
    evidence.unitResult = unit.result

    // exists / successor / restart were validated by the contract; only their MEANING is
    // decided here.
    if (unit.successor === true) {
      return live(`refuse: a successor unit or process exists for '${rec.unitName}'`, evidence)
    }
    if (unit.exists === true && unit.restart !== 'no') {
      return live(`refuse: unit '${rec.unitName}' would restart (Restart=${unit.restart})`, evidence)
    }
    // ⛔ AND unit.exists === false PROVES NOTHING ON ITS OWN.
    // The unit being gone is not retirement; the required OS facts above already decided, and
    // this branch deliberately adds nothing.

    /* ── (10) the safety gate: nothing unrelated was harmed ── */
    let guard
    try {
      guard = C.parseProtectedResult(protectedInstancesOk())
    } catch (e) {
      return unknown(`refuse: the protected-instance gate could not be evaluated (${(e && e.message) || e})`, evidence)
    }
    if (guard === null) {
      return unknown('refuse: the protected-instance gate did not answer with a literal boolean', evidence)
    }
    if (guard.clean !== true) {
      return live('refuse: a protected or unrelated executor instance is not in its expected state', evidence)
    }

    /* ── corroboration only, and it can never create a verdict on its own ── */
    if (listListeners) {
      try {
        const listeners = listListeners(rec.gatewayPort) || []
        // A listener owned by an unrelated later tenant is not our process — that is why the
        // port is corroborating. If it were ours, the checks above have already caught it.
        evidence.portListeners = listeners.length
      } catch (e) {
        evidence.portListeners = null
      }
    }

    return { ok: true, verdict: VERDICT.RETIRED, reason: 'every required OS fact is clean and the workspace survives', evidence }
  }

  /**
   * ⛔ THE BOOLEAN SEAM, AND WHY IT IS A SEPARATE FUNCTION.
   *
   * openClawQuarantine.retire() does `if (!verifyRetirementProof(proof, {approvalId}))`. In
   * JavaScript `{ ok: false }` is TRUTHY. Handing evaluate() to that seam directly would turn
   * every refusal — LIVE, UNKNOWN, a store failure — into authority to release the global
   * lock. That is not hypothetical: it is the single most dangerous line this design could
   * contain.
   *
   * So the seam returns a LITERAL boolean, true only when an independently obtained evaluation
   * is exactly ok===true AND verdict==='RETIRED'. Any throw is false. Anything unexpected is
   * false.
   */
  function verifyForQuarantine (proof, expect = {}) {
    try {
      // Identity may come from the proof, but ONLY identity, and the approvalId the ledger
      // itself supplies takes precedence over anything the proof claims.
      const approvalId = (expect && expect.approvalId) || (proof && proof.approvalId)
      const instanceId = (proof && proof.instanceId) || approvalId
      return isRetirementAuthority(evaluate({ approvalId, instanceId }))
    } catch (e) {
      return false
    }
  }

  return { evaluate, verifyForQuarantine, VERDICT }
}

module.exports = {
  createOpenClawRetirementVerifier,
  isRetirementAuthority,
  // re-exported for callers that already import it from here; the implementation and every
  // input rule now live in openClawReaderContracts.js
  classifyFacet: C.classifyFacet,

  VERDICT,
  DEFAULT_EXECUTOR_UID
}
