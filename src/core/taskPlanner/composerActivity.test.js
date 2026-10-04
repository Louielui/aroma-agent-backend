'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path')
function fixture () {
  const code = fs.readFileSync(path.join(__dirname, '../../demo/assets/app.js'), 'utf8')
  const start = code.indexOf('  function createComposerActivity ('), end = code.indexOf('  function createWorkActivity (')
  assert.ok(start >= 0, 'A persistent composer activity indicator exists')
  let poll, current = null
  const node = () => ({ children: [], hidden: false, className: '', textContent: '', setAttribute () {}, appendChild (n) { this.children.push(n) }, insertBefore (n) { this.children.unshift(n) }, addEventListener (e, fn) { this[e] = fn } })
  const composer = node(), sandbox = { el: node, t: k => k, setInterval: fn => { poll = fn }, composer, thread: () => current }
  vm.runInNewContext(code.slice(start, end) + ';createComposerActivity(composer, thread)', sandbox)
  const cards = (state, working) => {
    const drawer = { open: false }, heading = { textContent: state }
    return { drawer, querySelector: s => s.includes('drawer') ? drawer : heading, classList: { contains: () => working }, scrollIntoView () { this.scrolled = true } }
  }
  return { bar: composer.children[0], poll: () => poll(), cards, show: (items, typing = false) => { current = { querySelectorAll: () => items, querySelector: () => typing ? {} : null }; poll() }, clear: () => { current = null; poll() } }
}
test('composer shows current work without opening a log and can reveal its actual drawer', () => {
  const f = fixture(), job = f.cards('Checking tests', true)
  f.show([job]); assert.equal(f.bar.hidden, false); assert.match(f.bar.className, /is-working/)
  assert.equal(f.bar.children[0].textContent, 'workActivity.working')
  assert.equal(f.bar.children[1].textContent, 'Checking tests')
  f.bar.children[2].click(); assert.equal(job.drawer.open, true); assert.equal(job.scrolled, true)
})
test('terminal or unavailable work never keeps animating; switching conversations clears old status', () => {
  const f = fixture()
  f.show([f.cards('Stopped: timeout', false)]); assert.doesNotMatch(f.bar.className, /is-working/)
  assert.equal(f.bar.children[0].textContent, 'Stopped: timeout')
  f.clear(); assert.equal(f.bar.hidden, true)
  f.show([]); assert.equal(f.bar.hidden, true)
})
test('new reply takes precedence over old completed work and pending input has no invented code link', () => {
  const f = fixture(); f.show([f.cards('Complete', false)], true)
  assert.match(f.bar.className, /is-working/); assert.equal(f.bar.children[0].textContent, 'workActivity.thinking')
  assert.equal(f.bar.children[2].hidden, true)
})
