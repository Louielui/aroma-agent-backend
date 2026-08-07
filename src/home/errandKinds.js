'use strict'

/**
 * errandKinds.js — how stale a row is ALLOWED to be.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「時間戳唔係新鮮度。」**
 *
 * The briefing showed `07:14` and thought it had said something. A timestamp is a fact about
 * the past. **Freshness is a claim about the present**, and it cannot be made from one number —
 * it needs the cadence the row is expected to keep.
 *
 * Without that second number, a scheduler that silently stopped produces a briefing identical
 * to one working perfectly. **The scheduler alone would have made the briefing more confidently
 * wrong**, which is why this is built first.
 *
 * ⛔ AND THE PART A ROW CAN NEVER DO.
 *
 * A section built by walking the store can only report things that HAPPENED. An errand that has
 * never run once contributes no row, renders as nothing, and nothing reads as calm. **The
 * registry below drives the section — not the store** — so 「從來未查過」 is sayable at all.
 * That is `DID_NOT_RUN` (DESIGN-SCHEDULED-SURFACE.md §2): the absence of a row IS the signal,
 * and something has to interpret absence.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const HOUR = 3600 * 1000
const DAY = 24 * HOUR

const FRESHNESS = Object.freeze({
  FRESH: 'FRESH',           // ran within its cadence
  DUE: 'DUE',               // past it — see the note on crying wolf below
  NEVER_RUN: 'NEVER_RUN',   // no row has ever existed for this kind
  UNJUDGEABLE: 'UNJUDGEABLE' // a row exists but carries no usable time
})

/**
 * ⛔ `scheduled` IS DECLARED FALSE, AND THAT IS NOT A PLACEHOLDER.
 *
 * She has no scheduler. Declaring `true` here would make the briefing say a thing runs daily
 * when in truth it runs when someone remembers — the exact 「scheduled, while I happen to be
 * up」 lie that DESIGN-SCHEDULED-SURFACE.md §3 refused. It flips when a trigger exists, and the
 * sentence for DUE changes with it.
 */
const KINDS = Object.freeze([
  Object.freeze({
    id: 'recall',
    title: '回收檢查',
    prefix: 'recall-',
    everyMs: DAY,
    graceMs: 6 * HOUR,
    scheduled: false,
    manualHow: 'node scripts/runRecallErrand.js',
    // ⛔ THE TIMER'S ALLOWLIST, AND IT IS THE ALLOWLIST ITSELF — not a rule beside one.
    // Owner's standing ruling: on a timer, READS ONLY. The scheduled route can only invoke
    // kinds where this is true, and it accepts no other way to name an action — so 「it cannot
    // write」 is a property of what it is able to reach, not a promise about its behaviour.
    // 「唔可能」,唔係「唔准」. Adding a kind here is adding it to the timer: needs its own GO.
    readOnly: true
  })
])

/** Rows are matched by ID PREFIX. Titles are human text and will be reworded; ids are the contract. */
function kindOfRow (row) {
  if (!row || typeof row.id !== 'string') return null
  return KINDS.find((k) => row.id.startsWith(k.prefix)) || null
}

/** 「3 日」 / 「2 個鐘」 / 「11 分鐘」 — the unit he would use out loud. */
function ago (ms) {
  if (ms < 90 * 60 * 1000) return Math.max(1, Math.round(ms / 60000)) + ' 分鐘'
  if (ms < 2 * DAY) return Math.round(ms / HOUR) + ' 個鐘'
  return Math.round(ms / DAY) + ' 日'
}

/** 「每日」 / 「每 6 個鐘」 */
function cadenceLabel (everyMs) {
  if (everyMs === DAY) return '每日'
  if (everyMs % DAY === 0) return '每 ' + (everyMs / DAY) + ' 日'
  return '每 ' + Math.round(everyMs / HOUR) + ' 個鐘'
}

/**
 * @param {object} kind one of KINDS (or a kind-shaped object)
 * @param {Array} rows every errand row; only this kind's are considered
 * @param {number} now
 * @returns {{kind, state, lastAt, ageMs, line}}
 */
