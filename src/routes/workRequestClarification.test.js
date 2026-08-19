'use strict'

/**
 * workRequestClarification.test.js — he asked clearly; one thing was missing.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE DEFECT. 「幫我改個訂貨頁」 is not ambiguous about WHETHER work is wanted —
 * `isChangeRequest` already returned ok, and `inferWorkRequest` had already composed the one
 * sentence to ask: 「你想改哪個檔？」. `explainOffer` then threw that question away and returned a
 * bare `incomplete`, so the turn fell back into ordinary chat and read as if she had not
 * understood him at all. The capability was built; only the wire was missing.
 *
 * ⛔ AND THE REASON IT MUST STAY A QUESTION. There is no trusted catalogue in this repository
 * mapping 「訂貨頁」 to a file — measured in the P1-C1b preflight, not assumed. So the only
 * honest move for a missing target is to ask. Guessing a path would put an invented file into
 * a sealed Work Order, which is the one thing this whole chain exists to prevent.
 *
 * ⛔ INCOMPLETE CREATES NOTHING. No Task, no Proposal, no Work Order, no approvalId, no Run,
 * no executor. The clarification is one sentence and one empty box.
 *
 * ── HOW THE TWO HALVES ARE TESTED ────────────────────────────────────────────
 * The decision is server-side and is executed here for real. The rendering is in a browser
 * bundle that this repo has no DOM for (and adds no dependency), so those are static
 * assertions over the served string — the same honesty the neighbouring UI tests state about
 * themselves. Which half a test belongs to is said per test rather than blurred.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { explainOffer, WORK_REQUEST_STATE } = require('./workRequestOffer')
const { createDemoRouter } = require('./demoRouter')
const { buildDemoHtml } = require('../demo/demoHtml')

const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'demo', 'assets', 'app.js'), 'utf8')

const PATHLESS = '香香，幫我改個訂貨頁'
const COMPLETE = '幫我改 docs/notes.md，加一句備註'

const decide = (message, hasProposal) => explainOffer({ message, hasProposal: !!hasProposal })

/* ═══ A — the pathless request is recognised, and asks ══════════════════════ */

test('*** ⛔ A — A PATHLESS WORK REQUEST ASKS ONE QUESTION AND CREATES NOTHING ***', () => {
  const d = decide(PATHLESS)
  assert.equal(d.state, WORK_REQUEST_STATE.INCOMPLETE, '⛔ a clear request was classified as not-a-request')
  assert.equal(d.offer, null, 'nothing executable is offered')
  assert.ok(d.clarification && typeof d.clarification.question === 'string' && d.clarification.question.length > 0,
    '⛔ the question inferWorkRequest already composed was dropped again')
  assert.deepEqual(d.clarification.missing, ['file'], 'and it asks for exactly what is missing')
  // Nothing that could authorise or identify anything may appear on this object.
  assert.deepEqual(Object.keys(d.clarification).sort(), ['candidates', 'forbidden', 'missing', 'question'])
  for (const k of ['proposalId', 'approvalId', 'runId', 'workOrder', 'file', 'hash', 'nonce']) {
    assert.equal(k in d.clarification, false, '⛔ an incomplete request carried ' + k)
  }
})

/* ═══ B — the complete path is untouched ═══════════════════════════════════ */

test('*** B — A COMPLETE REQUEST STILL PRODUCES THE SAME OFFER AS BEFORE ***', () => {
  const d = decide(COMPLETE)
  assert.equal(d.state, WORK_REQUEST_STATE.COMPLETE)
  assert.deepEqual(d.offer, { file: 'docs/notes.md', intent: '加一句備註', source: 'deterministic' })
  assert.equal(d.reason, null)
  assert.equal('clarification' in d, false, 'a complete offer carries no clarification')
})

/* ═══ C-E — the shapes that must never be asked a question ═════════════════ */

