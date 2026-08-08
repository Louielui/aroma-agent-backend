'use strict'

/**
 * factVerification.test.js — why every business turn carried an omission note.
 *
 * Three unrelated causes were producing one symptom. The Owner saw
 * 「有 8 個數值核對唔到,冇顯示。」 on every single business turn; the log said which fields
 * dropped and why, and the answer was different each time:
 *
 *   CLASS C  dates and phone numbers   — THE COMPARATOR WAS WRONG. matchValue is a QUANTITY
 *            checker: it rejects any string carrying more than one number BEFORE attempting
 *            any comparison, so a date could only pass by byte-identical string match. The
 *            invoice turn proved it against itself — 「7 月 6 日開立」 passed in prose while
 *            the same date dropped as a field. Two checkers, one date, opposite verdicts.
 *
 *   CLASS B  units and free text       — UNDIAGNOSABLE. The drop record carried the field and
 *            the reason but never the value, so twice now the honest answer was "I cannot
 *            tell you whether she invented it or wrote a variant". A record that cannot
 *            explain its own rejection is not a record.
 *
 *   CLASS A  缺口 = 安全存量 − 現有存量  — CORRECTLY dropped by the old rule, and the rule was
 *            wrong. Owner ruling: allow derivations, but only SERVER-COMPUTED ones from two
 *            DECLARED metrics on the same row. She names the derivation, the server does the
 *            arithmetic, so a wrong subtraction is impossible — the same discipline that
 *            already makes metric values server-supplied.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { validatePlan, matchValue, evidenceIndex, ANSWER_PLAN_SCHEMA } = require('./answerPlan')

/* ═══ CLASS C — A DATE IS A DATE ═══════════════════════════════════════════ */

const dateIndex = () => evidenceIndex(
  [{ source: 'aroma_system', trust: 'live', matchingTotal: 1, shownCount: 1, scope: {}, metrics: {} }],
  [{ source: 'aroma_system', items: [{ source: 'aroma_system', sourceId: '1', title: 'INV', originalDate: '2026-07-06T00:00:00.000Z', fields: { total: '191.10', invoiceDate: '2026-07-06T00:00:00.000Z', phone: '204-555-1234' } }] }]
)

test('*** the same date the row stores as a timestamp is accepted as a date ***', () => {
  const i = dateIndex()
  for (const written of ['2026-07-06', '2026/07/06', '2026年7月6日', '2026-07-06T00:00:00.000Z']) {
    assert.equal(matchValue(written, i).ok, true, 'THE DEFECT: multiple_numbers before any comparison — ' + written)
  }
})

test('*** a DIFFERENT date is still rejected — this is normalisation, not relaxation ***', () => {
  const i = dateIndex()
  for (const wrong of ['2026-07-07', '2025-07-06', '2026-08-06']) {
    assert.equal(matchValue(wrong, i).ok, false, 'must not pass: ' + wrong)
  }
})

test('*** a phone number matches across separator styles, and only across separators ***', () => {
  const i = dateIndex()
  assert.equal(matchValue('(204) 555 1234', i).ok, true, 'same digits, different separators')
  assert.equal(matchValue('204-555-1234', i).ok, true, 'verbatim')
  assert.equal(matchValue('204-555-9999', i).ok, false, 'different digits must fail')
})

test('*** a decimal is NOT treated as a separated-digit sequence ***', () => {
  // '191.10' must keep going through the numeric path. Stripping '.' would make 191.10 and
  // 19110 the same string, which is exactly the kind of collapse this must never do.
  const i = dateIndex()
  assert.equal(matchValue('191.10', i).ok, true, 'the real total')
  assert.equal(matchValue('19110', i).ok, false, 'a different number must not match by digit-stripping')
})

test('substring matching is still refused', () => {
  const i = dateIndex()
  assert.equal(matchValue('2026', i).ok, false, 'a fragment of a date is not the date')
  assert.equal(matchValue('204', i).ok, false, 'a fragment of a phone number is not the number')
})

/* ═══ CLASS B — THE RECORD EXPLAINS ITSELF ═════════════════════════════════ */

const ctx = () => ({
  evidenceSets: [{ source: 'aroma_system', trust: 'live', matchingTotal: 1, shownCount: 1, scope: {}, metrics: { currentStock: { label: '現有存量' }, parLevel: { label: '安全存量' } } }],
  itemsBySource: [{ source: 'aroma_system', items: [{ source: 'aroma_system', sourceId: '1', title: 'Beef Plate', fields: { currentStock: '0.000', parLevel: '30.000', unit: 'kg' } }] }],
  message: ''
})

