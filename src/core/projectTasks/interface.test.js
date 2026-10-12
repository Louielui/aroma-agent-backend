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
  assert.equal(profileFor(v), 'interface'); assert.deepEqual(filesFor(v).slice(0, 2), UI)
  assert.deepEqual(d.workOrder.allowedFiles, [UI[0]]); assert.ok(d.workOrder.readonlyFiles.includes(UI[1]))
  assert.deepEqual(PROFILES.interface, UI); assert.match(systemFor(v), /sidebar\.js/)
  for (const editable of [[UI[0], 'src/context/toolGateway.js'], [UI[0], 'src/demo/assets/app.js'], [UI[1], 'src/demo/assets/index.html'], ['.env'], ['src/demo/assets/new.js']]) assert.throws(() => request({ ...v, editable }), /invalid_request/)
})
test('Sandbox accepts only bounded UI asset suffixes, still rejects executable and traversal names', () => {
  const p = validatePackage({ files: { [UI[0]]: 'module.exports={}', [UI[1]]: '.nav{}', 'acceptance/ui.test.cjs': generated.testCode }, tests: ['acceptance/ui.test.cjs'], expectedTests: 3 })
  assert.equal(p.files[UI[1]], '.nav{}')
  for (const n of ['../sidebar.css', 'src/.env', 'run.ps1', 'credentials/sidebar.css', 'CON.css', 'src/ui.svg', 'src/ui.html']) assert.throws(() => fileName(n), /invalid_work_order/)
})

test('sidebar tasks carry immutable real browser geometry checks and rendering dependencies', () => {
  const d = definition(randomUUID(), input(), generated)
  assert.equal(d.workOrder.expectedTests, 7)
  assert.match(d.tests['acceptance/chat-browser.test.cjs'], /sidebar: true/)
  assert.ok(d.workOrder.readonlyFiles.includes('src/demo/assets/app.js'))
  assert.ok(d.workOrder.readonlyFiles.includes('src/workers/execution/chatBrowser.cjs'))
})

test('previous registered sidebar tasks remain resolvable without silently adding browser authority', () => {
  const { createRegistry } = require('./contract'), { createMemoryRunStore } = require('../operating/runStore'), { digest } = require('../../workers/execution/windowsSandbox')
  const store = createMemoryRunStore(), id = randomUUID(), v = input()
  const registration = definition(id, v, generated, { legacyInterface: true }), snapshot = { hash: 'original' }, review = { verdict: 'pass', billing: 'claude-subscription' }
  const approvalHash = digest(JSON.stringify({ registration, snapshot, review }))
  store.save({ id, state: 'registered', input: v, generated, registration, snapshot, acceptanceReview: review, approvalHash, steps: [{ stage: 'registered', facts: { actor: 'owner', hash: approvalHash } }] })
  const old = createRegistry(store).resolve(registration.workOrder.recipe)
  assert.equal(old.workOrder.expectedTests, 3); assert.equal(old.workOrder.version, 1)
  assert.deepEqual(old.workOrder.readonlyFiles, [UI[1]])
  assert.equal(old.tests['acceptance/chat-browser.test.cjs'], undefined)
})
