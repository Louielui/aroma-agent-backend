'use strict'

/**
 * demoHtml.js — assembles the 香香 page from real asset files.
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

const ASSET_DIR = path.join(__dirname, 'assets')

function readAsset (name) {
  const p = path.join(ASSET_DIR, name)
  const text = fs.readFileSync(p, 'utf8')
  if (!text || text.trim() === '') throw new Error(`demoHtml: asset ${name} is empty`)
  return text
}

/**
 * Inline the CSS/JS into their placeholder comments. `split/join` is used rather than
 * String.replace because a replacement string containing `$&`, `$1` etc. would otherwise
 * be interpreted as a substitution pattern and silently corrupt the asset.
 */
function buildDemoHtml () {
  const html = readAsset('index.html')
  const css = readAsset('app.css')
  const js = readAsset('app.js')
  const out = html.split('/*INLINE_CSS*/').join(css).split('/*INLINE_JS*/').join(js)
  if (out.includes('/*INLINE_CSS*/') || out.includes('/*INLINE_JS*/')) {
    throw new Error('demoHtml: an inline placeholder was not replaced')
  }
  return out
}

const DEMO_HTML = buildDemoHtml()

module.exports = { DEMO_HTML, buildDemoHtml, ASSET_DIR }
