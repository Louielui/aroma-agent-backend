'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm')
const { navigationGeometry } = require('./chatBrowser.cjs')

test('real browser matrix visits requested breakpoint, height and theme combinations and refuses a failed case', async () => {
  const { verifyNavigationMatrix } = require('./chatBrowser.cjs')
  const seen = []; let state = {}
  const rpc = { call: async (method, value) => { if (method === 'Emulation.setDeviceMetricsOverride') state = { ...state, width: value.width, height: value.height }; else state.theme = value.features[0].value } }
  await verifyNavigationMatrix(rpc, async expression => { seen.push({ ...state }); return expression.includes('navigationGeometry') ? { ok: true } : true })
  for (const width of [320, 360, 375, 390, 700, 760, 1050, 1280, 1440]) for (const height of [480, 900]) for (const theme of ['light', 'dark']) assert.ok(seen.some(x => x.width === width && x.height === height && x.theme === theme), `${theme}:${width}x${height}`)
  await assert.rejects(verifyNavigationMatrix(rpc, async expression => expression.includes('navigationGeometry') ? (state.width === 700 && state.height === 480 && state.theme === 'dark' ? { ok: false, id: 'open-manager', reason: 'clipped' } : { ok: true }) : true), /browser_navigation_geometry_failed:dark:700x480:open-manager:clipped/)
})

function measure (change = {}) {
  const parent = { tagName: 'DIV', parentElement: null, style: { overflowX: 'hidden', overflowY: 'auto' }, getBoundingClientRect: () => ({ left: 0, top: 0, right: 300, bottom: 200 }) }
  const control = { textContent: 'Navigation', parentElement: parent, style: { display: 'block', visibility: 'visible' }, scrollIntoView () {}, getBoundingClientRect: () => ({ left: 10, top: 10, right: 100, bottom: 10 + (change.height || 44), width: 90, height: change.height || 44 }), closest: selector => selector === '.top-navigation' ? parent : selector === '.top-menu' && change.menu ? parent : null, contains: x => x === control }
  if (change.clipped) control.getBoundingClientRect = () => ({ left: 310, top: 10, right: 400, bottom: 54, width: 90, height: 44 })
  if (change.hidden) control.style.visibility = 'hidden'
  if (change.inert) control.closest = selector => selector === '[inert]' ? parent : null
  const summary = { ...control, getBoundingClientRect: () => ({ left: 10, top: 10, right: 100, bottom: 10 + change.summaryHeight, width: 90, height: change.summaryHeight }), contains: x => x === summary }
  const document = { getElementById: () => null, querySelectorAll: selector => selector === '.top-navigation summary' ? (change.summaryHeight ? [summary] : []) : change.duplicate ? [control, control] : [control], elementFromPoint: (x,y) => change.covered ? parent : change.summaryHeight && y === 10 + change.summaryHeight / 2 ? summary : control }
  return vm.runInNewContext('(' + navigationGeometry.toString() + ')(' + Boolean(change.detailed) + ')', { document, innerWidth: change.width || 390, innerHeight: 480, getComputedStyle: e => e.style })
}

test('rendered control dimensions reject undersized desktop controls and mobile menu rows', () => {
  assert.equal(measure({ width: 1050, height: 36 }), true)
  assert.equal(measure({ width: 1050, height: 35 }), false)
  assert.equal(measure({ width: 375, menu: true, height: 44 }), true)
  const small = measure({ width: 375, menu: true, height: 43, detailed: true })
  assert.equal(small.ok, false); assert.equal(small.reason, 'undersized_control')
  assert.equal(measure({ width: 1050, summaryHeight: 35 }), false)
  assert.equal(measure({ width: 1050, summaryHeight: 36 }), true)
})
test('navigation geometry rejects clipped, covered, hidden, duplicate and inert controls', () => {
  assert.equal(measure(), true)
  for (const fault of ['clipped', 'covered', 'hidden', 'duplicate', 'inert']) assert.equal(measure({ [fault]: true }), false, fault)
})

test('geometry diagnostics identify the failing control without copying page content', () => {
  const result = measure({ clipped: true, detailed: true })
  assert.equal(result.ok, false); assert.equal(result.id, 'open-home'); assert.equal(result.reason, 'clipped')
})
