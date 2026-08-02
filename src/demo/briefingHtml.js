'use strict'

/**
 * briefingHtml.js — assembles the Morning Briefing page from real asset files, exactly
 * the way demoHtml.js assembles the chat page: three ordinary files under assets/, no
 * template-literal escaping rules, inlined into ONE self-contained same-origin document.
 *
 * No external URL, CDN, font or image is introduced. The assets are read once at
 * require() time; an empty or missing one is a startup error, not a half-rendered page.
 */

const fs = require('node:fs')
const path = require('node:path')

const { iconDataUri } = require('./appManifest') // the same mark the chat page uses

const ASSET_DIR = path.join(__dirname, 'assets')

function readAsset (name) {
  const p = path.join(ASSET_DIR, name)
  const text = fs.readFileSync(p, 'utf8')
  if (!text || text.trim() === '') throw new Error(`briefingHtml: asset ${name} is empty`)
  return text
}

/**
 * Ordered replacement, one placeholder at a time, using a REPLACER FUNCTION so that a
 * `$&` or `$1` occurring inside the CSS or JS is inserted literally instead of being
 * read as a replacement pattern.
 */
function inject (html, token, value) {
  if (!html.includes(token)) throw new Error(`briefingHtml: template is missing ${token}`)
  return html.replace(token, () => value)
}

let BRIEFING_HTML = readAsset('briefing.html')
BRIEFING_HTML = inject(BRIEFING_HTML, '__ICON__', iconDataUri())
BRIEFING_HTML = inject(BRIEFING_HTML, '__CSS__', readAsset('briefing.css'))
BRIEFING_HTML = inject(BRIEFING_HTML, '__JS__', readAsset('briefing.js'))

module.exports = { BRIEFING_HTML }
