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

const FIELD_TIER = Object.freeze({ VERIFIED: 'VERIFIED', CANDIDATE: 'CANDIDATE', UNKNOWN: 'UNKNOWN' })

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
  if (CANDIDATE_FIELDS.includes(field)) return FIELD_TIER.CANDIDATE
  return FIELD_TIER.UNKNOWN
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
  ENDPOINT_OF_INTENT,
  FIELD_TIER,
  METRICS_MEASURED_ON,
  buildCatalogue,
  operationEntry,
  operationNames,
  entityTypes,
  fieldTier,
  catalogueForPrompt
}
