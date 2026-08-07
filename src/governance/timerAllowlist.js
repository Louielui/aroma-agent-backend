'use strict'

/**
 * timerAllowlist.js — which errand kinds a TIMER may run. GOVERNANCE.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ EXTRACTED FROM `home/errandKinds.js` ON 2026-08-07.
 *
 * That file is 219 lines and is mostly DISPLAY — cadence labels, 「3 日之前查過」, the four
 * freshness sentences. One field in it was a fence: `readOnly: true`, which decides what an
 * unattended timer is allowed to invoke.
 *
 * Moving the whole file would have made every Cantonese sentence in it un-editable, which is a
 * real cost paid for nothing. **The fence moved; the sentences stayed.**
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * > **Owner's standing ruling: on a timer, READS ONLY. No writes, no dispatch, no paid model
 * > calls, nothing acting as him.** A schedule is by definition his absence, and approval
 * > requires him present.
 *
 * ⛔ THIS IS THE ALLOWLIST ITSELF, NOT A RULE BESIDE ONE. `scheduledRun` can only invoke a kind
 * named here, and it accepts no other way to name an action — so 「it cannot write」 is a
 * property of what it is able to reach. 「唔可能」，唔係「唔准」.
 *
 * Adding an id here adds it to the timer. That needs its own Owner GO, and now it also needs a
 * change to a file inside the protected path — which is the whole reason this file exists.
 */

/** Errand kind ids an unattended run may invoke. Nothing else is reachable from a timer. */
const TIMER_READ_ONLY_KINDS = Object.freeze([
  // The recall check: public register, no login, no writes, no dispatch, no paid calls, $0.00.
  'recall'
])

/** @param {string} kindId @returns {boolean} */
function isTimerRunnable (kindId) {
  return typeof kindId === 'string' && TIMER_READ_ONLY_KINDS.includes(kindId)
}

module.exports = { TIMER_READ_ONLY_KINDS, isTimerRunnable }
