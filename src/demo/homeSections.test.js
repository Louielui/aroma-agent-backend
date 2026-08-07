'use strict'
/**
 * homeSections.test.js — the door, on screen.
 *
 * DESIGN-HOME-SECTIONS. Round A: clickable 回收檢查, NO composer.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const APP_JS = fs.readFileSync(path.join(__dirname, 'assets', 'app.js'), 'utf8')
const APP_CSS = fs.readFileSync(path.join(__dirname, 'assets', 'app.css'), 'utf8')

test('an openable section renders a control that opens it', () => {
  assert.match(APP_JS, /function showSection/)
  assert.match(APP_JS, /home\/section\//, 'it must read the detail endpoint')
  assert.match(APP_JS, /c\.openable/, 'the SERVER decides which sections have a door')
})

test('⛔ 冇門好過一道假門 — a non-openable section renders no affordance at all', () => {
  const i = APP_JS.indexOf('function renderBriefing')
  const body = APP_JS.slice(i, APP_JS.indexOf('\n  /** The stop report', i))
  assert.match(body, /if \(c\.openable\)/, 'the door is conditional on content')
  assert.doesNotMatch(body, /disabled/, 'a greyed-out card promises something and has nothing')
})

test('⛔ the waiting section is not openable — a queue is not standing state', () => {
  // 「一條隊唔係持續狀態」. And the thing that must not be one click away is precisely the
  // thing with a deadline.
  const i = APP_JS.indexOf('function renderBriefing')
  const body = APP_JS.slice(i, APP_JS.indexOf('\n  /** The stop report', i))
  const waitingBlock = body.slice(body.indexOf('b.waiting'), body.indexOf('b.errands'))
  assert.doesNotMatch(waitingBlock, /showSection|openable/, 'the queue stays inline, always')
})

test('⛔ Franco has no door either — it would open onto the same four numbers', () => {
  const i = APP_JS.indexOf('function renderBriefing')
  const body = APP_JS.slice(i, APP_JS.indexOf('\n  /** The stop report', i))
  const backlogBlock = body.slice(body.indexOf('b.backlog'))
  assert.doesNotMatch(backlogBlock, /showSection|openable/,
    'the reader returns four aggregates and no file list — see DESIGN-HOME-SECTIONS §5')
})

test('⛔ ROUND A HAS NO COMPOSER — the section view must not add one back', () => {
  const i = APP_JS.indexOf('function showSection')
  const body = APP_JS.slice(i, APP_JS.indexOf('\n  function ', i + 10))
  assert.match(body, /showComposer\(\s*false\s*\)/, 'Round B is where a composer is designed, with visible context')
})

test('there is a way back to 首頁', () => {
  const i = APP_JS.indexOf('function showSection')
  const body = APP_JS.slice(i, APP_JS.indexOf('\n  function ', i + 10))
  assert.match(body, /showHome/, 'a room with no door out is worse than no room')
})

test('⛔ the section view is NEVER BLANK when the read fails', () => {
  const i = APP_JS.indexOf('function showSection')
  const body = APP_JS.slice(i, APP_JS.indexOf('\n  function ', i + 10))
  assert.match(body, /catch/)
  assert.match(body, /睇唔到|打唔開/)
})

test('the detail renders ingredients and history, not a step log', () => {
  assert.match(APP_JS, /sect-ingredient/)
  assert.match(APP_JS, /sect-history/)
  assert.match(APP_CSS, /\.sect-ingredient/)
  assert.doesNotMatch(APP_JS, /d\.steps|nodesRead/, 'execution trace is the wrong grain for any screen')
})

test('⛔ a BLOCKED ingredient shows its reason, not a zero', () => {
  const i = APP_JS.indexOf('function showSection')
  const body = APP_JS.slice(i, APP_JS.indexOf('\n  function ', i + 900))
  assert.match(APP_JS, /BLOCKED/, 'a site that would not answer is not a site with no recalls')
})

/**
 * ⛔ THE THIRD READER. HR-43.
 *
 * `conclusionFor` knew missing ≠ empty. `detailFor` did not. The CLIENT is the third reader of
 * the same field, and it did `(g.items || [])` — the identical collapse, one layer out,
 * protected only by a server state field it does not check itself.
 */
test('⛔ the client never collapses a missing item list into an empty one', () => {
  const i = APP_JS.indexOf('function renderSection')
  const raw = APP_JS.slice(i, APP_JS.indexOf('\n  /** The composer', i))
  // ⛔ Strip comments first. The first version of this test matched the COMMENT that documents
  // the removal — a source-scanning test failing on its own documentation. Assert the code.
  const body = raw.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
  assert.doesNotMatch(body, /g\.items \|\| \[\]/,
    'a fallback must fail toward honesty, not toward calm')
  assert.match(body, /!Array\.isArray\(g\.items\)/, 'missing gets its own branch, here too')
})
