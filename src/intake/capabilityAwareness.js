'use strict'

/**
 * capabilityAwareness.js — joining 「what could have been attempted」 to 「what this turn did」.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE DEFECT THIS MEASURES IS A COMMENT IN THE GUARD ITSELF.
 *
 *   readStateGuard.js:344
 *     if (live.length === 0) return { violated: false }  // nothing was read; the claim is true
 *
 * 「Nothing was read」 is not 「the claim is true」. When a source is switched on, credentialled,
 * registered and authorised for this turn, and the turn simply did not consult it, then
 * 「我睇唔到餐廳系統」 is FALSE — and that early return lets it pass. The neighbouring guard admits
 * the same blind spot in its own words: it cannot tell a capability claim from an honest
 * 「我沒有去看」. It cannot, because it is only ever shown the turn, never the world.
 *
 * P1-A1 produced the missing half. This module joins the two and DECIDES NOTHING. It does not
 * rewrite a reply, does not gate, does not route, does not widen what a turn may read.
 *
 * ⛔ TWO ORTHOGONAL ENUMS, DELIBERATELY NOT ONE.
 *   availability — about the WORLD: could this have been attempted at all?
 *   turnState    — about THIS TURN: was it attempted, and how did it go?
 * Flattening them into a single ladder is exactly the error being measured. The pair that
 * matters most — available_to_attempt x not_read — is the one a flattened enum cannot express,
 * because it looks like 「nothing happened」 and is in fact 「it could have, and did not」.
 *
 * ⛔ REGISTERED IS NOT AUTHORISED. A source can be perfectly built and still not be granted to
 * this turn's route. Reporting it as attemptable would quietly turn awareness into a second
 * entitlement system, so an unauthorised source gets its own value and never the available one.
 *
 * ⛔ REGISTERED IS NOT HEALTHY. P1-A1 reports health 'unknown' for every source because nothing
 * in this build probes one. Awareness does not restate health at all — inventing 'up' from
 * 「an object was constructed」 is the class of claim this project keeps deleting.
 *
 * ⛔ IT IS PURE, AND THE TEST PROVES IT STRUCTURALLY. This file has NO imports. It cannot build
 * a connector, read a flag, open a credential file, authenticate, or call a model. Its only
 * inputs are its arguments. Obtaining connection truth is the caller's job precisely so that
 * running awareness can never itself become a side effect on a turn.
 *
 * ⛔ AND IT CARRIES NO CONTENT. Only identifiers, enums and counts cross this boundary — never
 * a row, an item, a title, or an error string. Read errors legitimately contain hostnames and
 * rejected credentials, and this record is destined for a log.
 * ══════════════════════════════════════════════════════════════════════════════
 */

/**
 * Closed. What the world permits, independent of what the turn did.
 *
 * ⛔ NOT_IMPLEMENTED IS SEPARATE FROM CURRENTLY_UNAVAILABLE ON PURPOSE. 「We never built it」 and
 * 「it is switched off right now」 are different truths with different remedies, and
 * development_record is a real, measured instance of the first.
 */
const AVAILABILITY = Object.freeze({
  /** Registered AND granted to this turn's route. The read could have been made. */
  AVAILABLE_TO_ATTEMPT: 'available_to_attempt',
  /** Built and ready, but this turn's route did not grant it. Never widen this. */
  NOT_AUTHORISED_THIS_TURN: 'not_authorised_this_turn',
  /** Exists as a capability, but something (flag, credential, governance) blocks it now. */
  CURRENTLY_UNAVAILABLE: 'currently_unavailable',
  /** In the catalogue with no builder — a known gap, not a failure. */
  NOT_IMPLEMENTED: 'not_implemented'
})

/**
 * Closed. What this turn actually did — and NOT_READ is the whole reason the module exists.
 *
 * ⛔ READ_MIXED IS NOT PEDANTRY. One source can run several operations in a turn; the turn
 * record is keyed by the READ GRAIN precisely so one cannot erase another. Collapsing a live
 * inventory read and a failed replenishment read into 「succeeded」 would delete the failure —
 * the same loss that keying by operation once caused.
 */
const TURN_STATE = Object.freeze({
  NOT_READ: 'not_read',
  READ_SUCCEEDED: 'read_succeeded',
  READ_FAILED: 'read_failed',
  READ_MIXED: 'read_mixed'
})

