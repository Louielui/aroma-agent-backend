'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { recallContext } = require('./context')
const { createHash } = require('node:crypto')
function deferred () { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const preference = { documentId: 'xx-preference', type: 'preference', scope: 'private:owner', text: 'Answer briefly.', date: null,
  approval: { kind: 'owner', actor: 'owner', contentHash: createHash('sha256').update('Answer briefly.').digest('hex') } }

test('independent authorized memory reads overlap and the reply waits for all of them', async () => {
  const pref = deferred(), general = deferred(), mail = deferred(), started = []
  let finished = false
  const job = recallContext({ enabled: true, query: 'Recall that email', memory: {
    preferences: () => { started.push('preferences'); return pref.promise },
    recall: () => { started.push('general'); return general.promise }
  }, mailMemory: { recall: () => { started.push('mail'); return mail.promise } } }).then(r => { finished = true; return r })
  await new Promise(setImmediate)
  const observed = [...started]
  // Always release the barriers, including on the old serial implementation.
  pref.resolve({ state: 'ok', total: 1, items: [preference] })
  general.resolve([{ documentId: 'xx-general', text: 'Latest corrected value', date: null }])
  await new Promise(setImmediate); assert.equal(finished, false)
  mail.resolve([{ documentId: 'xx-mail', text: 'Original source', date: null }])
  const result = await job
  assert.deepEqual(observed.sort(), ['general', 'mail', 'preferences'])
  assert.equal(result.count, 3); assert.match(result.block, /Latest corrected value/)
  assert.match(result.block, /Original source/); assert.equal(result.preferences.items[0].text, preference.text)
})

test('a synchronous or async memory failure cannot prevent another source or hide its status', async () => {
  for (const fail of [() => { throw Error('secret') }, async () => { throw Error('secret') }]) {
    let read = 0
    const r = await recallContext({ enabled: true, query: 'Recall the preference', memory: { preferences: fail, recall: async () => { read++; return [] } } })
    assert.equal(read, 1); assert.equal(r.preferences.state, 'unavailable'); assert.match(r.block, /preferences are unavailable/)
    assert.equal(r.block.includes('secret'), false)
  }
})

test('stage timings distinguish failed recall, do not disclose content, and cannot fail the request', async () => {
  const rows = [], timing = { requestId: 'offline-test', clock: () => 123, sink: (_, body) => rows.push(JSON.parse(body)) }
  const r = await recallContext({ enabled: true, query: 'sensitive query', memory: {
    preferences: async () => ({ state: 'ok', total: 1, items: [preference] }), recall: async () => { throw Error('sensitive error') }
  }, timing })
  assert.equal(r.state, 'unavailable')
  assert.deepEqual(rows.map(r => [r.phase, r.outcome]).sort(), [['memory_preferences', 'ok'], ['memory_recall', 'error']])
  assert.ok(rows.every(r => r.durationMs === 0 && r.within === 'prompt_build'))
  assert.equal(JSON.stringify(rows).includes('sensitive'), false)
  const ok = await recallContext({ enabled: true, query: 'q', memory: { recall: async () => [] }, timing: { sink: () => { throw Error('sink') } } })
  assert.equal(ok.state, 'ok')
})

test('disabled recall and non-mail requests never start unrelated work', async () => {
  const forbidden = () => assert.fail('unexpected read')
  assert.equal(await recallContext({ enabled: false, memory: { preferences: forbidden, recall: forbidden }, query: 'q' }), null)
  const r = await recallContext({ enabled: true, query: 'Recall my preference', memory: { recall: async () => [] }, mailMemory: { recall: forbidden } })
  assert.equal(r.retrieval.mail, null)
})
