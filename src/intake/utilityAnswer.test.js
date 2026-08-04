'use strict'

/**
 * utilityAnswer.test.js — the server answers, or it says nothing at all.
 *
 * ── THE RULE THAT SHAPES EVERY TEST BELOW ────────────────────────────────────
 * `answerUtility` returns a sentence or it returns NULL. There is no third outcome. It
 * never guesses a number, never rounds a unit it does not know, and never emits a sentence
 * that implies it looked something up. A null means "I could not do this deterministically"
 * and the caller falls to CONVERSATION — which is a worse answer, not a wrong one.
 *
 * That distinction is the whole point. 「現在是幾點？」 broke because a subsystem answered
 * about a read instead of admitting it had nothing; this module is allowed to admit it.
 *
 * ── THE CLOCK IS ALWAYS LABELLED ─────────────────────────────────────────────
 * Owner requirement: a stated time carries its zone — 「現在是下午 4 時 53 分（Winnipeg）」 —
 * so a wrong clock is visible at a glance instead of being discovered a week later.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { answerUtility, zoneLabel } = require('./utilityAnswer')
const { SETTINGS_FILE } = require('../persona/ownerSettings')

function root (tz) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-util-'))
  if (tz) fs.writeFileSync(path.join(d, SETTINGS_FILE), JSON.stringify({ timezone: tz }), 'utf8')
  return d
}
const WPG = () => ({ root: root('America/Winnipeg'), now: new Date('2026-08-04T21:53:00Z') })

/* ═══ 1. TIME — AND IT SAYS WHICH CLOCK ════════════════════════════════════ */

test('*** the time carries its timezone ***', () => {
  // 21:53Z in July/August Winnipeg (CDT, UTC-5) is 16:53 local.
  const r = answerUtility('time', '現在是幾點？', WPG())
  assert.equal(r.text, '現在是下午 4 時 53 分（Winnipeg）。')
})

test('the label follows the configured zone, not the machine', () => {
  const r = answerUtility('time', '現在是幾點？', { root: root('Asia/Tokyo'), now: new Date('2026-08-04T21:53:00Z') })
  assert.ok(r.text.includes('（Tokyo）'), 'got: ' + r.text)
  assert.ok(r.text.includes('上午 6 時 53 分'), '21:53Z is 06:53 next morning in Tokyo: ' + r.text)
})

test('morning, noon and midnight are not mislabelled', () => {
  const at = (iso) => answerUtility('time', '幾點', { root: root('UTC'), now: new Date(iso) }).text
  assert.ok(at('2026-08-04T00:00:00Z').includes('上午 12 時 0 分'), at('2026-08-04T00:00:00Z'))
  assert.ok(at('2026-08-04T12:00:00Z').includes('下午 12 時 0 分'), at('2026-08-04T12:00:00Z'))
  assert.ok(at('2026-08-04T09:05:00Z').includes('上午 9 時 5 分'), at('2026-08-04T09:05:00Z'))
})

test('zoneLabel takes the city, never the whole IANA string', () => {
  assert.equal(zoneLabel('America/Winnipeg'), 'Winnipeg')
  assert.equal(zoneLabel('Asia/Tokyo'), 'Tokyo')
  assert.equal(zoneLabel('UTC'), 'UTC')
  assert.equal(zoneLabel('America/Argentina/Buenos_Aires'), 'Buenos Aires', 'underscores and depth')
})

/* ═══ 2. DATE ══════════════════════════════════════════════════════════════ */

test('*** the date is the OWNER\'S day, with its weekday and zone ***', () => {
  const r = answerUtility('date', '今天幾號？', WPG())
  assert.equal(r.text, '今天是 2026 年 8 月 4 日，星期二（Winnipeg）。')
})

test('a zone that is already on the next day says so', () => {
  // 21:53Z on the 4th is already 06:53 on the 5th in Tokyo. The day is a function of the
  // zone, which is exactly why the zone is printed.
  const r = answerUtility('date', '今天幾號？', { root: root('Asia/Tokyo'), now: new Date('2026-08-04T21:53:00Z') })
  assert.ok(r.text.includes('8 月 5 日'), 'got: ' + r.text)
})

/* ═══ 3. ARITHMETIC — COMPUTED, NEVER GUESSED ══════════════════════════════ */

