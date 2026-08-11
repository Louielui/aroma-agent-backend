'use strict'

/**
 * operationCatalogue.js — WHAT THE DECOMPOSER IS ALLOWED TO KNOW ABOUT.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THIS FILE DESCRIBES NOTHING. IT ONLY ASSEMBLES.
 *
 * Every fact here comes from a table that already existed and is already the single
 * declaration of its subject:
 *
 *   which operations exist   readOperations.AROMA_OPERATIONS   (closed, frozen)
 *   what each row IS         aromaSystemRead.ENTITY_OF
 *   what its numbers MEAN    aromaSystemRead.METRICS_OF        (measured 2026-08-03)
 *   what a row carries       aromaSystemRead.ROW_SHAPE
 *   which rows were selected aromaSystemRead.QUERY_SCOPE
 *   how many, at most        aromaSystemRead.SERVER_LIMITS
 *
 * Re-describing any of them here would be a second vocabulary, which is HR-58 exactly.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── ⛔ AND THE HONEST GAP, STATED RATHER THAN PAPERED OVER ───────────────────
 *
 * THERE IS NO PER-ENDPOINT FIELD MAP IN THIS CODEBASE. `METRICS_OF` covers the NUMBERS an
 * endpoint carries and nothing else — `suppliers` has no metrics at all, which does not mean a
 * supplier row has no fields. The id / title / date lists in `aromaSystemRead` are CROSS-endpoint
 * candidate lists: they say 「some endpoint spells it this way」, never 「this endpoint has it」.
 *
 * So the catalogue publishes two tiers, and the difference is the whole point:
 *
 *   VERIFIED    a metric named for THIS endpoint, measured against the live API 2026-08-03
 *   CANDIDATE   an id/title/date spelling that exists SOMEWHERE — unverified for this endpoint
 *
 * A candidate field can never make a fact AVAILABLE. That is not pessimism: `invoices.supplierId`
 * is present, correctly typed, and empty in production (HR-56), so 「the field name exists」 has
 * already produced one confident wrong answer in this system.
 *
 * Closing this gap is one captured response per endpoint. Until that capture exists, the
 * catalogue says CANDIDATE and means it.
 */

const { AROMA_OPERATIONS } = require('../../context/readOperations')
const {
  METRICS_OF, ENTITY_OF, ROW_SHAPE, QUERY_SCOPE, SERVER_LIMITS, LIMIT_KNOWN
} = require('../../context/adapters/aromaSystemRead')
const { CAPTURED, CAPTURED_ON } = require('./capturedShapes')

/**
 * intent key → the endpoint key the descriptor tables are keyed by.
 *
 * ⛔ DECLARED, NOT DERIVED. `'list' + capitalise(endpointKey)` happens to reproduce all six
 * today, and a transformation cannot be checked against a captured response while a list can —
 * the reasoning `aromaSystemRead` already gives for spelling out its field lists. A drift test
 * asserts every operation resolves and every key exists in every table.
 */
const ENDPOINT_OF_INTENT = Object.freeze({
  inventory: 'inventory',
  supplier: 'suppliers',
  daily_count: 'dailyCounts',
  order_planning: 'orderPlanning',
  purchase_order: 'purchaseOrders',
  invoice: 'invoices'
})

/** Spellings that exist on SOME endpoint. Unverified for any particular one. */
const CANDIDATE_FIELDS = Object.freeze([
  'id', 'ingredientId', 'ingredient_id', 'supplierId', 'supplier_id',
  'poId', 'po_id', 'invoiceId', 'invoice_id', 'submissionId', 'submission_id',
  'name', 'title', 'ingredientName', 'ingredient_name',
  'poNumber', 'po_number', 'invoiceNumber', 'invoice_number',
  'rawVendorName', 'raw_vendor_name', 'supplierName', 'supplier_name',
  'locationName', 'location_name',
  'date', 'invoiceDate', 'invoice_date', 'orderDate', 'order_date',
  'submittedAt', 'submitted_at', 'countedAt', 'counted_at', 'createdAt', 'created_at'
])

