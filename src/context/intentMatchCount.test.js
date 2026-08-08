'use strict'

/**
 * intentMatchCount.test.js — count every intent a message matches, and change nothing else.
 *
 * > **Owner: 「Count every intent match, record the n, change nothing. Run it for a while, then
 * > pick the tiering rule from my real questions rather than your nine invented ones.」**
 * >
 * > 「你想要嗰個訊號，每一轉都計緊，每一轉都掉咗 — is why the measurement is cheap: the data
 * > already exists and is being discarded.」**
 *
 * `intentFor()` walks the whole table and returns the FIRST match. The information that three
 * intents matched is computed on every turn and thrown away on every turn. `allIntentsFor()`
 * keeps it. Nothing else changes: the router still routes on the first match, the reads are
 * identical, and the only difference on the wire is a number in the log.
 *
 * ⛔ THE POINT OF MEASURING RATHER THAN DECIDING. The tier rule proposed in
 * DESIGN-DIRECT-QUERY-AND-BOUNDED-ENQUIRY.md was measured against NINE PHRASES I INVENTED.
 * That is the same defect as choosing a keyword list by imagining what he types. This produces
 * the real distribution from real turns; the rule gets chosen afterwards, against it.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { intentFor, allIntentsFor, INTENTS } = require('./readContext')

test('*** allIntentsFor keeps what intentFor discards ***', () => {
  const q = '邊啲存貨低過安全線，要向邊個供應商補貨'
  const all = allIntentsFor(q)
  assert.ok(all.length >= 2, 'this question is about stock AND suppliers AND ordering')
  assert.deepEqual(all.map((i) => i.key).sort(), ['inventory', 'order_planning', 'supplier'])
})

test('*** ⛔ intentFor is UNCHANGED — the first match, exactly as before ***', () => {
  // The router still routes on this. If it moved, the measurement would have changed the
  // thing it is measuring, which is the one outcome that makes the data worthless.
  for (const q of [
    '邊啲存貨低過安全線，要向邊個供應商補貨',
    '今日要訂貨嗎',
    '睇下倉存',
    '呢張發票同採購單對唔對得上',
    '香香, 到aroma system, 看看今天要向costco訂什麼貨'
  ]) {
    const first = intentFor(q)
    const all = allIntentsFor(q)
    if (first === null) {
      assert.equal(all.length, 0, 'no first match must mean no matches at all: ' + q)
    } else {
      assert.equal(all[0].key, first.key, 'allIntentsFor[0] must BE intentFor: ' + q)
    }
  }
})

test('*** the order is the table order — first match stays first ***', () => {
  const all = allIntentsFor('呢張發票同採購單對唔對得上')
  const order = INTENTS.map((i) => i.key)
  const idx = all.map((i) => order.indexOf(i.key))
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b), 'results must follow the declared order')
})

test('*** no match is an empty array, never null ***', () => {
  assert.deepEqual(allIntentsFor('今晚打算早點收工'), [])
  assert.deepEqual(allIntentsFor(''), [])
  assert.deepEqual(allIntentsFor(null), [])
})

test('*** a message matching one intent counts one — the common case is not inflated ***', () => {
  assert.equal(allIntentsFor('睇下倉存').length, 1)
  assert.equal(allIntentsFor('今日要訂貨嗎').length, 1)
})
