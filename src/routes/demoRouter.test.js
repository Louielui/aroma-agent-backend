'use strict'

/**
 * demoRouter.test.js — B2-2 demo route contract + DEMO_HTML static-safety.
 * Hermetic: injected spy fns (no real adapter/engine, no paid calls). Requests go
 * over a real ephemeral HTTP server via global fetch.
 *
 *   Run: node --test src/routes/demoRouter.test.js
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

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

for (const [label, body] of [
  ['missing interactionMode', { message: 'hi' }],
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
    assert.deepEqual(r.json, envelope)
  })
}

/* ========================= DEMO_HTML static safety ====================== */

test('DEMO_HTML: same-origin fetch target only, no external URLs', () => {
  assert.ok(DEMO_HTML.includes("fetch('/api/v1/demo/intake'"), 'posts to the same-origin demo path')
  assert.ok(!/https?:\/\//.test(DEMO_HTML), 'no absolute http(s) URL')
  assert.ok(!/<script\s+src=/.test(DEMO_HTML) && !/<link\s/.test(DEMO_HTML), 'no external script/link')
})

test('DEMO_HTML: three explicit mode controls', () => {
  for (const m of ['chat', 'email_draft', 'proposal']) assert.ok(DEMO_HTML.includes('data-mode="' + m + '"'))
  for (const t of ['聊天', '寫 Email', '建立提案']) assert.ok(DEMO_HTML.includes(t))
})

test('DEMO_HTML: no storage/cookies, no innerHTML/eval/new Function', () => {
  assert.ok(!/localStorage|sessionStorage|document\.cookie|serviceWorker/.test(DEMO_HTML))
  assert.ok(!/innerHTML|eval\(|new Function/.test(DEMO_HTML))
})

test('DEMO_HTML: safety labels + disabled confirm + unknown fallback + Enter/Shift+Enter', () => {
  for (const l of ['SHADOW_ONLY', '未寄出', '未寫入記憶', 'Proposal only — not run', '確認執行（尚未開放）']) assert.ok(DEMO_HTML.includes(l), 'label ' + l)
  assert.ok(DEMO_HTML.includes("setAttribute('disabled'"), 'confirm button disabled')
  assert.ok(DEMO_HTML.includes('格式未知'), 'unknown-shape safe fallback')
  assert.ok(DEMO_HTML.includes("e.key === 'Enter'") && DEMO_HTML.includes('shiftKey'), 'Enter sends, Shift+Enter newline')
})
