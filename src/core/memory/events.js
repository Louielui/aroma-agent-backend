'use strict'

/**
 * events — immutable LIFECYCLE EVENT artifact (approval / activation / lifecycle).
 * Separate from content revisions. Describes: target revisionId, eventType, actor,
 * approval, rationale, expectedPreviousState, store-controlled sequence, timestamp
 * label (audit only — NOT ordering authority), eventHash. Once written, never changed.
 */

const { MemoryError } = require('./errors')
const { hashOf } = require('./canonical')
const { isKnownStore, allowedEventTypes, APPROVAL_EVENTS } = require('./lifecycle')

const SCHEMA_VERSION = 1

function requireString (v, name) { if (typeof v !== 'string' || v.length === 0) throw new MemoryError('VALIDATION_ERROR', `${name} must be a non-empty string`) }

function validateApproval (a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw new MemoryError('VALIDATION_ERROR', 'approval must be an object')
  requireString(a.approvedBy, 'approval.approvedBy')
  requireString(a.decision, 'approval.decision')
}

/**
 * @param {object} i { store, recordId, targetRevisionId, eventId, sequence,
 *                     eventType, actor, approval|null, rationale, expectedPreviousState,
 *                     timestampLabel }
 */
function buildEvent (i) {
  if (!isKnownStore(i.store)) throw new MemoryError('VALIDATION_ERROR', `unknown store: ${i.store}`)
  requireString(i.recordId, 'recordId')
  requireString(i.targetRevisionId, 'targetRevisionId')
  requireString(i.eventId, 'eventId')
  if (!Number.isInteger(i.sequence) || i.sequence < 1) throw new MemoryError('VALIDATION_ERROR', 'sequence must be an integer >= 1')
  requireString(i.eventType, 'eventType')
  if (!allowedEventTypes(i.store).has(i.eventType)) throw new MemoryError('VALIDATION_ERROR', `eventType ${i.eventType} not valid for store ${i.store}`)
  requireString(i.actor, 'actor')
  requireString(i.rationale, 'rationale')
  requireString(i.expectedPreviousState, 'expectedPreviousState')
  requireString(i.timestampLabel, 'timestampLabel')
  if (APPROVAL_EVENTS.has(i.eventType)) validateApproval(i.approval)

  const ev = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'event',
    store: i.store,
    recordId: i.recordId,
    targetRevisionId: i.targetRevisionId,
    eventId: i.eventId,
    sequence: i.sequence,
    eventType: i.eventType,
    actor: i.actor,
    approval: (i.approval != null) ? i.approval : null,
    rationale: i.rationale,
    expectedPreviousState: i.expectedPreviousState,
    timestampLabel: i.timestampLabel
  }
  ev.eventHash = hashOf(ev, 'eventHash')
  return ev
}

function verifyEvent (ev) {
  if (!ev || ev.kind !== 'event') throw new MemoryError('VALIDATION_ERROR', 'not an event artifact')
  if (typeof ev.eventHash !== 'string') throw new MemoryError('VALIDATION_ERROR', 'missing eventHash')
  const expected = hashOf(ev, 'eventHash')
  if (expected !== ev.eventHash) throw new MemoryError('HASH_MISMATCH', 'event eventHash mismatch')
  return true
}

module.exports = { buildEvent, verifyEvent, SCHEMA_VERSION }
