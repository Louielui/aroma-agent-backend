'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
function fixture () {
  const code = fs.readFileSync(path.join(__dirname, '../../demo/assets/app.js'), 'utf8')
  const start = code.indexOf('  function createWorkActivity ('), end = code.indexOf('  function renderTaskPlan (')
  assert.ok(start >= 0, 'Shared truthful activity view exists')
  let now = Date.parse('2026-10-04T20:00:10Z'), tick, stopped = 0
  function el (tag, cls, text) { return { tag, className: cls || '', textContent: text || '', children: [], isConnected: true, appendChild (c) { this.children.push(c); return c }, setAttribute (k, v) { this[k] = v } } }
  const root = el('div'), sandbox = { root, el, clear: n => { n.children = [] }, t: (k, p) => k + (p ? ' ' + JSON.stringify(p) : ''), Date: class extends Date { static now () { return now } }, setInterval: f => { tick = f; return 1 }, clearInterval: () => { stopped++ } }
  vm.runInNewContext(code.slice(start, end) + ';var view = createWorkActivity(root)', sandbox)
  const flat = n => [n, ...n.children.flatMap(flat)]
  return { root, view: sandbox.view, nodes: () => flat(root), advance: ms => { now += ms; if (tick) tick() }, stopped: () => stopped }
}
test('activity animates confirmed work only and keeps its drawer open across reads', () => {
  const f = fixture(), run = { state: 'running', startedAt: '2026-10-04T20:00:00Z', steps: [{ stage: 'source_received', at: '2026-10-04T20:00:02Z' }] }
  f.view.update(run, 'plan'); assert.ok(f.nodes().some(n => n.className.includes('is-working')))
  const drawer = f.nodes().find(n => n.tag === 'details'); drawer.open = true
  f.view.update({ ...run, state: 'awaiting_approval' }, 'plan'); assert.equal(drawer.open, true); assert.equal(f.nodes().some(n => n.className.includes('is-working')), false)
  assert.ok(f.nodes().some(n => n.textContent.includes('workActivity.approval')))
  f.view.update({ ...run, state: 'made_up' }, 'plan'); assert.equal(f.nodes().some(n => n.className.includes('is-working')), false)
})
test('stale and failed reads stop the working claim; fresh reads restore it without invented progress', () => {
  const f = fixture(), run = { state: 'coding', startedAt: '2026-10-04T20:00:00Z', steps: [] }
  f.view.update(run, 'work'); f.advance(16000)
  assert.equal(f.nodes().some(n => n.className.includes('is-working')), false); assert.ok(f.nodes().some(n => n.textContent.includes('workActivity.unconfirmed')))
  f.view.update(run, 'work'); assert.ok(f.nodes().some(n => n.className.includes('is-working')))
  f.view.unavailable(); assert.equal(f.nodes().some(n => n.className.includes('is-working')), false)
  f.view.update({ ...run, state: 'failed', finishedAt: '2026-10-04T20:00:08Z' }, 'work'); f.advance(10000)
  assert.ok(f.nodes().some(n => n.textContent.includes('"seconds":8'))); assert.ok(f.stopped() > 0)
})
test('drawer shows real events and returned code as text, never inventing a live code stream', () => {
  const f = fixture(); f.view.update({ state: 'coding', steps: [{ stage: 'coding', at: '2026-10-04T20:00:02Z' }] }, 'work')
  assert.ok(f.nodes().some(n => n.textContent.includes('workActivity.codePending')))
  f.view.update({ state: 'completed', steps: [], result: { changes: [{ file: 'view.js', before: 'old', after: '<script>actual code</script>' }] } }, 'work')
  assert.ok(f.nodes().some(n => n.tag === 'pre' && n.textContent === '<script>actual code</script>'))
  assert.equal(f.nodes().some(n => n.tag === 'script'), false)
  assert.equal(f.nodes().some(n => n.textContent.includes('workActivity.codePending')), false)
})
test('removed cards release their activity clock', () => {
  const f = fixture(); f.view.update({ state: 'running', steps: [] }, 'plan'); f.root.isConnected = false; f.advance(1000); assert.ok(f.stopped() > 0)
})

test('visible current action follows real worker events even while the outer state stays coding', () => {
  const f = fixture(), run = { state: 'coding', steps: [{ stage: 'coding', at: '2026-10-04T20:00:01Z' }, { stage: 'tests_started', at: '2026-10-04T20:00:03Z' }] }
  f.view.update(run, 'work')
  assert.equal(f.nodes().find(n => n.className === 'work-activity-state').textContent, 'workActivity.testing')
  const trail = f.nodes().find(n => n.className === 'work-activity-trail')
  assert.ok(trail); assert.equal(trail.children.length, 2)
  f.view.update({ ...run, state: 'failed' }, 'work')
  assert.equal(f.nodes().find(n => n.className === 'work-activity-state').textContent, 'workActivity.failed')
})

test('merged events are chronological and unknown events cannot masquerade as progress', () => {
  const f = fixture(); f.view.update({ state: 'coding', steps: [{ stage: 'tests_started', at: '2026-10-04T20:00:03Z' }, { stage: 'coding', at: '2026-10-04T20:00:01Z' }, { stage: 'invented_tool', at: '2026-10-04T20:00:04Z' }] }, 'work')
  const trail = f.nodes().find(n => n.className === 'work-activity-trail')
  assert.ok(trail); assert.ok(trail.children[0].textContent.includes('workActivity.coding'))
  assert.equal(trail.children.length, 2)
  f.advance(16000); assert.equal(f.nodes().find(n => n.className === 'work-activity-state').textContent, 'workActivity.unconfirmed')
})
test('independent job cards never share working state and keep unchanged evidence expanded', () => {
  const a = fixture(), b = fixture(), run = { state: 'coding', steps: [] }
  a.view.update(run, 'work'); b.view.update({ state: 'failed', steps: [] }, 'work')
  assert.ok(a.nodes().some(n => n.className.includes('is-working'))); assert.equal(b.nodes().some(n => n.className.includes('is-working')), false)
  const technical = a.nodes().filter(n => n.tag === 'details').at(-1); technical.open = true
  a.view.update(run, 'work'); assert.ok(a.nodes().includes(technical)); assert.equal(technical.open, true)
  b.view.unavailable(); assert.ok(a.nodes().some(n => n.className.includes('is-working')))
})
