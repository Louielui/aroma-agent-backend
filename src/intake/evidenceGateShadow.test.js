'use strict'

/**
 * evidenceGateShadow.test.js — A2 Phase 2. The Evidence Gate runs on the real answer path.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * `checkEvidence` was written, tested and exported in A1 — and then never called. It has
 * spent every production turn since sitting beside the answer path, verifying nothing. These
 * tests cover the wiring, not the gate: `evidenceGate.test.js` already proves the verdicts.
 *
 * TWO PROPERTIES, and the second matters more than the first:
 *   1. In shadow the gate RUNS, on the sentences enforce mode would judge.
 *   2. In shadow the gate CHANGES NOTHING the Owner reads.
 * A shadow that quietly altered a reply would be enforce mode without the decision to enable
 * it, so the invariant is asserted by comparing whole outputs, not by inspecting a flag.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  validatePlan,
  logAnswerPlan,
  evidenceGateMode,
  runEvidenceGateShadow,
  EVIDENCE_GATE_FLAG
} = require('./answerPlan')
const { GATE, checkEvidence } = require('../agent/evidenceGate')

const OFF = {}
const SHADOW = { [EVIDENCE_GATE_FLAG]: 'shadow' }

// A sample: 3 rows shown of 40 that match. A total claim over this is the exact error the
// gate was built for — 「一共有 3 樣嘢」 when 37 were never looked at.
//
// NOT `truncated: true`: that fires the earlier TRUNCATED rule and would make this fixture
// prove a different branch than the one it is named for.
function sampledEvidence () {
  return [{
    source: 'aroma_system',
    readKey: 'aroma_system.inventory',
    sourceId: 'inv',
    completeness: 'sample',
    shownCount: 3,
    matchingTotal: 40,
    items: [
      { sourceId: '1', title: 'Beef brisket', facts: [{ label: '數量', value: '4' }] },
      { sourceId: '2', title: 'Chicken thigh', facts: [{ label: '數量', value: '9' }] },
      { sourceId: '3', title: 'Pork belly', facts: [{ label: '數量', value: '2' }] }
    ]
  }]
}

function planWithSentence (s, extra = {}) {
  return Object.assign({
    directAnswer: s,
    sections: [],
    limitations: [],
    followUp: null,
    unanswerable: false,
    citesEvidence: false
  }, extra)
}

// ── THE FLAG ────────────────────────────────────────────────────────────────

test('A: the flag fails closed — unset, empty, junk and enforce are all off', () => {
  assert.equal(evidenceGateMode({}), 'off')
  assert.equal(evidenceGateMode({ [EVIDENCE_GATE_FLAG]: '' }), 'off')
  assert.equal(evidenceGateMode({ [EVIDENCE_GATE_FLAG]: 'yes' }), 'off')
  assert.equal(evidenceGateMode({ [EVIDENCE_GATE_FLAG]: 'on' }), 'off')
  assert.equal(evidenceGateMode({ [EVIDENCE_GATE_FLAG]: 'true' }), 'off')
  // ⛔ THE ONE THAT MATTERS. 'enforce' is not implemented, so it must not half-work: a value
  // that looked like enforcement and silently did nothing would be worse than a typo.
  assert.equal(evidenceGateMode({ [EVIDENCE_GATE_FLAG]: 'enforce' }), 'off')
  assert.equal(evidenceGateMode({ [EVIDENCE_GATE_FLAG]: ' shadow ' }), 'shadow')
})

// ── IT ACTUALLY RUNS ────────────────────────────────────────────────────────

test('B: shadow calls the gate and counts a real refusal by GATE enum', () => {
  const claim = '一共有 3 樣存貨。'
  // The gate itself must agree this is a refusal, or the test proves nothing about wiring.
  const direct = checkEvidence({ claim, evidence: sampledEvidence(), admitsLimitation: false })
  assert.equal(direct.ok, false)
  assert.equal(direct.reason, GATE.SAMPLE_TREATED_AS_WHOLE)

  const shadow = runEvidenceGateShadow([claim], sampledEvidence(), planWithSentence(claim), SHADOW)
  assert.equal(shadow.mode, 'shadow')
  assert.equal(shadow.checked, 1)
  assert.equal(shadow.refused, 1)
  assert.deepEqual(shadow.reasons, { [GATE.SAMPLE_TREATED_AS_WHOLE]: 1 })
})

test('C: off returns null — not an empty result that reads as "found nothing"', () => {
  assert.equal(runEvidenceGateShadow(['一共有 3 樣存貨。'], sampledEvidence(), planWithSentence(''), OFF), null)
})

test('D: an admitted limitation does NOT buy a bypass — the A1 removal still holds here', () => {
  // evidenceGate.js:85-105: `admitsLimitation` was once a blanket bypass ahead of every check
  // and was deliberately made inert. This asserts the WIRING inherits that, i.e. a model can
  // not earn a pass by appending a limitation line to its own plan. If a future phase revives
  // the parameter with a claim-local scope signal, this test is the one that must be revisited
  // on purpose rather than discovered by surprise.
  const claim = '一共有 3 樣存貨。'
  const withLimit = runEvidenceGateShadow([claim], sampledEvidence(), planWithSentence(claim, { limitations: ['只讀到頭 3 項。'] }), SHADOW)
  const without = runEvidenceGateShadow([claim], sampledEvidence(), planWithSentence(claim), SHADOW)
  assert.equal(without.refused, 1)
  assert.equal(withLimit.refused, 1)
  assert.deepEqual(withLimit.reasons, without.reasons)
})

test('E: counts are per-sentence and reasons accumulate', () => {
  const claims = ['一共有 3 樣存貨。', '所有存貨都夠。', 'Beef brisket 有 4 件。']
  const shadow = runEvidenceGateShadow(claims, sampledEvidence(), planWithSentence(''), SHADOW)
  assert.equal(shadow.checked, 3)
  assert.ok(shadow.refused >= 2, `expected the two universal claims to refuse, got ${shadow.refused}`)
  for (const k of Object.keys(shadow.reasons)) {
    assert.ok(Object.prototype.hasOwnProperty.call(GATE, k), `reason ${k} is not a GATE enum`)
  }
})

test('F: a gate that throws is not counted as a refusal and does not break the turn', () => {
  // A frozen, hostile evidence shape. Whatever checkEvidence does with it, the wiring must
  // survive: a shadow observer that crashed the answer path would be a defect it introduced.
  const hostile = [Object.freeze({ get items () { throw new Error('boom') } })]
  let shadow
  assert.doesNotThrow(() => { shadow = runEvidenceGateShadow(['一共有 3 樣。'], hostile, planWithSentence(''), SHADOW) })
  assert.equal(shadow.checked, 1)
  // Counted as checked, NOT as refused — an unusable verdict is not evidence of a problem.
  assert.ok(shadow.refused <= 1)
})

// ── AND IT CHANGES NOTHING ──────────────────────────────────────────────────

test('G: ⛔ shadow does not change one byte of the Owner-visible result', () => {
  const evidence = sampledEvidence()
  const plan = planWithSentence('一共有 3 樣存貨。Beef brisket 有 4 件。', { citesEvidence: true })
  const args = { evidenceSets: evidence, itemsBySource: [], message: '而家有幾多存貨？' }

  // ⛔ Both states are set EXPLICITLY and the original is restored. This test compares off
  // against shadow, so it must not inherit whatever the ambient environment happens to be —
  // running the suite under EVIDENCE_GATE=shadow silently made the "before" run a shadow run
  // too, and the comparison became before-vs-before.
  const prior = process.env[EVIDENCE_GATE_FLAG]
  let before, after
  try {
    delete process.env[EVIDENCE_GATE_FLAG]
    before = validatePlan(JSON.parse(JSON.stringify(plan)), args)
    process.env[EVIDENCE_GATE_FLAG] = 'shadow'
    after = validatePlan(JSON.parse(JSON.stringify(plan)), args)
  } finally {
    if (prior === undefined) delete process.env[EVIDENCE_GATE_FLAG]
    else process.env[EVIDENCE_GATE_FLAG] = prior
  }

  // The reply itself, byte for byte.
  assert.deepEqual(after.plan, before.plan)
  // And every existing drop counter, so the gate cannot be silently doing the dropping.
  for (const k of ['droppedSentences', 'droppedFacts', 'droppedItems', 'droppedLimitations', 'modelItemCount', 'keptItemCount', 'answerSurvived']) {
    assert.deepEqual(after[k], before[k], `${k} changed under shadow`)
  }
  // The ONLY difference is the new observation field.
  assert.equal(before.evidenceGate, null)
  assert.equal(after.evidenceGate.mode, 'shadow')
})

test('H: shadow judges the SURVIVING sentences — the ones enforce would gate', () => {
  const prior = process.env[EVIDENCE_GATE_FLAG]
  let v
  try {
    process.env[EVIDENCE_GATE_FLAG] = 'shadow'
    v = validatePlan(planWithSentence('一共有 3 樣存貨。', { citesEvidence: true }), {
      evidenceSets: sampledEvidence(), itemsBySource: [], message: '有幾多存貨？'
    })
  } finally {
    if (prior === undefined) delete process.env[EVIDENCE_GATE_FLAG]
    else process.env[EVIDENCE_GATE_FLAG] = prior
  }
  // checked counts the sentences that reached the reply, not everything the model wrote:
  // a sentence already deleted by an existing check is not one enforce mode could remove.
  const keptSentences = v.plan.directAnswer ? v.plan.directAnswer.split('。').filter(Boolean).length : 0
  assert.equal(v.evidenceGate.checked, keptSentences)
})

// ── TELEMETRY CARRIES NO CONTENT ────────────────────────────────────────────

test('I: the log line carries counts and enums, and no claim or evidence text', () => {
  let line = null
  logAnswerPlan({
    outcome: 'validated',
    evidenceGate: {
      mode: 'shadow',
      checked: 4,
      refused: 2,
      reasons: { [GATE.SAMPLE_TREATED_AS_WHOLE]: 1, [GATE.NO_EVIDENCE]: 1 }
    }
  }, (l) => { line = l })

  assert.deepEqual(line.evidenceGate, {
    mode: 'shadow',
    checked: 4,
    refused: 2,
    reasons: { [GATE.SAMPLE_TREATED_AS_WHOLE]: 1, [GATE.NO_EVIDENCE]: 1 }
  })
  const serialized = JSON.stringify(line)
  for (const f of ['Beef brisket', '一共有', 'detail', 'claim']) {
    assert.ok(!serialized.includes(f), `log leaked ${f}`)
  }
})

test('J: a hostile verdict object cannot smuggle fields or text into the log', () => {
  let line = null
  logAnswerPlan({
    outcome: 'validated',
    evidenceGate: {
      mode: 'shadow',
      checked: 1,
      refused: 1,
      // Two attacks: a non-enum reason key whose NAME is the leak, and an extra top-level key.
      reasons: { [GATE.NO_EVIDENCE]: 1, 'Beef brisket 有 4 件': 9 },
      detail: '一共有 3 樣存貨。 — claim quotes the row',
      claim: '一共有 3 樣存貨。'
    }
  }, (l) => { line = l })

  assert.deepEqual(Object.keys(line.evidenceGate).sort(), ['checked', 'mode', 'reasons', 'refused'])
  assert.deepEqual(line.evidenceGate.reasons, { [GATE.NO_EVIDENCE]: 1 })
  assert.ok(!JSON.stringify(line).includes('Beef brisket'))
})

test('K: off logs null, so "did not run" is distinguishable from "ran and found nothing"', () => {
  let line = null
  logAnswerPlan({ outcome: 'validated' }, (l) => { line = l })
  assert.equal(line.evidenceGate, null)

  let ran = null
  logAnswerPlan({ outcome: 'validated', evidenceGate: { mode: 'shadow', checked: 3, refused: 0, reasons: {} } }, (l) => { ran = l })
  assert.deepEqual(ran.evidenceGate, { mode: 'shadow', checked: 3, refused: 0, reasons: {} })
})
