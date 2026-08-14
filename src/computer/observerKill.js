'use strict'

/**
 * observerKill.js — Computer Operator, Phase 3b. THE STOP CONTROL THE OTHER THREE MISS.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY THIS EXISTS, IN THE WORDS THE 3b BRANCH ALREADY USED.
 *
 * The Observer is NOT the Companion. It is a separate process started by a fixed scheduled
 * task, so the Companion can neither start it nor stop it. Asked plainly — does killing A
 * stop B — the answer is no, and all three bindings demonstrated on 2026-07-28 miss it:
 *
 *   serviceGate     stops the NEXT step being dispatched. An observation already running in
 *                   another process is not dispatched through the gate and continues.
 *   companionAbort  stops the Companion. The Observer has no parent-child relationship with
 *                   it and keeps running to completion.
 *   osBackstop      destroys the IPC channel. The Observer does not use that channel to do
 *                   its work; it writes to the evidence store and exits.
 *
 * The Observer is bounded only by its own single-shot design and hard timeout — and a bound
 * is not a control. **「It will stop by itself shortly」 is not a kill switch.**
 *
 * ── WHAT THIS MODULE IS NOT ───────────────────────────────────────────────────
 * ⛔ IT IS NOT A DEMONSTRATION. `observerKillDemonstrated` stays false. Code existing is not
 * evidence that a real process died, and no test may flip that bit — the whole failure mode
 * this project keeps finding is a record that reports a state it never measured.
 *
 * ⛔ AND IT IS DORMANT. Nothing in `src/` calls it, it builds no OS adapter of its own, and
 * it cannot spawn anything: the adapter is INJECTED, so requiring this file does nothing at
 * all. Wiring it to a caller is a separate, later decision.
 * ══════════════════════════════════════════════════════════════════════════════
 */

/**
 * ⛔ IDENTITY IS FIXED HERE AND NOWHERE ELSE.
 *
 * A stop that matched on process NAME would kill the Owner's own shell, a backup job, or the
 * test run that called it. Three independent things must agree before anything is touched,
 * and none of them can be supplied by a caller — see `killObserver` on why the options bag
 * deliberately ignores `pid`, `scriptPath` and `taskName`.
 */
const TASK_NAME = 'AromaComputerOperator-Observer'
const STAGED_SCRIPT = 'c:\\aromaoperator-probe\\observer.ps1'
/**
 * ⛔ THE ABSOLUTE PATH THE FIXED TASK LAUNCHES, AND ONLY THAT.
 *
 * This was `[powershell.exe, pwsh.exe]` — a list of NAMES, matched against a name the
 * process reports. Two things were wrong with it. A name is not a binary: anything can be
 * called powershell.exe. And `pwsh.exe` was on the list although the fixed task specifies
 * the absolute Windows PowerShell path and can never start it — accepting it widened the
 * target set for no reason at all.
 */
const TASK_EXECUTABLE = 'c:\\windows\\system32\\windowspowershell\\v1.0\\powershell.exe'
/** The fixed account the task runs as. Not a caller's to choose. */
const TASK_ACCOUNT = 'aromaoperator'

/**
 * ⛔ THE FINAL SEGMENT OF A WINDOWS PRINCIPAL, WHICH IS THE ACCOUNT ITSELF.
 *
 * This existed as `account.endsWith('aromaoperator')`, and a suffix is not a name:
 * `AROMABRAIN\NotAromaOperator` satisfied it, as would any account anyone can create whose
 * name happens to end in those fourteen characters. That is the same error as matching a
 * process by what its command line looks like — similarity of text standing in for identity.
 */
function accountName (principal) {
  const raw = String(principal || '').trim().toLowerCase()
  if (!raw) return ''
  const cut = Math.max(raw.lastIndexOf('\\'), raw.lastIndexOf('/'))
  return cut >= 0 ? raw.slice(cut + 1) : raw
}
/**
 * The shape the task's own action line carries. `observer.ps1` takes a mandatory `-Action`
 * from a ValidateSet, so a command line without one is not the observer being run by the task
 * — it is something else holding the same file open.
 */
