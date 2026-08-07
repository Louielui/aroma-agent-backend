'use strict'
/**
 * homeBriefingClient.test.js — 首頁 on screen.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE SPLIT, AND WHY IT HAD TO BE DESIGNED RATHER THAN PLACED.
 *
 * Measured in `app.js`: `renderEmptyScreen` returns early once `c.history.length > 0`, so
 * today's greeting — and the Franco line attached to it — **vanish on the first keystroke.**
 * A briefing that disappears when he starts typing is worse than no briefing: a stopped
 * errand would leave the screen at the exact moment he is doing something else.
 *
 * So: **the full briefing lives on the empty screen. Anything WAITING persists above the
 * thread.** 有死線嗰啲留低,其餘等下次空畫面。
 * ══════════════════════════════════════════════════════════════════════════════
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const APP_JS = fs.readFileSync(path.join(__dirname, 'assets', 'app.js'), 'utf8')
const APP_CSS = fs.readFileSync(path.join(__dirname, 'assets', 'app.css'), 'utf8')

test('the client asks the briefing endpoint, not the greeting alone', () => {
  assert.match(APP_JS, /\/api\/v1\/home\/briefing/,
    'if this is absent, nothing built yesterday reaches the screen')
})

test('⛔ the WAITING bar is rendered OUTSIDE the empty-screen guard', () => {
  // The whole point of the split. If waiting renders inside renderEmptyScreen, it inherits
  // `c.history.length > 0 → return` and disappears on the first keystroke.
  const i = APP_JS.indexOf('function renderWaitingBar')
  assert.ok(i > 0, 'renderWaitingBar must exist as its own function')
  // Its whole body, by brace balance. An earlier version sliced to the first `}\n`, which is
  // -1 on a CRLF file, so slice(0,-1) took the WHOLE FILE and matched a guard in a different
  // function. The test was wrong, not the code.
  let depth = 0
  let end = i
  for (let k = APP_JS.indexOf('{', i); k < APP_JS.length; k++) {
    if (APP_JS[k] === '{') depth++
    else if (APP_JS[k] === '}') { depth--; if (depth === 0) { end = k; break } }
  }
  const body = APP_JS.slice(i, end)
  assert.ok(body.length > 200, 'the body must be found, not an empty slice')
  assert.doesNotMatch(body, /history\.length > 0/,
    'the bar must not re-derive the empty-screen guard inside itself')
  // It is called from OUTSIDE renderEmptyScreen, so a conversation with history still gets it.
  // (An earlier version of this assertion pinned `renderWaitingBar()` with no argument; the
  // stand-in rule now passes `briefingVisible`, so the regex was updated, not the rule.)
  assert.match(APP_JS, /else renderEmptyScreen\(c\)\r?\n[\s\S]{0,300}renderWaitingBar\(/,
    'selectConversation must call it outside the empty-screen path')
})

test('the three outcomes reach the DOM as distinct classes, never merged', () => {
  for (const cls of ['out-answered', 'out-stopped', 'out-blocked']) {
    assert.match(APP_JS, new RegExp(cls), cls + ' missing — the three outcomes must not merge')
    assert.match(APP_CSS, new RegExp('\\.' + cls), cls + ' has no style')
  }
})

test('⛔ an empty errand list SAYS WHY it is empty', () => {
  // Owner ruling: never-blank applies to a section empty for a REASON as much as one empty
  // by failure. 「未有差事紀錄」 with its cause, not a blank box.
  assert.match(APP_JS, /未有差事紀錄/)
  assert.match(APP_JS, /手動跑/, 'it must name the cause: every errand so far was run by hand')
})

test('⛔ 「cannot read」 and 「nothing waiting」 render as different lines', () => {
  assert.match(APP_JS, /睇唔到差事紀錄/)
  assert.match(APP_JS, /冇嘢等你/)
  // and the client must branch on the server's state rather than on emptiness
  assert.match(APP_JS, /CANNOT_READ/)
  assert.match(APP_JS, /NOTHING_WAITING/)
})

test('every section renders its timestamp', () => {
  assert.match(APP_JS, /checkedAt/, 'a claim without a time is not a claim')
})

test('the stop report is INLINE — the five fields, not a link to a report', () => {
  for (const f of ['filled', 'notPressed', 'amount', 'whichLayer', 'where']) {
    assert.match(APP_JS, new RegExp('\\b' + f + '\\b'), f + ' missing from the waiting card')
  }
})

test('an aged amount is struck, and an expired one is absent rather than decorated', () => {
  assert.match(APP_JS, /amountStruck/)
  assert.match(APP_CSS, /\.amount-struck[^}]*line-through/)
})

test('⛔ the open button is a POST, never an <a href>', () => {
  const near = APP_JS.slice(APP_JS.indexOf('openHref') - 400, APP_JS.indexOf('openHref') + 900)
  assert.match(near, /method:\s*'POST'/,
    'a cart lives in the session that built it — an href opens HIS Chrome and shows an empty cart')
})

test('the button reports the lock refusal instead of retrying', () => {
  assert.match(APP_JS, /PROFILE_IN_USE/)
  assert.doesNotMatch(APP_JS, /retryOpen|setTimeout\([^)]*open/,
    'a refusal is an answer, not a thing to try again')
})

test('the Franco line is its own row, not glued to the greeting', () => {
  assert.match(APP_JS, /brief-backlog/)
  // and the old greeting-attached rendering is gone
  assert.doesNotMatch(APP_JS, /empty-backlog/,
    'the Drive line moved off the greeting, where the Owner said it does not belong')
})

test('the CSS uses tokens, not raw px, in the new rules', () => {
  const block = APP_CSS.slice(APP_CSS.indexOf('/* ── 首頁'))
  assert.ok(block.length > 200, 'the briefing styles must exist')
  const offenders = block.match(/font-size:\s*\d+px/g) || []
  assert.deepEqual(offenders, [], 'font sizes come from tokens: ' + offenders.join(', '))
})

test('⛔ NOT_WIRED renders as a DEFECT, never as 「未有差事紀錄」', () => {
  assert.match(APP_JS, /NOT_WIRED/,
    'a wiring failure must not fall through to the empty-for-a-reason line — that would be a lie')
  assert.match(APP_JS, /brief-defect/)
  assert.match(APP_CSS, /\.brief-defect/)
})

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * ONE SENTENCE DECIDES BOTH THE ORDER AND THE GATING:
 *
 *   > 首頁 shows waiting FIRST; the bar is the briefing's STAND-IN when the briefing is gone.
 *
 * Before this, the order was 「Drive, errands, waiting」 — 而 Drive 排第一，係因為佢先存在。
 * A layout decision nobody made. And the bar was not gated at all, so on the empty screen a
 * waiting item rendered TWICE: a collapsed count at the top, the useful card at the bottom.
 * Nothing was waiting yet, so neither of us had seen it.
 * ══════════════════════════════════════════════════════════════════════════════
 */
