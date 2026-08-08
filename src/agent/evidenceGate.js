'use strict'

/**
 * evidenceGate.js — refuse a conclusion built on evidence that declared itself partial.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⚠ DO NOT DELETE THIS FOR BEING NARROW. READ THIS PARAGRAPH FIRST.
 *
 * This catches ONE of the four wrong conclusions produced on 2026-08-05 — and it is the
 * FIRST one:
 *
 *     「Ruled out: they were already ordered — it is false, MEASURED, not assumed:
 *      incoming_qty > 0 on 0 of the 43 returned rows.」
 *
 * The 43 were the rows that had passed `WHERE projected_qty < par_level` — precisely the rows
 * whose incoming stock did NOT cover the shortfall. **Every row that would have answered
 * 「yes」 had been removed by the filter before the check ran.**
 *
 * And because that check appeared to eliminate the true cause, THREE FALSE ONES HAD TO BE
 * INVENTED to explain what was left: an INNER JOIN, a NULL comparison, and string coercion.
 * Each was plausible, each was written up with confidence, each was disproven by one
 * read-only query.
 *
 * **CATCHING THE FIRST WOULD HAVE PREVENTED ALL FOUR.** One-of-four is the wrong way to
 * count it. See HR-12.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── WHAT IT DOES NOT DO, STATED SO IT IS NOT MISTAKEN FOR MORE ───────────────
 * It does not detect an unmeasured assumption. Detecting an absence in reasoning is not
 * possible from a record — the INNER JOIN diagnosis had no marker anywhere, because nobody
 * had queried the view at all. **This gate is STRUCTURAL: it reads what the evidence says
 * about itself.** A test asserts that it passes the INNER JOIN case, so that its scope stays
 * visible rather than assumed.
 */

const GATE = Object.freeze({
  NO_EVIDENCE: 'NO_EVIDENCE',
  SAMPLE_TREATED_AS_WHOLE: 'SAMPLE_TREATED_AS_WHOLE',
  TRUNCATED: 'TRUNCATED',
  ABSENCE_AS_PROOF: 'ABSENCE_AS_PROOF',
  FILTER_CORRELATES_WITH_CLAIM: 'FILTER_CORRELATES_WITH_CLAIM'
})

/** Words that make a claim UNIVERSAL — the kind a partial read cannot support. */
const UNIVERSAL = /\b(all|every|none|no\s+\w+\s+(is|are|has|have))\b|全部|所有|一共|總共|冇任何|沒有任何|每一/i

function refuse (reason, detail) { return { ok: false, reason, detail } }

/**
 * @param {{ claim: string, evidence: object[], admitsLimitation?: boolean }} input
 * @returns {{ ok: boolean, reason?: string, detail?: string }}
 */
