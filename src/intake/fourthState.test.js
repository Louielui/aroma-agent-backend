'use strict'

/**
 * fourthState.test.js — a state the vocabulary did not contain.
 *
 * 「今日的安排目前讀不到」 — the calendar WAS read and returned one item; there is simply
 * nothing today. She did not collapse two of the three named states. She was in a FOURTH,
 * and reached for the nearest word she had been given.
 *
 *   read OK, zero rows              → named:   讀到但冇相關結果
 *   could not be read               → named:   目前讀不到
 *   keyword miss, recency fallback  → named:   (recent items)
 *   ROWS RETURNED, NONE IN PERIOD   → UNNAMED  ← this
 *
 * The audit the Owner asked for found a SECOND hole in the same place: a source the route
 * did not ask for is absent from the block entirely, so 「not consulted」 and 「has nothing」
 * are indistinguishable to her. Both are named now.
 *
 * THE HEADER IS THE FIX AND THE GUARD IS THE BACKSTOP. A guard cannot make her say the right
 * thing; it can only argue after the fact. Naming the state removes the reason to say the
 * wrong one.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { SAFETY_HEADER, buildSafetyHeader } = require('../context/readContext')
const { detectFalseReadClaim } = require('./readStateGuard')
const { validatePlan, evidenceIndex, nearnessOf } = require('./answerPlan')

/* ═══ 1. THE FOURTH STATE IS NAMED, AND SO IS THE FIFTH ═══════════════════ */

test('*** rows returned but none in the asked-for period has a name and words ***', () => {
  assert.ok(/none of them falls in the period/i.test(SAFETY_HEADER), 'the state is named in the instruction')
  assert.ok(SAFETY_HEADER.includes('沒有一項落在你問的時段內'), 'and she is given the words')
  assert.equal(SAFETY_HEADER.includes('冇一項'), false, 'written Chinese, per policy')
})

test('*** and it says explicitly that this is NOT a read failure ***', () => {
  // The whole point. She reached for 讀不到 because it was the nearest supplied word.
  const seg = SAFETY_HEADER.slice(SAFETY_HEADER.indexOf('period'))
  assert.ok(/read succeeded|not a read failure/i.test(seg), 'got: ' + seg.slice(0, 300))
})

test('*** a source that was NOT ASKED is distinguishable from one that is empty ***', () => {
  // THE SECOND HOLE, found by the audit. Step 3 makes an unasked source absent from the
  // block entirely, so 「I did not check it」 and 「it has nothing」 look identical to her.
  assert.ok(/not asked for this question/i.test(SAFETY_HEADER), 'the state is named')
  assert.ok(SAFETY_HEADER.includes('這個問題沒有查'), 'and she is given the words')
})

test('the three states that were already named still are', () => {
  for (const s of ['no matching results', 'UNAVAILABLE', '(recent items)']) {
    assert.ok(SAFETY_HEADER.includes(s), 'lost: ' + s)
  }
  for (const s of ['讀到但冇相關結果', '目前讀不到']) assert.ok(SAFETY_HEADER.includes(s), 'lost: ' + s)
  assert.ok(/capped/.test(buildSafetyHeader(['x'], { truncated: true })), 'and truncation')
})

/* ═══ 2. THE GUARD BACKSTOP — the turn's entity is an anchor ══════════════ */

const LIVE_CAL = [{ source: 'calendar', trust: 'live', count: 1, usedFallback: false }]
const LIVE_AROMA = [{ source: 'aroma_system', trust: 'live', count: 1, usedFallback: false }]

test('*** 「今日的安排目前讀不到」 is caught — 安排 is what this turn was about ***', () => {
  const r = detectFalseReadClaim('今日的安排目前讀不到。', LIVE_CAL, '今日有咩安排？')
  assert.equal(r.violated, true, 'the calendar returned a row; this is not a read failure')
  assert.deepEqual(r.sources, ['calendar'])
})

test('*** and the false-positive class STAYS closed ***', () => {
  // 發票 is an intent noun too. The modifier rule separates them without any new vocabulary:
  // 安排 sits directly before the failure; 發票 is separated from it by 的 + another noun.
  const r = detectFalseReadClaim('發票的具體服務項目內容無法讀取', LIVE_AROMA, '最近有咩發票？')
  assert.equal(r.violated, false, 'THE DEFECT THAT MUST NOT COME BACK')
})

test('the entity anchor needs the turn to be about that entity', () => {
  // No message, or a message about something else, and 安排 anchors nothing.
  assert.equal(detectFalseReadClaim('今日的安排目前讀不到。', LIVE_CAL).violated, false, 'no message: no anchor')
  assert.equal(detectFalseReadClaim('今日的安排目前讀不到。', LIVE_AROMA, '最近有咩發票？').violated, false,
    'the invoice turn does not license a claim about 安排')
})

