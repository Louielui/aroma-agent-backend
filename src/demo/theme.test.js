'use strict'

/**
 * theme.test.js — the visual language lives in tokens, in ONE place.
 *
 * The Owner adjusts this by saying "background a bit warmer" or "text bigger". That is only
 * a one-line change if nothing below :root re-states a colour, a size or a weight — so
 * these tests check the DISCIPLINE, not just the current values: any rule that hardcodes
 * type outside the token block is a place where the next adjustment would half-apply.
 */

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const { ASSET_DIR } = require('./demoHtml')
const CSS = fs.readFileSync(path.join(ASSET_DIR, 'app.css'), 'utf8')

const ROOT = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('@media (prefers-color-scheme: dark)'))
const DARK = (CSS.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[\s\S]*?\n\}/) || [''])[0]
const BODY = CSS.slice(CSS.indexOf('* { box-sizing'))

function token (name, block = ROOT) {
  const m = block.match(new RegExp('--' + name + ':\\s*([^;]+);'))
  return m ? m[1].trim() : null
}

/* ── the values the Owner asked for ───────────────────────────────────────── */

test('*** EXACT values, read from Manus computed styles ***', () => {
  // These came from the reference's own computed styles, so they are not judgement calls.
  assert.equal(token('msg-size'), '16px')
  assert.equal(token('line'), '#e5e7eb', 'border colour')
  assert.equal(token('divider'), '#e5e7eb', 'divider is the same value in the reference')
  assert.equal(
    token('font-sans').replace(/\s+/g, ' '),
    '-apple-system, BlinkMacSystemFont, "Segoe UI Variable Display", "Segoe UI", Helvetica, "Apple Color Emoji", Arial, sans-serif, "Segoe UI Emoji", "Segoe UI Symbol"',
    'the stack is used verbatim, in order'
  )
})

test('*** OWNER-DIRECTED layout — deliberate departures from the Manus reference ***', () => {
  // `col` and `msg-line` used to sit in the EXACT group above, because they were read from
  // Manus's computed styles. They are no longer that: the Owner asked for a wider column
  // with less margin (2026-08-03), so their provenance is now a decision, not a
  // measurement, and pretending otherwise would make the group above a lie.
  assert.equal(token('col'), '768px', 'the message column — widened on Owner direction')
  assert.equal(token('msg-line'), '1.6', 'leading raised to suit the longer measure')
  assert.equal(token('user-bubble-max'), '86%', 'only the USER bubble stays narrow')

  // The assistant's text must NOT be squeezed a second time inside the column. Two stacked
  // caps — a 634px column and an 86% body — were what made the page read as mostly margin.
  assert.match(CSS, /\.body \{[^}]*max-width: 100%/, 'the reply uses the whole column')
  assert.match(CSS, /\.turn\.user \.body \{[^}]*max-width: var\(--user-bubble-max\)/,
    'and the narrower cap applies to the user bubble only')
})

test('*** APPROXIMATE values, sampled from a screenshot — flagged as such in the source ***', () => {
  // Marked approximate so the next correction is obvious and cheap. If these ever become
  // computed values, the comment moves with them.
  assert.equal(token('bg'), '#FDFCFA', 'main chat background')
  assert.equal(token('panel'), '#F6F4F1', 'sidebar')
  assert.equal(token('ink'), '#1A1A18', 'body text')
  assert.equal(token('bubble-user'), '#F7F6F4', 'the user bubble')
  const surfaces = ROOT.slice(ROOT.indexOf('--bg:'), ROOT.indexOf('--card:'))
  assert.match(ROOT, /APPROXIMATE/, 'the source says which values are sampled')
  assert.match(ROOT, /EXACT/, 'and which are computed')
  assert.ok(surfaces.includes('~'), 'the sampled ones are marked inline too')
})

test('the rest of the scale is unchanged and still declared', () => {
  assert.equal(token('ui-size'), '14px')
  assert.equal(token('weight-normal'), '400')
  assert.equal(token('faint'), '#8A8A85')
  assert.ok(token('msg-gap'), 'the space between messages is a token, not a literal')
})

