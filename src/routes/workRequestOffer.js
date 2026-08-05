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
 * ── NOT WIRED YET (2026-08-05). SEE requestShape.js FOR WHY. ────────────────
 * The envelope wiring was written and then REVERTED in the same session: a Work Order
 * cannot be sealed without a pending Proposal, so an offer button would have led to a 404.
 * An affordance that leads nowhere is worse than no affordance, and a field nothing
 * consumes is the dormant-default pattern the Owner has already ruled against once.
 */

const { inferWorkRequest } = require('../agent/requestInference')
const { isChangeRequest } = require('../agent/requestShape')

/**
 * @param {{ message: string, conversation?: string|string[], hasProposal?: boolean }} input
 * @returns {{ file: string, intent: string, source: 'deterministic' }|null}
 *          null whenever anything at all is uncertain — see the asymmetry note in
 *          requestShape.js: a missed offer costs exactly what today costs.
 */
function offerFor (input = {}) {
  // The model path owns the turn when it worked. Not two offers for one sentence.
  if (input.hasProposal === true) return null

  const message = typeof input.message === 'string' ? input.message : ''

  // 1. IS IT A REQUEST? The judgement the classifier used to make silently.
  if (!isChangeRequest(message).ok) return null

  // 2. WHAT IS THE REQUEST? The existing reader, with the CONVERSATION DELIBERATELY EMPTY.
  //    The existing path may fall back to a path named earlier in the conversation, because
  //    by then the model has already decided this turn is an action. Here nothing has
  //    decided that, so the sentence in front of us must name its own file — a path
  //    mentioned three turns ago is not what he just asked to change.
  const read = inferWorkRequest({ message, conversation: '' })

  // 3. NOTHING LEFT TO ASK. If inferWorkRequest still has a question, that question belongs
  //    to the conversational path; an offer is for a request that is already complete.
  if (read.question !== null) return null
  if (!read.file || !read.intent) return null

  return { file: read.file, intent: read.intent, source: 'deterministic' }
}

module.exports = { offerFor }
