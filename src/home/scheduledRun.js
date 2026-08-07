'use strict'

/**
 * scheduledRun.js — what a TIMER is allowed to make her do.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「Scheduled tasks read only. No writes, no dispatch, no paid calls, no acting as
 * > me. The recall check qualifies; nothing else gets added to the timer without a separate GO.」**
 *
 * DESIGN-SCHEDULED-SURFACE §4 named the reason: **a schedule is by definition his absence**, and
 * approval requires him present. So the timer gets the narrowest capability in the system.
 *
 * ⛔ THE GATE IS MADE OF ABSENCE. 「唔可能」,唔係「唔准」.
 *
 * There is **no parameter naming what to run** — not in this function, not in the route, not in
 * the PowerShell that knocks. A caller cannot ask for a write path, because there is no field in
 * which to ask. What runs is the intersection of three independent facts:
 *
 *     declared in the registry  ∧  readOnly === true  ∧  a runner wired at the composition root
 *
 * Any one of them missing and the kind is REFUSED and reported. A rule saying 「do not write」
 * could be argued with by anything that got past the token; this cannot, because the argument
 * has nowhere to arrive.
 *
 * ── AND FAILURE IS LOUD ─────────────────────────────────────────────────────
 * `ok:false` becomes a non-2xx, which becomes a non-zero exit, which becomes a failure Windows
 * records — **witness #1**. A scheduled run that quietly reports success while doing nothing is
 * the exact silence the two-witness design exists to break.
 */

const { KINDS } = require('./errandKinds')
const { runErrand } = require('./errandRunner')

/**
 * @param {{store, runners, kinds?, now?}} args
 *   `runners` maps kind id → `async () => [{suffix, title, result}]`, wired at the composition
 *   root. `result` is the `{outcome, answer|detail|stop}` shape `runErrand` records.
 * @returns {Promise<{ok, ran, recorded, refused, nextRunAt, rows}>}
 */
async function runScheduledErrands ({ store, runners, kinds, now }) {
  const clock = typeof now === 'function' ? now : Date.now
  const t = clock()
  const registry = kinds || KINDS
  const wired = Object.keys(runners || {})

  // ⛔ THE THREE-WAY INTERSECTION, COMPUTED BEFORE ANYTHING RUNS.
  const allowed = registry.filter((k) => k.readOnly === true && typeof (runners || {})[k.id] === 'function')
  const refused = wired.filter((id) => !allowed.some((k) => k.id === id))

  const rows = []
  let recorded = true
  let ran = 0
  let answered = 0
  let nextRunAt = null

  for (const kind of allowed) {
    // Stored on the row so a later cadence change cannot retroactively rewrite whether past
    // runs were on time (DESIGN-SCHEDULED-SURFACE §2). Witness #2 measures the gap against it.
    const next = t + kind.everyMs
    nextRunAt = nextRunAt === null ? next : Math.min(nextRunAt, next)

    let items
    try {
      items = await runners[kind.id]()
    } catch (e) {
      // The runner itself fell over before producing any errand. That is still one recorded
      // event — a schedule that fails silently is indistinguishable from one with nothing to say.
      items = [{ suffix: 'run', title: kind.title, result: { outcome: 'BLOCKED_BY_SITE', detail: '排程行嗰陣爆咗:' + String(e && e.message).split('\n')[0].slice(0, 120) } }]
    }

    for (const it of (items || [])) {
      ran++
      const r = await runErrand({
        store,
        id: kind.prefix + it.suffix + '-' + new Date(t).toISOString().slice(0, 10),
        title: it.title || kind.title,
        now: () => t,
        /**
         * ⛔ `via`, NOT `trigger`. THE FIELD IS NAMED FOR THE DOOR, NOT FOR THE CAUSE.
         *
         * This was `trigger: 'SCHEDULED'`, and on 2026-08-07 every one of seven rows said
         * SCHEDULED while the task had never fired once — they were hand-runs through the same
         * endpoint. The Owner read the briefing, saw seven runs, and reasonably concluded the
         * guardrail had failed. It had not; the data was claiming a cause it could not know.
         *
         * This endpoint knows ONE thing for certain: the request arrived here. Who knocked is
         * in the knock log, which is the only place with evidence. So the row states the door
         * and nothing more.
         */
        decorate: { via: 'SCHEDULED_ENDPOINT', nextRunAt: next },
        run: async () => it.result
      })
      rows.push({ id: kind.prefix + it.suffix, outcome: r.outcome, recorded: r.recorded })
      if (!r.recorded) recorded = false
      if (r.outcome === 'ANSWERED') answered++
    }
  }

  /**
   * ⛔ WHAT MAKES THE WINDOWS TASK GO RED — AND WHAT MUST NOT.
   *
   * A first version required EVERY errand to answer. Measured against the real register, one
   * ingredient in six gets throttled on a normal day — so the task would have reported failure
   * every morning, and 「the task is failing」 would have become background noise within a week.
   *
   * **That is the same crying-wolf failure as a red DUE line, arriving one level down** — at
   * the Windows exit code instead of in the sentence. A site being flaky is not the SCHEDULE
   * failing; the row is written, the briefing tells the story, and witness #2 covers staleness.
   *
   * The schedule has failed when it produced nothing he can use:
   */
  const nothingRan = ran === 0                      // wiring gone — the timer runs an empty list
  const nothingRecorded = !recorded                 // it ran and the answers were lost
  const somethingRefused = refused.length > 0       // a kind was wired that the gate rejected
  const everythingBlocked = ran > 0 && answered === 0 // the source was wholly unreachable

  return {
    ok: !(nothingRan || nothingRecorded || somethingRefused || everythingBlocked),
    why: { nothingRan, nothingRecorded, somethingRefused, everythingBlocked },
    answered,
    ran,
    recorded,
    refused,
    nextRunAt,
    rows
  }
}

module.exports = { runScheduledErrands }