test('the body actually uses them — a token nothing reads is decoration', () => {
  assert.match(BODY, /background:\s*var\(--bg\)/)
  assert.match(BODY, /color:\s*var\(--ink\)/)
  assert.match(BODY, /font-family:\s*var\(--font-sans\)/)
  assert.match(BODY, /font-size:\s*var\(--msg-size\)/)
  assert.match(BODY, /line-height:\s*var\(--msg-line\)/)
  assert.match(BODY, /font-weight:\s*var\(--weight-normal\)/)
  assert.match(CSS, /#sidebar\s*\{[^}]*background:\s*var\(--panel\)/, 'the sidebar reads --panel')
})

/* ── nothing bold in running text ─────────────────────────────────────────── */

test('*** running text is never bold: only two weights exist, 400 and 500 ***', () => {
  assert.equal(token('weight-normal'), '400')
  assert.equal(token('weight-medium'), '500')
  // every weight outside :root goes through a token — the old sheet had 550/600/650
  const weights = BODY.match(/font-weight:\s*[^;]+;/g) || []
  for (const w of weights) {
    assert.match(w, /var\(--weight-(normal|medium)\)/, 'weight via token: ' + w.trim())
  }
})

/* ── the discipline: no type hardcoded outside the token block ────────────── */

test('*** no rule outside :root restates a font size, except icon glyphs ***', () => {
  // An icon glyph (☰ ＋ ↑) is sized to the glyph, not to the type scale, so those are the
  // deliberate exceptions and are listed by the selector that owns them.
  const GLYPH_OWNERS = ['.icon-btn', '#plus', '#send', '#picker .caret']
  const offenders = []
  const ruleRe = /([^{}]+)\{([^}]*)\}/g
  let m
  while ((m = ruleRe.exec(BODY))) {
    const selector = m[1].trim().replace(/\s+/g, ' ')
    const body = m[2]
    if (!/font-size:\s*\d|font:\s*\d+(?:\.\d+)?px/.test(body)) continue
    if (GLYPH_OWNERS.some((g) => selector.includes(g))) continue
    // em-relative sizes scale WITH the token, so they are not a second source of truth
    if (/font-size:\s*[\d.]+em|font:\s*[\d.]+em/.test(body) && !/\d+px/.test(body)) continue
    offenders.push(selector + ' { ' + body.trim().slice(0, 60) + ' }')
  }
  assert.deepEqual(offenders, [], 'these would not follow a token change')
})

test('headings scale with the body and can never end up smaller than it', () => {
  // h3 used to be 15px against a 15px body; with the body at 16px a literal would have
  // made headings SMALLER than the text they head. em keeps the ratio whatever the token.
  const h = CSS.match(/\.md h1 \{ font-size: ([^;]+); \} \.md h2 \{ font-size: ([^;]+); \} \.md h3 \{ font-size: ([^;]+); \}/)
  assert.ok(h, 'heading sizes found')
  for (const v of [h[1], h[2], h[3]]) {
    assert.match(v, /em$/, 'relative, not a pixel literal: ' + v)
    assert.ok(parseFloat(v) >= 1, 'never smaller than body: ' + v)
  }
})

/* ── dark mode ────────────────────────────────────────────────────────────── */

test('*** dark mode overrides the same names, so every rule follows it ***', () => {
  assert.ok(DARK.length > 0, 'a dark block exists')
  for (const name of ['bg', 'panel', 'card', 'line', 'divider', 'ink', 'muted', 'soft', 'faint']) {
    assert.ok(token(name, DARK), 'dark defines --' + name)
    assert.notEqual(token(name, DARK), token(name), '--' + name + ' actually changes')
  }
})

test('dark mode changes COLOUR only — type is shared between the themes', () => {
  for (const name of ['font-sans', 'font-mono', 'msg-size', 'msg-line', 'ui-size', 'small-size', 'weight-normal', 'weight-medium']) {
    assert.equal(token(name, DARK), null, 'dark must not restate --' + name)
  }
})

test('dark mode keeps the text levels in order and inverted', () => {
  const lum = (hex) => {
    const v = hex.replace('#', '')
    return (parseInt(v.slice(0, 2), 16) + parseInt(v.slice(2, 4), 16) + parseInt(v.slice(4, 6), 16)) / 3
  }
  // light: ink is darkest, faint is lightest. dark: the reverse.
  assert.ok(lum(token('ink')) < lum(token('muted')))
  assert.ok(lum(token('muted')) < lum(token('soft')))
  assert.ok(lum(token('soft')) < lum(token('faint')))
  assert.ok(lum(token('ink', DARK)) > lum(token('muted', DARK)))
  assert.ok(lum(token('muted', DARK)) > lum(token('soft', DARK)))
  assert.ok(lum(token('soft', DARK)) > lum(token('faint', DARK)))
  // and the page inverts: light bg is bright, dark bg is not
  assert.ok(lum(token('bg')) > 200 && lum(token('bg', DARK)) < 60)
})

/* ── the dot does not move with the theme ─────────────────────────────────── */

test('*** the avatar dot is #FFA02E in BOTH themes — no token reaches it ***', () => {
  const dot = fs.readFileSync(path.join(ASSET_DIR, 'dot.svg'), 'utf8')
  assert.match(dot, /fill="#FFA02E"/)
  assert.equal(dot.includes('var(--'), false, 'the artwork reads no token')
  assert.equal(dot.includes('currentColor'), false)
  assert.equal(DARK.includes('.avatar'), false, 'no dark rule targets the avatar')
  assert.equal(DARK.includes('FFA02E'), false, 'and the colour is not restated for dark')
  const rule = CSS.slice(CSS.indexOf('.avatar {'), CSS.indexOf('.brand-mark'))
  assert.equal(/color|background|fill/.test(rule), false, 'the avatar rule sets no colour at all')
})

/* ── no font is fetched ───────────────────────────────────────────────────── */

