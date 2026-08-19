'use strict'

/**
 * workRequestOffer.js — THE DETERMINISTIC ENTRANCE to a Work Order.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * The approval card was reachable only through the model: it had to classify the turn as
 * `commit` AND return exactly one task. Measured against the real model on 2026-08-05:
 *
 *   「幫我改 docs/canary/agent-canary.md，第二行改成 line 3」  →  mode='ask'
 *   「幫我把 Timeline 的輪詢在終止狀態後停掉」 (the prompt's OWN commit example)
 *                                              →  mode='commit', tasks: []
 *
 * Two different failures, one unreachable approval surface. The same prompt already says
 * 「tasks 至少 1」 and is already not being followed, so instructing it harder is the lever
 * that does not move. Owner ruling: route it deterministically, the way UTILITY is routed —
 * if he names a file and a change, that is not a judgement call.
 *
 * ── ONE BEHAVIOUR, TWO ENTRANCES ────────────────────────────────────────────
 * This decides only THAT there is a request. WHAT the request is comes from
 * `inferWorkRequest`, the same function the existing path uses — never a second reading, or
 * the same sentence could produce two different Work Orders depending on how it arrived.
 *
 * NOTHING DOWNSTREAM CHANGES. proposeWorkOrder, canonicalWorkOrder, hashWorkOrder,
 * forbiddenActions, the one-file rule, the protected-path list, the approval TTL, the typed
 * EXECUTE and the four-flag authorization are all untouched and shared. The entrance is
 * recorded in `source` so the Owner can see which one was used.
 *
 * ── AN OFFER, NOT A CARD ────────────────────────────────────────────────────
 * Owner condition, necessary and not optional: this returns the makings of ONE SENTENCE AND
 * A BUTTON. It never returns a rendered card and never seals anything. A filled-in card
 * invites a reflex approval, and the Owner has said plainly that he had been approving from
 * memory rather than from what was on the screen.
 *
 * So a false trigger costs one glance: nothing is sealed, no hash exists, no approvalId is
 * minted, nothing is persisted and the runner is not touched.
 *
 * ── WIRED 2026-08-05 ────────────────────────────────────────────────────────
 * Attached to the chat envelope by demoRouter.js, and re-derived server-side by
 * routes/workRequestRoute.js when the Owner presses the button. An earlier revert of this
 * wiring stands corrected: a Work Order cannot be sealed without a pending Proposal — that
 * boundary is real and untouched — so the Owner approved creating one deterministically,
 * and ONLY on the press.
 *
 * ── DELIBERATELY SEPARATE: NEGATION IS CHECKED TWICE ────────────────────────
 * Owner ruling, 2026-08-05. This codebase's rule is ONE CONCEPT, ONE IMPLEMENTATION, and
 * negation breaks it on purpose. IF YOU ARE HERE TO CONSOLIDATE THESE TWO, READ THIS FIRST.
 *
 * requestShape.NEGATED is a flat alternation over the whole sentence.
 * refusesChange below is proximity-based: a refusal marker BEFORE the verb it governs.
 * Different construction on purpose — two copies of one regex would fail together.
 * EITHER refusing stops the offer.
 *
 * The Owner's reasoning, recorded because it is what justifies the exception: every other
 * misread costs him an unwanted offer, but asking 「要唔要」 after he said 「唔好」 is
 * offensive regardless of how inert the button is.
 *
 * It also compensates for a measured gap: the corpus has FIVE real samples of him asking
 * for a change and ZERO of him refusing one, so the negation branch is tested entirely
 * against phrasings I wrote (requestShapeCorpus.test.js states this). Two independent
 * implementations are the answer to that, not more sentences of my own invention.
 */

const { inferWorkRequest, CHANGE_VERB } = require('../agent/requestInference')
const { isChangeRequest } = require('../agent/requestShape')

/**
 * ⛔ THREE OUTCOMES, CLOSED — because two of them used to look identical from outside.
 *
 * 「唔好改 docs/notes.md」 and 「幫我改個訂貨頁」 both returned `offer: null`, and the caller had
 * no way to tell 「he is not asking for work」 from 「he IS asking, and one thing is missing」.
 * The second deserves a question; the first must never get one. A `reason` string could have
 * carried that, but reason is a LOG value — one new enum member added for a logging need and
 * the branch silently changes meaning. The state is its own field.
 *
 * INCOMPLETE IS NOT AN ENTITLEMENT. It authorises nothing, creates nothing and reaches no
 * store: it is permission to ask one sentence, and that is all.
 */
const STATE = Object.freeze({
  NOT_A_WORK_REQUEST: 'not_a_work_request',
  INCOMPLETE: 'work_request_incomplete',
  COMPLETE: 'work_request_complete'
})

