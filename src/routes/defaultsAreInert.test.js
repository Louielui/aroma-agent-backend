'use strict'

/**
 * defaultsAreInert.test.js — a route factory's DEFAULT may not be a real writer.
 *
 * ── WHAT HAPPENED ────────────────────────────────────────────────────────────
 * Conversation History v1 added one write to the demo route and defaulted it to the
 * process-wide store, which points at the real data directory. Six existing test files
 * drive that route; one of them — archiveEndToEnd — posts a conversationId. So every full
 * suite run wrote four fixture conversations into the Owner's real data\conversations\,
 * and 「MAIL_TITLE_SENTINEL」 appeared in his sidebar as a Gmail subject. Running the suite
 * twice appended the same turn twice, which is why one of them rendered doubled.
 *
 * Nothing real was overwritten — the fixture ids cannot collide with a browser UUID — but
 * that was luck, not design. The directory those files landed in is synced offsite nightly.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────
 * A factory called with no dependencies must be INERT. Production wires the real writer
 * explicitly in app.js; a caller who did not ask for persistence does not get it. That
 * makes "a test escaped into real data" unrepresentable rather than merely discouraged —
 * the same reasoning as the read connector's method constant and the closed PATHS table.
 *
 * These tests are the guard. They drive the real routes with NO injection and assert the
 * real files on disk are untouched, so if a default ever becomes a writer again the suite
 * says so instead of the Owner's sidebar saying so.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const fs = require('node:fs')
const path = require('node:path')

const { createDemoRouter } = require('./demoRouter')
const { createSettingsRouter } = require('./settingsRouter')
const { conversationStore } = require('../store/conversationStore')
const { settingsPath } = require('../persona/ownerSettings')

/** A conversation id that is valid, unmistakable, and mine. */
const PROBE_ID = 'inert-default-probe-0001'

/**
 * A GUARD THAT DAMAGES REAL STATE WHEN IT FAILS IS NOT A GUARD.
 *
 * The first run of this file proved the defect by writing a probe conversation into the
 * real data directory and CREATING a real owner-settings.json that had never existed. That
 * is the defect doing exactly what it does — but a test must not leave it behind. Every
 * probe below restores the prior state in a finally, so a red run reports and cleans up.
 */
function restoring (targets, fn) {
  const prior = targets.map((p) => ({ p, existed: fs.existsSync(p), body: fs.existsSync(p) ? fs.readFileSync(p) : null }))
  const undo = () => {
    for (const s of prior) {
      try {
        if (s.existed) fs.writeFileSync(s.p, s.body)
        else if (fs.existsSync(s.p)) fs.unlinkSync(s.p)
      } catch (_) {}
    }
  }
  return Promise.resolve().then(fn).then((v) => { undo(); return v }, (e) => { undo(); throw e })
}

