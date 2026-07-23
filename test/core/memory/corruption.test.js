'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const store = require('../../../src/core/memory/store')
const { tmpBase, cleanup, createRev, ev, activateIdentityLike } = require('./_helpers')

test('corrupt revision is isolated (flagged unreadable), never crashes, excluded from active', () => {
  const base = tmpBase()
  try {
    createRev(base, 'identity', 'id1', { revisionId: 'r1' })
    activateIdentityLike(base, 'identity', 'id1', 'r1')
    assert.equal(store.resolveActiveRecord(base, 'identity', 'id1').status, 'ACTIVE')
    // tamper the revision file (hash no longer matches)
    const p = path.join(base, 'identity', 'records', 'id1', 'r1.json')
    const obj = JSON.parse(fs.readFileSync(p, 'utf8')); obj.payload = { v: 999 }
    fs.writeFileSync(p, JSON.stringify(obj), 'utf8')
    const revs = store.listRevisions(base, 'identity', 'id1')
    assert.equal(revs[0].__unreadable, true)
    assert.equal(store.resolveActiveRecord(base, 'identity', 'id1').status, 'NONE') // corrupt cannot be active
  } finally { cleanup(base) }
})

test('corrupt event is isolated and counted; other reads keep working', () => {
  const base = tmpBase()
  try {
    createRev(base, 'identity', 'id1', { revisionId: 'r1' })
    ev(base, 'identity', 'id1', 'r1', 'SUBMITTED_FOR_REVIEW', 'new', { eventId: 'e1' })
    const p = path.join(base, 'identity', 'events', 'id1', 'e1.json')
    fs.writeFileSync(p, '{ not valid json', 'utf8') // corrupt
    const st = store.getRecordState(base, 'identity', 'id1')
    assert.deepEqual(st.corruptEvents, ['e1'])
    assert.equal(st.active.status, 'NONE')
    assert.equal(store.listRevisions(base, 'identity', 'id1')[0].revisionId, 'r1') // revision still readable
  } finally { cleanup(base) }
})