const planWith = (facts) => ({
  citesEvidence: true,
  directAnswer: 'Beef Plate 已經缺貨。',
  sections: [{ heading: '存量', items: [{ title: 'Beef Plate', sourceId: '1', ref: 'aroma_system#1', facts }] }],
  limitations: [],
  followUp: null
})

test('*** a rejected value is now ON the drop record ***', () => {
  const r = validatePlan(planWith([{ field: '單位', value: '公斤' }]), ctx())
  const d = r.drops.find((x) => x.field === '單位')
  assert.ok(d, 'it dropped')
  assert.equal(d.value, '公斤', 'and now says WHAT was rejected — twice I could not answer this')
  assert.ok(d.shape, 'with its shape: ' + JSON.stringify(d))
})

test('*** a long or spaced value is SHAPED, never reproduced ***', () => {
  // The value can be third-party content — an event description, a mail subject. The record
  // carries a short token or nothing; it never becomes a place where content leaks.
  const long = '請 Dr. Phangureh 覆診並帶上轉介信同保險卡'
  const r = validatePlan(planWith([{ field: '待辦', value: long }]), ctx())
  const d = r.drops.find((x) => x.field === '待辦')
  assert.equal(d.value, undefined, 'not reproduced: ' + JSON.stringify(d))
  assert.equal(d.shape, 'text')
  assert.ok(Number.isFinite(d.length), 'the length is enough to recognise it')
})

test('*** an address, a URL or a path is never carried, however short ***', () => {
  for (const v of ['a@b.co', 'http://x.io', 'C:\\p\\q']) {
    const r = validatePlan(planWith([{ field: 'x', value: v }]), ctx())
    const d = r.drops.find((x) => x.field === 'x')
    assert.equal(d.value, undefined, 'must not appear: ' + v)
  }
})

test('the log line carries the same projection, explicitly', () => {
  const { logAnswerPlan } = require('./answerPlan')
  const line = logAnswerPlan({ outcome: 'degraded', drops: [{ kind: 'fact', sourceId: '1', field: '單位', why: 'not_a_value', value: '公斤', shape: 'short_token', length: 2 }] }, () => {})
  const d = line.dropped[0]
  assert.equal(d.value, '公斤')
  assert.equal(d.shape, 'short_token')
})

/* ═══ CLASS A — DECLARED DERIVATIONS, SERVER-COMPUTED ══════════════════════ */

test('*** 缺口 is computed by the SERVER from two declared metrics ***', () => {
  const c = ctx()
  c.evidenceSets[0].derivations = { 缺口: { minus: ['parLevel', 'currentStock'] } }
  // The model writes a WRONG number; the server overwrites it with the real subtraction.
  const r = validatePlan(planWith([{ field: '缺口', value: '999' }]), c)
  const f = r.plan.sections[0].items[0].facts.find((x) => x.field === '缺口')
  assert.ok(f, 'the derivation is kept, not dropped')
  assert.equal(f.value, '30', '30.000 − 0.000 = 30, computed here — a wrong subtraction is impossible')
  assert.equal(r.droppedFacts, 0)
})

test('*** an UNDECLARED derivation is still dropped ***', () => {
  const c = ctx()
  c.evidenceSets[0].derivations = { 缺口: { minus: ['parLevel', 'currentStock'] } }
  const r = validatePlan(planWith([{ field: '平均值', value: '15' }]), c)
  assert.equal(r.droppedFacts, 1, 'she may not invent arithmetic')
})

test('*** a derivation whose inputs are missing on the row is dropped, not guessed ***', () => {
  const c = ctx()
  c.evidenceSets[0].derivations = { 缺口: { minus: ['parLevel', 'currentStock'] } }
  c.itemsBySource[0].items[0].fields = { currentStock: '0.000' } // no parLevel
  const r = validatePlan(planWith([{ field: '缺口', value: '30' }]), c)
  assert.equal(r.droppedFacts, 1)
})

test('a source with no declared derivations gains none', () => {
  // 17 is deliberately NOT a value on the row. My first version used 30, which happens to
  // equal parLevel (30.000) and so passed the ordinary numeric check on its own merits —
  // the test would have been green whether or not derivations were opt-in.
  const r = validatePlan(planWith([{ field: '缺口', value: '17' }]), ctx())
  assert.equal(r.droppedFacts, 1, 'derivations are opt-in per source, like metrics')
})

test('*** the inventory derivation is DECLARED in the adapter, not invented here ***', () => {
  const { DERIVATIONS_OF } = require('../context/adapters/aromaSystemRead')
  assert.ok(DERIVATIONS_OF.inventory && DERIVATIONS_OF.inventory['缺口'], 'inventory declares 缺口')
  assert.deepEqual(DERIVATIONS_OF.inventory['缺口'].minus, ['parLevel', 'currentStock'])
})

