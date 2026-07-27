'use strict'

/**
 * lanternIcon.test.js — the Aroma lantern replaces the 香 letter avatar.
 *
 * The two rules that make this different from an ordinary asset swap:
 *   1. it is a PHYSICAL OBJECT, so every colour is hardcoded and must not invert in dark
 *      mode — no CSS variable may reach the artwork;
 *   2. nothing may be fetched: the mark is inline SVG in all three places (header,
 *      favicon, chat avatar), from one source pair of files.
 */

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const { DEMO_HTML, buildDemoHtml, ASSET_DIR } = require('./demoHtml')

const CSS = fs.readFileSync(path.join(ASSET_DIR, 'app.css'), 'utf8')
const FULL = fs.readFileSync(path.join(ASSET_DIR, 'lantern.svg'), 'utf8')
const SMALL = fs.readFileSync(path.join(ASSET_DIR, 'lantern-small.svg'), 'utf8')

/* ── the mark is present in all three places, inline ──────────────────────── */

test('*** the 香 letter avatar is gone and the lantern is cloned in its place ***', () => {
  assert.ok(!DEMO_HTML.includes("'avatar', '香'"), 'the letter avatar is gone')
  assert.ok(DEMO_HTML.includes('id="tpl-avatar"'), 'the avatar template is in the document')
  assert.ok(DEMO_HTML.includes('tpl.content.cloneNode(true)'), 'and it is cloned, not built from a string')
})

test('the header carries the FULL lantern and the avatar the SIMPLIFIED one', () => {
  assert.ok(DEMO_HTML.includes('class="brand-mark"'), 'the header mark exists')
  // the full drawing is the tall one; the simplified one is the 40x40 square
  assert.ok(DEMO_HTML.includes('viewBox="0 0 200 360"'), 'full version present')
  assert.ok(DEMO_HTML.includes('viewBox="0 0 40 40"'), 'simplified version present')
  const head = DEMO_HTML.slice(0, DEMO_HTML.indexOf('id="log"'))
  assert.ok(head.includes('viewBox="0 0 200 360"'), 'the full one is the header/favicon mark')
  const tpl = DEMO_HTML.slice(DEMO_HTML.indexOf('id="tpl-avatar"'))
  assert.ok(tpl.includes('viewBox="0 0 40 40"'), 'the simplified one is the chat avatar')
})

test('the favicon is the full lantern, inlined as a data: URI — no request, no file', () => {
  const link = (DEMO_HTML.match(/<link[^>]*>/g) || [])[0] || ''
  assert.ok(/rel="icon"/.test(link) && /type="image\/svg\+xml"/.test(link), 'an SVG favicon')
  assert.ok(/href="data:image\/svg\+xml,/.test(link), 'inline, not fetched')
  const uri = decodeURIComponent(link.match(/href="data:image\/svg\+xml,([^"]*)"/)[1])
  assert.equal(uri, FULL.trim(), 'it is exactly the full lantern file')
  assert.ok(uri.includes('xmlns='), 'a data: URI is standalone XML, so xmlns is REQUIRED there')
})

test('the in-page copies drop xmlns, so no literal http:// enters the document', () => {
  assert.ok(FULL.includes('xmlns=') && SMALL.includes('xmlns='), 'the source files are standalone-valid')
  assert.ok(!DEMO_HTML.includes('http://'), 'but the page carries no literal http://')
  assert.ok(!DEMO_HTML.includes('https://'))
  const inPage = DEMO_HTML.slice(DEMO_HTML.indexOf('<body'))
  assert.ok(!/<svg[^>]*xmlns=/.test(inPage), 'inline SVG needs no xmlns in HTML')
})

/* ── a physical object does not invert ────────────────────────────────────── */

test('*** every colour in the artwork is hardcoded — no token can repaint it ***', () => {
  for (const svg of [FULL, SMALL]) {
    assert.ok(!svg.includes('var(--'), 'no CSS variable in the artwork')
    assert.ok(!svg.includes('currentColor'), 'nothing inherits the text colour')
    for (const m of svg.match(/(?:fill|stroke)="([^"]+)"/g) || []) {
      const v = m.split('"')[1]
      assert.ok(v === 'none' || /^#[0-9A-Fa-f]{6}$/.test(v), 'literal hex or none only: ' + m)
    }
  }
})

test('the avatar disc is hardcoded too, so it is identical in light and dark mode', () => {
  const rule = CSS.slice(CSS.indexOf('.avatar {'), CSS.indexOf('.brand-mark'))
  assert.ok(!rule.includes('var(--'), 'the avatar rule uses no theme token')
  assert.ok(rule.includes('#FDF4E6'), 'the pale disc is a literal colour')
  // Look INSIDE each dark-mode block rather than anywhere after it — the artwork must not
  // be repainted there. (Written the lazy way first, this matched the whole file.)
  for (const m of CSS.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[\s\S]*?\n\}/g) || []) {
    assert.ok(!m.includes('.avatar'), 'no dark-mode override targets the avatar')
    assert.ok(!m.includes('.brand-mark'), 'nor the header mark')
  }
})

