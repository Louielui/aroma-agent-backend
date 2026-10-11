'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
function render (text) {
  function node (tag, text = '') {
    const n = {tagName:tag.toUpperCase(), textContent:text, childNodes:[], attributes:{}, appendChild (child) { this.childNodes.push(child) }, append (...children) { this.childNodes.push(...children) }, addEventListener () {}, setAttribute (key,value) { this.attributes[key]=String(value) }}
    return n
  }
  const source = fs.readFileSync(path.join(__dirname,'assets/app.js'),'utf8')
  const code = source.slice(source.indexOf('  function el ('),source.indexOf('  /* ── conversations'))
  const ctx = {URL, t:key=>require('../i18n/catalogue').CATALOGUE[key].en, document:{createElement:tag=>node(tag),createTextNode:text=>node('#text',text)}}
  vm.createContext(ctx); vm.runInContext(code,ctx)
  return ctx.renderMarkdown(text)
}
const flat = n => [n,...n.childNodes.flatMap(flat)]
const plain = n => n.textContent + n.childNodes.map(plain).join('')
test('a 25-row clock-out reply becomes a semantic table without losing the last row or source note', () => {
  const rows = Array.from({length:25},(_,i)=>`| Employee ${i+1} / ${i+100} | 2026-10-09 20:${String(i).padStart(2,'0')}:00 UTC-05:00 | ${900+i} |`)
  const root = render('Complete: 25 records\n\n| Employee / ID | Clock-out | Punch ID |\n|---|---|---|\n'+rows.join('\n')+'\n\nSource: fixed read-only GET')
  const tables = flat(root).filter(n=>n.tagName==='TABLE'); assert.equal(tables.length,1)
  const header=flat(tables[0]).filter(n=>n.tagName==='TH'), cells=flat(tables[0]).filter(n=>n.tagName==='TD')
  assert.equal(header.length,3); assert.ok(header.every(n=>n.scope==='col')); assert.equal(cells.length,75)
  assert.equal(plain(cells[72]),'Employee 25 / 124'); assert.equal(plain(cells[74]),'924')
  assert.match(plain(root),/Complete: 25 records/); assert.match(plain(root),/Source: fixed read-only GET/)
})
test('table cells retain safe inline formatting while HTML and executable links remain text', () => {
  const root=render('| Name | Evidence |\n|---|---|\n| <img src=x onerror=alert(1)> | [bad](javascript:alert(1)) |\n| **Confirmed** | `clocked_out` |\n| <script>danger</script> | [bad](https://user:secret@example.com/) |')
  const nodes=flat(root); assert.equal(nodes.filter(n=>n.tagName==='TABLE').length,1)
  assert.equal(nodes.some(n=>['SCRIPT','IMG','A'].includes(n.tagName)),false)
  assert.ok(nodes.some(n=>n.tagName==='STRONG'&&plain(n)==='Confirmed'))
  assert.ok(nodes.some(n=>n.tagName==='CODE'&&plain(n)==='clocked_out'))
  assert.match(plain(root),/<img src=x onerror=alert\(1\)>/); assert.match(plain(root),/<script>danger<\/script>/)
})
test('escaped pipes stay inside their cells; malformed rows are visible rather than silently dropped', () => {
  const root=render('| Name | Note |\n|:---|---:|\n| A\\|B | matched |\n| extra | column | visible |\nFollowing paragraph')
  const cells=flat(root).filter(n=>n.tagName==='TD'); assert.equal(cells.length,2); assert.equal(plain(cells[0]),'A|B')
  assert.match(plain(root),/\| extra \| column \| visible \|/); assert.match(plain(root),/Following paragraph/)
})
test('a missing or mismatched separator leaves the entire input literal', () => {
  for (const text of ['| Name | Time |\n| no separator | 20:00 |','| Name | Time |\n|---|\n| Alice | 20:00 |','| Name | Time\\|\n|---|---|\n| Alice | 20:00 |']) {
    const root=render(text); assert.equal(flat(root).some(n=>n.tagName==='TABLE'),false); assert.equal(plain(root),text)
  }
})
test('tables in fenced code remain code and adjacent headings/lists retain their structure', () => {
  const root=render('## Report\n\n1. First\n\n2. Second\n\n```text\n| Name | Time |\n|---|---|\n| Alice | 20:00 |\n```\n\n| Name | Time |\n|---|---|\n| Alice | 20:00 |')
  const nodes=flat(root); assert.equal(nodes.filter(n=>n.tagName==='TABLE').length,1); assert.equal(nodes.filter(n=>n.tagName==='OL').length,1)
  assert.equal(nodes.filter(n=>n.tagName==='LI').length,2); assert.equal(nodes.filter(n=>n.tagName==='H2').length,1)
  const pre=nodes.find(n=>n.tagName==='PRE'); assert.match(plain(pre),/\| Alice \| 20:00 \|/)
})
