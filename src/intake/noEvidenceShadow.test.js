'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { inspectTurn } = require('./noEvidenceShadow')

const INVENTION = 'Aroma System 目前沒有專門的網站。現在我們有三間門市，主要透過 Google 地圖、社交媒體跟電話接客。'
const Q = '給我 Aroma System 的 website'

test('*** ⛔ THE WORKED EXAMPLE — 「三間門市」 on a turn that read nothing ***', () => {
  const r = inspectTurn({ reply: INVENTION, question: Q, rowsRead: 0 })
  assert.equal(r.applies, true)
  assert.equal(r.wouldFire, true, '⛔ if this ever stops firing the shadow has lost its only known positive')
  assert.ok(r.tokens.some((t) => t.includes('三間')), 'and it names the token: ' + r.tokens.join(','))
})

test('*** ⛔ it does NOT run when rows were read — claim binding owns that turn ***', () => {
  const r = inspectTurn({ reply: INVENTION, question: Q, rowsRead: 12 })
  assert.equal(r.applies, false)
  assert.equal(r.wouldFire, false)
  assert.equal(r.reason, 'rows_were_read')
})

test('*** a number the OWNER supplied is sourced, and is not a finding ***', () => {
  const r = inspectTurn({ reply: '你講嘅三間門市我記低咗。', question: '我哋有三間門市', rowsRead: 0 })
  assert.equal(r.wouldFire, false, 'it came from him, so it is not an invention')
})

test('*** a number that came from a READ row is sourced ***', () => {
  const r = inspectTurn({
    reply: '有 37 項要落單。', question: '今日要落咩單', rowsRead: 0,
    rowsText: '{"count":37}'
  })
  assert.equal(r.wouldFire, false)
})

test('*** ⛔ a reply with no specific claim is silent — most turns must be ***', () => {
  const r = inspectTurn({ reply: '你好，我喺度。', question: '你好', rowsRead: 0 })
  assert.equal(r.applies, true, 'it still ran')
  assert.equal(r.wouldFire, false, 'and said nothing — a shadow that fires on 你好 is noise')
  assert.equal(r.reason, 'no_specific_claim')
})

test('*** ⛔ THE KNOWN FALSE POSITIVE IS PINNED, NOT HIDDEN ***', () => {
  // 「一個明確」 — 「一」 as indefinite article plus a measure word. Excluding bare 「一」 would
  // clear it AND would miss 「我哋有一間門市」, a genuine invention numbered one. The trade needs
  // the Owner's real traffic, so it is recorded here as a known cost of measuring rather than
  // tuned away before there is any data.
  const r = inspectTurn({
    reply: '我理解你的意思，但目前還沒有一個明確、可執行的單一動作能整理成提案。',
    question: Q, rowsRead: 0
  })
  assert.equal(r.wouldFire, true, 'it fires — and this test exists so nobody discovers that as a surprise')
})

test('*** ⛔ it decides NOTHING — there is no refuse/allow in the surface ***', () => {
  const r = inspectTurn({ reply: INVENTION, question: Q, rowsRead: 0 })
  // A gate whose failure mode is silence recreates the defect it was built for. The shape of
  // this return value is the guarantee: there is nothing here a caller could gate on.
  assert.deepEqual(Object.keys(r).sort(), ['applies', 'reason', 'tokens', 'wouldFire'])
  for (const k of ['refuse', 'blocked', 'allow', 'verdict', 'reply']) {
    assert.equal(k in r, false, '⛔ shadow must not grow a decision: ' + k)
  }
})

test('*** rubbish input measures nothing and never throws ***', () => {
  for (const v of [undefined, null, {}, { reply: null, rowsRead: 0 }, { reply: '   ', rowsRead: 0 }]) {
    const r = inspectTurn(v)
    assert.equal(r.wouldFire, false)
  }
})
