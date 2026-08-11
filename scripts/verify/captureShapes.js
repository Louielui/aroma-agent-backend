'use strict'

/**
 * captureShapes.js — THE INSTRUMENT BEHIND `src/intake/goal/capturedShapes.js`.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THIS FILE EXISTS BECAUSE ITS ABSENCE WAS THE DEFECT.
 *
 * `capturedShapes.js` was committed on 2026-08-11 with no instrument beside it. The data was in
 * the repo; the thing that produced it was not. That artefact then said `invoices: rowsSeen 0`,
 * and NOTHING IN THE REPOSITORY COULD ANSWER WHETHER THAT MEANT 「the endpoint returned nothing」
 * OR 「the call failed and nobody recorded it」. Telling them apart required going back to the
 * live endpoint by hand.
 *
 * > **Owner: 「An artefact nobody can re-run or audit is the shape you named — not 『failure
 * > recorded as empty』 but 『a product that cannot be questioned』.」**
 *
 * Every field conclusion the goal decomposer draws rests on this capture. So the capture gets
 * an instrument, and the instrument gets the one rule below.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── ⛔ THE RULE: A FAILURE CAN NEVER ENTER THE ARTEFACT ──────────────────────
 *
 * If ANY of the six endpoints fails, this script writes NOTHING and exits non-zero.
 *
 * The alternative — record the failure in the file as a fourth state — was rejected. It would
 * put a value in `capturedShapes.js` that every consumer must then remember to check, and the
 * lesson of the read-failure contract (`context/readContext.js`, fix a677525) is that a
 * failure marker one level down from where callers look is a failure marker that gets
 * filtered away. Refusing to write is not checkable-and-forgettable; it is unmissable.
 *
 * **THE CONSEQUENCE IS THE POINT: `rowsSeen: 0` in that file can now only mean an honest
 * empty response, because a failed read would have prevented the file from existing.**
 *
 * ── AND THE WORDING THAT DISTINCTION BUYS ───────────────────────────────────
 *
 * > **Owner: 「『no rows were returned, so no fields were observed』 is a fact; 『this endpoint
 * > has no fields』 is a claim we cannot support.」**
 *
 * `operationCatalogue.js` already spells the first one `UNOBSERVED`. This script is what makes
 * that spelling true rather than hopeful.
 *
 * ── NAMES, TYPES AND COUNTS ONLY ────────────────────────────────────────────
 * No business value is read into the artefact, and the key is never printed. Same discipline
 * as the six response shapes.
 *
 * Usage:  node --env-file=.env scripts/verify/captureShapes.js [--write]
 *         Without --write it prints the summary and touches nothing.
 */

const fs = require('fs')
const path = require('path')

const BASE = (process.env.AROMA_SYSTEM_URL || 'https://system.aromabistro741.com').replace(/\/+$/, '')
const KEY = process.env.AROMA_SYSTEM_KEY || ''
const OUT = path.resolve(__dirname, '..', '..', 'src', 'intake', 'goal', 'capturedShapes.js')

/** The six, keyed exactly as the descriptor tables in `aromaSystemRead` key them. */
const ENDPOINTS = Object.freeze({
  inventory: '/api/v1/ai/inventory',
  suppliers: '/api/v1/ai/suppliers',
  dailyCounts: '/api/v1/ai/daily-counts',
  orderPlanning: '/api/v1/ai/order-planning',
  purchaseOrders: '/api/v1/ai/purchase-orders',
  invoices: '/api/v1/ai/invoices'
})

/** `present` counts rows carrying the key; `nonEmpty` counts rows where it carries something. */
function isEmptyValue (v) {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
}