/**
 * THE SECOND NEGATION CHECK. Independent by construction — see the header.
 *
 * Rather than one alternation over the sentence, this asks a different question: does a
 * REFUSAL MARKER sit immediately before the change verb it governs? That catches markers
 * the first list does not carry (千祈唔好, 咪住) without either file knowing the other's
 * vocabulary.
 *
 * 唔該 IS NOT A REFUSAL. It opens with the same character as 唔好 and is the most ordinary
 * politeness the Owner types; reading it as a refusal would reject his plainest requests.
 * It is excluded explicitly rather than by hoping the marker list never happens to match it.
 */
const POLITENESS = /^(唔該|請|麻煩)/
const REFUSAL_MARK = /(唔好|唔使|唔准|唔制|咪住|咪|千祈|暫時|先唔|唔想|唔要|不要|不用|不准|別|勿|毋須)/g
const NEAR = 6 // a refusal governs what FOLLOWS it, within a short window

function refusesChange (message) {
  const s = typeof message === 'string' ? message.trim() : ''
  if (!s) return false
  for (const m of s.matchAll(REFUSAL_MARK)) {
    const at = m.index
    if (at === 0 && POLITENESS.test(s)) continue
    if (POLITENESS.test(s.slice(at, at + 2))) continue
    const after = s.slice(at + m[0].length, at + m[0].length + NEAR)
    if (CHANGE_VERB.test(after)) return true
  }
  return false
}

/**
 * @param {{ message: string, conversation?: string|string[], hasProposal?: boolean }} input
 * @returns {{ file: string, intent: string, source: 'deterministic' }|null}
 *          null whenever anything at all is uncertain — see the asymmetry note in
 *          requestShape.js: a missed offer costs exactly what today costs.
 */
/**
 * THE DECISION, WITH ITS REASON. Firing and declining are both recorded.
 *
 * The first version returned an offer or null and logged nothing either way. It fired
 * correctly on the Owner's message, reached the browser, and was discarded by a dispatch
 * ordering defect — and because nothing was traced, finding that took reasoning about the
 * code rather than reading a line. The classifier's verdict was in the log for that exact
 * turn; the offer's was not.
 *
 * That is the shape this project has removed five times. Reintroducing it in new code, by
 * the same hand that removed it, is why every branch below now names itself.
 *
 * The reason is a SHORT ENUM. It travels to the outcome log, which can never carry content.
 *
 * @returns {{ offer: object|null, reason: string|null }}
 */
function explainOffer (input = {}) {
  // The model path owns the turn when it worked. Not two offers for one sentence.
  if (input.hasProposal === true) return { offer: null, reason: 'model_path_owns_turn', state: STATE.NOT_A_WORK_REQUEST }

  const message = typeof input.message === 'string' ? input.message : ''

  // 1. IS IT A REQUEST? The judgement the classifier used to make silently.
  const shape = isChangeRequest(message)
  if (!shape.ok) return { offer: null, reason: shape.reason, state: STATE.NOT_A_WORK_REQUEST }
  // 1b. AND AGAIN, INDEPENDENTLY, FOR NEGATION ONLY. See the header for why this one
  //     concept deliberately has two implementations.
  if (refusesChange(message)) return { offer: null, reason: 'negated_proximity', state: STATE.NOT_A_WORK_REQUEST }

  // 2. WHAT IS THE REQUEST? The existing reader, with the CONVERSATION DELIBERATELY EMPTY.
  //    The existing path may fall back to a path named earlier in the conversation, because
  //    by then the model has already decided this turn is an action. Here nothing has
  //    decided that, so the sentence in front of us must name its own file — a path
  //    mentioned three turns ago is not what he just asked to change.
  const read = inferWorkRequest({ message, conversation: '' })

  // 3. NOTHING LEFT TO ASK. If inferWorkRequest still has a question, that question belongs
  //    to the conversational path; an offer is for a request that is already complete.
  //    A protected path lands here too — it leaves a question, by design.
  //
  //    ⛔ THE QUESTION USED TO DIE HERE, AND THAT WAS THE WHOLE DEFECT. `inferWorkRequest`
  //    had already composed the one sentence to ask — 「你想改哪個檔？」 — and this line threw
  //    it away and returned a bare `incomplete`, so a perfectly clear request with a missing
  //    path fell back into ordinary chat and looked like it had not been understood at all.
  //    It is now carried out, and it is STILL not an offer: nothing here is executable.
  if (read.question !== null || !read.file || !read.intent) {
    return {
      offer: null,
      reason: 'incomplete',
      state: STATE.INCOMPLETE,
      clarification: {
        question: read.question,
        missing: read.missing,
        candidates: read.candidates,
        // Present when the Owner named a path that can never be allowlisted. The question
        // already says so; carrying the flag lets the caller refuse to render an affordance
        // rather than infer that from prose.
        forbidden: read.forbidden
      }
    }
  }

  return { offer: { file: read.file, intent: read.intent, source: 'deterministic' }, state: STATE.COMPLETE, reason: null }
}

/** The thin form the callers already use. */
function offerFor (input = {}) {
  return explainOffer(input).offer
}

module.exports = { offerFor, explainOffer, refusesChange, WORK_REQUEST_STATE: STATE }