/**
 * ⛔ FIVE TIERS, BECAUSE 「CANDIDATE」 WAS HIDING THREE DIFFERENT STATES.
 *
 * > **Owner: 「Some CANDIDATEs are candidates because of what that table was built for, not
 * > because the field is uncertain. 『verified present』 and 『never had a place to be recorded』
 * > are different states and both are currently spelled CANDIDATE.」**
 *
 * He was right, and the capture separated them:
 *
 *   VERIFIED        a metric named for this endpoint in METRICS_OF
 *   PRESENT         the capture saw it on this endpoint, carrying values. It was only ever a
 *                   CANDIDATE because METRICS_OF holds NUMBERS — `supplier_name` was never
 *                   uncertain, it just had nowhere to be recorded
 *   ALWAYS_EMPTY    the capture saw it on every row and it was empty on every row. Present,
 *                   correctly typed, and carrying nothing — `invoices.supplierId` exactly
 *   UNOBSERVED      the endpoint returned no rows, so nothing about its fields was learned.
 *                   Not evidence of absence
 *   CANDIDATE       a spelling that exists on some OTHER endpoint. Still a guess here
 *   UNKNOWN         neither named nor seen
 */
const FIELD_TIER = Object.freeze({
  VERIFIED: 'VERIFIED',
  PRESENT: 'PRESENT',
  /** Populated on some rows, few enough that an answer built on it speaks for almost nobody. */
  SPARSE: 'SPARSE',
  /** Populated on a real share of rows but not all. Usable — with the ratio stated. */
  PARTIAL_COVERAGE: 'PARTIAL_COVERAGE',
  ALWAYS_EMPTY: 'ALWAYS_EMPTY',
  UNOBSERVED: 'UNOBSERVED',
  CANDIDATE: 'CANDIDATE',
  UNKNOWN: 'UNKNOWN'
})

/**
 * ⛔ THE TWO CUTS ARE PROPOSED, NOT SETTLED — Owner ruling pending.
 *
 * > **Owner: 「3/36 and 55/55 cannot share a label. Propose the threshold rather than picking
 * > one, and say what it costs to get wrong in each direction.」**
 *
 * The real defence is not the cut. It is that `coverage` TRAVELS with every field regardless of
 * which side of a line it lands on, so a plan can say 「32 of 55 carry a pack size」 instead of
 * a label that has already discarded the number. A single boolean was the mistake; two booleans
 * would be a smaller version of the same mistake.
 *
 * Measured coverage across the six endpoints, which is what these cuts were set against:
 *
 *   0%     suppliers.cutoffTime, dailyCounts.dueDate, dailyCounts.items
 *   6%     purchaseOrders.items[].supplierItemName   (13 of 207)
 *   8%     suppliers.email                           (3 of 36)
 *   9%     orderPlanning.latest_price                (5 of 55)  ← the unpriced-ingredient gap
 *   11%    suppliers.minimumOrderValue               (4 of 36)
 *   31–58% orderLeadDays, deliveryDays, preferredOrderMethod, pack_size
 *   72–96% phone, purchase_unit, supplier_id, supplier_name
 *   97–100% parLevel, live_qty, incoming_qty, and every identifier
 *
 * There is a natural gap between 11% and 31%, and another between 58% and 72%. The proposed
 * cuts sit in those gaps rather than on round numbers.
 *
 * ⛔ COST OF GETTING SPARSE_MAX TOO LOW: `suppliers.email` at 8% rates usable, a plan reaches for
 * 「email the supplier」, and the answer speaks confidently for 3 of 36 suppliers. That is the
 * `invoices.supplierId` failure — a confident answer from a column that is empty for almost
 * everyone (HR-56).
 *
 * ⛔ COST OF GETTING IT TOO HIGH: `pack_size` at 58% rates unusable, B refuses to plan around it,
 * and the system says 「cannot answer」 about something it could answer for most items. That is
 * two weeks of correct work producing nothing usable — the failure the Owner is actually living
 * with, and the more expensive one right now.
 *
 * So the cuts are deliberately asymmetric: SPARSE is drawn LOW, to catch only the fields that are
 * effectively absent, and everything between is allowed through carrying its ratio.
 */
const SPARSE_MAX = 0.20
const DENSE_MIN = 0.90

