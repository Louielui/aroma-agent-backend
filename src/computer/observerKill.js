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
/** The interpreter the fixed task launches. A different host is a different thing. */
const INTERPRETERS = Object.freeze(['powershell.exe', 'pwsh.exe'])
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
  NO_TARGET: 'no_target',
  AMBIGUOUS: 'target_ambiguous',
  TASK_STOP_FAILED: 'task_stop_failed',
  TERMINATE_FAILED: 'terminate_failed',
  STILL_ALIVE: 'still_alive'
})

/** Does this process record identify the Observer the fixed task launches? All three, or no. */
function identifies (p) {
  if (!p || typeof p.commandLine !== 'string' || !Number.isInteger(p.pid)) return false
  const name = String(p.name || '').toLowerCase()
  const cmd = p.commandLine.toLowerCase()
  if (!INTERPRETERS.includes(name)) return false
  if (!cmd.includes(STAGED_SCRIPT)) return false
  return COMMAND_SHAPE.test(cmd)
}

/**
 * Stop the Observer, and prove it stopped.
 *
 * @param {{ os?: object }} deps — `os` is the INJECTED adapter:
 *   listProcesses() -> [{ pid, name, commandLine }]
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
  if (!os || typeof os.listProcesses !== 'function' || typeof os.stopTask !== 'function' || typeof os.terminate !== 'function') {
    return Object.assign({}, base, { outcome: OUTCOME.NO_OS_ADAPTER })
  }

  const alive = () => {
    const list = os.listProcesses()
    return (Array.isArray(list) ? list : []).filter(identifies)
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

  // 1. the task first: stopping the launcher is what prevents an immediate relaunch.
  const stopped = os.stopTask(TASK_NAME)
  if (!stopped || stopped.ok !== true) {
    return Object.assign(out, {
      outcome: OUTCOME.TASK_STOP_FAILED,
      aliveAfter: alive().length > 0,
      errors: [String((stopped && stopped.error) || 'stopTask failed')]
    })
  }

  // 2. the process, only if it is still there. Escalating unconditionally would make a control
  //    that never checked indistinguishable from one that did.
  let still = alive()
  if (still.length > 0) {
    out.escalated = true
    const killed = os.terminate(target.pid)
    if (!killed || killed.ok !== true) {
      return Object.assign(out, {
        outcome: OUTCOME.TERMINATE_FAILED,
        aliveAfter: alive().length > 0,
        errors: [String((killed && killed.error) || 'terminate failed')]
      })
    }
    still = alive()
  }

  /**
   * ⛔ BOTH HALVES, OR IT IS NOT A KILL. `aliveBefore` proves there was something to stop;
   * `aliveAfter === false` proves it is gone. Either alone is a story rather than a result —
   * and every underlying call reporting `ok` while the process survives is exactly the shape
   * a kill control exists to refuse.
   */
  const aliveAfter = still.length > 0
  if (aliveAfter) return Object.assign(out, { outcome: OUTCOME.STILL_ALIVE, aliveAfter: true })
  return Object.assign(out, { ok: true, outcome: OUTCOME.KILLED, aliveAfter: false })
}

module.exports = {
  killObserver,
  identifies,
  TASK_NAME,
  STAGED_SCRIPT,
  INTERPRETERS,
  COMMAND_SHAPE,
  OUTCOME
}