test('⛔ WAITING is rendered FIRST, and the Drive line LAST', () => {
  const b = APP_JS.slice(APP_JS.indexOf('function renderBriefing'))
  const iWaiting = b.indexOf('b.waiting')
  const iErrands = b.indexOf('b.errands')
  const iBacklog = b.indexOf('b.backlog')
  assert.ok(iWaiting > 0 && iErrands > 0 && iBacklog > 0, 'all three sections must render')
  assert.ok(iWaiting < iErrands,
    'the thing with a deadline goes first — the briefing already persists only deadline items')
  assert.ok(iErrands < iBacklog,
    'standing state that changes once a day goes last, however tall it is')
})

test('⛔ the bar is the briefing\'s STAND-IN — it does not render while the briefing is visible', () => {
  const i = APP_JS.indexOf('function renderWaitingBar')
  let depth = 0
  let end = i
  for (let k = APP_JS.indexOf('{', i); k < APP_JS.length; k++) {
    if (APP_JS[k] === '{') depth++
    else if (APP_JS[k] === '}') { depth--; if (depth === 0) { end = k; break } }
  }
  const body = APP_JS.slice(i, end)
  assert.match(body, /briefingVisible/,
    'without this the same waiting item renders twice, and the useful copy is the lower one')
  assert.match(APP_JS, /renderWaitingBar\(\s*briefingVisible\s*\)|renderWaitingBar\(!/,
    'selectConversation must tell it whether the briefing is on screen')
})

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * > **Owner: 「時間戳唔係新鮮度。A row that knows how stale it is allowed to be is honest with
 * > or without a scheduler; a row that only knows when it ran is not.」**
 *
 * The server now sends `errands.freshness` — one entry per DECLARED KIND, not per row, so a
 * thing that never ran can still be reported. A freshness line nobody renders is the fourth
 * component this month that passed its tests and was wired to nothing.
 * ══════════════════════════════════════════════════════════════════════════════
 */
test('⛔ the freshness lines are RENDERED — not merely delivered', () => {
  assert.match(APP_JS, /freshness/,
    'the server computes it; if the client never reads it, the briefing is still just timestamps')
  assert.match(APP_JS, /brief-fresh/)
  assert.match(APP_CSS, /\.brief-fresh/)
})

test('⛔ freshness renders on the EMPTY store path too — that is when it matters most', () => {
  // 「未有差事紀錄」 says nothing about WHAT was never done. The NEVER_RUN line does.
  // Guarded structurally: the empty branch must not return before the freshness block.
  const i = APP_JS.indexOf('function renderBriefing')
  const body = APP_JS.slice(i, APP_JS.indexOf('/** The stop report', i))
  const iEmpty = body.indexOf('未有差事紀錄')
  const iFresh = body.indexOf('freshness')
  assert.ok(iEmpty > 0 && iFresh > 0, 'both branches must exist')
  assert.doesNotMatch(body.slice(iEmpty, iEmpty + 300), /\breturn\b/,
    'the empty-errands branch must not return before freshness is rendered')
})

test('DUE and NEVER_RUN are visually distinct from FRESH, but none of them is an alarm', () => {
  for (const s of ['DUE', 'NEVER_RUN']) {
    assert.match(APP_JS, new RegExp(s), s + ' must be branched on, not lumped in with FRESH')
  }
  // ⛔ With no scheduler every kind is DUE most of the time — that is the NORMAL state of a
  // thing he runs by hand. Red would train him to ignore the line within a week.
  const block = APP_CSS.slice(APP_CSS.indexOf('.brief-fresh'))
  const head = block.slice(0, 900)
  assert.doesNotMatch(head, /#(f00|ff0000|e74c3c|d32f2f)/i, 'DUE is a fact, not a fault')
})
