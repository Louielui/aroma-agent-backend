'use strict'

/**
 * evidenceGate.test.js — she cannot conclude from evidence that declared itself partial.
 *
 * ── THE HONEST SCOPE, AND WHY IT IS WORTH HAVING ANYWAY ──────────────────────
 * This does NOT detect an unmeasured assumption. Detecting an absence in reasoning is not
 * possible from a record. What it detects is narrower and structural: **a conclusion drawn
 * from evidence that says, in its own fields, that it is incomplete.**
 *
 * Tested honestly against yesterday's four wrong conclusions, it catches ONE:
 *
 *   ✓ 「ruled out: already ordered」 — checked incoming on the 43 RETURNED rows, a set
 *      produced by the very filter that had removed every row that would have said yes
 *   ✗ INNER JOIN drops rows       — needed a view definition nobody had queried
 *   ✗ NULL comparison             — same
 *   ✗ string coercion             — same
 *
 * ⚠ ONE OF FOUR IS NOT A WEAK RESULT. It is the FIRST one, and its false negative is what
 * made the other three necessary — three plausible causes had to be invented to explain what
 * was left after the true cause had been wrongly ruled out.
 *
 * **CATCHING IT WOULD HAVE PREVENTED ALL FOUR.** Do not delete this for being narrow.
 */

const { test, describe } = require('node:test')
const assert = require('node:assert')
const { checkEvidence, GATE } = require('./evidenceGate')

describe('the gate refuses a conclusion built on declared incompleteness', () => {
  test('a positive claim from a set the source called a SAMPLE is refused', () => {
    const r = checkEvidence({
      claim: '全部 43 項都冇在途貨。',
      evidence: [{ source: 'aroma_system', completeness: 'sample', totalCount: 199, shownCount: 25 }]
    })
    assert.strictEqual(r.ok, false)
    assert.strictEqual(r.reason, GATE.SAMPLE_TREATED_AS_WHOLE)
  })

  test('a claim from a TRUNCATED read is refused', () => {
    const r = checkEvidence({
      claim: '一共 50 份盤點。',
      evidence: [{ source: 'drive', truncated: true }]
    })
    assert.strictEqual(r.ok, false)
    assert.strictEqual(r.reason, GATE.TRUNCATED)
  })

  test('a POSITIVE claim supported by NO_RELEVANT_RESULTS is refused', () => {
    // "nothing was found" cannot support "there is none". The four read states exist
    // precisely because those are different sentences.
    const r = checkEvidence({
      claim: '冇任何一張發票超過 30 日。',
      evidence: [{ source: 'aroma_system', readState: 'NO_RELEVANT_RESULTS' }]
    })
    assert.strictEqual(r.ok, false)
    assert.strictEqual(r.reason, GATE.ABSENCE_AS_PROOF)
  })

  test('THE HR-12 CASE: a claim about a set whose FILTER removes the answer', () => {
    // The exact shape of "ruled out: they were already ordered" — checked incoming_qty on
    // rows selected by projected_qty < par_level, which had already excluded every row whose
    // incoming stock covered the shortfall.
    const r = checkEvidence({
      claim: 'incoming_qty > 0 on 0 of the 43 returned rows, so they were not already ordered.',
      evidence: [{
        source: 'aroma_system',
        filteredBy: ['projected_qty < par_level'],
        claimConcerns: ['incoming_qty']
      }]
    })
    assert.strictEqual(r.ok, false)
    assert.strictEqual(r.reason, GATE.FILTER_CORRELATES_WITH_CLAIM)
    assert.match(r.detail, /projected_qty|incoming/, 'the refusal must name the filter')
  })
})

describe('the gate lets honest conclusions through', () => {
  test('a complete read supports a claim about its own contents', () => {
    const r = checkEvidence({
      claim: '199 項材料入面，85 項冇安全存量。',
      evidence: [{ source: 'aroma_system', completeness: 'complete', truncated: false, readState: 'RESULTS_FOUND' }]
    })
    assert.strictEqual(r.ok, true)
  })

  test('a claim that ADMITS the limitation is allowed', () => {
    // Saying "of the 25 shown" is exactly what the gate wants; refusing it would teach
    // people to omit the qualifier rather than add it.
    const r = checkEvidence({
      claim: '見到嘅 25 項入面冇一項超過 30 日（總數 199，呢個係樣本）。',
      evidence: [{ source: 'aroma_system', completeness: 'sample', totalCount: 199, shownCount: 25 }],
      admitsLimitation: true
    })
    assert.strictEqual(r.ok, true)
  })

  test('no evidence at all is refused — not passed', () => {
    const r = checkEvidence({ claim: '成因係 X。', evidence: [] })
    assert.strictEqual(r.ok, false)
    assert.strictEqual(r.reason, GATE.NO_EVIDENCE)
  })
})

describe('what the gate does NOT claim to do', () => {
  test('it does not detect an unmeasured assumption with no marker in the record', () => {
    // Yesterday's INNER JOIN diagnosis. Nothing in the evidence declared a limitation,
    // because nobody had queried the view at all. The gate passes it, and MUST be honest
    // that it passes it rather than appearing to cover the case.
    const r = checkEvidence({
      claim: '成因係 INNER JOIN 跌咗 18 行。',
      evidence: [{ source: 'aroma_system', completeness: 'complete', readState: 'RESULTS_FOUND' }]
    })
    assert.strictEqual(r.ok, true, 'the gate is structural; it cannot see what was never queried')
    assert.ok(r.covers === undefined || !/reasoning/.test(String(r.covers)))
  })
})
