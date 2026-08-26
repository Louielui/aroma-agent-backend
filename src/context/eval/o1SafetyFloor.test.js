'use strict'
/**
 * o1SafetyFloor.test.js — THE TWO THINGS THAT MUST NEVER COME BACK.
 *
 * 1. A business question answered out of the WRONG table.
 * 2. A request to DO work answered with a read.
 *
 * Plus the fence around the shadow classifier: it may suggest, and it may never acquire
 * authority. No model call, no connector, no network — every callModel here is injected.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { intentFor } = require('../readContext')
const { routeTurn } = require('../../intake/turnRouter')
const { metrics } = require('./measureBusinessIntent')
const shadow = require('./semanticIntentShadow')

test('*** WRONG-SOURCE FLOOR: 叫咗嘅貨到咗未 must not read order_planning ***', () => {
  const r = routeTurn('叫咗嘅貨到咗未？', { previousLane: null })
  assert.notEqual(r.domain, 'order_planning', 'the aspect over-match is back')
  assert.deepEqual(r.sources || [], [], 'a no-read is acceptable; a wrong read is not')
})

test('the relative marker is the discriminator, not aspect alone', () => {
  assert.equal(routeTurn('最近落咗咩單？').route, 'BUSINESS_QUERY', '咗 must not break separation')
  assert.equal(intentFor('叫咗嘅貨'), null)
  assert.equal(intentFor('訂過嘅貨'), null)
  assert.equal(intentFor('訂的貨'), null)
})

test('*** ordinary separable compounds survive unchanged ***', () => {
  for (const q of ['叫貨', '叫咩貨', '今日要叫咩貨', '訂什麼貨', '有咩貨要補？', '今日邊啲貨要補？']) {
    const i = intentFor(q)
    assert.ok(i && i.key === 'order_planning', 'lost a genuine form: ' + q)
  }
})

test('*** ACTION FLOOR: a request to do work is never answered with a read ***', () => {
  for (const q of ['幫我落單訂10箱菜', '幫我寄封信', '幫我開張發票', '幫我寄封信畀供應商', '幫我開張發票畀客']) {
    const r = routeTurn(q, { previousLane: null })
    assert.notEqual(r.route, 'BUSINESS_QUERY', 'write request answered as a read: ' + q)
    assert.deepEqual(r.sources || [], [], 'a work request must carry no read source: ' + q)
  }
})

test('*** and read questions are not collateral ***', () => {
  const keep = [
    ['最近落咗咩單？', 'BUSINESS_QUERY'],
    ['有咩採購單？', 'BUSINESS_QUERY'],
    ['最近有咩發票？', 'BUSINESS_QUERY'],
    ['幫我睇下訂貨建議', 'BUSINESS_QUERY'],
    // THE READ-REQUEST EXEMPTION, EXERCISED. This one carries BOTH an act verb (採購) and a
    // read verb (查下). Only isReadRequest keeps it a read; without that clause the act verb
    // wins and a plain lookup becomes an ACTION that reads nothing.
    ['幫我查下採購紀錄', 'BUSINESS_QUERY'],
    ['幫我改個檔案名', 'ACTION']
  ]
  for (const pair of keep) {
    assert.equal(routeTurn(pair[0], { previousLane: null }).route, pair[1], 'changed: ' + pair[0])
  }
})

test('*** the floor, measured across all 68 rows ***', () => {
  const m = metrics()
  assert.equal(m.WRONG_SOURCE_READS, 0, 'a wrong-source read exists')
  assert.equal(m.FALSE_POSITIVES, 0, 'precision was spent')
  assert.equal(m.ACTION_MISROUTES, 0, 'a work request is answered as a read')
  assert.equal(m.ACTION_AUTHORITY_WIDENED, 'NO')
  assert.equal(m.BUSINESS_READ_TOTAL, 48)
  assert.equal(m.BUSINESS_INTENT_CORRECT, 27)
  assert.equal(m.NO_READ_MISSES, 21)
  assert.equal(m.TOTAL_INTENT_FAILURES, 21)
})

test('*** out-of-enum classifier output is refused ***', () => {
  for (const bad of ['payroll', 'aroma_system', 'listInventory', '', null, 42, 'INVOICE']) {
    const r = shadow.admit({ intent: bad, confidence: 'HIGH' })
    assert.equal(r.candidate, shadow.NONE, 'admitted out-of-enum: ' + JSON.stringify(bad))
    assert.deepEqual(shadow.resolveSource(r.candidate), [])
  }
})

test('*** an attempt to name a source or tool is REJECTED, not stripped ***', () => {
  for (const f of ['source', 'sources', 'connector', 'tool', 'method', 'action', 'write']) {
    const obj = { intent: 'invoice', confidence: 'HIGH' }
    obj[f] = 'aroma_system'
    const r = shadow.admit(obj)
    assert.equal(r.candidate, shadow.NONE, 'accepted a classifier-supplied ' + f)
    assert.equal(r.rejected, 'attempted_' + f)
  }
})

test('the SERVER resolves the source, from the same table as the deterministic path', () => {
  assert.deepEqual(shadow.resolveSource('inventory'), ['aroma_system'])
  assert.deepEqual(shadow.resolveSource('schedule'), ['calendar'])
  assert.deepEqual(shadow.resolveSource(shadow.NONE), [])
  assert.deepEqual(shadow.resolveSource('not_a_key'), [])
})

test('*** shadow changes no route, and does not run off the miss path ***', async () => {
  let called = 0
  const callModel = async () => { called++; return { intent: 'inventory', confidence: 'HIGH' } }

  const onRead = await shadow.observe({ message: '睇下存量', deterministicRoute: 'BUSINESS_QUERY', callModel })
  assert.equal(onRead.applicable, false)
  assert.equal(called, 0, 'the classifier ran on a turn that already reads')

  const onMiss = await shadow.observe({ message: '啲貨夠唔夠？', deterministicRoute: 'CONVERSATION', callModel })
  assert.equal(onMiss.applicable, true)
  assert.equal(onMiss.candidate, 'inventory')
  assert.equal(onMiss.routeChanged, false, 'shadow altered a route')
  assert.deepEqual(onMiss.impliedSource, ['aroma_system'], 'recorded, not acted on')

  assert.equal(routeTurn('啲貨夠唔夠？').route, 'CONVERSATION')
  assert.deepEqual(routeTurn('啲貨夠唔夠？').sources || [], [])
})

test('a malformed or hostile model reply abstains rather than guessing', async () => {
  const fenced = await shadow.classify('x', async () => '```json\n{"intent":"inventory","confidence":"HIGH"}\n```')
  assert.equal(fenced.candidate, 'inventory', 'a fenced but valid reply is admitted')
  const refusal = await shadow.classify('x', async () => 'sorry, I cannot')
  assert.equal(refusal.candidate, shadow.NONE)
  const noConf = await shadow.classify('x', async () => '{"intent":"inventory"}')
  assert.equal(noConf.candidate, shadow.NONE, 'missing confidence must abstain')
})
