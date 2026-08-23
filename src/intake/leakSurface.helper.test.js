'use strict'

/**
 * leakSurface.helper.test.js — the timestamp-collision contract, and the limits of the fix.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ TWO DEFECTS ARE PINNED HERE, AND THE SECOND WAS CAUSED BY FIXING THE FIRST.
 *
 * ONE — a leak test searched the whole serialized record, and a record carries a clock:
 *
 *     groundingShape  bans '69'    →  "timestamp":"2026-08-23T01:23:16.692Z"
 *     a4Egress        bans '8.72'  →  "timestamp":"...T20:15:18.723Z"
 *
 * Neither is a leak; both failed roughly one run in a thousand per timestamped line.
 *
 * TWO — the first fix removed anything SHAPED like a timestamp or a UUID, anywhere, and removed
 * metadata key names at every nesting level. That is worse than the defect it cured: a UUID is
 * an ordinary business value — an ingredient id in `sourceId`, a document id in `detail` — and
 * a nested key called `event` or `at` is not machine metadata. Under that rule a real leak of an
 * ingredient id was erased before the assertion could see it.
 *
 * ⛔ SO METADATA IS STRUCTURAL, NOT SHAPED AND NOT NAMED. Exclusion is TOP-LEVEL ONLY, for keys
 * proven metadata in the emitted schema. Everything nested, and every value whatever it looks
 * like, remains searched. The cases below fail against the rejected version and pass now.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   Run: node --test src/intake/leakSurface.helper.test.js
 */

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')

const {
  METADATA_KEYS, contentSurfaceOf, contentTextOf, contentTextOfLogLine, contentTextOfLogLines
} = require('./leakSurface.helper')

/** A real ingredient id. Business content that merely happens to be a UUID. */
const BUSINESS_UUID = '83a7ba93-78b6-11f1-aa64-42010a8a0002'
/** A real event time inside a query. Business content that merely happens to be ISO-8601. */
const BUSINESS_ISO = '2026-08-23T01:23:16.692Z'

const planRecord = (over) => Object.assign({
  event: 'ANSWER_PLAN',
  timestamp: '2026-08-23T01:23:16.692Z', // ⛔ .692 — the collision that shipped the false positive
  outcome: 'degraded',
  reason: 'answer_unsupported',
  provider: null,
  droppedItems: 0, droppedFacts: 0, droppedSentences: 1, droppedLimitations: 0,
  rankingClaims: { looksRanking: 0, declared: 0, missing: 0 },
  modelItemCount: 0, keptItemCount: 0, rankingGate: [],
  dropped: [{ kind: 'sentence', sourceId: '', why: 'number_not_in_evidence', shape: 'derived_wrong_value' }],
  requestId: '11111111-2222-4333-8444-555555555555'
}, over)

/* ═══ 1. THE COLLISIONS THAT STARTED IT ════════════════════════════════════ */

describe('the timestamp collisions', () => {
  test('*** ⛔ 1 — A COLLIDING TIMESTAMP IS NOT A LEAK ***', () => {
    const rec = planRecord()
    assert.ok(JSON.stringify(rec).includes('69'), 'the raw record really does contain the token')
    assert.equal(contentTextOf(rec).includes('69'), false, '⛔ the clock still fails the leak test')
  })

  test('*** ⛔ 2 — THE SAME TOKEN IN A CONTENT FIELD MUST STILL FAIL ***', () => {
    for (const field of ['reason', 'outcome']) {
      assert.equal(contentTextOf(planRecord({ [field]: '缺口 69' })).includes('69'), true,
        '⛔ a real leak in ' + field + ' went unseen')
    }
    assert.equal(contentTextOf(planRecord({ dropped: [{ kind: 'sentence', sourceId: 'napa-69' }] })).includes('69'), true,
      '⛔ nested content is not searched')
  })

  test("*** ⛔ THE '8.72' COLLISION ON THE RAW LOG PATH ***", () => {
    const colliding = '[AROMA-EGRESS-PLAN] {"timestamp":"2026-08-22T20:15:18.723Z","rawQueryDiscarded":true}'
    assert.ok(colliding.includes('8.72'), 'the raw line really does contain 8.72')
    assert.equal(contentTextOfLogLine(colliding).includes('8.72'), false)
    // and a real price in a content field is still caught
    const leaked = '[AROMA-EGRESS-PLAN] {"timestamp":"2026-01-01T00:00:00.000Z","query":"beef brisket 8.72"}'
    assert.equal(contentTextOfLogLine(leaked).includes('8.72'), true, '⛔ a real price leak went unseen')
  })

  test('the emitter prefix survives, and the payload keeps its content fields', () => {
    const out = contentTextOfLogLine('[AROMA-EGRESS-PLAN] {"timestamp":"2026-01-01T00:00:00.000Z","rawQueryDiscarded":true}')
    assert.ok(out.includes('[AROMA-EGRESS-PLAN]'))
    assert.ok(out.includes('"rawQueryDiscarded":true'))
  })
})