test('*** ⛔ C+D+E — NEGATED, REPORTED, HYPOTHETICAL AND ORDINARY QUESTIONS ARE NOT ASKED ***', () => {
  /**
   * ⛔ THE OWNER'S OWN RULING, PRESERVED. A missed request costs him what today already
   * costs. Asking 「要唔要改?」 after he said 「唔好」 is offensive however inert the box is —
   * which is why the negation guard is deliberately implemented twice, and why an
   * incomplete-state clarification must never reach these.
   */
  const cases = [
    ['唔好改 docs/notes.md', 'C negation'],
    ['千祈唔好改 docs/notes.md', 'C negation'],
    /**
     * ⛔ THESE TWO ARE THE ONLY ONES THE PROXIMITY GUARD CATCHES ALONE, and the first version
     * of this test had neither. Every other refusal above is stopped by the flat
     * requestShape check first, so `refusesChange` — the deliberately-second implementation —
     * was never executed here at all: a mutation that made it hand out clarifications left
     * the whole file green. Measured by mutating it, not by reading the code.
     */
    ['咪住改 docs/notes.md', 'C negation — PROXIMITY GUARD ONLY'],
    ['咪改 docs/notes.md', 'C negation — PROXIMITY GUARD ONLY'],
    ['我啱啱改咗 docs/notes.md', 'D reported / past tense'],
    ['訂貨頁係做咩？', 'E ordinary question'],
    ['今日 lunch 食咩好？', 'E unrelated'],
    ['如果改 docs/notes.md 會點？', 'E hypothetical']
  ]
  for (const [msg, note] of cases) {
    const d = decide(msg)
    assert.equal(d.state, WORK_REQUEST_STATE.NOT_A_WORK_REQUEST, note + ' — must not be a work request')
    assert.equal(d.offer, null, note)
    assert.equal(d.clarification, undefined, '⛔ ' + note + ' was asked a clarification question')
  }
})

test('*** the model path still owns its own turn ***', () => {
  const d = decide(PATHLESS, true)
  assert.equal(d.state, WORK_REQUEST_STATE.NOT_A_WORK_REQUEST)
  assert.equal(d.reason, 'model_path_owns_turn')
  assert.equal(d.clarification, undefined, 'never two affordances for one sentence')
})

/* ═══ F + G — the answer completes it, and the ORIGINAL change survives ════ */

test('*** ⛔ F+G — THE JOINED OWNER TEXT COMPLETES, AND KEEPS THE ORIGINAL CHANGE ***', () => {
  /**
   * ⛔ THE JOIN IS THE LOAD-BEARING PART. The answer alone is 「docs/canary/agent-canary.md」
   * — a path, and nothing about what he wanted done. Sending only the answer would seal a
   * Work Order whose goal was a file path. His sentence comes first; both lines are his.
   */
  const original = '幫我改呢個檔，將標題改做測試'
  const answer = 'docs/canary/agent-canary.md'
  const joined = original + '\n' + answer

  assert.equal(decide(original).state, WORK_REQUEST_STATE.INCOMPLETE, 'it starts out incomplete')

  const d = decide(joined)
  assert.equal(d.state, WORK_REQUEST_STATE.COMPLETE, '⛔ the joined Owner text did not complete')
  assert.equal(d.offer.file, answer, 'the file comes from his answer')
  assert.ok(d.offer.intent.includes('將標題改做測試'), '⛔ the ORIGINAL requested change was lost')
  assert.notEqual(d.offer.intent, answer, '⛔ the goal became a file path')
  assert.equal(d.offer.source, 'deterministic', 'and it is still the deterministic entrance')
})

/* ═══ H-J — answers that must NOT complete anything ════════════════════════ */

test('*** ⛔ H+I+J — VAGUE, CANCELLING AND UNRELATED ANSWERS CREATE NOTHING ***', () => {
  /**
   * ⛔ NO INVENTED PATH, EVER. 「中央廚房嗰個」 is a real thing the Owner means, and this
   * repository has no trusted catalogue that maps it to a file. The honest outcome is to
   * remain incomplete. Resolving it belongs to P1-C1b2, with a real catalogue behind it.
   */
  const original = '幫我改個訂貨頁'
  const answers = [
    ['中央廚房嗰個', 'H still vague', WORK_REQUEST_STATE.INCOMPLETE],
    ['算啦，唔使', 'I cancel', WORK_REQUEST_STATE.NOT_A_WORK_REQUEST],
    ['今日 lunch 食咩好？', 'J unrelated', WORK_REQUEST_STATE.NOT_A_WORK_REQUEST],
    ['唔係訂貨頁，係 supplier 頁', 'correction with no path', WORK_REQUEST_STATE.INCOMPLETE]
  ]
  for (const [answer, note, expected] of answers) {
    const d = decide(original + '\n' + answer)
    assert.equal(d.offer, null, '⛔ ' + note + ' produced an executable offer')
    assert.equal(d.state, expected, note)
    if (d.clarification) {
      assert.equal(d.clarification.forbidden, null, note)
      assert.deepEqual(d.clarification.candidates, [], '⛔ ' + note + ' invented a candidate path')
    }
  }
})

/* ═══ K + L — protected paths and several candidates ══════════════════════ */

test('*** ⛔ K — A PROTECTED PATH IS EXPLAINED, NEVER OFFERED ***', () => {
  const d = decide('幫我改 src/governance/launcherPin.js，放寬個 pin')
  assert.equal(d.offer, null, '⛔ a protected path was offered')
  assert.equal(d.state, WORK_REQUEST_STATE.INCOMPLETE)
  assert.equal(typeof d.clarification.forbidden, 'string', 'the refusal is a structural flag, not prose to parse')
  assert.ok(d.clarification.question.includes('受保護'), 'and the Owner is told why')
  // Answering with the same protected path must still refuse — the box is not a bypass.
  const again = decide('幫我改 src/governance/launcherPin.js，放寬個 pin\nsrc/governance/launcherPin.js')
  assert.equal(again.offer, null, '⛔ re-submitting through the clarification bypassed the protected path')
})