function typeOf (v) {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

/** Field shapes for one level of rows. Returns a sorted, stable list. */
function shapeOf (rows) {
  const acc = new Map()
  for (const r of rows) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) continue
    for (const [k, v] of Object.entries(r)) {
      if (!acc.has(k)) acc.set(k, { name: k, types: new Set(), present: 0, nonEmpty: 0 })
      const f = acc.get(k)
      f.types.add(typeOf(v))
      f.present++
      if (!isEmptyValue(v)) f.nonEmpty++
    }
  }
  return [...acc.values()]
    .map((f) => ({ name: f.name, types: [...f.types].sort(), present: f.present, nonEmpty: f.nonEmpty }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * One level INTO every array-valued field.
 *
 * ⛔ THIS LEVEL EXISTS BECAUSE THE DECOMPOSER ASKED FOR IT. The first capture recorded only
 * 「array, non-empty on 13 of 13」 for purchase-order items, which hid that those items carry
 * `itemName` and NO ingredient id — so order planning and purchasing can only be joined by
 * NAME. One level deeper is where a spelling-match join becomes visible (HR-56, HR-61).
 */
function arrayShapes (rows) {
  const out = {}
  const arrayKeys = new Set()
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue
    for (const [k, v] of Object.entries(r)) if (Array.isArray(v)) arrayKeys.add(k)
  }
  for (const k of [...arrayKeys].sort()) {
    let elements = 0, scalarElements = 0, rowsWithElements = 0
    const objects = []
    for (const r of rows) {
      const v = r && r[k]
      if (!Array.isArray(v) || v.length === 0) continue
      rowsWithElements++
      for (const el of v) {
        elements++
        if (el && typeof el === 'object' && !Array.isArray(el)) objects.push(el)
        else scalarElements++
      }
    }
    out[k] = { elements, scalarElements, rowsWithElements, fields: shapeOf(objects) }
  }
  return out
}

async function readOne (key, urlPath) {
  const url = BASE + urlPath
  let res, text
  try {
    res = await fetch(url, { method: 'GET', headers: { Authorization: 'Bearer ' + KEY, Accept: 'application/json' } })
    text = await res.text()
  } catch (e) {
    return { key, ok: false, reason: 'THREW: ' + (e && e.message ? e.message : String(e)) }
  }
  if (!res.ok) return { key, ok: false, reason: 'HTTP ' + res.status + ' ' + res.statusText }

  let body
  try { body = JSON.parse(text) } catch (_) { return { key, ok: false, reason: 'body is not JSON (' + text.length + ' bytes)' } }

  const rows = Array.isArray(body) ? body : (body && Array.isArray(body.data)) ? body.data : null
  if (rows === null) return { key, ok: false, reason: 'no rows array in body; top keys: ' + Object.keys(body || {}).join(',') }

  /**
   * ⛔ THE SERVER'S OWN COUNT, CROSS-CHECKED. `count: 5` beside `data: []` is a third state —
   * neither a healthy empty nor a transport failure — and it would otherwise be recorded as a
   * clean zero. Disagreement is a failure, not a footnote.
   */
  const serverCount = (body && typeof body.count === 'number') ? body.count : null
  if (serverCount !== null && serverCount !== rows.length) {
    return { key, ok: false, reason: 'server count ' + serverCount + ' disagrees with ' + rows.length + ' rows returned' }
  }

  return { key, ok: true, http: res.status, serverCount, rowsSeen: rows.length, fields: shapeOf(rows), arrays: arrayShapes(rows) }
}

function render (results, capturedOn) {
  const lines = []
  lines.push("'use strict'")
  lines.push('')
  lines.push('/**')
  lines.push(' * capturedShapes.js — WHAT THE SIX ENDPOINTS ACTUALLY RETURNED.')
  lines.push(' *')
  lines.push(' * ⛔ GENERATED. Do not hand-edit. Regenerate with:')
  lines.push(' *     node --env-file=.env scripts/verify/captureShapes.js --write')
  lines.push(' *')
  lines.push(' * ⛔ NAMES, TYPES AND COUNTS ONLY. No value from the business is recorded here.')
  lines.push(' * `present` = rows carrying the key. `nonEmpty` = rows carrying something other than')
  lines.push(' * null/undefined/empty-string/empty-array. THE PAIR IS THE POINT: present=N nonEmpty=0 is a')
  lines.push(' * different state from present=N nonEmpty=N, and only counts tell them apart.')
  lines.push(' *')
  lines.push(' * ⛔ A FAILED READ CANNOT APPEAR HERE. The instrument refuses to write the whole file if')
  lines.push(' * any endpoint fails, so `rowsSeen: 0` below can only mean an honest empty response —')
  lines.push(' * 「no rows were returned, so no fields were observed」, which is a fact. It never means')
  lines.push(' * 「this endpoint has no fields」, which is a claim nothing here can support.')
  lines.push(' */')
  lines.push('')
  lines.push("const CAPTURED_ON = '" + capturedOn + "'")
  lines.push('')
  lines.push('const CAPTURED = Object.freeze({')
  for (const r of results) {
    lines.push('  ' + r.key + ': Object.freeze({')
    lines.push('    rowsSeen: ' + r.rowsSeen + ',')
    lines.push('    fields: Object.freeze([')
    for (const f of r.fields) lines.push('      Object.freeze(' + JSON.stringify(f) + '),')
    lines.push('    ]),')
    lines.push('    arrays: Object.freeze({')
    for (const [name, a] of Object.entries(r.arrays)) {
      lines.push('      ' + JSON.stringify(name) + ': Object.freeze({')
      lines.push('        elements: ' + a.elements + ', scalarElements: ' + a.scalarElements + ', rowsWithElements: ' + a.rowsWithElements + ',')
      lines.push('        fields: Object.freeze([')
      for (const f of a.fields) lines.push('          Object.freeze(' + JSON.stringify(f) + '),')
      lines.push('        ])')
      lines.push('      }),')
    }
    lines.push('    })')
    lines.push('  }),')
  }
  lines.push('})')
  lines.push('')
  lines.push('module.exports = { CAPTURED, CAPTURED_ON }')
  lines.push('')
  return lines.join('\n')
}

;(async () => {
  if (!KEY) { console.error('⛔ AROMA_SYSTEM_KEY absent. Run with --env-file=.env'); process.exit(2) }
  console.log('base ' + BASE + '   key PRESENT (not printed)')
  console.log('')

  const results = []
  const failures = []
  for (const [key, p] of Object.entries(ENDPOINTS)) {
    const r = await readOne(key, p)
    if (!r.ok) { failures.push(r); console.log('  ' + key.padEnd(15) + '⛔ FAILED — ' + r.reason); continue }
    results.push(r)
    const note = r.rowsSeen === 0 ? '   ← no rows returned, so no fields observed' : ''
    console.log('  ' + key.padEnd(15) + 'HTTP ' + r.http + '  rows ' + String(r.rowsSeen).padStart(4) +
      '  fields ' + String(r.fields.length).padStart(3) + note)
  }

  console.log('')
  if (failures.length) {
    console.error('⛔ ' + failures.length + ' of ' + Object.keys(ENDPOINTS).length + ' endpoints failed. NOTHING WRITTEN.')
    console.error('   A partial capture is the defect this instrument exists to prevent: it would record')
    console.error('   a failure as an empty endpoint, and every field conclusion would inherit it.')
    process.exit(1)
  }

  if (!process.argv.includes('--write')) {
    console.log('All six read cleanly. Dry run — pass --write to regenerate capturedShapes.js')
    return
  }

  // ⛔ The date is the CAPTURE's, taken here rather than passed in, so the artefact cannot claim
  // to be fresher than the read that produced it.
  const capturedOn = new Date().toISOString().slice(0, 10)
  fs.writeFileSync(OUT, render(results, capturedOn), 'utf8')
  console.log('wrote ' + path.relative(process.cwd(), OUT) + '  (captured ' + capturedOn + ')')
})()
