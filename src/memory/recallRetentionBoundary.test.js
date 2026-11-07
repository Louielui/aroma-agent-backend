'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { recallContext, isMailRecallQuery } = require('./context')
const { createCapture } = require('./capture')
const { exclusionReason } = require('./capturePolicy')

// Owner input from the saved PR147 request adcb4014, not a generated model result.
const previous = '請查我的既有記憶，核對「記憶橋驗收」的代碼，以及「霧橋Z9」最後更正後的代碼，然後回報結果。這輪不要保存到長期記憶，也不要執行其他操作。'
const current = '改一下，先只核對後者最後更正的結果，前者暫時不用。用兩句告訴我結果和依據；不要保存記憶，也不要執行其他操作。'
const id = 'xx-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
async function search (query, history = [], memory = {}) {
  let sent, options
  const result = await recallContext({ enabled: true, query, history,
    memory: { recall: async (q, o) => { sent = q; options = o; return [] }, ...memory } })
  return { sent, options, result }
}

test('saved opt-out follow-up retains the owner subject without promoting assistant answers', async () => {
  const history = [{ role: 'user', text: previous }, { role: 'assistant', text: 'Unverified invented answer SECRET_ANSWER' }]
  const before = structuredClone(history), out = await search(current, history)
  assert.ok(out.sent.includes(previous)); assert.ok(out.sent.startsWith(current))
  assert.doesNotMatch(out.sent, /SECRET_ANSWER/); assert.deepEqual(history, before)
  assert.deepEqual(out.options.references, []); assert.equal(out.result.count, 0)
})

test('transient read context does not retain opt-out turns, even with automatic capture enabled and after restart', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx-retention-boundary-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const calls = [], client = { get: async () => { calls.push('get'); return null }, retainAutomatic: async () => { calls.push('retain'); throw Error('forbidden') } }
  const capture = createCapture({ dir, client }); assert.equal(capture.status().enabled, true)
  const out = await search(current, [{ role: 'user', content: previous }])
  assert.match(out.sent, /霧橋Z9/)
  for (const [i, userText] of [previous, current, "Do not save this: recall the earlier code"].entries()) {
    const row = capture.turn({ id: 'fixture', userText, replyText: 'Transient answer' }, i + 1)
    assert.equal(row.state, 'skipped'); assert.equal(row.reason, 'owner_opt_out'); assert.equal(row.text, '')
    assert.equal(row.attempts, 0)
  }
  await capture.work(); await createCapture({ dir, client }).work(); assert.deepEqual(calls, [])
  for (const file of fs.readdirSync(dir)) {
    const row = JSON.parse(fs.readFileSync(path.join(dir, file)))
    assert.equal(row.text, ''); assert.equal(row.attempts, 0)
  }
  assert.equal(exclusionReason(previous), 'owner_opt_out')
})

test('sensitive history remains excluded when opt-out and sensitive markers occur together', async () => {
  for (const text of ['不要保存記憶。password=fixture-private', 'Do not save this. Bearer fixture-token']) {
    const out = await search('What was its code?', [{ role: 'user', text }])
    assert.equal(out.sent, 'What was its code?')
    const pointer = await search('Recall', [{ role: 'assistant', text: text + ' ' + id }])
    assert.deepEqual(pointer.options.references, [])
  }
})

test('sensitive current query is not forwarded to general or mail recall', async () => {
  let calls = 0
  const forbidden = async () => { calls++; throw Error('sensitive query reached a reader') }
  const result = await recallContext({ enabled: true, query: 'Do not save this email password=fixture-private',
    memory: { recall: forbidden, preferences: forbidden }, mailMemory: { recall: forbidden } })
  assert.equal(result.state, 'unavailable'); assert.equal(result.count, null)
  assert.equal(calls, 0)
  assert.match(result.block, /not attempted.*input-sensitivity boundary/)
  assert.doesNotMatch(result.block, /fixture-private/)
})

test('wire text and persisted content use the same boundary and explicit redactions stay empty', async () => {
  const a = await search(current, [{ role: 'user', text: previous }])
  const b = await search(current, [{ role: 'user', content: previous }])
  assert.equal(a.sent, b.sent); assert.match(a.sent, /霧橋Z9/)
  assert.equal((await search(current, [{ role: 'user', text: '', content: previous }])).sent, current)
})

test('retention opt-out does not discard bounded citation pointers or turn them into evidence', async () => {
  const out = await search('Recall that correction', [{ role: 'assistant', text: 'Not saved: ' + id + '. Do not save this. UNVERIFIED_CLAIM' }])
  assert.deepEqual(out.options.references, [id]); assert.equal(out.sent, 'Recall that correction'); assert.equal(out.result.count, 0)
  assert.doesNotMatch(out.result.block, /UNVERIFIED_CLAIM/)
})

