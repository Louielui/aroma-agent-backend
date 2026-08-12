'use strict'

/**
 * capturedShapes.js — WHAT THE SIX ENDPOINTS ACTUALLY RETURNED. Two read-only captures,
 * 2026-08-11: top-level rows, then one level into every array.
 *
 * ⛔ NAMES, TYPES AND COUNTS ONLY. No value from the business is recorded here.
 * `present` = rows carrying the key. `nonEmpty` = rows carrying something other than
 * null/undefined/empty-string/empty-array. THE PAIR IS THE POINT: present=N nonEmpty=0 is a
 * different state from present=N nonEmpty=N, and only counts tell them apart.
 *
 * ⛔ THE SECOND CAPTURE EXISTS BECAUSE THE DECOMPOSER ASKED FOR IT FIRST. It flagged that
 * purchase-order items had no described schema while the shape table still said only
 * 「array, non-empty on 13 of 13」. What one level deeper found is that PO items carry
 * itemName and NO ingredient id — so order planning and purchasing can only be matched by
 * NAME, which is the spelling-match defect (HR-56) sitting in the join itself.
 */

/**
 * ── ⛔ PROVENANCE, ADDED AFTER THE FACT AND SAYING SO ────────────────────────
 *
 * THIS FILE WAS WRITTEN BEFORE ITS INSTRUMENT EXISTED. The script that produced it was never
 * committed, so for a week the data was in the repo and the thing that made it was not —
 * unrunnable, unauditable, and unable to answer its own most important question.
 *
 * The instrument now exists at `scripts/verify/captureShapes.js` and REPRODUCES this capture:
 * four of six endpoints match exactly; `purchaseOrders` 13→14 and `orderPlanning` 55→37 are
 * live data moving between reads, not instrument drift.
 *
 * ⛔ `invoices: rowsSeen 0` WAS THE OPEN QUESTION AND IT IS NOW ANSWERED BY MEASUREMENT.
 * A read-only probe on 2026-08-11 returned `{"success":true,"count":0,"data":[]}` on HTTP 200 —
 * the server's own count agrees. So this is 「no rows were returned, so no fields were observed」,
 * a fact. It is NOT 「this endpoint has no fields」, which is a claim nothing here can support,
 * and which `operationCatalogue` correctly spells `UNOBSERVED` rather than asserting.
 *
 * ⚠ BUT THAT GUARANTEE IS CONFIRMED BY HAND, NOT BY CONSTRUCTION. The new instrument refuses to
 * write anything if any endpoint fails, so a file IT writes can only contain honest zeroes.
 * This file predates that rule and does not inherit it. The next regeneration earns it — and
 * regeneration is a deliberate act, because `goal.test.js` pins measured ratios (32/55, 13/207)
 * that are evidence, and overwriting them silently would delete the measurement they record.
 */
const CAPTURED_ON = '2026-08-11'

