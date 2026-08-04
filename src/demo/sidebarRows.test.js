'use strict'

/**
 * sidebarRows.test.js — the two render defects, and the sidebar that made them look like
 * something else.
 *
 * ── WHAT THESE TESTS ARE, HONESTLY ───────────────────────────────────────────
 * STATIC ASSERTIONS over the served bundle. This page has no test-time DOM and this repo
 * has no jsdom (no new dependency), so nothing here proves the browser does anything. They
 * pin the wiring — which conversation a turn is appended to, when `loaded` is set, that
 * delete is hover-revealed, that the CSS added is the CSS approved. The Owner exercises the
 * real thing.
 *
 * ── THE BUG THAT WAS NOT A BUG ───────────────────────────────────────────────
 * The report was "the same message appears twice". It did not. Messages [0] and [2] of that
 * conversation are byte-identical (hash e8667fe1d799, 60 seconds apart) — he asked the same
 * question twice and the pane rendered the transcript correctly. What made it unreadable is
 * that TWO conversations had byte-identical titles, because a title is just the first
 * message. A UI defect presenting as a data defect, and it nearly sent us hunting a race
 * that does not exist.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { DEMO_HTML } = require('./demoHtml')
const APP_JS = fs.readFileSync(path.join(__dirname, 'assets', 'app.js'), 'utf8')
const APP_CSS = fs.readFileSync(path.join(__dirname, 'assets', 'app.css'), 'utf8')

/* ═══ 1. A TURN BELONGS TO ITS CONVERSATION ══════════════════════════════════ */

test('*** turn() appends to the conversation it was given, not to whatever is on screen ***', () => {
  assert.ok(/function turn \(who, conv\)/.test(APP_JS), 'turn takes the conversation')
  assert.ok(/var c = conv \|\| active/.test(APP_JS), 'and falls back to active so old call sites are unchanged')
  assert.ok(/c\.thread\.appendChild\(t\)/.test(APP_JS), 'it appends to THAT conversation')
  assert.equal(/active\.thread\.appendChild\(t\)/.test(APP_JS), false,
    'THE DEFECT: a reply arriving after a click landed in the wrong pane')
  assert.ok(/if \(c === active\) scroll\(\)/.test(APP_JS), 'and never yanks the view to a conversation he is not reading')
})

test('*** render() stops dropping the conversation it is handed ***', () => {
  const render = APP_JS.slice(APP_JS.indexOf('function render (status, res, conv)'), APP_JS.indexOf('function labelServedBy'))
  const calls = render.match(/add(Bot|Error)\([^\n]*\)/g) || []
  assert.ok(calls.length >= 5, 'the render branches are all here')
  for (const c of calls) {
    assert.ok(/,\s*conv\)/.test(c), 'every rendered turn is bound to its conversation: ' + c)
  }
})

test('the send path captures its conversation BEFORE anything renders', () => {
  const submit = APP_JS.slice(APP_JS.indexOf('function submit ()'), APP_JS.indexOf('function render (status'))
  assert.ok(submit.indexOf('var conv = active') < submit.indexOf('addUser('), 'captured first')
  assert.ok(/addUser\(text, conv\)/.test(submit))
  assert.ok(/addTyping\(conv\)/.test(submit))
  assert.ok(/addError\('連線失敗，可以重新送出。', conv\)/.test(submit))
})

/* ═══ 2. `loaded` MEANS LOADED ═══════════════════════════════════════════════ */

test('*** loaded is set after a transcript is in the thread, not before the fetch ***', () => {
  const fn = APP_JS.slice(APP_JS.indexOf('function loadConversation'), APP_JS.indexOf('function deleteConversation'))
  assert.ok(/if \(c\.loaded \|\| c\.inflight\) return/.test(fn), 'inflight is what stops a double fetch')
  assert.ok(fn.indexOf('c.inflight = true') < fn.indexOf('fetch('), 'the guard is set before the request')
  assert.ok(fn.indexOf('c.loaded = true') > fn.indexOf('for (var i = 0'), 'loaded is set only after rendering')
  // THE DEFECT: bailing out when the Owner had clicked away left the conversation marked
  // loaded with an empty thread, so clicking it again did nothing until a refresh.
  assert.equal(/active !== c\) return/.test(fn), false, 'a transcript is rendered whatever pane is open')
  assert.ok(/if \(c === active\) scroll\(\)/.test(fn), 'only the scroll is conditional')
})

