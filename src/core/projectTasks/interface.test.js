'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto')
const { request, definition, profileFor, filesFor, systemFor } = require('./contract')
const { PROFILES } = require('../taskPlanner/contract')
const { validatePackage, fileName } = require('../../workers/execution/windowsSandbox')
const UI = ['src/demo/assets/sidebar.js', 'src/demo/assets/sidebar.css']
const input = () => ({ requestId: randomUUID(), bootCommit: 'a'.repeat(40), goal: 'Remember collapsed navigation groups', criteria: ['Restored presentation keeps every destination'], editable: [UI[0]] })
const generated = { testCode: "const test=require('node:test'),assert=require('node:assert/strict');", expectedTests: 3 }
test('interface registration has a closed profile and immutable sibling asset', () => {
  const v = request(input()), d = definition(randomUUID(), v, generated)
  assert.equal(profileFor(v), 'interface'); assert.deepEqual(filesFor(v), UI)
  assert.deepEqual(d.workOrder.allowedFiles, [UI[0]]); assert.deepEqual(d.workOrder.readonlyFiles, [UI[1]])
  assert.deepEqual(PROFILES.interface, UI); assert.match(systemFor(v), /sidebar\.js/)
  for (const editable of [[UI[0], 'src/context/toolGateway.js'], [UI[0], 'src/demo/assets/app.js'], [UI[1], 'src/demo/assets/index.html'], ['.env'], ['src/demo/assets/new.js']]) assert.throws(() => request({ ...v, editable }), /invalid_request/)
})
test('Sandbox accepts only bounded UI asset suffixes, still rejects executable and traversal names', () => {
  const p = validatePackage({ files: { [UI[0]]: 'module.exports={}', [UI[1]]: '.nav{}', 'acceptance/ui.test.cjs': generated.testCode }, tests: ['acceptance/ui.test.cjs'], expectedTests: 3 })
  assert.equal(p.files[UI[1]], '.nav{}')
  for (const n of ['../sidebar.css', 'src/.env', 'run.ps1', 'credentials/sidebar.css', 'CON.css', 'src/ui.svg', 'src/ui.html']) assert.throws(() => fileName(n), /invalid_work_order/)
})