/* ═══ 2. THE LIMITS — SHAPE IS NOT METADATA ════════════════════════════════ */

describe('shape is not metadata', () => {
  test('*** ⛔ 3 — A TOP-LEVEL requestId UUID MAY BE EXCLUDED ***', () => {
    assert.equal(contentTextOf({ requestId: BUSINESS_UUID, reason: 'x' }).includes(BUSINESS_UUID), false)
  })

  test('*** ⛔ 4 — A CONTENT-BEARING sourceId UUID MUST REMAIN DETECTABLE ***', () => {
    const rec = planRecord({ dropped: [{ kind: 'sentence', sourceId: BUSINESS_UUID }] })
    assert.equal(contentTextOf(rec).includes(BUSINESS_UUID), true,
      '⛔ an ingredient id was erased for looking like a UUID')
    assert.equal(contentTextOfLogLine('[X] {"timestamp":"2026-01-01T00:00:00.000Z","sourceId":"' + BUSINESS_UUID + '"}').includes(BUSINESS_UUID), true)
  })

  test('*** ⛔ 5 — A NESTED detail UUID MUST REMAIN DETECTABLE ***', () => {
    const rec = planRecord({ detail: { note: 'ingredient id ' + BUSINESS_UUID } })
    assert.equal(contentTextOf(rec).includes(BUSINESS_UUID), true)
  })

  test('*** ⛔ 6 — AN ISO-SHAPED STRING IN A CONTENT FIELD MUST REMAIN DETECTABLE ***', () => {
    const line = '[X] {"timestamp":"2026-01-01T00:00:00.000Z","query":"event at ' + BUSINESS_ISO + '"}'
    assert.equal(contentTextOfLogLine(line).includes(BUSINESS_ISO), true,
      '⛔ a business time was erased for looking like the clock')
    assert.equal(contentTextOf(planRecord({ query: 'event at ' + BUSINESS_ISO })).includes(BUSINESS_ISO), true)
  })

  test('*** ⛔ 7 — A NESTED KEY NAMED `event` IS CONTENT, NOT METADATA ***', () => {
    assert.equal(contentTextOf(planRecord({ payload: { event: 'Gordon' } })).includes('Gordon'), true)
    assert.equal(contentTextOf(planRecord({ dropped: [{ event: 'Gordon' }] })).includes('Gordon'), true)
  })

  test('*** ⛔ 8 — A NESTED KEY NAMED `at` IS CONTENT, NOT METADATA ***', () => {
    assert.equal(contentTextOf(planRecord({ payload: { at: 'Beef Brisket' } })).includes('Beef Brisket'), true)
    assert.equal(contentTextOf(planRecord({ source: { at: 'Beef Brisket' } })).includes('Beef Brisket'), true)
  })
})

/* ═══ 3. THE RULE ITSELF ═══════════════════════════════════════════════════ */

