'use strict'

/**
 * copyMessage.test.js — the copy button on an assistant message.
 *
 * WHAT IT COPIES IS THE POINT. The Owner pastes her answers into invoices, notes and
 * messages to staff, and a DOM-text copy arrives as one flat run: headings stop being
 * headings, item lines stop being items, and 現有存量 18.000 stops lining up under
 * anything. So the button copies the MARKDOWN SOURCE the message was rendered from —
 * the same string the server sent — and the attribution line is not part of it, because
 * 「由 香香（Claude）回答」 is a fact about the turn, not part of the answer.
 *
 * ── WHAT THESE TESTS ARE, HONESTLY ───────────────────────────────────────────
 * This page has no test-time DOM and this repo has no jsdom (no new dependency), so these
 * are STATIC assertions over the served bundle, exactly like uiStageA.test.js beside them.
 * They pin the wiring — which string reaches the clipboard call, that a failure path
 * exists, that no new CSS was needed. They cannot prove the click works in a browser;
 * that check is the Owner's, on the live page.
 */

const test = require('node:test')
const { CATALOGUE } = require('../i18n/catalogue')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { DEMO_HTML } = require('./demoHtml')

const APP_JS = fs.readFileSync(path.join(__dirname, 'assets', 'app.js'), 'utf8')
const APP_CSS = fs.readFileSync(path.join(__dirname, 'assets', 'app.css'), 'utf8')

/* ── it exists, and it is on the assistant's messages ────────────────────── */

test('*** every assistant message carries a copy control ***', () => {
  assert.ok(APP_JS.includes('function copyButton'), 'there is a copy control')
  // Built in addBot, so it rides on the assistant messages themselves rather than being
  // wired up at one call site and missing from the others (a live reply, the greeting,
  // and a transcript loaded from history all go through addBot).
  const addBot = APP_JS.slice(APP_JS.indexOf('function addBot'), APP_JS.indexOf('function addError'))
  assert.ok(addBot.includes('copyButton('), 'addBot attaches it')
})

test('*** it sits in the same footer row as the attribution ***', () => {
  const addBot = APP_JS.slice(APP_JS.indexOf('function addBot'), APP_JS.indexOf('function addError'))
  assert.ok(/el\('div', 'served'\)/.test(addBot), 'the footer reuses the existing served row')
  const label = APP_JS.slice(APP_JS.indexOf('function labelServedBy'), APP_JS.indexOf('function renderDraft'))
  assert.ok(label.includes('tEl.foot'), 'the attribution goes INTO that row rather than making a second one')
})

/* ── what gets copied ────────────────────────────────────────────────────── */

