'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
test('memory sources are collapsed, text-only and rendered identically on live and saved turns', () => {
  const source = fs.readFileSync(path.join(__dirname, 'assets/app.js'), 'utf8')
  const start = source.indexOf('  function appendMemorySources ('), end = source.indexOf('  function appendAdviceBasis (', start)
  function el (tag, className = '', textContent = '') { return { tag, className, textContent, children: [], appendChild (child) { this.children.push(child) } } }
  const context = { el, t: (key, vars) => require('../i18n/catalogue').CATALOGUE[key].en.replace('{version}', vars?.version) }
  vm.createContext(context); vm.runInContext(source.slice(start, end), context)
  const host = el('div'), receipt = { kind: 'memory_references_v1', claimsVerified: false, items: [{ documentId: 'xx-06c3a189-a5c1-4287-8fad-46955d4019ab', date: null, version: 4, scope: 'private:owner' }] }
  context.appendMemorySources(host, receipt)
  const details = host.children[0]
  assert.equal(details.tag, 'details'); assert.equal(details.open, undefined)
  assert.equal(details.children[0].textContent, 'Memory references')
  assert.equal(details.children[2].children[0].textContent, receipt.items[0].documentId + ' · Date unknown · Version 4')
  assert.match(source, /appendMemorySources\(chatTurn.body, res.memorySources\)/)
  assert.match(source, /appendMemorySources\(tEl.body, m\[i\].memorySources\)/)
  const rejected = el('div')
  context.appendMemorySources(rejected, { ...receipt, items: [{ ...receipt.items[0], date: '<img onerror=alert(1)>' }] })
  assert.equal(rejected.children.length, 0)
})
