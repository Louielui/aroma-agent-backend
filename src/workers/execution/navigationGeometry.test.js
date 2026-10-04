'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm')
const { navigationGeometry } = require('./chatBrowser.cjs')

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
