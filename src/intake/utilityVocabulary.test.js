'use strict'

/**
 * utilityVocabulary.test.js — the Owner's phrasings, through the router.
 *
 * ── WHY EVERY TEST HERE CROSSES routeTurn ────────────────────────────────────
 * 「5磅是多少公斤？」 was answered correctly by `answerUtility` from the first commit and
 * still failed live, because the ROUTER never handed it over. My unit tests called the
 * answerer directly and passed throughout — they proved the answerer worked and said nothing
 * about whether anything would ever call it.
 *
 * So the contract under test is not "can it compute this" but "does this question, typed the
 * way the Owner types it, reach an answer". `viaRouter` is the only entry point used here:
 * it routes first, and only then answers. A null from it means the turn falls to
 * CONVERSATION — whether the router declined or the answerer did — which is exactly what the
 * Owner would experience.
 *
 * ── ONE VOCABULARY PER CONCEPT ───────────────────────────────────────────────
 * The last section asserts the router holds no utility vocabulary of its own. That is the
 * actual fix: missing words were the symptom, two tables were the disease.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { routeTurn } = require('./turnRouter')
const { answerUtility } = require('./utilityAnswer')
const { SETTINGS_FILE } = require('../persona/ownerSettings')

function root (tz) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-vocab-'))
  fs.writeFileSync(path.join(d, SETTINGS_FILE), JSON.stringify({ timezone: tz || 'America/Winnipeg' }), 'utf8')
  return d
}
const NOW = new Date('2026-08-04T21:53:00Z') // Tue 4 Aug 2026, 16:53 in Winnipeg
const OPTS = () => ({ root: root(), now: NOW })

/** THE ONLY ENTRY POINT. Route, then answer — never the answerer alone. */
function viaRouter (message, opts) {
  const d = routeTurn(message)
  if (d.route !== 'UTILITY') return null
  const a = answerUtility(d.utility, message, opts || OPTS())
  return a ? a.text : null
}

const expect = (cases) => {
  const wrong = []
  for (const [q, want] of cases) {
    const got = viaRouter(q)
    if (got !== want) wrong.push(`${q}\n     want: ${want}\n     got : ${got}`)
  }
  assert.equal(wrong.length, 0, '\n  ' + wrong.join('\n  '))
}

/* ═══ TIME ═════════════════════════════════════════════════════════════════ */

test('*** the time phrasings the Owner uses ***', () => {
  const want = '現在是下午 4 時 53 分（Winnipeg）。'
  expect([
    ['現在是幾點？', want], ['而家幾點？', want], ['家陣幾點呀？', want],
    ['宜家幾多點', want], ['依家係幾點', want], ['幾點鐘啦而家', want],
    ['而家時間係？', want], ['而家咩時間', want], ['現在幾點鐘了', want]
  ])
})

test('a schedule is not a clock', () => {
  // 「而家個時間表點」 is about a timetable. 時間表 must not be read as 時間.
  assert.equal(viaRouter('而家個時間表點'), null)
})

/* ═══ DATE, INCLUDING RELATIVE DAYS ════════════════════════════════════════ */

test('*** the date phrasings, and the anchor is no longer only 今日/今天 ***', () => {
  const today = '今天是 2026 年 8 月 4 日，星期二（Winnipeg）。'
  expect([
    ['今天幾號？', today], ['今日幾號', today], ['今日係星期幾', today],
    ['今日禮拜幾', today], ['今日幾多號', today], ['今日係咩日子', today],
    ['而家幾號？', today], ['今日幾月幾號', today], ['今日係邊日', today],
    ['今日日期', today]
  ])
})

test('*** 聽日 and 琴日 are computed, not refused ***', () => {
  expect([
    ['聽日幾號', '明天是 2026 年 8 月 5 日，星期三（Winnipeg）。'],
    ['聽日係星期幾', '明天是 2026 年 8 月 5 日，星期三（Winnipeg）。'],
    ['明天幾號', '明天是 2026 年 8 月 5 日，星期三（Winnipeg）。'],
    ['琴日幾號', '昨天是 2026 年 8 月 3 日，星期一（Winnipeg）。'],
    ['尋日係星期幾', '昨天是 2026 年 8 月 3 日，星期一（Winnipeg）。'],
    ['昨天幾號', '昨天是 2026 年 8 月 3 日，星期一（Winnipeg）。']
  ])
})

test('*** a relative date carries the timezone exactly as today does ***', () => {
  // 21:53Z on the 4th is already the 5th in Tokyo, so "tomorrow" there is the 6th. The day
  // is a function of the zone whichever day is being asked about.
  const tokyo = { root: root('Asia/Tokyo'), now: NOW }
  assert.equal(viaRouter('聽日幾號', tokyo), '明天是 2026 年 8 月 6 日，星期四（Tokyo）。')
  assert.equal(viaRouter('琴日幾號', tokyo), '昨天是 2026 年 8 月 4 日，星期二（Tokyo）。')
})

test('a date-shaped business question is still not a date question', () => {
  // The anchor window is deliberately tight: a business noun between 今日 and 幾號 breaks it.
  assert.equal(viaRouter('張發票幾號到期？'), null)
  assert.equal(viaRouter('今日張發票幾號到期'), null)
})

