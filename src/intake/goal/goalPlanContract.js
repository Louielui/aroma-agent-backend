'use strict'

/**
 * goalPlanContract.js — the shape of a goal plan, and the SERVER's verdict on it.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE MODEL'S OWN STATUS FIELDS ARE READ AND THEN THROWN AWAY.
 *
 * The decomposer returns `status` and `sufficient`. Nothing downstream uses either: both are
 * RECOMPUTED here from the catalogue. A model that says 「AVAILABLE」 about an operation that
 * does not carry the field has stated an opinion, and an opinion is not a capability.
 *
 * This is what makes the three rules below STRUCTURAL rather than instructed. None of them is a
 * sentence in a prompt asking the model to be careful.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── ⛔ RULE 1 — NO NEAREST-NEIGHBOUR SUBSTITUTION ────────────────────────────
 *
 * The dangerous answer is not 「I cannot」. It is a costing question answered from `invoices`
 * because invoices are adjacent and have money on them — 「a plausible answer against the wrong
 * table」, HR-56, the instance that produced an answer rather than a failure.
 *
 * A prompt cannot prevent it: checking whether an operation truly serves a NEED means reading
 * the need, and a check that reads prose can be talked past.
 *
 * So the fact must name the ENTITY it is about, from the closed set the six operations actually
 * produce, and the server checks that entity against `ENTITY_OF` for the named operation. There
 * is no cost entity in that set. A costing need therefore cannot be expressed as an available
 * fact — not because the model declined to, but because **the vocabulary has no way to say it.**
 *
 * ── ⛔ RULE 2 — A FIELD NAME IS NOT A FIELD ──────────────────────────────────
 * VERIFIED (measured for this endpoint) can make a fact AVAILABLE. CANDIDATE (a spelling that
 * exists somewhere) can only make it PARTIAL. `invoices.supplierId` is present, correctly typed
 * and empty, which is exactly what a CANDIDATE is.
 *
 * ── ⛔ RULE 3 — A JOIN IS A HYPOTHESIS ───────────────────────────────────────
 * Declared, never traversed, until a captured response resolves it. And a join whose two sides
 * do not share a time basis cannot be reconciled at all — that is read off `rowShape.hasAsOf`,
 * not off the question.
 */

const {
  operationEntry, operationNames, entityTypes, fieldTier, coverageOf, FIELD_TIER,
  isSourceLevelOperation
} = require('./operationCatalogue')
const { executiveFrameSchema, judgeExecutiveFrame } = require('./executiveFrame')

/** ⛔ Matches the Owner's max-4-reads bound, expressed at plan time. */
const MAX_FACTS = 4

const STATUS = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  PARTIAL: 'PARTIAL',
  UNAVAILABLE: 'UNAVAILABLE'
})

const REASON = Object.freeze({
  NO_OPERATION: 'no_operation_in_this_system_carries_this',
  UNKNOWN_OPERATION: 'named_an_operation_that_does_not_exist',
  ENTITY_MISMATCH: 'the_named_operation_does_not_produce_this_kind_of_record',
  NO_FIELDS: 'no_field_was_named',
  UNKNOWN_FIELD: 'field_is_not_on_this_operation',
  UNVERIFIED_FIELD: 'field_exists_somewhere_but_is_unverified_here',
  /** Seen on every row of a real capture, and empty on every one of them. */
  ALWAYS_EMPTY_FIELD: 'field_is_present_on_this_operation_and_never_carries_a_value',
  /** The endpoint returned no rows, so nothing was learned. Not evidence of absence. */
  UNOBSERVED_FIELD: 'the_endpoint_returned_no_rows_so_this_field_is_unobserved',
  /** Populated on a small enough share of rows that an answer would speak for almost nobody. */
  SPARSE_FIELD: 'field_is_populated_on_too_few_rows_to_answer_from',
  /**
   * ⛔ C4. The source is real, connected and readable — and nobody has measured what a row
   * from it reliably carries. PARTIAL is therefore the honest ceiling: the read may be
   * planned, and no field-level claim rides on it.
   */
  SOURCE_LEVEL_NO_FIELD_PROOF: 'the_whole_source_can_be_read_but_its_row_fields_are_unmeasured'
})