/**
 * Closed. WHICH Owner reply path emitted a record.
 *
 * ⛔ IT EXISTS BECAUSE A SHADOW CAN GO QUIET ON ONE PATH AND NOBODY NOTICES. `logNoEvidenceShadow`
 * was first placed on one path only and emitted nothing on a real turn; the fix was to carry it
 * on both, each LABELLED, so silence on one is visible rather than assumed. Free text would not
 * survive that job — 'chat ' and 'Chat' would read as two paths and neither would be countable.
 */
const AWARENESS_PATH = Object.freeze({
  /** distilled.mode !== 'commit' — ordinary Owner question / ask. The main traffic. */
  CHAT: 'chat',
  /** interactionMode === 'chat' && distilled.mode === 'commit' — the commit interception. */
  COMMIT_INTERCEPT: 'commit_intercept'
})

/** P1-A1's reason for a source that is not implemented. Compared, never parsed. */
const REASON_NOT_IMPLEMENTED = 'not_implemented'

/** The one trust value that means a read actually returned. Everything else is a failed try. */
const TRUST_LIVE = 'live'

/**
 * Values only. The turn record is a Map whose KEYS are mixed grain — the automatic path keys by
 * source, the model-directed path keys by read grain — while every row carries its own real
 * `source`. The row is therefore the authority and the key is ignored.
 */
function rowsOf (turnPerSource) {
  if (!turnPerSource) return []
  if (turnPerSource instanceof Map) return Array.from(turnPerSource.values())
  if (Array.isArray(turnPerSource)) return turnPerSource
  return []
}

/**
 * @param {object}   input
 * @param {object[]} input.connections        ConnectionState records, exactly as P1-A1 emits them
 * @param {Map|Array} input.turnPerSource     this turn's read records
 * @param {string[]} input.authorisedSources  what THIS turn's route granted — never widened here
 * @returns {Array<object>} one Awareness record per connection, in the order given
 */
function deriveCapabilityAwareness (input) {
  const inp = (input && typeof input === 'object') ? input : {}
  const connections = Array.isArray(inp.connections) ? inp.connections : []
  const rows = rowsOf(inp.turnPerSource)
  // ⛔ FAILS CLOSED. An absent or malformed authorisation list grants nothing; defaulting to
  // 「everything」 would make a plumbing mistake read as an entitlement.
  const authorised = new Set(Array.isArray(inp.authorisedSources) ? inp.authorisedSources : [])

  return connections.map((c) => {
    const conn = (c && typeof c === 'object') ? c : {}
    const source = String(conn.key == null ? '' : conn.key)

    let availability
    let unavailableReason = null
    if (conn.reason === REASON_NOT_IMPLEMENTED) {
      availability = AVAILABILITY.NOT_IMPLEMENTED
      unavailableReason = REASON_NOT_IMPLEMENTED
    } else if (conn.registered !== true) {
      availability = AVAILABILITY.CURRENTLY_UNAVAILABLE
      // The closed reason is passed through verbatim. It is never parsed and never re-derived:
      // P1-A1 computes it from first principles and owns that vocabulary.
      unavailableReason = (typeof conn.reason === 'string' && conn.reason !== '') ? conn.reason : null
    } else if (!authorised.has(source)) {
      availability = AVAILABILITY.NOT_AUTHORISED_THIS_TURN
    } else {
      availability = AVAILABILITY.AVAILABLE_TO_ATTEMPT
    }

    // Operation grain preserved as recorded. `operation` is absent for every non-Aroma source
    // and for Aroma reads made with no plan; absent stays null and is never guessed.
    const operations = rows
      .filter((r) => r && r.source === source)
      .map((r) => ({
        operation: (typeof r.operation === 'string' && r.operation !== '') ? r.operation : null,
        turnState: r.trust === TRUST_LIVE ? TURN_STATE.READ_SUCCEEDED : TURN_STATE.READ_FAILED
      }))

    const succeeded = operations.filter((o) => o.turnState === TURN_STATE.READ_SUCCEEDED).length
    let turnState
    if (operations.length === 0) turnState = TURN_STATE.NOT_READ
    else if (succeeded === operations.length) turnState = TURN_STATE.READ_SUCCEEDED
    else if (succeeded === 0) turnState = TURN_STATE.READ_FAILED
    else turnState = TURN_STATE.READ_MIXED

    return {
      source,
      availability,
      unavailableReason,
      routeAuthorised: authorised.has(source),
      turnState,
      operations,
      readCount: operations.length
    }
  })
}

module.exports = { deriveCapabilityAwareness, AVAILABILITY, TURN_STATE, AWARENESS_PATH }
