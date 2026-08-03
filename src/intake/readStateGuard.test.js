'use strict'

/**
 * readStateGuard.test.js — the fifth contract-compliance failure, caught in code.
 *
 * THE REAL SHAPE. Every calendar read that turn logged trust:"live", count:2,
 * usedFallback:true, error:null — and the reply said 「我目前讀唔到你的日程」. The first
 * test below is exactly that shape, because the whole point of this guard is that the
 * contract text describing this case has now failed five times.
 *
 * Pure module: no adapter, no network, no paid call.
 */

const test = require('node:test')
const assert = require('node:assert')

const { enforceReadState, detectFalseReadClaim } = require('./readStateGuard')

/** The failing turn, verbatim from the read log. */
const LIVE_CALENDAR_FALLBACK = [{ source: 'calendar', trust: 'live', count: 2, usedFallback: true, error: null }]

/* ── the failure that prompted this ───────────────────────────────────────── */

test('*** trust live + usedFallback true + a reply claiming 讀不到 is CAUGHT ***', () => {
  const found = detectFalseReadClaim('我目前讀唔到你的日程,不如你直接話我知?', LIVE_CALENDAR_FALLBACK)
  assert.equal(found.violated, true, 'the exact live-shape false claim must be caught')
  assert.deepEqual(found.sources, ['calendar'])
  assert.equal(found.kind, 'named')
})

test('the correction is appended, and states what was actually read', () => {
  const out = enforceReadState('我目前讀唔到你的日程。', LIVE_CALENDAR_FALLBACK)
  assert.equal(out.corrected, true)
  assert.ok(out.reply.startsWith('我目前讀唔到你的日程。'), 'her original words are kept, not edited')
  assert.ok(out.reply.includes('系統更正'), 'the correction is visible and labelled')
  assert.ok(out.reply.includes('2 項'), 'it states the real count from the record')
  assert.ok(out.reply.includes('唔喺你問嗰段時間內'), 'usedFallback is stated honestly, not hidden')
})

test('a live read with NO fallback is corrected without the out-of-window wording', () => {
  const out = enforceReadState('我讀唔到你的日曆。', [{ source: 'calendar', trust: 'live', count: 3, usedFallback: false }])
  assert.ok(out.reply.includes('3 項'))
  assert.ok(!out.reply.includes('唔喺你問嗰段時間內'))
})

test('*** the zero-result state stays DISTINCT from unavailable ***', () => {
  // read OK, nothing matched. Saying 讀唔到 is still false — it was read.
  const out = enforceReadState('我讀唔到你的日曆。', [{ source: 'calendar', trust: 'live', count: 0, usedFallback: false }])
  assert.equal(out.corrected, true)
  assert.ok(out.reply.includes('讀到咗，但冇相關結果'), 'the middle state is named as itself')
})

/* ── a TRUE statement is never "corrected" ────────────────────────────────── */

test('*** a genuinely unavailable source may be reported as unavailable ***', () => {
  const out = enforceReadState('我目前讀唔到你的日曆。', [{ source: 'calendar', trust: 'unavailable', count: 0, usedFallback: false, error: 'token expired' }])
  assert.equal(out.corrected, false, 'the honest case must pass through untouched')
  assert.equal(out.reply, '我目前讀唔到你的日曆。')
})

test('a claim about the ONE source that failed is not corrected because another was live', () => {
  const rows = [
    { source: 'calendar', trust: 'live', count: 2, usedFallback: false },
    { source: 'gmail', trust: 'unavailable', count: 0, usedFallback: false }
  ]
  const out = enforceReadState('Gmail 我暫時讀唔到。', rows)
  assert.equal(out.corrected, false, 'naming the failed source is honest')
})

test('but naming the LIVE source while another failed is still caught', () => {
  const rows = [
    { source: 'calendar', trust: 'live', count: 2, usedFallback: false },
    { source: 'gmail', trust: 'unavailable', count: 0, usedFallback: false }
  ]
  const out = enforceReadState('日曆我讀唔到。', rows)
  assert.equal(out.corrected, true)
  assert.deepEqual(out.sources, ['calendar'])
})

test('an unnamed 讀唔到 with everything live is caught as generic', () => {
  const rows = [{ source: 'calendar', trust: 'live', count: 1, usedFallback: false }]
  const found = detectFalseReadClaim('呢樣嘢我讀唔到,你話我知好嗎?', rows)
  assert.equal(found.violated, true)
  assert.equal(found.kind, 'generic', 'nothing was unavailable, so any such claim is false')
})

