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
  // Phase 3a: it now stops a real process over a real pipe. What it has NOT been shown
  // against is a Companion deployed under the AromaOperator account, because creating
  // that account is the Owner's step. Stated as data so the claim cannot outrun the
  // evidence.
  stopsAnythingRunningToday: true,
  demonstratedUnderCompanionAccount: false
})

module.exports = { createKillSwitch, KILL_SWITCH_BINDINGS, STOP_CONDITIONS }
