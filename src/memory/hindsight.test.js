'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createHindsight } = require('./hindsight')
const env = { XIANGXIANG_MEMORY: 'on', HINDSIGHT_URL: 'http://127.0.0.1:8888', HINDSIGHT_BANK: 'xiangxiang-owner', HINDSIGHT_TOKEN: 'fixture-token' }
const id = 'xx-12345678-1234-4123-8123-123456789abc'
test('consolidation requires structured output and scopes retrieval to supplied evidence',async()=>{
  let payload={structured_output:{candidates:[]}}
  const client=createHindsight({env,transport:async(url,init)=>{
    const b=JSON.parse(init.body);assert.ok(url.endsWith('/reflect'));assert.deepEqual(b.tags,[id]);assert.equal(b.tags_match,'any_strict')
    assert.equal(b.exclude_mental_models,true);assert.equal(b.response_schema.properties.candidates.maxItems,4)
    assert.match(b.query,/exact verbatim quote/);return Response.json(payload)
  }})
  assert.deepEqual(await client.consolidate({id,text:'Use green folders.',source:{at:null}},[]),{candidates:[]})
  payload={text:'Everything is saved.'};await assert.rejects(client.consolidate({id,text:'Use green folders.'},[]),/consolidation_unavailable/)
})
test('memory adapter isolates the bank, proves retain, correction and deletion through document reads', async () => {
  const calls = []; let document = null
  const client = createHindsight({ env, transport: async (url, init) => {
    calls.push({ url, init }); assert.equal(init.redirect, 'error'); assert.equal(init.headers.authorization, 'Bearer fixture-token')
    assert.ok(url.startsWith('http://127.0.0.1:8888/v1/default/banks/xiangxiang-owner/'))
    if (init.method === 'POST') {
      const body = JSON.parse(init.body); assert.equal(body.async, false); assert.equal(body.items[0].document_id, id)
      document = { id, bank_id: 'xiangxiang-owner', original_text: body.items[0].content, memory_unit_count: 1, created_at: '2026-09-29T12:00:00Z' }
      return Response.json({ success: true, async: false, bank_id: 'xiangxiang-owner', items_count: 1 })
    }
    if (init.method === 'DELETE') { document = null; return Response.json({ success: true }) }
    return document ? Response.json(document) : new Response('{}', { status: 404 })
  } })
  assert.equal((await client.retain(id, 'Owner prefers summaries in blue folders.')).text, 'Owner prefers summaries in blue folders.')
  assert.equal((await client.retain(id, 'Owner prefers summaries in green folders.')).text, 'Owner prefers summaries in green folders.')
  assert.equal((await client.forget(id)).state, 'deleted')
  const before = calls.length
  await assert.rejects(client.forget('../other-bank')); await assert.rejects(client.retain(id, 'password=secret-credential'))
  assert.equal(calls.length, before)
})
test('disabled, remote destinations and invalid success cannot become connected memory', async () => {
  let calls = 0
  const transport = async () => { calls++; return Response.json({ success: true, async: true }) }
  await assert.rejects(createHindsight({ env: {}, transport }).recall('preference'))
  await assert.rejects(createHindsight({ env: { ...env, HINDSIGHT_URL: 'https://example.com' }, transport }).recall('preference'))
  assert.equal(calls, 0)
  await assert.rejects(createHindsight({ env, transport }).retain(id, 'Owner prefers green folders.'))
})
test('recall requires document provenance, bounds text and never treats missing results as empty', async () => {
  let payload = { results: [{ id: 'fact-1', document_id: id, text: 'Owner prefers green folders.', mentioned_at: null }] }
  const client = createHindsight({ env, transport: async (url, init) => {
    assert.ok(url.endsWith('/memories/recall')); const body = JSON.parse(init.body)
    assert.equal(body.max_tokens, 800); assert.deepEqual(body.types, ['world', 'experience'])
    assert.deepEqual(body.tags, ['owner-explicit', 'xiangxiang-auto']); assert.equal(body.tags_match, 'any_strict')
    return Response.json(payload)
  } })
  const r = await client.recall('folder preference'); assert.equal(r[0].documentId, id); assert.equal(r[0].date, null)
  payload = {}; await assert.rejects(client.recall('folder preference'))
  payload = { results: [{ text: 'unattributed' }] }; await assert.rejects(client.recall('folder preference'))
})
test('automatic retain labels attribution and timestamp, and requires exact document read-back', async () => {
  const text = 'OWNER SAID: Prefer green. ASSISTANT SAID: I suggest a folder.'
  const source = { kind: 'conversation', id: 'fixture', at: '2026-09-29T12:00:00Z' }
  const client = createHindsight({ env, transport: async (url, init) => {
    if (init.method === 'POST') {
      const item = JSON.parse(init.body).items[0]
      assert.deepEqual(item.tags, ['xiangxiang-auto']); assert.equal(item.timestamp, source.at)
      assert.match(item.context, /not proof of completion/); assert.equal(item.content, text)
      return Response.json({ success: true, async: false, bank_id: 'xiangxiang-owner', items_count: 1 })
    }
    return Response.json({ id, bank_id: 'xiangxiang-owner', original_text: text, memory_unit_count: 2 })
  } })
  assert.equal((await client.retainAutomatic(id, text, source)).facts, 2)
})

