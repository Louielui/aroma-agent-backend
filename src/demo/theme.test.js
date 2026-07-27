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

test('*** the Manus palette and type are the declared tokens ***', () => {
  assert.equal(token('bg'), '#F7F6F3', 'page background: warm off-white')
  assert.equal(token('panel'), '#F2F1ED', 'sidebar: a touch darker')
  assert.equal(token('ink'), '#2C2C2C', 'body text')
  assert.equal(token('faint'), '#8A8A85', 'muted / footer')
  assert.equal(token('msg-size'), '16px')
  assert.equal(token('msg-line'), '1.75')
  assert.equal(token('ui-size'), '14px')
  assert.equal(token('weight-normal'), '400')
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

test('the font stack is local: no webfont, no CDN, and CJK is still covered', () => {
  const stack = token('font-sans')
  assert.equal(/@font-face|url\(|https?:/.test(CSS), false, 'nothing is fetched')
  assert.ok(stack.includes('Inter'), 'Inter first for anyone who has it')
  assert.ok(stack.includes('sans-serif'), 'ends in a generic family')
  for (const cjk of ['Microsoft JhengHei', 'PingFang TC', 'Noto Sans TC']) {
    assert.ok(stack.includes(cjk), 'the interface is Chinese — keeps ' + cjk)
  }
})
