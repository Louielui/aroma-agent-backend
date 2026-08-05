'use strict'

/**
 * emptyScreen.test.js — a quiet greeting, the composer, and nothing else.
 *
 * ── WHAT IT REPLACES ─────────────────────────────────────────────────────────
 * A canned assistant bubble fired on every page load: an avatar, a copy button, and two
 * paragraphs of instructions, presented as though she had already said something. The
 * Owner asked for Claude's shape instead — a centred, time-aware greeting with the composer
 * beneath it, which disappears the moment he types.
 *
 * ── THE GREETING IS COMPUTED ON THE SERVER, AND THAT IS NOT AN ACCIDENT ──────
 * 早晨 / 午安 / 晚安 depends on the hour, and the hour depends on the OWNER'S timezone —
 * the Owner Settings field, not the browser's clock. A page open on a laptop in another
 * zone must still greet him by his own. So the band is decided by localTime.js and sent to
 * the page; the client never reads its own clock for this.
 *
 * ── THE AFFORDANCE WAS NOT DELETED ───────────────────────────────────────────
 * The bubble's second paragraph was a real affordance: the only place saying how to reach
 * the ACTION path and that approval gates execution. Owner decision: it moves to the
 * composer placeholder. The placeholder can carry the APPROVAL half; it cannot carry the
 * HOW-TO half without wrapping, so that half moves to the ＋ menu's 建立提案 note, which is
 * where someone already goes to ask for a change. Both halves are asserted below — neither
 * is allowed to simply vanish.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { greetingFor, GREETINGS } = require('./greeting')
const { DEMO_HTML } = require('./demoHtml')
const { SETTINGS_FILE } = require('../persona/ownerSettings')

const APP_JS = fs.readFileSync(path.join(__dirname, 'assets', 'app.js'), 'utf8')
const APP_CSS = fs.readFileSync(path.join(__dirname, 'assets', 'app.css'), 'utf8')
const INDEX = fs.readFileSync(path.join(__dirname, 'assets', 'index.html'), 'utf8')

function root (tz) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-greet-'))
  fs.writeFileSync(path.join(d, SETTINGS_FILE), JSON.stringify({ timezone: tz || 'America/Winnipeg' }), 'utf8')
  return d
}
/** An instant expressed as a Winnipeg wall-clock hour (CDT, UTC-5, in August). */
const atWinnipegHour = (h) => new Date(Date.UTC(2026, 7, 4, (h + 5) % 24, 30, 0))

/* ═══ 1. THE BANDS ═════════════════════════════════════════════════════════ */

test('*** 早晨 / 午安 / 晚安 by the hour ***', () => {
  const band = (h) => greetingFor(atWinnipegHour(h), { root: root() }).greeting
  for (const h of [5, 8, 11]) assert.equal(band(h), '早晨', h + ':30')
  for (const h of [12, 15, 17]) assert.equal(band(h), '午安', h + ':30')
  for (const h of [18, 21, 23, 0, 3, 4]) assert.equal(band(h), '晚安', h + ':30')
})

test('the boundaries are where they are declared, not one hour out', () => {
  assert.equal(GREETINGS.length, 3, 'three bands, published')
  assert.equal(greetingFor(atWinnipegHour(4), { root: root() }).greeting, '晚安', '04:30 is still night')
  assert.equal(greetingFor(atWinnipegHour(5), { root: root() }).greeting, '早晨', '05:30 is morning')
  assert.equal(greetingFor(atWinnipegHour(11), { root: root() }).greeting, '早晨', '11:30 is still morning')
  assert.equal(greetingFor(atWinnipegHour(12), { root: root() }).greeting, '午安', '12:30 is afternoon')
})

/* ═══ 2. THE OWNER'S ZONE, NEVER THE BROWSER'S ═════════════════════════════ */

test('*** the band follows the SETTING, not the machine ***', () => {
  // 21:53Z is 16:53 in Winnipeg (afternoon) and 06:53 next morning in Tokyo.
  const at = new Date('2026-08-04T21:53:00Z')
  assert.equal(greetingFor(at, { root: root('America/Winnipeg') }).greeting, '午安')
  assert.equal(greetingFor(at, { root: root('Asia/Tokyo') }).greeting, '早晨')
})

test('*** the client never computes the greeting from the browser clock ***', () => {
  // The whole reason it is server-side. A page open on a laptop in another zone must still
  // greet him by his own.
  const code = APP_JS.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  const greet = code.slice(code.indexOf('function renderEmptyScreen'), code.indexOf('function renderEmptyScreen') + 1600)
  assert.equal(/getHours\(\)|new Date\(\)\.getHours/.test(greet), false, 'no browser hour')
  assert.equal(/早晨|午安|晚安/.test(code), false, 'the bands are not written in the client at all')
})

