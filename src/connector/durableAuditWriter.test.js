'use strict'

/**
 * durableAuditWriter.test.js — Phase 2 Gate 1. Tests the durable audit writer +
 * resultIdStore, plus a structural assertion that the connector main flow does not
 * bypass the auditor identity gate by calling writer.readAll.
 *
 *   Run: node --test src/connector/durableAuditWriter.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createDurableAuditWriter } = require('./durableAuditWriter')
const { createResultIdStore } = require('./resultIdStore')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-audit-'))
const segPath = (base, n = 1) => path.join(base, 'audit', 'seg-' + String(n).padStart(4, '0') + '.log')

test('append fsyncs before return; readAll reads it back', () => {
  const base = tmp()
  const calls = { n: 0 }
  const fsyncImpl = (fd) => { calls.n++; fs.fsyncSync(fd) }
  const w = createDurableAuditWriter({ baseDir: base, fsyncImpl })
  w.appendDurable({ seq: 1, eventType: 'ACCESS_AUDIT' })
  assert.ok(calls.n >= 1, 'fsync was called during appendDurable')
  assert.equal(w.readAll().length, 1)
  assert.equal(w.readAll()[0].seq, 1)
  w.close()
})

test('fsync failure → appendDurable throws AND the unsynced bytes are truncated (readAll excludes)', () => {
  const base = tmp()
  let mode = 'ok'
  const fsyncImpl = (fd) => { if (mode === 'fail') throw new Error('fsync fail'); fs.fsyncSync(fd) }
  const w = createDurableAuditWriter({ baseDir: base, fsyncImpl })
  w.appendDurable({ seq: 1 })
  mode = 'fail'
  assert.throws(() => w.appendDurable({ seq: 2 }), /fsync fail/)
  mode = 'ok'
  const recs = w.readAll()
  assert.equal(recs.length, 1) // the failed append left no counted trace
  assert.equal(recs[0].seq, 1)
  w.close()
})

test('reopen reads committed records (durability survives close/reopen)', () => {
  const base = tmp()
  const w1 = createDurableAuditWriter({ baseDir: base })
  w1.appendDurable({ seq: 1 }); w1.appendDurable({ seq: 2 }); w1.close()
  const w2 = createDurableAuditWriter({ baseDir: base })
  assert.deepEqual(w2.readAll().map(r => r.seq), [1, 2])
  assert.equal(w2.lastDurableSeq(), 2)
  w2.close()
})

test('torn tail is discarded on reopen; lastDurableSeq = last VALID seq', () => {
  const base = tmp()
  const w1 = createDurableAuditWriter({ baseDir: base })
  w1.appendDurable({ seq: 1 }); w1.appendDurable({ seq: 2 }); w1.close()
  // simulate a crash mid-write: a complete-but-bad-checksum line + a no-newline partial
  fs.appendFileSync(segPath(base), Buffer.from('{"seq":99}\tbadchecksum\n', 'utf8'))
  fs.appendFileSync(segPath(base), Buffer.from('{"seq":100}\tno-newline-partial', 'utf8'))
  const w2 = createDurableAuditWriter({ baseDir: base })
  assert.deepEqual(w2.readAll().map(r => r.seq), [1, 2]) // torn tail dropped
  assert.equal(w2.lastDurableSeq(), 2) // not 99/100
  // and a fresh append continues from the durable facts (no gap/dup)
  w2.appendDurable({ seq: 3 })
  assert.deepEqual(w2.readAll().map(r => r.seq), [1, 2, 3])
  w2.close()
})

test('seq derived from disk facts across reopen (no separate counter)', () => {
  const base = tmp()
  const w1 = createDurableAuditWriter({ baseDir: base })
  for (let s = 1; s <= 3; s++) w1.appendDurable({ seq: s })
  w1.close()
  const w2 = createDurableAuditWriter({ baseDir: base })
  assert.equal(w2.lastDurableSeq(), 3) // derived, not stored
  w2.close()
})

test('sealed-segment rotation → multiple segments, readAll returns all in order', () => {
  const base = tmp()
  const w = createDurableAuditWriter({ baseDir: base, segmentMaxBytes: 120 })
  for (let s = 1; s <= 5; s++) w.appendDurable({ seq: s, pad: 'xxxxxxxxxx' })
  assert.deepEqual(w.readAll().map(r => r.seq), [1, 2, 3, 4, 5])
  assert.ok(w.sealedSegments().length >= 1, 'rotation produced at least one sealed segment')
  w.close()
})

test('retention is queryable and the writer never self-prunes', () => {
  const base = tmp()
  const w = createDurableAuditWriter({ baseDir: base, retention: { policy: 'age', maxAgeMs: 1000 } })
  w.appendDurable({ seq: 1 }); w.appendDurable({ seq: 2 })
  assert.deepEqual(w.currentRetention(), { policy: 'age', maxAgeMs: 1000 })
  assert.equal(w.readAll().length, 2) // nothing auto-deleted, even with a maxAge set
  assert.ok(fs.existsSync(segPath(base)))
  w.close()
})

test('resultIdStore: set / get / size (get reserved for Tool 2, not enabled here)', () => {
  const store = createResultIdStore()
  assert.equal(store.size(), 0)
  store.set('id_1', { principal: 'p' })
  assert.equal(store.size(), 1)
  assert.deepEqual(store.get('id_1'), { principal: 'p' })
  assert.equal(store.get('missing'), null)
  assert.throws(() => store.set('', {}))
})

test('STRUCTURAL: projection main flow does NOT reference durableAuditWriter / readAll (no gate bypass)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'projectionEndpoint.js'), 'utf8')
  assert.ok(!/durableAuditWriter/.test(src), 'projectionEndpoint must not import durableAuditWriter')
  assert.ok(!/readAll/.test(src), 'projectionEndpoint must not call readAll (would bypass the #5 auditor gate)')
})
