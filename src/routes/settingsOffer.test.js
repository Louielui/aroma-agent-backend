'use strict'
/**
 * settingsOffer.test.js — the door the registry did not have.
 *
 * Measured 2026-08-07: 「幫我改，每樣食材顯示 10 條回收」 produced a conversation and changed
 * nothing. This is the sentence that must now work.
 */
const { test, describe } = require('node:test')
const assert = require('node:assert')
const { explainSettingsOffer, settingsOfferFor } = require('./settingsOffer')
const current = (id) => ({ recallShownPerIngredient: 6, recallEveryMs: 86400000, recallIngredients: ['beef'] })[id]

describe('⛔ the sentence that failed now produces an offer', () => {
  test('「幫我改，每樣食材顯示 10 條回收」', () => {
    const o = settingsOfferFor({ message: '幫我改,每樣食材顯示 10 條回收', currentValue: current })
    assert.ok(o, 'this exact sentence is why the entrance exists')
    assert.strictEqual(o.id, 'recallShownPerIngredient')
    assert.strictEqual(o.to, 10)
  })

  test('⛔ the offer shows BEFORE → AFTER in one line', () => {
    const o = settingsOfferFor({ message: '改每樣食材顯示 10 條', currentValue: current })
    assert.match(o.line, /6/, 'the current value must be visible')
    assert.match(o.line, /10/)
    assert.match(o.line, /→/)
  })

  test('full-width digits are ordinary typing and must work', () => {
    const o = settingsOfferFor({ message: '改每樣食材顯示 １０ 條', currentValue: current })
    assert.strictEqual(o.to, 10)
  })

  test('it carries whether the change applies live', () => {
    const o = settingsOfferFor({ message: '改每朝幾點查 8', currentValue: current })
    assert.strictEqual(o.appliesOn, 'REREGISTER_TASK')
    assert.ok(o.howToApply)
  })
})

describe('⛔ it fires on literals only — no classifier anywhere', () => {
  test('a QUESTION about a setting is not a request to change it', () => {
    assert.strictEqual(settingsOfferFor({ message: '每樣食材顯示幾多條回收?' }), null)
  })

  test('⛔ a refusal is not a request', () => {
    const r = explainSettingsOffer({ message: '唔好改每樣食材顯示 10 條' })
    assert.strictEqual(r.offer, null)
    assert.strictEqual(r.reason, 'negated')
  })

  test('⛔ two settings named at once fires NOTHING — picking one would be a guess', () => {
    const r = explainSettingsOffer({ message: '改查邊幾樣食材同埋幾點查 8' })
    assert.strictEqual(r.offer, null)
    assert.strictEqual(r.reason, 'no_single_setting_named')
  })

  test('two numbers is ambiguous and fires nothing', () => {
    assert.strictEqual(settingsOfferFor({ message: '改每樣食材顯示 10 條,唔係 12' }), null)
  })

  test('no value named → no offer, with its reason', () => {
    assert.strictEqual(explainSettingsOffer({ message: '改每樣食材顯示幾多條回收' }).reason, 'no_value_named')
  })

  test('a sentence about nothing in the registry fires nothing', () => {
    assert.strictEqual(settingsOfferFor({ message: '改個 buffer size 做 4096' }), null)
  })

  test('the module requires no model client', () => {
    const { codeOnly } = require('../testutil/codeOnly')
    const src = codeOnly(require('fs').readFileSync(__dirname + '/settingsOffer.js', 'utf8'))
    assert.doesNotMatch(src, /adapter|anthropic|openai|complete\(/i, 'a classifier here would be M-5 with a new surface')
  })
})

describe('⛔ a change the registry would refuse is never offered', () => {
  test('out of range → no offer, and the fence speaks', () => {
    const r = explainSettingsOffer({ message: '改兩次搜尋之間隔幾耐 0' })
    assert.strictEqual(r.offer, null)
    assert.match(r.reason, /^refused:/)
    assert.match(r.saying, /籬笆/, 'a button that cannot work must not appear')
  })

  test('an ingredient list is only read when written as one', () => {
    const o = settingsOfferFor({ message: '改查邊幾樣食材:beef、romaine、cheese', currentValue: current })
    assert.deepStrictEqual(o.to, ['beef', 'romaine', 'cheese'])
  })

  test('an over-long list is refused with its cost, not silently truncated', () => {
    const many = Array.from({ length: 20 }, (_, i) => 'x' + i).join('、')
    const r = explainSettingsOffer({ message: '改查邊幾樣食材:' + many })
    assert.strictEqual(r.offer, null)
    assert.match(r.saying, /12 秒|限流/)
  })
})

describe('nothing is written by making an offer', () => {
  test('⛔ the module never imports the value store', () => {
    const { codeOnly } = require('../testutil/codeOnly')
    const src = codeOnly(require('fs').readFileSync(__dirname + '/settingsOffer.js', 'utf8'))
    assert.doesNotMatch(src, /settingsValues/, 'an offer that can write is not an offer')
  })
})