async function post (app, p, body) {
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  try {
    const port = server.address().port
    const res = await fetch(`http://127.0.0.1:${port}${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    let json = null
    try { json = await res.json() } catch (_) {}
    return { status: res.status, body: json }
  } finally { await new Promise((r) => server.close(r)) }
}

/** Everything currently in the REAL conversation directory, as a comparable snapshot. */
function realDirSnapshot () {
  try { return fs.readdirSync(conversationStore.dir).sort().join('|') } catch (_) { return '(absent)' }
}

/* ── the demo route ──────────────────────────────────────────────────────── */

test('*** a demo router built with NO store does not write to real data ***', async () => {
  const probeFile = path.join(conversationStore.dir, PROBE_ID + '.json')
  await restoring([probeFile], async () => {
    const before = realDirSnapshot()

    const app = express()
    app.use(express.json())
    app.locals.conversationDemo = true
    // EXACTLY what the six existing test files do: no conversationStore injected.
    app.use(createDemoRouter({
      getAdapterFn: () => ({ providerName: 'spy' }),
      processIntakeFn: async () => ({ reply: 'INERT_DEFAULT_PROBE_REPLY', mode: 'chat' })
    }))

    const res = await post(app, '/api/v1/demo/intake', { message: '呢個唔應該落地', conversationId: PROBE_ID })
    assert.equal(res.status, 200, 'the turn still answers')

    assert.equal(realDirSnapshot(), before, 'the real conversation directory must be untouched')
    assert.equal(conversationStore.get(PROBE_ID), null, 'and nothing was written under the probe id')
  })
})

test('*** the inert default still satisfies the read routes — it is empty, not broken ***', async () => {
  const app = express()
  app.use(express.json())
  app.locals.conversationDemo = true
  app.use(createDemoRouter({ getAdapterFn: () => ({ providerName: 'spy' }), processIntakeFn: async () => ({ reply: 'x' }) }))

  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  try {
    const port = server.address().port
    const list = await (await fetch(`http://127.0.0.1:${port}/api/v1/conversations`)).json()
    assert.deepEqual(list.conversations, [], 'an inert store lists nothing rather than throwing')
    const one = await fetch(`http://127.0.0.1:${port}/api/v1/conversations/${PROBE_ID}`)
    assert.equal(one.status, 404, 'and knows nothing')
  } finally { await new Promise((r) => server.close(r)) }
})

test('*** an explicitly injected store DOES write — the inversion is the default, not the feature ***', async () => {
  const written = []
  const app = express()
  app.use(express.json())
  app.locals.conversationDemo = true
  app.use(createDemoRouter({
    conversationStore: { appendTurn: (t) => { written.push(t.id) }, list: () => [], get: () => null, remove: () => false },
    getAdapterFn: () => ({ providerName: 'spy' }),
    processIntakeFn: async () => ({ reply: 'ok', mode: 'chat' })
  }))
  await post(app, '/api/v1/demo/intake', { message: 'hi', conversationId: PROBE_ID })
  assert.deepEqual(written, [PROBE_ID], 'persistence still works when it was actually asked for')
})

/* ── the settings route: the same shape, found by the same reasoning ─────── */

test('*** a settings router built with NO save does not write the real settings file ***', async () => {
  const p = settingsPath()
  await restoring([p], async () => {
    const before = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '(absent)'

    const app = express()
    app.use(express.json())
    app.use(createSettingsRouter()) // no deps — the shape that bit us on the demo route

    await post(app, '/api/v1/settings', { style: 'INERT_DEFAULT_PROBE_STYLE', preferences: '' })

    const after = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '(absent)'
    assert.equal(after, before, 'the Owner\'s real settings file must be untouched')
    assert.equal(after.includes('INERT_DEFAULT_PROBE_STYLE'), false, 'and must not contain a probe value')
  })
})

test('an injected save still saves', async () => {
  const saved = []
  const app = express()
  app.use(express.json())
  app.use(createSettingsRouter({
    load: () => ({ style: '', preferences: '', updatedAt: null }),
    save: (input) => { saved.push(input); return { ok: true, settings: { updatedAt: 'now' } } }
  }))
  const res = await post(app, '/api/v1/settings', { style: 'hello', preferences: '' })
  assert.equal(res.status, 200)
  assert.equal(saved.length, 1)
})

/* ── the shape itself ────────────────────────────────────────────────────── */

test('*** no route factory defaults a WRITER to a process-wide real instance ***', () => {
  // The specific line that caused this: `conversationStore = defaultConversationStore` in
  // the factory signature. A grep is crude, but this defect is textual — it is a default
  // parameter pointing at a module-level singleton — and it is worth catching at the point
  // it is typed rather than after a suite run.
  const dir = path.join(__dirname)
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.js') || name.includes('.test.')) continue
    const src = fs.readFileSync(path.join(dir, name), 'utf8')
    const sig = src.match(/function create\w*Router \(([^)]*)\)/)
    if (!sig) continue
    assert.equal(/=\s*default[A-Z]\w*Store/.test(sig[1]), false,
      `${name}: a router default must not be a real store — inject it in app.js instead`)
  }
})
