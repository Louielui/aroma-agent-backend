'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { createRunStore } = require('./runStore')
const { createManager } = require('./manager')
const { createActivityStore } = require('./activityStore')
const { createConversationStore } = require('../../store/conversationStore')
test('run snapshots survive a new manager and unfinished work becomes interrupted without replay', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'briefing-recovery-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const store = createRunStore({ dir: path.join(dir, 'runs') }); const id = randomUUID()
  store.save({ id, requestId: randomUUID(), workflow: 'daily_briefing', state: 'running', sequence: 1, startedAt: '2026-09-29T10:00:00Z', steps: [{ state: 'running', count: null }], sections: [] })
  let reads = 0
  const manager = createManager({ runStore: createRunStore({ dir: path.join(dir, 'runs') }), activity: createActivityStore({ dir: path.join(dir, 'audit') }), gateway: { read: () => { reads++ } } })
  assert.equal(manager.get(id).state, 'interrupted'); assert.equal(reads, 0)
  assert.equal(store.get(id).state, 'interrupted')
  assert.equal(createActivityStore({ dir: path.join(dir, 'audit') }).list()[0].result, 'interrupted')
  const conversations = createConversationStore({ dir: path.join(dir, 'conversations') })
  conversations.appendTurn({ id: 'briefing-history', userText: 'briefing', replyText: 'accepted', operatingRunId: id })
  assert.equal(conversations.get('briefing-history').messages[1].operatingRunId, id)
  assert.throws(() => store.get('../escape'), /invalid_run_id/)
  fs.writeFileSync(path.join(dir, 'runs', id + '.json'), '{')
  assert.throws(() => createRunStore({ dir: path.join(dir, 'runs') }).all(), /run_store_unavailable/)
})
test('briefing commands exclude quoted examples, compound operations and negation', () => {
  const { isBriefingRequest } = require('./chatRequest')
  for (const message of ['今日營運簡報', '請整理今日營運簡報。', '香香，幫我整理今日營運簡報', 'Please show me today’s operations briefing'.replace('’', "'")]) assert.equal(isBriefingRequest(message), true, message)
  for (const message of ['不要整理今日營運簡報', '請解釋「今日營運簡報」', '今日營運簡報並寄給同事', '上星期營運簡報', '供應商要求：今日營運簡報']) assert.equal(isBriefingRequest(message), false, message)
})

test('all four workflows default to separate durable stores, preserving legacy briefing and explicit directories', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-adoption-')), previous = process.env.AROMA_DATA_DIR
  process.env.AROMA_DATA_DIR = dir
  t.after(() => { if (previous === undefined) delete process.env.AROMA_DATA_DIR; else process.env.AROMA_DATA_DIR = previous; assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(dir, { recursive: true, force: true }) })
  const workflows = { daily_briefing: 'manager-runs', development_proposal: 'development-plan-runs', code_diagnosis: 'code-diagnosis-runs', code_repair: 'code-repair-runs' }
  const rows = Object.keys(workflows).map(workflow => ({ id: randomUUID(), workflow, steps: [], sections: [], state: 'completed' }))
  for (const row of rows) createRunStore({ workflow: row.workflow }).save(row)
  for (const row of rows) {
    const reloaded = createRunStore({ workflow: row.workflow }); assert.deepEqual(reloaded.all(), [row]); assert.deepEqual(reloaded.get(row.id), row)
    assert.ok(fs.existsSync(path.join(dir, workflows[row.workflow], row.id + '.json')))
    for (const other of rows.filter(r => r !== row)) assert.equal(reloaded.get(other.id), null)
  }
  const explicitDir = path.join(dir, 'existing-explicit'), explicit = createRunStore({ dir: explicitDir, workflow: 'code_repair' }); explicit.save(rows[3])
  assert.deepEqual(createRunStore({ dir: explicitDir, workflow: 'code_repair' }).all(), [rows[3]])
  fs.writeFileSync(path.join(dir, workflows.code_repair, rows[3].id + '.json'), '{')
  assert.throws(() => createRunStore({ workflow: 'code_repair' }).all(), /run_store_unavailable/)
  assert.deepEqual(createRunStore().all(), [rows[0]], 'corruption of another workflow does not poison briefing history')
  assert.throws(() => createRunStore({ workflow: '__proto__' }), /invalid_workflow/)
})
