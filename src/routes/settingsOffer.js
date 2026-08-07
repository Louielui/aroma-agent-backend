'use strict'

/**
 * settingsOffer.js — THE DETERMINISTIC ENTRANCE to a settings change.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「A registry she cannot reach from conversation is a registry I have to ask you to
 * > edit, which is the thing it was built to stop.」**
 *
 * Measured 2026-08-07: 「幫我改，每樣食材顯示 10 條回收」 produced a conversation and changed
 * nothing. Conversation could do four things deterministically — time, date, calc, convert —
 * and settings was not among them. The registry had an HTTP surface and no door.
 *
 * ⛔ NO CLASSIFIER, FOR THE SAME REASON AS THE FILE ENTRANCE.
 * A registry label and a number are LITERAL TOKENS, exactly like a file path: either the
 * sentence contains them or it does not. M-5 (the classifier is non-deterministic on the same
 * sentence) has nothing to be unstable about here.
 *
 * ⛔ AND IT PRODUCES AN OFFER, NEVER A CHANGE.
 * One line and a button. Nothing is written until he presses, so a false trigger costs one
 * glance — the same guarantee `workRequestOffer.js` gives for file changes.
 *
 * ⛔ AND THE OFFER SHOWS BEFORE → AFTER.
 * > 「A settings offer that says 每樣食材顯示幾多條回收：6 → 10 is one line and removes any
 * > chance I approve a change I did not mean.」
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { ENTRIES, validate, entry } = require('../governance/settingsRegistry')

/** A change verb, so a QUESTION about a setting is not read as a request to change it. */
const CHANGE_VERB = /(改|設|set|轉|調|校)/
/** The same refusal family the file entrance uses — 唔好改 must not become 改. */
const REFUSAL = /(唔好|唔使|唔准|咪|千祈|暫時|先唔|唔想|唔要|不要|不用|別|勿)/

/**
 * Aliases per entry — the other ways he might name the same setting. SHORT on purpose: this is
 * a lookup table, and a lookup table that grows without bound is the maintained-list failure.
 * A label he uses that is not here simply does not fire, and he is asked which setting he means.
 */
const ALIASES = Object.freeze({
  recallIngredients: ['查邊幾樣食材', '查邊幾樣', '查咩食材'],
  recallShownPerIngredient: ['每樣食材顯示', '顯示幾多條', '條回收', '顯示幾多'],
  pauseBetweenMs: ['搜尋之間', '隔幾耐搜'],
  minRunIntervalMs: ['最少隔幾耐', '幾耐先再行'],
  recallEveryMs: ['幾耐查一次', '幾耐查'],
  recallGraceMs: ['幾耐算過期', '過期'],
  recallDailyHour: ['幾點查', '每朝幾點'],
  /**
   * ⛔ MATCHING TOKENS, NOT INTERFACE TEXT. These are compared against what HE TYPES, so they
   * are never translated — see governance/textClasses.js, class MATCHING. Translating this
   * list would delete the entrance with no code removed and nothing reported.
   */
  language: ['介面語言', '介面用邊種', '介面用乜', '介面用什麼', '用邊種語言', '介面語']
})

/**
 * Find the ONE entry the sentence names.
 *
 * ⛔ LONGEST MATCH WINS, and that rule exists because of a real collision: 「食材」 is an alias of
 * the ingredient list AND a substring of the OTHER setting's own label, 「每樣食材顯示幾多條回收」.
 * Matching by mere containment made 「改每樣食材顯示 10 條」 resolve to the ingredient list.
 *
 * Longest match is deterministic — no scoring, no judgement — and a genuine TIE still fires
 * nothing, because picking one would be a classifier written by hand.
 */
