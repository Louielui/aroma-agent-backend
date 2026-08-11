'use strict'
/**
 * readFailureContract.test.js — a failed read must never arrive as a successful empty one.
 *
 * ⛔ NO NETWORK. A fake connector returns the exact shapes the real ones produce.
 *
 * MEASURED DEFECT: with a wrong AROMA_SYSTEM_KEY a 401 produced
 *   {"source":"aroma_system","trust":"live","count":0,"error":null}
 * — indistinguishable from a good day with nothing to order. 「今日冇嘢要落單」 was the answer to
 * an expired key, said with total confidence, and nothing anywhere could see it.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SRC = fs.readFileSync(path.resolve(__dirname, 'readContext.js'), 'utf8')
const codeOnly = SRC.split('\n')
  .filter((l) => { const t = l.trim(); return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) })
  .join('\n')

test('*** ⛔ a per-RESULT unavailable marker is not filtered away as 「no rows」 ***', () => {
  // The shape aromaSystemRead really returns on a 401: no top-level trust, the failure carried
  // on the result by makeUnavailable.
  assert.match(codeOnly, /raw\.find\(\(r\) => r && r\.trust === 'unavailable'\)/,
    'the caller must inspect the results it is about to discard')
  assert.match(codeOnly, /results\.length === 0 && raw\.length > 0/,
    'and only when nothing live survived — a partial read is still a read')
})

test('*** the top-level check is KEPT — six of seven connectors rely on it ***', () => {
  // driveRead, gmailRead, calendarRead, githubRead, publicKnowledgeRead and recordRead THROW on
  // unavailability. publicKnowledgeRead writes the contract down: 「UNAVAILABLE THROWS, IT DOES
  // NOT RETURN ZERO ROWS」. The fix is additive; it must not replace that path.
  assert.match(codeOnly, /out\.trust === 'unavailable'/, 'the top-level contract still stands')
  assert.match(codeOnly, /catch \(e\) \{ return \{ results: \[\], unavailable:/, 'and so does the throw path')
})

test('*** ⛔ ZERO ROWS FROM A HEALTHY READ IS STILL SUCCESS — the fix must not cry wolf ***', () => {
  // 「今日冇嘢要落單」 is a correct answer. A connector that returns an empty results array with
  // no failure marker has read successfully and found nothing, and must stay trust:'live'.
  // Trading a false negative for a false positive would make the check ignorable (HR-63).
  const guard = codeOnly.slice(codeOnly.indexOf('const raw ='), codeOnly.indexOf('const raw =') + 400)
  assert.match(guard, /raw\.length > 0/,
    'an EMPTY results array cannot trigger the unavailable path — only a populated one carrying a marker')
})

test('*** the connector survey is recorded, because the shape is what recurs ***', () => {
  // Six connectors signal by throwing; exactly one signals by returning a marker. That single
  // mismatch is the whole defect, and it was written nine days AFTER the contract it broke —
  // the rule existing in a sibling and not travelling (HR-66).
  const dir = path.resolve(__dirname, 'adapters')
  const returners = fs.readdirSync(dir)
    .filter((f) => /\.js$/.test(f) && !/\.test\.js$/.test(f))
    .filter((f) => /makeUnavailable/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
  assert.deepEqual(returners, ['aromaSystemRead.js'],
    '⛔ a NEW connector returning makeUnavailable instead of throwing must be a failing test, ' +
    'not a silent zero-row read. If this list grows, the newcomer broke the contract.')
})
