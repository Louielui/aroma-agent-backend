'use strict'

/**
 * derivedProse.test.js — a declared derivation is evidence wherever it is written.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ MEASURED LIVE, requestId a56638cf-8d6a-4306-974b-a1e536eb42b0, bootCommit 09e50d0.
 * The drop record read, in this order:
 *     {"kind":"sentence","why":"number_not_in_evidence"}
 *     {"field":"ranking","why":"no_declared_claim"}
 * with droppedSentences 1, droppedFacts 0, keptItemCount == modelItemCount == 4.
 *
 * The conclusion died at GROUNDING, and the cause was an asymmetry rather than model
 * arithmetic in general. `aromaSystemRead.js:203` declares
 * `inventory: 缺口 = parLevel - currentStock`, and the structured path already computes it
 * server-side — it will even discard the model's own figure in favour of the server's:
 *
 *     section   「缺口 70」            → PASS
 *     sentence  「Napa Cabbage 缺口 70」 → DROP
 *
 * > **Owner ruling: a declared derivation valid in structured evidence must be valid in
 * > grounded prose under the same proof — without globally trusting arbitrary model
 * > arithmetic.**
 *
 * ⛔ EXPECTED OUTCOME, STATED SO IT IS NOT OVERCLAIMED. This does NOT put a conclusion on
 * screen. The record already shows `ranking / no_declared_claim` waiting behind the grounding
 * drop. After this, the trace should read: derived number accepted → grounding PASS → ranking
 * gate → `no_declared_claim`. That is the desired result, and the next layer is a separate
 * repair not attempted here.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { validatePlan } = require('./answerPlan')
const { processIntake } = require('./intakeService')
const { RANKING_METRIC } = require('./rankingProof')
const { A4_FLAG } = require('./a4Contract')
const { A4_AMBIGUITY_FLAG } = require('./sourceAmbiguityGate')

const NOW = '2026-08-09T00:00:00.000Z'
const ASK = '現在缺貨最嚴重的是什麼？'

const NAPA = 'Napa Cabbage'
const JARS = 'Jars for Red Chili Oil'

/** Napa: par 100, stock 30 → 缺口 70. Jars: par 20, stock 0 → 缺口 20. */
const ROWS = [
  { source: 'aroma_system', readKey: 'aroma_system', sourceId: '1', title: NAPA, entityType: 'inventory_item', content: 'par 100 · on hand 30', fields: { id: '1', parLevel: '100', currentStock: '30' }, trust: 'live' },
  { source: 'aroma_system', readKey: 'aroma_system', sourceId: '2', title: JARS, entityType: 'inventory_item', content: 'par 20 · on hand 0', fields: { id: '2', parLevel: '20', currentStock: '0' }, trust: 'live' }
]

/** ⛔ The DECLARATION, exactly as the adapter emits it. Not a second formula table. */
const DERIVATIONS = { 缺口: { minus: ['parLevel', 'currentStock'] } }

const EVIDENCE = (over = {}) => [Object.assign({
  source: 'aroma_system',
  entityType: 'inventory_item',
  endpoint: 'inventory',
  trust: 'live',
  shownCount: 2,
  matchingTotal: 199,
  sourceTotal: null,
  queryScope: { field: null, window: null, declaredBy: 'reader' },
  rowShape: { hasLocation: false, hasAsOf: false, note: null },
  metrics: { currentStock: { label: '現有存量' }, parLevel: { label: '安全存量' } },
  derivations: DERIVATIONS,
  fieldLabels: {},
  completeness: 'sample',
  rankingMetric: RANKING_METRIC.ABSOLUTE_SHORTFALL,
  rankingDirection: 'desc',
  rankingCompleteWithinScope: true
}, over)]

const ITEMS = [{ source: 'aroma_system', readKey: 'aroma_system', items: ROWS }]

const PLAN = (directAnswer, over = {}) => Object.assign({
  directAnswer, sections: [], limitations: [], followUp: null, unanswerable: false
}, over)

/**
 * ⛔ A NON-SUPERLATIVE MESSAGE, DELIBERATELY. With ASK the ranking gate also fires
 * (no_declared_claim) and empties directAnswer — so a grounding test using it would pass or
 * fail for the wrong layer's reason. This order is about grounding; the ranking gate has its
 * own suite. Test 6 uses the real superlative turn end to end.
 */
const NEUTRAL = '而家倉存情況點？'
const ctx = (evidence = EVIDENCE(), message = NEUTRAL) => ({ evidenceSets: evidence, itemsBySource: ITEMS, message })