describe('the exclusion rule is structural and shallow', () => {
  test('*** ⛔ EXCLUSION IS TOP-LEVEL ONLY — no key-name recursion ***', () => {
    const surface = contentSurfaceOf(planRecord())
    for (const k of METADATA_KEYS) assert.equal(k in surface, false, 'top-level metadata remained: ' + k)
    // the same names one level down are untouched
    const nested = contentSurfaceOf({ timestamp: 'T', payload: { timestamp: 'KEEP-ME', requestId: 'KEEP-ME-2', event: 'KEEP-ME-3' } })
    assert.equal('timestamp' in nested, false, 'top-level metadata is excluded')
    assert.deepEqual(nested.payload, { timestamp: 'KEEP-ME', requestId: 'KEEP-ME-2', event: 'KEEP-ME-3' },
      '⛔ nested keys were stripped by name')
  })

  test('every content field survives — only the four top-level keys leave', () => {
    const surface = contentSurfaceOf(planRecord())
    for (const k of ['outcome', 'reason', 'provider', 'droppedSentences', 'rankingClaims', 'dropped', 'keptItemCount', 'rankingGate']) {
      assert.ok(k in surface, '⛔ a content field was stripped: ' + k)
    }
  })

  test('*** ⛔ correlationId IS NOT EXEMPT — NO SPECULATIVE METADATA ***', () => {
    // An earlier version listed correlationId on the reasoning that a correlation id is
    // obviously machine-generated. Neither emitter these tests read emits one — it lives on
    // intakeOutcomeLog and intakeDiagnostics — so exempting it blinded the search to a field
    // these records can only carry as CONTENT.
    assert.equal(METADATA_KEYS.includes('correlationId'), false, '⛔ a speculative exemption returned')
    assert.equal(contentTextOf({ correlationId: 'Gordon', reason: 'x' }).includes('Gordon'), true,
      '⛔ a protected value in a top-level correlationId went unseen')
    assert.equal(contentTextOfLogLine('[X] {"correlationId":"Gordon"}').includes('Gordon'), true)
  })

  test('*** ⛔ EVERY EXEMPTION IS THE PROVEN SET, AND ONLY IT ***', () => {
    // answerPlan.js:391 and publicQueryEgressPlanner.js:282 — event · timestamp · requestId.
    assert.deepEqual([...METADATA_KEYS].sort(), ['event', 'requestId', 'timestamp'])
    for (const k of ['timestamp', 'requestId', 'event']) {
      assert.equal(contentTextOf({ [k]: 'Gordon' }).includes('Gordon'), false, k + ' must be excluded at top level')
      assert.equal(contentTextOf({ payload: { [k]: 'Gordon' } }).includes('Gordon'), true, 'nested ' + k + ' must stay searchable')
    }
  })

  test('*** ⛔ NO CONTENT-BEARING NAME IS EXEMPT ***', () => {
    for (const k of ['reason', 'outcome', 'query', 'detail', 'message', 'shape', 'why', 'sourceId', 'provider']) {
      assert.equal(METADATA_KEYS.includes(k), false, '⛔ a content field was exempted: ' + k)
    }
    assert.ok(METADATA_KEYS.length <= 4, 'metadata keys: ' + METADATA_KEYS.length)
  })

  test('*** ⛔ AN UNPARSEABLE LINE IS SEARCHED IN FULL — fail safe ***', () => {
    for (const l of ['plain text 8.72 here', '[TAG] not json at all 69', '']) {
      assert.equal(contentTextOfLogLine(l), l, '⛔ an unrecognised line was trimmed')
    }
    // a JSON array payload is not an emitter record either — left alone
    const arr = '[X] [{"a":1}]'
    assert.equal(contentTextOfLogLine(arr), arr)
  })

  test('multiple captured lines are projected independently', () => {
    const out = contentTextOfLogLines([
      '[A] {"timestamp":"2026-08-22T20:15:18.723Z","rawQueryDiscarded":true}',
      '[B] {"timestamp":"2026-01-01T00:00:00.000Z","query":"beef 8.72"}'
    ])
    assert.equal(out.includes('8.72'), true, 'the real leak in line B is found')
    assert.ok(out.includes('[A]') && out.includes('[B]'))
  })
})