/* ── it has to work SMALL, which is the whole point of the simplified版 ────── */

test('*** the avatar renders at small sizes: box 28px, artwork 24px, and it is vector ***', () => {
  const rule = CSS.slice(CSS.indexOf('.avatar {'), CSS.indexOf('.brand-mark'))
  assert.ok(/width:\s*28px/.test(rule) && /height:\s*28px/.test(rule), 'the avatar box is 28px')
  assert.ok(/\.avatar svg\s*{[^}]*width:\s*24px/.test(CSS), 'the svg is explicitly sized, never intrinsic')
  assert.ok(/\.avatar svg\s*{[^}]*height:\s*24px/.test(CSS))
  // vector + a square viewBox ⇒ it scales to any of 24/28/32px without cropping
  assert.ok(SMALL.includes('viewBox="0 0 40 40"'), 'square viewBox scales cleanly')
  const root = SMALL.match(/<svg[^>]*>/)[0] // the shapes inside legitimately carry width/height
  assert.ok(!/\swidth=/.test(root) && !/\sheight=/.test(root), 'no fixed pixel size baked into the file')
})

test('the simplified version really is simpler — it must survive 32px', () => {
  const count = (s) => (s.match(/<(path|line|ellipse|circle|rect)\b/g) || []).length
  assert.ok(count(SMALL) <= 10, 'few enough shapes to read at 32px, got ' + count(SMALL))
  assert.ok(count(FULL) > count(SMALL) * 2, 'the full version is the detailed one')
  // nothing thinner than a device pixel at 32px: 40-unit viewBox scaled to 32 ⇒ x0.8
  for (const m of SMALL.match(/stroke-width="([\d.]+)"/g) || []) {
    assert.ok(parseFloat(m.split('"')[1]) * (32 / 40) >= 0.7, 'stroke survives 32px: ' + m)
  }
})

test('the artwork has one source: the page is rebuilt from the files, deterministically', () => {
  assert.equal(buildDemoHtml(), DEMO_HTML)
  for (const f of ['lantern.svg', 'lantern-small.svg']) {
    assert.ok(fs.existsSync(path.join(ASSET_DIR, f)), 'asset stays in assets/: ' + f)
  }
})

/* ── the name and the text are untouched ──────────────────────────────────── */

test('*** icon only — the name 香香 and every string are unchanged ***', () => {
  assert.ok(DEMO_HTML.includes('<title>香香</title>'))
  assert.ok(DEMO_HTML.includes('<span class="brand">香香</span>'))
  assert.ok(DEMO_HTML.includes('<h1 id="conv-title">香香</h1>'))
  assert.ok(DEMO_HTML.includes('同香香講嘢…'))
  assert.ok(DEMO_HTML.includes('香香（Claude）'))
})