const COMMAND_SHAPE = /-action\s+(list_windows|read_uia_tree|capture_screen)\b/

/** Outcomes. Closed, and every one of them says what happened rather than whether we are happy. */
const OUTCOME = Object.freeze({
  KILLED: 'killed',
  NO_OS_ADAPTER: 'no_os_adapter',
  /** The adapter cannot say which PIDs the fixed task started. Missing evidence, not a fall-back. */
  NO_TASK_EVIDENCE: 'no_task_ownership_evidence',
  NO_TARGET: 'no_target',
  /** The PID is alive but is no longer the process we proved. Nothing may be terminated. */
  IDENTITY_CHANGED: 'identity_changed',
  AMBIGUOUS: 'target_ambiguous',
  TASK_STOP_FAILED: 'task_stop_failed',
  TERMINATE_FAILED: 'terminate_failed',
  STILL_ALIVE: 'still_alive'
})

/**
 * ⛔ OWNERSHIP FIRST. RESEMBLANCE IS NOT IDENTITY.
 *
 * The first cut asked three questions — is it a PowerShell, does the command line contain
 * the fixed script, does it carry a valid `-Action` — and treated a yes as 「this is the
 * controlled Observer」. Every one of those is something a process can WRITE about itself.
 * A byte-identical command line started by anything else was a kill target, and `TASK_NAME`
 * took no part in deciding: it was used afterwards, only to stop the task.
 *
 * So the first question is now the one that cannot be forged from inside the process: DID
 * THE FIXED TASK START THIS PID. The adapter answers it; the rest are corroboration, and
 * they stay because a disagreement between them and the task association is itself a finding.
 *
 * ⛔ COMMIT F — AND OWNERSHIP IS OF A PROCESS, NOT OF A NUMBER.
 *
 * `instance.pids.includes(p.pid)` asked whether the task had ever started something with
 * that PID. A PID is a slot the OS refills; the process that occupies it now may be a
 * complete stranger. So the pair is carried and compared: the PID says WHERE to look, the
 * incarnation says WHETHER it is still the same thing.
 *
 * @param {object} p        a process record from the adapter
 * @param {object} instance the fixed task instance: { processes, account, sessionId }
 */
function identifies (p, instance) {
  if (!p || typeof p.commandLine !== 'string' || !Number.isInteger(p.pid)) return false
  if (!instance || !Array.isArray(instance.processes)) return false

  // 1. TASK OWNERSHIP of THIS process — the two attributes here the process cannot write
  //    about itself. Both sides must name the incarnation; an unnamed one is not a match,
  //    because 「probably the same process」 is exactly what this path may not act on.
  const owned = instance.processes.find((o) => o && o.pid === p.pid)
  if (!owned) return false
  if (typeof p.incarnation !== 'string' || !p.incarnation) return false
  if (p.incarnation !== owned.incarnation) return false

  // 2. the fixed account and session the task runs in. If these ever disagree with the task
  //    association, refuse: a disagreement is the finding, not something to resolve in favour
  //    of the more convenient half.
  const account = String(p.account || '').toLowerCase()
  const want = String(instance.account || '').toLowerCase()
  if (!account || !want || account !== want) return false
  if (accountName(account) !== TASK_ACCOUNT) return false
  if (typeof instance.sessionId === 'number' && p.sessionId !== instance.sessionId) return false

  // 3. the exact executable the task specifies — a path, not a reported name.
  if (String(p.executablePath || '').toLowerCase() !== TASK_EXECUTABLE) return false

  // 4. and the work it was started to do.
  const cmd = p.commandLine.toLowerCase()
  if (!cmd.includes(STAGED_SCRIPT)) return false
  return COMMAND_SHAPE.test(cmd)
}

