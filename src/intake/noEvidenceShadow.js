'use strict'

/**
 * noEvidenceShadow.js — SHADOW ONLY. Measures; decides nothing; refuses nothing.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE FAILURE (HR-74). 「Aroma System 目前沒有專門的網站，現在我們有三間門市」 — specific,
 * plausible, wrong in a way the Owner could not check, produced by a turn that read NOTHING.
 * No gate objected, because every guard here is a RELATION between a claim and evidence and
 * there was no evidence to relate to. Protection is proportional to how much was read, so the
 * system is least protected exactly when the model is most likely to be inventing.
 *
 * `GATE.NO_EVIDENCE` was built for this, is named for this, and has zero call sites in the
 * chat path.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── ⛔ WHY THIS SHADOW IS FREE, AND B's WAS NOT ─────────────────────────────
 * B's shadow was refused because 「shadowing a semantic decision means a second paid call per
 * turn」. This is a regex and a set-membership test over a string already in hand: ZERO model
 * calls. So measuring first costs nothing, and the ordering that was wrong for B is right here.
 *
 * ── ⛔ WHAT IT DOES NOT DECIDE ──────────────────────────────────────────────
 * 「Is this claim ABOUT the business」 is prose-only — the detector measured at recall 1/6 —
 * and it is NOT attempted. It is not needed: this runs ONLY on turns that read nothing, and on
 * such a turn a specific unsourced quantity is unsupported WHATEVER it is about. The hard half
 * is dissolved by restricting when the check runs, not by solving it.
 *
 * ⛔ AND IT MUST NEVER GROW THAT HALF LATER. An 「is it about the business」 extension would
 * arrive wearing this module's credibility. This paragraph is the refusal.
 *
 * ── ⛔ WHAT IT CANNOT SEE, STATED SO NOBODY READS IT AS MORE ────────────────
 * A claim carrying NO token. 「我哋冇網站」 is an invention with nothing to check provenance
 * against, and is structurally invisible here — the same way HR-68's duplicate detector was
 * blind to the rule nobody duplicated. **It closes the half with figures, not the failure.**
 */

/** Chinese numerals plus the measure words that turn one into a quantity of something. */
const CJK_NUM = '〇零一二三四五六七八九十百千萬兩'
const MEASURE = '間家個位張條隻本部台輛套份筆項次日月年時分秒元蚊斤磅箱包排'

/**
 * A SPECIFIC quantity: a numeral, a measure word, then a noun character.
 *
 * ⛔ NOT A BARE NUMERAL. Measured on real replies: matching any numeral fires on 「一下」 and
 * 「一個」 — 「一」 is Chinese's indefinite article — so the naive form flagged both legitimate
 * replies from the same runs. The measure-word form clears one of them and still trips on
 * 「一個明確」, which is recorded rather than tuned away: excluding bare 「一」 would also miss
 * 「我哋有一間門市」, a genuine invention numbered one. That trade needs the Owner's real
 * traffic, which is exactly what this shadow is for.
 */
const SPECIFIC = new RegExp('[\\d' + CJK_NUM + ']+[' + MEASURE + '][\\u4e00-\\u9fff]', 'g')
/** Arabic runs are specific on their own — prices, counts, years. */
const ARABIC = /\d[\d,.]*/g

function textOf (v) { return typeof v === 'string' ? v : '' }

/**
 * @param {object} turn
 * @param {string} turn.reply      what she is about to say
 * @param {string} turn.question   the Owner's own words this turn
 * @param {number} turn.rowsRead   how many rows this turn actually read
 * @param {string} [turn.history]  prior conversation text, if any
 * @param {string} [turn.rowsText] serialised rows, when any were read
 * @returns {{applies:boolean, wouldFire:boolean, tokens:string[], reason:string}}
 */
function inspectTurn (input) {
  // ⛔ `= {}` covers `undefined` and NOT `null`, and a caller reading a turn off a store hands
  // you null far more often than undefined. Caught by the rubbish-input test, which is what it
  // is for — a measurement that throws would take down the turn it was only meant to watch.
  const turn = (input && typeof input === 'object') ? input : {}
  const reply = textOf(turn.reply)
  const rowsRead = Number(turn.rowsRead) || 0

  // ⛔ ONLY ZERO-EVIDENCE TURNS. With rows in hand, claim binding and the answer plan already
  // own the question and this must not second-guess them.
  if (rowsRead > 0) return { applies: false, wouldFire: false, tokens: [], reason: 'rows_were_read' }
  if (!reply.trim()) return { applies: false, wouldFire: false, tokens: [], reason: 'no_reply' }

  const sourceText = textOf(turn.question) + ' ' + textOf(turn.history) + ' ' + textOf(turn.rowsText)
  const found = []
  for (const re of [SPECIFIC, ARABIC]) {
    re.lastIndex = 0
    for (const m of reply.match(re) || []) {
      // Sourced if the token appears anywhere the Owner or a read put it.
      if (sourceText.includes(m)) continue
      if (!found.includes(m)) found.push(m)
    }
  }

  return {
    applies: true,
    wouldFire: found.length > 0,
    tokens: found,
    reason: found.length ? 'specific_unsourced_token' : 'no_specific_claim'
  }
}

/**
 * Emit the measurement. ⛔ LOG ONLY — it returns nothing the caller can act on, so it cannot
 * become load-bearing by accident. Refusing is deliberately not expressible here: an empty
 * reply is worse than a wrong one, and a gate whose failure mode is silence has reproduced the
 * defect it was built against.
 */
function logNoEvidenceShadow (turn, requestId) {
  try {
    const r = inspectTurn(turn)
    if (!r.applies) return
    console.log('[AROMA-NOEVIDENCE]', JSON.stringify({
      requestId: requestId || null,
      path: turn && turn.path ? turn.path : null,
      wouldFire: r.wouldFire,
      reason: r.reason,
      /**
       * ⛔ THE TOKENS THEMSELVES ARE NOT LOGGED, AND THEY USED TO BE.
       *
       * `tokens` holds numerals lifted verbatim out of her REPLY — 「三間」, a price, a date.
       * That is reply content, and a log line may carry status, counts, routes, capability
       * names, timings and requestIds, never content. The count is the measurement; the
       * strings were convenience.
       *
       * The shadow's purpose survives intact: how OFTEN it would fire, and on how many
       * tokens, is what produces the false-positive rate. Which numeral it was is readable
       * from the conversation store, which is the record that is supposed to hold text.
       */
      tokenCount: r.tokens.length,
      replyChars: textOf(turn.reply).length
    }))
  } catch (_) { /* a measurement may never break a turn */ }
}

module.exports = { inspectTurn, logNoEvidenceShadow, SPECIFIC, ARABIC }