test('zero extracted facts still confirm the exact stored original', async () => {
  const client = createHindsight({ env, transport: async (url, init) => init.method === 'POST'
    ? Response.json({ success: true, async: false, bank_id: 'xiangxiang-owner', items_count: 1 })
    : Response.json({ id, bank_id: 'xiangxiang-owner', original_text: 'Hello again.', memory_unit_count: 0 }) })
  assert.equal((await client.retainAutomatic(id, 'Hello again.', { at: null })).facts, 0)
})
test('mail source banks are isolated from shared scope and owner banks', async () => {
  const urls = []; const bank = 'xiangxiang-mail-' + require('node:crypto').createHash('sha256').update('admin-mail:adm@example.test').digest('hex').slice(0, 24)
  const client = createHindsight({ env, transport: async (url, init) => {
    urls.push(url); assert.ok(url.startsWith('http://127.0.0.1:8888/v1/default/banks/' + bank))
    return Response.json({ results: [] })
  } })
  assert.deepEqual(await client.forMailSource('adm@example.test').recall('old invoice'), [])
  assert.equal(urls.length, 1)
  assert.throws(() => client.forMailSource('invalid/path'), /invalid_mail_source/)
  assert.throws(() => client.forScope('admin-mail:adm@example.test'), /invalid_scope/)
})
test('dedicated indexing request can be cancelled for foreground owner conversation', async () => {
  const abort = new AbortController(); let begin; const began = new Promise(resolve => { begin = resolve })
  const client = createHindsight({ env, transport: async (url, init) => { begin(); await new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true })); return null } })
  const job = client.forMailSource('adm@example.test').withSignal(abort.signal).recall('earlier invoice')
  await began; abort.abort(); await assert.rejects(job, /memory_yielded/)
})

test('mail semantic recall accepts a measured response beyond six seconds while keeping its deadline bounded', async t => {
  const deadlines = [], timeout = AbortSignal.timeout.bind(AbortSignal)
  t.mock.method(AbortSignal, 'timeout', milliseconds => { deadlines.push(milliseconds); return timeout(milliseconds) })
  let delayed = true
  const client = createHindsight({ env, transport: async (url, init) => {
    if (delayed) await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 6250)
      init.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Deadline', 'AbortError')) }, { once: true })
    })
    return Response.json({ results: [{ id: 'fact-1', document_id: id, text: 'Original notification test.', mentioned_at: null }] })
  } })
  const result = await client.forMailSource('adm@example.test').recall('notification test')
  assert.equal(result[0].documentId, id); assert.deepEqual(deadlines, [10000])
  delayed = false
  await client.recall('notification test'); await client.forScope('domain:email').recall('notification test')
  assert.deepEqual(deadlines, [10000, 6000, 6000])
})
