'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const store = require('../../../src/core/memory/store')
const { buildRevision } = require('../../../src/core/memory/envelope')
const { tmpBase, cleanup, createRev, ev, activateIdentityLike } = require('./_helpers')

test('content revision and lifecycle event are fully separated artifacts', () => {
  const base = tmpBase()
  try {
    createRev(base, 'identity', 'id1', { revisionId: 'r1' })
    const recDir = path.join(base, 'identity', 'records', 'id1')
    const evDir = path.join(base, 'identity', 'events', 'id1')
    assert.deepEqual(fs.readdirSync(recDir).filter((f) => f.endsWith('.json')), ['r1.json'])
    assert.equal(fs.existsSync(evDir) ? fs.readdirSync(evDir).filter((f) => f.endsWith('.json')).length : 0, 0)
    ev(base, 'identity', 'id1', 'r1', 'SUBMITTED_FOR_REVIEW', 'new', { eventId: 'e1' })
    assert.deepEqual(fs.readdirSync(evDir).filter((f) => f.endsWith('.json')), ['e1.json'])
    assert.deepEqual(fs.readdirSync(recDir).filter((f) => f.endsWith('.json')), ['r1.json']) // records untouched
  } finally { cleanup(base) }
})

test('approval does not auto-activate; only ACTIVATED makes it active', () => {
  const base = tmpBase()
  try {
    createRev(base, 'identity', 'id1', { revisionId: 'r1' })
    ev(base, 'identity', 'id1', 'r1', 'SUBMITTED_FOR_REVIEW', 'new')
    ev(base, 'identity', 'id1', 'r1', 'APPROVED', 'review_ready', { approval: { approvedBy: 'louie', decision: 'approved' } })
    assert.equal(store.resolveActiveRecord(base, 'identity', 'id1').status, 'NONE') // approved but not active
    ev(base, 'identity', 'id1', 'r1', 'ACTIVATED', 'approved')
    assert.equal(store.resolveActiveRecord(base, 'identity', 'id1').status, 'ACTIVE')
  } finally { cleanup(base) }
})

test('invalid transition writes NO artifact', () => {
  const base = tmpBase()
  try {
    createRev(base, 'identity', 'id1', { revisionId: 'r1' })
    assert.throws(() => ev(base, 'identity', 'id1', 'r1', 'ACTIVATED', 'new'), (e) => e.code === 'INVALID_TRANSITION')
    const evDir = path.join(base, 'identity', 'events', 'id1')
    const n = fs.existsSync(evDir) ? fs.readdirSync(evDir).filter((f) => f.endsWith('.json') && !f.endsWith('.tmp')).length : 0
    assert.equal(n, 0)
  } finally { cleanup(base) }
})

test('expected-previous-state mismatch -> CONCURRENCY_CONFLICT, no artifact', () => {
  const base = tmpBase()
  try {
    createRev(base, 'identity', 'id1', { revisionId: 'r1' })
    ev(base, 'identity', 'id1', 'r1', 'SUBMITTED_FOR_REVIEW', 'new') // now review_ready
    assert.throws(() => ev(base, 'identity', 'id1', 'r1', 'APPROVED', 'new', { approval: { approvedBy: 'louie', decision: 'approved' } }), (e) => e.code === 'CONCURRENCY_CONFLICT')
  } finally { cleanup(base) }
})

test('duplicate revisionId is refused (append-only, never overwrite)', () => {
  const base = tmpBase()
  try {
    createRev(base, 'identity', 'id1', { revisionId: 'r1' })
    assert.throws(() => createRev(base, 'identity', 'id1', { revisionId: 'r1' }), (e) => e.code === 'DUPLICATE_ID')
  } finally { cleanup(base) }
})

