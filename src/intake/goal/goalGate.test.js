'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  goalDecomposerEnabled, sourcesForPlan, requirementBlock, GOAL_FLAG
} = require('./goalGate')

const fact = (o) => Object.assign({ id: 'f1', need: '', operation: null, entity: null, fields: [], necessity: 'required', status: 'UNAVAILABLE', reason: 'NO_OPERATION' }, o)
const ALL = ['aroma_system', 'gmail', 'calendar']

test('*** ⛔ DEFAULT OFF — an unset flag reads as off, and so does anything but "on" ***', () => {
  assert.equal(goalDecomposerEnabled({}), false)
  assert.equal(goalDecomposerEnabled({ [GOAL_FLAG]: '' }), false)
  assert.equal(goalDecomposerEnabled({ [GOAL_FLAG]: 'shadow' }), false, 'shadow is not a value here')
  assert.equal(goalDecomposerEnabled({ [GOAL_FLAG]: 'true' }), false, 'exact match only')
  assert.equal(goalDecomposerEnabled({ [GOAL_FLAG]: 'on' }), true)
})

test('*** ⛔ THE ACCEPTANCE CASE — a plan naming NO operation reads NOTHING ***', () => {
  // 「給我 Aroma System 的 website」. Today this reads four stock counts and cannot assemble an
  // answer. The plan says the required fact is the system's own URL and that no operation
  // carries it, so the correct number of sources to read is ZERO.
  const plan = { facts: [fact({ need: 'the system\'s own URL', operation: null })] }
  assert.deepEqual(sourcesForPlan(plan, ALL), [],
    '⛔ if this ever returns aroma_system again the whole wiring has failed')
})

test('*** a plan naming one operation reads only that operation\'s source ***', () => {
  const plan = { facts: [fact({ operation: 'aroma_system.inventory', status: 'AVAILABLE', reason: null })] }
  assert.deepEqual(sourcesForPlan(plan, ALL), ['aroma_system'])
})

test('*** ⛔ IT CAN ONLY EVER NARROW — a named source that is not enabled stays unread ***', () => {
  // Same discipline as the route: INTERSECTED with what the Owner's switches allow, never
  // unioned. A plan is a requirement, not an authorisation.
  const plan = { facts: [fact({ operation: 'aroma_system.inventory', status: 'AVAILABLE' })] }
  assert.deepEqual(sourcesForPlan(plan, ['gmail']), [], 'not enabled → not read, plan or no plan')
})

test('*** ⛔ A FAILED OR ABSENT PLAN NARROWS NOTHING — fail-safe, never fail-shut ***', () => {
  // B failing must fall back to the existing loop, never to no answer. `null` means
  // 「no opinion」 and the caller keeps the sources it already had.
  assert.equal(sourcesForPlan(null, ALL), null)
  assert.equal(sourcesForPlan({}, ALL), null)
  assert.equal(sourcesForPlan({ facts: [] }, ALL), null, 'an empty plan is not an instruction to read nothing')
})

test('*** ⛔ OPTIONAL facts do not authorise a read on their own ***', () => {
  const plan = { facts: [fact({ operation: 'aroma_system.invoices', necessity: 'optional', status: 'AVAILABLE' })] }
  assert.deepEqual(sourcesForPlan(plan, ALL), [], 'only required facts pull a source in')
})

test('*** the requirement block STATES the gap rather than hiding it ***', () => {
  const plan = { facts: [fact({ need: '系統自己嘅網址', operation: null, reason: 'NO_OPERATION' })] }
  const block = requirementBlock(plan)
  assert.ok(block && block.length, 'a block exists')
  assert.ok(block.includes('系統自己嘅網址'), 'the need is named')
  assert.ok(/UNAVAILABLE|冇|唔/.test(block), 'and it is marked as not obtainable')
  // ⛔ The model must not be able to read this as an instruction to substitute something near.
  assert.ok(/唔好就近|不准就近|do not substitute/i.test(block),
    'no-nearest-neighbour is carried IN the block, not assumed')
})

test('*** ⛔ a plan with nothing required produces no block rather than an empty heading ***', () => {
  assert.equal(requirementBlock(null), null)
  assert.equal(requirementBlock({ facts: [] }), null)
})
