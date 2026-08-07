'use strict'

/**
 * sectionDetail.js — what is behind the door.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * DESIGN-HOME-SECTIONS §3.
 *
 * > ## The inside is the SAME CONCLUSION AT HIGHER RESOLUTION. It is not the execution history.
 *
 * 首頁 shows one line per kind and caps rows at six. Opening the section shows every ingredient
 * with its own result, both witnesses, and the part that is genuinely new: **what CHANGED on
 * which day**, computed with the same diff that produces 「新」.
 *
 * ⛔ AND HISTORY IS CHANGE, NOT OCCURRENCE. A day that repeats yesterday's list is a log. A day
 * that says 「冇變」 is a history. The Owner has now rejected the log grain twice — once on 首頁
 * (forty-four rows) and once in the 「今日行過 7 次」 line — and this is the same lesson applied
 * before it is made a third time.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { freshnessOf } = require('./errandKinds')
const { t } = require('../i18n/t')

/** The ingredient is the part of the id between the kind prefix and the trailing date. */
function ingredientOf (kind, id) {
  return String(id).slice(kind.prefix.length).replace(/-\d{4}-\d{2}-\d{2}$/, '')
}

/** A result's identity for comparison — date + title, what he would recognise. */
const keyOf = (it) => (it.when || '?') + '|' + String(it.title || '').slice(0, 60)

const dayOf = (ms) => new Date(Number(ms)).toISOString().slice(0, 10)

/**
 * @param {object} kind a KINDS entry
 * @param {Array} rows every errand row
 * @param {number} now
 * @param {object=} witness the Windows scheduler witness, or undefined if nobody looked
 */
function detailFor (kind, rows, now, witness) {
  const mine = (rows || []).filter((r) => r && typeof r.id === 'string' && r.id.startsWith(kind.prefix))

  // ── group by ingredient, newest first ──────────────────────────────────────
  const byIng = new Map()
  for (const r of mine) {
    const ing = ingredientOf(kind, r.id)
    if (!byIng.has(ing)) byIng.set(ing, [])
    byIng.get(ing).push(r)
  }
  for (const list of byIng.values()) list.sort((a, b) => Number(b.at) - Number(a.at))

  /**
   * ⛔ EVERY INGREDIENT, UNCAPPED. The six-row cap belongs to 首頁, where the briefing must not
   * eat the screen. Here the whole point is the resolution.
   *
   * ⛔ And a BLOCKED ingredient carries its reason and NO count. A zero and a failure look
   * identical as a number and mean opposite things — the through-line of the whole week.
   */
  const ingredients = []
  for (const [ingredient, list] of byIng) {
    const latest = list[0]
    if (latest.outcome !== 'ANSWERED') {
      ingredients.push({
        ingredient,
        state: 'BLOCKED',
        why: latest.detail || latest.outcome,
        at: Number(latest.at),
        runsToday: Number(latest.runCount) || 1
      })
      continue
    }
    /**
     * ⛔ UNRECORDED IS NOT ZERO. Rows written before the items field existed have no items at
     * all. Collapsing that into [] rendered 「冇搵到相關回收」 for every one of them — a false
     * all-clear produced by an absent FIELD rather than an absent recall. Found on the live
     * screen; conclusionFor already handled it and the detail view threw it away.
     */
    if (!Array.isArray(latest.items)) {
      ingredients.push({
        ingredient,
        state: 'UNRECORDED',
        why: t('detail.whyNoItemsRecordedThen'),
        items: null,
        at: Number(latest.at),
        runsToday: Number(latest.runCount) || 1
      })
      continue
    }
    ingredients.push({
      ingredient,
      state: 'ANSWERED',
      found: latest.found,
      items: latest.items,
      at: Number(latest.at),
      runsToday: Number(latest.runCount) || 1
    })
  }

  // ── history: one entry per DAY, saying what changed ────────────────────────
  const days = new Map()
  for (const r of mine) {
    const d = dayOf(r.at)
    if (!days.has(d)) days.set(d, [])
    days.get(d).push(r)
  }
  const sortedDays = [...days.keys()].sort().reverse()

  const history = sortedDays.map((day, i) => {
    const older = sortedDays.slice(i + 1)
    const at = Math.max(...days.get(day).map((r) => Number(r.at)))
    const changes = []
    let comparable = 0

    for (const r of days.get(day)) {
      if (r.outcome !== 'ANSWERED' || !Array.isArray(r.items)) continue
      const ing = ingredientOf(kind, r.id)
      // the newest ANSWERED row for this ingredient on any EARLIER day
      let prev = null
      for (const od of older) {
        prev = days.get(od).find((x) => ingredientOf(kind, x.id) === ing && x.outcome === 'ANSWERED' && Array.isArray(x.items))
        if (prev) break
      }
      if (!prev) continue
      comparable++
      const seen = new Set(prev.items.map(keyOf))
      const fresh = r.items.filter((x) => !seen.has(keyOf(x)))
      if (fresh.length) changes.push(ing + ':' + fresh.map((x) => x.when + ' ' + String(x.title).slice(0, 48)).join(' / '))
    }

    let line
    if (!comparable) {
      // ⛔ Nothing to compare against is 「未有得比」, never 「冇變」 — the same rule the
      // conclusion follows. On the earliest day everything looks new and nothing is.
      line = t('detail.dayCannotCompare', { day })
    } else if (!changes.length) {
      // ⛔ 「冇變」, not a repeat of the same list. Repeating it is the log grain.
      line = t('detail.dayNothingNew', { day })
    } else {
      line = day + ':' + changes.join(';')
    }
    return { day, at, line, changeCount: changes.length }
  })

  return {
    kind: kind.id,
    title: kind.title,
    ingredients,
    history,
    // Carried whole, both witnesses separately — the detail is where 「why is it stale」 is asked.
    freshness: freshnessOf(kind, mine, now, witness)
  }
}

module.exports = { detailFor }
