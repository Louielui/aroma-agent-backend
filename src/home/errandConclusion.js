'use strict'

/**
 * errandConclusion.js — what 首頁 says instead of an execution log.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「an errand log does not belong on 首頁. What I want is the CONCLUSION.」**
 *
 * A row is one execution of one query — the wrong grain for a briefing. Forty-four rows pushed
 * the composer off the screen: **the briefing ate the thing it sits above.**
 *
 * ⛔ THE TWO RULES BELOW ARE STRUCTURAL, NOT REMEMBERED.
 *
 * ② `gap` IS ITS OWN FIELD. An ingredient that could not be searched never enters the calm
 *    summary, and never contributes to its count. Folding it in would require DELETING a named
 *    field, not merely writing the sentence differently. The Owner: 「that is the through-line
 *    of the entire week and it is the one that will be tempting to fold in when five of six are
 *    clean.」
 *
 * ① `unknown` IS ITS OWN FIELD, for the same reason. 「新」 is a comparison, and a comparison
 *    with nothing behind it is not 「冇新嘢」 — it is 「未有得比」. On a FIRST RUN every ingredient
 *    is uncomparable and everything looks new; both the calm sentence and the alert are
 *    withheld, because either one would be a fabrication.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const CONCLUSION = Object.freeze({
  NEVER_RUN: 'NEVER_RUN',           // no row has ever existed
  CANNOT_COMPARE: 'CANNOT_COMPARE', // ran, but nothing to compare against — first run
  NOTHING_NEW: 'NOTHING_NEW',       // every ingredient checked AND comparable AND unchanged
  NEW_FINDINGS: 'NEW_FINDINGS',     // something appeared that was not there last time
  PARTIAL: 'PARTIAL'                // ⛔ something could not be checked. Never reads as clean.
})

/** The ingredient is the part of the id between the kind prefix and the trailing date. */
function ingredientOf (kind, id) {
  const rest = String(id).slice(kind.prefix.length)
  return rest.replace(/-\d{4}-\d{2}-\d{2}$/, '')
}

/** A result's identity for comparison. Date + title — what the Owner would recognise. */
const keyOf = (it) => (it.when || '?') + '|' + String(it.title || '').slice(0, 60)

/**
 * @param {object} kind a KINDS entry
 * @param {Array} rows every errand row
 * @param {number} now
 */
function conclusionFor (kind, rows, now) {
  const mine = (rows || []).filter((r) => r && typeof r.id === 'string' && r.id.startsWith(kind.prefix))
  const empty = {
    kind: kind.id, title: kind.title, openable: false, alert: null, gap: null, unknown: null, calm: null,
    newItems: [], unchecked: [], uncomparable: [], checkedIngredients: [], runsToday: 0
  }
  /**
   * ⛔ 冇門好過一道假門. A section is openable when a detail view would HAVE something —
   * never because of what kind it is. NEVER_RUN gets a line and no affordance, and the
   * missing door is the honest statement that there is nothing behind it.
   */
  if (!mine.length) return Object.assign({}, empty, { state: CONCLUSION.NEVER_RUN, openable: false })

  // Group by ingredient, newest first.
  const byIng = new Map()
  for (const r of mine) {
    const ing = ingredientOf(kind, r.id)
    if (!byIng.has(ing)) byIng.set(ing, [])
    byIng.get(ing).push(r)
  }
  for (const list of byIng.values()) list.sort((a, b) => Number(b.at) - Number(a.at))

  const newItems = []
  const unchecked = []
  const uncomparable = []
  const clean = []
  let runsToday = 0

  for (const [ing, list] of byIng) {
    const latest = list[0]
    runsToday = Math.max(runsToday, Number(latest.runCount) || 1)

    // ⛔ RULE ②. Anything that did not produce an answer is a GAP, full stop. It is not
    // 「probably fine」 and it does not join the clean count.
    if (latest.outcome !== 'ANSWERED') {
      unchecked.push({ ingredient: ing, why: latest.detail || latest.outcome })
      continue
    }

    // ⛔ RULE ①. Comparison needs a previous ANSWERED run for THIS ingredient. Without one
    // there is no such thing as 「new」, and no such thing as 「nothing new」.
    const prev = list.slice(1).find((r) => r.outcome === 'ANSWERED' && Array.isArray(r.items))
    if (!prev || !Array.isArray(latest.items)) {
      uncomparable.push({ ingredient: ing, why: prev ? '今次冇記低搵到啲乜' : '之前冇紀錄好比' })
      continue
    }

    const seen = new Set(prev.items.map(keyOf))
    const fresh = latest.items.filter((it) => !seen.has(keyOf(it)))
    if (fresh.length) newItems.push({ ingredient: ing, items: fresh })
    else clean.push(ing)
  }

  // ── the four fields. Each is a separate fact and none absorbs another. ──────
  const alert = newItems.length
    ? '⚠ ' + newItems.map((n) => n.ingredient + ' 有新回收:' +
        n.items.slice(0, 2).map((i) => i.when + ' ' + i.title.slice(0, 52)).join(' / ')).join(';')
    : null

  const gap = unchecked.length
    ? '⛔ ' + unchecked.map((u) => u.ingredient).join('、') + ' 查唔到,所以呢 ' +
      unchecked.length + ' 樣今日冇查過 —— 唔等於冇事。'
    : null

  const unknown = uncomparable.length
    ? uncomparable.map((u) => u.ingredient).join('、') + ' 未有得比(' +
      (uncomparable[0].why) + '),所以講唔到有冇新嘢。'
    : null

  const calm = clean.length ? clean.length + ' 樣查過,冇新回收。' : null

  // ⛔ PARTIAL WINS. A word that reads clean must never be chosen while something is unchecked.
  let state
  if (unchecked.length) state = CONCLUSION.PARTIAL
  else if (newItems.length) state = CONCLUSION.NEW_FINDINGS
  else if (clean.length) state = CONCLUSION.NOTHING_NEW
  else state = CONCLUSION.CANNOT_COMPARE

  return {
    kind: kind.id,
    title: kind.title,
    state,
    alert,
    gap,
    unknown,
    calm,
    newItems,
    unchecked,
    uncomparable,
    checkedIngredients: clean,
    openable: true,
    runsToday
  }
}

module.exports = { conclusionFor, CONCLUSION }
