'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const ui = ['src/demo/assets/sidebar.js', 'src/demo/assets/sidebar.css']
test('design guidance is selected by host profile and never expands editable authority', () => {
  const { guidance, forFiles, systemFor } = require('./uiDesign')
  const g = guidance('interface')
  assert.equal(g.id, 'xiangxiang-ui-design'); assert.match(g.hash, /^[a-f0-9]{64}$/)
  assert.ok(g.instructions.includes('chat-first')); assert.ok(g.instructions.includes('--ui-header-height'))
  assert.deepEqual(forFiles(ui).receipt, g.receipt)
  assert.equal(forFiles(['duration.js']), null)
  assert.equal(forFiles([...ui, '.env']), null)
  assert.equal(systemFor('bounded instruction', 'context'), 'bounded instruction')
  assert.ok(systemFor('bounded instruction', 'chat').startsWith('bounded instruction'))
  assert.ok(systemFor('bounded instruction', 'interface').includes(g.instructions))
})
test('UI acceptance drafting receives the same design system without changing source scope', () => {
  const { systemFor, filesFor } = require('../core/projectTasks/contract')
  assert.ok(systemFor({ editable: ui }).includes('chat-first'))
  assert.deepEqual(filesFor({ editable: ui }).slice(0, 2), ui)
  assert.ok(!filesFor({ editable: ui }).some(f => f.endsWith('SKILL.md')))
})