test('*** it computes what it can ***', () => {
  const cases = [['12*34', '408'], ['1,200 + 340', '1540'], ['100 - 45.5', '54.5'], ['(2+3)*4', '20'], ['10 ÷ 4', '2.5']]
  for (const [expr, want] of cases) {
    const r = answerUtility('calc', expr, WPG())
    assert.ok(r && r.text.includes(want), expr + ' -> ' + (r && r.text))
  }
})

test('*** an expression it cannot parse returns NULL, not a number ***', () => {
  for (const bad of ['12 * ', '((2+3)', '2 ** 3', 'abc + 1', '5 +', '', '1 2 3']) {
    assert.equal(answerUtility('calc', bad, WPG()), null, 'must decline: ' + JSON.stringify(bad))
  }
})

test('*** division by zero is not an answer ***', () => {
  assert.equal(answerUtility('calc', '5 / 0', WPG()), null, 'Infinity is not a number the Owner asked for')
  assert.equal(answerUtility('calc', '0/0', WPG()), null)
})

test('it never evaluates anything but arithmetic', () => {
  const src = fs.readFileSync(path.join(__dirname, 'utilityAnswer.js'), 'utf8')
  assert.equal(/\beval\s*\(|new Function/.test(src), false, 'no eval, ever — this parses Owner input')
})

/* ═══ 4. UNIT CONVERSION — NARROW ON PURPOSE ═══════════════════════════════ */

test('*** it converts the units it actually knows ***', () => {
  // 5 lb = 2.26796185 kg → 2.268 at three decimals. My first expectation said 2.27, which
  // was my rounding, not the converter's — the code was right and the test was wrong.
  const r = answerUtility('convert', '5 磅等於幾多公斤？', WPG())
  assert.equal(r && r.text, '5 lb = 2.268 kg。')
  const e = answerUtility('convert', 'convert 2 kg to lb', WPG())
  assert.equal(e && e.text, '2 kg = 4.409 lb。', 'got: ' + (e && e.text))
})

test('*** an unsupported unit returns NULL rather than a wrong number ***', () => {
  for (const q of ['5 桶等於幾多公斤？', 'convert 3 cups to grams', '10 尺換算做米']) {
    assert.equal(answerUtility('convert', q, WPG()), null, 'must decline: ' + q)
  }
})

test('*** crossing mass and volume is refused, not approximated ***', () => {
  // 1 kg of flour is not 1 litre of flour. A converter that answers this is worse than one
  // that does not exist.
  assert.equal(answerUtility('convert', '2 kg to ml', WPG()), null)
  assert.equal(answerUtility('convert', '500 毫升等於幾多克？', WPG()), null)
})

test('an ambiguous conversion with no target unit returns NULL', () => {
  assert.equal(answerUtility('convert', '5 磅', WPG()), null, 'no target — nothing to answer')
})

/* ═══ 5. NOTHING IT RETURNS EVER CLAIMS A READ ═════════════════════════════ */

test('*** no utility sentence implies a lookup, and none is a fallback ***', () => {
  const all = [
    answerUtility('time', '幾點', WPG()),
    answerUtility('date', '今天幾號', WPG()),
    answerUtility('calc', '2+2', WPG()),
    answerUtility('convert', '1 kg to lb', WPG())
  ].filter(Boolean)
  assert.equal(all.length, 4)
  for (const r of all) {
    for (const banned of ['讀', '查', '系統', '資料', '記錄', '證據']) {
      assert.equal(r.text.includes(banned), false, `"${banned}" implies a lookup: ${r.text}`)
    }
    assert.ok(/。$/.test(r.text), 'one finished sentence: ' + r.text)
  }
})

test('a malformed timezone makes the utility DECLINE, not answer in the wrong zone', () => {
  const bad = { root: root('Mars/Olympus'), now: new Date('2026-08-04T21:53:00Z') }
  assert.equal(answerUtility('time', '幾點', bad), null, 'a clock it cannot trust is one it does not state')
  assert.equal(answerUtility('date', '今天幾號', bad), null)
  // Arithmetic needs no clock, so it still works.
  assert.ok(answerUtility('calc', '2+2', bad), 'arithmetic is independent of the timezone')
})

test('an unknown kind returns null', () => {
  assert.equal(answerUtility('weather', '今日天氣點？', WPG()), null)
  assert.equal(answerUtility(null, 'x', WPG()), null)
})
