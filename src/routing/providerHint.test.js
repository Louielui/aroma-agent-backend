'use strict'

/**
 * providerHint.test.js — the Owner's provider pick is INTENT, never authority.
 *
 * The composer lets the Owner choose which 心燈 answers. That value arrives from the
 * browser, so it is treated exactly like every other browser-supplied value in this
 * system: validated against a closed allowlist at the boundary, able to influence one
 * narrow thing, and structurally incapable of reaching anything else.
 *
 * These tests pin what the hint may and may not do. No paid call: the adapters are fakes.
 */

const test = require('node:test')
const assert = require('node:assert')
const express = require('express')

const { selectPrimaryProvider, normalizeProviderHint, VALID_PROVIDERS, CLAUDE, OPENAI } = require('./modelRouter')
const { createDemoRouter } = require('../routes/demoRouter')

/* ── the allowlist ────────────────────────────────────────────────────────── */

test('only the two exact strings survive; everything else is discarded', () => {
  assert.deepEqual(VALID_PROVIDERS, ['claude', 'openai'])
  assert.equal(normalizeProviderHint('claude'), 'claude')
  assert.equal(normalizeProviderHint('openai'), 'openai')

  for (const hostile of [
    'Claude', 'OPENAI', ' openai', 'openai ', 'claude;drop', 'anthropic', 'gpt', 'gpt-4',
    'claude\n', '', null, undefined, 0, 1, true, false, {}, [], ['claude'],
    { toString: () => 'claude' }, 'claude,openai', '../claude', '__proto__'
  ]) {
    assert.equal(normalizeProviderHint(hostile), null, 'must be discarded: ' + JSON.stringify(hostile))
  }
})

/* ── what the hint may influence ──────────────────────────────────────────── */

test('a valid hint chooses the provider for a CHAT turn', () => {
  const env = {} // router flag OFF — the pick still works, it only picks between adapters
  assert.equal(selectPrimaryProvider(env, { interactionMode: 'chat', providerHint: 'openai' }), OPENAI)
  assert.equal(selectPrimaryProvider(env, { interactionMode: 'chat', providerHint: 'claude' }), CLAUDE)
  // and with the flag ON it still honours the Owner over the default
  const on = { MULTI_AI_ROUTER: 'on' }
  assert.equal(selectPrimaryProvider(on, { interactionMode: 'chat', providerHint: 'claude' }), CLAUDE)
  assert.equal(selectPrimaryProvider(on, { interactionMode: 'chat', providerHint: 'openai' }), OPENAI)
})

test('an ABSENT or INVALID hint falls back to the flag-driven default, never to an error', () => {
  for (const bad of [undefined, null, '', 'gpt', 'Claude', 42, {}]) {
    assert.equal(selectPrimaryProvider({}, { interactionMode: 'chat', providerHint: bad }), CLAUDE, 'flag off default')
    assert.equal(selectPrimaryProvider({ MULTI_AI_ROUTER: 'on' }, { interactionMode: 'chat', providerHint: bad }), OPENAI, 'flag on default')
  }
})

/* ── what the hint may NOT do ─────────────────────────────────────────────── */

test('a hint on a NON-chat lane is ignored entirely', () => {
  for (const mode of ['proposal', 'email_draft', 'legacy', undefined, '', 'CHAT', ' chat']) {
    for (const hint of ['openai', 'claude']) {
      assert.equal(
        selectPrimaryProvider({ MULTI_AI_ROUTER: 'on' }, { interactionMode: mode, providerHint: hint }),
        CLAUDE,
        `mode=${mode} hint=${hint} must stay on claude`
      )
    }
  }
})

test('the router returns a provider NAME and nothing else — it cannot carry a capability', () => {
  const out = selectPrimaryProvider({}, { interactionMode: 'chat', providerHint: 'openai' })
  assert.equal(typeof out, 'string')
  assert.ok(VALID_PROVIDERS.includes(out))
})

/* ── the HTTP boundary: the hint reaches chat opts only ───────────────────── */

function appWith (spy) {
  const app = express()
  app.use(express.json())
  app.locals.conversationDemo = true
  app.locals.promoteToProposal = async () => ({ ok: true, proposal: { id: 'p1', status: 'pending' } })
  app.use(createDemoRouter({ getAdapterFn: () => ({ providerName: 'spy' }), processIntakeFn: spy }))
  return app
}
async function post (app, body) {
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  try {
    const res = await fetch('http://127.0.0.1:' + server.address().port + '/api/v1/demo/intake', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    })
    return { status: res.status, json: await res.json().catch(() => null) }
  } finally { await new Promise((r) => server.close(r)) }
}

