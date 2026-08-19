'use strict'

/**
 * resultToConversation.test.js — the finished run says so IN THE CONVERSATION.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHAT WAS MISSING. The Agent Bridge already runs Claude Code, and the server already
 * returns an Owner-facing projection of the outcome — headline, lines — which the page
 * already polls and renders into the approval card. The Owner still had to go and READ that
 * card. The result never arrived where he was actually looking: the chat.
 *
 * ⛔ SO THIS PRESENTS, AND ONLY PRESENTS. No model is asked to summarise a result the server
 * has already normalised — a second interpretation of the same facts is a second thing that
 * can be wrong, and the two would eventually disagree about the same run.
 *
 * ── HOW THIS FILE TESTS A BROWSER BUNDLE, STATED PLAINLY ─────────────────────
 * This repo has no jsdom and adds no dependency, and `assets/app.js` is not standalone JS at
 * all: it carries a build-time placeholder, so `node --check` cannot even parse it. The
 * neighbouring UI tests (copyMessage, uiStageA) are therefore STATIC assertions and say so.
 *
 * Static assertions cannot answer 「poll the same finished result three times — how many
 * messages?」, which is the question that matters most here. So the DECISION was written as a
 * function with no DOM in it, and this file EXTRACTS THAT FUNCTION FROM THE SERVED BUNDLE and
 * runs it for real. Not a copy kept in a test — the bytes the browser gets. Everything that
 * genuinely needs the DOM (which element, which thread) stays a static assertion, and the
 * boundary between the two is stated per test rather than blurred.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const APP_JS = fs.readFileSync(path.join(__dirname, 'assets', 'app.js'), 'utf8')

/**
 * THE REAL FUNCTION, LIFTED OUT OF THE REAL BUNDLE. If it is renamed, moved, or its closing
 * boundary changes, this throws rather than silently testing nothing.
 */
function extractClaim () {
  // ⛔ THE CONSTANT COMES WITH IT. The first version of this sliced the function alone and
  // left TERMINAL_RESULT_STATUS behind, so every case that reached the status list threw
  // ReferenceError — and four tests still went GREEN, because `finished === true` short
  // circuits before the list is touched. They were passing for a reason they did not name.
  // The slice now starts at the constant, so the real vocabulary is what gets exercised.
  const start = APP_JS.indexOf('var TERMINAL_RESULT_STATUS')
  assert.notEqual(start, -1, 'the terminal-status vocabulary is missing from the served bundle')
  const end = APP_JS.indexOf('function watchProgress (', start)
  assert.notEqual(end, -1, 'the extraction boundary moved')
  const src = APP_JS.slice(start, end)
  assert.ok(src.includes('function claimTerminalResult ('), 'the slice does not contain the decision')
  assert.ok(src.includes('seen[approvalId] = true'), 'the extracted slice is not the real body')
  // eslint-disable-next-line no-new-func
  return new Function(src + '; return claimTerminalResult')()
}

const claimTerminalResult = extractClaim()

const DONE = (over) => Object.assign({
  approvalId: 'A1',
  status: 'done',
  finished: true,
  headline: '改咗 1 個檔案，測試通過。',
  lines: ['src/demo/assets/app.js', '+12 −0']
}, over)

const RUNNING = (over) => Object.assign({
  approvalId: 'A1',
  status: 'running',
  finished: false,
  headline: '執行緊…',
  lines: ['clone']
}, over)

/* ═══ A / B — a terminal result earns exactly one message ═══════════════════ */

test('*** A — TERMINAL SUCCESS becomes exactly one chat presentation ***', () => {
  const seen = {}
  const out = claimTerminalResult(seen, 'A1', DONE())
  assert.ok(out, 'a finished run must reach the conversation')
  assert.equal(out.kind, 'done')
  assert.ok(out.text.includes('改咗 1 個檔案，測試通過。'), 'the server headline is what is shown')
  assert.ok(out.text.includes('+12 −0'), 'and its normalised lines')
})

test('*** ⛔ B — TERMINAL FAILURE ARRIVES TOO, AND STAYS A FAILURE ***', () => {
  /**
   * ⛔ A failure that quietly does not appear is worse than no feature: the Owner approved
   * something, saw a message for the runs that worked, and would reasonably read silence as
   * 「still going」. Every terminal state reports.
   */
  for (const status of ['failed', 'timeout', 'refused']) {
    const out = claimTerminalResult({}, 'A1', DONE({ status, headline: '未能完成：' + status }))
    assert.ok(out, status + ' must still reach the conversation')
    assert.equal(out.kind, 'fail', '⛔ ' + status + ' was presented as a success')
    assert.ok(out.text.includes('未能完成'), 'the failure headline is not softened or replaced')
  }
})

