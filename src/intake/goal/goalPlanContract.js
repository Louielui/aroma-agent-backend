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
  operationEntry, operationNames, entityTypes, fieldTier, FIELD_TIER
} = require('./operationCatalogue')

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
  UNOBSERVED_FIELD: 'the_endpoint_returned_no_rows_so_this_field_is_unobserved'
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
    required: ['question_restated', 'facts', 'joins'],
    properties: {
      question_restated: { type: 'string', description: '你理解到嘅問題，用一句講返。Owner 會用呢句捉錯意。' },
      facts: {
        type: 'array', maxItems: MAX_FACTS, minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'need', 'operation', 'entity', 'fields'],
          properties: {
            id: { type: 'string' },
            need: { type: 'string', description: '呢個 fact 要答嘅係咩' },
            // ⛔ null is a first-class answer: 「nothing here carries this」.
            operation: { type: ['string', 'null'], enum: operationNames().concat([null]) },
            entity: { type: ['string', 'null'], enum: entityTypes().concat([null]) },
            fields: { type: 'array', items: { type: 'string' }, maxItems: 8 }
          }
        }
      },
      joins: {
        type: 'array', maxItems: 3,
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
  const base = { id: String(fact.id || ''), need: String(fact.need || ''), operation: fact.operation || null, entity: fact.entity || null, fields: Array.isArray(fact.fields) ? fact.fields : [] }

  // ⛔ RULE 1, first half. No operation named ⇒ nothing in this system carries it. The
  // absence of an enum member decides this, not the model's judgement.
  if (!base.operation) return Object.assign({}, base, { status: STATUS.UNAVAILABLE, reason: REASON.NO_OPERATION })

  const entry = operationEntry(base.operation)
  if (!entry) return Object.assign({}, base, { status: STATUS.UNAVAILABLE, reason: REASON.UNKNOWN_OPERATION })

  // ⛔ RULE 1, second half — the anti-substitution check. Asking `invoices` for a costing
  // fact fails here, on the entity, without anyone reading the need.
  if (base.entity && entry.entityType && base.entity !== entry.entityType) {
    return Object.assign({}, base, { status: STATUS.UNAVAILABLE, reason: REASON.ENTITY_MISMATCH, detail: base.operation + ' produces ' + entry.entityType })
  }

  if (!base.fields.length) return Object.assign({}, base, { status: STATUS.UNAVAILABLE, reason: REASON.NO_FIELDS })

  const tiers = base.fields.map((f) => ({ field: f, tier: fieldTier(base.operation, f) }))
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
 * Judge a raw decomposer plan.
 * @returns {{ok:boolean, reason?:string, plan?:object}}
 */
function judgeGoalPlan (raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.facts)) {
    return { ok: false, reason: PLAN_REFUSED.NOT_AN_OBJECT }
  }
  // ⛔ REFUSED, NOT TRUNCATED. Silently dropping the fifth fact would report a bounded plan
  // that never was, and 「no silent caps」 is a rule this project already paid for.
  if (raw.facts.length > MAX_FACTS) return { ok: false, reason: PLAN_REFUSED.TOO_MANY_FACTS }
  if (raw.facts.length === 0) return { ok: false, reason: PLAN_REFUSED.NO_FACTS }

  const facts = raw.facts.map(judgeFact)
  const joins = (Array.isArray(raw.joins) ? raw.joins : []).map(judgeJoin)
  const hazards = scopeHazards(facts)

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

  return {
    ok: true,
    plan: Object.freeze({
      questionRestated: String(raw.question_restated || ''),
      facts: Object.freeze(facts),
      joins: Object.freeze(joins),
      scopeHazards: Object.freeze(hazards),
      sufficient,
      missing: Object.freeze(missing),
      /** What A may actually read: available facts only, capped at the read bound. */
      reads: Object.freeze(facts.filter((f) => f.status === STATUS.AVAILABLE).map((f) => f.operation))
    })
  }
}

module.exports = {
  MAX_FACTS, STATUS, REASON, JOIN_STATUS, PLAN_REFUSED,
  goalPlanSchema, judgeGoalPlan, judgeFact, judgeJoin, scopeHazards
}