const JOIN_STATUS = Object.freeze({ UNVERIFIED: 'UNVERIFIED', NO_SHARED_TIME_BASIS: 'NO_SHARED_TIME_BASIS' })

const PLAN_REFUSED = Object.freeze({
  NOT_AN_OBJECT: 'decomposer_returned_no_plan',
  TOO_MANY_FACTS: 'plan_exceeded_the_fact_bound',
  NO_FACTS: 'plan_named_no_facts'
})

/** The provider-side schema. Strict, closed enums, bounded output. */
function goalPlanSchema () {
  return {
    type: 'object',
    additionalProperties: false,
    /**
     * ⛔ X1 — `executive_frame` IS REQUIRED, AND `question_restated` STOPS BEING AN ORPHAN.
     *
     * Phase 0: `question_restated` has been produced on every decomposer call since B shipped
     * and read by NOTHING — the one sentence naming the Owner's problem, generated and then
     * discarded. It is the same call, the same round trip and the same model; what changes is
     * that the role is now asked what he is trying to ACCOMPLISH before it is asked which
     * facts that would take, and both answers now travel.
     */
    required: ['question_restated', 'executive_frame', 'facts', 'joins'],
    properties: {
      question_restated: { type: 'string', description: '你理解到嘅問題，用一句講返。Owner 會用呢句捉錯意。' },
      executive_frame: executiveFrameSchema(),
      facts: {
        /**
         * ⛔ NO `maxItems`/`minItems` HERE, AND THE REASON IS A MEASURED 400.
         *
         *   Claude API error 400: output_config.format.schema:
         *     For 'array' type, property 'maxItems' is not supported
         *
         * Anthropic rejects the whole request. OpenAI accepts it — which is why this passed
         * every harness run and failed 100% of production turns, in 265ms, silently falling
         * back to 「no opinion」. B never once worked on the provider 香香 actually uses.
         *
         * Nothing is lost by removing them: `judgeGoalPlan` ALREADY enforces both bounds and
         * is the authoritative check — `TOO_MANY_FACTS` refuses (never truncates) and
         * `NO_FACTS` refuses an empty plan. The schema keywords were belt-and-braces on top of
         * a server-side rule, and this codebase's own principle is that the model proposes and
         * the server proves. The braces were the part that did not travel.
         */
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'need', 'operation', 'entity', 'fields', 'necessity'],
          properties: {
            id: { type: 'string' },
            need: { type: 'string', description: '呢個 fact 要答嘅係咩' },
            /**
             * ⛔ null is a first-class answer: 「nothing here carries this」 — and it is spelled
             * with `anyOf`, NOT a union type carrying an enum. Measured:
             *
             *   Claude API error 400: Invalid schema: Enum value 'aroma_system.inventory'
             *     does not match declared type '['string', 'null']'
             *
             * ⛔ THIS IS THE SAME DEFECT `a4Contract.js` ALREADY FIXED, at 237b732, whose
             * commit message reads 「anyOf, not a union type carrying an enum — the field that
             * 400s Claude」. B was written in parallel and repeated it. A rule that lives as a
             * comment in one file does not reach the author of the next (HR-66), and this is
             * that rule's fourth instance — the first one caught by the defect rather than by
             * anybody reading.
             *
             * anyOf is plain JSON Schema, accepted by both providers, and the accepted values
             * are unchanged.
             */
            operation: {
              anyOf: [
                { type: 'string', enum: operationNames() },
                { type: 'null' }
              ]
            },
            entity: {
              anyOf: [
                { type: 'string', enum: entityTypes() },
                { type: 'null' }
              ]
            },
            // ⛔ maxItems removed here too — same 400. Field lists are bounded by the closed
            // field vocabulary the judge checks against, not by a keyword the provider rejects.
            fields: { type: 'array', items: { type: 'string' } },
            /**
             * ⛔ THE ONE THING THE MODEL IS ALLOWED TO DECIDE, AND THE REASON IT IS ALLOWED.
             *
             * Availability is arithmetic and the judge owns it outright. NECESSITY is not:
             * whether 「有冇貨喺途中」 is answered by a quantity or wants the purchase order
             * behind it is a question about what was ASKED, and no table can settle it.
             *
             * So the model declares it, and the judge still applies redundancy arithmetic on
             * top — a required fact whose fields are all obtainable elsewhere is dropped
             * regardless of what it called itself. Only `required` facts become reads.
             */
            necessity: {
              type: 'string',
              enum: ['required', 'enriching'],
              description: 'required = 唔讀就答唔到；enriching = 讀咗會更詳細，但問題本身唔需要'
            }
          }
        }
      },
      joins: {
        // ⛔ and here — see the note on `facts` above.
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['from', 'to', 'on'],
          properties: {
            from: { type: 'string', enum: operationNames() },
            to: { type: 'string', enum: operationNames() },
            on: { type: 'string' }
          }
        }
      }
    }
  }
}

