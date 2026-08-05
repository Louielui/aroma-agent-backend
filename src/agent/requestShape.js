'use strict'

/**
 * requestShape.js — IS THIS SENTENCE A REQUEST TO CHANGE A FILE?
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * `inferWorkRequest` reads WHAT the Owner named: a file and an instruction. It has never
 * judged WHETHER the sentence is a request, because it only ever ran after the model had
 * already classified the turn as an action. That classification was doing this job silently.
 *
 * The moment a deterministic entry point is opened — so the work-order affordance does not
 * depend on the model classifying correctly — that judgement has no owner. Measured, before
 * this file existed, every one of these fired:
 *
 *   「我啱啱改咗 docs/notes.md 第三行」   a report of a change already made
 *   「Codex 改咗 docs/notes.md 個標題」   somebody else's change
 *   「如果改 docs/notes.md 第三行會點？」 a hypothetical
 *   「要唔要改 docs/notes.md 第三行？」   a question
 *   「唔好改 docs/notes.md」              a REFUSAL, read as intent 「唔好改」
 *
 * ── THE ASYMMETRY THAT MAKES A VOCABULARY ACCEPTABLE HERE ────────────────────
 * This is a fourth vocabulary in a codebase whose rule is one vocabulary per concept, and
 * it is a genuinely different concept from the other three: laneRouter's is VERBS,
 * INTENTS' is ENTITIES, utilityAnswer's is UNITS AND TIME. This one is MOOD.
 *
 * More importantly, its failure directions are not symmetric:
 *
 *   A MISSED request → falls through to the model path. Costs exactly what today costs.
 *   A FALSE request  → a visible wrong offer to the Owner.
 *
 * So it refuses on any doubt. A hole in this list degrades to the status quo; a hole in the
 * other three did not, which is why they hurt.
 *
 * ── WHAT IT DOES NOT DO ──────────────────────────────────────────────────────
 * It does not detect a THIRD-PARTY subject as such. 「Codex 改咗…」 is caught because it is
 * perfective, not because 'Codex' was recognised. A third-party sentence in the present
 * tense — 「Codex 改 docs/notes.md 個標題」 — would pass this test and be caught, if at all,
 * downstream. Written down rather than left to be discovered.
 *
 * PURE: no I/O, no clock, no randomness, no model call.
 *
 * ── NOT WIRED YET (2026-08-05) ──────────────────────────────────────────────
 * Nothing in production calls this. Building the deterministic entrance hit a
 * governance boundary discovered mid-build: /api/v1/owner/work-orders BINDS every Work
 * Order to a real, still-pending Proposal, and the EXECUTE path drives
 * confirmProposalAction THROUGH that proposalId. A deterministic entrance therefore
 * cannot reach a card without also creating a Proposal deterministically.
 *
 * That is an Owner decision, not mine, so this and workRequestOffer.js are committed as
 * TESTED GROUNDWORK and left uncalled rather than wired to a path that would 404. If the
 * Owner rules against the approach, delete both — do not leave them dormant.
 */

/** Why a sentence was refused. Short enums — they reach the Owner only as behaviour. */
const REFUSAL = Object.freeze({
  EMPTY: 'empty',
  NEGATED: 'negated',
  REPORTED: 'reported',
  HYPOTHETICAL: 'hypothetical',
  QUESTION: 'question',
  NO_VERB: 'no_verb'
})

/** The change verbs. Borrowed from requestInference so the two can never disagree. */
const { CHANGE_VERB } = require('./requestInference')

/**
 * NEGATION IS CHECKED FIRST, on purpose. 「唔好改 docs/notes.md」 contains 改, so any
 * verb-led test passes it — and offering to do the thing the Owner just refused is the
 * worst failure in this file.
 */
const NEGATED = /(唔好|唔使|唔准|唔想|不要|不用|不准|毋須|別|勿|先別|暫時唔好|don'?t|do not)/i

/**
 * PERFECTIVE — the change already happened, so it is a report and not an instruction.
 * The aspect marker must sit DIRECTLY on the verb: 「改咗」, 「更新了」, 「改過」. A bare 咗
 * elsewhere in the sentence says nothing about the verb.
 */
const REPORTED = new RegExp('(' + CHANGE_VERB.source + ')\\s*(咗|了|過)', 'i')

const HYPOTHETICAL = /(如果|假如|假設|萬一|要係|若果|if\s)/i

/**
 * A QUESTION, and only where a question actually lives: a question mark anywhere, or an
 * interrogative particle at the END of the sentence.
 *
 * NOT anywhere in the sentence — 「你可唔可以幫我改 X」 is a polite request whose 可唔可以 is
 * a leading address, which requestInference already strips. Refusing on that would reject
 * the most natural way the Owner asks for something.
 */
const QUESTION = /[？?]/
const TRAILING_PARTICLE = /(嗎|呢|咩|吖|嘅|好唔好|得唔得|要唔要|會唔會|係咪|定係)\s*[。.!！]?\s*$/

/**
 * @param {string} message the Owner's own words, and nothing else
 * @returns {{ ok: boolean, reason: string|null }}
 */
function isChangeRequest (message) {
  const s = typeof message === 'string' ? message.trim() : ''
  if (!s) return { ok: false, reason: REFUSAL.EMPTY }

  // Order matters: each of these can co-occur with a change verb, and the verb is what a
  // naive test would key on.
  if (NEGATED.test(s)) return { ok: false, reason: REFUSAL.NEGATED }
  if (REPORTED.test(s)) return { ok: false, reason: REFUSAL.REPORTED }
  if (HYPOTHETICAL.test(s)) return { ok: false, reason: REFUSAL.HYPOTHETICAL }
  if (QUESTION.test(s) || TRAILING_PARTICLE.test(s)) return { ok: false, reason: REFUSAL.QUESTION }
  if (!CHANGE_VERB.test(s)) return { ok: false, reason: REFUSAL.NO_VERB }

  return { ok: true, reason: null }
}

module.exports = { isChangeRequest, REFUSAL, NEGATED, REPORTED, HYPOTHETICAL }