/* ═══ CALC, IN CHINESE ═════════════════════════════════════════════════════ */

test('*** Chinese operators ***', () => {
  expect([
    ['12乘34係幾多？', '12 × 34 = 408。'],
    ['100減45', '100 − 45 = 55。'],
    ['12加34', '12 + 34 = 46。'],
    ['100除以4', '100 ÷ 4 = 25。'],
    ['100除4', '100 ÷ 4 = 25。'],
    ['12乘以34', '12 × 34 = 408。']
  ])
})

test('*** Chinese numerals ***', () => {
  expect([
    ['三加四', '3 + 4 = 7。'],
    ['十二乘三', '12 × 3 = 36。'],
    ['一百減二十', '100 − 20 = 80。']
  ])
})

test('*** x as a multiplication sign ***', () => {
  expect([['12 x 34', '12 × 34 = 408。'], ['12 X 34', '12 × 34 = 408。']])
})

test('the ASCII forms still work', () => {
  expect([
    ['12*34', '12 × 34 = 408。'],
    ['100 - 45.5', '100 − 45.5 = 54.5。'],
    ['(2+3)*4', '(2 + 3) × 4 = 20。'],
    // The echo keeps the thousand separator he typed. My first expectation stripped it;
    // showing his own expression back is the more honest of the two.
    ['1,200 + 340', '1,200 + 340 = 1540。']
  ])
})

test('*** a date is not a subtraction ***', () => {
  // 「發票 2026-08-04」 was computed as 2026 − 08 − 04 = 2014: a wrong number, produced
  // confidently, from an invoice date. Two guards now — the ISO shape, and the rule that a
  // multi-digit number with a leading zero is a month, not an operand.
  for (const q of ['發票 2026-08-04', '2026-08-04', '04/08/2026', '單號 08-15']) {
    assert.equal(viaRouter(q), null, q)
  }
  // and ordinary subtraction is untouched
  assert.equal(viaRouter('100 - 45'), '100 − 45 = 55。')
})

test('*** every arithmetic refusal survives ***', () => {
  for (const bad of ['12 * ', '((2+3)', '5 / 0', '0除以0', '12乘', '加拿大', '5 +']) {
    assert.equal(viaRouter(bad), null, 'must decline: ' + JSON.stringify(bad))
  }
})

test('a month or an invoice number is not an expression', () => {
  for (const q of ['12月3號', '發票 2026-08-04', '第 3 張']) {
    assert.equal(viaRouter(q), null, q)
  }
})

/* ═══ CONVERT — unchanged, re-asserted through the router ══════════════════ */

test('conversions still work and density is still refused', () => {
  assert.equal(viaRouter('5磅是多少公斤？'), '5 lb = 2.268 kg。')
  assert.equal(viaRouter('180度是多少華氏度？'), '180 °C = 356 °F。')
  assert.equal(viaRouter('1杯等於幾多毫升'), '1 cup = 236.588 ml（US 量度）。')
  // 密度 stays refused: a cup of flour is not a cup of water.
  for (const q of ['1杯麵粉幾多克', '1杯水幾多克', '2公斤等於幾多毫升', '500毫升等於幾多克']) {
    assert.equal(viaRouter(q), null, q)
  }
})

/* ═══ THE STRUCTURAL FIX ═══════════════════════════════════════════════════ */

const codeOf = (p) => fs.readFileSync(p, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')

test('*** the router holds NO utility vocabulary of its own ***', () => {
  // The actual disease. Missing words were the symptom; two tables were the cause, and a
  // third table would cause it again.
  const src = codeOf(path.join(__dirname, 'turnRouter.js'))
  const vocabulary = ['幾點', '幾號', '時間', '星期', '磅', '公斤', '毫升', '乘', '除以', '聽日', '琴日', '攝氏']
  const leaked = vocabulary.filter((w) => src.includes(w))
  assert.deepEqual(leaked, [], 'the router grew its own vocabulary again')
  assert.ok(/require\(['"]\.\/utilityAnswer['"]\)/.test(src), 'it consumes the answerer\'s patterns')
})

test('*** one table per concept — the router iterates what the answerer publishes ***', () => {
  const { UTILITY_PATTERNS } = require('./utilityAnswer')
  assert.ok(Array.isArray(UTILITY_PATTERNS) && UTILITY_PATTERNS.length >= 4)
  const kinds = UTILITY_PATTERNS.map((p) => p.kind)
  assert.deepEqual(kinds, ['time', 'date', 'calc', 'convert'], 'priority order is published too')
  for (const p of UTILITY_PATTERNS) assert.ok(p.re instanceof RegExp, p.kind + ' carries its own pattern')
})

test('*** no test may call the answerer without routing first ***', () => {
  // The structural protection against the bug coming back. A test that hands `kind` in
  // itself is testing arithmetic, not reachability — and reachability is what broke.
  const dir = __dirname
  const offenders = []
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.test.js'))) {
    const src = codeOf(path.join(dir, f))
    if (!/answerUtility\s*\(/.test(src)) continue
    if (!/require\(['"]\.\/turnRouter['"]\)/.test(src)) offenders.push(f)
  }
  assert.deepEqual(offenders, [], 'these call the answerer without crossing the router')
})
