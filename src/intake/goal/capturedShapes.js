'use strict'

/**
 * capturedShapes.js — WHAT THE SIX ENDPOINTS ACTUALLY RETURNED. Generated from one
 * read-only capture, 2026-08-11.
 *
 * ⛔ FIELD NAMES, TYPES AND COUNTS ONLY. No value from the Owner's business is recorded
 * here, and none was read into anything that persists. `present` is how many rows carried
 * the key; `nonEmpty` is how many carried something other than null/undefined/''/[].
 *
 * ⛔ THE COUNTS ARE THE POINT, NOT DECORATION. `invoices.supplierId` is present, correctly
 * typed and empty in production (HR-56) — a shape capture that recorded only names would
 * have promoted it to usable. present=N with nonEmpty=0 is a DIFFERENT state from
 * present=N with nonEmpty=N, and only the counts tell them apart.
 */

/** When the capture ran. Carried so a stale table is visible rather than assumed fresh. */
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
    ])
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
    ])
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
    ])
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
    ])
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
    ])
  }),
  invoices: Object.freeze({
    rowsSeen: 0,
    fields: Object.freeze([
    ])
  }),
})

module.exports = { CAPTURED, CAPTURED_ON }
