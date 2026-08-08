'use strict'

/**
 * settingsHtml.js — assembles the settings page from real asset files, the same way
 * demoHtml.js assembles the chat page: three ordinary files under assets/, no escaping
 * rules, inlined here into ONE self-contained same-origin document.
 *
 * No external URL, CDN, font or image is introduced. The assets are read once at require()
 * time; an empty or missing one is a startup error, not a half-rendered page.
 */

const fs = require('node:fs')
const path = require('node:path')

const { iconDataUri } = require('./appManifest') // the same mark the chat page uses

const ASSET_DIR = path.join(__dirname, 'assets')

function readAsset (name) {
  const p = path.join(ASSET_DIR, name)
  const text = fs.readFileSync(p, 'utf8')
  if (!text || text.trim() === '') throw new Error(`settingsHtml: asset ${name} is empty`)
  return text
}

/**
 * Ordered replacement using a REPLACER FUNCTION, so a `$&` or `$1` occurring inside the
 * CSS or JS is inserted literally instead of being read as a replacement pattern.
 */
function inject (html, token, value) {
  if (!html.includes(token)) throw new Error(`settingsHtml: template is missing ${token}`)
  return html.replace(token, () => value)
}

let SETTINGS_HTML = readAsset('settings.html')
SETTINGS_HTML = inject(SETTINGS_HTML, '__ICON__', iconDataUri())
SETTINGS_HTML = inject(SETTINGS_HTML, '__CSS__', readAsset('settings.css'))
/**
 * ⛔ THE SAME RESOLVER AND THE SAME CATALOGUE AS THE CHAT PAGE — one function, two documents.
 * Writing a second t() here would be the second implementation browserResolver.js exists to
 * prevent, and this page would be where the two quietly disagreed.
 * It precedes the app script so settings.js closes over createResolver and CATALOGUE.
 */
SETTINGS_HTML = inject(SETTINGS_HTML, '__I18N__', require('../i18n/browserResolver').browserI18nSource())
SETTINGS_HTML = inject(SETTINGS_HTML, '__JS__', readAsset('settings.js'))

module.exports = { SETTINGS_HTML }
