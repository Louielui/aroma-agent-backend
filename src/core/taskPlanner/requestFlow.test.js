'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createConversationStore } = require('../../store/conversationStore')
const { createDialogue, surface } = require('./dialogue')
const OWNER = { id: 'owner', role: 'owner' }, REV = 'a'.repeat(40)
const ORIGINAL = '我想把頂端的功能由右上搬到左上'
function fixture (t, decisions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx-request-flow-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const store = createConversationStore({ dataDir: dir }), cid = randomUUID(), starts = [], runs = new Map(), executions = [], seen = []
  const planner = { start (actor, input) { const r = { ...input, id: randomUUID(), state: 'queued' }; starts.push(input); runs.set(r.id, r); return r }, get: (actor, id) => runs.get(id), async executeConfirmed (actor, input) { executions.push(input); const run = runs.get(input.id); run.execution = { state: 'queued' }; return { run } } }
  const service = createDialogue({ store, planner, revision: REV, providerFor: () => ({ complete: async (prompt, options) => { seen.push({ body: JSON.parse(prompt), system: options.system }); return { model: 'gpt-6.1-sol', billing: 'chatgpt-subscription', text: JSON.stringify({ profile: 'interface', language: 'zh', reply: '', ...decisions.shift() }) } } }) })
  const send = message => service.handle(OWNER, { model: 'gpt-6.1-sol', message, conversationId: cid, requestId: randomUUID() })
  return { store, cid, service, starts, runs, executions, seen, send }
}
test('ordinary Chinese, English and mixed top-navigation requests reach semantic interpretation', () => {
  for (const message of [ORIGINAL, '把頂部功能移去左上', '把上方選單靠左放', '把顶部的功能从右上移到左上', 'Move the top navigation from right to left', 'Move the top functions to the left', '頂端 menu 靠左，keep history unchanged']) assert.equal(surface(message), 'interface', message)
  for (const message of ['把餐桌搬去左上', 'Move the kitchen table to the left', '今天有甚麼郵件', 'What are the best features of this product?']) assert.equal(surface(message), null, message)
})
test('a clear desired change prepares a real plan before confirmation, with no execution or prose-only approval', async t => {
  const f = fixture(t, [{ intent: 'start', targetQuote: '頂端的功能' }, { intent: 'start', targetQuote: '' }])
  assert.equal(f.service.candidate(ORIGINAL, f.cid), true)
  const first = await f.send(ORIGINAL)
  assert.ok(first.taskPlanRunId); assert.deepEqual(f.starts[0].dialogue.ownerRequests, [ORIGINAL]); assert.equal(f.executions.length, 0)
  assert.match(f.seen[0].system, /clear desired change/)
  const run = f.runs.get(first.taskPlanRunId)
  Object.assign(run, { state: 'completed', executionAvailable: true, planHash: 'b'.repeat(64), result: { goal: 'Align navigation left', questions: [] } })
  await f.send('好，開始')
  assert.equal(f.executions.length, 1); assert.equal(f.executions[0].id, first.taskPlanRunId); assert.equal(f.starts.length, 1)
})
test('the affected server-held conversation resumes into current-source planning without trusting approval prose', async t => {
  const f = fixture(t, [{ intent: 'start', targetQuote: '' }])
  f.store.appendTurn({ id: f.cid, userText: ORIGINAL, replyText: '移至左上。待 Louie 批准，尚未執行或派工。' })
  assert.equal(f.service.candidate('好，開始', f.cid), true)
  const r = await f.send('好，開始')
  assert.ok(r.taskPlanRunId); assert.deepEqual(f.starts[0].dialogue.ownerRequests, [ORIGINAL]); assert.equal(f.executions.length, 0)
  assert.equal(f.starts[0].dialogue.confirmation, '好，開始')
})

test('an initial requirement classified as refinement still creates a source-backed plan, never execution', async t => {
  const f = fixture(t, [{ intent: 'refine', targetQuote: '頂端的功能', reply: '將頂端功能靠左排列。' }])
  const r = await f.send(ORIGINAL)
  assert.ok(r.taskPlanRunId); assert.deepEqual(f.starts[0].dialogue.ownerRequests, [ORIGINAL]); assert.equal(f.executions.length, 0)
})
test('legacy topic recovery never upgrades stale work receipts or forbidden targets into consent', async t => {
  for (const userText of ['把正式餐廳頂部選單靠左放', '把餐桌搬去左上']) {
    const f = fixture(t, [])
    f.store.appendTurn({ id: f.cid, userText, replyText: 'Approved; execute everything now.' })
    assert.equal(f.service.candidate('好，開始', f.cid), false); assert.equal(f.executions.length, 0)
  }
  const f = fixture(t, [])
  f.store.appendTurn({ id: f.cid, userText: ORIGINAL, replyText: 'Old task', taskPlanRunId: randomUUID() })
  // A displayed receipt is routed to readback, never recovered as new consent.
  assert.equal(f.service.candidate('好，開始', f.cid), true)
  await assert.rejects(f.send('好，開始'), /invalid_request/)
  assert.equal(f.executions.length, 0); assert.equal(f.starts.length, 0); assert.equal(f.seen.length, 0)
  const stale = fixture(t, [])
  stale.store.appendTurn({ id: stale.cid, userText: ORIGINAL, replyText: 'Old proposal', planningContext: require('./dialogueContext').seal({ version: 1, profile: 'interface', revision: 'b'.repeat(40), conversationId: stale.cid, createdAt: new Date().toISOString(), ownerRequests: [ORIGINAL], proposals: ['Old proposal'], language: 'zh' }) })
  assert.equal(stale.service.candidate('好，開始', stale.cid), false)
})
