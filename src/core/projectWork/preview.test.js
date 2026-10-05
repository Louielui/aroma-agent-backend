'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm')
const { buildHtml } = require('./view')
function preview (run) {
  const make = tag => ({ tag, children: [], append (...nodes) { this.children.push(...nodes) } })
  const script = buildHtml().match(/<script>([\s\S]*?)<\/script>/)[1]
  const ctx = vm.createContext({ document: { createElement: make }, encodeURIComponent })
  vm.runInContext(script.match(/const L=(.*?), \$=id/)[0].replace(/, \$=id$/, ';') + script.match(/function text\(parent,value\)\{[^\n]*\}/)[0] + script.match(/function browser\(parent,r,expanded=false\)\{[^\n]*\}/)[0], ctx)
  const parent = make('section'); ctx.browser(parent, run); return parent
}
test('work previews are collapsed, use protected image routes and keep legacy reviews honest', () => {
  const parent = preview({ id: 'owner-run', result: { tests: { browser: [
    { name: 'browser-zh-390.png' }, { name: '../../credentials.png' }, { name: 'https://outside.invalid/x.png' }
  ] } } })
  assert.equal(parent.children.length, 1)
  const details = parent.children[0], grid = details.children.at(-1), link = grid.children[0]
  assert.equal(details.tag, 'details'); assert.equal(details.open, undefined)
  assert.match(details.children[1].textContent, /尚無模型畫面審閱/)
  assert.equal(grid.children.length, 1)
  assert.equal(link.href, '/api/v1/project-work/owner-run/browser/browser-zh-390.png')
  assert.equal(link.children[0].src, link.href); assert.equal(link.children[0].loading, 'lazy')
  assert.equal(link.rel, 'noopener')
})
test('visual findings are visible as text without running page markup; absent screenshots render nothing', () => {
  assert.equal(preview({ id: 'none' }).children.length, 0)
  const parent = preview({ id: 'candidate', review: { visual: { verdict: 'changes_requested', summary: '<img onerror=bad()> Header too crowded' } }, result: { tests: { browser: [{ name: 'browser-en-1280.png' }] } } })
  const d = parent.children[0]
  assert.match(d.children[1].textContent, /仍需調整/)
  assert.equal(d.children[2].textContent, '<img onerror=bad()> Header too crowded')
  assert.equal(d.children[2].children.length, 0)
})
