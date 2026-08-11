'use strict'

/**
 * demoRouter.test.js — B2-2 demo route contract + DEMO_HTML static-safety.
 * Hermetic: injected spy fns (no real adapter/engine, no paid calls). Requests go
 * over a real ephemeral HTTP server via global fetch.
 *
 *   Run: node --test src/routes/demoRouter.test.js
 */

const { test, beforeEach, afterEach } = require('node:test')
const { CATALOGUE } = require('../i18n/catalogue')
const assert = require('node:assert/strict')
const express = require('express')

/**
 * ⛔ THE STATE A TEST NAMES MUST BE ESTABLISHED, NOT INHERITED.
 *
 * These tests describe DEFAULT routing behaviour, so they must run with the routing flags
 * off — and there was nothing making that true. Run from a terminal carrying the launcher
 * environment (which is the environment 香香 actually runs in), they fail.
 *
 * Found by running the whole suite under the launcher's exact flag set and diffing against
 * a clean shell. Same family as currentLocale() reading the Owner's settings file.
 */
const clearRuntimeFlags = () => {
  for (const k of [
    'TURN_ROUTER', 'MULTI_AI_ROUTER', 'CONVERSATION_RECALL', 'DECISION_RECALL',
    'READ_ACCESS', 'CONTEXT_DRIVE', 'CONTEXT_GMAIL', 'CONTEXT_CALENDAR',
    'CONTEXT_GITHUB', 'CONTEXT_AROMA_SYSTEM', 'AGENT_BRIDGE', 'XIANGXIANG_ARCHIVE',
    'CONVERSATION_CONTRACT', 'CONVERSATION_DEMO'
  ]) delete process.env[k]
}
beforeEach(clearRuntimeFlags)
afterEach(clearRuntimeFlags)


const { createDemoRouter } = require('./demoRouter')
const { DEMO_HTML } = require('../demo/demoHtml')
const { IntakeUpstreamError } = require('../intake/intakeErrors')

// A processIntake spy: records every call's args; returns a canned value (or throws).
function spyProcess (impl) {
  const calls = []
  const fn = async (...args) => { calls.push(args); if (typeof impl === 'function') return impl(...args); return impl }
  fn.calls = calls
  return fn
}
function spyAdapterFactory () {
  const calls = []
  const fn = () => { calls.push(true); return { providerName: 'spy' } }
  fn.calls = calls
  return fn
}

function makeApp ({ demoOn = true, processIntakeFn, getAdapterFn } = {}) {
  const app = express()
  app.use(express.json())
  if (demoOn) {
    app.locals.conversationDemo = true
    app.locals.promoteToProposal = async () => ({ ok: true, proposal: { id: 'p_test', status: 'pending' } })
  }
  app.use(createDemoRouter({ getAdapterFn, processIntakeFn }))
  app.use((req, res) => res.status(404).json({ error: 'Not found' })) // mirror real terminal 404
  return app
}