function entryNamedIn (message) {
  const hits = []
  for (const e of ENTRIES) {
    const needles = [e.say].concat(ALIASES[e.id] || [])
    const matched = needles.filter((n) => message.includes(n)).sort((a, b) => b.length - a.length)[0]
    if (matched) hits.push({ e, matched })
  }
  if (!hits.length) return null
  if (hits.length === 1) return hits[0].e

  /**
   * ⛔ MORE THAN ONE ENTRY MATCHED — AND THERE ARE TWO VERY DIFFERENT REASONS FOR THAT.
   *
   * CONTAINMENT: one matched phrase sits INSIDE another. 「食材」 is a substring of
   * 「每樣食材顯示幾多條回收」 — that is ONE setting being named, not two, and the longer phrase
   * is unambiguously the one he wrote.
   *
   * DISTINCT: two unrelated phrases both matched — he genuinely named two settings.
   * **Then this fires NOTHING.** Longest-match would silently pick one, and picking one is the
   * hand-written classifier this entrance exists to avoid.
   */
  hits.sort((a, b) => b.matched.length - a.matched.length)
  const longest = hits[0]
  const everyOtherIsContained = hits.slice(1).every((h) => longest.matched.includes(h.matched))
  return everyOtherIsContained ? longest.e : null
}

/** The value named in the sentence, in the entry's own type. */
function valueIn (message, e) {
  if (e.type === 'int') {
    // Full-width digits are ordinary in his typing.
    const norm = message.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0))
    const nums = norm.match(/-?\d+/g)
    if (!nums || nums.length !== 1) return null // two numbers is ambiguous; none is incomplete
    return Number(nums[0])
  }
  if (e.type === 'enum') {
    /**
     * ⛔ THE VALUE IS NAMED IN WORDS, SO THE WORDS ARE MATCHING TOKENS TOO.
     *
     * Both spellings of each, always, and both scripts — he writes 英文 and he writes 'en'.
     * The same discipline as intake/scopeNotes.js: adding a form is additive and nothing is
     * ever SWAPPED, because a sentence he has already typed must keep working.
     *
     * ⛔ EXACTLY ONE MATCH OR NOTHING. If a sentence names two locales the entrance fires
     * nothing rather than picking one — picking one is the hand-written classifier this whole
     * mechanism exists to avoid (M-5).
     */
    const FORMS = { zh: ['中文', '繁體', '廣東話', 'zh'], en: ['英文', 'English', 'english', 'en'] }
    const named = e.oneOf.filter((loc) => (FORMS[loc] || [loc]).some((w) => message.includes(w)))
    return named.length === 1 ? named[0] : null
  }

  if (e.type === 'string[]') {
    // A list is only unambiguous when he writes it as one, after a colon or 「改成」.
    const m = message.match(/(?:改成|設成|:|：)\s*(.+)$/)
    if (!m) return null
    const list = m[1].split(/[、,，\s]+/).map((s) => s.trim()).filter(Boolean)
    return list.length ? list : null
  }
  return null
}

/**
 * @param {{message:string, currentValue?:function}} input
 * @returns {{offer:object|null, reason:string|null}}  the reason travels to the outcome log
 */
function explainSettingsOffer (input = {}) {
  const message = typeof input.message === 'string' ? input.message : ''
  if (!message) return { offer: null, reason: 'empty' }
  if (!CHANGE_VERB.test(message)) return { offer: null, reason: 'not_a_change_request' }
  if (REFUSAL.test(message)) return { offer: null, reason: 'negated' }

  const e = entryNamedIn(message)
  if (!e) return { offer: null, reason: 'no_single_setting_named' }

  const to = valueIn(message, e)
  if (to === null) return { offer: null, reason: 'no_value_named' }

  // ⛔ VALIDATED BEFORE HE IS OFFERED IT. Offering a change the registry would refuse would
  // put a button on screen that cannot work — and the refusal must carry the range, which is
  // a fence rather than a suggestion.
  const v = validate(e.id, to)
  if (!v.ok) return { offer: null, reason: 'refused:' + v.reason, saying: v.saying }

  const from = typeof input.currentValue === 'function' ? input.currentValue(e.id) : undefined

  return {
    offer: {
      id: e.id,
      say: e.say,
      from,
      to: v.value,
      appliesOn: e.appliesOn,
      howToApply: e.howToApply || null,
      // ⛔ ONE LINE, BEFORE → AFTER. He approves what he can see.
      line: e.say + ':' + JSON.stringify(from) + ' → ' + JSON.stringify(v.value),
      source: 'deterministic'
    },
    reason: null
  }
}

const settingsOfferFor = (input) => explainSettingsOffer(input).offer

module.exports = { explainSettingsOffer, settingsOfferFor, entryNamedIn, valueIn, ALIASES }