/** One fact, judged against the catalogue. The model's own opinion never reaches this. */
function judgeFact (fact) {
    // An absent or unrecognised necessity is treated as REQUIRED: a plan that forgets to say
  // must not quietly shrink to nothing.
  const necessity = fact.necessity === 'enriching' ? 'enriching' : 'required'
  const base = { id: String(fact.id || ''), need: String(fact.need || ''), operation: fact.operation || null, entity: fact.entity || null, fields: Array.isArray(fact.fields) ? fact.fields : [], necessity }

  // ⛔ RULE 1, first half. No operation named ⇒ nothing in this system carries it. The
  // absence of an enum member decides this, not the model's judgement.
  if (!base.operation) return Object.assign({}, base, { status: STATUS.UNAVAILABLE, reason: REASON.NO_OPERATION })

  /**
   * ⛔ C4 — CLASS B LEAVES BEFORE THE ARОМА JUDGE, AND THAT ORDER IS THE WHOLE SAFETY.
     *
   * A source-level operation has no catalogue entry, no entity and no measured fields, so
   * every check below would refuse it for the wrong reason — UNKNOWN_OPERATION, then
   * NO_FIELDS, then UNKNOWN_FIELD. Returning here means the Aroma rules never had to be
   * loosened to admit an external source: they are simply not the rules that apply.
     *
   * ⛔ PARTIAL, NEVER AVAILABLE. `sourcesForPlan` reads necessity and operation, so a
   * REQUIRED fact still keeps this source eligible for the turn; but nothing downstream is
   * told a field exists on it, because nothing has measured one.
     *
   * ⛔ AND IT IS STILL A CLOSED SET. Membership comes from the derived table, so `dropbox`,
   * `gmail2` and `aroma_system.fake` fall through to UNKNOWN_OPERATION exactly as before.
   */
  if (isSourceLevelOperation(base.operation)) {
    return Object.assign({}, base, {
      status: STATUS.PARTIAL,
      reason: REASON.SOURCE_LEVEL_NO_FIELD_PROOF,
      // Declared fields are not carried forward: an unmeasured name must not travel as
      // though the judge had checked it.
      fields: []
    })
  }

  const entry = operationEntry(base.operation)
  if (!entry) return Object.assign({}, base, { status: STATUS.UNAVAILABLE, reason: REASON.UNKNOWN_OPERATION })

  // ⛔ RULE 1, second half — the anti-substitution check. Asking `invoices` for a costing
  // fact fails here, on the entity, without anyone reading the need.
  if (base.entity && entry.entityType && base.entity !== entry.entityType) {
    return Object.assign({}, base, { status: STATUS.UNAVAILABLE, reason: REASON.ENTITY_MISMATCH, detail: base.operation + ' produces ' + entry.entityType })
  }

  if (!base.fields.length) return Object.assign({}, base, { status: STATUS.UNAVAILABLE, reason: REASON.NO_FIELDS })

  // ⛔ THE RATIO TRAVELS WITH EVERY FIELD, on both sides of every threshold. A caller that
  // wants to say 「32 of 55 carry a pack size」 must not have to re-derive it from a label.
  const tiers = base.fields.map((f) => ({ field: f, tier: fieldTier(base.operation, f), coverage: coverageOf(base.operation, f) }))
  const unknown = tiers.filter((t) => t.tier === FIELD_TIER.UNKNOWN)
  if (unknown.length) {
    return Object.assign({}, base, { status: STATUS.UNAVAILABLE, reason: REASON.UNKNOWN_FIELD, detail: unknown.map((u) => u.field).join(', '), fieldTiers: tiers })
  }

  // ⛔ RULE 2, AFTER THE CAPTURE. Three different ways a field can fail to be usable, and
  // they are no longer spelled the same. Each is PARTIAL — readable, but not something an
  // answer can stand on — and each says which one it is.
  const empty = tiers.filter((t) => t.tier === FIELD_TIER.ALWAYS_EMPTY)
  if (empty.length) {
    return Object.assign({}, base, { status: STATUS.PARTIAL, reason: REASON.ALWAYS_EMPTY_FIELD, detail: empty.map((c) => c.field).join(', '), fieldTiers: tiers })
  }
  // ⛔ SPARSE IS ALWAYS_EMPTY'S NEIGHBOUR. `suppliers.email` at 3 of 36 is not a contact
  // method; an answer built on it would speak confidently for 8% of suppliers and say nothing
  // about the other 92%. Capped at PARTIAL, with the measured ratio in the reason.
  const sparse = tiers.filter((t) => t.tier === FIELD_TIER.SPARSE)
  if (sparse.length) {
    return Object.assign({}, base, {
      status: STATUS.PARTIAL,
      reason: REASON.SPARSE_FIELD,
      detail: sparse.map((c) => c.field + ' ' + (c.coverage ? c.coverage.nonEmpty + '/' + c.coverage.present : '')).join(', '),
      fieldTiers: tiers
    })
  }
  const unobserved = tiers.filter((t) => t.tier === FIELD_TIER.UNOBSERVED)
  if (unobserved.length) {
    return Object.assign({}, base, { status: STATUS.PARTIAL, reason: REASON.UNOBSERVED_FIELD, detail: unobserved.map((c) => c.field).join(', '), fieldTiers: tiers })
  }
  const candidates = tiers.filter((t) => t.tier === FIELD_TIER.CANDIDATE)
  if (candidates.length) {
    return Object.assign({}, base, { status: STATUS.PARTIAL, reason: REASON.UNVERIFIED_FIELD, detail: candidates.map((c) => c.field).join(', '), fieldTiers: tiers })
  }

  return Object.assign({}, base, { status: STATUS.AVAILABLE, reason: null, fieldTiers: tiers })
}