async function req (app, method, path, body) {
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const port = server.address().port
  try {
    const res = await fetch('http://127.0.0.1:' + port + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    })
    let json = null
    try { json = await res.json() } catch (_) { json = null }
    return { status: res.status, json }
  } finally {
    await new Promise((r) => server.close(r))
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/* ============================ guard (fail-closed) ========================== */

test('GET /demo OFF → 403 demo_disabled; adapter/processIntake not called', async () => {
  const p = spyProcess({}); const g = spyAdapterFactory()
  const r = await req(makeApp({ demoOn: false, processIntakeFn: p, getAdapterFn: g }), 'GET', '/demo')
  assert.equal(r.status, 403)
  assert.deepEqual(r.json, { error: 'demo_disabled' })
  assert.equal(p.calls.length, 0)
  assert.equal(g.calls.length, 0)
})

test('POST /api/v1/demo/intake OFF → 403; adapter/processIntake not called', async () => {
  const p = spyProcess({}); const g = spyAdapterFactory()
  const r = await req(makeApp({ demoOn: false, processIntakeFn: p, getAdapterFn: g }), 'POST', '/api/v1/demo/intake', { message: 'hi', interactionMode: 'chat' })
  assert.equal(r.status, 403)
  assert.deepEqual(r.json, { error: 'demo_disabled' })
  assert.equal(p.calls.length, 0)
  assert.equal(g.calls.length, 0)
})

/* ============================ validation (pre-model) ====================== */

// NOTE: 'missing interactionMode' is deliberately NOT here any more. Under Unified
// Conversation v1 the page no longer asks the Owner to pick a lane, so an absent
// interactionMode is the NORMAL case — the server routes from the message. An explicitly
// supplied one is still strictly whitelisted, which is what the rest of this table pins.
for (const [label, body] of [
  ['unknown interactionMode', { message: 'hi', interactionMode: 'delete_everything' }],
  ['non-string interactionMode', { message: 'hi', interactionMode: 5 }],
  ['empty message', { message: '   ', interactionMode: 'chat' }]
]) {
  test('POST invalid (' + label + ') → 400 BEFORE adapter/model', async () => {
    const p = spyProcess({}); const g = spyAdapterFactory()
    const r = await req(makeApp({ processIntakeFn: p, getAdapterFn: g }), 'POST', '/api/v1/demo/intake', body)
    assert.equal(r.status, 400)
    assert.equal(p.calls.length, 0, 'processIntake not called on invalid input')
    assert.equal(g.calls.length, 0, 'getAdapter not called on invalid input')
  })
}

/* ======================= opts mapping (ALWAYS 4-arg) ====================== */

test('chat → 4-arg processIntake with interactionMode:chat, demo:true, no u1DraftShadow', async () => {
  const p = spyProcess({ mode: 'chat', talkOnly: true })
  await req(makeApp({ processIntakeFn: p }), 'POST', '/api/v1/demo/intake', { message: 'hi', interactionMode: 'chat', history: [] })
  assert.equal(p.calls.length, 1)
  const [, , , opts] = p.calls[0]
  assert.equal(p.calls[0].length, 4, 'must be 4-arg')
  assert.equal(opts.interactionMode, 'chat')
  assert.equal(opts.demo, true)
  assert.equal('u1DraftShadow' in opts, false)
})

test('email_draft → 4-arg with u1DraftShadow:true, NO demo, NO promoteToProposal', async () => {
  const p = spyProcess({ mode: 'draft_proposal', stage: 'SHADOW_ONLY' })
  await req(makeApp({ processIntakeFn: p }), 'POST', '/api/v1/demo/intake', { message: 'mail rob', interactionMode: 'email_draft' })
  const [, , , opts] = p.calls[0]
  assert.equal(p.calls[0].length, 4)
  assert.equal(opts.u1DraftShadow, true)
  assert.equal('demo' in opts, false)
  assert.equal('promoteToProposal' in opts, false, 'email_draft must NOT pass promoteToProposal')
})

test('proposal → 4-arg with interactionMode:proposal, demo:true, promoteToProposal fn', async () => {
  const p = spyProcess({ demoOutcome: 'execution_proposal', proposals: [] })
  await req(makeApp({ processIntakeFn: p }), 'POST', '/api/v1/demo/intake', { message: 'do X', interactionMode: 'proposal' })
  const [, , , opts] = p.calls[0]
  assert.equal(p.calls[0].length, 4)
  assert.equal(opts.interactionMode, 'proposal')
  assert.equal(opts.demo, true)
  assert.equal(typeof opts.promoteToProposal, 'function')
})

test('no mode uses the legacy 3-arg processIntake (every call has 4 args)', async () => {
  const p = spyProcess({ mode: 'chat' })
  const app = makeApp({ processIntakeFn: p })
  for (const m of ['chat', 'email_draft', 'proposal']) {
    await req(app, 'POST', '/api/v1/demo/intake', { message: 'hi', interactionMode: m })
  }
  for (const c of p.calls) assert.equal(c.length, 4)
})

test('requestId is server-generated; browser-supplied requestId ignored', async () => {
  const p = spyProcess({ mode: 'chat' })
  await req(makeApp({ processIntakeFn: p }), 'POST', '/api/v1/demo/intake', { message: 'hi', interactionMode: 'chat', requestId: 'HACKED-BROWSER-ID' })
  const [, , , opts] = p.calls[0]
  assert.notEqual(opts.requestId, 'HACKED-BROWSER-ID')
  assert.ok(UUID_RE.test(opts.requestId), 'server requestId is a UUID')
})

/* ============================ error mapping ============================== */

test('upstream error → safe mapped response (no provider/stack leak)', async () => {
  const p = spyProcess(() => { throw new IntakeUpstreamError({ correlationId: 'x', cause: new Error('SECRET provider body') }) })
  const r = await req(makeApp({ processIntakeFn: p }), 'POST', '/api/v1/demo/intake', { message: 'hi', interactionMode: 'chat' })
  assert.ok(r.status >= 500)
  const s = JSON.stringify(r.json)
  assert.ok(!s.includes('SECRET provider body'), 'never leaks provider/cause text')
  assert.ok(!s.includes('stack'))
})

/* ====================== response passthrough per mode ==================== */

for (const [label, envelope] of [
  ['draft_proposal', { mode: 'draft_proposal', stage: 'SHADOW_ONLY', gmailDraftCreated: false, persistentMemoryWritten: false, draft: { subject: 's', body: 'b' }, requestId: 'r' }],
  ['ask', { mode: 'ask', stage: 'SHADOW_ONLY', clarifyingQuestion: 'who?', draft: null, requestId: 'r' }],
  ['proposal', { demoOutcome: 'execution_proposal', proposals: [{ id: 'p1', status: 'pending' }], reply: 'ok', requestId: 'r' }],
  ['blocked', { blocked: true, reply: '含敏感資訊', requestId: 'r' }]
]) {
  test('response passthrough preserved: ' + label, async () => {
    const p = spyProcess(envelope)
    const im = label === 'ask' || label === 'draft_proposal' ? 'email_draft' : (label === 'proposal' ? 'proposal' : 'chat')
    const r = await req(makeApp({ processIntakeFn: p }), 'POST', '/api/v1/demo/intake', { message: 'hi', interactionMode: im })
    assert.equal(r.status, 200)
    if (im === 'chat') {
      // The chat lane additionally reports WHICH provider answered — the model picker
      // needs it, because a fallback means the reply may not come from the chosen one.
      // The engine envelope itself must still pass through untouched.
      // `truncated` joins servedBy/fallbackUsed/lane as a TRANSPORT field: it reports that the
      // token budget cut the reply off, which the ENGINE envelope has no way to express.
      const { servedBy, fallbackUsed, lane, inferred, truncated, ...rest } = r.json
      assert.deepEqual(rest, envelope, 'the engine envelope is passed through unchanged')
      assert.ok(servedBy === null || typeof servedBy === 'string')
      assert.equal(typeof fallbackUsed, 'boolean')
      assert.equal(typeof truncated, 'boolean')
    } else {
      // `inferred` is a TRANSPORT field, added the same way servedBy/fallbackUsed/lane are:
      // it reports what the server read out of the Owner's own words, so the page can stop
      // asking him to retype the file path he just gave. The ENGINE envelope underneath
      // must still be untouched, which is what this assertion actually protects.
      const { inferred, ...rest2 } = r.json
      assert.deepEqual(rest2, envelope, 'the engine envelope is passed through unchanged')
      // …and it rides ONLY on a response that carries a proposal, because that is the only
      // turn that renders the work-order affordance. draft_proposal and ask gain nothing.
      if (Array.isArray(envelope.proposals) && envelope.proposals.length) {
        assert.equal(typeof inferred, 'object', 'the proposal turn carries the inference')
      } else {
        assert.equal(inferred, undefined, 'other lanes stay byte-identical')
      }
    }
  })
}

/* ========================= DEMO_HTML static safety ====================== */

test('DEMO_HTML: same-origin fetch target only, no external URLs', () => {
  assert.ok(DEMO_HTML.includes("fetch('/api/v1/demo/intake'"), 'posts to the same-origin demo path')
  assert.ok(!/https?:\/\//.test(DEMO_HTML), 'no absolute http(s) URL')
  assert.ok(!/<script\s+src=/.test(DEMO_HTML), 'no external script')
  // Two links are permitted and no others: the favicon, which is inline artwork the
  // browser never goes out for, and the install manifest, which is a same-origin path on
  // this server. Anything with an off-origin href is still refused outright.
  for (const link of DEMO_HTML.match(/<link[^>]*>/g) || []) {
    assert.ok(/href="(data:|\/)[^"]*"/.test(link), 'inline or same-origin only: ' + link.slice(0, 40))
  }
})

test('DEMO_HTML: ONE composer — no permanent mode controls, two shortcuts behind "+"', () => {
  // Unified Conversation v1: 「統一使用介面，但唔統一權限」. The three upfront buttons are
  // gone — 心燈 routes internally — so the Owner never has to classify his own sentence
  // before typing it. Both lanes survive only as optional shortcuts.
  assert.ok(!DEMO_HTML.includes('data-mode='), 'no permanent mode controls remain')
  assert.ok(!DEMO_HTML.includes('id="modes"'), 'the mode switcher element is gone')
  /**
   * ⛔ CONVERTED — AND THESE WERE GREEN, WHICH IS THE WHOLE PROBLEM.
   *
   * The catalogue is INLINED into the served page, so `DEMO_HTML.includes('產生工作單')`
   * finds the string inside `var CATALOGUE = {…}` whether or not any code renders it. Every
   * one of these assertions had quietly stopped proving 「the page shows this」 and started
   * proving 「the catalogue ships this entry」 — while staying green and looking meaningful.
   *
   * Worse than HR-49, which at least went blank. This one kept its colour.
   *
   * So: the KEY must be used in the page (that is the code path), and the WORDING is asserted
   * on the catalogue, in both languages.
   */
  assert.ok(DEMO_HTML.includes("t('lane.emailDraft')") && DEMO_HTML.includes("t('lane.proposal')"),
    'both survive as shortcuts')
  assert.ok(DEMO_HTML.includes('id="plus"'), 'behind a + menu')
  // A shortcut is ONE-SHOT: a forced lane must never persist silently into later turns.
  assert.ok(DEMO_HTML.includes('ONE-SHOT'), 'the one-shot rule is stated in the code')
  assert.ok(DEMO_HTML.includes('setForced(null)'), 'and actually cleared at send time')
})

test('DEMO_HTML: no storage/cookies, no innerHTML/eval/new Function', () => {
  assert.ok(!/localStorage|sessionStorage|document\.cookie|serviceWorker/.test(DEMO_HTML))
  assert.ok(!/innerHTML|eval\(|new Function/.test(DEMO_HTML))
})

test('DEMO_HTML: safety labels + unknown fallback + Enter/Shift+Enter', () => {
  // CONVERTED: the two labels are rendered from keys; the WORDS are checked on the entries,
  // in both languages — 「not sent」 and 「nothing has run」 are the claims that matter.
  assert.ok(DEMO_HTML.includes('SHADOW_ONLY'), 'the stage marker is literal and stays literal')
  assert.ok(DEMO_HTML.includes("t('draft.meta')") && DEMO_HTML.includes("t('proposal.meta'"), 'both labels are rendered')
  assert.match(CATALOGUE['draft.meta'].zh, /未寄出/)
  assert.match(CATALOGUE['draft.meta'].en, /not sent/i)
  assert.match(CATALOGUE['proposal.meta'].zh, /未執行/)
  assert.match(CATALOGUE['proposal.meta'].en, /nothing has run/i)
  // The old placeholder "確認執行（尚未開放）" is GONE — it is replaced by the real Owner
  // approval card, which still cannot execute from the chat card itself: the chat lane can
  // only ASK the server to seal a Work Order, and executing needs the sealed card's typed
  // confirmation + single-use nonce. Asserted below.
  assert.ok(!DEMO_HTML.includes('確認執行（尚未開放）'), 'the disabled placeholder is retired')
  assert.ok(DEMO_HTML.includes("t('proposal.makeWorkOrder')"), 'the chat card only requests a Work Order')
  // RE-POINTED, NOT DELETED. This promise used to live in the opening assistant bubble,
  // which the empty-screen redesign retired. Owner decision: it moves to the composer
  // placeholder — the one place he looks before typing. The ASSERTION is the same one it
  // always was: the page must state, before he types, that a file change needs his approval.
  assert.ok(DEMO_HTML.includes("t('shell.composerPlaceholder')"), 'the page states it up front')
  assert.match(CATALOGUE['shell.composerPlaceholder'].zh, /批准/, 'nothing runs unapproved — zh')
  assert.match(CATALOGUE['shell.composerPlaceholder'].en, /approve/i, 'nothing runs unapproved — en')
  assert.ok(DEMO_HTML.includes("t('err.unknownShape'"), 'unknown-shape safe fallback')
  assert.ok(DEMO_HTML.includes("e.key === 'Enter'") && DEMO_HTML.includes('shiftKey'), 'Enter sends, Shift+Enter newline')
})

test('DEMO_HTML: the emitted browser script is syntactically valid JS', () => {
  // The page is built from a module-level template literal, so an unescaped \n (or a
  // stray backtick) silently emits a BROKEN script — the card would simply never render
  // and the Owner would see nothing. Parse it here rather than discover that in the UI.
  const m = DEMO_HTML.match(/<script>([\s\S]*?)<\/script>/)
  assert.ok(m, 'the page has exactly one inline script')
  assert.doesNotThrow(() => new Function(m[1]), 'inline script must parse') // eslint-disable-line no-new-func
})

test('DEMO_HTML: the approval card is a viewer + four fields of intent, and holds no authority', () => {
  // WYSIWYA — the card RENDERS the server's own projection; it never rebuilds the order
  // client-side. v2 shows the server-built sections plus the server-built technical lines.
  assert.ok(DEMO_HTML.includes('sealed.card'), 'displays the server-built card object')
  assert.ok(DEMO_HTML.includes('sealed.technicalLines'), 'displays the server-built technical section')
  assert.ok(!/sealed\.(goal|allowedFiles|timeoutSec|costCapUsd|branch)\b/.test(DEMO_HTML), 'the page never re-composes fields itself')

  // The approve payload carries EXACTLY the four intent fields — no Work Order content.
  const m = DEMO_HTML.match(/\/api\/v1\/owner\/approve[\s\S]*?JSON\.stringify\(\{([\s\S]*?)\}\)/)
  assert.ok(m, 'approve fetch found')
  const keys = (m[1].match(/^\s*(\w+):/gm) || []).map((s) => s.trim().replace(':', '')).sort()
  assert.deepEqual(keys, ['approvalId', 'nonce', 'typedConfirmation', 'workOrderHash'], 'exactly four fields')

  // No Work Order field may appear anywhere in the approve payload region.
  for (const f of ['workOrder:', 'allowedFiles', 'timeoutSec', 'costCapUsd', 'branch:', 'forbiddenActions']) {
    assert.ok(!m[1].includes(f), 'approve payload must not carry ' + f)
  }
  // The page never holds or sends a token, and never talks to anything but same-origin.
  assert.ok(!/HUB_TOKEN|Authorization|Bearer/i.test(DEMO_HTML), 'no token anywhere in the page')
  assert.ok(DEMO_HTML.includes("credentials: 'same-origin'"), 'session cookie only, same-origin')
  // One click only, and a burnt nonce is never retried from the page.
  assert.ok(DEMO_HTML.includes('go.disabled = true'), 'single click')
  // CONVERTED: 「this card is void」 is the claim that stops a retry loop; both languages.
  assert.ok(DEMO_HTML.includes("t('approve.refused'") && DEMO_HTML.includes("t('approve.refusedNet')"),
    'a refusal ends the card instead of retrying')
  for (const loc of ['zh', 'en']) {
    assert.match(CATALOGUE['approve.refused'][loc], loc === 'zh' ? /作廢/ : /void/i, loc + ': the card is void')
  }
})

/* ── Owner Decision Card v2 — the four walkthrough defects ─────────────────── */

test('DEFECT (a): no input uses its required value as the placeholder, and submits are gated', () => {
  // The walkthrough cost two attempts and burned a nonce because an empty field LOOKED
  // filled: the placeholder WAS the required value. Placeholders are now instructions.
  // Pinned to the RULE, not to one call's syntax: the placeholder must be an instruction.
  // (It is now set through a ternary, because only the missing field is ever asked for.)
  // CONVERTED: a placeholder must be an INSTRUCTION, not the required value. That is a
  // property of the sentence, so it is checked on the sentence — in BOTH languages.
  assert.ok(DEMO_HTML.includes("t('proposal.askFilePlaceholder')"), 'file path placeholder is used')
  assert.ok(DEMO_HTML.includes("t('proposal.askIntentPlaceholder')"), 'the change placeholder too')
  for (const key of ['proposal.askFilePlaceholder', 'proposal.askIntentPlaceholder']) {
    for (const loc of ['zh', 'en']) {
      assert.match(CATALOGUE[key][loc], /輸入|Enter/i, key + '/' + loc + ' must instruct, not exemplify')
    }
  }
  // Stronger than before: a SAMPLE PATH as ghost text would be the same defect wearing a
  // different hat — an empty field that looks filled.
  assert.ok(!/placeholder',\s*'[a-z0-9_.-]+\/[a-z0-9_.\-/]+'/i.test(DEMO_HTML),
    'no example file path is ever used as ghost text')
  assert.ok(DEMO_HTML.includes("t('approve.typeToConfirm', { word: sealed.typedConfirmationRequired })"),
    'confirmation placeholder is an instruction')
  assert.ok(!/placeholder',\s*sealed\.typedConfirmationRequired\)/.test(DEMO_HTML), 'the required value is never the placeholder')
  assert.ok(!/placeholder',\s*'EXECUTE'/.test(DEMO_HTML), 'EXECUTE is never shown as ghost text')

  // gating: both buttons start disabled and are enabled only by real input
  assert.ok(DEMO_HTML.includes('mk.disabled = true'), 'the seal button starts disabled')
  // The two-field form became one question asked only when something is genuinely
  // missing, so the gate now hangs off that single input. Same guarantee, new name.
  assert.ok(DEMO_HTML.includes("mk.disabled = askIn.value.trim() === ''"), 'seal enabled only on a non-empty answer')
  assert.ok(DEMO_HTML.includes('mk.disabled = !!askIn'), 'and it starts disabled whenever a question is being asked')
  assert.ok(DEMO_HTML.includes("t('approve.typeToConfirm', { word: sealed.typedConfirmationRequired })"),
    'confirmation placeholder is an instruction')
  for (const loc of ['zh', 'en']) {
    assert.match(CATALOGUE['approve.typeToConfirm'][loc], /\{word\}/,
      loc + ': the required word is a slot in an instruction, never the placeholder itself')
  }
  assert.ok(DEMO_HTML.includes('go.disabled = true'), 'the approve button starts disabled')
  assert.ok(DEMO_HTML.includes('go.disabled = (typed.value !== sealed.typedConfirmationRequired)'), 'approve enabled only on an EXACT match')
  // and the click handlers still refuse a disabled button (defence in depth)
  assert.ok(DEMO_HTML.includes('if (mk.disabled) return') && DEMO_HTML.includes('if (go.disabled) return'))
})

test('DEFECT (b): a new card clears the previous red errors', () => {
  assert.ok(DEMO_HTML.includes('function clearErrors ()'), 'there is an error-clearing routine')
  assert.ok(DEMO_HTML.includes("querySelectorAll('.err-note')"), 'it targets the error notes')
  // called both when a card renders and when a fresh Work Order is requested
  const renderIdx = DEMO_HTML.indexOf('function renderCard (')
  assert.ok(renderIdx > 0, 'the card renderer exists')
  assert.ok(DEMO_HTML.slice(renderIdx, renderIdx + 200).includes('clearErrors()'), 'cleared on a new card')
  const reqIdx = DEMO_HTML.indexOf('function requestWorkOrder (')
  assert.ok(DEMO_HTML.slice(reqIdx, reqIdx + 300).includes('clearErrors()'), 'cleared on a new request')
})

test('DEFECT (c): the failure message is not doubled', () => {
  // reasonForOwner already opens with 未能建立工作單, so the page must show it verbatim.
  assert.ok(DEMO_HTML.includes('addError(o.body.reasonForOwner || t('), 'reasonForOwner is shown as-is')
  // CONVERTED: reasonForOwner must never be wrapped in the prefix template. The prefix is
  // `offer.createFailed` now, and the rule is that it is the FALLBACK, not a wrapper.
  assert.ok(!/createFailed'[^\n]*reasonForOwner/.test(DEMO_HTML), 'never prefixed onto reasonForOwner')
})

test('DEFECT (d): the card renders the server-built sections, never a raw brief', () => {
  assert.ok(DEMO_HTML.includes('sealed.card'), 'the page renders the server-built card object')
  // the v1 worker-brief structure ("Title: x\n\nDetails: y") must not appear as text the
  // page composes. (`technicalTitle:` is an object key, not brief structure.)
  assert.ok(!/(^|[^A-Za-z])Title:\s/.test(DEMO_HTML), 'no worker-brief Title: in the page')
  assert.ok(!/(^|[^A-Za-z])Details:\s/.test(DEMO_HTML), 'no worker-brief Details: in the page')
})

test('the v2 card is a viewer: collapsed section is presentation only, payload unchanged', () => {
  // ▸ 技術細節 collapsed by default via <details> with no `open` attribute
  assert.ok(DEMO_HTML.includes("document.createElement('details')"), 'collapsible technical section')
  assert.ok(!/details.*setAttribute\('open'/.test(DEMO_HTML), 'collapsed by default')
  assert.ok(DEMO_HTML.includes('sealed.technicalLines'), 'the collapsed text comes from the server')

  // the approve payload is STILL exactly the four intent fields
  const m = DEMO_HTML.match(/\/api\/v1\/owner\/approve[\s\S]*?JSON\.stringify\(\{([\s\S]*?)\}\)/)
  const keys = (m[1].match(/^\s*(\w+):/gm) || []).map((s) => s.trim().replace(':', '')).sort()
  assert.deepEqual(keys, ['approvalId', 'nonce', 'typedConfirmation', 'workOrderHash'])

  // the Layer 2 result fetch is a READ — no body, no method override
  assert.ok(DEMO_HTML.includes("fetch('/api/v1/owner/results/'"), 'result view is fetched')
  const r = DEMO_HTML.match(/fetch\('\/api\/v1\/owner\/results\/'[\s\S]{0,160}/)[0]
  assert.ok(!/method:\s*'POST'/.test(r), 'the result view is a plain GET')
})
