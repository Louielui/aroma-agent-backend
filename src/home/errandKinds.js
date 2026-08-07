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
    manualHow: 'node scripts/runRecallErrand.js'
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
function freshnessOf (kind, rows, now) {
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
  const fresh = ageMs <= (kind.everyMs + (kind.graceMs || 0))

  if (fresh) {
    return { ...base, state: FRESHNESS.FRESH, lastAt, ageMs, line: kind.title + ':' + ago(ageMs) + '之前查過。' + cadenceLabel(kind.everyMs) + '一次。' }
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
  const line = kind.scheduled
    ? kind.title + ':' + ago(ageMs) + '之前查過,但應該 ' + cadenceLabel(kind.everyMs) +
      '一次 —— 即係應該行咗而冇行。個 scheduler 可能停咗,要去睇。'
    : kind.title + ':' + ago(ageMs) + '之前查過。應該 ' + cadenceLabel(kind.everyMs) +
      '一次,但仲係手動行嘅,冇人行就冇新嘅。'

  return { ...base, state: FRESHNESS.DUE, lastAt, ageMs, line }
}

/** Every declared kind, judged. The registry drives it, so absence is visible. */
function freshnessReport (rows, now) {
  return KINDS.map((k) => freshnessOf(k, rows, now))
}

module.exports = { KINDS, FRESHNESS, freshnessOf, freshnessReport, kindOfRow, ago, cadenceLabel }