/**
 * ⛔ RULE 3. Every join is a hypothesis, and one whose sides do not share a time basis is not
 * even that — it is two numbers that cannot be aligned. Read off `rowShape.hasAsOf`.
 */
function judgeJoin (join) {
  const from = operationEntry(join.from)
  const to = operationEntry(join.to)
  const timed = (e) => !!(e && e.rowShape && e.rowShape.hasAsOf === true)
  const shape = { from: join.from, to: join.to, on: String(join.on || '') }
  if (from && to && timed(from) !== timed(to)) {
    const untimed = timed(from) ? join.to : join.from
    return Object.assign({}, shape, {
      status: JOIN_STATUS.NO_SHARED_TIME_BASIS,
      detail: untimed + ' 冇時間戳，無法同一個有時間嘅記錄對齊'
    })
  }
  return Object.assign({}, shape, { status: JOIN_STATUS.UNVERIFIED, detail: '欄位名存在唔等於關係成立，要一次實際回應先證到' })
}

/** Scope hazards, computed from the tables. The model is never asked to notice these. */
function scopeHazards (facts) {
  const out = []
  for (const f of facts) {
    const e = f.operation ? operationEntry(f.operation) : null
    if (e && e.queryScope && e.queryScope.window) {
      out.push({ operation: f.operation, window: e.queryScope.window, detail: e.label + ' 只讀 ' + e.queryScope.window + '，更早嘅記錄唔喺範圍內' })
    }
  }
  return out
}

