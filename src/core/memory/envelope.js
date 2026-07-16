'use strict'

/**
 * envelope — immutable CONTENT revision artifact. It describes content only:
 * payload, provenance, selectors, revision number, supersedes, contentHash.
 * It carries NO lifecycle state and NO approval — those live in separate event
 * artifacts (events.js) and are derived by the resolver. Once written, never changed.
 */

const { MemoryError } = require('./errors')
const { hashOf } = require('./canonical')
const { isKnownStore, authorityDomain } = require('./lifecycle')

const SCHEMA_VERSION = 1

function requireString (v, name) { if (typeof v !== 'string' || v.length === 0) throw new MemoryError('VALIDATION_ERROR', `${name} must be a non-empty string`) }
function requireArray (v, name) { if (!Array.isArray(v)) throw new MemoryError('VALIDATION_ERROR', `${name} must be an array`) }

function validateProvenance (p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new MemoryError('VALIDATION_ERROR', 'provenance must be an object')
  requireString(p.source, 'provenance.source')
  requireString(p.author, 'provenance.author')
  requireArray(p.evidence, 'provenance.evidence')
}

function validateSelectors (s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new MemoryError('VALIDATION_ERROR', 'selectors must be an object')
  requireArray(s.tags, 'selectors.tags')
  requireArray(s.links, 'selectors.links')
}

/**
 * @param {object} i { store, recordId, revisionId, revision, supersedes|null,
 *                      selectors, provenance, payload, createdAtLabel }
 */
function buildRevision (i) {
  if (!isKnownStore(i.store)) throw new MemoryError('VALIDATION_ERROR', `unknown store: ${i.store}`)
  requireString(i.recordId, 'recordId')
  requireString(i.revisionId, 'revisionId')
  if (!Number.isInteger(i.revision) || i.revision < 1) throw new MemoryError('VALIDATION_ERROR', 'revision must be an integer >= 1')
  if (i.supersedes != null) requireString(i.supersedes, 'supersedes')
  validateSelectors(i.selectors)
  validateProvenance(i.provenance)
  if (i.payload == null || typeof i.payload !== 'object' || Array.isArray(i.payload)) throw new MemoryError('VALIDATION_ERROR', 'payload must be an object')
  requireString(i.createdAtLabel, 'createdAtLabel')

  const rev = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'revision',
    store: i.store,
    authorityDomain: authorityDomain(i.store),
    recordId: i.recordId,
    revisionId: i.revisionId,
    revision: i.revision,
    supersedes: i.supersedes != null ? i.supersedes : null,
    selectors: {
      category: i.selectors.category != null ? i.selectors.category : null,
      tags: i.selectors.tags.slice(),
      project: i.selectors.project != null ? i.selectors.project : null,
      links: i.selectors.links.slice(),
      validFrom: i.selectors.validFrom != null ? i.selectors.validFrom : null,
      validUntil: i.selectors.validUntil != null ? i.selectors.validUntil : null
    },
    provenance: i.provenance,
    payload: i.payload,
    createdAtLabel: i.createdAtLabel
  }
  rev.contentHash = hashOf(rev, 'contentHash')
  return rev
}

// Verify a loaded revision's integrity. Returns true or throws HASH_MISMATCH/VALIDATION_ERROR.
function verifyRevision (rev) {
  if (!rev || rev.kind !== 'revision') throw new MemoryError('VALIDATION_ERROR', 'not a revision artifact')
  if (typeof rev.contentHash !== 'string') throw new MemoryError('VALIDATION_ERROR', 'missing contentHash')
  const expected = hashOf(rev, 'contentHash')
  if (expected !== rev.contentHash) throw new MemoryError('HASH_MISMATCH', 'revision contentHash mismatch')
  return true
}

module.exports = { buildRevision, verifyRevision, validateProvenance, SCHEMA_VERSION }