/**
 * ⛔ KNOWN LIMIT OF THIS MEASURE, FOUND WHILE PROPOSING IT AND NOT YET FIXED.
 *
 * `nonEmpty` counts a field as carrying something when it is not null, undefined, '' or [].
 * Every quantity on these endpoints is a STRING, so `'0.0000'` counts as carrying something.
 *
 * Measured: `orderPlanning.incoming_qty` is non-empty on 55 of 55 rows and NUMERICALLY ZERO on
 * 47 of them. It rates PRESENT at 100%, and for 85% of rows it says 「nothing is on the way」.
 *
 * That is not the same failure as ALWAYS_EMPTY or SPARSE and it is not covered here. A third
 * question — 「how many rows carry a value that MEANS something」 — needs the numeric zero
 * separated from the absent, and only for fields that are quantities.
 *
 * ⛔ It is written down rather than fixed because the Owner asked for a report and a stop, and
 * because a coverage number that silently changed meaning between two rounds would be worse
 * than one with a stated hole in it.
 */
const COVERAGE_COUNTS_STRING_ZERO_AS_PRESENT = true

/** When the metric tables were measured against the live API. Carried, not assumed. */
const METRICS_MEASURED_ON = '2026-08-03'

function entryFor (op) {
  const key = ENDPOINT_OF_INTENT[op.intentKey]
  const metrics = (key && METRICS_OF[key]) || {}
  return Object.freeze({
    operation: op.operation,
    label: op.label,
    entityType: (key && ENTITY_OF[key]) || null,
    /** The numbers this endpoint carries, and what each one MEANS. */
    metricFields: Object.freeze(Object.keys(metrics).map((f) => Object.freeze({
      name: f, label: metrics[f].label, meaning: metrics[f].meaning, measuredOn: METRICS_MEASURED_ON
    }))),
    rowShape: (key && ROW_SHAPE[key]) || null,
    queryScope: (key && QUERY_SCOPE[key]) || null,
    serverLimit: key ? SERVER_LIMITS[key] : undefined,
    limitKnown: key ? LIMIT_KNOWN[key] === true : false
  })
}

/** The whole catalogue, frozen. */
function buildCatalogue () {
  return Object.freeze(AROMA_OPERATIONS.map(entryFor))
}

const CATALOGUE = buildCatalogue()

const operationEntry = (operation) => CATALOGUE.find((e) => e.operation === operation) || null

/** Every operation name the decomposer may use. This IS the schema enum. */
const operationNames = () => CATALOGUE.map((e) => e.operation)

/** Every entity type the six operations produce. There is no cost entity, and that matters. */
const entityTypes = () => Array.from(new Set(CATALOGUE.map((e) => e.entityType).filter(Boolean)))

/**
 * Which tier a field name sits in FOR THIS OPERATION.
 * ⛔ VERIFIED requires the metric to be named for this endpoint — never for a neighbour.
 */
function fieldTier (operation, field) {
  const e = operationEntry(operation)
  if (!e || typeof field !== 'string' || !field.trim()) return FIELD_TIER.UNKNOWN
  if (e.metricFields.some((m) => m.name === field)) return FIELD_TIER.VERIFIED

  // ⛔ THE CAPTURE OUTRANKS THE GUESS, IN BOTH DIRECTIONS. It can promote a field the tables
  // never had room for, and it can demote one that is present on every row and empty on every
  // row — which no list of names could ever have told us.
  const seen = capturedFieldsFor(operation)
  if (seen) {
    const hit = seen.fields.find((f) => f.name === field)
    if (hit) {
      if (hit.nonEmpty === 0) return FIELD_TIER.ALWAYS_EMPTY
      const coverage = hit.present > 0 ? hit.nonEmpty / hit.present : 0
      if (coverage < SPARSE_MAX) return FIELD_TIER.SPARSE
      if (coverage < DENSE_MIN) return FIELD_TIER.PARTIAL_COVERAGE
      return FIELD_TIER.PRESENT
    }
    // Rows came back and this field was not among them: absence is now measured, not assumed.
    if (seen.rowsSeen > 0) return FIELD_TIER.UNKNOWN
    return FIELD_TIER.UNOBSERVED
  }

  if (CANDIDATE_FIELDS.includes(field)) return FIELD_TIER.CANDIDATE
  return FIELD_TIER.UNKNOWN
}

/**
 * The measured fill ratio for a field, or null when unmeasured.
 * ⛔ THIS TRAVELS WITH THE FACT whichever side of a threshold it falls on — the label is a
 * convenience and the ratio is the fact.
 */
function coverageOf (operation, field) {
  const seen = capturedFieldsFor(operation)
  const hit = seen && seen.fields.find((f) => f.name === field)
  if (!hit || !hit.present) return null
  return { nonEmpty: hit.nonEmpty, present: hit.present, ratio: hit.nonEmpty / hit.present }
}