function freshnessOf (kind, rows, now, witness) {
  const mine = (rows || []).filter((r) => r && typeof r.id === 'string' && r.id.startsWith(kind.prefix))
  const base = { kind: kind.id, title: kind.title, everyMs: kind.everyMs, scheduled: kind.scheduled }

  if (!mine.length) {
    // ⛔ The state no row could have produced. Reached by walking the REGISTRY.
    return {
      ...base,
      state: FRESHNESS.NEVER_RUN,
      lastAt: null,
      ageMs: null,
      line: kind.title + ':從來未查過。應該 ' + cadenceLabel(kind.everyMs) + '一次。'
    }
  }

  const timed = mine.filter((r) => Number(r.at) > 0)
  if (!timed.length) {
    // A row with no time cannot be judged. Treating `null` as 0 would date it to 1970 and
    // render as maximally overdue — a defect wearing the shape of an answer (HR-27).
    return {
      ...base,
      state: FRESHNESS.UNJUDGEABLE,
      lastAt: null,
      ageMs: null,
      line: kind.title + ':有紀錄但冇時間,所以我判斷唔到有幾新。呢個係一個缺陷。'
    }
  }

  const lastAt = Math.max(...timed.map((r) => Number(r.at)))
  const ageMs = now - lastAt
  const grace = kind.graceMs || 0

  // ⛔ WITNESS #2 — the registry half, measured against `nextRunAt`.
  //
  // Stored on the row when a scheduled run writes it (DESIGN-SCHEDULED-SURFACE §2), so a later
  // cadence change does not retroactively rewrite whether past runs were on time. Derived from
  // `lastAt + everyMs` only when no run ever declared one.
  const newest = timed.reduce((a, b) => (Number(a.at) >= Number(b.at) ? a : b))
  const stored = Number(newest.nextRunAt) > 0 ? Number(newest.nextRunAt) : null
  const nextRunAt = stored !== null ? stored : lastAt + kind.everyMs
  const nextRunAtSource = stored !== null ? 'STORED' : 'DERIVED'
  const gap = now > (nextRunAt + grace)

  // `scheduled` is MEASURED when a witness is supplied, and only falls back to the kind's
  // declaration when nobody looked. `null` means the witness could not look — neither claim.
  const scheduled = witness && Object.prototype.hasOwnProperty.call(witness, 'scheduled')
    ? witness.scheduled
    : (kind.scheduled === true)

  const witnesses = {
    // ⛔ BOTH, ALWAYS, AND SEPARATELY. A trigger that never fires leaves Windows perfectly
    // healthy — no error, no non-zero result, nothing to report. The gap is its only trace.
    registry: { gap, nextRunAt, nextRunAtSource, lastAt, ageMs },
    windows: witness
      ? { state: witness.state, scheduled: witness.scheduled, healthy: witness.healthy, lastTaskResult: witness.lastTaskResult === undefined ? null : witness.lastTaskResult, saying: witness.saying }
      : { state: 'NOT_CHECKED', scheduled: null, healthy: null, lastTaskResult: null, saying: '冇問過 Windows。' }
  }

  // ⛔ FRESHNESS IS THE GAP, NOT THE AGE.
  //
  // A first version computed `gap` for the witness and then decided FRESH from `ageMs` alone —
  // so a row that DECLARED it would run again an hour ago, and did not, still read as fresh.
  // The stored `nextRunAt` is witness #2's entire mechanism; judging by age would have silently
  // ignored it and left the quiet-failure case undetectable. Caught by a test, not by review.
  //
  // For a DERIVED nextRunAt the two are identical (lastAt + everyMs + grace), so this is a
  // strict generalisation, not a behaviour change for anything that has no stored value.
  const fresh = !gap

  if (fresh) {
    return {
      ...base,
      scheduled,
      state: FRESHNESS.FRESH,
      lastAt,
      ageMs,
      nextRunAt,
      nextRunAtSource,
      witnesses,
      line: kind.title + ':' + ago(ageMs) + '之前查過。' + cadenceLabel(kind.everyMs) + '一次。'
    }
  }

  // ⛔ DUE MUST NOT CRY WOLF.
  //
  // With no scheduler, every kind is DUE most of the time — that is the NORMAL state of a thing
  // he runs by hand. If it reads as an alarm he learns to skip the line within a week, and the
  // day it means something he will skip it then too.
  //
  // So DUE names its own cause. Today the cause is always 「nobody ran it」. The day `scheduled`
  // is true, the identical state means something else entirely — the trigger may have died —
  // and the sentence has to say so, because THAT is the silence worth interrupting him for.
  const head = kind.title + ':' + ago(ageMs) + '之前查過,應該' + cadenceLabel(kind.everyMs) + '一次。'
  let line

  if (scheduled === null) {
    // The witness could not look. Claiming either story would be inventing the fact it failed
    // to establish — and the manual story is the comfortable one, which is why it is dangerous.
    line = head + '我問唔到 Windows 有冇排程,所以我唔知係冇人行,定係排程死咗。'
  } else if (witnesses.windows.state === 'DISABLED') {
    // ⛔ ITS OWN SENTENCE, AND THE REASON IS THE WHOLE POINT OF READING THESE ALOUD.
    //
    // A disabled task has `scheduled: false` — correctly, it cannot fire. But routing it into
    // the 「manual」 sentence made 「a schedule exists and somebody switched it off」 read exactly
    // like 「no schedule was ever set up」. He would see 「手動」 and conclude nothing is wired,
    // when in truth something IS wired and is silently off. **The quietest failure mode was
    // mapped onto the calmest sentence.** Found by printing every branch, not by testing them.
    line = head + '⚠ 排程 task 係裝咗嘅,但俾人停用咗,所以佢一世都唔會行。唔係冇裝 —— 係裝咗而熄咗。'
  } else if (scheduled === false) {
    // Today's normal state: no task at all. NOT an alarm — see the note above.
    line = head + '仲係手動行嘅,冇人行就冇新嘅。'
  } else if (witnesses.windows.healthy === false) {
    // Both witnesses agree, and Windows can say WHY. This is the loud case.
    line = head + '⚠ 排程行過但失敗咗,要去睇。' + (witnesses.windows.saying || '')
  } else {
    // ⛔ THE QUIET CASE, AND THE REASON THERE ARE TWO WITNESSES.
    // Windows reports nothing wrong; there is simply no row. A trigger that never fired leaves
    // no error anywhere — this sentence is the only place it surfaces.
    line = head + '⚠ 有排程,但冇行過 —— Windows 嗰邊冇報錯,即係個 trigger 可能根本冇 fire 過。' +
      '呢種情況冇任何錯誤訊息,淨係差咗一行紀錄。'
  }

  return { ...base, scheduled, state: FRESHNESS.DUE, lastAt, ageMs, nextRunAt, nextRunAtSource, witnesses, line }
}

/** Every declared kind, judged. The registry drives it, so absence is visible. */
function freshnessReport (rows, now, witness) {
  return KINDS.map((k) => freshnessOf(k, rows, now, witness))
}

module.exports = { KINDS, FRESHNESS, freshnessOf, freshnessReport, kindOfRow, ago, cadenceLabel }
