'use strict'
/**
 * negativeExistence.js — X4.3. 「這次讀到的沒有」 and 「根本沒有」 are different claims.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE PRODUCTION TURN: ad10ec74.
 *
 * The reply opened with 「日曆讀得到，但讀到的項目沒有一項落在下星期，**所以你下星期目前沒有任何
 * 已排定的安排**。」 and closed, in its own limitations section, with 「無法確認清單是否涵蓋全部
 * 內容」. Both halves came from one SCOPE line that said, in the same breath, 「TOTAL IN THE WIDER
 * SOURCE IS UNKNOWN — do not state or imply how many exist」 and 「2 shown (complete)」.
 *
 * The word 「complete」 there answered a question nobody asked: it meant 「every row we kept is in
 * front of you」, computed as `contextShownCount >= retrievedCount`. Whether the READ itself was
 * complete — the only thing that could support an absence claim — was `unknown`, and was never
 * rendered at all.
 *
 * ⛔ THE TWO CLAIMS, AND WHY ONLY ONE NEEDS PROOF.
 *
 *   A  「這次讀到的項目沒有一項落在下星期」   a statement about the rows in hand.
 *   B  「下星期沒有任何已排定安排」           a statement about the world.
 *
 * A costs nothing to support: the rows are right there. B requires three things to be true at
 * once — the query window covers the period, retrieval inside that window is provably complete,
 * and the scope queried is the scope being claimed. This file refuses B when they are not, and
 * never touches A.
 *
 * ⛔ AND IT FAILS CLOSED, WHICH TODAY MEANS IT ALWAYS REFUSES B.
 *
 * Phase 0 looked for an existing structural representation of 「下星期」 and there is none.
 * `src/utils/localTime.js` has timezone handling, `startOfLocalDay` and `localParts` — the
 * building blocks — but nothing maps an Owner period phrase to a date range, and this tranche
 * was told in terms not to invent one. So `requestedPeriod` arrives null from production and B
 * is refused every time. That is the correct behaviour, not a placeholder: an unprovable
 * absence claim should not ship, and the honest sentence — A — is one the model already writes.
 *
 * The period parameter exists so the rule is COMPLETE and testable now: when a period
 * representation is added later, the proof it must satisfy is already written and pinned.
 * ══════════════════════════════════════════════════════════════════════════════
 */

/**
 * ⛔ A CLOSED MARKER SET, NOT A LANGUAGE ENGINE.
 *
 * The same discipline as X4.2's source aliases: a short fixed list of the words that make a
 * sentence an absence claim about a period. It recognises a SHAPE, not a meaning. It cannot
 * parse a date, does not know what a week is, and never will — anything it fails to recognise
 * simply is not treated as claim B, which leaves the sentence exactly as it is today.
 */
const ABSENCE = Object.freeze([
  '沒有任何', '冇任何', '沒有已排定', '冇已排定', '沒有安排', '冇安排',
  '沒有任何已排定', '沒有事件', '冇事件', '一件都沒有', '一件都冇',
  'nothing scheduled', 'no scheduled', 'no events', 'nothing on'
])

/** Period words only — never a date. A date would be a parser, and this is not one. */
const PERIOD = Object.freeze([
  '下星期', '下週', '下个星期', '下個星期', '今個星期', '今週', '這星期', '本星期',
  '今日', '聽日', '明日', '今晚',
  'next week', 'this week', 'today', 'tomorrow', 'tonight'
])

/**
 * ⛔ THE SUBJECT VOCABULARY — WHAT MAKES A SENTENCE A CALENDAR CLAIM.
 *
 * The first build had none, and that was the whole defect: absence + period matched any prose,
 * so 「下星期沒有任何需要補貨的項目」 — an aroma_system replenishment statement, on a turn that
 * never touched Calendar — was dropped by a Calendar rule.
 *
 * ⛔ AND 安排 IS DELIBERATELY ABSENT. It is ordinary business language: production, staffing,
 * purchasing, delivery and Tea House all have 安排. Admitting it would rebuild the same
 * over-reach one word smaller. The production sentence 「下星期目前沒有任何已排定的安排」 is
 * caught by 已排定, which really does mean a scheduled entry — not by 安排.
 */
const CALENDAR_SUBJECT = Object.freeze([
  '日曆', '行事曆', '已排定', '行程', '會議',
  'calendar', 'meeting', 'appointment', 'event', 'events', 'scheduled'
])

const REFUSAL = Object.freeze({
  NO_REQUESTED_PERIOD: 'requested_period_not_structurally_known',
  WINDOW_DOES_NOT_COVER: 'query_window_does_not_cover_requested_period',
  RETRIEVAL_NOT_PROVEN: 'retrieval_completeness_not_proven',
  FALLBACK_USED: 'fallback_read_cannot_prove_the_bounded_window_empty'
})

/**
 * ⛔ NOT_APPLICABLE IS NOT A VERDICT. A rule that has no jurisdiction returns nothing at all;
 * it does not return 「unproven」. That distinction is the entire correction: the first build
 * answered 「is this claim proven?」 before asking 「is this claim mine to judge?」, and a
 * completeness failure then manufactured jurisdiction over every other source.
 */
