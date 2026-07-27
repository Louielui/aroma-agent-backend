'use strict'

/**
 * appManifest.test.js — the page is installable, and installing it fetches nothing new.
 *
 * The install path is easy to get subtly wrong in ways that only show up as "Chrome does
 * not offer Install" with no error anywhere: a start_url that 404s, a missing display
 * mode, an icon Chrome will not accept. These assert the criteria directly.
 */

const test = require('node:test')
const assert = require('node:assert')
const express = require('express')

const { MANIFEST, MANIFEST_JSON, buildAppIconSvg } = require('./appManifest')
const { createDemoRouter } = require('../routes/demoRouter')

// Same shape the demo router's own tests use — a real listener, real fetch, no new dep.
function makeApp (demoOn) {
  const app = express()
  app.use(express.json())
  if (demoOn) app.locals.conversationDemo = true
  app.use(createDemoRouter({}))
  app.use((req, res) => res.status(404).json({ error: 'Not found' }))
  return app
}

async function get (app, path) {
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  try {
    const res = await fetch('http://127.0.0.1:' + server.address().port + path)
    return { status: res.status, type: res.headers.get('content-type') || '', text: await res.text() }
  } finally {
    await new Promise((r) => server.close(r))
  }
}

/* ── Chrome's installability criteria, asserted one by one ────────────────── */

test('*** the manifest meets Chrome\'s install criteria ***', () => {
  assert.equal(MANIFEST.name, '守燈')
  assert.equal(MANIFEST.short_name, '守燈')
  assert.equal(MANIFEST.display, 'standalone', 'standalone is what removes the address bar')
  assert.ok(MANIFEST.start_url, 'a start_url is required')
  assert.ok(Array.isArray(MANIFEST.icons) && MANIFEST.icons.length > 0, 'at least one icon')
  assert.ok(MANIFEST.icons.some((i) => i.purpose === 'any'), 'an "any" icon for desktop/taskbar')
  assert.ok(MANIFEST.icons.some((i) => i.purpose === 'maskable'), 'a maskable icon for Android')
  assert.equal(MANIFEST.theme_color, '#faf7f2')
  assert.equal(MANIFEST.background_color, '#faf7f2')
})

test('*** start_url points at a page that actually exists ***', async () => {
  // '/' is a 404 on this server. A manifest whose start_url 404s installs an app that
  // opens to an error page, and nothing warns you.
  assert.equal(MANIFEST.start_url, '/demo')
  const app = makeApp(true)
  assert.equal((await get(app, MANIFEST.start_url)).status, 200, 'start_url must not 404')
  assert.equal((await get(app, '/manifest.webmanifest')).status, 200)
})

test('the manifest route serves the right content type and parses', async () => {
  const res = await get(makeApp(true), '/manifest.webmanifest')
  assert.match(res.type, /application\/manifest\+json/)
  assert.deepEqual(JSON.parse(res.text), MANIFEST)
})

test('it is guarded exactly like the page it describes', async () => {
  assert.equal((await get(makeApp(false), '/manifest.webmanifest')).status, 403,
    'demo off -> the manifest is refused too')
})

/* ── nothing is fetched from anywhere ─────────────────────────────────────── */

test('*** installing fetches nothing new: the icon is inline, not a URL ***', () => {
  for (const i of MANIFEST.icons) {
    assert.ok(i.src.startsWith('data:image/svg+xml,'), 'icons are embedded, not linked')
  }
  assert.equal(MANIFEST_JSON.includes('http://'), false, 'no literal http:// in the served JSON')
  assert.equal(MANIFEST_JSON.includes('https://'), false)
  assert.equal(MANIFEST_JSON.includes('cdn'), false)
})

/* ── the tile is a real app icon, not a sliver ────────────────────────────── */

test('the app icon is a square canvas holding one centred dot', () => {
  const svg = buildAppIconSvg()
  assert.ok(svg.includes('viewBox="0 0 512 512"'), 'square canvas')
  assert.ok(svg.includes('<circle'), 'the dot')
  assert.equal(svg.includes('var(--'), false, 'no theme token can repaint it')
  // Geometry, padding and the 32px check live in dotIcon.test.js, which owns the mark.
})

test('the page links the manifest and declares a theme colour for both schemes', () => {
  const { DEMO_HTML } = require('./demoHtml')
  assert.ok(/<link rel="manifest" href="\/manifest\.webmanifest">/.test(DEMO_HTML))
  assert.ok(/name="theme-color"[^>]*media="\(prefers-color-scheme: light\)"/.test(DEMO_HTML))
  assert.ok(/name="theme-color"[^>]*media="\(prefers-color-scheme: dark\)"/.test(DEMO_HTML))
})
