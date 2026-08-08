'use strict'

/**
 * claimScope.test.js — a correction that argues with a true statement.
 *
 * ── WHAT HAPPENED ────────────────────────────────────────────────────────────
 * The invoice answer carried the limitation 「發票的具體服務項目內容無法讀取」 — TRUE: the
 * invoice record holds id/status/vendor/date/total/currency/source/createdAt and no line
 * items. The guard matched 無法讀取, found nothing unavailable, and appended
 * 「上面講「讀唔到」係唔啱嘅。餐廳系統：讀到咗（1 項）」 under a correct answer.
 *
 * It did exactly what it was written to do. The rule was the defect: it could not tell a
 * claim about a SOURCE from a claim about a FIELD INSIDE a record, and the line between
 * 無法讀取 and 無法確認 was arbitrary — the first fired, the second did not, for no reason
 * anyone could defend.
 *
 * ── THE NEW RULE ─────────────────────────────────────────────────────────────
 * The claim is read in relation to WHAT IT NAMES, in its own clause. It fires only when the
 * clause naming the failure also names a source that was READ LIVE. If it cannot tell, it
 * stays silent — the Owner's ruling, and the right asymmetry: a missed correction is
 * recoverable, a wrong one teaches him to ignore the control.
 *
 * THE 'generic' KIND IS GONE. It fired whenever nothing was unavailable and no source was
 * named — which is precisely the shape of a true statement about a missing field.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { enforceReadState, detectFalseReadClaim } = require('./readStateGuard')

const LIVE_AROMA = [{ source: 'aroma_system', trust: 'live', count: 1, usedFallback: false }]
const LIVE_CAL = [{ source: 'calendar', trust: 'live', count: 3, usedFallback: false }]

/* ═══ 1. THE FALSE POSITIVE ════════════════════════════════════════════════ */

test('*** a true claim about a FIELD does not draw a correction ***', () => {
  const r = detectFalseReadClaim('發票的具體服務項目內容無法讀取', LIVE_AROMA)
  assert.equal(r.violated, false, 'THE DEFECT: this contradicted a correct sentence')
})

test('*** and neither do its neighbours — the arbitrary line is gone ***', () => {
  for (const s of [
    '發票的具體服務項目內容無法讀取',
    '這張發票的付款條款讀不到',
    '記錄沒有附件，內容無法取得',
    '行事曆項目的與會者名單看不到'
  ]) {
    assert.equal(detectFalseReadClaim(s, LIVE_AROMA.concat(LIVE_CAL)).violated, false, 'must stay silent: ' + s)
  }
})

/* ═══ 2. THE ORIGINAL DEFECT IS STILL CAUGHT ══════════════════════════════ */

test('*** 「我目前讀唔到你的日程」 with the calendar live is still corrected ***', () => {
  // The turn this guard was built for. It names a SOURCE and the source was read.
  const r = detectFalseReadClaim('我目前讀唔到你的日程,不如你直接話我知?', LIVE_CAL)
  assert.equal(r.violated, true)
  assert.deepEqual(r.sources, ['calendar'])
  assert.equal(r.kind, 'named')
})

test('every source alias still anchors a claim', () => {
  for (const [text, src, rows] of [
    ['我讀唔到你的日曆。', 'calendar', LIVE_CAL],
    ['Gmail 我暫時讀唔到。', 'gmail', [{ source: 'gmail', trust: 'live', count: 2, usedFallback: false }]],
    ['餐廳系統讀取失敗。', 'aroma_system', LIVE_AROMA]
  ]) {
    const r = detectFalseReadClaim(text, rows)
    assert.equal(r.violated, true, text)
    assert.deepEqual(r.sources, [src])
  }
})

test('a source that genuinely WAS unavailable is never corrected', () => {
  const r = detectFalseReadClaim('我目前讀唔到你的日曆。', [{ source: 'calendar', trust: 'unavailable', count: 0, error: 'token expired' }])
  assert.equal(r.violated, false)
})

