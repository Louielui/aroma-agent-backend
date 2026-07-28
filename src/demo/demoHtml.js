'use strict'

/**
 * demoHtml.js — assembles the 心燈 page from real asset files.
 *
 * WHY THIS IS NO LONGER A TEMPLATE LITERAL. The whole UI used to live inside one
 * module-level backtick string. Every backtick, ${...} and backslash in the markup had
 * to be escaped by hand, and it silently bit us: a `join('\n')` written inside the
 * template emitted a REAL newline into a JavaScript string literal, which broke the
 * entire inline script — the page rendered, the script never ran, and nothing said so.
 * The UI is now three ordinary files under assets/ with no escaping rules at all.
 *
 * WHAT DID NOT CHANGE. The page is still ONE self-contained, same-origin document:
 * the CSS and JS are INLINED here at load time, so the browser makes no additional
 * request, there is no asset route to secure, and the existing static-safety scans keep
 * working on a single string. No external URL, CDN, font or image is ever introduced.
 *
 * The assets are read once at require() time. A file that fails to load is a startup
 * error, not a half-rendered page.
 */

const fs = require('node:fs')
const path = require('node:path')

const { iconDataUri } = require('./appManifest') // the padded square: favicon + app icon

const ASSET_DIR = path.join(__dirname, 'assets')

function readAsset (name) {
  const p = path.join(ASSET_DIR, name)
  const text = fs.readFileSync(p, 'utf8')
  if (!text || text.trim() === '') throw new Error(`demoHtml: asset ${name} is empty`)
  return text
}

/**
 * THE MARK. It is drawn ONCE, in dot.svg, and used in three places — the header mark, the
 * chat avatar, and (padded onto a square canvas by appManifest.js) the favicon and the
 * installed app icon. One source, so they cannot drift apart.
 *
 * Two rules govern how it is inlined:
 *
 * 1. INSIDE THE PAGE the xmlns attribute is STRIPPED. An HTML parser puts <svg> in the
 *    SVG namespace by itself, so the attribute is redundant there — and keeping it would
 *    put a literal "http://" in the page, which the static safety scan forbids outright.
 *    Rather than loosen that scan for a string browsers never fetch, the attribute is
 *    simply removed where it does nothing.
 *
 * 2. THE FAVICON is a data: URI, and a data: URI IS parsed as standalone XML, so there
 *    the xmlns is REQUIRED and kept. It is percent-encoded whole — no literal "http://"
 *    reaches the page, and no request leaves the browser.
 */
const XMLNS_ATTR = / xmlns="[^"]*"/g

function inlineSvg (name) {
  return readAsset(name).replace(XMLNS_ATTR, '').trim()
}

const PLACEHOLDERS = ['/*INLINE_CSS*/', '/*INLINE_JS*/', '/*INLINE_DOT*/', '/*FAVICON_URI*/']

/**
 * Inline the CSS/JS/artwork into their placeholder comments. `split/join` is used rather
 * than String.replace because a replacement string containing `$&`, `$1` etc. would
 * otherwise be interpreted as a substitution pattern and silently corrupt the asset.
 */
function buildDemoHtml () {
  const parts = {
    '/*INLINE_CSS*/': readAsset('app.css'),
    '/*INLINE_JS*/': readAsset('app.js'),
    // The same dot fills both the header mark and the avatar template, so one entry
    // replaces both occurrences.
    '/*INLINE_DOT*/': inlineSvg('dot.svg'),
    // The favicon is the padded SQUARE form, shared with the installed app icon so the
    // tab and the taskbar show the same thing. appManifest owns that geometry.
    '/*FAVICON_URI*/': iconDataUri()
  }
  let out = readAsset('index.html')
  for (const key of PLACEHOLDERS) out = out.split(key).join(parts[key])
  for (const key of PLACEHOLDERS) {
    if (out.includes(key)) throw new Error('demoHtml: an inline placeholder was not replaced: ' + key)
  }
  return out
}

const DEMO_HTML = buildDemoHtml()

module.exports = { DEMO_HTML, buildDemoHtml, ASSET_DIR }
