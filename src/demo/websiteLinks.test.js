'use strict'
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm')
test('website markdown links become safe DOM anchors; executable schemes and embedded credentials stay text', () => {
  const source = fs.readFileSync(path.join(__dirname, 'assets/app.js'), 'utf8')
  const inline = source.slice(source.indexOf('  function inline ('), source.indexOf('  function renderMarkdown ('))
  const make = (tag, cls, text) => ({ tag, text, children: [], appendChild (n) { this.children.push(n) } })
  const ctx = { URL, el: make, document: { createTextNode: text => ({ text }) } }; vm.createContext(ctx); vm.runInContext(inline, ctx)
  const parent = make('p'); ctx.inline(parent, '[Open website](https://www.costcobusinesscentre.ca/)')
  const link = parent.children[0]; assert.equal(link.tag, 'a'); assert.equal(link.href, 'https://www.costcobusinesscentre.ca/'); assert.equal(link.rel, 'noopener noreferrer'); assert.equal(link.target, '_blank')
  for (const input of ['[bad](javascript:alert(1))', '[bad](https://user:secret@example.com/)']) { const p = make('p'); ctx.inline(p, input); assert.equal(p.children.some(n => n.tag === 'a'), false) }
})