/* ═══ 3. THE CLAUSE IS THE UNIT ═══════════════════════════════════════════ */

test('*** a source named in a DIFFERENT clause does not anchor the claim ***', () => {
  // 「日曆有 3 件安排；發票的服務項目內容無法讀取。」 — the calendar is named, and the thing
  // that cannot be read is a field of something else entirely.
  const r = detectFalseReadClaim('日曆有 3 件安排；發票的服務項目內容無法讀取。', LIVE_CAL.concat(LIVE_AROMA))
  assert.equal(r.violated, false, 'the alias is in another clause: it anchors nothing')
})

test('and a source named in the SAME clause does', () => {
  const r = detectFalseReadClaim('今日天氣唔錯；我讀唔到你的日曆。', LIVE_CAL)
  assert.equal(r.violated, true)
})

/* ═══ 4. WHEN IT CANNOT TELL, IT IS SILENT ════════════════════════════════ */

test('*** an unattributed claim is no longer "generic" — it stays silent ***', () => {
  // INVERTED, Owner ruling 2026-08-05. This used to fire whenever nothing was unavailable
  // and no source was named — the exact shape of a true statement about a missing field.
  const r = detectFalseReadClaim('呢樣嘢我讀唔到,你話我知好嗎?', LIVE_AROMA.concat(LIVE_CAL))
  assert.equal(r.violated, false, 'it names no source, so it anchors nothing')
  assert.equal(r.kind, null)
})

test('the generic kind no longer exists at all', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'readStateGuard.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  assert.equal(/'generic'/.test(code), false, 'a kind that fires on an unattributable claim cannot come back')
})

test('enforceReadState leaves a correct answer completely untouched', () => {
  const text = '最近有一張發票。\n\n### 資料限制\n\n發票的具體服務項目內容無法讀取'
  const out = enforceReadState(text, LIVE_AROMA)
  assert.equal(out.corrected, false)
  assert.equal(out.reply, text, 'byte-identical')
})

/* ═══ 5. A FAILED SENTENCE NO LONGER DISCARDS VERIFIED ROWS ═══════════════ */

const { validatePlan } = require('./answerPlan')
const { buildReadResultReply } = require('./readResultView')

const calCtx = () => ({
  evidenceSets: [{ source: 'calendar', trust: 'live', matchingTotal: 1, shownCount: 1, scope: {}, metrics: {} }],
  itemsBySource: [{ source: 'calendar', items: [{ source: 'calendar', sourceId: 'e1', title: '眼科檢查（Dr. Phangureh）', originalDate: '2026-08-11T16:00:00-05:00', content: 'Dr. Phangureh 診所', fields: { start: '2026-08-11T16:00:00-05:00' } }] }],
  message: ''
})
const calPlan = (directAnswer) => ({
  citesEvidence: true,
  directAnswer,
  sections: [{ heading: '預約', items: [{ sourceId: 'e1', title: '眼科檢查（Dr. Phangureh）', facts: [{ field: '日期時間', value: '2026-08-11T16:00:00-05:00' }] }] }],
  limitations: [],
  followUp: null
})

test('*** an unsupported sentence is dropped; the verified row is KEPT ***', () => {
  // 500 was never measured, so the sentence goes. The appointment was checked and passed —
  // it earned its place, and a narrow failure must not escalate into a total one.
  const r = validatePlan(calPlan('今日有 500 件安排。'), calCtx())
  assert.equal(r.droppedSentences, 1)
  assert.equal(r.plan.directAnswer, '', 'the sentence is gone')
  assert.equal(r.keptItemCount, 1, 'and the row survives')
})

