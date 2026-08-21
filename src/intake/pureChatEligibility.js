'use strict'

/**
 * pureChatEligibility.js — L2-A. IS THIS TURN PROVEN TO BE A BARE SOCIAL TURN?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ IT IS AN OBSERVER. It is not a router, not a source selector, not an intent
 * authority, not a work-request authority, not an approval authority, not an
 * execution authority. In L2-A nothing downstream reads its answer at all: it exists
 * so that a future tranche can be argued from real turns rather than from a guess.
 *
 * ⛔ WHY IT EXISTS. Measured on requestId 8d82bdd2-d92a-4061-aadd-638d35938582
 * (2026-08-21 12:27): 「你好」 cost 7,613 ms server-side. The reply itself was 1,693 ms.
 * The goal decomposer spent 2,395 ms to return a plan with zero facts, and the final
 * verifier spent 3,448 ms to conclude that no read was required — 5,843 ms, 76.8% of
 * the turn, on two model calls that had nothing to do with answering. Context
 * construction, the thing everyone suspects, was 32 ms.
 *
 * ⛔ POSITIVE EVIDENCE ONLY, AND THE WHOLE MESSAGE. A turn becomes eligible because it
 * IS a bare greeting, never because it lacks a dangerous word. Absence of a known bad
 * word is not evidence of safety — deny lists grow forever and are wrong in the gap
 * between two edits. So the match is anchored to the ENTIRE message: 「你好」 is
 * eligible and 「你好，幫我改 README.md」 is not, because the second one is not a
 * greeting, it is a request wearing one.
 *
 * ⛔ CONVERSATION IS A PRECONDITION, NEVER A REASON. turnRouter documents CONVERSATION
 * as the FALLBACK route — ambiguous turns and unmatched questions land there. Treating
 * it as proof of small talk would make every question the router failed to classify
 * eligible. It is necessary and it is not sufficient.
 *
 * ⛔ PURE. No I/O, no model, no clock, no env, no connector, no conversation history.
 * The same message and route always give the same answer.
 *
 * ⛔ FAIL-CLOSED EVERYWHERE. Unknown, ambiguous, compound, malformed, thrown — all
 * false. Nothing in this file can fail open.
 * ══════════════════════════════════════════════════════════════════════════════
 */

/** Closed reasons. Exactly one is returned; nothing free-form is ever emitted. */
const REASON = Object.freeze({
  GREETING: 'greeting',
  THANKS: 'thanks',
  FAREWELL: 'farewell',
  NO_ROUTE_DECISION: 'no_route_decision',
  NOT_CONVERSATION_ROUTE: 'not_conversation_route',
  NO_POSITIVE_SOCIAL_MATCH: 'no_positive_social_match',
  MALFORMED_INPUT: 'malformed_input'
})

/** The single route that may even be considered. Necessary, never sufficient. */
const REQUIRED_ROUTE = 'CONVERSATION'

/**
 * ⛔ LONGER THAN ANY BARE SOCIAL PHRASE MEANS IT IS NOT ONE. A structural guard, not a
 * content check: the longest entry below is 14 characters, so anything past this cap
 * is refused before a single comparison runs. It costs nothing and it removes the
 * whole class of 「greeting + a paragraph」.
 */
const MAX_SOCIAL_CHARS = 24

/**
 * The whole vocabulary, deliberately small. Every entry must be safe as a COMPLETE
 * message on its own — that is the only test for adding one. Growing this list to
 * improve coverage is how a narrow classifier stops being narrow.
 *
 * 唔該 is included under THANKS only because the whole-message rule makes it safe:
 * as an entire message it is 「thank you」, while its other Cantonese sense (「please…」)
 * only ever appears as the PREFIX of a request, which can never match here.
 */
const GREETINGS = Object.freeze([
  '你好', '您好', '哈囉', '早晨', '早安', '午安',
  'hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening'
])
const THANKS = Object.freeze([
  '多謝', '唔該', '感謝', 'thanks', 'thank you', 'thx'
])
const FAREWELLS = Object.freeze([
  '拜拜', '再見', '晚安', 'bye', 'goodbye', 'good night'
])

const CLASSES = Object.freeze([
  { reason: REASON.GREETING, words: GREETINGS },
  { reason: REASON.THANKS, words: THANKS },
  { reason: REASON.FAREWELL, words: FAREWELLS }
])

/**
 * ⛔ EDGE PUNCTUATION ONLY — NEVER INTERNAL. Stripping internal punctuation would turn
 * 「你好，幫我改 README.md」 into one run of characters and invite a substring match.
 * Only the decoration around a complete phrase is removed, so 「你好！」 is still a
 * greeting and 「你好，幫我改…」 is still a request.
 */
const EDGE_PUNCT = '\\s！!。．.，,、；;：:？?~～… 　'
const LEADING = new RegExp('^[' + EDGE_PUNCT + ']+')
const TRAILING = new RegExp('[' + EDGE_PUNCT + ']+$')

function normalise (message) {
  return String(message)
    .replace(LEADING, '')
    .replace(TRAILING, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/**
 * @param {string} message      the Owner's own words, this turn only
 * @param {object|null} routeDecision  the ALREADY-COMPUTED deterministic routing decision
 * @returns {{eligible: boolean, reason: string}}  closed shape; no prose, no confidence
 */
function classifyPureChatEligibility (message, routeDecision) {
  try {
    if (typeof message !== 'string' || message === '') {
      return { eligible: false, reason: REASON.MALFORMED_INPUT }
    }
    // Route precondition FIRST, so a bare greeting on a non-conversation route is
    // still refused. It can only ever subtract.
    if (!routeDecision || typeof routeDecision !== 'object') {
      return { eligible: false, reason: REASON.NO_ROUTE_DECISION }
    }
    if (routeDecision.route !== REQUIRED_ROUTE) {
      return { eligible: false, reason: REASON.NOT_CONVERSATION_ROUTE }
    }

    const text = normalise(message)
    if (text === '' || text.length > MAX_SOCIAL_CHARS) {
      return { eligible: false, reason: REASON.NO_POSITIVE_SOCIAL_MATCH }
    }

    // ⛔ EXACT, WHOLE-MESSAGE EQUALITY. Not startsWith, not includes, not a regex with
    //    an unanchored side. This one line is the difference between 「你好」 and
    //    「你好，幫我部署」, and a test exists to fail if it is ever loosened.
    for (const cls of CLASSES) {
      if (cls.words.includes(text)) return { eligible: true, reason: cls.reason }
    }
    return { eligible: false, reason: REASON.NO_POSITIVE_SOCIAL_MATCH }
  } catch (_) {
    // Nothing here may fail open.
    return { eligible: false, reason: REASON.MALFORMED_INPUT }
  }
}

module.exports = {
  classifyPureChatEligibility,
  REASON,
  REQUIRED_ROUTE,
  MAX_SOCIAL_CHARS,
  GREETINGS,
  THANKS,
  FAREWELLS
}