/**
 * Stop the Observer, and prove it stopped.
 *
 * @param {{ os?: object }} deps — `os` is the INJECTED adapter:
 *   taskInstance(taskName) -> { ok, processes: [{ pid, incarnation }], account, sessionId? }
 *     ⛔ THE EVIDENCE COMMIT E ADDED, WITH THE IDENTITY COMMIT F ADDED. It must answer
 *     「which PROCESSES did the FIXED TASK start」 — and `incarnation` is what makes that a
 *     process rather than a number: a token the OS can distinguish one occupant of a PID
 *     from the next by (creation time, a stable handle identity), never anything the
 *     process reports about itself. An adapter that can only answer with PIDs is refused.
 *   listProcesses() -> [{ pid, incarnation, executablePath, account, sessionId, commandLine }]
 *   stopTask(taskName) -> { ok, error? }
 *   terminate(pid)     -> { ok, error? }
 *
 * ⛔ EVERY OTHER KEY ON `deps` IS IGNORED ON PURPOSE. A caller — and therefore a model, or a
 * user's free text reaching one — must not be able to name a pid, a path or a task. The
 * identity above is the only one this control will ever act on.
 *
 * @returns {{ok, outcome, aliveBefore, aliveAfter, pid, matched, escalated, errors}}
 */
