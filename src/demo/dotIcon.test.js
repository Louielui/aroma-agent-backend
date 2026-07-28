'use strict'

/**
 * dotIcon.test.js — the mark is a plain solid dot, in one place, at one size knob.
 *
 * Replaces lanternIcon.test.js. The lantern and its two SVGs are gone; these assertions
 * exist so nothing grows back onto the dot — no ring, no glow, no disc behind it, no
 * second copy of the colour that could drift from the first.
 */

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const { DEMO_HTML, buildDemoHtml, ASSET_DIR } = require('./demoHtml')
const { buildAppIconSvg, readDotColour, DOT_FRACTION, ICON_CANVAS } = require('./appManifest')

const CSS = fs.readFileSync(path.join(ASSET_DIR, 'app.css'), 'utf8')
const DOT = fs.readFileSync(path.join(ASSET_DIR, 'dot.svg'), 'utf8')
const COLOUR = '#FFA02E'

/* ── the lantern is gone, cleanly ─────────────────────────────────────────── */

test('*** the lantern assets and their assembler are removed, not orphaned ***', () => {
  for (const gone of ['lantern.svg', 'lantern-small.svg']) {
    assert.equal(fs.existsSync(path.join(ASSET_DIR, gone)), false, 'asset deleted: ' + gone)
  }
  assert.equal(fs.existsSync(path.join(__dirname, 'lanternIcon.test.js')), false, 'its test is gone too')
  // no dangling placeholder or reference anywhere in the built page or the assembler
  assert.equal(DEMO_HTML.includes('LANTERN'), false, 'no unreplaced placeholder')
  assert.equal(DEMO_HTML.includes('lantern'), false)
  const assembler = fs.readFileSync(path.join(__dirname, 'demoHtml.js'), 'utf8')
  assert.equal(/lantern\.svg|lantern-small\.svg|INLINE_LANTERN/.test(assembler), false,
    'the assembler no longer names a file that does not exist')
  const manifestSrc = fs.readFileSync(path.join(__dirname, 'appManifest.js'), 'utf8')
  assert.equal(/lantern/i.test(manifestSrc), false)
})

/* ── it is a plain dot ────────────────────────────────────────────────────── */

test('*** the mark is ONE filled circle — no ring, no glow, no inner shapes ***', () => {
  const shapes = DOT.match(/<(circle|rect|path|line|ellipse|polygon|g)\b/g) || []
  assert.deepEqual(shapes, ['<circle'], 'exactly one shape, and it is a circle')
  assert.equal(/stroke=/.test(DOT), false, 'no ring')
  assert.equal(/filter|feGaussianBlur|opacity=|gradient/i.test(DOT), false, 'no glow, no gradient')
  assert.match(DOT, /fill="#FFA02E"/, 'the colour the Owner asked for')
  // it fills its own viewBox: r equals half the box, so the dot IS the avatar
  const vb = DOT.match(/viewBox="0 0 (\d+) (\d+)"/)
  const r = Number(DOT.match(/r="([\d.]+)"/)[1])
  assert.equal(Number(vb[1]), Number(vb[2]), 'square viewBox')
  assert.equal(r * 2, Number(vb[1]), 'full-bleed: the dot touches the edges of its own box')
})

test('*** hardcoded colour: nothing can repaint or invert it ***', () => {
  assert.equal(DOT.includes('var(--'), false)
  assert.equal(DOT.includes('currentColor'), false)
  assert.equal(readDotColour(), COLOUR)
  for (const m of CSS.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[\s\S]*?\n\}/g) || []) {
    assert.equal(m.includes('.avatar'), false, 'no dark-mode override touches the avatar')
    assert.equal(m.includes('.brand-mark'), false)
  }
})

test('*** no disc behind the dot — the dot IS the avatar ***', () => {
  const rule = CSS.slice(CSS.indexOf('.avatar {'), CSS.indexOf('.brand-mark'))
  assert.equal(/background/.test(rule), false, 'no background behind it')
  assert.equal(/box-shadow/.test(rule), false, 'no ring')
  assert.equal(/border(?!-)/.test(rule), false, 'no border')
  assert.match(CSS, /\.avatar svg\s*\{[^}]*width:\s*100%/, 'the mark fills the avatar box exactly')
})

/* ── the colour has ONE source ────────────────────────────────────────────── */

test('the square icon reads its colour from dot.svg, so the two cannot drift', () => {
  assert.ok(buildAppIconSvg().includes(readDotColour()))
  // the literal appears in the artwork, not duplicated in the generator
  const manifestSrc = fs.readFileSync(path.join(__dirname, 'appManifest.js'), 'utf8')
  assert.equal(manifestSrc.includes(COLOUR), false, 'the colour is not written a second time in code')
})

/* ── the square canvas is padded, and checked at 32px ─────────────────────── */

