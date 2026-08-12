'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { namesInternalSystem } = require('./selfDescription')
const { wantedRegistryFacts, enforceInternalSystemAnswer } = require('./internalSystemAnswer')
const { selfDescription } = require('./selfDescription')

const URL = selfDescription({ env: {} }).aromaSystem.baseUrl
const MODEL_SAID = '我睇睇先。'

/** ⛔ VERBATIM, 17:34 local, real UI, on 91b0a0a. The turn that must keep working. */
const WORKS = 'aroma system的網址我沒有了, 給我一下'

/**
 * ⛔ VERBATIM, same session, next turn. He asked about AROMA BISTRO — the restaurant — and
 * received the identity fact about Aroma System, a different subject, because INTERNAL_NAMES
 * carried bare 「Aroma」. His actual question was never answered: the composed path had already
 * discarded whatever the model would have said.
 */
const RESTAURANT = 'aroma bistro有公開網站嗎?'

test('*** ⛔ THE WORKING TURN STILL WORKS — the URL, clean ***', () => {
  const out = enforceInternalSystemAnswer({ reply: MODEL_SAID, message: WORKS })
  assert.equal(out.composed, true)
  assert.ok(out.reply.includes(URL), out.reply)
  assert.equal(out.reply.includes('定係公開網站'), false, 'no appended question')
})

test('*** ⛔ THE RESTAURANT IS NOT THE SYSTEM — no composed answer ***', () => {
  assert.equal(namesInternalSystem(RESTAURANT), false, '⛔ still matched: ' + RESTAURANT)
  assert.deepEqual(wantedRegistryFacts(RESTAURANT), [])
  const out = enforceInternalSystemAnswer({ reply: MODEL_SAID, message: RESTAURANT })
  assert.equal(out.composed, false)
  assert.equal(out.reply, MODEL_SAID, '⛔ his question was displaced: ' + out.reply)
})

test('*** ⛔ THE CLASS, not the instance — other subjects that merely carry a token ***', () => {
  /**
   * One example is not a class. Every one of these names the BUSINESS or a thing belonging to
   * it, and each contains a token the old list matched. None is a question about the system.
   */
  const otherSubjects = [
    'aroma bistro有公開網站嗎?',        // the restaurant — the observed defect
    'aroma bistro 幾點開門？',           // the restaurant's hours
    'Aroma 嘅 Instagram 帳號係咩？',      // the brand's social account
    'aroma 個菜單幾時更新？',             // the menu
    'Aroma Bistro 個電話號碼係幾多？'      // the restaurant's phone
  ]
  for (const m of otherSubjects) {
    assert.equal(namesInternalSystem(m), false, '⛔ treated as the system: ' + m)
    const out = enforceInternalSystemAnswer({ reply: MODEL_SAID, message: m })
    assert.equal(out.composed, false, '⛔ composed over: ' + m)
    assert.equal(out.reply, MODEL_SAID, 'byte-identical passthrough for: ' + m)
  }
})

test('*** ⛔ AND THE SYSTEM IS STILL RECOGNISED, by every spelling that denotes IT ***', () => {
  // The narrowing must not cost the actual feature. Each of these designates the SYSTEM.
  const systemSubjects = [
    'aroma system的網址我沒有了, 給我一下',
    '給我 Aroma System 的 website',
    'aroma_system 有咩端點？',
    '我哋個系統個網址係咩？',
    '餐廳系統係咪內部嘅？'
  ]
  for (const m of systemSubjects) {
    assert.equal(namesInternalSystem(m), true, '⛔ no longer recognised: ' + m)
  }
})

test('*** a message naming BOTH is treated as the system ***', () => {
  // 「aroma bistro 個 aroma system 網址」 — the system is named explicitly, so it qualifies.
  const m = 'aroma bistro 個 aroma system 網址係咩？'
  assert.equal(namesInternalSystem(m), true)
  assert.ok(enforceInternalSystemAnswer({ reply: MODEL_SAID, message: m }).reply.includes(URL))
})
