'use strict'

/**
 * readContextLog.test.js — the diagnostic that was missing.
 *
 * A whole round was spent unable to answer "did the calendar return nothing, or fail?"
 * because the read path logged nothing and a bare catch swallowed failures. These tests
 * pin that the line now exists, that it says enough to answer that question, and that it
 * can never carry the Owner's content into a log file.
 */

const test = require('node:test')
const assert = require('node:assert')

const { project, scrubReason, FIELDS } = require('./readContextLog')
const { buildReadContext } = require('../context/readContext')

test('the line carries exactly the allowlisted fields — nothing else survives', () => {
  const out = project({
    source: 'calendar', trust: 'live', count: 2, usedFallback: true, error: null, durationMs: 431,
    // everything below is NOT on the allowlist and must vanish
    prompt: 'SECRET_PROMPT', items: ['SECRET_ITEM'], query: 'SECRET_QUERY',
    apiKey: 'sk-ant-SECRET', path: 'C:/Aroma/secret.json'
  })
  assert.deepEqual(Object.keys(out).sort(), ['count', 'durationMs', 'error', 'event', 'source', 'timestamp', 'trust', 'usedFallback'].sort())
  const blob = JSON.stringify(out)
  for (const s of ['SECRET_PROMPT', 'SECRET_ITEM', 'SECRET_QUERY', 'sk-ant', 'secret.json']) {
    assert.ok(!blob.includes(s), 'must not carry ' + s)
  }
})

test('*** the line answers the question that could not be answered ***', () => {
  // read OK but empty vs could-not-read must be DISTINGUISHABLE at a glance.
  const empty = project({ source: 'calendar', trust: 'live', count: 0, usedFallback: false, error: null, durationMs: 120 })
  const failed = project({ source: 'calendar', trust: 'unavailable', count: 0, usedFallback: false, error: 'invalid_grant', durationMs: 90 })
  assert.equal(empty.trust, 'live')
  assert.equal(empty.error, null)
  assert.equal(failed.trust, 'unavailable')
  assert.equal(failed.error, 'invalid_grant')
  assert.notDeepEqual(empty, failed, 'the two states are not confusable')

  // and whether the fallback fired is visible
  const fell = project({ source: 'calendar', trust: 'live', count: 2, usedFallback: true, error: null, durationMs: 300 })
  assert.equal(fell.usedFallback, true)
})

test('a failure reason is SCRUBBED of urls, paths, emails and opaque tokens', () => {
  assert.equal(scrubReason('Request failed https://gmail.googleapis.com/v1/x?key=abc'), 'Request failed <url>')
  assert.equal(scrubReason('read ' + String.fromCharCode(67, 58, 92) + 'Aroma' + String.fromCharCode(92) + 'secret.json'), 'read <path>')
  assert.equal(scrubReason('/home/louie/private/notes.txt failed'), '<path> failed')
  assert.equal(scrubReason('denied for louie@aromabistro741.com'), 'denied for <email>')
  assert.equal(scrubReason('bad token ya29_A0ARrdaM9xVeryLongOpaqueHandle12345'), 'bad token <token>')
  assert.equal(scrubReason(''), null)
  assert.equal(scrubReason(null), null)
  // an over-long reason is capped, never emitted whole
  const long = scrubReason('x'.repeat(500))
  assert.ok(long.length <= 81, 'capped, got ' + long.length)
})

test('numbers stay numbers and junk becomes null — no smuggling through a field', () => {
  const out = project({ source: 'drive', trust: 'live', count: 'SECRET', usedFallback: 'yes', durationMs: 'SECRET', error: null })
  assert.equal(out.count, null, 'a non-number count is dropped')
  assert.equal(out.durationMs, null)
  assert.equal(out.usedFallback, false, 'only a real true is true')
  // an over-long "enum" is dropped rather than truncated (truncated content is content)
  assert.equal(project({ source: 'x'.repeat(200) }).source, null)
})

test('*** the REAL read path emits one line per source, with the right verdicts ***', async () => {
  const seen = []
  const conn = {
    async read (source) {
      if (source === 'gmail') throw new Error('boom')
      if (source === 'calendar') return { asOf: 'x', source, count: 0, results: [] } // read OK, empty
      return { asOf: 'x', source, count: 1, results: [{ source, sourceId: 'i', title: 'T', retrievedAt: 'x', originalDate: '2026-07-01', content: 'c', link: 'l', trust: 'live', error: null }] }
    }
  }
  await buildReadContext({
    connector: conn, message: '今日有咩安排', sources: ['drive', 'gmail', 'calendar'],
    env: {}, now: '2026-07-27T12:00:00-05:00', logSink: (e) => seen.push(e)
  })

  assert.equal(seen.length, 3, 'exactly one line per source')
  const by = Object.fromEntries(seen.map((e) => [e.source, e]))
  assert.equal(by.drive.trust, 'live')
  assert.equal(by.drive.count, 1)
  assert.equal(by.gmail.trust, 'unavailable', 'the thrower is reported as unavailable')
  assert.ok(by.gmail.error, 'with a reason')
  assert.equal(by.calendar.trust, 'live', 'an empty read is LIVE, not a failure')
  assert.equal(by.calendar.count, 0)
  for (const e of seen) assert.ok(Number.isFinite(e.durationMs), 'each line is timed: ' + e.source)
})

test('the logger never throws, whatever it is handed', () => {
  const { logReadSource } = require('./readContextLog')
  assert.doesNotThrow(() => logReadSource(null, () => {}))
  assert.doesNotThrow(() => logReadSource({ source: {} }, () => {}))
  assert.doesNotThrow(() => logReadSource({ source: 'drive' }, () => { throw new Error('sink broke') }))
})

test('FIELDS is the whole contract — adding one is a deliberate act', () => {
  assert.deepEqual(FIELDS, ['source', 'trust', 'count', 'usedFallback', 'error', 'durationMs'])
})
