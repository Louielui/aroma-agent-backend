'use strict'

/**
 * lifecycle — per-domain event vocabularies + explicit transition tables. State
 * is DERIVED from the ordered event log (by store-controlled sequence, never by
 * timestamp labels). Approval is structurally distinct from activation: a revision
 * can only reach 'active' via ACTIVATED/ADMITTED from state 'approved' — there is
 * no path that admits without a prior APPROVED (no auto-admit). `enabled` (skills)
 * is derived from ENABLED/DISABLED events, not a mutable payload boolean.
 */

const { MemoryError } = require('./errors')

const DOMAINS = Object.freeze({
  identity: 'identity',
  personality: 'behavior',
  experience: 'advisory',
  skills: 'capability'
})

// fromState -> { eventType: toState }.  ENABLED/DISABLED (skills) are handled
// specially (state unchanged, toggle `enabled`) and are NOT in this table.
const TRANSITIONS = Object.freeze({
  identity: {
    new: { SUBMITTED_FOR_REVIEW: 'review_ready', REJECTED: 'rejected' },
    review_ready: { APPROVED: 'approved', REJECTED: 'rejected' },
    approved: { ACTIVATED: 'active', DEPRECATED: 'deprecated' },
    active: { SUPERSEDED: 'superseded', DEPRECATED: 'deprecated' }
  },
  personality: {
    new: { SUBMITTED_FOR_REVIEW: 'review_ready', REJECTED: 'rejected' },
    review_ready: { APPROVED: 'approved', REJECTED: 'rejected' },
    approved: { ACTIVATED: 'active', DEPRECATED: 'deprecated' },
    active: { SUPERSEDED: 'superseded', DEPRECATED: 'deprecated' }
  },
  experience: {
    new: { CANDIDATE_CREATED: 'candidate', REJECTED: 'rejected' },
    candidate: { REVIEW_READY: 'review_ready', REJECTED: 'rejected' },
    review_ready: { APPROVED: 'approved', REJECTED: 'rejected' },
    approved: { ADMITTED: 'active', DEPRECATED: 'deprecated' },
    active: { SUPERSEDED: 'superseded', DEPRECATED: 'deprecated' }
  },
  skills: {
    new: { REGISTERED: 'registered', REJECTED: 'rejected' },
    registered: { APPROVED: 'approved', REJECTED: 'rejected' },
    approved: { ACTIVATED: 'active', DEPRECATED: 'deprecated' },
    active: { DEPRECATED: 'deprecated' } // + ENABLED/DISABLED (special)
  }
})

// Events that require an approval record on the event (Louie approval).
const APPROVAL_EVENTS = new Set(['APPROVED'])
// Events that mean "active" for a revision.
const ACTIVATION_EVENTS = new Set(['ACTIVATED', 'ADMITTED'])

function isKnownStore (store) { return Object.prototype.hasOwnProperty.call(DOMAINS, store) }
function authorityDomain (store) {
  if (!isKnownStore(store)) throw new MemoryError('VALIDATION_ERROR', `unknown store: ${store}`)
  return DOMAINS[store]
}
function allowedEventTypes (store) {
  const t = TRANSITIONS[store]
  const set = new Set()
  for (const from of Object.keys(t)) for (const ev of Object.keys(t[from])) set.add(ev)
  if (store === 'skills') { set.add('ENABLED'); set.add('DISABLED') }
  return set
}

// Compute {state, enabled, approved, activated, inconsistent} from ordered events.
function deriveState (store, orderedEvents) {
  let state = 'new'
  let enabled = false
  let approved = false
  let activated = false
  let inconsistent = false
  for (const e of orderedEvents) {
    if (store === 'skills' && (e.eventType === 'ENABLED' || e.eventType === 'DISABLED')) {
      if (state !== 'active') { inconsistent = true; continue }
      if (e.eventType === 'ENABLED') { if (enabled) inconsistent = true; enabled = true }
      else { if (!enabled) inconsistent = true; enabled = false }
      continue
    }
    const to = TRANSITIONS[store][state] && TRANSITIONS[store][state][e.eventType]
    if (!to) { inconsistent = true; continue }
    if (e.eventType === 'APPROVED') approved = true
    if (ACTIVATION_EVENTS.has(e.eventType)) activated = true
    state = to
  }
  return { state, enabled, approved, activated, inconsistent }
}

// Validate a proposed event against the current derived state. Throws
// INVALID_TRANSITION when the event is not allowed. Returns the resulting
// { state, enabled }.
function validateTransition (store, current, eventType) {
  const curState = current.state
  const curEnabled = !!current.enabled
  if (store === 'skills' && (eventType === 'ENABLED' || eventType === 'DISABLED')) {
    if (curState !== 'active') throw new MemoryError('INVALID_TRANSITION', `${eventType} requires active skill`)
    if (eventType === 'ENABLED' && curEnabled) throw new MemoryError('INVALID_TRANSITION', 'already enabled')
    if (eventType === 'DISABLED' && !curEnabled) throw new MemoryError('INVALID_TRANSITION', 'already disabled')
    return { state: curState, enabled: eventType === 'ENABLED' }
  }
  const to = TRANSITIONS[store][curState] && TRANSITIONS[store][curState][eventType]
  if (!to) throw new MemoryError('INVALID_TRANSITION', `${eventType} not allowed from ${curState}`)
  return { state: to, enabled: curEnabled }
}

module.exports = { DOMAINS, TRANSITIONS, APPROVAL_EVENTS, ACTIVATION_EVENTS, isKnownStore, authorityDomain, allowedEventTypes, deriveState, validateTransition }
