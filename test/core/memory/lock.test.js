'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { acquireLock, releaseLock, inspectLock, lockPath } = require('../../../src/core/memory/lock')
const store = require('../../../src/core/memory/store')
const { tmpBase, cleanup, createRev } = require('./_helpers')

test('second acquire is refused; release-own allows re-acquire', () => {
  const base = tmpBase()
  const sdir = path.join(base, 'identity'); fs.mkdirSync(sdir, { recursive: true })
  try {
    const id1 = acquireLock(sdir, { operation: 'op', store: 'identity' })
    assert.throws(() => acquireLock(sdir, { operation: 'op', store: 'identity' }), (e) => e.code === 'LOCK_HELD')
    assert.equal(releaseLock(sdir, id1), true)
    const id2 = acquireLock(sdir, { operation: 'op', store: 'identity' })
    assert.ok(id2)
    releaseLock(sdir, id2)
  } finally { cleanup(base) }
})

test('releasing with the wrong lockId does not remove the lock', () => {
  const base = tmpBase()
  const sdir = path.join(base, 'identity'); fs.mkdirSync(sdir, { recursive: true })
  try {
    const id = acquireLock(sdir, { operation: 'op', store: 'identity' })
    assert.equal(releaseLock(sdir, 'not-the-id'), false)
    assert.ok(fs.existsSync(lockPath(sdir))) // still locked
    assert.equal(inspectLock(sdir).store, 'identity')
    releaseLock(sdir, id)
  } finally { cleanup(base) }
})

test('stale lock is NOT auto-deleted: a write refuses with LOCK_HELD', () => {
  const base = tmpBase()
  const sdir = path.join(base, 'skills'); fs.mkdirSync(sdir, { recursive: true })
  try {
    // simulate a crash that left a lock behind (never released)
    acquireLock(sdir, { operation: 'crashed', store: 'skills' })
    assert.throws(() => createRev(base, 'skills', 'sk1', { revisionId: 'r1' }), (e) => e.code === 'LOCK_HELD')
    assert.ok(fs.existsSync(lockPath(sdir)), 'stale lock must remain (operator recovery only)')
  } finally { cleanup(base) }
})

test('inspectLock exposes recovery metadata (read-only)', () => {
  const base = tmpBase()
  const sdir = path.join(base, 'identity'); fs.mkdirSync(sdir, { recursive: true })
  try {
    acquireLock(sdir, { operation: 'op', store: 'identity', createdAtLabel: 'L' })
    const m = inspectLock(sdir)
    assert.equal(m.operation, 'op')
    assert.equal(typeof m.lockId, 'string')
    assert.equal(typeof m.processId, 'number')
  } finally { cleanup(base) }
})