test('a failed load can be retried', () => {
  const fn = APP_JS.slice(APP_JS.indexOf('function loadConversation'), APP_JS.indexOf('function deleteConversation'))
  assert.ok(/c\.inflight = false/.test(fn))
  assert.equal(/c\.loaded = false/.test(fn), false, 'loaded was never set, so it needs no undo')
})

/* ═══ 3. THE ROWS ═══════════════════════════════════════════════════════════ */

test('*** rows carry a time and a turn count — the only things that separate them ***', () => {
  assert.ok(/function whenLabel/.test(APP_JS), 'a time')
  assert.ok(/function convCount/.test(APP_JS), 'and a count')
  assert.ok(/el\('div', 'conv-meta'\)/.test(APP_JS), 'rendered beside the title')
  assert.ok(APP_JS.includes("'月'") && APP_JS.includes("'日'"), 'older rows show a date')
})

test('*** the list is grouped 今日 / 尋日 / 更早 ***', () => {
  assert.ok(/function groupLabel/.test(APP_JS))
  for (const g of ['今日', '尋日', '更早']) assert.ok(APP_JS.includes(g), g)
  assert.ok(/el\('div', 'conv-group', g\)/.test(APP_JS), 'a label only when the group changes')
})

test('*** delete is hover-revealed, keyboard-reachable, and still asks ***', () => {
  const fn = APP_JS.slice(APP_JS.indexOf('function renderConvList'), APP_JS.indexOf('function titleFrom'))
  assert.ok(/'icon-btn conv-del'/.test(fn), 'it reuses the existing icon button')
  assert.ok(/aria-label/.test(fn), 'it has an accessible name')
  assert.ok(/stopPropagation/.test(fn), 'clicking it does not also open the conversation')
  assert.equal(/side-item-icon', '🗑'/.test(fn), false, 'the inline list-item delete is gone')
  assert.ok(/window\.confirm\(/.test(APP_JS), 'and it is still one confirm away from acting')
})

/* ═══ 4. THE CSS THE OWNER APPROVED, AND ONLY THAT ══════════════════════════ */

test('*** app.css gained exactly the approved rules ***', () => {
  for (const sel of ['.conv-group', '.conv-row', '.conv-meta', '.conv-del']) {
    assert.ok(APP_CSS.includes(sel), 'missing ' + sel)
  }
  assert.ok(/\.conv-row:hover \.conv-del, \.conv-del:focus \{ opacity: 1; \}/.test(APP_CSS),
    'revealed on hover OR focus — a mouse is not the only way in')
  // ON EXISTING TOKENS ONLY. No literal colour, no literal font size.
  // Bounded to the ADDED block — my first version sliced to the end of the file and read
  // the whole pre-existing stylesheet, which of course has hex colours in it.
  const from = APP_CSS.indexOf('.conv-group')
  const added = APP_CSS.slice(from, APP_CSS.indexOf('\n', APP_CSS.indexOf('.conv-row:hover { background: var(--divider); }', from)))
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(added), false, 'no literal colours')
  assert.equal(/font-size:\s*\d/.test(added), false, 'no literal font sizes')
})

test('the page still builds no markup from strings and stores nothing in the browser', () => {
  assert.equal(/innerHTML|eval\(|new Function/.test(DEMO_HTML), false)
  assert.equal(/localStorage|sessionStorage|document\.cookie/.test(DEMO_HTML), false)
})

test('all of it reaches the SERVED page, not just the asset file', () => {
  for (const s of ['conv-group', 'conv-meta', 'conv-del', 'function whenLabel', 'function turn (who, conv)']) {
    assert.ok(DEMO_HTML.includes(s), 'missing from the served page: ' + s)
  }
})
