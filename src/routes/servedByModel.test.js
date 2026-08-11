'use strict'
/**
 * servedByModel.test.js — `servedBy` reports the MODEL, not the provider family.
 *
 * ⛔ NO NETWORK, NO MODEL CALL. The adapter is a fake that returns a model id, which is the
 *    whole point: the id has to travel from the adapter's own result to the wire untouched.
 *
 * HR-62 is why this exists. For a fortnight every reply was labelled 「Claude」, which was true
 * and useless: the Claude behind it was claude-haiku-4-5-20251001 and no screen said so.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const { createDemoRouter } = require('./demoRouter')

function appWith (modelId) {
  const app = express()
  app.use(express.json())
  app.locals.conversationDemo = true
  app.use('/', createDemoRouter({
    getAdapterFn: () => ({ complete: async () => ({ text: 'ok', usage: {}, model: modelId }) }),
    // The engine seam: fill the telemetry the way the real pipeline does, from the
    // adapter's returned id, then answer.
    processIntakeFn: async (message, adapter, history, opts) => {
      const res = await adapter.complete(message, {})
      if (opts && opts.telemetry) {
        opts.telemetry.provider = 'claude'
        opts.telemetry.model = res.model
      }
      return { reply: 'ok', requestId: opts.requestId }
    }
  }))
  return app
}

function post (app, body) {
  return new Promise((resolve) => {
    const req = require('http').request({ method: 'POST', path: '/api/v1/demo/intake', port: app.__port, headers: { 'Content-Type': 'application/json' } },
      (res) => { let b = ''; res.on('data', (c) => { b += c }); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(b || '{}') })) })
    req.end(JSON.stringify(body))
  })
}

async function withServer (app, fn) {
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  app.__port = server.address().port
  try { return await fn() } finally { server.close() }
}

test('*** ⛔ servedBy carries the MODEL ID the adapter actually returned ***', async () => {
  const app = appWith('claude-haiku-4-5-20251001')
  await withServer(app, async () => {
    const r = await post(app, { message: '你好', interactionMode: 'chat' })
    assert.equal(r.status, 200)
    // ⛔ NOT 'claude'. The family name was the thing that hid the model for a fortnight.
    assert.equal(r.json.servedBy, 'claude-haiku-4-5-20251001')
    assert.notEqual(r.json.servedBy, 'claude')
  })
})

test('*** a different model on the same provider is visibly different ***', async () => {
  const app = appWith('claude-opus-5')
  await withServer(app, async () => {
    const r = await post(app, { message: '你好', interactionMode: 'chat' })
    assert.equal(r.json.servedBy, 'claude-opus-5')
  })
})

test('*** ⛔ an absent model is NULL, never backfilled with the provider name ***', async () => {
  const app = express()
  app.use(express.json())
  app.locals.conversationDemo = true
  app.use('/', createDemoRouter({
    getAdapterFn: () => ({ complete: async () => ({ text: 'ok', usage: {} }) }), // no model field
    processIntakeFn: async (message, adapter, history, opts) => {
      if (opts && opts.telemetry) { opts.telemetry.provider = 'claude'; opts.telemetry.model = null }
      return { reply: 'ok', requestId: opts.requestId }
    }
  }))
  await withServer(app, async () => {
    const r = await post(app, { message: '你好', interactionMode: 'chat' })
    // Absent stays absent. 'claude' in a field that now means 「which model」 would be the
    // plausible substitute this change exists to remove.
    assert.equal(r.json.servedBy, null)
  })
})

/* ═══ A TRUNCATED REPLY IS VISIBLY TRUNCATED ══════════════════════════════ */

function appWithStop (stopReason) {
  const app = express()
  app.use(express.json())
  app.locals.conversationDemo = true
  app.use('/', createDemoRouter({
    getAdapterFn: () => ({ complete: async () => ({ text: 'ok', usage: {}, model: 'claude-opus-5', stopReason }) }),
    processIntakeFn: async (message, adapter, history, opts) => {
      const res = await adapter.complete(message, {})
      if (opts && opts.telemetry) {
        opts.telemetry.provider = 'claude'
        opts.telemetry.model = res.model
        opts.telemetry.stopReason = res.stopReason
      }
      return { reply: 'ok', requestId: opts.requestId }
    }
  }))
  return app
}

test('*** ⛔ a reply cut off by the token budget reports truncated:true ***', async () => {
  const app = appWithStop('max_tokens')
  await withServer(app, async () => {
    const r = await post(app, { message: '你好', interactionMode: 'chat' })
    // ⛔ THE WHOLE POINT: a reply that just ends is indistinguishable from one that finished.
    // Both adapters normalise to this same token — Anthropic's stop_reason and OpenAI's
    // incomplete_details.reason === 'max_output_tokens'.
    assert.equal(r.json.truncated, true)
  })
})

test('*** a complete reply is not marked truncated ***', async () => {
  const app = appWithStop('end_turn')
  await withServer(app, async () => {
    const r = await post(app, { message: '你好', interactionMode: 'chat' })
    assert.equal(r.json.truncated, false)
  })
})

test('*** an unknown stop reason is not silently treated as complete OR as truncated ***', async () => {
  // 'content_filter' is neither. It must not raise the truncation warning, and the absence of
  // a warning must not be read as a guarantee the reply finished — that is what stopReason
  // telemetry is for, and it is recorded whether or not this flag is set.
  const app = appWithStop('content_filter')
  await withServer(app, async () => {
    const r = await post(app, { message: '你好', interactionMode: 'chat' })
    assert.equal(r.json.truncated, false)
  })
})

test('*** the truncation warning is styled to be seen, not to be skipped ***', () => {
  const css = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '..', 'demo', 'assets', 'app.css'), 'utf8')
  const block = css.slice(css.indexOf('.served.truncated'))
  // The attribution row is deliberately faint. A warning that inherited that styling would be
  // a warning designed to be missed.
  assert.ok(/color:\s*var\(--warn\)/.test(block), 'warn colour')
  // ⛔ THE TOKEN, NOT A RAW WEIGHT. The design system declares exactly two weights and a
  // guard enforces it; my first version of this rule hardcoded 600 and that guard caught it.
  // Asserting the raw number here would have re-created the violation in the test.
  assert.ok(/font-weight:\s*var\(--weight-medium\)/.test(block), 'the medium token, the only step up')
  assert.equal(/\.served\.truncated\s*\{[^}]*var\(--faint\)/.test(css), false, 'never the faint footer colour')
})
