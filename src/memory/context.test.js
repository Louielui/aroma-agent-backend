'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { recallContext } = require('./context')
test('recent citation IDs are lookup hints, never assistant prose or permissions', async () => {
  const id = 'xx-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  let options; let actual
  await recallContext({ enabled: true, query: 'What happened before that?', history: [{ role: 'assistant', text: 'Unverified claim. Source: ' + id }],
    memory: { recall: async (q, o) => { actual = q; options = o; return [] } } })
  assert.deepEqual(options.references, [id]); assert.equal(actual, 'What happened before that?')
})
test('follow-up recall includes bounded recent owner questions but never assistant claims or excluded history', async () => {
  let actual
  await recallContext({ enabled: true, query: 'What was its original code?', history: [
    { role: 'user', text: 'An unrelated older topic.' },
    { role: 'user', text: 'What was the later correction for MistBridge Z9?' },
    { role: 'assistant', text: 'Invented assistant code SECRET_ANSWER.' },
    { role: 'user', text: 'password=do-not-search-this' }
  ], memory: { recall: async query => { actual = query; return [] } } })
  assert.match(actual, /What was its original code/)
  assert.match(actual, /MistBridge Z9/)
  assert.doesNotMatch(actual, /SECRET_ANSWER|do-not-search-this|unrelated older/)
  await recallContext({ enabled: true, query: 'Q'.repeat(1900), history: [{ role: 'user', text: 'H'.repeat(5000) }], memory: { recall: async query => { actual = query; return [] } } })
  assert.ok(actual.length <= 2000)
})
test('bounded advisory context preserves source, reports outages and does no read when disabled', async () => {
  let calls = 0
  const memory = { recall: async () => { calls++; return [{ id: 'fact', documentId: 'doc', text: 'Owner prefers green folders.', date: null }] } }
  assert.equal(await recallContext({ enabled: false, memory, query: 'preference' }), null); assert.equal(calls, 0)
  const r = await recallContext({ enabled: true, memory, query: 'preference' })
  assert.match(r.block, /not.*approval/); assert.match(r.block, /green folders/); assert.equal(r.count, 1)
  const failed = await recallContext({ enabled: true, memory: { recall: async () => { throw Error('secret-provider-response') } }, query: 'preference' })
  assert.equal(failed.state, 'unavailable'); assert.equal(failed.count, null); assert.ok(!failed.block.includes('secret-provider-response'))
})
