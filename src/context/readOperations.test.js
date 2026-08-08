'use strict'

/**
 * readOperations.test.js — the vocabulary is CLOSED, and it cannot drift.
 *
 * Two failures this guards, both of which would be silent at runtime:
 *   1. a seventh Aroma view added to the routing table and never offered to the model;
 *   2. an operation named with a write-shaped word, which reasoningLoop would refuse — the
 *      model would pick it, the loop would decline it, and nothing would say why.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { AROMA_INTENTS } = require('./readContext')
const { WRITE_SHAPED } = require('../intake/reasoningLoop')
const {
  AROMA_OPERATIONS, operationsForSources, resolveReadOperation, operationForAromaMethod, describeOperations
} = require('./readOperations')

/* ═══ NO DRIFT FROM THE ROUTING TABLE ══════════════════════════════════════ */

test('*** every Aroma routing intent has exactly one operation, and vice versa ***', () => {
  assert.deepEqual(
    AROMA_OPERATIONS.map((o) => o.intentKey).sort(),
    AROMA_INTENTS.map((i) => i.key).sort(),
    'a view the automatic planner can reach but the model cannot ask for is the original defect'
  )
  for (const o of AROMA_OPERATIONS) {
    const intent = AROMA_INTENTS.find((i) => i.key === o.intentKey)
    assert.equal(o.method, intent.method, o.operation + ' must terminate in the SAME adapter method')
  }
})

test('*** operation names are unique ***', () => {
  const names = AROMA_OPERATIONS.map((o) => o.operation)
  assert.equal(new Set(names).size, names.length)
})

/* ═══ ⛔ EVERY NAME CLEARS THE WRITE GUARD ═════════════════════════════════ */

test('*** no generated operation is write-shaped — the loop would refuse it ***', () => {
  for (const op of operationsForSources(['aroma_system', 'gmail', 'drive', 'calendar', 'github'])) {
    assert.equal(WRITE_SHAPED.test(op), false,
      op + ' matches WRITE_SHAPED, so reasoningLoop would refuse it at runtime and say nothing useful. ' +
      'Rename the operation — do NOT weaken the guard.')
  }
})

/* ═══ AUTHORISATION IS SOURCE-BASED, AND THIS FILE GRANTS NOTHING ══════════ */

test('*** a source that was not authorised produces no operation ***', () => {
  assert.deepEqual(operationsForSources([]), [], 'nothing authorised, nothing offered')
  const gmailOnly = operationsForSources(['gmail'])
  assert.deepEqual(gmailOnly, ['gmail'])
  assert.equal(gmailOnly.some((o) => o.startsWith('aroma_system')), false,
    'aroma_system was not authorised, so NONE of its child operations may exist')
})

test('*** aroma_system expands to exactly its six views ***', () => {
  assert.deepEqual(operationsForSources(['aroma_system']), [
    'aroma_system.inventory',
    'aroma_system.suppliers',
    'aroma_system.daily_counts',
    'aroma_system.replenishment',
    'aroma_system.purchasing',
    'aroma_system.invoices'
  ])
})

test('*** a bare aroma_system is NOT itself an operation ***', () => {
  assert.equal(operationsForSources(['aroma_system']).includes('aroma_system'), false,
    'the whole point: the model may not name the source and leave the view to the server')
  assert.deepEqual(resolveReadOperation('aroma_system'), { source: 'aroma_system', method: null },
    'it resolves as a bare SOURCE with no method — so the aroma branch falls back to the ' +
    'automatic planner, which is the pre-existing behaviour, not a model-directed read')
})

test('*** generic sources keep their own names and are unchanged ***', () => {
  assert.deepEqual(operationsForSources(['gmail', 'drive', 'calendar', 'github']),
    ['gmail', 'drive', 'calendar', 'github'])
})

test('*** source order is preserved and duplicates collapse ***', () => {
  assert.deepEqual(operationsForSources(['gmail', 'gmail', 'drive']), ['gmail', 'drive'])
})

/* ═══ RESOLUTION IS DETERMINISTIC, AND UNKNOWN MEANS NULL ══════════════════ */

test('*** each operation resolves to its one frozen method ***', () => {
  assert.deepEqual(resolveReadOperation('aroma_system.invoices'), { source: 'aroma_system', method: 'listInvoices' })
  assert.deepEqual(resolveReadOperation('aroma_system.inventory'), { source: 'aroma_system', method: 'listInventory' })
  assert.deepEqual(resolveReadOperation('aroma_system.purchasing'), { source: 'aroma_system', method: 'listPurchaseOrders' })
})

test('*** an invented or write-shaped operation resolves to NOTHING ***', () => {
  for (const bad of ['aroma_system.staffing', 'aroma_system.', 'aroma_system.createInvoice', 'nonsense.thing', '', null, undefined, 42]) {
    assert.equal(resolveReadOperation(bad), null, JSON.stringify(bad) + ' must not resolve')
  }
})

test('*** no method or path from outside the table can ever be named ***', () => {
  // A model returning a raw adapter method, or something path-shaped, resolves to null.
  for (const bad of ['listInvoices', 'aroma_system/listInvoices', '../etc/passwd', 'aroma_system.listInvoices']) {
    const r = resolveReadOperation(bad)
    assert.equal(r === null || r.method === null, true, bad + ' must never yield a method')
  }
})

test('*** an automatic read can be recorded as the operation it was ***', () => {
  assert.equal(operationForAromaMethod('listInventory'), 'aroma_system.inventory')
  assert.equal(operationForAromaMethod('listOrderPlanning'), 'aroma_system.replenishment')
  assert.equal(operationForAromaMethod('nope'), null)
  assert.equal(operationForAromaMethod(null), null)
})

/* ═══ THE GLOSS THE MODEL IS SHOWN ════════════════════════════════════════ */

test('*** the description glosses each Aroma operation and lists nothing else ***', () => {
  const d = describeOperations(['aroma_system.purchasing', 'gmail'])
  assert.ok(d.includes('aroma_system.purchasing＝採購單'), 'an opaque name is a guess waiting to happen')
  assert.ok(d.includes('gmail'), 'a generic source is listed as itself')
  assert.equal(describeOperations([]), null, 'nothing to offer and nothing read means no description')
})

/* ═══ ⛔ THE LIVE-CANARY DEFECT: AN ABSENT OPERATION IS NOT AN UNAVAILABLE ONE ══ */

test('*** an already-read operation is stated as READ, never left to look missing ***', () => {
  // Live GPT, 「庫存」 follow-up: inventory HAD been read and its rows were in the prompt, but
  // 倉存 was absent from the choice list and she answered 「目前無法直接讀取庫存資料」, then
  // spent a second paid read on 盤點紀錄 as a substitute. Silence about the second state did
  // that — so the second state is now said out loud.
  const d = describeOperations(['aroma_system.invoices'], ['aroma_system.inventory'])
  assert.ok(d.includes('本回合已經讀取'), 'the already-read state must be NAMED')
  assert.ok(d.includes('aroma_system.inventory＝倉存'), 'and named specifically')
  assert.ok(/讀唔到|無法直接讀取/.test(d), 'with the false claim it must not make, spelled out')
  assert.ok(d.includes('aroma_system.invoices＝發票'), 'while what is still open stays open')
})

test('*** everything read and nothing left still says what is held ***', () => {
  const d = describeOperations([], ['aroma_system.inventory'])
  assert.ok(d && d.includes('本回合已經讀取'),
    'no choices left is not the same as nothing to say — this is where 「讀唔到」 came from')
  assert.equal(d.includes('本回合可用的讀取操作'), false, 'and nothing is offered that is not offerable')
})