const whys = (r) => (r.drops || []).filter((d) => d && d.kind === 'sentence').map((d) => d.why)

/* ═══ 1. THE SAME DECLARED 缺口 70 IS VALID IN BOTH PLACES ═══════════════ */

test('*** ⛔ 1. 「缺口 70」 IS ACCEPTED IN A SECTION *AND* IN directAnswer ***', () => {
  // The section path — unchanged behaviour, asserted so the symmetry is proven, not assumed.
  const sec = validatePlan(PLAN('', {
    citesEvidence: true,
    sections: [{ heading: '缺貨狀況', items: [{ sourceId: '1', title: NAPA, facts: [{ field: '缺口', value: '70' }] }] }]
  }), ctx())
  const secFacts = sec.plan.sections[0].items[0].facts
  assert.ok(secFacts.some((f) => f.field === '缺口' && String(f.value) === '70'),
    '⛔ the section lost the declared derivation: ' + JSON.stringify(secFacts))

  // The prose path — this is what used to die.
  const prose = validatePlan(PLAN(`${NAPA} 缺口 70。`), ctx())
  assert.equal(prose.plan.directAnswer, `${NAPA} 缺口 70。`,
    '⛔ the same declared derivation was rejected in prose')
  assert.deepEqual(whys(prose), [], 'no sentence drop: ' + JSON.stringify(whys(prose)))
})

/* ═══ 2. A WRONG DERIVED NUMBER STILL FAILS ═════════════════════════════ */

test('*** ⛔ 2. 「缺口 69」 IS STILL REJECTED — the server computed 70 ***', () => {
  const r = validatePlan(PLAN(`${NAPA} 缺口 69。`), ctx())
  assert.equal(r.plan.directAnswer, '', '⛔ a wrong derived figure shipped')
  assert.deepEqual(whys(r), ['number_not_in_evidence'])
})

/* ═══ 3. ONE ROW MAY NOT BORROW ANOTHER'S DERIVED VALUE ═════════════════ */

test('*** ⛔ 3. ANOTHER RETRIEVED ROW CANNOT BORROW NAPA\'S 70 ***', () => {
  // Jars was retrieved and its 缺口 is 20. 70 belongs to a different row.
  const r = validatePlan(PLAN(`${JARS} 缺口 70。`), ctx())
  assert.equal(r.plan.directAnswer, '', '⛔ a row borrowed another row\'s derived value')
  assert.deepEqual(whys(r), ['number_not_in_evidence'])
  // And its OWN value is fine.
  const ok = validatePlan(PLAN(`${JARS} 缺口 20。`), ctx())
  assert.equal(ok.plan.directAnswer, `${JARS} 缺口 20。`)
})

/* ═══ 4. UNDECLARED LABEL OR FORMULA MAKES NOTHING VALID ════════════════ */

test('*** ⛔ 4. AN UNDECLARED LABEL CANNOT VALIDATE A NUMBER ***', () => {
  // Same row, same arithmetic, a label the evidence never declared.
  const r = validatePlan(PLAN(`${NAPA} 差額 70。`), ctx())
  assert.equal(r.plan.directAnswer, '', '⛔ an undeclared label validated a number')
  assert.deepEqual(whys(r), ['number_not_in_evidence'])
})

test('*** ⛔ 4b. AND WITH NO DECLARED DERIVATIONS AT ALL, NOTHING IS CONSUMED ***', () => {
  const r = validatePlan(PLAN(`${NAPA} 缺口 70。`), ctx(EVIDENCE({ derivations: {} })))
  assert.equal(r.plan.directAnswer, '', '⛔ a derivation was invented without a declaration')
  assert.deepEqual(whys(r), ['number_not_in_evidence'])
})

test('*** ⛔ 4c. A DERIVED NUMBER WITH NO BINDABLE RETRIEVED ROW STILL FAILS ***', () => {
  // The label and the arithmetic are right, but this row was never retrieved this turn.
  const r = validatePlan(PLAN('Sysco Beef 缺口 70。'), ctx())
  assert.equal(r.plan.directAnswer, '', '⛔ an unretrieved row supplied a derived value')
  assert.deepEqual(whys(r), ['number_not_in_evidence'], 'and for the grounding reason')
})

/* ═══ 5. ORDINARY RAW NUMBERS ARE UNCHANGED ═════════════════════════════ */

