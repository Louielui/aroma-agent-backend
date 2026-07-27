'use strict'

/**
 * appManifest.js — makes the 守燈 page installable as a desktop app, and owns the one
 * square icon used by both the manifest and the favicon.
 *
 * A web app manifest is the whole mechanism: with it, Chrome offers "Install", and the
 * installed window has no address bar, its own taskbar icon, and its own alt-tab entry.
 * There is no extension and no packaging step — the same page, one more same-origin file.
 *
 * NOTHING NEW IS FETCHED FROM ANYWHERE. The icon is generated here from the SAME dot.svg
 * the page already uses for the avatar and the header mark, so the app icon can never
 * drift from the mark, and it is embedded as a data: URI rather than served as a file.
 *
 * THE SQUARE ICON IS PADDED, THE AVATAR IS NOT. In the chat the dot IS the avatar and
 * fills its box. A taskbar or tab icon is a square canvas, and a circle drawn edge to edge
 * on it looks like a mistake — so here the dot is centred at 62.5% of the canvas width,
 * leaving 18.75% clear on every side. At 32px that is a 20px dot with 6px of padding,
 * which is the size this was checked at. It also sits well inside the 80% maskable safe
 * zone, so an Android crop cannot clip it.
 */

const fs = require('node:fs')
const path = require('node:path')

const ASSET_DIR = path.join(__dirname, 'assets')

const THEME = '#faf7f2' // the page's own paper, so the app window's title bar matches it
const ICON_CANVAS = 512
const DOT_FRACTION = 0.625 // dot diameter as a share of the square canvas — see above

/** Read the mark's fill from dot.svg so the colour has exactly ONE source. */
function readDotColour () {
  const s = fs.readFileSync(path.join(ASSET_DIR, 'dot.svg'), 'utf8')
  const m = s.match(/fill="(#[0-9A-Fa-f]{6})"/)
  if (!m) throw new Error('appManifest: dot.svg has no literal fill colour')
  return m[1]
}

/** The square app/favicon icon: one centred dot on a transparent canvas. */
function buildAppIconSvg () {
  const c = ICON_CANVAS / 2
  const r = (ICON_CANVAS * DOT_FRACTION) / 2
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">' +
    `<circle cx="${c}" cy="${c}" r="${r}" fill="${readDotColour()}"/>` +
    '</svg>'
}

/** Inline artwork as a data: URI. A data: URI is parsed as standalone XML, so the xmlns
 *  the in-page copies drop is REQUIRED here and is present in the string above. */
function iconDataUri () {
  return 'data:image/svg+xml,' + encodeURIComponent(buildAppIconSvg())
}

function buildManifest () {
  const icon = iconDataUri()
  return {
    name: '守燈',
    short_name: '守燈',
    description: 'Aroma 的 AI 營運長',
    // The page lives at /demo; '/' is a 404, so it cannot be the entry point.
    start_url: '/demo',
    scope: '/',
    display: 'standalone', // no address bar — it stops looking like a browser tab
    orientation: 'any',
    lang: 'zh-Hant',
    dir: 'ltr',
    theme_color: THEME,
    background_color: THEME,
    icons: [
      // One vector source covers every size Chrome asks for; 'any' is what desktop install
      // and the taskbar use, 'maskable' is what Android crops — and the dot is inside the
      // safe zone, so the crop takes only empty canvas.
      { src: icon, sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: icon, sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }
    ]
  }
}

const MANIFEST = buildManifest()
const MANIFEST_JSON = JSON.stringify(MANIFEST)

module.exports = {
  MANIFEST, MANIFEST_JSON, buildManifest, buildAppIconSvg, iconDataUri, readDotColour,
  THEME, ICON_CANVAS, DOT_FRACTION
}
