'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { decomposeGoal, buildPrompt, PLANNING_SYSTEM } = require('./goalDecomposer')
const { catalogueForPrompt } = require('./operationCatalogue')
const { goalPlanSchema } = require('./goalPlanContract')

test('the planning call uses its own short contract without discarding context or changing its schema', async () => {
  let request
  const question = 'Keep the first read-only and the latter outline-only.'
  await decomposeGoal({ question, workingContext: { block: 'user: choose A and B\nassistant: which?\nuser: choose A and B' },
    contextBlocks: ['APPROVED OWNER PREFERENCE: concise', 'RETRIEVAL STATUS: unavailable'],
    hostContext: 'Configured address is loopback-only.', callModel: async r => { request = r; return { text: '{}' } } })
  assert.equal(typeof PLANNING_SYSTEM, 'string'); assert.ok(PLANNING_SYSTEM.length < 1800)
  assert.equal(request.system, PLANNING_SYSTEM)
  assert.deepEqual(request.responseFormat.schema, goalPlanSchema())
  for (const text of [question, 'APPROVED OWNER PREFERENCE: concise', 'RETRIEVAL STATUS: unavailable', 'Configured address is loopback-only.']) assert.ok(request.prompt.includes(text))
  assert.equal(request.prompt.split('choose A and B').length - 1, 2, 'intentional repeated history is preserved')
  const catalogue = catalogueForPrompt()
  assert.ok(request.prompt.includes(JSON.stringify(catalogue)), 'all catalogue facts remain, compactly encoded')
  assert.ok(!request.prompt.includes(JSON.stringify(catalogue, null, 1)), 'pretty-printing is not model context')
})

test('planner unavailability is still a failure and its one invocation is not retried', async () => {
  let calls = 0
  const r = await decomposeGoal({ question: 'What is available?', callModel: async () => { calls++; throw Error('offline') } })
  assert.equal(r.ok, false); assert.equal(calls, 1)
})
