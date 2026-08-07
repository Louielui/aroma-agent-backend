'use strict'

/**
 * errandRunner.js — runs an errand and RECORDS it. The thing that makes 首頁 a briefing.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * Until this existed, the waiting section could only ever be empty and the errand list said
 * 「每單都係手動跑,冇記低」 — which was true, and is the sentence this file removes.
 *
 * ⛔ ITS JOB IS TO RECORD, ESPECIALLY WHEN THE ERRAND FAILS.
 *
 * An errand that throws and leaves no trace is indistinguishable from one that never ran, and
 * 首頁 would show 「未有差事紀錄」 — a lie with a reason attached. So every path through this
 * function writes a row, including the paths where the errand misbehaved.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────
 * It is not a scheduler. Nothing here decides WHEN an errand runs — she still has no
 * scheduler, and pretending otherwise by adding a timer would be a third execution mode
 * arriving without a decision. This runs an errand it is handed, once.
 */

const { OUTCOME } = require('./errandStore')

/**
 * @param {{store, id, title, run, now?}} args `run` resolves to
 *   `{outcome, answer?, stop?, detail?}` — outcome being one of OUTCOME's values.
 * @returns {Promise<{outcome, recorded, recordError?, detail?}>}
 */
async function runErrand ({ store, id, title, run, now }) {
  const clock = typeof now === 'function' ? now : Date.now
  let row

  try {
    const r = await run()
    const outcome = r && r.outcome

    if (outcome === OUTCOME.ANSWERED) {
      row = { id, title, outcome, at: clock(), answer: r.answer, detail: r.detail || '' }
    } else if (outcome === OUTCOME.BLOCKED_BY_SITE) {
      row = { id, title, outcome, at: clock(), detail: r.detail || '' }
    } else if (outcome === OUTCOME.STOPPED_FOR_YOU) {
      row = { id, title, outcome, at: clock(), stop: r.stop }
    } else {
      // ⛔ An outcome nobody named is a DEFECT IN THE ERRAND, and it is recorded as one
      // rather than coerced into a state that reads as normal operation.
      row = {
        id,
        title,
        outcome: OUTCOME.BLOCKED_BY_SITE,
        at: clock(),
        detail: '呢單差事返咗一個冇人定義過嘅結果:' + JSON.stringify(outcome) + '。當佢冇完成。'
      }
    }
  } catch (e) {
    row = {
      id,
      title,
      outcome: OUTCOME.BLOCKED_BY_SITE,
      at: clock(),
      detail: '中途爆咗:' + String(e && e.message).split('\n')[0].slice(0, 120)
    }
  }

  // The store REFUSES a malformed stop (no report, or a typed value). That refusal must not
  // delete the run: an errand that happened and was rejected by the record is still an errand
  // that happened, and 「未有差事紀錄」 would be false.
  try {
    store.record(row)
    return { outcome: row.outcome, recorded: true, detail: row.detail }
  } catch (e) {
    const why = String(e && e.message).split('\n')[0].slice(0, 120)
    const fallback = {
      id,
      title,
      outcome: OUTCOME.BLOCKED_BY_SITE,
      at: clock(),
      detail: '個結果寫唔入紀錄(' + why + ')。差事本身跑過。'
    }
    try {
      store.record(fallback)
      return { outcome: OUTCOME.BLOCKED_BY_SITE, recorded: true, detail: fallback.detail }
    } catch (e2) {
      // The store itself is unwritable. Say so; do not pretend the run did not happen.
      return {
        outcome: row.outcome,
        recorded: false,
        recordError: String(e2 && e2.message).split('\n')[0].slice(0, 120),
        detail: row.detail
      }
    }
  }
}

module.exports = { runErrand }