test('a source that genuinely failed is still never corrected', () => {
  const r = detectFalseReadClaim('今日的安排目前讀不到。', [{ source: 'calendar', trust: 'unavailable', count: 0 }], '今日有咩安排？')
  assert.equal(r.violated, false)
})

/* ═══ 3. NEARNESS — computed on the full value, only the score travels ════ */

const nearCtx = () => ({
  evidenceSets: [{ source: 'calendar', trust: 'live', matchingTotal: 1, shownCount: 1, scope: {}, metrics: {} }],
  itemsBySource: [{ source: 'calendar', items: [{ source: 'calendar', sourceId: 'e1', title: '眼科檢查', originalDate: '2026-08-11T16:00:00-05:00', content: '需要提供保險資料', fields: {} }] }],
  message: ''
})
const nearPlan = (value) => ({
  citesEvidence: true,
  directAnswer: '',
  sections: [{ heading: 'x', items: [{ sourceId: 'e1', title: '眼科檢查', facts: [{ field: '備註', value }] }] }],
  limitations: [],
  followUp: null
})

test('*** a one-character paraphrase is scored as one ***', () => {
  const i = evidenceIndex(nearCtx().evidenceSets, nearCtx().itemsBySource)
  const n = nearnessOf('提供保險資訊', i)
  assert.ok(n.score >= 0.6, 'got ' + n.score)
  assert.equal(n.nearness, 'paraphrase')
})

test('*** something the evidence never held is scored as unrelated ***', () => {
  const i = evidenceIndex(nearCtx().evidenceSets, nearCtx().itemsBySource)
  const n = nearnessOf('請帶同轉介信及診金', i)
  assert.equal(n.nearness, 'unrelated', 'got ' + JSON.stringify(n))
})

test('*** the score travels even when the VALUE is withheld ***', () => {
  // THE POINT. Three rounds running the answer was "withheld at 13 characters". The score is
  // not content, so the 12-character limit does not apply to it — and the long values are
  // exactly the ones the question is about.
  // 13+ characters. My first draft of this test used a 12-character value and therefore
  // proved nothing: the limit is <= 12, so the value was never withheld at all.
  const long = '提供保險資訊及轉介信副本一份'
  assert.ok(long.length > 12, 'the fixture must actually cross the limit')
  const r = validatePlan(nearPlan(long), nearCtx())
  const d = r.drops.find((x) => x.kind === 'fact')
  assert.ok(d, 'it dropped')
  assert.equal(d.value, undefined, 'the value is still withheld')
  assert.ok(Number.isFinite(d.score), 'but the score is not: ' + JSON.stringify(d))
  assert.ok(d.nearness, 'and its classification')
})

test('the log line carries the score and never the withheld value', () => {
  const { logAnswerPlan } = require('./answerPlan')
  const l = logAnswerPlan({
    outcome: 'degraded',
    drops: [{ kind: 'fact', sourceId: '1', field: '備註', why: 'not_a_value', shape: 'text', length: 13, score: 0.71, nearness: 'paraphrase' }]
  }, () => {})
  const d = l.dropped[0]
  assert.equal(d.score, 0.71)
  assert.equal(d.nearness, 'paraphrase')
  assert.equal('value' in d, false)
})

/* ═══ 4. THE COUNTER THAT ALWAYS LOGGED ZERO ══════════════════════════════ */

test('*** droppedLimitations reaches the log line ***', () => {
  // A counter added to end a silent drop, which itself always logged zero: the log read
  // lims=0 while carrying a limitation drop record in the same entry.
  const { buildReadResultReply } = require('./readResultView')
  const lines = []
  const orig = console.log
  console.log = (...a) => { if (a[0] === '[AROMA-ANSWER-PLAN]') { try { lines.push(JSON.parse(a[1])) } catch (_) {} } }
  try {
    const c = nearCtx()
    const p = nearPlan('提供保險資料')
    p.limitations = ['另外 500 項未核對。'] // 500 was never measured
    buildReadResultReply({ reply: '', message: 'x', answerPlan: p, evidenceSets: c.evidenceSets, itemsBySource: c.itemsBySource, perSource: [] })
  } finally { console.log = orig }
  assert.equal(lines.length, 1)
  assert.equal(lines[0].droppedLimitations, 1, 'the count must match the record: ' + JSON.stringify(lines[0]))
  assert.equal(lines[0].dropped.filter((d) => d.kind === 'limitation').length, 1)
})