test('*** the SOURCE is copied, not the rendered DOM text ***', () => {
  const addBot = APP_JS.slice(APP_JS.indexOf('function addBot'), APP_JS.indexOf('function addError'))
  // The very same string handed to renderMarkdown is the one handed to the copy control.
  assert.ok(addBot.includes('renderMarkdown(text)'), 'the message is still rendered from text')
  assert.ok(/copyButton\(\s*(text|tEl\.source)/.test(addBot), 'and the copy control is given that same text')
  assert.equal(/copyButton\([^)]*textContent/.test(APP_JS), false, 'never the flattened DOM text')
  assert.equal(/innerText/.test(APP_JS), false, 'and never innerText')
})

test('*** the attribution line is never part of what is copied ***', () => {
  const label = APP_JS.slice(APP_JS.indexOf('function labelServedBy'), APP_JS.indexOf('function renderDraft'))
  // CONVERTED: the attribution is still written — now as a key.
  assert.ok(/t\('served\.by(Fallback)?'/.test(label), 'the attribution is still written')
  // It is appended as its own node into the footer — it is never concatenated onto the
  // source string, so it cannot travel to the clipboard.
  // CONVERTED, and it now checks the right thing. The old regex looked for the WORD 回答
  // near the copy path; after extraction the word is not in app.js at all, so it would have
  // passed for free forever — the HR-46 shape arriving through the extraction itself.
  assert.equal(/copy[^\n]*served\.by|served\.by[^\n]*writeText/.test(APP_JS), false,
    'the attribution is not in the copy payload')
})

/* ── the click ───────────────────────────────────────────────────────────── */

test('*** the clipboard write has a graceful failure path ***', () => {
  const fn = APP_JS.slice(APP_JS.indexOf('function copyButton'), APP_JS.indexOf('function addError'))
  assert.ok(fn.includes('navigator.clipboard'), 'it uses the standard API')
  // 127.0.0.1 IS a secure context, but "should be" is not "is": an older engine, a
  // permission policy or a non-loopback origin all end with writeText missing or
  // rejecting. Silence would look identical to success, which is the failure mode this
  // project keeps eliminating.
  assert.ok(/if \(!clip \|\| typeof clip\.writeText !== 'function'\)/.test(fn), 'a missing API is checked before it is called')
  assert.ok(fn.includes('.catch('), 'a rejected write is caught')
  assert.ok(fn.includes("t('copy.failed')"), 'and the Owner is told')
})

test('*** a click confirms, then reverts ***', () => {
  const fn = APP_JS.slice(APP_JS.indexOf('function copyButton'), APP_JS.indexOf('function addError'))
  // CONVERTED: a confirmation is shown. The words live in the catalogue, in both languages.
  assert.ok(fn.includes("t('copy.done')"), 'a confirmation the Owner can read')
  assert.ok(CATALOGUE['copy.done'].zh && CATALOGUE['copy.done'].en, 'and it exists in both')
  assert.ok(/setTimeout\([^,]+,\s*2000\s*\)/.test(fn), 'reverting after about two seconds')
})

test('the labels are Traditional Chinese, and the control is reachable without sight', () => {
  const fn = APP_JS.slice(APP_JS.indexOf('function copyButton'), APP_JS.indexOf('function addError'))
  assert.ok(/aria-label/.test(fn), 'an icon with no accessible name is a mystery button')
  /**
   * ⛔ THE ASSERTION THAT WAS HERE IS NOW OBSOLETE, AND SAYING SO IS THE POINT.
   *
   *   assert.equal(/[Cc]opy(ing)?['"。]/.test(fn), false, 'no English on the Owner-facing label')
   *
   * It forbade English on a label the Owner reads. The interface is bilingual now, so English
   * IS a supported rendering and that rule no longer states anything true. Worse: after
   * extraction the labels are not in app.js at all, so it would have passed forever while
   * checking nothing — HR-46 arriving through the extraction itself.
   *
   * What is actually required: the Chinese must be Chinese, and an English rendering must
   * exist. Asserted on the catalogue, where both now live.
   */
  for (const key of ['copy.label', 'copy.title', 'copy.done', 'copy.failed']) {
    assert.match(CATALOGUE[key].zh, /[\u4e00-\u9fff]/, key + ' zh must be Chinese')
    assert.ok(CATALOGUE[key].en.length > 0, key + ' must have an English rendering')
  }
})

/* ── the standing rules ──────────────────────────────────────────────────── */

test('*** no new CSS was needed — the control reuses existing styles ***', () => {
  const fn = APP_JS.slice(APP_JS.indexOf('function copyButton'), APP_JS.indexOf('function addError'))
  assert.ok(fn.includes("'icon-btn'"), 'the button is the sidebar/topbar icon button')
  assert.ok(APP_CSS.includes('.icon-btn {'), 'which app.css already defines')
  assert.ok(APP_CSS.includes('.served {'), 'and the footer row already exists')
  // app.css is not to be changed by this task, so it may hold no rule for this feature.
  // (It does contain the English word "copy" in a pre-existing comment about line-height,
  // which is why this looks for a SELECTOR and for the Owner-facing word, not for "copy".)
  assert.equal(/\.copy[-\w]*\s*[,{]/.test(APP_CSS), false, 'app.css gained no copy selector')
  assert.equal(APP_CSS.includes('複製'), false, 'and no copy label leaked into the stylesheet')
})

test('*** the message text is never logged ***', () => {
  const fn = APP_JS.slice(APP_JS.indexOf('function copyButton'), APP_JS.indexOf('function addError'))
  assert.equal(/console\./.test(fn), false, 'the copy path writes nothing to the console')
})

test('the page still assembles no markup from strings, and stores nothing in the browser', () => {
  assert.equal(/innerHTML|eval\(|new Function/.test(DEMO_HTML), false)
  assert.equal(/localStorage|sessionStorage|document\.cookie/.test(DEMO_HTML), false)
})

test('the control is in the SERVED page, not only in the asset file', () => {
  assert.ok(DEMO_HTML.includes('function copyButton'), 'it is inlined into the page the Owner loads')
  // CONVERTED: the catalogue is inlined, so this word is in the page either way.
  assert.ok(DEMO_HTML.includes("t('copy.done')"), 'the confirmation is rendered from the key')
})