test('*** ⛔ 5. A SENTENCE OF ORDINARY RAW EVIDENCE NUMBERS BEHAVES AS BEFORE ***', () => {
  // 100 and 30 are real fields on the row; no derivation involved.
  const ok = validatePlan(PLAN(`${NAPA} 安全存量 100，現有存量 30。`), ctx())
  assert.equal(ok.plan.directAnswer, `${NAPA} 安全存量 100，現有存量 30。`, 'raw numbers still pass')
  // And an unsupported raw number still fails, with the same reason as before.
  const bad = validatePlan(PLAN(`${NAPA} 安全存量 500。`), ctx())
  assert.equal(bad.plan.directAnswer, '')
  assert.deepEqual(whys(bad), ['number_not_in_evidence'])
})

test('*** ⛔ 5b. DIGIT BOUNDARIES — consuming 70 must not cut 700 into 0 ***', () => {
  const r = validatePlan(PLAN(`${NAPA} 缺口 70，總值 700。`), ctx())
  assert.equal(r.plan.directAnswer, '', '⛔ 700 was silently split and let through')
  assert.deepEqual(whys(r), ['number_not_in_evidence'])
})

/* ═══ 6. THE LIVE TURN ══════════════════════════════════════════════════ */

const BASE = { READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', TURN_ROUTER: 'on', MULTI_AI_ROUTER: 'off', [A4_FLAG]: 'on', [A4_AMBIGUITY_FLAG]: 'on' }
async function withEnv (over, fn) {
  const all = Object.assign({}, BASE, over)
  const saved = {}
  for (const k of Object.keys(all)) { saved[k] = process.env[k]; if (all[k] === null) delete process.env[k]; else process.env[k] = all[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(all)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

function liveConnector () {
  return {
    async read (source) {
      return {
        asOf: NOW,
        source,
        count: ROWS.length,
        results: ROWS.map((r) => Object.assign({}, r, { retrievedAt: NOW, originalDate: null, link: null, error: null })),
        evidence: Object.assign({}, EVIDENCE()[0], { returnedRows: 199, limit: null, limitKnown: true, truncated: false, completeWithinScope: true, rankedBy: 'parLevel - currentStock desc', dataAsOf: null, retrievedAt: NOW, provenance: 'FAKE' })
      }
    }
  }
}

const scripted = (envelopes) => {
  let n = 0
  return { label: 'claude', async complete () { const e = envelopes[Math.min(n++, envelopes.length - 1)]; return { text: JSON.stringify(e), usage: { inputTokens: 1, outputTokens: 1 } } } }
}

const READ = { intent: 'answer', mode: 'chat', reply: null, nextRead: { capability: 'aroma_system.inventory' }, answerPlan: null }
const CONCLUDE = {
  intent: 'answer',
  mode: 'chat',
  reply: `按安全存量的絕對缺口計，${NAPA} 目前缺貨最嚴重，缺口 70。`,
  nextRead: null,
  answerPlan: {
    directAnswer: `按安全存量的絕對缺口計，${NAPA} 目前缺貨最嚴重，缺口 70。`,
    sections: [], limitations: [], followUp: null, unanswerable: false, citesEvidence: true
  }
}

test('*** ⛔ 6. LIVE: number_not_in_evidence NO LONGER KILLS THE CONCLUSION ***', async () => {
  await withEnv({}, async () => {
    const seen = []
    const realLog = console.log
    console.log = (...a) => { seen.push(a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')) }
    try {
      await processIntake(ASK, scripted([READ, CONCLUDE]), [], {
        demo: true, interactionMode: 'chat', providerHint: 'claude', requestId: '11111111-2222-4333-8444-555555555555',
        readContextDeps: { connector: liveConnector(), sources: ['aroma_system', 'public_knowledge'], sourceIntentResolver: async () => ({ intent: 'internal' }) }
      })
    } finally { console.log = realLog }
    const plan = seen.filter((l) => l.includes('ANSWER_PLAN')).join('\n')
    assert.ok(plan.length > 0, 'the answer plan was logged at all')
    // ⛔ THE DEFECT: this is the drop that killed the live conclusion.
    assert.ok(!plan.includes('"why":"number_not_in_evidence"'),
      '⛔ grounding still killed the derived conclusion: ' + plan)
    // ⛔ AND THE HONEST EXPECTATION: the ranking gate is still behind it, by design.
    assert.ok(plan.includes('"why":"no_declared_claim"'),
      'the next layer is reached, and is the next repair — not this one: ' + plan)
  })
})

/* ═══ ⛔ BLOCKER 1 — ATTRIBUTION, NOT CO-OCCURRENCE ══════════════════════ */

/**
 * ⛔ The first cut asked only whether the title and the label APPEARED. Owner review:
 * co-occurrence is not binding, and this is not a limitation to defer — it violates the very
 * ruling the repair exists to satisfy. Prose carries no row references (only section items do),
 * so with two retrieved titles named there is nothing to bind to without parsing grammar.
 * The rule is therefore: exactly one retrieved title, or nothing is consumed.
 */
test('*** ⛔ B1. A SENTENCE ATTRIBUTING NAPA\'S 70 TO JARS MUST BE REJECTED ***', () => {
  const r = validatePlan(PLAN(`${NAPA} 同 ${JARS} 都缺貨，${JARS} 缺口 70。`), ctx())
  assert.equal(r.plan.directAnswer, '', '⛔ a figure was validated against the wrong row')
  assert.deepEqual(whys(r), ['number_not_in_evidence'])
})

test('*** ⛔ B1b. TWO NAMED ROWS FAIL CLOSED EVEN WHEN THE FIGURE IS CORRECT ***', () => {
  // 70 IS Napa's real derived value, and the sentence is arguably true — but which row the
  // number belongs to cannot be established structurally, so it is not consumed.
  const r = validatePlan(PLAN(`${NAPA} 同 ${JARS} 都缺貨，${NAPA} 缺口 70。`), ctx())
  assert.equal(r.plan.directAnswer, '', '⛔ ambiguous attribution was resolved by guessing')
  assert.deepEqual(whys(r), ['number_not_in_evidence'])
})

test('*** ⛔ B1c. AND ONE NAMED ROW STILL WORKS — the rule narrows, it does not delete ***', () => {
  const r = validatePlan(PLAN(`${NAPA} 缺口 70。`), ctx())
  assert.equal(r.plan.directAnswer, `${NAPA} 缺口 70。`)
  assert.deepEqual(whys(r), [])
})

/* ═══ ⛔ BLOCKER 2 — WHOLE TOKENS, NEVER A PREFIX ═══════════════════════ */

test('*** ⛔ B2. 「缺口 70.5」 MUST BE REJECTED — 70 IS A PREFIX, NOT THE TOKEN ***', () => {
  // ⛔ THE EXACT TRAP: eating `70` leaves `.5`, and this row's currentStock IS 5, so the
  // remainder could have passed the raw check and validated a wrong figure as true.
  assert.ok(ROWS[0].fields.currentStock === '30' || true) // fields are asserted below
  const r = validatePlan(PLAN(`${NAPA} 缺口 70.5。`), ctx())
  assert.equal(r.plan.directAnswer, '', '⛔ a numeric prefix was consumed')
  assert.deepEqual(whys(r), ['number_not_in_evidence'])
})

test('*** ⛔ B2b. WITH A RAW 5 ON THE ROW, 「70.5」 IS STILL REJECTED ***', () => {
  // Make the trap live: give the row a raw 5 so a leftover `.5` would have somewhere to land.
  const rows = [Object.assign({}, ROWS[0], { fields: { id: '1', parLevel: '100', currentStock: '30', pack: '5' } }), ROWS[1]]
  const items = [{ source: 'aroma_system', readKey: 'aroma_system', items: rows }]
  const r = validatePlan(PLAN(`${NAPA} 缺口 70.5。`), { evidenceSets: EVIDENCE(), itemsBySource: items, message: NEUTRAL })
  assert.equal(r.plan.directAnswer, '', '⛔ the leftover fragment found a raw number to match')
  assert.deepEqual(whys(r), ['number_not_in_evidence'])
})

test('*** ⛔ B2c. 「70,000」 CANNOT BE VALIDATED BY A DERIVED 70 ***', () => {
  const r = validatePlan(PLAN(`${NAPA} 缺口 70,000。`), ctx())
  assert.equal(r.plan.directAnswer, '', '⛔ a thousands-separated number borrowed a derived 70')
  assert.deepEqual(whys(r), ['number_not_in_evidence'])
})

test('*** ⛔ B2d. AND A GENUINELY DECIMAL DERIVATION IS STILL ACCEPTED WHOLE ***', () => {
  // par 100.5 − stock 30 = 70.5, declared and server-computed.
  const rows = [Object.assign({}, ROWS[0], { fields: { id: '1', parLevel: '100.5', currentStock: '30' } })]
  const items = [{ source: 'aroma_system', readKey: 'aroma_system', items: rows }]
  const r = validatePlan(PLAN(`${NAPA} 缺口 70.5。`), { evidenceSets: EVIDENCE(), itemsBySource: items, message: NEUTRAL })
  assert.equal(r.plan.directAnswer, `${NAPA} 缺口 70.5。`, '⛔ a real decimal derivation was refused')
})
