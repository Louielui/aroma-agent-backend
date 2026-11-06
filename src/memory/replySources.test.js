'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const sources = require('./replySources')
const id = 'xx-06c3a189-a5c1-4287-8fad-46955d4019ab'
const other = 'xx-cd157abe-4079-49ab-8895-b562db8252d4'
const row = { documentId: id, source: 'memory_gateway', status: 'active', scope: 'private:owner', date: '2026-09-29T18:41:53.564Z', version: 4, text: 'Remembered value.' }

test('only a loaded canonical source marker moves into the disclosure; substantive text is unchanged', () => {
  const reply = `The code is Amber. [memory:${id}]\nUnconfirmed: the current status.`
  const out = sources.present(reply, [row])
  assert.equal(out.reply, 'The code is Amber. \nUnconfirmed: the current status.')
  assert.deepEqual(out.memorySources.items, [{ documentId: id, date: row.date, version: 4, scope: 'private:owner' }])
  assert.equal(out.memorySources.claimsVerified, false)
  assert.equal(sources.present('The code is Amber.', [row]).memorySources, null)
})
test('unloaded, inactive, wrong-scope, duplicate conflicting and marker-only responses stay visible', () => {
  for (const rows of [[], [{ ...row, status: 'archived' }], [{ ...row, scope: 'other' }], [row, { ...row, version: 5 }]]) {
    const reply = `Answer [memory:${id}]`
    assert.equal(sources.present(reply, rows).reply, reply)
    assert.equal(sources.present(reply, rows).memorySources, null)
  }
  assert.equal(sources.present(`[memory:${id}]`, [row]).reply, `[memory:${id}]`)
  assert.equal(sources.present(`Answer [memory:${other}]`, [row]).memorySources, null)
  assert.equal(sources.present(`Answer (${id}, ${row.date})`, [row]).reply, `Answer (${id}, ${row.date})`)
})
test('source dates and versions remain unknown when absent; no recalled body or model URL is persisted', () => {
  const out = sources.present(`Answer [memory:${id}]`, [{ ...row, date: null, version: undefined, url: 'javascript:alert(1)' }])
  assert.deepEqual(out.memorySources.items[0], { documentId: id, date: null, version: null, scope: 'private:owner' })
  assert.equal(sources.validReceipt(out.memorySources), true)
  assert.equal(sources.validReceipt({ ...out.memorySources, claimsVerified: true }), false)
  assert.equal(sources.validReceipt({ ...out.memorySources, items: [{ ...out.memorySources.items[0], text: 'injected' }] }), false)
})
test('conversation reload retains references independently of concise prose; gateway receives pointers, not stored facts', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-sources-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const { createConversationStore } = require('../store/conversationStore')
  const store = createConversationStore({ dataDir: directory }), conversationId = '294396c7-71af-4f74-9908-959ebcf9b020'
  const out = sources.present(`The code is Amber. [memory:${id}]`, [row])
  store.appendTurn({ id: conversationId, userText: 'Recall the code.', replyText: out.reply, memorySources: out.memorySources })
  const saved = createConversationStore({ dataDir: directory }).get(conversationId)
  assert.deepEqual(saved.messages.at(-1).memorySources, out.memorySources)
  assert.deepEqual(sources.savedReferences(saved), [id])
  let seen
  await require('./context').recallContext({ enabled: true, query: 'Was that changed?', history: saved.messages,
    referenceIds: sources.savedReferences(saved), memory: { recall: async (_query, opts) => { seen = opts.references; return [] } } })
  assert.deepEqual(seen, [id])
  assert.deepEqual(sources.savedReferences({ messages: [...saved.messages, ...Array.from({ length: 4 }, () => ({ role: 'user', content: 'new topic' }))] }), [])
})
test('context supplies the source contract without ordering document IDs into the main answer', async () => {
  const context = await require('./context').recallContext({ enabled: true, query: 'Recall the code.', memory: { recall: async () => [row] } })
  assert.deepEqual(context.sources, [row])
  assert.match(context.block, /\[memory:/)
  assert.doesNotMatch(context.block, /Cite documentId and date\./)
})

test('saved reference cannot resurrect an archived row through the real canonical gateway', async () => {
  const { createGateway, OWNER } = require('./governed')
  const gateway = createGateway({ store: require('./structuredStore').createTestStore() })
  const record = await gateway.propose(OWNER, { type: 'preference', subject: 'Answer format', text: 'Prefer one concise paragraph.', scope: 'private:owner',
    source: { kind: 'owner', id: 'offline-reference', at: '2026-11-06T00:00:00Z', attribution: 'owner_statement' } })
  await gateway.transition(OWNER, record.id, record.version, 'approve')
  const memory = { preferences: () => gateway.preferences(OWNER), recall: (query, options) => gateway.recall(OWNER, query, options) }
  const context = await require('./context').recallContext({ enabled: true, query: 'What was that?', referenceIds: [record.id], memory })
  const canonical = context.sources.find(row => row.documentId === record.id)
  assert.ok(canonical); assert.ok(canonical.version > record.version)
  const receipt = sources.present(`One paragraph. [memory:${record.id}]`, context.sources).memorySources
  assert.equal(receipt.items[0].version, canonical.version)
  await gateway.transition(OWNER, record.id, canonical.version, 'archive')
  const after = await require('./context').recallContext({ enabled: true, query: 'What was that?', referenceIds: receipt.items.map(row => row.documentId), memory })
  assert.equal(after.sources.length, 0); assert.ok(!after.block.includes(record.text))
  assert.equal(sources.present(`One paragraph. [memory:${record.id}]`, after.sources).memorySources, null)
})

test('intake guards retain substantive memory answer and archive while source receipt is separated', async t => {
  const before = { ...process.env }
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key]; Object.assign(process.env, before) })
  Object.assign(process.env, { CHAT_BACKEND: 'codex-subscription', TURN_ROUTER: 'on', READ_ACCESS: 'on', XIANGXIANG_MEMORY: 'on', CONTEXT_DECISIONS_OPENAI: 'on',
    GOAL_DECOMPOSER: 'off', A4_KNOWLEDGE_ROUTING: 'off', XIANGXIANG_WEBSITE_FLOW: 'off', CONVERSATION_RECALL: 'off', DECISION_RECALL: 'off', MULTI_AI_ROUTER: 'off' })
  const raw = `The remembered code is Amber. [memory:${id}]\nIts present business status is unverified.`
  let answerInput, calls = 0
  const adapter = { preflight: async () => {}, complete: async prompt => { answerInput = prompt; calls++; return {
    text: JSON.stringify({ intent: 'question', mode: 'chat', reply: raw, nextRead: null }), model: 'offline-fixture'
  } } }
  const result = await require('../intake/intakeService').processIntake('What was the remembered code?', adapter, [], {
    demo: true, interactionMode: 'chat', openaiAdapter: adapter,
    semanticCallModel: async () => JSON.stringify({ intent: 'NONE', confidence: 'HIGH' }),
    memoryClient: { recall: async () => [row] }, readContextDeps: { connector: { read: async () => assert.fail('business read forbidden') } }
  })
  assert.equal(calls, 1); assert.ok(answerInput.includes(row.documentId)); assert.match(answerInput, /\[memory:DOCUMENT_ID\]/)
  assert.equal(result.reply, raw.replace(`[memory:${id}]`, ''))
  assert.equal(result.replyForArchive, result.reply)
  assert.equal(result.memorySources.items[0].documentId, id)
  assert.equal(result.memorySources.claimsVerified, false)
  assert.deepEqual(result.tasks, []); assert.equal(result.decision, null)
})