/**
 * ⛔ MINIMALITY, JUDGED — because a judge that does not care is why B over-plans.
 *
 * > **Owner: 「A plan carrying a redundant read scoring the same as a minimal one is the reason
 * > B over-plans, and no wording will fix a judge that does not care.」**
 *
 * Two things are arithmetic and both are enforced here:
 *
 *   1. READS ARE DISTINCT OPERATIONS. Three facts against order planning are ONE read.
 *   2. A READ MUST EARN ITS PLACE — it must contribute at least one field that no OTHER
 *      planned operation can supply. An operation whose entire field set is obtainable from
 *      another operation already in the plan is redundant, and saying so costs nothing.
 *
 * ⛔ AND ONE THING THAT IS NOT ARITHMETIC, STATED RATHER THAN PRETENDED.
 *
 * The Costco plan reads order planning AND purchasing. Purchasing genuinely carries fields
 * order planning does not — `poNumber`, `status`, `items` — so rule 2 does NOT flag it, and it
 * is right not to. The redundancy there is SEMANTIC: `incoming_qty` already answers 「有冇貨喺
 * 途中」, so the PO detail is enrichment rather than requirement.
 *
 * No field-overlap arithmetic can see that. Catching it needs a MEANING declared for
 * `incoming_qty` — which is a gap in the descriptor tables, not in this function and not in the
 * prompt. Recorded next to the semantic-zero hole, unfixed, and NOT worked around here.
 */
function judgeMinimality (facts) {
  // ⛔ ONLY REQUIRED FACTS BECOME READS. Enrichment is listed, never executed by default.
  const usable = facts.filter((f) => (f.status === STATUS.AVAILABLE || f.status === STATUS.PARTIAL) && f.necessity === 'required')
  const enriching = facts.filter((f) => f.necessity === 'enriching' && f.operation)
  const planned = []
  for (const f of usable) if (f.operation && !planned.includes(f.operation)) planned.push(f.operation)

  const fieldsNeededPer = {}
  for (const f of usable) {
    if (!f.operation) continue
    fieldsNeededPer[f.operation] = (fieldsNeededPer[f.operation] || []).concat(f.fields)
  }

  const redundant = []
  for (const op of planned) {
    const others = planned.filter((o) => o !== op)
    const needed = fieldsNeededPer[op] || []
    // Every field this read is for, obtainable from something else already being read?
    const elsewhere = needed.length > 0 && needed.every((field) =>
      others.some((o) => {
        const tier = fieldTier(o, field)
        return tier === FIELD_TIER.VERIFIED || tier === FIELD_TIER.PRESENT || tier === FIELD_TIER.PARTIAL_COVERAGE
      }))
    if (elsewhere) redundant.push(op)
  }

  const reads = Object.freeze(planned.filter((o) => !redundant.includes(o)))
  const enrichingReads = Object.freeze(
    Array.from(new Set(enriching.map((f) => f.operation))).filter((o) => !reads.includes(o)))
  return Object.freeze({
    reads,
    readCount: reads.length,
    /** ⛔ LISTED, NEVER EXECUTED BY DEFAULT. What a richer answer would have cost. */
    enrichingReads,
    factCount: facts.length,
    redundantReads: Object.freeze(redundant),
    /** ⛔ Every read that was dropped is named. A silent cap reads as coverage it never gave. */
    note: redundant.length
      ? redundant.join(', ') + ' 唔會讀：佢要嘅欄位，計劃入面另一個 operation 已經有'
      : null
  })
}

/**
 * ⛔ X2 — EXECUTIVE UNDERSTANDING IS JUDGED SEPARATELY FROM THE FACT PLAN.
 *
 * MEASURED, production f4ffa922 and 53e4b40d: the Cognitive Core returned a perfectly good
 * understanding and ZERO facts — the honest answer for a turn that needs no data at all —
 * and `plan_named_no_facts` threw the WHOLE result away, frame included. Two turns in a row
 * the Owner talked to a system that had understood him and then discarded the understanding.
 *
 * ⛔ AND THE FACT PLAN KEEPS ITS FAIL-CLOSED SEMANTICS EXACTLY. This returns understanding
 * BESIDE a refusal; it does not convert the refusal into an answer. `decomposeOnce` still
 * yields `null` for a refused plan, so `sourcesForPlan(null, …)` still narrows NOTHING and
 * the pre-B fallback still applies. Zero facts must never become 「the model proved no read
 * is needed」 — that would make an omission into an authority.
 */
