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

const { offerFor, explainOffer, WORK_REQUEST_STATE } = require('./workRequestOffer')
const { repositoryFileAvailable } = require('../agent/workOrderProducer') // the SAME primitive Work Order sealing uses
const { identifyProject, IDENTITY_REFUSED } = require('../projects/repositoryIdentity')
const { isForbiddenFile } = require('../agent/workOrder') // the ONE protected-path list; never re-implemented
const { t } = require('../i18n/t')
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

  /**
   * ⛔ NOTHING PERSISTENT FOR A FILE THIS SERVER CANNOT WORK ON — AND THE CHECK IS HERE
   * BECAUSE OF WHAT COMES NEXT.
   *
   * `inferWorkRequest` validates the SHAPE of a path, never its existence. So a perfectly
   * well-formed path that is not in this repository — a page from the other Aroma repo, a
   * typo, a file that has since moved — used to produce a real Task, a real Proposal and a
   * real 「proposed」 audit event, and was refused only much later at Work Order sealing. The
   * Owner pressed the button, saw a proposal appear, and learned two steps afterwards that the
   * file was never there; the store kept the record either way.
   *
   * ⛔ AFTER the re-derivation and BEFORE persistIntake, deliberately. Earlier than this would
   * mean putting filesystem I/O into the chat-time offer, which runs on ordinary turns and
   * should stay pure — and the harmless offer button was never the problem. Later than this
   * would mean the artifact already exists when the refusal happens, which is the whole defect.
   *
   * ⛔ THE ROOT IS SERVER-OWNED. `currentRepoFileAvailable` asks about THIS repository and
   * takes no root from anywhere; a body field, a model or a registry cannot redirect it. That
   * also means it is honest about scope: a real Aroma System page is 「not available」 HERE, and
   * making it available is a separate, later, explicitly-approved piece of work.
   *
   * ⛔ IT DOES NOT REPLACE SEAL-TIME VALIDATION. Work Order L3 still reads the file when the
   * order is sealed, because a file can vanish between the two moments.
   */
  /**
   * ⛔ RB1 — WHICH REPOSITORY, DECIDED BEFORE THE FILESYSTEM IS ASKED ANYTHING.
   *
   * The check below used to be existence alone, and existence is not identity. Measured
   * 2026-08-20: README.md, package.json, CLAUDE.md, docs/HOUSE-RULES.md and .gitignore all
   * exist in BOTH registered repositories, so 「改 aroma-system 個 README.md」 answered YES
   * about the backend's own file and a Proposal was created for the wrong repository.
   *
   * Identity is server-derived from the Owner's own words (and, on the resolved path, from
   * the server-held candidate). It is decided FIRST, so a known non-backend identity is
   * refused while it is still an identity — never given the chance to become a true
   * statement about a same-named backend file.
   */
  const identified = identifyProject({ message })
  if (!identified.ok) return { ok: false, reason: identified.reason }

  const availability = repositoryFileAvailable(identified.identity, offer.file)
  if (!availability.ok) {
    // A closed reason. The refusal never carries the path's absolute form or a machine root.
    return { ok: false, reason: availability.reason === IDENTITY_REFUSED.NOT_EXECUTABLE ? IDENTITY_REFUSED.NOT_EXECUTABLE : 'file_not_available' }
  }

  return promoteRequest({ file: offer.file, intent: offer.intent, identity: identified.identity }, deps)
}

/**
 * ⛔ THE PERSISTENCE TAIL, WRITTEN ONCE.
 *
 * Two entrances now reach a Proposal: the Owner naming a file in one sentence, and the Owner
 * choosing between candidates the server offered him. They differ ONLY in how the target was
 * established — everything after that is the same Task, the same promotion seam, the same
 * audit event, and it must stay that way. A second copy of this would be a second place to
 * forget the provenance, the failure handling, or the audit line.
 *
 * @param {{file:string, intent:string}} target  server-established; never from a request body
 */
