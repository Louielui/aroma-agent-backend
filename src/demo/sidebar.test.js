'use strict'
/**
 * sidebar.test.js — 首頁 becomes a destination.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「the briefing now fills the conversation screen, which is exactly what I predicted
 * > and exactly why 首頁 exists as its own destination.」**
 *
 * The briefing outgrew the screen it was borrowing. `PRODUCT-IA.md` already specified 首頁 as a
 * workspace and the reason to wait — 「she answers those better in conversation today」 — stopped
 * being true for this one.
 *
 * ⛔ AND THE GROWTH RULE IS TESTED, NOT REMEMBERED.
 *
 * `PRODUCT-IA.md`: 「A sidebar item is a promise. It says 「there is something here」.」 營運, 財務
 * and 行政 are in the map and NOT on screen, deliberately. A test asserts their ABSENCE, so
 * adding one is a decision someone has to make against a failing test rather than a line
 * someone slips in.
 * ══════════════════════════════════════════════════════════════════════════════
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const HTML = fs.readFileSync(path.join(__dirname, 'assets', 'index.html'), 'utf8')
const APP_JS = fs.readFileSync(path.join(__dirname, 'assets', 'app.js'), 'utf8')
const APP_CSS = fs.readFileSync(path.join(__dirname, 'assets', 'app.css'), 'utf8')

test('首頁 is a sidebar destination, beside 設定', () => {
  assert.match(HTML, /id="open-home"/, '首頁 must be reachable as its own item')
  assert.match(HTML, /首頁/)
  assert.match(HTML, /id="open-settings"/, '設定 stays')
})

test('⛔ 營運 / 財務 / 行政 are NOT in the sidebar, and this test is why', () => {
  // PRODUCT-IA: a workspace earns an item when it has something conversation does badly.
  // 首頁 now does. The other three do not, and their absence is a decision — so it is asserted,
  // not left to whoever edits the HTML next.
  for (const notYet of ['營運', '財務', '行政']) {
    assert.doesNotMatch(HTML, new RegExp('id="open-[a-z]+"[^>]*>[^<]*' + notYet),
      notYet + ' has nothing conversation does badly yet — see PRODUCT-IA §5')
    assert.ok(!HTML.includes('>' + notYet + '<'), notYet + ' must not appear as a sidebar label')
  }
})

test('⛔ the briefing NO LONGER renders on the empty conversation screen', () => {
  // The defect that prompted this: forty-four rows ate the composer. The briefing has a
  // destination now, so the conversation screen goes back to a greeting and a composer.
  const i = APP_JS.indexOf('function renderEmptyScreen')
  const body = APP_JS.slice(i, APP_JS.indexOf('\n  function ', i + 10))
  assert.doesNotMatch(body, /renderBriefing/,
    'the empty screen must not fetch or render the briefing any more')
  assert.match(body, /greeting/, 'the greeting stays')
})

test('the briefing renders on 首頁 instead', () => {
  assert.match(APP_JS, /function showHome/)
  const i = APP_JS.indexOf('function showHome')
  const body = APP_JS.slice(i, APP_JS.indexOf('\n  function ', i + 10))
  assert.match(body, /renderBriefing/, '首頁 is where it lives now')
  assert.match(body, /home\/briefing/, 'and it reads the same endpoint')
})

test('⛔ 首頁 is NEVER BLANK when the read fails', () => {
  // The rule that has held since DEFECT-011: a failed fetch is 「我睇唔到」, never an empty box.
  const i = APP_JS.indexOf('function showHome')
  const body = APP_JS.slice(i, APP_JS.indexOf('\n  function ', i + 10))
  assert.match(body, /catch/, 'a failed read must say so')
  assert.match(body, /搵唔到|睇唔到/, 'in words, not as an empty screen')
})

test('⛔ the waiting bar still persists on the CONVERSATION screen', () => {
  // It is the one thing with a deadline. Moving the briefing away must not take it along —
  // that would leave a stopped errand with nowhere to appear while he is typing.
  assert.match(APP_JS, /renderWaitingBar/)
  const i = APP_JS.indexOf('function selectConversation')
  const body = APP_JS.slice(i, APP_JS.indexOf('\n  function ', i + 10))
  assert.match(body, /renderWaitingBar\(/, 'still called when a conversation is shown')
})

test('the bar is suppressed on 首頁, because the briefing is right there', () => {
  // Same stand-in rule as before, with a new answer to 「is the briefing visible?」
  const i = APP_JS.indexOf('function showHome')
  const body = APP_JS.slice(i, APP_JS.indexOf('\n  function ', i + 10))
  assert.match(body, /renderWaitingBar\(\s*true\s*\)/,
    'on 首頁 the briefing IS visible, so the bar must not duplicate it')
})

test('the destination has styles and does not reuse the thread layout', () => {
  assert.match(APP_CSS, /\.home-view/)
})
