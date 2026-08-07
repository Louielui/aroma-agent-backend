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
const { CATALOGUE } = require('../i18n/catalogue')
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
  // CONVERTED: the shortcut must be the proposal lane, whose note carries both halves.
  assert.ok(shortcuts.includes("t('lane.proposalNote')"), 'the proposal note is used: ' + shortcuts)
  // ⛔ AND THE WORDING GUARD MOVED TO THE SENTENCE, IN BOTH LANGUAGES. 「name the file」 and
  // 「approval comes first」 are about what the note SAYS; scanning app.js could only ever
  // have checked the Chinese.
  assert.match(CATALOGUE['lane.proposalNote'].zh, /檔案/, 'the Chinese names the file')
  assert.match(CATALOGUE['lane.proposalNote'].zh, /批准/, 'and that approval comes first')
  assert.match(CATALOGUE['lane.proposalNote'].en, /file/i, 'the English names the file')
  assert.match(CATALOGUE['lane.proposalNote'].en, /approve/i, 'and that approval comes first')
})

/* ═══ 5. IT REACHES THE SERVED PAGE ════════════════════════════════════════ */

test('all of it is in the served page', () => {
  for (const s of ['empty-greeting', 'renderEmptyScreen', '#main.empty']) {
    assert.ok(DEMO_HTML.includes(s), 'missing from the served page: ' + s)
  }
  assert.equal(/innerHTML|eval\(|new Function/.test(DEMO_HTML), false, 'still no markup from strings')
})

/* ═══ 6. IT IS GATED LIKE EVERY OTHER ROUTE THAT SERVES THE OWNER ══════════ */

test('*** the greeting route sits under a prefix the owner gate already covers ***', () => {
  // MY DEFECT, caught by probing the live server rather than by a test. The gate in app.js is
  // an ENUMERATED path list — '/demo', '/api/v1/demo', '/api/v1/conversations' — so a route
  // on a NEW prefix is unauthenticated until someone remembers to add it. The first version
  // of this route sat at /api/v1/greeting and answered 200 to an unauthenticated request
  // while every sibling answered 401.
  const router = fs.readFileSync(path.join(__dirname, '..', 'routes', 'demoRouter.js'), 'utf8')
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8')

  const gated = [...app.matchAll(/app\.use\('([^']+)',\s*requireOwner\)/g)].map((m) => m[1])
  assert.ok(gated.includes('/api/v1/demo'), 'the demo prefix is gated: ' + gated)

  // EVERY route this router defines must fall under one of those prefixes — except the
  // manifest, which app.js documents as deliberately ungated (Chrome fetches it without
  // credentials and it holds no secret).
  const routes = [...router.matchAll(/router\.(?:get|post|delete)\('([^']+)'/g)].map((m) => m[1])
  const ungated = routes.filter((r) => r !== '/manifest.webmanifest' && !gated.some((g) => r === g || r.startsWith(g + '/')))
  assert.deepEqual(ungated, [], 'these demo routes are not behind the owner gate')
  assert.ok(routes.includes('/api/v1/demo/greeting'), 'and the greeting is one of them')
})

/* ═══ 7. THE HEADER ROW IS SCAFFOLDING ON A BLANK SCREEN ═══════════════════ */

test('*** the title and the dot are hidden while the conversation is empty ***', () => {
  assert.ok(/#main\.empty[^{]*#conv-title/.test(APP_CSS) || /#main\.empty #conv-title/.test(APP_CSS), 'the title is hidden')
  assert.ok(/#main\.empty[^{]*\.brand-mark/.test(APP_CSS), 'and the avatar dot with it')
  assert.ok(/#main\.empty #topbar\s*\{[^}]*border-bottom:\s*none/.test(APP_CSS), 'and the divider line')
})

test('*** but ☰ SURVIVES — it is the only way back to a collapsed sidebar ***', () => {
  // THE FUNCTIONAL REASON THE WHOLE ROW IS NOT HIDDEN. #expand lives inside #topbar and is
  // the only control that reopens a collapsed sidebar. Hiding the row would strand the Owner
  // on a blank screen with no way to reach his conversations — which is exactly when he
  // would want them.
  const empty = APP_CSS.slice(APP_CSS.indexOf('#main.empty #topbar'), APP_CSS.indexOf('#main.empty #topbar') + 300)
  assert.equal(/#expand/.test(empty), false, '#expand is never hidden by the empty state')
  assert.equal(/#main\.empty #topbar\s*\{[^}]*display:\s*none/.test(APP_CSS), false, 'the row itself is not removed')
})

test('hiding uses visibility, so the row keeps its height and nothing jumps', () => {
  const rule = APP_CSS.slice(APP_CSS.indexOf('#main.empty .brand-mark'), APP_CSS.indexOf('#main.empty .brand-mark') + 160)
  assert.ok(/visibility:\s*hidden/.test(rule), 'visibility, not display: ' + rule)
})

test('the header returns with the first message — it is the same class and nothing else', () => {
  // No JS involved: the empty class is already added and removed by renderEmptyScreen /
  // clearEmptyScreen, so the header comes back unchanged with the first turn.
  assert.equal(/conv-title[^\n]*(hidden|display)/.test(APP_JS), false, 'the client does not touch the header')
})

/* ═══ 8. THE FOOTER NOTE ═══════════════════════════════════════════════════ */

test('*** the footer keeps the LOCAL-DEMO fact, which nothing else states ***', () => {
  const m = /<p class="composer-note">([^<]+)<\/p>/.exec(INDEX)
  assert.ok(m, 'the note still exists')
  const note = m[1]
  assert.ok(/本機示範/.test(note), 'the one thing the placeholder does not say: ' + note)
  assert.equal(/唔會|冇|嘢|咩/.test(note), false, 'written Traditional Chinese now: ' + note)
})

test('*** and it keeps the BROADER approval claim — the placeholder\'s is narrower ***', () => {
  // NOT the same statement, which is why this was not deleted. The placeholder promises
  // approval for FILE CHANGES; this promises it for ANY action. Dropping it to tidy the
  // screen would have narrowed a governance claim without saying so.
  const note = /<p class="composer-note">([^<]+)<\/p>/.exec(INDEX)[1]
  const placeholder = /<textarea id="msg"[^>]*placeholder="([^"]+)"/.exec(INDEX)[1]
  assert.ok(/改檔案/.test(placeholder), 'the placeholder is scoped to file changes: ' + placeholder)
  assert.ok(/任何動作|所有動作/.test(note), 'the note is scoped to every action: ' + note)
  assert.ok(/批准/.test(note))
})

test('the note is short enough to read as one line', () => {
  const note = /<p class="composer-note">([^<]+)<\/p>/.exec(INDEX)[1]
  assert.ok(note.length <= 22, note.length + ' chars — ' + note)
})