test('*** the Owner\'s name is never transliterated ***', () => {
  const r = greetingFor(atWinnipegHour(8), { root: root() })
  assert.equal(r.name, 'Louie')
  assert.equal(r.line, '早晨，Louie')
  assert.equal(/路易|路儀/.test(r.line), false)
})

test('an unresolvable timezone degrades to the greeting-free line, never to a wrong hour', () => {
  const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'aroma-greet-bad-'))
  fs.writeFileSync(path.join(bad, SETTINGS_FILE), JSON.stringify({ timezone: 'Mars/Olympus' }), 'utf8')
  const r = greetingFor(atWinnipegHour(8), { root: bad })
  assert.equal(r.greeting, null, 'no band it cannot justify')
  assert.equal(r.line, 'Louie', 'his name still, with no claim about the hour')
})

/* ═══ 3. THE SHAPE ON SCREEN ═══════════════════════════════════════════════ */

test('*** the canned assistant bubble is GONE ***', () => {
  assert.equal(APP_JS.includes('我係香香。有咩想傾'), false, 'the old opening bubble')
  assert.equal(/addBot\('我係香香/.test(APP_JS), false, 'and nothing calls addBot at boot')
})

test('*** greeting and composer, nothing else ***', () => {
  const fn = APP_JS.slice(APP_JS.indexOf('function renderEmptyScreen'), APP_JS.indexOf('function isListed'))
  assert.ok(/'empty-greeting'/.test(fn), 'the greeting is rendered')
  for (const f of ['avatar', 'copy-btn', "'turn'"]) {
    assert.equal(fn.includes(f), false, 'the empty screen must not render ' + f)
  }
})

test('*** it disappears the moment the first message is sent ***', () => {
  const submit = APP_JS.slice(APP_JS.indexOf('function submit ()'), APP_JS.indexOf('function render (status'))
  assert.ok(/clearEmptyScreen\(/.test(submit), 'cleared on send')
  assert.ok(submit.indexOf('clearEmptyScreen(') < submit.indexOf('addUser('), 'before the turn is drawn')
})

test('the empty state is a class on the pane, so CSS owns the layout', () => {
  assert.ok(/main\.className[\s\S]{0,80}empty|classList\.(add|remove|toggle)\('empty'\)/.test(APP_JS), 'a class, not inline styles')
  assert.ok(/#main\.empty/.test(APP_CSS), 'and the stylesheet centres it')
})

test('*** the greeting is large and quiet, and centred ***', () => {
  const rule = APP_CSS.slice(APP_CSS.indexOf('.empty-greeting'), APP_CSS.indexOf('.empty-greeting') + 260)
  assert.ok(/text-align:\s*center/.test(rule), 'centred')
  assert.ok(/var\(--/.test(rule), 'built from tokens, not literals')
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(rule), false, 'no literal colour')
})

/* ═══ 4. THE AFFORDANCE, BOTH HALVES ═══════════════════════════════════════ */

test('*** the approval half is in the composer placeholder ***', () => {
  const m = /<textarea id="msg"[^>]*placeholder="([^"]+)"/.exec(INDEX)
  assert.ok(m, 'the composer still has a placeholder')
  const p = m[1]
  assert.ok(/批准/.test(p), 'it says approval gates it: ' + p)
  assert.ok(p.length <= 24, 'short enough not to wrap: ' + p.length + ' chars — ' + p)
  assert.equal(/講嘢|冇|嘅/.test(p), false, 'written Traditional Chinese, per the language policy: ' + p)
})

test('*** the HOW-TO half was not deleted — it is in the ＋ menu ***', () => {
  // The placeholder cannot carry both halves without wrapping. This one names the file and
  // the change, which is what someone needs when they actually want one.
  const shortcuts = APP_JS.slice(APP_JS.indexOf('var SHORTCUTS'), APP_JS.indexOf('var SHORTCUTS') + 500)
  assert.ok(/檔案/.test(shortcuts), 'the note says to name the file: ' + shortcuts)
  assert.ok(/批准/.test(shortcuts), 'and that approval comes first')
})

/* ═══ 5. IT REACHES THE SERVED PAGE ════════════════════════════════════════ */

test('all of it is in the served page', () => {
  for (const s of ['empty-greeting', 'renderEmptyScreen', '#main.empty']) {
    assert.ok(DEMO_HTML.includes(s), 'missing from the served page: ' + s)
  }
  assert.equal(/innerHTML|eval\(|new Function/.test(DEMO_HTML), false, 'still no markup from strings')
})