/** What the capture saw for this operation, or null if the operation is not mapped. */
function capturedFieldsFor (operation) {
  const op = AROMA_OPERATIONS.find((o) => o.operation === operation)
  const key = op && ENDPOINT_OF_INTENT[op.intentKey]
  return (key && CAPTURED[key]) || null
}

/**
 * The measured fill ratio for a field, or null when unmeasured.
 *
 * ⛔ THIS TRAVELS WITH THE FACT whichever side of a threshold it lands on. The label is a
 * convenience; the ratio is the fact. 「32 of 55 carry a pack size」 is something an answer can
 * be honest about — `PARTIAL_COVERAGE` on its own has already thrown that away.
 */
function coverageOf (operation, field) {
  const seen = capturedFieldsFor(operation)
  const hit = seen && seen.fields.find((f) => f.name === field)
  if (!hit || !hit.present) return null
  return Object.freeze({ nonEmpty: hit.nonEmpty, present: hit.present, ratio: hit.nonEmpty / hit.present })
}

/** The element shape of an array field, from the second capture. `null` when never described. */
function arrayShapeOf (operation, field) {
  const seen = capturedFieldsFor(operation)
  return (seen && seen.arrays && seen.arrays[field]) || null
}

/**
 * The catalogue as the model receives it — compact, generated, no prose.
 * ⛔ NO ROWS. The decomposer plans against shapes and never sees data.
 */
function catalogueForPrompt () {
  return CATALOGUE.map((e) => ({
    operation: e.operation,
    label: e.label,
    entity: e.entityType,
    numbers: e.metricFields.map((m) => m.name + '(' + m.label + ')'),
    /**
     * ⛔ THE REAL FIELD NAMES, AND THE FIRST PAID RUN IS WHY THEY ARE HERE.
     *
     * Without them the decomposer had no names to name, so it described what it wanted in
     * prose — 「item identifier/name」, 「delivery/shipment status」 — and every fact was
     * refused as an unknown field. The plan was structurally correct and completely useless.
     *
     * ⛔ EMPTY ONES ARE LISTED AS EMPTY rather than hidden. A field that exists and never
     * carries anything is something the planner should be able to see and avoid, and hiding
     * it would just move the same surprise one layer later.
     */
    fields: (capturedFieldsFor(e.operation) || { fields: [] }).fields
      .map((f) => {
        // ⛔ THE MEASURED FILL RATIO, NOT A LABEL. A planner told 「sparse」 has to trust the
        // word; one told 「3/36」 can decide for itself whether that answers the question.
        if (f.nonEmpty === 0) return f.name + '(空)'
        if (f.nonEmpty < f.present) return f.name + '(' + f.nonEmpty + '/' + f.present + ')'
        return f.name
      }),
    /**
     * ⛔ WHAT IS INSIDE THE ARRAYS, because the decomposer asked before the capture did.
     * Purchase-order items turn out to carry `itemName` and NO ingredient id — so planning and
     * purchasing can only be matched by NAME, and a plan that assumes an id join is wrong.
     */
    arrays: Object.entries((capturedFieldsFor(e.operation) || { arrays: {} }).arrays || {})
      .reduce((acc, [name, a]) => {
        acc[name] = a.scalarElements > 0 && !a.fields.length
          ? 'scalars×' + a.elements
          : (a.elements === 0 ? '空' : a.fields.map((f) => f.name + (f.nonEmpty < f.present ? '(' + f.nonEmpty + '/' + f.present + ')' : '')).join(','))
        return acc
      }, {}),
    hasLocation: e.rowShape ? e.rowShape.hasLocation === true : null,
    hasTimestamp: e.rowShape ? e.rowShape.hasAsOf === true : null,
    note: e.rowShape ? e.rowShape.note : null,
    window: e.queryScope ? e.queryScope.window : null,
    limit: e.serverLimit === null ? 'none' : e.serverLimit
  }))
}

module.exports = {
  CATALOGUE,
  CANDIDATE_FIELDS,
  CAPTURED_ON,
  ENDPOINT_OF_INTENT,
  FIELD_TIER,
  SPARSE_MAX,
  DENSE_MIN,
  METRICS_MEASURED_ON,
  buildCatalogue,
  operationEntry,
  operationNames,
  entityTypes,
  fieldTier,
  coverageOf,
  arrayShapeOf,
  capturedFieldsFor,
  catalogueForPrompt
}