/* ═══ 4. THE OMISSION SENTENCE ═════════════════════════════════════════════ */

test('*** the omission notes are written Traditional Chinese ***', () => {
  const { buildReadResultReply } = require('./readResultView')
  const c = ctx()
  const r = buildReadResultReply({
    reply: '', message: '', answerPlan: planWith([{ field: '單位', value: '公斤' }]),
    evidenceSets: c.evidenceSets, itemsBySource: c.itemsBySource, perSource: []
  })
  assert.ok(r.reply.includes('有 1 個數值無法核對，未顯示。'), 'got: ' + r.reply)
  assert.equal(/核對唔到|冇顯示/.test(r.reply), false, 'the Cantonese form is gone')
})

test('the ITEM omission note is rewritten too — same sentence family', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'readResultView.js'), 'utf8')
  // CONVERTED: the sentence moved to the catalogue with the rest of the file. The pair must
  // still be written the same way as each other, which is now checked on the entries.
  const { CATALOGUE } = require('../i18n/catalogue')
  assert.equal(/項系統核對唔到/.test(src), false, 'leaving one of a pair in Cantonese would be arbitrary')
  assert.match(CATALOGUE['rrv.droppedItems'].zh, /無法核對/)
  assert.match(CATALOGUE['rrv.droppedFacts'].zh, /無法核對/, 'the pair is written the same way')
  // The sentence lives in the catalogue now, not in readResultView.js.
  assert.match(CATALOGUE['rrv.droppedItems'].zh, /項系統無法核對/)
})

/* ═══ 5. SCHEMA DESCRIPTIONS ═══════════════════════════════════════════════ */

function allDescriptions (node, out = []) {
  if (!node || typeof node !== 'object') return out
  if (typeof node.description === 'string' && node.description) out.push(node.description)
  for (const v of Object.values(node)) if (v && typeof v === 'object') allDescriptions(v, out)
  return out
}

test('*** no schema description is written in Cantonese ***', () => {
  // THE FINDING THAT CHANGED THE OWNER'S RULING: a field description sits at the point of
  // generation and outweighs a contract paragraph. 「今日冇特別安排」 came out of a field
  // whose own description read 「一至兩句,直接答到問題。唔好覆述逐項細節。」
  const { withRowRefs } = require('./answerPlan')
  const bad = allDescriptions(ANSWER_PLAN_SCHEMA)
    .concat(allDescriptions(withRowRefs(require('./answerPlan').DISTILL_WITH_PLAN_SCHEMA, ['aroma_system#1'])))
    .filter((d) => /[嘅咗唔喺睇冇嘢咁乜嗰哋㗎咩嚟攞俾諗搵啲]|而家/.test(d))
  assert.deepEqual(bad, [], 'these still instruct her in Cantonese')
})

test('*** every constraint the descriptions expressed is still expressed ***', () => {
  // THE PER-TURN SCHEMA, not just the static one. withRowRefs injects the `ref` description
  // at turn time, so the static schema does not carry it — and the per-turn schema is what
  // actually reaches the model. My first version scanned only the static shape and reported
  // the ref constraint missing when it was simply somewhere this was not looking.
  const { withRowRefs } = require('./answerPlan')
  // withRowRefs takes the DISTILL envelope (it reaches into .properties.answerPlan), not
  // the plan schema alone — my first version handed it the wrong one and it threw.
  const perTurn = withRowRefs(require('./answerPlan').DISTILL_WITH_PLAN_SCHEMA, ['aroma_system#1'])
  const all = allDescriptions(ANSWER_PLAN_SCHEMA).concat(allDescriptions(perTurn)).join('\n')
  for (const [what, re] of [
    ['directAnswer length', /一至兩句/],
    ['directAnswer must not restate rows', /不要覆述|不要重複/],
    ['citesEvidence true meaning', /至少要有一節|至少一項/],
    ['citesEvidence false meaning', /必須留空/],
    ['followUp at most one', /最多一個問題/],
    ['ref must be verbatim', /逐字/]
  ]) assert.ok(re.test(all), 'constraint lost in translation: ' + what)
})

test('the distill schema descriptions are rewritten too', () => {
  const { DISTILL_WITH_PLAN_SCHEMA } = require('./answerPlan')
  const bad = allDescriptions(DISTILL_WITH_PLAN_SCHEMA)
    .filter((d) => /[嘅咗唔喺睇冇嘢咁乜嗰哋㗎咩嚟攞俾諗搵啲]|而家/.test(d))
  assert.deepEqual(bad, [])
})