function checkEvidence ({ claim = '', evidence = [], admitsLimitation = false } = {}) {
  const rows = Array.isArray(evidence) ? evidence : []

  // A conclusion with nothing behind it is refused rather than passed. Silence is not
  // support, and "no evidence" is the state three of yesterday's causes were actually in.
  if (rows.length === 0) {
    return refuse(GATE.NO_EVIDENCE, 'a conclusion was drawn with no evidence attached')
  }

  // ── THE HR-12 CHECK, and the reason this file exists ──────────────────────
  // If the evidence was narrowed by a predicate over the SAME field the claim is about, the
  // check had no power: the rows that would have contradicted it were removed before it ran.
  // This is checked FIRST because it is the one that cost four diagnoses.
  for (const e of rows) {
    const filters = Array.isArray(e.filteredBy) ? e.filteredBy : []
    const concerns = Array.isArray(e.claimConcerns) ? e.claimConcerns : []
    if (!filters.length || !concerns.length) continue
    for (const f of filters) {
      for (const c of concerns) {
        // A filter naming the field the claim is about, OR a filter over a quantity the
        // claimed field feeds into (projected_qty = live + incoming).
        if (String(f).includes(c) || RELATED[c]?.some((r) => String(f).includes(r))) {
          return refuse(
            GATE.FILTER_CORRELATES_WITH_CLAIM,
            `the evidence was filtered by 「${f}」 and the claim is about 「${c}」 — the rows that ` +
            'would have contradicted it were removed before the check ran'
          )
        }
      }
    }
  }

  // ⛔ THE BLANKET BYPASS IS GONE. (Owner review, A1 final.)
  //
  // This used to read `if (admitsLimitation) return { ok: true }`, placed BEFORE every
  // truncation, sample and coverage check — so one caller-supplied boolean disabled the whole
  // contract. It was harmless only by the accident that nothing sets it, and 「harmless
  // because unwired」 is precisely the state that ends the day something gets wired.
  //
  // ⚠ WHAT IS LOST, STATED PLAINLY: a claim that HONESTLY names its own limitation
  // (「見到嘅 25 項入面…」) is now refused alongside one that does not. That is a real cost and
  // it is accepted deliberately, because the alternative is worse in a specific way — telling
  // truth from qualifier requires reading the sentence, and a gate that reads prose is a gate
  // that can be talked past.
  //
  // The parameter is still ACCEPTED and is now INERT, asserted by test. Removing it from the
  // signature would break callers silently; leaving it undocumented would let someone believe
  // it still does something. Inert-and-tested is the honest middle.
  //
  // THE FIX IS A STRUCTURALLY CLAIM-LOCAL SCOPE SIGNAL — a claim that carries which scope it
  // is about, checkable against the evidence's queryScope without reading a word of it. That
  // is a later phase and its own decision; it is NOT invented here.
  void admitsLimitation

  for (const e of rows) {
    if (e.truncated === true) {
      return refuse(GATE.TRUNCATED, 'the read was cut off by a cap; the number is a floor, not a total')
    }
    if (e.completeness === 'sample' && UNIVERSAL.test(claim)) {
      return refuse(
        GATE.SAMPLE_TREATED_AS_WHOLE,
        `a universal claim from a sample (${e.shownCount} of ${e.matchingTotal}) — say 「見到嘅 N 項入面」 instead`
      )
    }
    if (e.readState === 'NO_RELEVANT_RESULTS' && UNIVERSAL.test(claim)) {
      return refuse(
        GATE.ABSENCE_AS_PROOF,
        'the source was read and found nothing — that supports 「冇搵到」, never 「冇」'
      )
    }
    // ⛔ A1 FINAL — SOURCE-WIDE COVERAGE, NOT SCOPE COVERAGE.
    //
    // > **Owner: 「completeWithinScope=true means only: all rows matching the declared server
    // > query were returned without truncation. It does NOT mean: all records in the wider
    // > source were examined.」**
    //
    // The first cut of this rule passed a universal claim on `completeWithinScope === true`
    // alone, and a test of mine asserted that 14 purchase orders — complete within a THIRTY-DAY
    // window — supported 「所有採購單都已收貨」. Complete within a slice is not complete.
    //
    // ⛔ FAILS CLOSED, AND DELIBERATELY HARD. Universality over a source needs all four, and
    // every one is a structural fact rather than a reading of the sentence:
    //     completeWithinScope === true   nothing was truncated
    //     matchingTotal is a number      we know how many matched
    //     sourceTotal   is a number      we know how many exist
    //     matchingTotal === sourceTotal  the query covered the source
    // Today `sourceTotal` is null on every endpoint, so this refuses every unqualified
    // source-wide universal — which is the honest state, not an over-correction.
    //
    // ⚠ SCOPED universals (「過去 30 日所有採購單…」) are refused too, and that is a KNOWN COST.
    // Distinguishing them needs a claim-local scope signal. `admitsLimitation` is the obvious
    // candidate and it is NOT usable: it has no production setter anywhere, so it cannot be
    // shown to be claim-local. Per the Owner's instruction it is not expanded here; the gap
    // is reported instead.
    if (UNIVERSAL.test(claim)) {
      const covered = e.completeWithinScope === true &&
        Number.isFinite(e.matchingTotal) &&
        Number.isFinite(e.sourceTotal) &&
        e.matchingTotal === e.sourceTotal
      if (!covered) {
        const why = e.completeWithinScope !== true
          ? (e.completeWithinScope === false ? 'the server truncated the result' : 'completeness could not be established')
          : (!Number.isFinite(e.sourceTotal)
              ? 'the wider source total is unknown, so coverage of the source is not established'
              : `only ${e.matchingTotal} of ${e.sourceTotal} records were in scope`)
        return refuse(
          GATE.SAMPLE_TREATED_AS_WHOLE,
          `a universal claim, but ${why} — say what was read (「見到嘅 N 項入面」), never how many exist`
        )
      }
    }
  }

  return { ok: true }
}

/**
 * Fields that FEED a filtered quantity. `projected_qty = live_qty + incoming_qty`, so a
 * filter on projected_qty silently narrows any claim about incoming_qty — which is exactly
 * what happened and is not obvious from the field names alone.
 */
const RELATED = Object.freeze({
  incoming_qty: ['projected_qty'],
  live_qty: ['projected_qty'],
  current_stock: ['projected_qty']
})

module.exports = { checkEvidence, GATE }