const CAPTURED = Object.freeze({
  inventory: Object.freeze({
    rowsSeen: 199,
    fields: Object.freeze([
      Object.freeze({ name: "category", types: ["null","string"], present: 199, nonEmpty: 21 }),
      Object.freeze({ name: "currentStock", types: ["string"], present: 199, nonEmpty: 199 }),
      Object.freeze({ name: "id", types: ["string"], present: 199, nonEmpty: 199 }),
      Object.freeze({ name: "isPurchasable", types: ["number"], present: 199, nonEmpty: 199 }),
      Object.freeze({ name: "lifecycleStatus", types: ["string"], present: 199, nonEmpty: 199 }),
      Object.freeze({ name: "name", types: ["string"], present: 199, nonEmpty: 199 }),
      Object.freeze({ name: "parLevel", types: ["null","string"], present: 199, nonEmpty: 193 }),
      Object.freeze({ name: "subCategory", types: ["string"], present: 199, nonEmpty: 199 }),
      Object.freeze({ name: "unit", types: ["string"], present: 199, nonEmpty: 199 }),
    ]),
    arrays: Object.freeze({
    })
  }),
  suppliers: Object.freeze({
    rowsSeen: 36,
    fields: Object.freeze([
      Object.freeze({ name: "cutoffTime", types: ["null"], present: 36, nonEmpty: 0 }),
      Object.freeze({ name: "deliveryDays", types: ["array","null"], present: 36, nonEmpty: 13 }),
      Object.freeze({ name: "email", types: ["null","string"], present: 36, nonEmpty: 3 }),
      Object.freeze({ name: "id", types: ["string"], present: 36, nonEmpty: 36 }),
      Object.freeze({ name: "minimumOrderValue", types: ["null","string"], present: 36, nonEmpty: 4 }),
      Object.freeze({ name: "name", types: ["string"], present: 36, nonEmpty: 36 }),
      Object.freeze({ name: "orderLeadDays", types: ["null","number"], present: 36, nonEmpty: 11 }),
      Object.freeze({ name: "phone", types: ["null","string"], present: 36, nonEmpty: 26 }),
      Object.freeze({ name: "preferredOrderMethod", types: ["null","string"], present: 36, nonEmpty: 21 }),
      Object.freeze({ name: "status", types: ["string"], present: 36, nonEmpty: 36 }),
    ]),
    arrays: Object.freeze({
      "deliveryDays": Object.freeze({
        elements: 58, scalarElements: 58, rowsWithElements: 13,
        fields: Object.freeze([
        ])
      }),
    })
  }),
  dailyCounts: Object.freeze({
    rowsSeen: 50,
    fields: Object.freeze([
      Object.freeze({ name: "dueDate", types: ["null"], present: 50, nonEmpty: 0 }),
      Object.freeze({ name: "id", types: ["string"], present: 50, nonEmpty: 50 }),
      Object.freeze({ name: "itemCount", types: ["number"], present: 50, nonEmpty: 50 }),
      Object.freeze({ name: "items", types: ["array"], present: 50, nonEmpty: 0 }),
      Object.freeze({ name: "locationCode", types: ["string"], present: 50, nonEmpty: 50 }),
      Object.freeze({ name: "locationName", types: ["string"], present: 50, nonEmpty: 50 }),
      Object.freeze({ name: "submittedAt", types: ["string"], present: 50, nonEmpty: 50 }),
    ]),
    arrays: Object.freeze({
      "items": Object.freeze({
        elements: 0, scalarElements: 0, rowsWithElements: 0,
        fields: Object.freeze([
        ])
      }),
    })
  }),
  orderPlanning: Object.freeze({
    rowsSeen: 55,
    fields: Object.freeze([
      Object.freeze({ name: "delivery_days", types: ["array","null"], present: 55, nonEmpty: 36 }),
      Object.freeze({ name: "incoming_qty", types: ["string"], present: 55, nonEmpty: 55 }),
      Object.freeze({ name: "ingredient_id", types: ["string"], present: 55, nonEmpty: 55 }),
      Object.freeze({ name: "ingredient_name", types: ["string"], present: 55, nonEmpty: 55 }),
      Object.freeze({ name: "latest_price", types: ["null","string"], present: 55, nonEmpty: 5 }),
      Object.freeze({ name: "live_qty", types: ["string"], present: 55, nonEmpty: 55 }),
      Object.freeze({ name: "order_lead_days", types: ["null","number"], present: 55, nonEmpty: 36 }),
      Object.freeze({ name: "pack_size", types: ["null","string"], present: 55, nonEmpty: 32 }),
      Object.freeze({ name: "par_level", types: ["string"], present: 55, nonEmpty: 55 }),
      Object.freeze({ name: "projected_qty", types: ["string"], present: 55, nonEmpty: 55 }),
      Object.freeze({ name: "purchase_unit", types: ["null","string"], present: 55, nonEmpty: 47 }),
      Object.freeze({ name: "suggested_order_qty", types: ["string"], present: 55, nonEmpty: 55 }),
      Object.freeze({ name: "supplier_id", types: ["null","string"], present: 55, nonEmpty: 53 }),
      Object.freeze({ name: "supplier_name", types: ["null","string"], present: 55, nonEmpty: 53 }),
      Object.freeze({ name: "supplier_product_name", types: ["null","string"], present: 55, nonEmpty: 47 }),
      Object.freeze({ name: "unit", types: ["string"], present: 55, nonEmpty: 55 }),
    ]),
    arrays: Object.freeze({
      "delivery_days": Object.freeze({
        elements: 187, scalarElements: 187, rowsWithElements: 36,
        fields: Object.freeze([
        ])
      }),
    })
  }),
  purchaseOrders: Object.freeze({
    rowsSeen: 13,
    fields: Object.freeze([
      Object.freeze({ name: "createdAt", types: ["string"], present: 13, nonEmpty: 13 }),
      Object.freeze({ name: "id", types: ["string"], present: 13, nonEmpty: 13 }),
      Object.freeze({ name: "itemCount", types: ["number"], present: 13, nonEmpty: 13 }),
      Object.freeze({ name: "items", types: ["array"], present: 13, nonEmpty: 13 }),
      Object.freeze({ name: "orderDate", types: ["string"], present: 13, nonEmpty: 13 }),
      Object.freeze({ name: "poNumber", types: ["string"], present: 13, nonEmpty: 13 }),
      Object.freeze({ name: "source", types: ["string"], present: 13, nonEmpty: 13 }),
      Object.freeze({ name: "status", types: ["string"], present: 13, nonEmpty: 13 }),
      Object.freeze({ name: "supplierId", types: ["string"], present: 13, nonEmpty: 13 }),
      Object.freeze({ name: "supplierName", types: ["string"], present: 13, nonEmpty: 13 }),
    ]),
    arrays: Object.freeze({
      "items": Object.freeze({
        elements: 207, scalarElements: 0, rowsWithElements: 13,
        fields: Object.freeze([
          Object.freeze({ name: "itemName", types: ["string"], present: 207, nonEmpty: 207 }),
          Object.freeze({ name: "purchaseOrderId", types: ["string"], present: 207, nonEmpty: 207 }),
          Object.freeze({ name: "quantity", types: ["string"], present: 207, nonEmpty: 207 }),
          Object.freeze({ name: "supplierItemName", types: ["null","string"], present: 207, nonEmpty: 13 }),
          Object.freeze({ name: "unit", types: ["string"], present: 207, nonEmpty: 207 }),
        ])
      }),
    })
  }),
  invoices: Object.freeze({
    rowsSeen: 0,
    fields: Object.freeze([
    ]),
    arrays: Object.freeze({
    })
  }),
})

module.exports = { CAPTURED, CAPTURED_ON }