test('the font stack is local — no webfont, no CDN, nothing fetched', () => {
  const stack = token('font-sans')
  assert.equal(/@font-face|url\(|https?:/.test(CSS), false, 'nothing is fetched')
  assert.ok(stack.startsWith('-apple-system'), 'the reference stack, in its order')
  assert.ok(stack.includes('sans-serif'), 'a generic family is present')
})

test('*** the stack names no CJK face — a deliberate consequence of using it verbatim ***', () => {
  // The reference stack was given as authoritative and is used unchanged. It carries no
  // Chinese face, so CJK glyphs resolve through the generic `sans-serif` to the platform's
  // default — which was CHECKED in a browser, not assumed, and renders as Microsoft
  // JhengHei UI on this machine. This test records that as a known property rather than
  // letting it look like an oversight: if Chinese ever renders wrong somewhere, the fix is
  // to insert a CJK face before `sans-serif`, and this is the place that says so.
  const stack = token('font-sans')
  for (const cjk of ['JhengHei', 'PingFang', 'Noto Sans TC', 'Heiti', 'MingLiU']) {
    assert.equal(stack.includes(cjk), false, 'verbatim: no CJK face was added — ' + cjk)
  }
  assert.match(ROOT, /no CJK face of its own/, 'and the source explains why')
})

/* ── only the user gets a bubble ──────────────────────────────────────────── */

test('*** the assistant reply has NO bubble — plain text on the page background ***', () => {
  // Checked against the reference: only the user's message sits in a bubble. This was
  // already how it worked, so the assertion exists to keep it that way rather than to
  // record a change.
  const user = CSS.slice(CSS.indexOf('.turn.user .body {'), CSS.indexOf('.turn.bot .body'))
  const bot = CSS.slice(CSS.indexOf('.turn.bot .body'), CSS.indexOf('.md > *:first-child'))
  assert.match(user, /background:\s*var\(--bubble-user\)/, 'the user bubble is tinted')
  assert.match(user, /border:\s*1px solid var\(--line\)/)
  assert.match(user, /border-radius:\s*var\(--radius\)/)
  for (const forbidden of [/background/, /border/, /box-shadow/]) {
    assert.equal(forbidden.test(bot), false, 'the assistant reply carries no ' + forbidden)
  }
})

test('the bubble uses its own token, not the generic card surface', () => {
  // --card is white and belongs to menus and raised panels. The bubble is a warm tint and
  // must be tunable on its own, or "make the bubble warmer" would repaint every menu.
  assert.notEqual(token('bubble-user'), token('card'))
  assert.ok(token('bubble-user', DARK), 'dark mode gives it a value too')
})

test('the message column and the composer share ONE width token', () => {
  assert.match(CSS, /\.thread \{ max-width: var\(--col\)/)
  assert.match(CSS, /\.composer-col \{ max-width: var\(--col\)/)
})

/* ── the composer is a quiet container ────────────────────────────────────── */

test('*** the composer carries NO accent colour, resting or focused ***', () => {
  // It used to turn coral on :focus-within — and the cursor lives in the composer, so the
  // orange outline was effectively always on. Resting and focus states are both checked,
  // because removing it from one and leaving it in the other is the easy half-fix.
  const box = CSS.slice(CSS.indexOf('#composer-box {'), CSS.indexOf('#composer-box textarea {'))
  assert.ok(box.length > 0, 'composer rules found')
  assert.equal(/var\(--accent/.test(box), false, 'no accent anywhere in the composer')
  assert.match(box, /border:\s*1px solid var\(--line\)/, 'resting border is the neutral divider colour')
  assert.match(box, /border-color:\s*var\(--focus\)/, 'focus darkens to the neutral focus colour')
  assert.match(box, /box-shadow:[^;]*var\(--focus\)/, 'and the ring is that same neutral')
})

test('*** focus is still VISIBLE — removing the colour must not remove the indicator ***', () => {
  const box = CSS.slice(CSS.indexOf('#composer-box {'), CSS.indexOf('#composer-box textarea {'))
  assert.match(box, /:focus-within\s*\{/, 'a focus state exists at all')
  // and it clears WCAG 2.2's 3:1 for a focus indicator, in BOTH themes
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
  const L = (h) => { const v = h.replace('#', ''); const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) }
  const ratio = (a, b) => { const l1 = Math.max(L(a), L(b)), l2 = Math.min(L(a), L(b)); return (l1 + 0.05) / (l2 + 0.05) }
  for (const block of [ROOT, DARK]) {
    const f = token('focus', block)
    assert.ok(f, 'a focus colour is defined')
    assert.ok(ratio(f, token('card', block)) >= 3, 'focus vs the composer interior >= 3:1')
    assert.ok(ratio(f, token('bg', block)) >= 3, 'focus vs the page behind it >= 3:1')
  }
})

test('the accent survives everywhere it was NOT asked to change', () => {
  // "Keep the orange dot avatar and any orange used elsewhere untouched."
  assert.match(CSS, /\.new-chat:hover \{ border-color: var\(--accent\)/, 'sidebar button hover')
  assert.match(CSS, /#send[^{]*\{[^}]*background: var\(--accent\)/, 'the send button')
  assert.match(CSS, /\.typed:focus \{ outline: 2px solid var\(--accent\)/, 'the typed-EXECUTE field')
  assert.equal(token('accent'), '#d97757', 'the accent token itself is unchanged')
})
