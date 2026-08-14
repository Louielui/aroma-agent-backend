'use strict'

/**
 * killSwitch.js — Computer Operator v0, Phase 2. The stop mechanism.
 *
 * ── THERE IS NOTHING LIVE TO KILL ─────────────────────────────────────────────
 * Said plainly, because a "kill switch" that sounds like a working control and is not
 * one is worse than none. Today this object flips a boolean and refuses subsequent
 * requests. It does not stop a process, close a window, or interrupt anything, because
 * no Companion exists and nothing is running. It is the LATCH that a real stop will be
 * built on, tested now so the semantics are settled before there is anything at stake.
 *
 * ── WHAT IT WILL BIND TO WHEN THE HALVES EXIST ────────────────────────────────
 * The latch lives in the SERVICE, which is also where the sealed order and the audit
 * live. When the Companion exists, three bindings attach to this same latch, so there is
 * one place that says "stopped" rather than three that can disagree:
 *
 *   1. SERVICE-SIDE GATE (this object). Every step dispatch checks `isStopped()` first,
 *      so a stop takes effect at the next step boundary with no cooperation needed from
 *      anything else.
 *   2. COMPANION SIGNAL. The Service sends `abort` (a message type already in the IPC
 *      vocabulary) and stops sending `execute_step`. Since only ONE step is ever in
 *      flight and the Companion holds no plan, the worst case is that one already-sent
 *      step completes — bounded by construction, not by promptness.
 *   3. OS BACKSTOP. Stopping the Windows service, or logging the Companion account out,
 *      ends capability outright. This is the one that does not depend on our code being
 *      correct, and is therefore the real guarantee.
 *
 * ── A STOP IS FINAL, NOT A PAUSE ──────────────────────────────────────────────
 * There is no resume. Restarting means a new order and a new Owner approval — a stopped
 * run cannot be talked back into life by the thing that was stopped.
 *
 * Pure: no I/O, no timers, no process.
 */

const { STOP_CONDITIONS } = require('./sessionBoundary')

const STOP_SET = new Set(STOP_CONDITIONS)

function createKillSwitch (options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  let stopped = null // null while running; a frozen record once stopped

  return {
    /** True once stopped. Checked before every step dispatch. */
    isStopped () { return stopped !== null },

    /** The stop record, or null. Frozen so nothing can rewrite why it stopped. */
    reason () { return stopped },

    /**
     * Stop. Idempotent and FIRST-WINS: a second call never overwrites the first reason,
     * so the record always says what actually stopped the run rather than what stopped
     * it last. An unknown reason is refused — the vocabulary is closed like every other
     * enum here, so no free text can become a stop reason.
     */
    stop (reason, detail = null) {
      if (!STOP_SET.has(reason)) return { ok: false, error: 'unknown_stop_condition' }
      if (stopped) return { ok: true, alreadyStopped: true, record: stopped }
      stopped = Object.freeze({
        reason,
        detail: typeof detail === 'string' && detail.length <= 120 ? detail : null,
        stoppedAt: now()
      })
      return { ok: true, alreadyStopped: false, record: stopped }
    },

    /**
     * The gate every dispatch must pass. Returns a refusal instead of throwing, so a
     * caller cannot proceed by catching.
     */
    guard () {
      return stopped ? { ok: false, refusal: 'stopped', reason: stopped.reason } : { ok: true }
    }
  }
}

/**
 * What is NOT yet true, kept as data so the report and the tests cannot drift from each
 * other and so nobody can mistake this for a live control.
 */
const KILL_SWITCH_BINDINGS = Object.freeze({
  serviceGate: Object.freeze({ implemented: true, note: 'this latch; checked before each step dispatch' }),
  companionAbortSignal: Object.freeze({ implemented: true, note: 'Phase 3a: abort over the IPC channel, demonstrated against a live Companion' }),
  osBackstop: Object.freeze({ implemented: true, note: 'Phase 3a: closing the channel destroys every connection; no reconnect path exists' }),
  stopsAnythingRunningToday: true,

  // FLIPPED 2026-07-28 ON EVIDENCE, not on completion of the code. All three bindings were
  // demonstrated under the AromaOperator account, each against a SEPARATE Companion that
  // was proven alive by a ping/pong round-trip first.
  //
  // It took three attempts to earn this, and the failures are worth remembering:
  //   1. the harness looked for its modules in the wrong folder, so nothing ever connected;
  //   2. the containment probe was written to a path that account cannot read, so the one
  //      result that had to be False was never measured at all;
  //   3. all three bindings ran against ONE Companion — KILL 2 killed it, so KILL 3 passed
  //      with nothing left to kill.
  // Every one of those was GREEN while proving nothing. That is why this field exists
  // separately from stopsAnythingRunningToday, and why the harness now refuses to report a
  // demonstration against a target it did not first prove alive.
  demonstratedUnderCompanionAccount: true,
  demonstratedOn: '2026-07-28',
  demonstratedBindings: Object.freeze(['serviceGate', 'companionAbort', 'osFallback']),

  // ── PHASE 3b: A SECOND ENTRY POINT EXISTS, AND THOSE THREE DO NOT COVER IT ──────
  //
  // The Observer is NOT the Companion. It is a separate process started by a fixed scheduled
  // task — the Companion cannot start it and, by the same token, cannot stop it. Asked plainly,
  // 「does killing A stop B」, the answer is no, and leaving that blank would be the more
  // comfortable and less honest option:
  //
  //   serviceGate    stops the NEXT step being dispatched. An observation already running in
  //                  another process is not dispatched through the gate and continues.
  //   companionAbort stops the Companion. The Observer has no parent-child relationship with
  //                  it and keeps running to completion.
  //   osBackstop     destroys the IPC channel. The Observer does not use that channel to do
  //                  its work; it writes to the evidence store and exits.
  //
  // So an observation IN FLIGHT survives all three bindings demonstrated in 3a. It is bounded
  // only by the Observer's own single-shot design and hard timeout — and a bound is not a
  // control. 「It will stop by itself shortly」 is not a kill switch.
  //
  // ⛔ BUILDING THE CONTROL DOES NOT CHANGE THIS VALUE. Killing the Companion still does not
  // kill the Observer; that is why observerKill.js had to exist at all.
  killingCompanionStopsObserver: false,

  // The fourth binding. `implemented` became true when src/computer/observerKill.js was
  // written; `observerKillDemonstrated` is a SEPARATE claim — about a real process dying —
  // and no amount of code can earn it. Every test of that module runs against a fake OS
  // adapter, so nothing in the suite has ever stopped a task or terminated a process.
  observerKill: Object.freeze({
    implemented: true,
    module: 'src/computer/observerKill.js',
    note: 'Stop the Observer itself mid-observation: stop the fixed task, then terminate the exact identified process, then prove it is gone. Built and unit-tested against a fake OS; NOT demonstrated against a live Observer.'
  }),
  observerKillDemonstrated: false
})

module.exports = { createKillSwitch, KILL_SWITCH_BINDINGS, STOP_CONDITIONS }