test('index is a projection: deleting it does not lose data; rebuildIndex regenerates', () => {
  const base = tmpBase()
  try {
    createRev(base, 'identity', 'id1', { revisionId: 'r1' })
    activateIdentityLike(base, 'identity', 'id1', 'r1')
    const idxPath = path.join(base, 'identity', 'index.json')
    assert.ok(fs.existsSync(idxPath))
    fs.rmSync(idxPath) // simulate lost index
    // reads still work from artifacts (truth)
    assert.equal(store.resolveActiveRecord(base, 'identity', 'id1').status, 'ACTIVE')
    const idx = store.rebuildIndex(base, 'identity')
    assert.ok(fs.existsSync(idxPath))
    assert.ok(idx.records.id1)
    assert.equal(idx.records.id1.revisions[0].revisionId, 'r1')
  } finally { cleanup(base) }
})

test('crash after artifact before index: reload sees the artifact, rebuild includes it', () => {
  const base = tmpBase()
  try {
    createRev(base, 'identity', 'id1', { revisionId: 'r1' }) // establishes layout + index
    // simulate: an artifact written directly, index NOT updated (crash window)
    const rev2 = buildRevision({ store: 'identity', recordId: 'id1', revisionId: 'r2', revision: 2, supersedes: 'r1', selectors: { tags: [], links: [] }, provenance: { source: 's', author: 'a', evidence: [] }, payload: { v: 2 }, createdAtLabel: 'L' })
    fs.writeFileSync(path.join(base, 'identity', 'records', 'id1', 'r2.json'), JSON.stringify(rev2), 'utf8')
    // reads scan artifacts -> see r2 even though index still shows only r1
    const revs = store.listRevisions(base, 'identity', 'id1')
    assert.deepEqual(revs.map((r) => r.revisionId).sort(), ['r1', 'r2'])
    const idx = store.rebuildIndex(base, 'identity')
    assert.equal(idx.records.id1.revisions.length, 2)
  } finally { cleanup(base) }
})

test('skill: registered+approved+activated but ENABLED is separate (disabled by default)', () => {
  const base = tmpBase()
  const { deriveState } = require('../../../src/core/memory/lifecycle')
  const { eventsForRevision } = require('../../../src/core/memory/resolver')
  try {
    createRev(base, 'skills', 'sk1', { revisionId: 'r1', payload: { capability: 'guardian' } })
    ev(base, 'skills', 'sk1', 'r1', 'REGISTERED', 'new')
    ev(base, 'skills', 'sk1', 'r1', 'APPROVED', 'registered', { approval: { approvedBy: 'louie', decision: 'approved' } })
    ev(base, 'skills', 'sk1', 'r1', 'ACTIVATED', 'approved')
    assert.equal(store.resolveActiveRecord(base, 'skills', 'sk1').status, 'ACTIVE')
    const events = store.listEvents(base, 'skills', 'sk1')
    assert.equal(deriveState('skills', eventsForRevision(events, 'r1')).enabled, false) // approved+active but NOT enabled
    // explicit ENABLED event required to enable (M1 still does not invoke the skill)
    ev(base, 'skills', 'sk1', 'r1', 'ENABLED', 'active')
    const events2 = store.listEvents(base, 'skills', 'sk1')
    assert.equal(deriveState('skills', eventsForRevision(events2, 'r1')).enabled, true)
  } finally { cleanup(base) }
})

test('AROMA_CORE_DIR is fail-closed (missing / relative -> CONFIG_ERROR)', () => {
  const saved = process.env.AROMA_CORE_DIR
  try {
    delete process.env.AROMA_CORE_DIR
    assert.throws(() => store.resolveCoreDir(), (e) => e.code === 'CONFIG_ERROR')
    process.env.AROMA_CORE_DIR = 'relative/path'
    assert.throws(() => store.resolveCoreDir(), (e) => e.code === 'CONFIG_ERROR')
  } finally {
    if (saved === undefined) delete process.env.AROMA_CORE_DIR; else process.env.AROMA_CORE_DIR = saved
  }
})
