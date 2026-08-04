'use strict'

/**
 * workingIndicator.test.js — which conversation is still working.
 *
 * Since 22d77c5 a reply lands in its own conversation while the Owner reads another one.
 * That is correct, and it created a new blind spot: nothing on screen says which
 * conversation is still waiting. This is the indicator for it.
 *
 * ── THE RULE THAT MATTERS MOST ───────────────────────────────────────────────
 * IT MUST NEVER BE LEFT SPINNING. A stuck indicator is worse than none: it promises
 * something is coming that never will. So the clear happens in the ONE place that runs on
 * every outcome — the terminal `.then()` after both the success handler and the catch —
 * not in each branch where a future branch could forget it.
 *
 * ── AND IT IS THE CONVERSATION'S STATE, NOT THE PAGE'S ───────────────────────
 * Tied to `conv`, the same object 22d77c5 threads through turn/addUser/addBot. There is
 * deliberately no module-level "working" flag: two conversations can be in flight at once,
 * and a second source of truth is how they would disagree.
 *
 * STATIC ASSERTIONS over the served bundle, as with the sidebar work — no test-time DOM,
 * no jsdom, so none of this proves the browser animates anything. The Owner checks that.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { DEMO_HTML } = require('./demoHtml')
const APP_JS = fs.readFileSync(path.join(__dirname, 'assets', 'app.js'), 'utf8')
const APP_CSS = fs.readFileSync(path.join(__dirname, 'assets', 'app.css'), 'utf8')

const submit = () => APP_JS.slice(APP_JS.indexOf('function submit ()'), APP_JS.indexOf('function render (status'))

/* ═══ set on send, tied to the conversation ═════════════════════════════════ */

test('*** the flag is set when the turn is sent, on the conversation itself ***', () => {
  const s = submit()
  assert.ok(/conv\.working = true/.test(s), 'set on send')
  assert.ok(s.indexOf('conv.working = true') > s.indexOf('var conv = active'),
    'after the conversation is captured, so it can never land on the wrong one')
  assert.ok(s.indexOf('conv.working = true') < s.indexOf('fetch('), 'and before the request goes out')
})

test('*** there is no global working flag — two conversations can work at once ***', () => {
  // A page-level flag would be a second source of truth, and the two would disagree the
  // first time the Owner sent a second message while the first was still in flight.
  assert.equal(/^\s*var working\b/m.test(APP_JS), false, 'no module-level working variable')
  // Counting the word was the wrong instrument twice over — a comment mentions it, and the
  // CSS class `conv-working` contains it. What actually matters is that nothing ever reads
  // or writes a BARE `working` identifier: every use is a property of a conversation.
  const code = APP_JS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.equal(/(^|[^.\w-])working\s*=/.test(code), false, 'nothing assigns a bare `working`')
  assert.equal(/(var|let|const)\s+working\b/.test(code), false, 'and nothing declares one')
  assert.ok(/conv\.working = true/.test(code) && /conv\.working = false/.test(code),
    'the state lives on the conversation object')
})

/* ═══ cleared on EVERY outcome ══════════════════════════════════════════════ */

test('*** it is cleared in the terminal step that runs after success AND failure ***', () => {
  const s = submit()
  // The terminal .then() is the only place that cannot be skipped by a future branch.
  const tail = s.slice(s.lastIndexOf('}).then(function ()'))
  assert.ok(/conv\.working = false/.test(tail), 'cleared where every path converges')
  assert.ok(/renderConvList\(\)/.test(tail), 'and the row is redrawn so the clear is visible')
})

test('*** a failed turn does not leave it spinning ***', () => {
  const s = submit()
  const catchBlock = s.slice(s.indexOf('}).catch(function ()'), s.lastIndexOf('}).then(function ()'))
  assert.ok(/addError\([^)]*, conv\)/.test(catchBlock), 'the error goes to the conversation that asked')
  // The terminal step clears it, so the catch does not have to remember to.
  const tail = s.slice(s.lastIndexOf('}).then(function ()'))
  assert.ok(/conv\.working = false/.test(tail))
})

/* ═══ where it renders ══════════════════════════════════════════════════════ */

test('*** the indicator sits at the LEFT of the title ***', () => {
  const fn = APP_JS.slice(APP_JS.indexOf('function renderConvList'), APP_JS.indexOf('function titleFrom'))
  assert.ok(/conv-working/.test(fn), 'the indicator is rendered')
  assert.ok(fn.indexOf("'conv-working'") < fn.indexOf("'conv' + (c === active"),
    'appended before the title button, so it is on the left')
  assert.ok(/aria-hidden/.test(fn), 'decorative — the state is not conveyed by colour alone to a reader')
})

test('the placeholder is always present so titles stay aligned', () => {
  const fn = APP_JS.slice(APP_JS.indexOf('function renderConvList'), APP_JS.indexOf('function titleFrom'))
  // Rendered unconditionally; only the `on` class is conditional. A dot that appears and
  // disappears would shift every title sideways as replies come and go.
  assert.ok(/'conv-working' \+ \(c\.working \? ' on' : ''\)/.test(fn))
})

/* ═══ the CSS ═══════════════════════════════════════════════════════════════ */

test('*** the avatar orange became a token instead of a second literal ***', () => {
  assert.ok(/--dot:\s*#FFA02E/i.test(APP_CSS), 'promoted to a token')
  // app.css documents that this colour is identical in both themes BY CONSTRUCTION. A dark
  // override would quietly break that, so there must not be one.
  const dark = APP_CSS.slice(APP_CSS.indexOf('@media (prefers-color-scheme: dark)'))
  assert.equal(/--dot:/.test(dark), false, 'never overridden in the dark block')
})

test('*** the indicator reuses the existing blink, and respects reduced motion ***', () => {
  assert.ok(/\.conv-working\.on \{[^}]*animation: blink/.test(APP_CSS), 'reuses the keyframes .typing already defines')
  assert.ok(/prefers-reduced-motion[^}]*\}[\s\S]{0,200}\.conv-working\.on \{ animation: none/.test(APP_CSS) ||
            /\.conv-working\.on \{ animation: none/.test(APP_CSS),
    'motion is not forced on someone who asked for less of it')
  assert.ok(/\.conv-working \{[^}]*background: var\(--dot\)/.test(APP_CSS), 'uses the token, not a literal')
})

test('the added block introduces no other literal colour or size', () => {
  // CRLF-SAFE. `indexOf('\n\n')` finds nothing in a CRLF file, so the slice ran to the end
  // of the stylesheet and read every pre-existing literal — the same trap as last round.
  const from = APP_CSS.indexOf('.conv-working {')
  const rest = APP_CSS.slice(from)
  const end = rest.search(/\r?\n\r?\n/)
  const added = end === -1 ? rest : rest.slice(0, end)
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(added), false, 'no literal colours outside the token')
})

test('all of it reaches the SERVED page', () => {
  for (const s of ['conv-working', '--dot', 'conv.working = true']) {
    assert.ok(DEMO_HTML.includes(s), 'missing from the served page: ' + s)
  }
})