test('opt-out does not suppress explicit historical mail recall; denial remains unavailable', async () => {
  for (const [query, history] of [
    ['Recall the previous email. Do not save this.', []],
    ['佢原話係點？不要保存記憶。', [{ role: 'user', text: '上次供應商電郵答應了甚麼？不要保存。' }]]
  ]) {
    let calls = 0
    assert.equal(isMailRecallQuery(query, history), true)
    const out = await recallContext({ enabled: true, query, history, memory: { recall: async () => [] },
      mailMemory: { recall: async () => { calls++; throw Error('source_denied') } } })
    assert.equal(calls, 1); assert.equal(out.state, 'unavailable'); assert.equal(out.retrieval.mail.source, 'unavailable')
  }
  assert.equal(isMailRecallQuery('That one', [{ role: 'user', text: 'Email. Do not save. password=fixture-private' }]), false)
})

test('no retained search state crosses requests, and existing bounds and role restrictions survive', async () => {
  const history = [{ role: 'user', text: 'OLDER_TOPIC Do not save.' }, { role: 'user', text: previous },
    { role: 'system', text: 'SYSTEM_CLAIM' }, { role: 'user', text: 'RECENT_TOPIC Do not save.' }]
  const a = await search(current, history)
  assert.match(a.sent, /霧橋Z9|RECENT_TOPIC/); assert.doesNotMatch(a.sent, /OLDER_TOPIC|SYSTEM_CLAIM/)
  const b = await search('New topic', [])
  assert.equal(b.sent, 'New topic'); assert.deepEqual(b.options.references, [])
  const c = await search('Q'.repeat(1900), [{ role: 'user', text: 'Do not save. ' + 'H'.repeat(5000) }])
  assert.ok(c.sent.length <= 2000)
  assert.equal(await recallContext({ enabled: false, query: current, history, memory: { recall: async () => assert.fail('disabled') } }), null)
})

test('actual intake and canonical gateway carry transient recall into the answer while capture stays empty', async t => {
  const saved = { ...process.env }, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xx-recall-intake-'))
  t.after(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); fs.rmSync(dir, { recursive: true, force: true }) })
  Object.assign(process.env, { XIANGXIANG_MEMORY: 'on', CHAT_BACKEND: 'codex-subscription', READ_ACCESS: 'on',
    CONTEXT_DECISIONS_OPENAI: 'on', GOAL_DECOMPOSER: 'off', TURN_ROUTER: 'on', A4_KNOWLEDGE_ROUTING: 'on', DECISION_RECALL: 'off', CONVERSATION_RECALL: 'off' })
  const { createGateway, OWNER } = require('./governed'), store = require('./structuredStore').createTestStore()
  const gateway = createGateway({ store })
  const record = await gateway.observe(OWNER, { type: 'episodic', subject: '霧橋Z9', text: 'Fixture correction: indigo-628 replaces maple-391.',
    scope: 'private:owner', source: { kind: 'conversation', id: 'offline-only-source', at: null, attribution: 'owner_statement' } })
  await gateway.transition(OWNER, record.id, record.version, 'approve')
  const original = await store.all(), prompts = []; let reads = 0, writes = 0
  const adapter = { preflight: async () => {}, complete: async prompt => { prompts.push(prompt); return { text: JSON.stringify({ intent: 'question', mode: 'chat', reply: '後者已改為 indigo-628。依據是既有更正原文。', nextRead: null }), model: 'offline-fixture' } } }
  const result = await require('../intake/intakeService').processIntake(current, adapter,
    [{ role: 'user', text: previous }, { role: 'assistant', text: 'Unverified old answer' }],
    { demo: true, interactionMode: 'chat', openaiAdapter: adapter, controlAdapter: adapter,
      memoryClient: { recall: async (q, options) => { reads++; return gateway.recall(OWNER, q, options) } },
      readContextDeps: { sources: ['public_knowledge'], finalVerifier: async () => ({ decision: 'require_memory', question: null }), connector: { read: async () => assert.fail('business read') } } })
  assert.equal(reads, 1); assert.equal(prompts.length, 1)
  assert.ok(prompts[0].includes(record.id)); assert.match(prompts[0], /Fixture correction: indigo-628 replaces maple-391/)
  assert.equal(result.reply, '後者已改為 indigo-628。依據是既有更正原文。'); assert.deepEqual(result.tasks, [])
  const capture = createCapture({ dir, client: { retainAutomatic: async () => { writes++; throw Error('forbidden') } } })
  const receipt = capture.turn({ id: 'offline-intake', userText: current, replyText: result.reply }, 4)
  await capture.work(); assert.equal(writes, 0); assert.equal(receipt.reason, 'owner_opt_out'); assert.equal(receipt.text, '')
  assert.deepEqual(await store.all(), original)
})