test('*** the square icon keeps the dot clear of the edges (checked at 32px) ***', () => {
  const svg = buildAppIconSvg()
  assert.ok(svg.includes('viewBox="0 0 512 512"'), 'square canvas')
  const shapes = svg.match(/<(circle|rect|path|line|ellipse|polygon|g)\b/g) || []
  assert.deepEqual(shapes, ['<circle'], 'still just the dot — no tile, no ring')
  const r = Number(svg.match(/r="([\d.]+)"/)[1])
  const cx = Number(svg.match(/cx="([\d.]+)"/)[1])
  assert.equal(cx, ICON_CANVAS / 2, 'centred')
  assert.equal(r * 2, ICON_CANVAS * DOT_FRACTION)
  // 62.5% diameter ⇒ at a 32px render: a 20px dot with 6px clear on every side
  assert.equal(Math.round(32 * DOT_FRACTION), 20, 'dot is 20px at 32px')
  assert.equal(Math.round((32 - 32 * DOT_FRACTION) / 2), 6, 'padding is 6px at 32px')
  // and comfortably inside the 80% maskable safe circle, so an Android crop takes only canvas
  assert.ok(DOT_FRACTION < 0.8, 'inside the maskable safe zone')
})

/* ── the size knob ────────────────────────────────────────────────────────── */

test('*** --avatar-size is the ONLY place the avatar size is written ***', () => {
  assert.match(CSS, /--avatar-size:\s*24px/, 'declared in :root, currently 24px')
  const rule = CSS.slice(CSS.indexOf('.avatar {'), CSS.indexOf('.brand-mark'))
  for (const prop of ['flex', 'width', 'height']) {
    assert.match(rule, new RegExp(prop + ':[^;]*var\\(--avatar-size\\)'), prop + ' derives from the variable')
  }
  // no stray pixel size left behind in the avatar rule other than the derived offset
  assert.equal(/(?:width|height|flex:\s*0\s*0)\s*:?\s*\d+px/.test(rule), false, 'no hardcoded size remains')
})

test('*** the row still lines up: the dot centres on the first line of the reply ***', () => {
  const rule = CSS.slice(CSS.indexOf('.avatar {'), CSS.indexOf('.brand-mark'))
  // Alignment derives from BOTH knobs — the avatar size and the line-height token — so
  // neither can be changed into a misaligned row. This assertion previously pinned a
  // literal 1.65em copied out of the body rule; when the line-height token moved to 1.75
  // the dot would have drifted off the line and this test would still have passed.
  assert.match(rule, /margin-top:\s*calc\(2px \+ \(var\(--msg-line\) \* 1em - var\(--avatar-size\)\) \/ 2\)/)
  // the things it derives from are tokens, and they exist
  assert.match(CSS, /--msg-line:\s*[\d.]+/, 'the line-height is a token')
  assert.match(CSS, /line-height:\s*var\(--msg-line\)/, 'and the body actually uses it')
  assert.match(CSS, /\.turn\.bot \.body \{ padding-top: 2px; \}/, 'bot body padding is 2px')
  // the served-by label lives INSIDE .body, so it shares the bubble's left edge
  assert.match(CSS, /\.served \{[^}]*margin-top/, 'served label is a block under the reply')
})

/* ── still one source, still nothing fetched ──────────────────────────────── */

test('the page is deterministic, and the dot appears in both places from one asset', () => {
  assert.equal(buildDemoHtml(), DEMO_HTML)
  assert.ok(DEMO_HTML.includes('class="brand-mark"'), 'header mark present')
  assert.ok(DEMO_HTML.includes('id="tpl-avatar"'), 'avatar template present')
  assert.equal((DEMO_HTML.match(/<circle cx="12" cy="12" r="12" fill="#FFA02E"\/>/g) || []).length, 2,
    'the same dot, inlined twice, from one file')
  assert.equal(DEMO_HTML.includes('http://'), false, 'no literal http:// in the page')
  assert.equal(DEMO_HTML.includes('https://'), false)
  assert.equal(/<img/.test(DEMO_HTML), false, 'no image request')
})

test('the favicon is the padded square, shared with the installed app icon', () => {
  const link = (DEMO_HTML.match(/<link[^>]*rel="icon"[^>]*>/g) || [])[0] || ''
  assert.ok(/href="data:image\/svg\+xml,/.test(link), 'inline, not fetched')
  const uri = decodeURIComponent(link.match(/href="data:image\/svg\+xml,([^"]*)"/)[1])
  assert.equal(uri, buildAppIconSvg(), 'byte-identical to the app icon — one square, two uses')
  assert.ok(uri.includes('xmlns='), 'a data: URI is standalone XML, so xmlns is required there')
})

test('*** icon only — the name 心燈 and every string are unchanged ***', () => {
  assert.ok(DEMO_HTML.includes('<title>心燈</title>'))
  assert.ok(DEMO_HTML.includes('<span class="brand">心燈</span>'))
  assert.ok(DEMO_HTML.includes('<h1 id="conv-title">心燈</h1>'))
  assert.ok(DEMO_HTML.includes('同心燈講嘢…'))
  assert.ok(DEMO_HTML.includes('心燈（Claude）'))
})