function executiveUnderstandingOf (raw, judgedFrame) {
  const restated = String((raw && raw.question_restated) || '').trim()
  const frame = judgedFrame && judgedFrame.ok ? judgedFrame.frame : null
  if (!frame && !restated) return null
  return Object.freeze({
    questionRestated: restated || null,
    executiveFrame: frame,
    executiveFrameRefused: (judgedFrame && judgedFrame.ok) ? null : (judgedFrame ? judgedFrame.reason : null)
  })
}

/**
 * Judge a raw decomposer plan.
 * @returns {{ok:boolean, reason?:string, plan?:object}}
 */
function judgeGoalPlan (raw) {
  // ⛔ X2: judged FIRST, so a refused fact plan can still return what he was understood to want.
  const earlyFrame = judgeExecutiveFrame(raw && raw.executive_frame)
  const understanding = executiveUnderstandingOf(raw, earlyFrame)
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.facts)) {
    return { ok: false, reason: PLAN_REFUSED.NOT_AN_OBJECT, understanding }
  }
  // ⛔ REFUSED, NOT TRUNCATED. Silently dropping the fifth fact would report a bounded plan
  // that never was, and 「no silent caps」 is a rule this project already paid for.
  if (raw.facts.length > MAX_FACTS) return { ok: false, reason: PLAN_REFUSED.TOO_MANY_FACTS, understanding }
  if (raw.facts.length === 0) return { ok: false, reason: PLAN_REFUSED.NO_FACTS, understanding }

  const facts = raw.facts.map(judgeFact)
  const joins = (Array.isArray(raw.joins) ? raw.joins : []).map(judgeJoin)
  // ⛔ HAZARDS ARE ABOUT WHAT WILL ACTUALLY BE READ. A 30-day window on an ENRICHING read that
  // nobody is going to perform is not a limitation on the answer, and counting it would let an
  // optional extra drag a complete plan down to 「insufficient」.
  const hazards = scopeHazards(facts.filter((f) => f.necessity === 'required'))

  const missing = []
  for (const f of facts) {
    if (f.status === STATUS.UNAVAILABLE) missing.push(f.need + '（' + f.reason + (f.detail ? '：' + f.detail : '') + '）')
    else if (f.status === STATUS.PARTIAL) missing.push(f.need + '（' + f.reason + '：' + f.detail + '）')
  }
  for (const j of joins) missing.push(j.from + ' × ' + j.to + '：' + j.detail)
  for (const h of hazards) missing.push(h.detail)

  // ⛔ SUFFICIENT IS EARNED, NOT DECLARED. Every fact available, no unresolved join, no
  // hazard. The model's own `sufficient` never reaches this line.
  const sufficient = facts.every((f) => f.status === STATUS.AVAILABLE) && joins.length === 0 && hazards.length === 0
  const minimality = judgeMinimality(facts)
  const judgedFrame = earlyFrame

  return {
    ok: true,
    plan: Object.freeze({
      questionRestated: String(raw.question_restated || ''),
        /**
         * ⛔ FAIL-SOFT, AND THE FACTS DO NOT GO DOWN WITH IT. A frame that cannot be judged
         * becomes `null` and the fact plan proceeds under the rules it always had — X1 must
         * not become a new way for a working turn to fail. The reason travels beside it, so
         * 「the model returned nothing」 and 「the model invented an enum」 are not one line.
         */
        executiveFrame: judgedFrame.ok ? judgedFrame.frame : null,
        executiveFrameRefused: judgedFrame.ok ? null : judgedFrame.reason,
      facts: Object.freeze(facts),
      joins: Object.freeze(joins),
      scopeHazards: Object.freeze(hazards),
      sufficient,
      missing: Object.freeze(missing),
      /**
       * ⛔ DISTINCT OPERATIONS. Three facts against one endpoint are ONE read, and the
       * previous version returned it three times — a plan that looked three times as
       * expensive as it was, with a test of mine asserting the wrong answer.
       */
      reads: minimality.reads,
      minimality
    })
  }
}

module.exports = {
  MAX_FACTS, STATUS, REASON, JOIN_STATUS, PLAN_REFUSED,
  goalPlanSchema, judgeGoalPlan, judgeFact, judgeJoin, scopeHazards
}
