'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const assets = path.join(__dirname, 'assets')
function fixture () {
  const ids = {}, handlers = {}, make = tag => ({ tagName: tag, children: [], parentNode: null, attrs: {}, className: '', hidden: false, open: true, textContent: '',
    appendChild (n) { if (n.parentNode) n.parentNode.children = n.parentNode.children.filter(c => c !== n); this.children.push(n); n.parentNode = this; return n },
    setAttribute (k, v) { this.attrs[k] = String(v) }, addEventListener (k, f) { this.events ||= {}; this.events[k] = f }, focus () { this.focused = true } })
  for (const id of ['sidebar', 'expand', 'collapse', 'workspace-nav', 'side-workspace', 'convs', 'history-count', 'open-manager', 'open-live-context', 'open-development-plan', 'open-drive-context', 'open-aroma-context', 'open-calendar-context', 'open-gmail-context', 'open-memory', 'open-connections', 'open-company-access', 'open-workers', 'open-project-tasks', 'open-architecture']) { ids[id] = make('div'); ids[id].id = id }
  const buttons = Object.keys(ids).filter(n => n.startsWith('open-')); for (const id of buttons) { ids[id].listener = () => id; ids['workspace-nav'].appendChild(ids[id]) }
  ids.convs.messages = ['preserved']; ids['history-count'].textContent = '167'
  const doc = { getElementById: id => ids[id] || null, createElement: make, addEventListener: (k, f) => { handlers[k] = f } }
  const controller = require('./assets/sidebar').mount(doc, { daily: 'Daily', development: 'Development', management: 'Management' })
  return { ids, buttons, controller, handlers, doc }
}
test('grouping moves the same destinations exactly once and leaves conversation history intact', () => {
  const f = fixture(), all = Object.values(f.controller.groups).flatMap(g => g.children.filter(n => n.id))
  assert.deepEqual(all.map(n => n.id).sort(), f.buttons.sort()); assert.equal(new Set(all).size, f.buttons.length)
  assert.equal(f.ids['open-gmail-context'].parentNode, f.controller.groups.daily); assert.equal(f.ids['open-workers'].parentNode, f.controller.groups.development)
  for (const n of all) assert.equal(n.listener(), n.id)
  assert.deepEqual(f.ids.convs.messages, ['preserved']); assert.equal(f.ids['history-count'].textContent, '167')
})
test('group collapse and whole sidebar retain page state, toggles restore keyboard access', () => {
  const f = fixture(), group = f.controller.groups.daily; group.open = false; f.ids.collapse.events.click()
  assert.equal(f.ids.sidebar.className, 'collapsed'); assert.equal(f.ids.expand.attrs['aria-expanded'], 'false'); assert.equal(f.ids.expand.focused, true)
  assert.equal(f.ids.sidebar.inert, true); f.ids.expand.events.click(); assert.equal(f.ids.sidebar.className, ''); assert.equal(f.ids.collapse.focused, true)
  assert.equal(f.ids.sidebar.inert, false); assert.equal(f.controller.groups.daily.open, false)
  f.handlers.keydown({ key: 'Escape' }); assert.equal(f.ids.sidebar.className, 'collapsed')
})
test('repeat mounting preserves node identities and collapsed groups; dialogs retain Escape', () => {
  const f = fixture(); f.controller.groups.daily.open = false
  assert.equal(require('./assets/sidebar').mount(f.doc, { daily: 'Other' }), f.controller)
  assert.equal(f.controller.groups.daily.open, false); assert.equal(f.ids['workspace-nav'].children.length, 3)
  f.ids.sidebar.contains = () => false; f.handlers.keydown({ key: 'Escape' }); assert.equal(f.ids.sidebar.className, '')
  assert.equal(f.controller.groups.daily.children[0].textContent, 'Daily')
})
test('served page includes standalone sidebar assets in its fingerprint, supports both locales and mobile layout', () => {
  const { buildDemoHtml, computeBuildStamp } = require('./demoHtml'), { CATALOGUE } = require('../i18n/catalogue')
  const html = buildDemoHtml(); assert.match(html, /XiangxiangSidebar/); assert.match(html, /sidebar-group/)
  assert.notEqual(computeBuildStamp(), computeBuildStamp({ 'sidebar.js': 'changed' })); assert.notEqual(computeBuildStamp(), computeBuildStamp({ 'sidebar.css': 'changed' }))
  const css = fs.readFileSync(path.join(assets, 'sidebar.css'), 'utf8'); assert.match(css, /@media\s*\(max-width:\s*700px\)/); assert.match(css, /:focus-visible/)
  for (const key of ['sidebarGroup.daily', 'sidebarGroup.development', 'sidebarGroup.management']) { assert.ok(CATALOGUE[key].zh); assert.ok(CATALOGUE[key].en) }
  for (const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) if (m[1].trim()) new vm.Script(m[1])
})