function killObserver (deps = {}) {
  const os = deps.os
  const base = { ok: false, outcome: null, aliveBefore: false, aliveAfter: false, pid: null, matched: 0, escalated: false, errors: [] }
  if (!os || typeof os.listProcesses !== 'function' || typeof os.stopTask !== 'function' ||
      typeof os.terminate !== 'function' || typeof os.taskInstance !== 'function') {
    return Object.assign({}, base, { outcome: OUTCOME.NO_OS_ADAPTER })
  }

  /**
   * ⛔ ASKED BY THE FIXED NAME, NEVER A CALLER'S. `deps.taskName` is ignored here exactly as
   * `deps.pid` and `deps.scriptPath` are — the identity of what may be stopped is a property
   * of this module, not of whoever called it.
   */
  const instance = os.taskInstance(TASK_NAME)
  /**
   * ⛔ NO EVIDENCE IS A REFUSAL, NOT A FALL-BACK TO MATCHING BY APPEARANCE. An adapter that
   * cannot say what the task started leaves this control with nothing to be sure about, and
   * 「be less sure and proceed」 is the whole failure mode. Same rule as the session proof in
   * Commit D: not proven is refused.
   */
  const owned = instance && instance.ok === true && Array.isArray(instance.processes) ? instance.processes : null
  /**
   * ⛔ AND PID-ONLY EVIDENCE IS MISSING EVIDENCE, NOT PARTIAL EVIDENCE. An adapter that
   * answers in the pre-Commit-F shape cannot distinguish one occupant of a PID from the
   * next, so it cannot establish the identity this path acts on. 「Less certain, proceed」
   * is the failure mode itself.
   */
  const wellFormed = owned && owned.every((o) => o && Number.isInteger(o.pid) && typeof o.incarnation === 'string' && o.incarnation)
  if (!wellFormed) {
    return Object.assign({}, base, { outcome: OUTCOME.NO_TASK_EVIDENCE })
  }

  const alive = () => {
    const list = os.listProcesses()
    return (Array.isArray(list) ? list : []).filter((proc) => identifies(proc, instance))
  }

  const before = alive()

  /**
   * ⛔ A ZERO RESULT IS NOT A KILL. 「I looked, found nothing, therefore it is stopped」 is the
   * vacuous pass in its purest form — the same shape as an assertion that cannot fail. If the
   * Observer was not running, nothing was killed, and that is what is reported.
   */
  if (before.length === 0) return Object.assign({}, base, { outcome: OUTCOME.NO_TARGET })

  /**
   * ⛔ AMBIGUITY ACTS ON NOTHING. Two processes carrying the same identity means the identity
   * stopped identifying. Picking one would be a guess with a fatal blast radius, and picking
   * both would widen the control past what was authorised.
   */
  if (before.length > 1) return Object.assign({}, base, { outcome: OUTCOME.AMBIGUOUS, matched: before.length, aliveBefore: true })

  const target = before[0]
  const out = Object.assign({}, base, { aliveBefore: true, pid: target.pid, matched: 1 })

  /**
   * ⛔ TIME OF CHECK IS NOT TIME OF USE. Everything above proved a fact about a process that
   * existed a moment ago; stopping the task is precisely what ends it and frees its PID for
   * immediate reuse. So the state after the stop is read from the SLOT — who holds this PID
   * NOW — rather than re-filtering against the list we captured before.
   *
   * gone    — the identity we proved is not there. Nothing further to do.
   * same    — still the process we proved, so terminate may act on it.
   * changed — the PID is alive but is someone else. Terminating it would kill a stranger.
   */
  const slot = () => {
    const list = os.listProcesses()
    const holder = (Array.isArray(list) ? list : []).find((q) => q && q.pid === target.pid)
    if (!holder) return 'gone'
    if (typeof holder.incarnation !== 'string' || holder.incarnation !== target.incarnation) return 'changed'
    return 'same'
  }

  // 1. the task first: stopping the launcher is what prevents an immediate relaunch.
  const stopped = os.stopTask(TASK_NAME)
  if (!stopped || stopped.ok !== true) {
    return Object.assign(out, {
      outcome: OUTCOME.TASK_STOP_FAILED,
      aliveAfter: slot() === 'same',
      errors: [String((stopped && stopped.error) || 'stopTask failed')]
    })
  }

  // 2. the process, only if it is still there. Escalating unconditionally would make a control
  //    that never checked indistinguishable from one that did.
  let state = slot()

  /**
   * ⛔ A REUSED PID IS NOT A KILL TARGET, AND NOT A KILL EITHER.
   *
   * The proven process is no longer in this slot, so terminate is forbidden — that is the
   * whole point. But it is also not reported as success: the original very likely stopped,
   * 「very likely」 is not the standard here, and it cannot be shown THROUGH a slot that now
   * holds a stranger. Named, so the collision is visible instead of smoothed away.
   */
  if (state === 'changed') {
    return Object.assign(out, {
      outcome: OUTCOME.IDENTITY_CHANGED,
      aliveAfter: null,
      errors: ['pid ' + target.pid + ' is alive but is no longer the incarnation this run proved; terminate refused']
    })
  }

  if (state === 'same') {
    out.escalated = true
    const killed = os.terminate(target.pid)
    if (!killed || killed.ok !== true) {
      return Object.assign(out, {
        outcome: OUTCOME.TERMINATE_FAILED,
        aliveAfter: slot() === 'same',
        errors: [String((killed && killed.error) || 'terminate failed')]
      })
    }
    /**
     * ⛔ AFTER a terminate that acted on the proven identity, a changed slot IS gone: we
     * ended that process and the OS refilled the number. The asymmetry with the branch
     * above is deliberate — there we had not acted, and claiming the outcome of something
     * we did not do is exactly the kind of credit this module refuses to take.
     */
    state = slot()
  }

  /**
   * ⛔ BOTH HALVES, OR IT IS NOT A KILL. `aliveBefore` proves there was something to stop;
   * `aliveAfter === false` proves it is gone. Either alone is a story rather than a result —
   * and every underlying call reporting `ok` while the process survives is exactly the shape
   * a kill control exists to refuse.
   */
  const aliveAfter = state === 'same'
  if (aliveAfter) return Object.assign(out, { outcome: OUTCOME.STILL_ALIVE, aliveAfter: true })
  return Object.assign(out, { ok: true, outcome: OUTCOME.KILLED, aliveAfter: false })
}

module.exports = {
  killObserver,
  identifies,
  TASK_NAME,
  STAGED_SCRIPT,
  TASK_EXECUTABLE,
  TASK_ACCOUNT,
  COMMAND_SHAPE,
  OUTCOME
}