test('*** the status vocabulary is really consulted, not bypassed by `finished` ***', () => {
  // A terminal STATUS with finished absent must still report — this is the path that the
  // first version of this file never actually executed.
  const out = claimTerminalResult({}, 'A1', { status: 'failed', headline: '失敗咗。' })
  assert.ok(out, 'a terminal status alone is terminal')
  assert.equal(out.kind, 'fail')
  assert.equal(claimTerminalResult({}, 'A1', { status: 'queued', headline: 'x' }), null,
    'and an unknown status is NOT terminal')
})

/* ═══ C — nothing terminal, nothing said ═══════════════════════════════════ */

test('*** ⛔ C — A RUN STILL IN FLIGHT PRODUCES NO CHAT MESSAGE ***', () => {
  /**
   * The progress card already shows the phases and updates in place. A permanent chat
   * message every 1.5s would outlive the run and bury the conversation.
   */
  const seen = {}
  assert.equal(claimTerminalResult(seen, 'A1', RUNNING()), null)
  assert.equal(claimTerminalResult(seen, 'A1', RUNNING({ status: 'starting' })), null)
  assert.deepEqual(seen, {}, '⛔ an unfinished run must not consume its one-time claim')
})

/* ═══ D — the polling loop must not repeat itself ══════════════════════════ */

test('*** ⛔ D — THE SAME FINISHED RESULT, POLLED MANY TIMES, IS SAID ONCE ***', () => {
  const seen = {}
  const first = claimTerminalResult(seen, 'A1', DONE())
  assert.ok(first, 'the first sighting speaks')
  for (let i = 0; i < 5; i++) {
    assert.equal(claimTerminalResult(seen, 'A1', DONE()), null,
      '⛔ poll ' + (i + 2) + ' produced a duplicate message')
  }
})

test('*** ⛔ E — TWO APPROVALS FINISHING INDEPENDENTLY EACH GET THEIR OWN ONE ***', () => {
  const seen = {}
  assert.ok(claimTerminalResult(seen, 'A1', DONE({ approvalId: 'A1' })))
  assert.ok(claimTerminalResult(seen, 'A2', DONE({ approvalId: 'A2', headline: '第二單完成。' })),
    '⛔ one approval silenced another — the marker is not keyed by approvalId')
  assert.equal(claimTerminalResult(seen, 'A1', DONE()), null, 'and neither repeats')
  assert.equal(claimTerminalResult(seen, 'A2', DONE({ approvalId: 'A2' })), null)
})

/* ═══ K — only the normalised projection may cross ═════════════════════════ */

test('*** ⛔ K — NOTHING BUT headline AND lines REACHES THE CONVERSATION ***', () => {
  /**
   * ⛔ THE ENDPOINT ALREADY DECIDED WHAT THE OWNER SEES. Where it dropped a detail — raw CLI
   * output, the command, an Error message, a token — the chat may not put it back from
   * another field of the same payload. Everything below is real payload shape.
   */
  const body = DONE({
    sections: [{ title: 'diff', body: 'SECTION_MUST_NOT_APPEAR' }],
    result: { ok: true, stdout: 'RAW_STDOUT_MUST_NOT_APPEAR', stderr: 'RAW_STDERR', reason: 'RAW_REASON' },
    facts: { branch: 'agent/x', costCapUsd: 5, allowedFiles: ['a.js'] },
    phases: [{ phase: 'CLONE', label: 'PHASE_LABEL_MUST_NOT_APPEAR', at: 1 }],
    error: 'ANTHROPIC_API_KEY=sk-SECRET rejected by https://internal.example/h',
    command: 'claude -p GOAL --allowedTools Edit'
  })
  const out = claimTerminalResult({}, 'A1', body)
  assert.ok(out)
  for (const banned of [
    'SECTION_MUST_NOT_APPEAR', 'RAW_STDOUT_MUST_NOT_APPEAR', 'RAW_STDERR', 'RAW_REASON',
    'PHASE_LABEL_MUST_NOT_APPEAR', 'sk-SECRET', 'internal.example', 'ANTHROPIC_API_KEY',
    'agent/x', 'allowedTools', 'claude -p'
  ]) {
    assert.equal(out.text.includes(banned), false, '⛔ unprojected content reached the chat: ' + banned)
  }
  assert.deepEqual(Object.keys(out).sort(), ['kind', 'text'])
})

test('*** a projection with nothing to say says nothing ***', () => {
  assert.equal(claimTerminalResult({}, 'A1', { status: 'done', finished: true }), null)
  assert.equal(claimTerminalResult({}, 'A1', { status: 'done', finished: true, headline: '', lines: [] }), null)
  assert.equal(claimTerminalResult({}, 'A1', null), null)
  assert.equal(claimTerminalResult({}, '', DONE()), null)
})

