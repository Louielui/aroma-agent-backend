'use strict'

/**
 * resolver — derive per-revision state and the record's active revision from the
 * append-only event log. Never uses "highest revision" to break a governance
 * conflict: two independently-active revisions return AMBIGUOUS_ACTIVE_STATE.
 *
 * Active requires (Owner-fixed): valid hashes, a valid APPROVED, a valid
 * ACTIVATED/ADMITTED, no later DEPRECATED/SUPERSEDED, and a satisfied validity
 * window. Corrupt/isolated artifacts are excluded (cannot be active).
 */

const { deriveState } = require('./lifecycle')
const { ACTIVE_STATE } = require('./errors')

function eventsForRevision (events, revisionId) {
  return events.filter((e) => e.targetRevisionId === revisionId).sort((a, b) => a.sequence - b.sequence)
}

function revisionState (store, revisionId, events) {
  return deriveState(store, eventsForRevision(events, revisionId))
}

function validityHolds (rev, asOf) {
  if (asOf == null) return true
  const s = rev.selectors || {}
  if (s.validFrom != null && asOf < s.validFrom) return false
  if (s.validUntil != null && asOf > s.validUntil) return false
  return true
}

/**
 * @param {string} store
 * @param {object[]} revisions  loaded revisions (corrupt ones flagged __unreadable)
 * @param {object[]} events     loaded, hash-verified events (corrupt excluded upstream)
 * @param {object} opts { asOf?: string }
 * @returns {{status:string, revisionId?:string, candidates:string[]}}
 */
function resolveActive (store, revisions, events, opts = {}) {
  const asOf = opts.asOf
  const candidates = []
  for (const rev of revisions) {
    if (rev.__unreadable) continue
    const st = revisionState(store, rev.revisionId, events)
    if (st.inconsistent) continue
    if (st.state === 'active' && st.approved && st.activated && validityHolds(rev, asOf)) {
      candidates.push(rev.revisionId)
    }
  }
  if (candidates.length === 0) return { status: ACTIVE_STATE.NONE, candidates }
  if (candidates.length === 1) return { status: ACTIVE_STATE.ACTIVE, revisionId: candidates[0], candidates }
  return { status: ACTIVE_STATE.AMBIGUOUS_ACTIVE_STATE, candidates }
}

module.exports = { resolveActive, revisionState, eventsForRevision, validityHolds }
