'use strict'

/**
 * workRequestRoute.js — THE DETERMINISTIC ENTRANCE, server side.
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 * The approval card was reachable only if the model classified the turn as `commit` AND
 * returned exactly one task. Measured against the real model on 2026-08-05:
 *
 *   「幫我改 docs/canary/agent-canary.md，第二行改成 line 3」  → mode='ask', no card
 *   「幫我把 docs/canary/agent-canary.md 第二行改成 line 3」   → a proposal and a button
 *
 * One character apart. The Owner: 「I am not going to learn a magic sentence.」
 *
 * ── NOTHING IS CREATED UNTIL THE OWNER PRESSES THE BUTTON ───────────────────
 * The chat turn produces only an OFFER (see workRequestOffer.js) — one sentence and a
 * button. THIS function is what the button calls, and it is the first thing in the chain
 * that creates anything. So a false trigger costs one glance: no Task, no Proposal, no
 * sealed order, no approvalId, nothing to clean up afterwards.
 *
 * ── THE BROWSER SUPPLIES THE MESSAGE, NEVER THE TARGET ──────────────────────
 * file and intent are re-derived HERE from the Owner's own words. A body-supplied file is
 * ignored, not honoured — otherwise this becomes a way to aim a work order at any path.
 * Same discipline as the work-order surface, which loads the sealed order by id rather than
 * trusting the request.
 *
 * ── ONE BEHAVIOUR, TWO ENTRANCES ────────────────────────────────────────────
 * WHAT the request is comes from inferWorkRequest — the same function the model path uses.
 * Only the decision THAT a request exists differs. Everything downstream (proposeWorkOrder,
 * the seal, the hash, forbiddenActions, the TTL, the typed EXECUTE) is untouched and shared.
 *
 * ── PROVENANCE ──────────────────────────────────────────────────────────────
 * Owner requirement: 「six months from now I want to be able to ask how a proposal came to
 * exist and get an answer without archaeology.」 Two places, both durable, no new fields:
 *
 *   the decision's provenance.source = 'deterministic_entry'
 *   the approval event's entry_point = 'deterministic_entry'
 *
 * A model-created proposal carries 'homepage-intake' and 'owner_local' respectively.
 */

const { offerFor } = require('./workRequestOffer')
const { persistIntake, recordApprovalEvent } = require('../store/store')

const ENTRY_POINT = 'deterministic_entry'

/**
 * @param {{ message: string }} input        the Owner's own words. file/intent are IGNORED.
 * @param {{ promoteToProposal?: function }} deps
 * @returns {Promise<{ok:true, proposalId, goal, file, intent}|{ok:false, reason}>}
 */
async function createWorkRequest (input = {}, deps = {}) {
  const message = typeof input.message === 'string' ? input.message : ''

  // 1. RE-DERIVED, never read from the body. Both checks in workRequestOffer apply, including
  //    the deliberately-doubled negation test.
  const offer = offerFor({ message, hasProposal: false })
  if (!offer) return { ok: false, reason: 'not_a_work_request' }

  if (typeof deps.promoteToProposal !== 'function') {
    // FAIL VISIBLY. A missing seam used to mean an empty proposals array and a turn that
    // looked merely unproductive.
    return { ok: false, reason: 'promote_seam_not_wired' }
  }

  // 2. The Task the proposal will be promoted from. The goal is the Owner's own sentence,
  //    not a paraphrase — it is what he will read on the card.
  const goal = offer.intent
  let persisted
  try {
    persisted = persistIntake({
      understanding: goal,
      decision: { statement: goal, rationale: '由你的一句話直接開出，未經模型判斷。' },
      tasks: [{ title: goal, note: offer.file }],
      // PROVENANCE, half of it. The other half is the approval event below.
      provenance: { proposed_by: 'louie', source: ENTRY_POINT }
    })
  } catch (err) {
    return { ok: false, reason: 'persist_failed' }
  }
  const taskId = persisted && persisted.tasks && persisted.tasks[0] && persisted.tasks[0].id
  if (!taskId) return { ok: false, reason: 'persist_failed' }

  // 3. The SAME promotion seam the model path uses.
  let promoted
  try {
    promoted = await deps.promoteToProposal(taskId)
  } catch (err) {
    return { ok: false, reason: 'promote_error' }
  }
  if (!promoted || !promoted.ok || !promoted.proposal || !promoted.proposal.id) {
    // NO INVENTED ID. The Owner sees that nothing was created, not a proposal that is not there.
    return { ok: false, reason: 'promote_rejected' }
  }

  // 4. The durable trail, so the entry point is answerable later. Wrapped: an audit failure
  //    must not destroy a proposal the Owner is about to be shown.
  try {
    recordApprovalEvent({
      type: 'proposed',
      proposalId: promoted.proposal.id,
      actor: 'louie',
      reason: 'deterministic_request',
      entryPoint: ENTRY_POINT
    })
  } catch (_) {}

  return { ok: true, proposalId: promoted.proposal.id, goal, file: offer.file, intent: offer.intent }
}

module.exports = { createWorkRequest, ENTRY_POINT }