async function promoteRequest (target, deps = {}) {
  if (typeof deps.promoteToProposal !== 'function') {
    // FAIL VISIBLY. A missing seam used to mean an empty proposals array and a turn that
    // looked merely unproductive.
    return { ok: false, reason: 'promote_seam_not_wired' }
  }

  // The Task the proposal will be promoted from. The goal is the Owner's own sentence,
  // not a paraphrase — it is what he will read on the card.
  const goal = target.intent
  let persisted
  try {
    persisted = persistIntake({
      understanding: goal,
      decision: { statement: goal, rationale: t('wr.rationale') },
      tasks: [{ title: goal, note: target.file }],
      // PROVENANCE, half of it. The other half is the approval event below.
      provenance: { proposed_by: 'louie', source: ENTRY_POINT }
    })
  } catch (err) {
    return { ok: false, reason: 'persist_failed' }
  }
  const taskId = persisted && persisted.tasks && persisted.tasks[0] && persisted.tasks[0].id
  if (!taskId) return { ok: false, reason: 'persist_failed' }

  // The SAME promotion seam the model path uses.
  //
  // ⛔ RB1 — THE IDENTITY TRAVELS AS A STRUCTURED ARGUMENT, NOT INSIDE THE TEXT. It is not
  //    put in the title, the note, the goal or the provenance: a repository identity parsed
  //    back out of prose is a repository identity that can be spoofed by prose.
  let promoted
  try {
    promoted = await deps.promoteToProposal(taskId, { repositoryIdentity: target.identity })
  } catch (err) {
    return { ok: false, reason: 'promote_error' }
  }
  if (!promoted || !promoted.ok || !promoted.proposal || !promoted.proposal.id) {
    // NO INVENTED ID. The Owner sees that nothing was created, not a proposal that is not there.
    return { ok: false, reason: 'promote_rejected' }
  }

  // The durable trail, so the entry point is answerable later. Wrapped: an audit failure
  // must not destroy a proposal the Owner is about to be shown.
  try {
    recordApprovalEvent({
      type: 'proposed',
      proposalId: promoted.proposal.id,
      actor: 'louie',
      reason: 'deterministic_request',
      entryPoint: ENTRY_POINT
    })
  } catch (_) {}

  return { ok: true, proposalId: promoted.proposal.id, goal, file: target.file, intent: target.intent }
}

/**
 * ⛔ THE OWNER ALREADY CHOSE — BUT EVERY GUARD RUNS AGAIN ANYWAY.
 *
 * This is reached only after the server matched a selection ticket to a candidate IT stored,
 * for the Owner's own session and conversation. Even so, nothing is taken on trust: the
 * ORIGINAL message is re-read through the same shape and doubled-negation guards, the chosen
 * file is re-checked against the protected-path list, and its availability in this repository
 * is re-checked — because time passed between the question and the answer, and a file can
 * disappear inside it.
 *
 * ⛔ THE GOAL IS HIS SENTENCE, NOT HIS CHOICE. `intent` comes from what he originally asked
 * for, stored server-side at the moment the question was posed. A selection supplies WHICH
 * file, never WHAT to do — otherwise the Work Order's goal would end up being a file name.
 *
 * ⛔ AND IT IS NOT REACHABLE FROM THE BROWSER. This takes an already-selected file; the public
 * route still accepts a message and re-derives its own target, so a body field remains
 * incapable of aiming anything.
 *
 * @param {{originalOwnerMessage:string, originalIntent:string, file:string}} input
 */
async function createResolvedWorkRequest (input = {}, deps = {}) {
  const message = typeof input.originalOwnerMessage === 'string' ? input.originalOwnerMessage : ''
  const file = typeof input.file === 'string' ? input.file : ''
  const intent = typeof input.originalIntent === 'string' ? input.originalIntent : ''
  if (file === '' || intent === '') return { ok: false, reason: 'not_a_work_request' }

  // 1. The original request must STILL be a request — negation, reported, hypothetical and
  //    ordinary questions are re-judged by the same function the public entrance uses.
  const decision = explainOffer({ message, hasProposal: false })
  if (decision.state === WORK_REQUEST_STATE.NOT_A_WORK_REQUEST) return { ok: false, reason: 'not_a_work_request' }

  // 2. The chosen file is re-checked against the hard boundary, never assumed safe because it
  //    came from a candidate list.
  if (isForbiddenFile(file)) return { ok: false, reason: 'not_a_work_request' }

  // 3. And b2b0's gate applies identically here: nothing persistent for a file this server
  //    cannot work on. It is re-checked because the file may have gone since the question.
  //
  // ⛔ RB1 — THE IDENTITY COMES FROM THE SERVER-HELD CANDIDATE, NOT FROM THE SELECTION.
  //    A resolved target already carries its own projectId; that is the strongest evidence
  //    there is and it must not be thrown away and re-guessed from the filename. Where the
  //    candidate is a bare file (the C1b1 path) there is no target, so the Owner's original
  //    words decide — the same rule as the public entrance.
  const identified = identifyProject({
    message,
    targetProjectId: typeof input.targetProjectId === 'string' && input.targetProjectId !== '' ? input.targetProjectId : null
  })
  if (!identified.ok) return { ok: false, reason: identified.reason }

  const availability = repositoryFileAvailable(identified.identity, file)
  if (!availability.ok) {
    return { ok: false, reason: availability.reason === IDENTITY_REFUSED.NOT_EXECUTABLE ? IDENTITY_REFUSED.NOT_EXECUTABLE : 'file_not_available' }
  }

  return promoteRequest({ file, intent, identity: identified.identity }, deps)
}

module.exports = { createWorkRequest, createResolvedWorkRequest, ENTRY_POINT }