test('*** ⛔ L — SEVERAL NAMED FILES: ONE QUESTION, AND CHOOSING DOES NOT YET RESOLVE IT ***', () => {
  /**
   * ⛔ A MEASURED LIMIT OF THIS TRANCHE, RECORDED RATHER THAN PAPERED OVER.
   *
   * The question is asked correctly and names the choices. But the answer is joined to the
   * Owner's ORIGINAL sentence — which still names both files — so re-deriving from the joined
   * text finds two candidates again and stays incomplete. Choosing does not complete it.
   *
   * ⛔ AND THE FIX IS NOT AVAILABLE HERE. Making the choice count means telling the server
   * 「this line is the answer」, i.e. changing the /owner/work-requests contract — the file
   * this tranche was told to stop before editing. The alternative, letting the page pick one
   * of the candidates and send it as the target, hands target selection to the browser, which
   * the whole chain exists to prevent.
   *
   * So it FAILS CLOSED: no offer, no Proposal, nothing invented. That is the correct direction
   * of failure — an unresolved request costs a retype; a browser-chosen target costs much
   * more. Resolving it properly belongs with P1-C1b2.
   */
  const base = '幫我改 src/a.js 同 src/b.js，加個 log'
  const d = decide(base)
  assert.equal(d.offer, null, 'two files is not a target')
  assert.equal(d.state, WORK_REQUEST_STATE.INCOMPLETE)
  assert.deepEqual(d.clarification.candidates, ['src/a.js', 'src/b.js'])
  assert.ok(d.clarification.question.includes('src/a.js'), 'the question names the choices')

  const chosen = decide(base + '\n' + 'src/a.js')
  assert.equal(chosen.offer, null, '⛔ if this ever offers, a browser-influenced target got through')
  assert.equal(chosen.state, WORK_REQUEST_STATE.INCOMPLETE, 'it stays incomplete — fail closed')
  assert.deepEqual(chosen.clarification.candidates, ['src/a.js', 'src/b.js'],
    'both are still on the table; nothing was silently picked')

  // Retyping the request naming ONE file is what completes it today.
  const retyped = decide('幫我改 src/a.js，加個 log')
  assert.equal(retyped.state, WORK_REQUEST_STATE.COMPLETE, 'a single-file request still works')
  assert.equal(retyped.offer.file, 'src/a.js')
})

/* ═══ the envelope — a real request through the real router ════════════════ */

async function post (router, body) {
  const express = require('express')
  const app = express()
  app.use(express.json())
  app.locals.conversationDemo = true
  app.use(router)
  const server = app.listen(0)
  try {
    const res = await fetch('http://127.0.0.1:' + server.address().port + '/api/v1/demo/intake', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    })
    return { status: res.status, body: await res.json().catch(() => ({})) }
  } finally { server.close() }
}

const chatReply = async () => ({ blocked: false, mode: 'chat', talkOnly: true, reply: '好呀。', proposals: [] })

test('*** ⛔ THE ENVELOPE CARRIES THE QUESTION — AND NOTHING ELSE IS CREATED ***', async () => {
  const router = createDemoRouter({ getAdapterFn: () => ({ label: 'x' }), processIntakeFn: chatReply })
  const res = await post(router, { message: PATHLESS, interactionMode: 'chat' })
  assert.equal(res.status, 200)
  assert.ok(res.body.workRequestClarification, '⛔ the envelope dropped the question again')
  assert.ok(res.body.workRequestClarification.question.length > 0)
  assert.equal('workRequestOffer' in res.body, false, 'an incomplete request is not an offer')
  for (const k of ['proposalId', 'approvalId', 'runId', 'proposals', 'workOrder']) {
    const v = res.body[k]
    assert.ok(v === undefined || (Array.isArray(v) && v.length === 0),
      '⛔ an incomplete request produced ' + k + ': ' + JSON.stringify(v))
  }
})

test('*** ⛔ AN UNRELATED TURN GAINS NO FIELD AT ALL ***', async () => {
  const router = createDemoRouter({ getAdapterFn: () => ({ label: 'x' }), processIntakeFn: chatReply })
  for (const message of ['今日 lunch 食咩好？', '唔好改 docs/notes.md', '我啱啱改咗 docs/notes.md']) {
    const res = await post(router, { message, interactionMode: 'chat' })
    assert.equal('workRequestClarification' in res.body, false,
      '⛔ an ordinary turn gained the field: ' + message)
  }
})

