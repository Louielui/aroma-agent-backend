'use strict'

/**
 * scopeNotesRender.test.js — the suppression reaches the rendered reply.
 *
 * scopeNotes.test.js pins the rule in isolation. This pins that the rule is actually WIRED:
 * that `history` travels from the turn into the renderer, that a repeated fixed scope
 * property does not reach the Owner a second time, and — the part that matters more — that
 * everything the omission machinery exists to say still does.
 *
 * A 資料限制 heading with nothing under it would be its own defect, so the empty case is
 * asserted too: when the only limitation was a repeat, the section disappears rather than
 * printing a bare heading.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { buildReadResultReply } = require('./readResultView')

const EV = [{
  source: 'aroma_system',
  kind: 'inventory',
  trust: 'live',
  totalCount: 199,
  shownCount: 2,
  completeness: 'sample',
  rankedBy: null,
  scope: { hasLocation: false, hasAsOf: false, note: null },
  metrics: { qty: { label: '存量', meaning: null } }
}]

const ITEMS = [{
  source: 'aroma_system',
  items: [
    { id: 'r1', title: '菜心', fields: { qty: '12' } },
    { id: 'r2', title: '白菜', fields: { qty: '8' } }
  ]
}]

const plan = (limitations) => ({
  citesEvidence: true,
  directAnswer: '兩項存量偏低。',
  sections: [{ heading: '存量', items: [{ title: '菜心', ref: 'aroma_system#r1', facts: [{ field: '存量', value: '12' }] }] }],
  limitations,
  followUp: ''
})

const render = (limitations, history) => buildReadResultReply({
  reply: '',
  message: '睇下庫存',
  answerPlan: plan(limitations),
  evidenceSets: EV,
  itemsBySource: ITEMS,
  perSource: [],
  history
}).reply

const HER = (text) => [{ role: 'assistant', text }]

/* ═══ the wiring ════════════════════════════════════════════════════════════ */

test('*** the first time, the fixed scope property is shown ***', () => {
  const reply = render(['庫存資料冇分地點，睇唔到邊個倉。'], [])
  assert.ok(reply.includes('資料限制'), 'the section is there')
  assert.ok(reply.includes('冇分地點'), 'and he is told, once')
})

test('*** the second time, a reworded restatement does not reach him ***', () => {
  const reply = render(['呢啲數字冇地點維度，唔分倉。'], HER('庫存資料冇分地點，睇唔到邊個倉。'))
  assert.equal(reply.includes('冇地點維度'), false, 'THE DEFECT: the same fixed property, every turn')
})

test('*** and the heading goes with it — no empty 資料限制 block ***', () => {
  const reply = render(['呢啲數字冇地點維度，唔分倉。'], HER('庫存資料冇分地點。'))
  assert.equal(reply.includes('資料限制'), false, 'a bare heading is its own defect')
})

/* ═══ what must still get through ═══════════════════════════════════════════ */

test('*** the per-turn omission notes are untouched by any of this ***', () => {
  // The plan names a fact the evidence cannot prove, so the validator drops it and the
  // server states the count. That note is about THIS turn and must survive whatever else
  // was said before.
  const p = plan(['庫存資料冇分地點。'])
  p.sections[0].items[0].facts.push({ field: '存量', value: '99999' })
  const reply = buildReadResultReply({
    reply: '', message: '睇下庫存', answerPlan: p, evidenceSets: EV, itemsBySource: ITEMS,
    perSource: [], history: HER('庫存資料冇分地點，睇唔到邊個倉。')
  }).reply
  assert.ok(/有 1 個數值核對唔到/.test(reply), 'the per-turn count still reaches him: ' + reply)
  assert.equal(reply.includes('冇分地點'), false, 'while the repeat does not')
})

test('a limitation about something genuinely new still reaches him', () => {
  const reply = render(['供應商價目未讀到。'], HER('庫存資料冇分地點，亦冇時間戳。'))
  assert.ok(reply.includes('供應商價目未讀到'))
})

test('with no history nothing is suppressed — a fresh conversation loses nothing', () => {
  const reply = render(['庫存資料冇分地點。', '亦冇記錄係幾時更新。'], undefined)
  assert.ok(reply.includes('冇分地點') && reply.includes('幾時更新'))
})
