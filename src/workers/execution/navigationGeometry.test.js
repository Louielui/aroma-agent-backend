'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm')
const { navigationGeometry } = require('./chatBrowser.cjs')

test('real browser matrix visits requested breakpoint, height and theme combinations and refuses a failed case', async () => {
  const { verifyNavigationMatrix } = require('./chatBrowser.cjs')
  const seen = []; let state = {}
  const rpc = { call: async (method, value) => { if (method === 'Emulation.setDeviceMetricsOverride') state = { ...state, width: value.width, height: value.height }; else state.theme = value.features[0].value } }
  await verifyNavigationMatrix(rpc, async () => { seen.push({ ...state }); return true })
  for (const width of [360, 390, 700, 760, 1280]) for (const height of [480, 900]) for (const theme of ['light', 'dark']) assert.ok(seen.some(x => x.width === width && x.height === height && x.theme === theme))
  await assert.rejects(verifyNavigationMatrix(rpc, async () => !(state.width === 700 && state.height === 480 && state.theme === 'dark')), /browser_navigation_geometry_failed/)
})

function measure (change = {}) {
  const parent = { tagName: 'DIV', parentElement: null, style: { overflowX: 'hidden', overflowY: 'auto' }, getBoundingClientRect: () => ({ left: 0, top: 0, right: 300, bottom: 200 }) }
  const control = { textContent: 'Navigation', parentElement: parent, style: { display: 'block', visibility: 'visible' }, scrollIntoView () {}, getBoundingClientRect: () => ({ left: 10, top: 10, right: 100, bottom: 40, width: 90, height: 30 }), closest: () => null, contains: x => x === control }
  if (change.clipped) control.getBoundingClientRect = () => ({ left: 310, top: 10, right: 400, bottom: 40, width: 90, height: 30 })
  if (change.hidden) control.style.visibility = 'hidden'
  if (change.inert) control.closest = () => parent
  const document = { getElementById: () => null, querySelectorAll: () => change.duplicate ? [control, control] : [control], elementFromPoint: () => change.covered ? parent : control }
  return vm.runInNewContext('(' + navigationGeometry.toString() + ')()', { document, innerWidth: 390, innerHeight: 480, getComputedStyle: e => e.style })
}
test('navigation geometry rejects clipped, covered, hidden, duplicate and inert controls', () => {
  assert.equal(measure(), true)
  for (const fault of ['clipped', 'covered', 'hidden', 'duplicate', 'inert']) assert.equal(measure({ [fault]: true }), false, fault)
})