test('*** ⛔ CHAT ONLY — THE PROPOSAL AND EMAIL LANES GAIN NOTHING ***', async () => {
  /**
   * ⛔ CAUGHT BY AN EXISTING TEST, NOT BY THIS ONE. The first version attached the field on
   * whatever lane the turn took, and `laneRouter.test.js` went red on 「proposal envelope
   * unchanged」 — 「修改 canary file」 routes to the PROPOSAL lane, whose consumers must not gain
   * a field because something unrelated to them learned to ask a question. Pinned here too,
   * with the reason, rather than left as somebody else's assertion.
   */
  const envelope = { blocked: false, mode: 'chat', talkOnly: true, reply: 'ok', proposals: [] }
  const router = createDemoRouter({ getAdapterFn: () => ({ label: 'x' }), processIntakeFn: async () => envelope })
  for (const mode of ['proposal', 'email_draft']) {
    const res = await post(router, { message: PATHLESS, interactionMode: mode })
    assert.equal('workRequestClarification' in res.body, false,
      '⛔ the ' + mode + ' envelope gained the field')
  }
  const chat = await post(router, { message: PATHLESS, interactionMode: 'chat' })
  assert.ok(chat.body.workRequestClarification, 'and the chat lane still gets it')
})

/* ═══ the rendering half — static, and it says so ══════════════════════════ */

const renderer = () => {
  const i = APP_JS.indexOf('function renderWorkRequestClarification (')
  assert.notEqual(i, -1, 'the clarification renderer is missing')
  return APP_JS.slice(i, APP_JS.indexOf('function lastOwnerMessage', i))
}

test('*** ⛔ THE UI IS PRE-PROPOSAL: NO proposalId IS MINTED OR FAKED ***', () => {
  const r = renderer()
  assert.equal(/proposalId\s*:/.test(r), false, '⛔ the clarification invents a proposalId')
  assert.equal(r.includes("fetch('/api/v1/owner/work-orders'"), false, '⛔ it seals a Work Order before a Proposal exists')
  assert.equal(r.includes("fetch('/api/v1/owner/approve'"), false, '⛔ it approves something')
  assert.ok(r.includes("fetch('/api/v1/owner/work-requests'"), 'it uses the existing deterministic entrance')
  // It rejoins the EXISTING chain only once the server minted a real Proposal.
  assert.ok(/o\.status === 201 && o\.body\.proposalId/.test(r), 'and only on a real 201 + proposalId')
  assert.ok(r.includes('requestWorkOrder(o.body.goal, o.body.file, null, o.body.proposalId, o.body.intent, conv)'),
    'rejoining the unchanged Work Order path')
})

test('*** ⛔ ONLY OWNER-AUTHORED TEXT IS JOINED, ORIGINAL FIRST ***', () => {
  const r = renderer()
  assert.ok(r.includes("var joined = lastOwnerMessage(conv) + '\\n' + askIn.value.trim()"),
    '⛔ the join is not his sentence followed by his answer')
  assert.ok(r.includes('body: JSON.stringify({ message: joined })'), 'and only the message is sent')
  // No file/target field may ride along — the server re-derives, and would ignore it anyway.
  assert.equal(/body: JSON\.stringify\(\{[^}]*file/.test(r), false, '⛔ the page supplied a target')
})

test('*** it is bound to its own conversation ***', () => {
  const r = renderer()
  assert.ok(r.includes('lastOwnerMessage(conv)'), 'reads the originating conversation, not the active one')
  assert.ok(r.includes("turn('bot', conv)"), 'and renders into it')
  assert.ok(APP_JS.includes('if (res.workRequestClarification) return renderWorkRequestClarification(res.workRequestClarification, conv)'),
    'the dispatch passes that conversation through')
})

test('*** the clarification does not enter model history (P1-C1a boundary held) ***', () => {
  assert.equal(/history/.test(renderer()), false, 'the renderer never touches history')
  assert.equal([...APP_JS.matchAll(/history\.push\(/g)].length, 4, '⛔ a new history entry point appeared')
})

test('*** P1-C1a result presentation is untouched ***', () => {
  assert.ok(APP_JS.includes('function claimTerminalResult ('), 'claimTerminalResult still present')
  assert.ok(APP_JS.includes('var presentedResults = {}'), 'its dedupe marker still present')
  assert.ok(APP_JS.includes('addBot(presented.text, conv)'), 'and it still presents the result')
})

test('*** the served page really contains all of this ***', () => {
  const html = buildDemoHtml()
  assert.ok(html.includes('function renderWorkRequestClarification ('), 'the renderer reaches the served page')
  assert.ok(html.includes('if (res.workRequestClarification) return renderWorkRequestClarification('), 'and so does its dispatch')
})
