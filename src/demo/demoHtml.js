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

/**
 * ORDER MATTERS. INLINE_JS must be substituted before READ_SOURCE_LABELS, because the
 * source list lives inside app.js and only exists in `out` once the script has been
 * inlined. The loop below walks this array in order, so the new key belongs at the end.
 */
const PLACEHOLDERS = ['/*INLINE_I18N*/', '/*INLINE_CSS*/', '/*INLINE_JS*/', '/*INLINE_DOT*/', '/*FAVICON_URI*/', '/*READ_SOURCE_LABELS*/', '/*BUILD_STAMP*/']

/**
 * ── THE BUILD STAMP: how a stale tab tells on itself ─────────────────────────
 *
 * This file inlines app.js and app.css at require() time, so a tab loaded before a restart
 * keeps running the OLD client against the NEW server. That has cost a full round THREE
 * times: the reject button that "worked" and never called the server; the deterministic
 * entrance that did not appear; the backlog line that did not render.
 *
 * Each time it was diagnosed and recorded. It recurred anyway. Owner ruling 2026-08-06:
 * 「a lesson recorded three times without a mechanism is not a lesson, it is a note.」
 *
 * So the page carries the fingerprint of the assets it was built from, and asks the server
 * (GET /api/v1/demo/version) what it is serving now. Different → the page says so.
 *
 * A FINGERPRINT, NOT A TIMESTAMP. Same inputs must give the same stamp, or every page
 * would report itself stale and the warning would become noise within a day.
 *
 * @param {object} [overrides] asset name → contents, for tests that need a changed input
 */
function computeBuildStamp (overrides = {}) {
  const crypto = require('node:crypto')
  const h = crypto.createHash('sha256')
  // Exactly the assets that can go stale in a browser. index.html is included because the
  // placeholders and structure live there too.
  for (const name of ['app.js', 'app.css', 'index.html']) {
    h.update(name)
    h.update(Object.prototype.hasOwnProperty.call(overrides, name) ? overrides[name] : readAsset(name))
  }
  /**
   * ⛔ THE CATALOGUE IS PART OF THE PAGE, SO IT IS PART OF THE FINGERPRINT.
   * Every interface word is moving out of app.js and into the catalogue. Without this, rewording
   * anything would change what the page SAYS and not change its stamp — so a tab holding the old
   * wording would believe itself current. That is precisely the failure the stamp exists to
   * catch, re-entering through the door this round opened.
   */
  h.update('i18n')
  h.update(require('../i18n/browserResolver').browserI18nSource())
  return h.digest('hex').slice(0, 12)
}

const BUILD_STAMP = computeBuildStamp()

/**
 * THE READ SOURCES, AS THE OWNER NAMES THEM — generated from the registry, not typed.
 *
 * The page held its own list of four: Drive, Gmail, Calendar, GitHub. aroma_system, the
 * restaurant's own system and the one he reads most, was missing from the settings
 * switches AND from the sentence describing what each model can see. That is the third
 * time a hardcoded four has gone stale in this codebase, so the page is now handed the
 * real list at build time and cannot disagree with the read layer about what exists.
 */
function readSourceLabelsJson () {
  const { ALL_SOURCES } = require('../context/liveClients')
  const { LABELS } = require('../intake/readStateGuard')
  return JSON.stringify(ALL_SOURCES.map((s) => LABELS[s] || s))
}

/**
 * Inline the CSS/JS/artwork into their placeholder comments. `split/join` is used rather
 * than String.replace because a replacement string containing `$&`, `$1` etc. would
 * otherwise be interpreted as a substitution pattern and silently corrupt the asset.
 */
function buildDemoHtml () {
  const parts = {
    // ⛔ BEFORE the script in the document: app.js closes over CATALOGUE and createResolver.
    '/*INLINE_I18N*/': require('../i18n/browserResolver').browserI18nSource(),
    '/*INLINE_CSS*/': readAsset('app.css'),
    '/*INLINE_JS*/': readAsset('app.js'),
    // The same dot fills both the header mark and the avatar template, so one entry
    // replaces both occurrences.
    '/*INLINE_DOT*/': inlineSvg('dot.svg'),
    // The favicon is the padded SQUARE form, shared with the installed app icon so the
    // tab and the taskbar show the same thing. appManifest owns that geometry.
    '/*FAVICON_URI*/': iconDataUri(),
    '/*READ_SOURCE_LABELS*/': readSourceLabelsJson(),
    '/*BUILD_STAMP*/': BUILD_STAMP
  }
  let out = readAsset('index.html')
  for (const key of PLACEHOLDERS) out = out.split(key).join(parts[key])
  for (const key of PLACEHOLDERS) {
    if (out.includes(key)) throw new Error('demoHtml: an inline placeholder was not replaced: ' + key)
  }
  return out
}

const DEMO_HTML = buildDemoHtml()

module.exports = { DEMO_HTML, buildDemoHtml, ASSET_DIR, BUILD_STAMP, computeBuildStamp }