test('the demo boundary validates the hint BEFORE it reaches the engine', async () => {
  const seen = []
  const spy = async (m, a, h, opts) => { seen.push(opts); return { mode: 'chat', talkOnly: true, reply: 'ok' } }
  const app = appWith(spy)

  await post(app, { message: 'hi', interactionMode: 'chat', providerHint: 'openai' })
  assert.equal(seen[0].providerHint, 'openai', 'a valid hint is passed through')

  for (const hostile of ['GPT', 'anthropic', 'openai ', 42, { id: 'openai' }, ['openai'], null]) {
    seen.length = 0
    await post(app, { message: 'hi', interactionMode: 'chat', providerHint: hostile })
    assert.equal(seen[0].providerHint, null, 'discarded at the boundary: ' + JSON.stringify(hostile))
  }
})

test('a hint sent to a NON-chat lane never even appears in the engine opts', async () => {
  const seen = []
  const spy = async (m, a, h, opts) => { seen.push(opts); return { mode: 'chat', reply: 'ok' } }
  const app = appWith(spy)

  for (const mode of ['proposal', 'email_draft']) {
    seen.length = 0
    await post(app, { message: 'do X', interactionMode: mode, providerHint: 'openai' })
    assert.equal('providerHint' in seen[0], false, mode + ' opts must not carry a provider hint at all')
  }
})

test('the hint cannot change the lane, the mode, or anything executable', async () => {
  const seen = []
  const spy = async (m, a, h, opts) => { seen.push(opts); return { mode: 'chat', talkOnly: true, reply: 'ok' } }
  const app = appWith(spy)

  // every shape of attempt to smuggle something else through the same field
  for (const hostile of ['proposal', 'chat', 'agentExecute', 'admin', '../../etc/passwd']) {
    seen.length = 0
    await post(app, { message: 'hi', interactionMode: 'chat', providerHint: hostile })
    const o = seen[0]
    assert.equal(o.providerHint, null, 'not a provider: ' + hostile)
    assert.equal(o.interactionMode, 'chat', 'the lane is unchanged')
    assert.equal(o.demo, true)
    assert.equal('promoteToProposal' in o, false, 'chat never gets the promote seam')
    assert.equal('u1DraftShadow' in o, false)
    assert.equal('agentExecute' in o, false)
    assert.equal('workOrder' in o, false)
  }
})

/* ── who actually answered ────────────────────────────────────────────────── */

test('the reply reports the provider that REALLY served it, from telemetry', async () => {
  // the pipeline fills opts.telemetry; the route reads the truth from there, not from
  // what the browser asked for
  // ⛔ `servedBy` NOW CARRIES THE MODEL ID, NOT THE PROVIDER FAMILY (HR-62). What this test
  // protects is unchanged — it reports who ANSWERED, not who was asked — and it protects it
  // at finer resolution, because 「claude」 was the label that hid haiku for a fortnight.
  const spy = async (m, a, h, opts) => {
    opts.telemetry.provider = 'claude' // the fallback answered
    opts.telemetry.model = 'claude-haiku-4-5-20251001'
    opts.telemetry.fallbackUsed = true
    return { mode: 'chat', talkOnly: true, reply: 'ok' }
  }
  const r = await post(appWith(spy), { message: 'hi', interactionMode: 'chat', providerHint: 'openai' })
  assert.equal(r.status, 200)
  assert.equal(r.json.servedBy, 'claude-haiku-4-5-20251001', 'reports what answered, not what was asked')
  assert.equal(r.json.fallbackUsed, true)

  // and a straight success reports the model that served it
  const spy2 = async (m, a, h, opts) => {
    opts.telemetry.provider = 'openai'
    opts.telemetry.model = 'gpt-5.6-terra'
    return { mode: 'chat', talkOnly: true, reply: 'ok' }
  }
  const r2 = await post(appWith(spy2), { message: 'hi', interactionMode: 'chat', providerHint: 'openai' })
  assert.equal(r2.json.servedBy, 'gpt-5.6-terra')
  assert.equal(r2.json.fallbackUsed, false)

  // ⛔ THE PROVIDER ALONE IS NO LONGER ENOUGH. A pipeline that reports the family but not the
  // model is recorded as UNKNOWN rather than downgraded to 「claude」 — the substitute this
  // change exists to remove.
  const spy4 = async (m, a, h, opts) => {
    opts.telemetry.provider = 'claude'
    return { mode: 'chat', talkOnly: true, reply: 'ok' }
  }
  const r4 = await post(appWith(spy4), { message: 'hi', interactionMode: 'chat', providerHint: 'claude' })
  assert.equal(r4.json.servedBy, null)

  // no telemetry at all ⇒ honest null, never a guess
  const spy3 = async () => ({ mode: 'chat', talkOnly: true, reply: 'ok' })
  const r3 = await post(appWith(spy3), { message: 'hi', interactionMode: 'chat', providerHint: 'openai' })
  assert.equal(r3.json.servedBy, null)
})
