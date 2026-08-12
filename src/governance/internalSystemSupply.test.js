'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { wantedRegistryFacts, enforceInternalSystemAnswer } = require('./internalSystemAnswer')
const { selfDescription } = require('./selfDescription')

const URL = selfDescription({ env: {} }).aromaSystem.baseUrl

/**
 * ⛔ VERBATIM, 17:06 local, real UI, POST /api/v1/demo/intake, empty history, on the merged
 * detector. The detector worked — she did not ask internal-vs-public — and the outcome was
 * still wrong: the URL is in the registry and did not reach him.
 *
 * > **Owner: 「Suppression is not an answer.」**
 */
const ASK_URL = 'aroma system的網址我沒有了, 給我一下'
const REFUSAL = '我讀到 public_knowledge 1 項記錄。資料讀取成功，但這一次我組不出一個可靠的答案，所以不會亂說。'

test('*** ⛔ THE 17:06 TURN — the registry URL reaches the shipped reply ***', () => {
  const out = enforceInternalSystemAnswer({ reply: REFUSAL, message: ASK_URL })
  assert.equal(out.supplied.includes('url'), true, 'the url fact was supplied')
  assert.ok(out.reply.includes(URL), '⛔ the shipped reply must CONTAIN the URL: ' + out.reply)
})

test('*** the guarantee is on the SHIPPED reply, not on what the model was offered ***', () => {
  // Whatever the model said — a refusal, a wrong URL, silence — the fact is present after.
  for (const reply of [REFUSAL, '我唔知。', '', 'Aroma System 冇網址。']) {
    const out = enforceInternalSystemAnswer({ reply, message: ASK_URL })
    assert.ok(out.reply.includes(URL), '⛔ url missing for reply=' + JSON.stringify(reply))
  }
})

test('*** ⛔ A CORRECT reply produces the URL EXACTLY ONCE — no duplication ***', () => {
  /**
   * ⛔ THIS ASSERTION WAS CHANGED DELIBERATELY, under the Owner's work order, when the covered
   * path moved from FILTERING to COMPOSING.
   *
   * It used to assert byte-identical passthrough when the model already had the URL. That is
   * no longer true and is no longer wanted: on a covered turn the reply is composed from the
   * registry and model output is discarded, precisely so that no phrasing has to be
   * anticipated. The property still worth pinning is that the Owner never sees the URL twice
   * or a mangled splice — which was the real risk the old assertion guarded.
   */
  const good = '你嘅 Aroma System 網址係 ' + URL + '。'
  const out = enforceInternalSystemAnswer({ reply: good, message: ASK_URL })
  const occurrences = out.reply.split(URL).length - 1
  assert.equal(occurrences, 1, '⛔ the URL appears ' + occurrences + ' times: ' + out.reply)
  assert.equal(out.composed, true, 'and it came from the registry, not from the model')
})

test('*** ⛔ A QUESTION THE REGISTRY DOES NOT COVER KEEPS THE HONEST REFUSAL ***', () => {
  // The registry is a small set of facts, not a licence to answer freely. These are READS or
  // things nobody recorded; the existing behaviour must survive untouched.
  const notCovered = [
    'aroma system 有幾多張發票？',        // a read, not a registry fact
    'aroma system 個資料庫密碼係咩？',    // never in the registry
    'aroma system 今日有咩要落單？',      // a read
    'aroma system 用邊個雲端供應商？',     // not recorded anywhere
    /**
     * ⛔ THE CASE THAT BINDS `IS_A_READ`, AND IT WAS MISSING.
     *
     * A mutation deleting the IS_A_READ guard left the suite GREEN: none of the cases above
     * triggers a fact anyway, so the guard was unpinned and deletable. This one DOES match the
     * identity trigger (內部) while being a plain read about invoice counts. Without the guard
     * she would answer a stock question with 「it is your internal system」 — a fact nobody
     * asked for, attached to a question she should have read for.
     */
    'aroma system 內部有幾多張發票？'
  ]
  for (const m of notCovered) {
    assert.deepEqual(wantedRegistryFacts(m), [], '⛔ claimed a fact it does not hold: ' + m)
    const out = enforceInternalSystemAnswer({ reply: REFUSAL, message: m })
    assert.equal(out.reply, REFUSAL, 'byte-identical refusal')
    assert.deepEqual(out.supplied, [])
  }
})

test('*** the identity fact — 「係咪內部嘅」 — is also registry-backed ***', () => {
  const out = enforceInternalSystemAnswer({ reply: '我唔肯定。', message: 'aroma system 係咪我哋內部嘅系統？' })
  assert.equal(out.supplied.includes('identity'), true)
  assert.ok(/內部/.test(out.reply), out.reply)
})

test('*** precondition: a message that does not name her system supplies nothing ***', () => {
  const out = enforceInternalSystemAnswer({ reply: REFUSAL, message: '今日天氣點？' })
  assert.deepEqual(out.supplied, [])
  assert.equal(out.reply, REFUSAL)
})

test('*** ⛔ the disambiguation cannot ship, and the fact does — now by construction ***', () => {
  /**
   * ⛔ CHANGED DELIBERATELY with the move to composition. It used to assert `corrected === true`
   * — i.e. that the REMOVAL path fired. On a covered turn there is nothing to remove, because
   * nothing the model wrote is used at all. The property being protected is unchanged and is
   * now stronger: the question does not reach him, and the fact does, for ANY model output
   * rather than for the phrasings a vocabulary happens to list.
   */
  const asked = '你講嘅 aroma system 係我哋內部系統，定係公開網站？'
  const out = enforceInternalSystemAnswer({ reply: asked, message: ASK_URL })
  assert.equal(out.composed, true, 'composed rather than filtered')
  assert.equal(out.reply.includes('定係公開網站'), false, '⛔ the question shipped: ' + out.reply)
  assert.ok(out.reply.includes(URL), 'and the answer is present: ' + out.reply)
})

test('*** rubbish input never throws and supplies nothing ***', () => {
  for (const v of [undefined, null, {}, { reply: null, message: null }]) {
    const out = enforceInternalSystemAnswer(v)
    assert.deepEqual(out.supplied, [])
  }
  for (const v of [undefined, null, 42]) assert.deepEqual(wantedRegistryFacts(v), [])
})
