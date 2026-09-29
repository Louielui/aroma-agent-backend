'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { recallContext } = require('./context')
test('bounded advisory context preserves source, reports outages and does no read when disabled', async () => {
  let calls = 0
  const memory = { recall: async () => { calls++; return [{ id: 'fact', documentId: 'doc', text: 'Owner prefers green folders.', date: null }] } }
  assert.equal(await recallContext({ enabled: false, memory, query: 'preference' }), null); assert.equal(calls, 0)
  const r = await recallContext({ enabled: true, memory, query: 'preference' })
  assert.match(r.block, /not.*approval/); assert.match(r.block, /green folders/); assert.equal(r.count, 1)
  const failed = await recallContext({ enabled: true, memory: { recall: async () => { throw Error('secret-provider-response') } }, query: 'preference' })
  assert.equal(failed.state, 'unavailable'); assert.equal(failed.count, null); assert.ok(!failed.block.includes('secret-provider-response'))
})
