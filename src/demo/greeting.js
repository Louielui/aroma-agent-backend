'use strict'

/**
 * greeting.js — the line on the empty screen.
 *
 * ── WHY THIS IS SERVER-SIDE ──────────────────────────────────────────────────
 * 早晨 / 午安 / 晚安 depends on the hour, and the hour depends on the OWNER'S timezone —
 * the Owner Settings field, not the browser's clock. The page could be open on a laptop in
 * another zone, or on a phone whose clock is wrong, and it must still greet him by his own
 * time. So the band is decided here, from localTime.js, and the finished line is sent to
 * the page. The client never reads its own clock for this, and a test asserts the band
 * words do not appear in the client bundle at all.
 *
 * ── IT DECLINES RATHER THAN GUESSING, LIKE EVERYTHING ELSE ON THIS CLOCK ────
 * If the timezone cannot be resolved — a malformed setting, an unreadable settings file —
 * there is no band it can justify, so it returns his name alone. A greeting that says 早晨
 * at ten at night is a small thing that quietly proves the clock is wrong; saying nothing
 * about the hour is the honest version of not knowing it.
 *
 * ── THE NAME ─────────────────────────────────────────────────────────────────
 * 「Louie」, never transliterated. Owner Language Policy: people's names keep their original
 * spelling.
 */

const { localParts } = require('../utils/localTime')
const { t } = require('../i18n/t')

/** The Owner's name, as he writes it. Not a setting — a proper noun. */
const OWNER_NAME = 'Louie'

/**
 * The bands, published so the boundaries are readable rather than buried in comparisons.
 * `from` is inclusive, and the last band wraps past midnight.
 */
// ⛔ GETTERS, not thunks. `bandFor` hands `b.word` straight to callers and to the
// published `greeting` field, so `word` must BE the string, resolved at read time.
const GREETINGS = Object.freeze([
  { get word () { return t('greet.morning') }, from: 5, to: 12 }, // 05:00–11:59
  { get word () { return t('greet.afternoon') }, from: 12, to: 18 }, // 12:00–17:59
  { get word () { return t('greet.evening') }, from: 18, to: 5 } //  18:00–04:59, wrapping
])

function bandFor (hour) {
  for (const b of GREETINGS) {
    const wraps = b.from > b.to
    if (wraps ? (hour >= b.from || hour < b.to) : (hour >= b.from && hour < b.to)) return b.word
  }
  return null
}

/**
 * @param {Date} at    the instant to greet at
 * @param {{root?, env?}} opts  passed to localTime / ownerSettings
 * @returns {{ greeting: string|null, name: string, line: string }}
 *   `greeting` is null when the clock could not be resolved; `line` is then just the name.
 */
function greetingFor (at, opts = {}) {
  let word = null
  try {
    word = bandFor(localParts(at instanceof Date ? at : new Date(), opts).hour)
  } catch (_) {
    word = null // an unresolvable zone: no claim about the hour
  }
  return {
    greeting: word,
    name: OWNER_NAME,
    line: word ? t('greet.line', { word, name: OWNER_NAME }) : OWNER_NAME
  }
}

module.exports = { greetingFor, GREETINGS, OWNER_NAME }