const JURISDICTION = Object.freeze({ NOT_APPLICABLE: 'not_applicable', APPLIES: 'applies' })

/** Does the sentence name something the CALENDAR holds? Closed list, no classifier. */
function mentionsCalendarSubject (sentence) {
  const s = String(sentence == null ? '' : sentence).toLowerCase()
  return CALENDAR_SUBJECT.some((w) => s.includes(w.toLowerCase()))
}

/**
 * ⛔ JURISDICTION, IN THIS ORDER, AND COMPLETENESS IS NOT PART OF IT.
 *
 *   1. no Calendar read this turn  → NOT_APPLICABLE. A missing Calendar read is not evidence
 *      that a Gmail, Drive or Aroma sentence is unsafe; this rule simply has no standing.
 *   2. not an absence claim about a period → NOT_APPLICABLE.
 *   3. not about anything the calendar holds → NOT_APPLICABLE, even when Calendar WAS read in
 *      the same turn. Co-reading Calendar does not make every negative sentence a calendar one.
 *
 * Only past all three does completeness get a say.
 */
function calendarJurisdiction ({ sentence, read } = {}) {
  if (!read) return JURISDICTION.NOT_APPLICABLE
  if (!looksLikeNegativeExistence(sentence)) return JURISDICTION.NOT_APPLICABLE
  if (!mentionsCalendarSubject(sentence)) return JURISDICTION.NOT_APPLICABLE
  return JURISDICTION.APPLIES
}

/**
 * Is this sentence claim B?
 *
 * ⛔ BOTH HALVES, OR IT IS NOT A CLAIM ABOUT A PERIOD. 「我沒有任何意見」 has an absence word and
 * no period; 「下星期幾忙？」 has a period and no absence. Only a sentence carrying both is even a
 * candidate, and a candidate is still only refused when the proof below actually fails.
 */
function looksLikeNegativeExistence (sentence) {
  const s = String(sentence == null ? '' : sentence).toLowerCase()
  if (!s) return false
  return ABSENCE.some((a) => s.includes(a.toLowerCase())) && PERIOD.some((p) => s.includes(p.toLowerCase()))
}

const ms = (v) => {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'string' && v) { const t = Date.parse(v); return Number.isFinite(t) ? t : null }
  return null
}

/**
 * Does the proven query window cover the whole requested period?
 *
 * ⛔ COVERAGE IS ⊆, AND PARTIAL IS NOT COVERAGE. A window that holds five days of a seven-day
 * question proves nothing about the other two, and 「mostly covered」 is exactly the reasoning
 * that turns a bounded read into a claim about the world.
 */
function windowCoversPeriod (queryWindow, requestedPeriod) {
  if (!queryWindow || !requestedPeriod) return false
  const ws = ms(queryWindow.start); const we = ms(queryWindow.end)
  const ps = ms(requestedPeriod.start); const pe = ms(requestedPeriod.end)
  if (ws === null || we === null || ps === null || pe === null) return false
  return ws <= ps && we >= pe
}

/**
 * Judge one candidate sentence.
 *
 * ⛔ THE PROOF TARGET IS `completeWithinScope`, NOT `sourceTotal`. A calendar can be provably
 * complete for 24–30 August while the number of events in its entire history stays unknown, and
 * demanding the lifetime total would make every bounded absence claim unprovable forever. The
 * question is 「did we get everything in THIS window」, and nothing wider.
 *
 * @returns {{blocked:boolean, reason:(string|null)}}
 */
function judgeNegativeExistence ({ sentence, read, requestedPeriod } = {}) {
  // ⛔ JURISDICTION FIRST. Everything below judges a claim this rule is entitled to judge.
  if (calendarJurisdiction({ sentence, read }) !== JURISDICTION.APPLIES) {
    return { blocked: false, reason: null, jurisdiction: JURISDICTION.NOT_APPLICABLE }
  }
  // ⛔ A FALLBACK ANSWERS A DIFFERENT QUESTION. The calendar fallback drops timeMax and returns
  // the next events whenever they are; its rows say nothing about whether the ORIGINAL bounded
  // window was empty, so it can never support an absence claim about that window.
  if (read.usedFallback === true) return { blocked: true, reason: REFUSAL.FALLBACK_USED }
  if (read.completeWithinScope !== true) return { blocked: true, reason: REFUSAL.RETRIEVAL_NOT_PROVEN }
  if (!requestedPeriod) return { blocked: true, reason: REFUSAL.NO_REQUESTED_PERIOD }
  const qs = (read.queryScope && typeof read.queryScope === 'object') ? read.queryScope : null
  if (!windowCoversPeriod(qs && qs.range, requestedPeriod)) {
    return { blocked: true, reason: REFUSAL.WINDOW_DOES_NOT_COVER }
  }
  return { blocked: false, reason: null }
}

module.exports = {
  ABSENCE_MARKERS: ABSENCE,
  CALENDAR_SUBJECT_MARKERS: CALENDAR_SUBJECT,
  JURISDICTION,
  mentionsCalendarSubject,
  calendarJurisdiction,
  PERIOD_MARKERS: PERIOD,
  REFUSAL,
  looksLikeNegativeExistence,
  windowCoversPeriod,
  judgeNegativeExistence
}
