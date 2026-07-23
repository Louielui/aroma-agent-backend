'use strict'

const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const store = require('../../../src/core/memory/store')

function tmpBase () { return fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-core-test-')) }
function cleanup (base) { fs.rmSync(base, { recursive: true, force: true }) }

const PROV = { source: 'test', author: 'xiangxiang', evidence: [] }
const SEL = { tags: [], links: [] }

function createRev (base, s, recordId, over = {}) {
  return store.createRevision(base, s, {
    recordId,
    revisionId: over.revisionId,
    supersedes: over.supersedes || null,
    selectors: over.selectors || SEL,
    provenance: over.provenance || PROV,
    payload: over.payload || { v: 1 },
    createdAtLabel: over.createdAtLabel || 'LABEL-1'
  })
}
function ev (base, s, recordId, targetRevisionId, eventType, expectedPreviousState, over = {}) {
  return store.recordEvent(base, s, {
    recordId, targetRevisionId, eventType, expectedPreviousState,
    actor: over.actor || 'xiangxiang',
    approval: over.approval || null,
    rationale: over.rationale || 'because',
    timestampLabel: over.timestampLabel || 'LABEL-1',
    eventId: over.eventId
  })
}

// Drive an identity/personality revision to ACTIVE.
function activateIdentityLike (base, s, recordId, revisionId) {
  ev(base, s, recordId, revisionId, 'SUBMITTED_FOR_REVIEW', 'new')
  ev(base, s, recordId, revisionId, 'APPROVED', 'review_ready', { approval: { approvedBy: 'louie', decision: 'approved' } })
  ev(base, s, recordId, revisionId, 'ACTIVATED', 'approved')
}

module.exports = { tmpBase, cleanup, createRev, ev, activateIdentityLike, PROV, SEL }
