'use strict'

/**
 * appManifest.js — makes the 守燈 page installable as a desktop app.
 *
 * A web app manifest is the whole mechanism: with it, Chrome offers "Install", and the
 * installed window has no address bar, its own taskbar icon, and its own alt-tab entry.
 * There is no extension and no packaging step — the same page, one more same-origin file.
 *
 * NOTHING NEW IS FETCHED FROM ANYWHERE. The manifest is generated here from the SAME
 * lantern.svg the page already uses, so the app icon can never drift from the header mark,
 * and the icons are embedded as data: URIs rather than served as separate files.
 *
 * THE APP ICON IS NOT THE BARE LANTERN. A taskbar icon is a square tile, and the lantern
 * is tall and narrow (200x360) with transparent margins — dropped in raw it would render
 * as a thin sliver, and Android's maskable crop would cut its top and bottom off. So the
 * artwork is composed onto a full-bleed warm tile at ~62% height, which keeps it inside
 * the maskable safe zone and looks like a deliberate app icon at 32px on a taskbar.
 * Same reasoning as the chat avatar's disc: hardcoded colours, no theme token, so the
 * object never inverts.
 */

const fs = require('node:fs')
const path = require('node:path')

const ASSET_DIR = path.join(__dirname, 'assets')

const TILE = '#FDF4E6' // the warm disc used behind the chat avatar — hardcoded, never a token
const THEME = '#faf7f2' // the page's own paper, so the app window's title bar matches it

/** Inner drawing of an SVG file, without its root element. */
function innerSvg (name) {
  const s = fs.readFileSync(path.join(ASSET_DIR, name), 'utf8')
  const open = s.indexOf('>', s.indexOf('<svg'))
  const close = s.lastIndexOf('</svg>')
  if (open === -1 || close === -1) throw new Error('appManifest: cannot read artwork ' + name)
  return s.slice(open + 1, close).trim()
}

/**
 * The square app tile. 512x512, full-bleed background (so a maskable crop always has
 * something to cut into), lantern centred at 62% height.
 */
function buildAppIconSvg () {
  const art = innerSvg('lantern.svg')
  const h = 512 * 0.62 // 317.4 — inside the 80% maskable safe zone with room to spare
  const scale = h / 360
  const w = 200 * scale
  const x = (512 - w) / 2
  const y = (512 - h) / 2
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">' +
    `<rect width="512" height="512" fill="${TILE}"/>` +
    `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${scale.toFixed(4)})">${art}</g>` +
    '</svg>'
}

function dataUri (svg) {
  return 'data:image/svg+xml,' + encodeURIComponent(svg)
}

function buildManifest () {
  const icon = dataUri(buildAppIconSvg())
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
      // One vector source covers every size Chrome asks for; 'any' is what desktop
      // install and the taskbar use, 'maskable' is what Android crops.
      { src: icon, sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: icon, sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }
    ]
  }
}

const MANIFEST = buildManifest()
const MANIFEST_JSON = JSON.stringify(MANIFEST)

module.exports = { MANIFEST, MANIFEST_JSON, buildManifest, buildAppIconSvg, THEME, TILE }