/* ═══ WIRING — the parts that genuinely need the DOM, asserted statically ══ */

const finishBody = () => {
  const i = APP_JS.indexOf('function finish (state, body) {')
  assert.notEqual(i, -1, 'the terminal point of the run moved')
  return APP_JS.slice(i, APP_JS.indexOf('function tick ()', i))
}

test('*** F — THE EXISTING RESULT CARD IS ADDED TO, NEVER REPLACED ***', () => {
  const body = finishBody()
  assert.ok(body.includes('renderResult(card, body)'), 'the card still renders its result')
  assert.ok(/done-mark|fail-mark/.test(body), 'and still marks itself ✓ / ✕')
  assert.ok(body.indexOf('renderResult(card, body)') < body.indexOf('claimTerminalResult('),
    'the chat message is added AFTER the card, not in place of it')
})

test('*** ⛔ G + H + I — PRESENTING COSTS NO MODEL CALL, NO FETCH, NO WRITE ***', () => {
  const body = finishBody()
  const claim = APP_JS.slice(APP_JS.indexOf('function claimTerminalResult ('), APP_JS.indexOf('function watchProgress ('))
  for (const region of [body, claim]) {
    assert.equal(/fetch\(/.test(region), false, '⛔ presentation added a network call')
    assert.equal(/method:\s*'POST'/.test(region), false, '⛔ presentation writes something')
    assert.equal(/providerHint|\/intake|adapter/.test(region), false, '⛔ presentation reaches a model')
  }
  // It is handed the body the card ALREADY fetched — no second call to the same endpoint.
  assert.ok(body.includes('claimTerminalResult(presentedResults, approvalId, body)'),
    'the already-fetched poll body is reused')
})

test('*** ⛔ J — THE RESULT MESSAGE IS NOT MODEL-AUTHORED HISTORY ***', () => {
  /**
   * ⛔ `conv.history` is what the NEXT ordinary chat request sends as the conversation so
   * far. She did not author this sentence — the runner did and the server phrased it — and
   * an execution report re-entering the prompt as her own prior turn would have her answer
   * later questions from words she never said.
   *
   * Rendering and history are separate in this bundle by construction: every entry is an
   * explicit `history.push`, and none of them lives in a render helper. This pins BOTH that
   * the new code adds no push AND that the total number of push sites did not grow.
   */
  const pushes = [...APP_JS.matchAll(/history\.push\(/g)].length
  assert.equal(pushes, 4, '⛔ a new history entry point appeared — count it before trusting it')

  const claimStart = APP_JS.indexOf('var TERMINAL_RESULT_STATUS')
  const region = APP_JS.slice(claimStart, APP_JS.indexOf('function tick ()', claimStart))
  assert.equal(/history\.push/.test(region), false, '⛔ the result message entered model history')
  assert.equal(/conv\.history/.test(region), false, '⛔ the result path touches the history array at all')
  // It renders through the ordinary assistant helper, which is itself push-free.
  const addBot = APP_JS.slice(APP_JS.indexOf('function addBot'), APP_JS.indexOf('function addError'))
  assert.equal(/history/.test(addBot), false, 'addBot renders and does not record')
})

test('*** L — ORDINARY CHAT IS UNTOUCHED UNTIL A RUN FINISHES ***', () => {
  // The whole feature hangs off finish(), which only the approval watcher can reach. No
  // ordinary-turn code path was modified: the send path still pushes exactly its two entries.
  const send = APP_JS.slice(APP_JS.indexOf("conv.history.push({ role: 'user'"), APP_JS.indexOf('renderConvList() // the conversation has content now'))
  assert.equal(/claimTerminalResult|presentedResults/.test(send), false,
    '⛔ the ordinary chat turn now runs result-presentation code')
  assert.ok(send.includes("conv.history.push({ role: 'assistant', text: o.body.reply })"),
    'and it still records the real reply exactly as before')
})

test('*** the message lands in the conversation the request came from ***', () => {
  const body = finishBody()
  assert.ok(body.includes('addBot(presented.text, conv)'), 'rendered as an assistant message in that conversation')
  assert.ok(APP_JS.includes('function watchProgress (approvalId, card, sealed, conv)'), 'conv reaches the watcher')
  assert.ok(APP_JS.includes('watchProgress(sealed.approvalId, card, sealed, conv)'), 'and the call site passes it')
  assert.ok(APP_JS.includes('renderCard(o.body, conv)'), 'threaded from the work-order response')
})