test('an unnamed 讀唔到 with a genuinely failed source is left alone', () => {
  const rows = [
    { source: 'calendar', trust: 'live', count: 1, usedFallback: false },
    { source: 'drive', trust: 'unavailable', count: 0, usedFallback: false }
  ]
  const found = detectFalseReadClaim('呢樣嘢我讀唔到。', rows)
  assert.equal(found.violated, false, 'ambiguous claims resolve in favour of NOT rewriting')
})

test('a reply that claims nothing about reading is untouched', () => {
  const out = enforceReadState('你今日有兩個會,一個十點,一個三點。', LIVE_CALENDAR_FALLBACK)
  assert.equal(out.corrected, false)
  assert.equal(out.reply, '你今日有兩個會,一個十點,一個三點。')
})

test('no read happened at all this turn ⇒ nothing to enforce', () => {
  const out = enforceReadState('我讀唔到你的日曆。', [])
  assert.equal(out.corrected, false, 'with the read flags off, the guard is inert')
})

/* ── phrasing coverage: a false claim in other words is still a false claim ─ */

test('the common phrasings are all caught', () => {
  for (const claim of ['我睇唔到你個日程', '我無法讀取日曆', '日曆冇權限', '讀取失敗,日曆嗰邊', 'I cannot read your calendar', "I couldn't read the calendar"]) {
    const found = detectFalseReadClaim(claim, LIVE_CALENDAR_FALLBACK)
    assert.equal(found.violated, true, 'must catch: ' + claim)
  }
})

/* ── the correction never leaks content ───────────────────────────────────── */

test('*** the correction states counts and states only — never content ***', () => {
  const rows = [{ source: 'gmail', trust: 'live', count: 4, usedFallback: false, error: null, title: 'Invoice from ACME', body: 'secret' }]
  const out = enforceReadState('我讀唔到 Gmail。', rows)
  assert.ok(!out.reply.includes('ACME'), 'no item content')
  assert.ok(!out.reply.includes('secret'))
  assert.ok(out.reply.includes('4 項'))
})

// ── THE SOURCE MAPS MUST COVER EVERY REGISTERED SOURCE ────────────────────────
// aroma_system was read live, count in the log, and the correction block still named the
// same hardcoded four — because the guard had no entry for it. Coverage is now derived,
// and these fail the moment a source is registered without words for it.

const { ALL_SOURCES } = require('../context/liveClients')
const { SOURCE_KEYS, SOURCE_ALIASES, LABELS } = require('./readStateGuard')

test('*** every registered source has aliases and a label — none may be missing ***', () => {
  for (const s of ALL_SOURCES) {
    assert.ok(Array.isArray(SOURCE_ALIASES[s]) && SOURCE_ALIASES[s].length > 0, `${s} has no aliases`)
    assert.ok(SOURCE_ALIASES[s].includes(s), `${s} must at least answer to its own name`)
    assert.ok(LABELS[s], `${s} has no label`)
    assert.ok(SOURCE_KEYS.includes(s), `${s} missing from the derived key list`)
  }
})

test('the maps are DERIVED — a new source cannot be silently unrepresented', () => {
  // Every key in ALL_SOURCES appears in both maps, so neither can be a shorter list.
  for (const s of ALL_SOURCES) {
    assert.ok(Object.prototype.hasOwnProperty.call(SOURCE_ALIASES, s))
    assert.ok(Object.prototype.hasOwnProperty.call(LABELS, s))
  }
  assert.ok(SOURCE_KEYS.length >= ALL_SOURCES.length)
})

test('an aroma_system claim is detected and corrected by name', () => {
  const perSource = [
    { source: 'gmail', trust: 'live', count: 4, usedFallback: true },
    { source: 'aroma_system', trust: 'live', count: 1, usedFallback: false }
  ]
  for (const claim of ['我讀唔到餐廳系統嘅資料', '我而家讀唔到 Aroma System 嘅即時資料', '系統資料讀唔到']) {
    const out = enforceReadState(claim, perSource)
    assert.equal(out.corrected, true, `must correct: ${claim}`)
    assert.ok(out.sources.includes('aroma_system'), `must name aroma_system: ${claim}`)
    assert.ok(out.reply.includes('餐廳系統'), 'the correction must use the Owner-facing label')
  }
})

test('a true claim about aroma_system is still NOT corrected', () => {
  const perSource = [{ source: 'aroma_system', trust: 'unavailable', count: 0, usedFallback: false }]
  const out = enforceReadState('我讀唔到餐廳系統', perSource)
  assert.equal(out.corrected, false) // it really was unreadable
})
