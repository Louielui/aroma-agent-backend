'use strict'
/**
 * qualificationOutcome.js — THREE OUTCOMES, AND THEY ARE NOT INTERCHANGEABLE.
 *
 * B2 collapsed them and the numbers lied in both directions: abstentions were counted as
 * high-confidence errors, and a row that flipped between two plausible tables across passes
 * was scored the same as a row that was simply wrong.
 *
 *   STABLE_HIGH  same correct intent, HIGH, on every pass        -> may become an auto-read
 *   UNSTABLE     HIGH somewhere, but the passes disagree          -> CLARIFY
 *   AMBIGUOUS    the SENTENCE admits more than one reading        -> CLARIFY, always
 *   ABSTAIN      NONE / LOW                                       -> conversation, no read
 *
 * ⛔ AMBIGUOUS IS A PROPERTY OF THE QUESTION, NOT OF THE RUN. It is set from the corpus
 * contract, so a lucky HIGH cannot promote it. 「有咩貨唔夠要入返？」 answers equally as 「what
 * is low」 and 「what to reorder」; no confidence score makes that sentence unambiguous, and a
 * model that sounds certain about it is asserting one reading and hiding the other.
 *
 * ⛔ AND AMBIGUITY IS NOT A WRONG CONNECTOR. inventory and order_planning both resolve to
 * aroma_system, so picking the wrong one of those reads the wrong TABLE, not the wrong system.
 * Intent correctness and connector correctness are counted separately, because conflating them
 * would let a real table error hide behind a clean connector number.
 */

const OUTCOME = Object.freeze({
  STABLE_HIGH: 'STABLE_HIGH',
  UNSTABLE: 'UNSTABLE',
  AMBIGUOUS: 'AMBIGUOUS',
  ABSTAIN: 'ABSTAIN'
})

/**
 * @param {Array<{candidate:string, confidence:string}>} passes  one entry per qualification pass
 * @param {{expectIntent:string|null, ambiguous:boolean}} row
 */
function outcomeFor (passes, row) {
  const list = Array.isArray(passes) ? passes : []
  if (list.length === 0) return OUTCOME.ABSTAIN
  // The question's own property wins over anything the runs produced.
  if (row && row.ambiguous === true) return OUTCOME.AMBIGUOUS
  const anyHigh = list.some((p) => p && p.confidence === 'HIGH' && p.candidate !== 'NONE')
  if (!anyHigh) return OUTCOME.ABSTAIN
  const allHigh = list.every((p) => p && p.confidence === 'HIGH' && p.candidate !== 'NONE')
  const agree = list.every((p) => p && p.candidate === list[0].candidate)
  if (!allHigh || !agree) return OUTCOME.UNSTABLE
  return OUTCOME.STABLE_HIGH
}

/** Only a STABLE_HIGH that matched the expected intent may ever be read automatically. */
function isAutoReadEligible (outcome, passes, row) {
  if (outcome !== OUTCOME.STABLE_HIGH) return false
  if (!row || row.ambiguous === true) return false
  return Array.isArray(passes) && passes.length > 0 && passes.every((p) => p && p.candidate === row.expectIntent)
}

module.exports = { OUTCOME, outcomeFor, isAutoReadEligible }