test('*** the rendered reply shows the row instead of the fallback ***', () => {
  const c = calCtx()
  const { reply } = buildReadResultReply({
    reply: '', message: '今日有咩安排？', answerPlan: calPlan('今日有 500 件安排。'),
    evidenceSets: c.evidenceSets, itemsBySource: c.itemsBySource, perSource: []
  })
  assert.ok(reply.includes('眼科檢查'), 'THE REGRESSION: a verified appointment was thrown away — ' + reply)
  assert.equal(/組不出|砌唔出/.test(reply), false, 'the fallback must not fire when rows survived')
  assert.ok(/有 1 句無法核對/.test(reply), 'and the dropped sentence is stated, not silent: ' + reply)
})

test('with NO rows surviving, the fallback still fires', () => {
  const c = calCtx()
  const plan = calPlan('今日有 500 件安排。')
  plan.sections[0].items[0].sourceId = 'ghost'
  const { reply } = buildReadResultReply({
    reply: '', message: 'x', answerPlan: plan,
    evidenceSets: c.evidenceSets, itemsBySource: c.itemsBySource, perSource: []
  })
  assert.ok(/組不出/.test(reply), 'nothing survived, so there is nothing to show: ' + reply)
})

/* ═══ 6. PROSE TIME AND DATE ══════════════════════════════════════════════ */

const { evidenceIndex, sentenceIsSupported } = require('./answerPlan')
const calIndex = () => evidenceIndex(calCtx().evidenceSets, calCtx().itemsBySource)

test('*** 下午 4 時 verifies against a stored 16:00 ***', () => {
  const i = calIndex()
  assert.equal(sentenceIsSupported('下週二下午 4 時有眼科檢查。', i), true, 'THE GAP: matchValue knew, the prose checker did not')
  assert.equal(sentenceIsSupported('8 月 11 日下午 4 時有眼科檢查。', i), true)
  assert.equal(sentenceIsSupported('眼科檢查在 2026-08-11 16:00。', i), true, 'and the stored form still works')
})

test('*** a DIFFERENT time or date is still refused ***', () => {
  const i = calIndex()
  assert.equal(sentenceIsSupported('下午 5 時有眼科檢查。', i), false)
  assert.equal(sentenceIsSupported('上午 4 時有眼科檢查。', i), false, 'the meridiem is part of the value')
  assert.equal(sentenceIsSupported('8 月 12 日有眼科檢查。', i), false)
  assert.equal(sentenceIsSupported('今日有 500 件安排。', i), false, 'an ordinary unmeasured number is unaffected')
})

/* ═══ 7. THE FALLBACK SENTENCE ════════════════════════════════════════════ */

const { minimalAnswer, UNREADABLE_CLAIM: UC } = (() => {
  const ap = require('./answerPlan'); const g = require('./readStateGuard')
  return { minimalAnswer: ap.minimalAnswer, UNREADABLE_CLAIM: g.UNREADABLE_CLAIM }
})()

test('*** the fallback is written Chinese ***', () => {
  const m = minimalAnswer([{ source: 'calendar', trust: 'live', shownCount: 1, kind: 'event' }])
  assert.equal(/砌唔出|唔會亂講|今次/.test(m), false, 'the Cantonese form is gone: ' + m)
  assert.ok(/組不出|不會亂說/.test(m), 'got: ' + m)
})

test('*** and it still contains NO read-failure phrase for the guard to contradict ***', () => {
  // THE CARRY-FORWARD FROM 2026-08-04, honoured. The old assertion listed Cantonese
  // spellings only and would have kept passing while protecting nothing the moment this
  // wording changed. It now tests against UNREADABLE_CLAIM itself — the one list — so the
  // two can never drift apart again.
  const m = minimalAnswer([{ source: 'calendar', trust: 'live', shownCount: 1, kind: 'event' }])
  assert.equal(UC.test(m), false, 'a fallback and its safety control must not argue: ' + m)
})

test('when nothing was read, saying so is still allowed and still true', () => {
  const m = minimalAnswer([])
  assert.ok(UC.test(m), 'this one SHOULD claim a read failure — there was one')
  assert.equal(/唔到|嘅|今次/.test(m), false, 'but in written Chinese: ' + m)
})
