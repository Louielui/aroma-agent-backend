'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { createTurnFinalCache } = require('./finalKnowledgeRequirement')

function deferred () {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}

test('parallel final requests share one pending verifier and preserve its world obligation', async () => {
  const release = deferred(), cache = createTurnFinalCache(); let sends = 0
  const input = { message: 'Check the current schedule.', availableWorlds: { internal: true, public: true }, verify: async () => {
    sends++; await release.promise
    return { decision: 'require_internal', question: null }
  } }
  const waiting = Array.from({ length: 8 }, () => cache.get(input))
  const pendingCalls = cache.calls, pendingSends = sends, wasSettled = cache.settled
  release.resolve()
  const results = await Promise.all(waiting)
  assert.equal(pendingCalls, 1); assert.equal(pendingSends, 1); assert.equal(wasSettled, false)
  assert.equal(cache.settled, true)
  for (const result of results) assert.deepEqual(result.requiredWorlds, { internal: true, public: false })
  assert.strictEqual(await cache.get(input), results[0]); assert.equal(sends, 1)
})

test('a shared failed verifier cannot release a final or retry itself; a new turn is independent', async () => {
  for (const fail of ['throw', 'malformed']) {
    const release = deferred(), cache = createTurnFinalCache(); let sends = 0
    const input = { message: 'Check the current schedule.', verify: async () => {
      sends++; await release.promise
      if (fail === 'throw') throw Error('private provider error')
      return { decision: 'invented', question: null }
    } }
    const waiting = Array.from({ length: 4 }, () => cache.get(input))
    release.resolve()
    for (const result of await Promise.all(waiting)) {
      assert.equal(result.ok, false); assert.equal(result.outcome, 'unavailable')
      assert.equal(JSON.stringify(result).includes('private'), false)
    }
    assert.equal((await cache.get(input)).ok, false); assert.equal(sends, 1)
    assert.equal((await createTurnFinalCache().get(input)).ok, false); assert.equal(sends, 2)
  }
})
