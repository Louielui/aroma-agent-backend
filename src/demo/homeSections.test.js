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

test('⛔ 首頁 still has no composer — the section view is the ONLY place one appears', () => {
  // Was 「Round A has no composer」. Round B added it to the SECTION view deliberately, with
  // visible attached context. 首頁 remains a report, so the rule it was protecting is intact:
  // a composer only exists where the context it would carry is on screen.
  const i = APP_JS.indexOf('function showHome')
  const body = APP_JS.slice(i, APP_JS.indexOf('\n  function ', i + 10))
  assert.match(body, /showComposer\(\s*false\s*\)/, '首頁 is a report; there is no context to attach there')
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

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ ROUND B — 附上咗乜要睇得見, ENFORCED BY TEST RATHER THAN BY COMMENT.
 *
 * > **Owner: 「Before I type anything I should be able to see what would travel. Not after
 * > sending, not in a log — on screen, before.」**
 * ══════════════════════════════════════════════════════════════════════════════
 */
test('⛔ the section view shows what would travel BEFORE anything is typed', () => {
  const i = APP_JS.indexOf('function showSection')
  const body = APP_JS.slice(i, APP_JS.indexOf('\n  function ', i + 10))
  assert.match(body, /attachment/, 'the preview must be fetched when the section opens')
  assert.match(body, /renderAttachPreview|attach-preview/, 'and rendered')
  // ⛔ It must NOT be gated on typing, focus, or a send.
  assert.doesNotMatch(body, /addEventListener\('input'[\s\S]{0,120}attach/, 'the preview is not revealed by typing')
})

test('⛔ the preview is what the SERVER says will travel, not a client-side rendering', () => {
  const i = APP_JS.indexOf('function renderAttachPreview')
  assert.ok(i > 0)
  const body = APP_JS.slice(i, APP_JS.indexOf('\n  function ', i + 10))
  assert.match(body, /a\.lines/, 'it renders the server\'s lines verbatim')
  // Composing its own summary is exactly the divergence this round exists to prevent.
  assert.doesNotMatch(body, /conclusions|calm|gap\b/, 'the client must not re-derive the context')
})

test('⛔ the browser sends the section ID, never the lines', () => {
  assert.match(APP_JS, /attachSection/)
  assert.doesNotMatch(APP_JS, /attachLines|attachedLines\s*:/,
    'browser-supplied lines would be a way to put arbitrary text into the prompt wearing the section name')
})

test('the composer is PRESENT on the section view, unlike 首頁', () => {
  const i = APP_JS.indexOf('function showSection')
  const body = APP_JS.slice(i, APP_JS.indexOf('\n  function ', i + 10))
  assert.match(body, /showComposer\(\s*true\s*\)/, 'Round B is where the composer arrives — with visible context')
})

test('⛔ sending from a section opens an ORDINARY conversation that appears in the list', () => {
  // The conversation is created on SEND, not on open — an empty conversation is not history.
  const { codeOnly } = require('../testutil/codeOnly')
  const code = codeOnly(APP_JS)
  const i = code.indexOf('function submit')
  const body = code.slice(i, i + 700)
  assert.match(body, /newConversation\(/,
    'a hidden per-section thread would be a conversation he cannot find again')
  assert.match(body, /carry/, 'and the attachment is captured before newConversation clears it')
})

test('⛔ the attachment rides the FIRST turn only — no lingering scope', () => {
  const { codeOnly } = require('../testutil/codeOnly')
  const code = codeOnly(APP_JS)
  const i = code.indexOf('function submit')
  const body = code.slice(i, i + 700)
  assert.match(body, /var carry = attachedKind/,
    'a context that quietly persisted for ten turns is the invisible carried state this removes')
})

test('the topic is not restricted — there is no relevance check anywhere', () => {
  const { codeOnly } = require('../testutil/codeOnly')
  const code = codeOnly(APP_JS)
  assert.doesNotMatch(code, /isRelevantTo|offTopic|onlyAbout/,
    'judging whether a question belongs to a section is M-5 with a new surface')
})

/**
 * ⛔ HR-7, CAUGHT AT THE SERVED STRING AND NOT BY THE SUITE.
 *
 * The settings offer was computed correctly server-side, attached to the envelope, and the
 * browser threw it away — exactly the defect HR-7 records for the work-order offer. 「Correct
 * server-side and absent to the Owner is a whole failure.」
 */
test('⛔ the settings offer is RENDERED, not merely delivered', () => {
  assert.match(APP_JS, /res\.settingsOffer/, 'the envelope carries it; something must draw it')
  assert.match(APP_JS, /function renderSettingsOffer/)
})

test('⛔ it renders BEFORE the clarification branch, which is what ate the last one', () => {
  const i = APP_JS.indexOf('res.settingsOffer')
  const j = APP_JS.indexOf("res.demoOutcome === 'clarification'")
  assert.ok(i > 0 && j > 0 && i < j,
    'placed after it, the offer could only ever render on turns that did not need it — HR-7')
})

test('the offer shows before → after, and the button posts the MESSAGE not the value', () => {
  const i = APP_JS.indexOf('function renderSettingsOffer')
  const body = APP_JS.slice(i, APP_JS.indexOf('\n  function ', i + 10))
  assert.match(body, /offer\.from/)
  assert.match(body, /offer\.to/)
  assert.match(body, /lastOwnerMessage/, 'the server re-derives; a value posted from here would be ignored')
  assert.doesNotMatch(body, /value:\s*offer\.to/, 'posting the value would let the browser choose it')
})

test('⛔ a non-live change says so BEFORE he presses', () => {
  const i = APP_JS.indexOf('function renderSettingsOffer')
  const body = APP_JS.slice(i, APP_JS.indexOf('\n  function ', i + 10))
  assert.match(body, /appliesOn !== 'LIVE'/, 'a change that will not take effect must not look like one that will')
})
