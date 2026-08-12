'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { shapeDrift, driftForEndpoint, NOISE_FLOOR } = require('./shapeDrift')

const ep = (rowsSeen, fields) => ({ rowsSeen, fields, arrays: {} })
const f = (name, present, nonEmpty, types = ['string']) => ({ name, types, present, nonEmpty })

test('*** ⛔ a field that HALVED is reported — a tier-only diff would call it unchanged ***', () => {
  // 32/55 and 20/55 are both PRESENT. This is the CANDIDATE finding again: the tier is a lossy
  // projection of the ratio, and the projection discards exactly the thing needed later.
  const out = shapeDrift(
    { orderPlanning: ep(55, [f('supplier_name', 55, 32)]) },
    { orderPlanning: ep(55, [f('supplier_name', 55, 20)]) }
  )
  assert.equal(out.alarms.length, 0, 'a coverage move is NOT an alarm')
  assert.equal(out.coverage.length, 1)
  const c = out.coverage[0]
  assert.equal(c.direction, 'down')
  assert.equal(c.noise, false, '20 and 32 are both real numerators')
  assert.deepEqual({ n: c.now.nonEmpty, d: c.now.present }, { n: 20, d: 55 })
})

test('*** ⛔ the denominator moving with the business is NOT drift ***', () => {
  // orderPlanning went 55 rows -> 37 between two real captures. Raw-pair diffing would fire on
  // every field every time; the rate is what survives.
  const out = shapeDrift(
    { orderPlanning: ep(55, [f('supplier_name', 55, 32)]) },   // 58.2%
    { orderPlanning: ep(37, [f('supplier_name', 37, 21)]) }    // 56.8%
  )
  assert.equal(out.alarms.length, 0)
  assert.equal(out.coverage.length, 1, 'it is reported')
  assert.ok(Math.abs(out.coverage[0].now.rate - out.coverage[0].was.rate) < 0.02,
    'and the move is visibly tiny rather than looking like a 32->21 collapse')
})

test('*** ⛔ 3/36 to 2/30 carries noise:true ON THE ROW, not in a footnote ***', () => {
  const out = shapeDrift(
    { suppliers: ep(36, [f('email', 36, 3)]) },
    { suppliers: ep(30, [f('email', 30, 2)]) }
  )
  const c = out.coverage[0]
  assert.equal(c.noise, true,
    'the Owner reads this tired; it must read as noise on its face, not after a lookup')
  assert.ok(NOISE_FLOOR > 3, 'and the floor is stated as a constant, not buried in a condition')
})

test('*** field-set changes ALARM, because no threshold exists to be chosen ***', () => {
  const gone = shapeDrift({ suppliers: ep(36, [f('cutoffTime', 36, 0)]) }, { suppliers: ep(36, []) })
  assert.deepEqual(gone.alarms.map((a) => a.kind), ['FIELD_GONE'])
  assert.equal(gone.alarmed, true)

  const added = shapeDrift({ suppliers: ep(36, []) }, { suppliers: ep(36, [f('newField', 36, 36)]) })
  assert.deepEqual(added.alarms.map((a) => a.kind), ['FIELD_NEW'])

  const typed = shapeDrift(
    { suppliers: ep(36, [f('orderLeadDays', 36, 11, ['null', 'number'])]) },
    { suppliers: ep(36, [f('orderLeadDays', 36, 11, ['string'])]) }
  )
  assert.deepEqual(typed.alarms.map((a) => a.kind), ['TYPE_CHANGED'])
})

test('*** ⛔ an endpoint that returned no rows makes NO claim about its fields ***', () => {
  // 「no rows were returned, so no fields were observed」 is a fact. Inferring that its fields
  // vanished would be the claim this codebase refuses to make.
  const out = driftForEndpoint('invoices', ep(0, []), ep(0, []))
  assert.deepEqual(out.alarms, [], 'still empty is not news')
  assert.deepEqual(out.coverage, [], 'and no coverage is claimed in either direction')

  const arrived = driftForEndpoint('invoices', ep(0, []), ep(12, [f('invoiceNumber', 12, 12)]))
  assert.deepEqual(arrived.alarms.map((a) => a.kind), ['ROWS_ARRIVED'])
  assert.deepEqual(arrived.coverage, [], '⛔ and it does NOT report 0% -> 100% coverage')
})

test('*** ⛔ an endpoint the fresh read could not produce is an ALARM, never a silence ***', () => {
  // The alternative is a report that quietly covers five of six and reads as complete — which
  // is the capture-tooling defect (a product that cannot be questioned) in a new place.
  const out = shapeDrift({ invoices: ep(0, []), suppliers: ep(36, []) }, { suppliers: ep(36, []) })
  assert.deepEqual(out.alarms, [{ endpoint: 'invoices', kind: 'NOT_READ' }])
  assert.equal(out.endpointsCompared, 1, 'and the count says how much was actually compared')
})

test('*** the largest FALL leads, because that is the direction that is believed ***', () => {
  const out = shapeDrift(
    { a: ep(10, [f('x', 10, 9)]), b: ep(10, [f('y', 10, 9)]) },
    { a: ep(10, [f('x', 10, 10)]), b: ep(10, [f('y', 10, 5)]) }
  )
  assert.equal(out.coverage[0].field, 'y', 'the fall, not the rise')
  assert.equal(out.coverage[0].direction, 'down')
})

test('*** an unchanged rate is not news ***', () => {
  const out = shapeDrift({ a: ep(10, [f('x', 10, 7)]) }, { a: ep(10, [f('x', 10, 7)]) })
  assert.deepEqual(out.coverage, [])
  assert.equal(out.alarmed, false)
})
