'use strict'

/**
 * distillEnvelopeBaseline.test.js — the BYTE-IDENTICAL PROOF, written before the parser
 * is touched.
 *
 * WHY THIS EXISTS FIRST. `parseDistillResponse` is shared by every lane — chat, proposal,
 * commit, the legacy path — and commit 4 of the answer-plan work needs it to carry one
 * new optional field. Changing a parser that everything depends on, and then checking
 * whether anything broke, is the wrong order: by then the baseline is gone.
 *
 * So this file pins the CURRENT projection exactly, as it stands before any change. Every
 * assertion below passes against today's parser. If adding `answerPlan` alters what any
 * other lane receives — a key, a default, a coercion, an order — one of these turns red
 * and the change is wrong, not merely surprising.
 *
 * These are frozen expectations, not descriptions. Do not "update" one to make a change
 * pass; that would delete the only evidence that the change was safe.
 *
 * Pure module: no adapter, no network, no paid call.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { parseDistillResponse } = require('./distillPrompt')

const parse = (obj) => parseDistillResponse(JSON.stringify(obj))

/** The exact key set every lane receives today, in this order. */
const PROJECTED_KEYS = [
  'intent', 'mode', 'reply', 'understanding', 'judgment', 'decision',
  'tasks', 'risks', 'next_step', 'reasons', 'offer'
]

test('*** the projected key set is exactly this, in this order ***', () => {
  const out = parse({ intent: 'chit_chat', mode: 'chat', reply: 'x' })
  assert.deepEqual(Object.keys(out), PROJECTED_KEYS)
})

test('*** CHAT lane projection is frozen ***', () => {
  const out = parse({ intent: 'chit_chat', mode: 'chat', reply: '你好' })
  assert.deepEqual(out, {
    intent: 'chit_chat', mode: 'chat', reply: '你好', understanding: '你好',
    judgment: '', decision: null, tasks: [], risks: [], next_step: '', reasons: [], offer: ''
  })
})

test('*** COMMIT / proposal lane projection is frozen ***', () => {
  const out = parse({
    intent: 'do_it', mode: 'commit', understanding: 'u', judgment: 'j',
    decision: { title: 'd' }, tasks: [{ title: 't', capability: 'coding' }],
    risks: ['r'], next_step: 'n', reply: 'x', reasons: ['a'], offer: 'o'
  })
  assert.deepEqual(out, {
    intent: 'do_it', mode: 'commit', reply: 'x', understanding: 'x', judgment: 'j',
    decision: null, tasks: [{ title: 't', note: '', capability: 'coding' }],
    risks: [], next_step: 'n', reasons: [], offer: ''
  })
})

test('*** ASK lane projection is frozen ***', () => {
  const out = parse({ intent: 'ask', mode: 'ask', reply: '你想點做?', reasons: ['x'], offer: 'y' })
  assert.equal(out.mode, 'ask')
  assert.equal(out.reply, '你想點做?')
  assert.deepEqual(Object.keys(out), PROJECTED_KEYS)
})

test('*** LEGACY envelope — no reply field — is projected the same way ***', () => {
  const out = parse({ intent: 'do_it', mode: 'commit', understanding: 'legacy u', judgment: 'legacy j', next_step: 's' })
  assert.deepEqual(Object.keys(out), PROJECTED_KEYS)
  assert.equal(out.judgment, 'legacy j')
  assert.equal(out.next_step, 's')
})

test('*** an EMAIL-DRAFT-shaped envelope is projected the same way ***', () => {
  // The email/draft lane rides the same envelope; nothing about it may shift either.
  const out = parse({ intent: 'do_it', mode: 'commit', reply: 'draft ready', understanding: 'send a note', tasks: [{ title: 'draft the email', capability: 'product' }], next_step: 'review' })
  assert.deepEqual(Object.keys(out), PROJECTED_KEYS)
  assert.equal(out.reply, 'draft ready')
  assert.deepEqual(out.tasks, [{ title: 'draft the email', note: '', capability: 'product' }])
})

test('*** an UNKNOWN key is dropped — today, before any change ***', () => {
  // This is precisely why commit 4 cannot simply add a field to the model output and
  // expect it to arrive: the projection is closed, and answerPlan would vanish silently.
  const out = parse({ intent: 'chit_chat', mode: 'chat', reply: 'x', answerPlan: { directAnswer: 'a' } })
  assert.equal('answerPlan' in out, false)
  assert.deepEqual(Object.keys(out), PROJECTED_KEYS)
})

test('*** rejection behaviour is frozen: malformed input still throws ***', () => {
  for (const bad of ['', 'not json', '[1,2]', '{"mode":"chat"']) {
    assert.throws(() => parseDistillResponse(bad), 'malformed input must keep throwing')
  }
})

test('*** defaults and coercions are frozen ***', () => {
  const out = parse({ intent: 'chit_chat', mode: 'chat', reply: 'x' })
  assert.equal(out.decision, null)
  assert.deepEqual(out.tasks, [])
  assert.deepEqual(out.risks, [])
  assert.deepEqual(out.reasons, [])
  assert.equal(out.judgment, '')
  assert.equal(out.offer, '')
  assert.equal(out.next_step, '')
  assert.equal(typeof out.understanding, 'string')
})
