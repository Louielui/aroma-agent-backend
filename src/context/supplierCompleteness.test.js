'use strict'

/**
 * SUPPLIER COMPLETENESS — THE THREE DOMAINS, KEPT APART.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ ONE WORD, "completeness", WAS DOING THREE JOBS.
 *
 * The supplier endpoint is audited server-unbounded, so all ~36 rows arrive. Five caps then
 * stood in series — adapter 25, connector 25, context 4, answer-plan 5, view 5 — and the
 * Owner saw a handful. 「列出全部供應商」 could not be answered, and nothing downstream could
 * recover the discarded rows because they were destroyed in the reader.
 *
 * Three different questions were being answered by one field:
 *   RETRIEVAL   — did we get every row the server was willing to give?
 *   MODEL       — how many rows are in the prompt the model reasons over?
 *   OWNER VIEW  — how many rows appear on his screen?
 *
 * ⛔ AND THE TEMPTING FIX IS THE DANGEROUS ONE. Feeding all 36 rows into the model block
 * would blow the 6000-character budget on suppliers alone (measured: ~7,092 chars) and push
 * every other source out. Worse, if the complete set reached claim binding, the model could
 * cite a row it never saw and be VALIDATED — a binding that certifies invention. So the
 * complete set travels to the deterministic renderer and NOWHERE ELSE.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const AR = require('./adapters/aromaSystemRead')
const { createReadConnector } = require('./readConnector')
const RV = require('../intake/readResultView')
const { verifyClaimBindings } = require('../intake/claimBinding')

const KEY = 'test-key'
const NOW = '2026-08-15T00:00:00.000Z'
const KEY_ENV = 'AROMA_SYSTEM_KEY'

/** 36 suppliers, the live population size. */
const suppliers = (n) => Array.from({ length: n }, (_, i) => ({
  id: 100 + i,
  supplierName: 'Supplier ' + String(100 + i),
  contactName: 'Contact ' + i,
  phone: '+852 2345 ' + String(1000 + i)
}))

const jsonOk = (data) => async () => ({
  ok: true,
  status: 200,
  json: async () => ({ ok: true, count: data.length, data })
})

/** The connector registers adapters; it takes no adapter map. */
/**
 * The connector registers adapters and is gated by the read-access flags — a deterministic
 * env, so the test exercises the real gate rather than bypassing it.
 */
const READ_ENV = { READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on' }
const connectorWith = (adapter) => { const c = createReadConnector({ env: READ_ENV }); c.register(adapter); return c }

const adapterWith = (rows) => AR.createAromaSystemReadAdapter({
  env: { [KEY_ENV]: KEY },
  fetchFn: jsonOk(rows),
  clock: () => NOW
})

/* ═══ A — THE ADAPTER KEEPS EVERY SUPPLIER ROW ═════════════════════════════ */

test('*** ⛔ A. THE ADAPTER RETURNS ALL 36 SUPPLIERS, NOT THE FIRST 25 ***', async () => {
  /**
   * ⛔ THE ROWS DROPPED HERE WERE NOT THE LEAST IMPORTANT ONES — suppliers have no ranking
   * (`RANKING_OF.suppliers === null`), so the 11 discarded were simply whatever the API
   * listed last. An arbitrary cut presented as an answer.
   */
  const out = await adapterWith(suppliers(36)).methods.listSuppliers({})
  assert.equal(out.results.length, 36, '⛔ the adapter still truncates suppliers')
  assert.equal(out.evidence.returnedRows, 36)
  assert.equal(out.evidence.shownCount, 36)
  assert.equal(out.evidence.completeness, 'complete')
  // ⛔ THE COUNT WAS ALREADY CORRECT AND MUST STAY CORRECT — truncation was a LIST defect.
  assert.equal(out.evidence.matchingTotal, 36, '⛔ the population count regressed')
})

test('*** THE POLICY IS PER ENDPOINT AND DECLARED, NOT A RAISED GLOBAL ***', () => {
  // ⛔ `null` means AUDITED: NO CLIENT CAP. It is not "unknown" — the same distinction
  //    SERVER_LIMITS already makes, and for the same reason.
  assert.equal(AR.CLIENT_ROW_LIMITS.suppliers, null)
  assert.equal(AR.CLIENT_ROW_LIMITS.inventory, 25, '⛔ inventory lost its intentional cap')
  for (const k of ['dailyCounts', 'orderPlanning', 'purchaseOrders', 'invoices']) {
    assert.equal(AR.CLIENT_ROW_LIMITS[k], 25, k + ' must be unchanged')
  }
  // and the SERVER limits are a different fact, untouched
  assert.equal(AR.SERVER_LIMITS.suppliers, null)
  assert.equal(AR.SERVER_LIMITS.invoices, 100)
})

test('*** REGRESSION — INVENTORY KEEPS ITS RANKED TOP-25 ***', async () => {
  // 40 rows, shortfall ascending, so the ranked first place is the LAST row in API order.
  const inv = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, itemName: 'item ' + i, currentStock: 0, parLevel: i }))
  const out = await adapterWith(inv).methods.listInventory({})
  assert.equal(out.results.length, 25, '⛔ the inventory cap was removed')
  assert.equal(out.evidence.returnedRows, 40)
  assert.equal(out.evidence.shownCount, 25)
  assert.equal(out.evidence.completeness, 'sample')
  assert.equal(out.evidence.rankedBy, 'parLevel - currentStock desc')
  assert.match(String(out.results[0].content), /item 39/, '⛔ ranking first place changed')
})

/* ═══ B — THE CONNECTOR HONOURS THE ADAPTER'S DECLARATION ══════════════════ */

test('*** ⛔ B. THE CONNECTOR PASSES ALL 36 THROUGH ***', async () => {
  /**
   * ⛔ THE SECOND CAP, AND IT KNOWS NOTHING ABOUT SUPPLIERS. The connector must not learn
   * business semantics; the ADAPTER declares its own row policy and the connector obeys a
   * declaration it can validate. Anything malformed falls back to the shared default of 25.
   */
  const adapter = adapterWith(suppliers(36))
  const connector = connectorWith(adapter)
  const out = await connector.read('aroma_system', 'listSuppliers', {})
  assert.equal(out.count, 36, '⛔ the connector still caps suppliers at 25')
  assert.equal(out.truncatedCount, 0)

  // an endpoint with no declaration keeps the default
  const inv = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, itemName: 'i' + i, currentStock: 0, parLevel: i }))
  const c2 = connectorWith(adapterWith(inv))
  const invOut = await c2.read('aroma_system', 'listInventory', {})
  assert.equal(invOut.count, 25, '⛔ the default cap was lost')
})

test('*** ⛔ A DECLARATION IS NOT A CHANNEL — ONLY THE ADAPTER MAY DECLARE IT ***', async () => {
  // ⛔ No caller, user or model input may widen this bound. A junk declaration fails SAFE.
  const adapter = adapterWith(suppliers(36))
  const poisoned = Object.assign({}, adapter, { rowLimits: { listSuppliers: 'unlimited' } })
  const connector = connectorWith(poisoned)
  const out = await connector.read('aroma_system', 'listSuppliers', {})
  assert.equal(out.count, 25, '⛔ a malformed declaration widened the cap')
})

/* ═══ C — TWO SETS, AND THE PROMPT SEES ONLY ONE ═══════════════════════════ */

test('*** ⛔ C. THE CONTEXT SPLITS: RETRIEVED 36, MODEL-VISIBLE 4 ***', async () => {
  /**
   * ⛔ THE STRUCTURE THAT DID NOT EXIST. `itemsBySource` held POST-cap rows, so the complete
   * set died in `runStep` and neither the model NOR the Owner-facing renderer could ever see
   * it. A second structure is not a convenience — without it there is nothing to render.
   */
  const { buildReadContext } = require('./readContext')
  const adapter = adapterWith(suppliers(36))
  const connector = connectorWith(adapter)
  const rc = await buildReadContext({ connector, message: '列出全部供應商', sources: ['aroma_system'], env: READ_ENV })

  const bounded = (rc.itemsBySource || []).find((g) => g.source === 'aroma_system')
  const full = (rc.retrievedItemsBySource || []).find((g) => g.source === 'aroma_system')
  assert.ok(bounded, 'the bounded set still exists')
  assert.ok(full, '⛔ there is no retrieved set at all')
  assert.equal(bounded.items.length, 4, '⛔ the model-visible bound changed')
  assert.equal(full.items.length, 36, '⛔ the retrieved set is not complete')

  const ev = (rc.evidenceSets || [])[0]
  assert.equal(ev.returnedRows, 36)
  assert.equal(ev.matchingTotal, 36, '⛔ the count regressed')
  assert.equal(ev.retrievalCompleteness, 'complete')
  assert.equal(ev.contextShownCount, 4)
  assert.equal(ev.contextCompleteness, 'sample')
  /**
   * ⛔ THE CONTRADICTION THAT MUST NOT BE REPRESENTABLE: 「shown 4, completeness complete」.
   * The unqualified field keeps its original meaning — what is in front of the reader — so a
   * partial fix cannot produce a reply that says complete while showing four rows.
   */
  assert.equal(ev.completeness, 'sample', '⛔ an unqualified completeness claimed complete on 4 of 36')

  // ⛔ AND THE PROMPT BLOCK NEVER CARRIES THE FULL SET
  assert.ok(rc.block.length <= 6000, 'the block budget is unchanged: ' + rc.block.length)
  assert.equal((rc.block.match(/ref=aroma_system[^#]*#/g) || []).length, 4, '⛔ more than four rows reached the prompt')
})

/* ═══ D / E — THE VIEW, AND ONLY WHEN ASKED ═══════════════════════════════ */

const supplierRows = (n) => Array.from({ length: n }, (_, i) => ({
  source: 'aroma_system',
  readKey: 'aroma_system.suppliers',
  sourceId: String(100 + i),
  entityType: 'supplier',
  title: 'Supplier ' + String(100 + i),
  content: 'contact=Contact ' + i
}))

test('*** ⛔ D. AN EXHAUSTIVE REQUEST RENDERS EVERY RETRIEVED SUPPLIER ***', () => {
  const rows = supplierRows(36)
  const out = RV.renderCompleteSupplierList(rows, {})
  assert.equal((out.match(/Supplier 1\d\d/g) || []).length, 36, '⛔ the complete list is not complete')
  // exact retrieval order, no sorting of any kind
  const order = (out.match(/Supplier (1\d\d)/g) || []).map((s) => s.replace('Supplier ', ''))
  assert.deepEqual(order, rows.map((r) => String(r.sourceId)), '⛔ the renderer reordered the rows')
})

test('*** ⛔ THE SERVER DECIDES WHAT IS EXHAUSTIVE — FROM THE OWNERS OWN WORDS ***', () => {
  for (const yes of ['列出全部供應商', '所有供應商', '完整供應商名單', '供應商完整名單']) {
    assert.equal(RV.isExhaustiveListRequest(yes), true, '⛔ not recognised: ' + yes)
  }
  /**
   * ⛔ BIASED TOWARD NOT TRIGGERING. This path prints data, so an unrecognised phrasing must
   * fall back to the bounded view — which then has to SAY how many rows it withheld, so the
   * Owner can ask again in different words. Silence is the failure being fixed.
   */
  for (const no of ['邊間供應商最近落過單', '供應商', 'suppliers', '我哋有幾多供應商', '']) {
    assert.equal(RV.isExhaustiveListRequest(no), false, '⛔ wrongly triggered on: ' + no)
  }
})

test('*** ⛔ 7A. A MODEL-AUTHORED FIELD CANNOT DECLARE A REQUEST EXHAUSTIVE ***', () => {
  /**
   * ⛔ OTHERWISE THE MODEL HOLDS THE KEY TO THE CHANNEL THAT PRINTS EVERYTHING — the exact
   * authority this design takes away from it.
   */
  const rows = supplierRows(36)
  const out = RV.buildReadResultReply({
    reply: '好的。',
    message: '邊間供應商最近落過單',
    answerPlan: { exhaustive: true, listAll: true, sections: [{ heading: '全部供應商', items: [] }] },
    itemsBySource: [{ source: 'aroma_system', readKey: 'aroma_system.suppliers', items: rows.slice(0, 4) }],
    retrievedItemsBySource: [{ source: 'aroma_system', readKey: 'aroma_system.suppliers', items: rows }],
    perSource: [{ source: 'aroma_system', trust: 'live', count: 4, error: null, usedFallback: false }],
    evidenceSets: []
  })
  assert.equal((out.reply.match(/Supplier 1\d\d/g) || []).length <= 5, true,
    '⛔ a model field triggered the exhaustive renderer')
})

test('*** ⛔ 7B. WHEN ROWS ARE WITHHELD THE OWNER IS TOLD HOW MANY ***', () => {
  const rows = supplierRows(36)
  const out = RV.buildReadResultReply({
    reply: '好的。',
    message: '供應商',
    itemsBySource: [{ source: 'aroma_system', readKey: 'aroma_system.suppliers', items: rows.slice(0, 4) }],
    retrievedItemsBySource: [{ source: 'aroma_system', readKey: 'aroma_system.suppliers', items: rows }],
    perSource: [{ source: 'aroma_system', trust: 'live', count: 4, error: null, usedFallback: false }],
    evidenceSets: []
  })
  assert.match(out.reply, /32/, '⛔ 32 withheld rows were not disclosed to the Owner')
})

test('*** E. AN ORDINARY SUPPLIER QUESTION DOES NOT PRINT THIRTY-SIX ROWS ***', () => {
  const rows = supplierRows(36)
  const out = RV.buildReadResultReply({
    reply: '好的。',
    message: '邊間供應商最近落過單',
    itemsBySource: [{ source: 'aroma_system', readKey: 'aroma_system.suppliers', items: rows.slice(0, 4) }],
    retrievedItemsBySource: [{ source: 'aroma_system', readKey: 'aroma_system.suppliers', items: rows }],
    perSource: [{ source: 'aroma_system', trust: 'live', count: 4, error: null, usedFallback: false }],
    evidenceSets: []
  })
  assert.equal((out.reply.match(/Supplier 1\d\d/g) || []).length <= 5, true, '⛔ an ordinary question dumped the table')
})

/* ═══ F — CLAIM BINDING STAYS BOUNDED ═════════════════════════════════════ */

test('*** ⛔ F. A CLAIM ABOUT A ROW THE MODEL NEVER SAW MUST NOT VALIDATE ***', () => {
  /**
   * ⛔ THE FAILURE THAT WOULD BE WORSE THAN THE DEFECT. If the retrieved set became the
   * evidence universe, a model could cite row 20 — which was never in its context — and the
   * binding would certify it. A binding that validates invention is worse than none.
   */
  const rows = supplierRows(36)
  const visible = rows.slice(0, 4)
  const ctx = {
    evidenceSets: [{ source: 'aroma_system', readKey: 'aroma_system.suppliers', trust: 'live', entityType: 'supplier' }],
    itemsBySource: [{ source: 'aroma_system', readKey: 'aroma_system.suppliers', items: visible }]
  }
  const claim = (id) => ({ text: 'x', claimKind: 'row_local', evidenceSources: ['aroma_system.suppliers'], sourceIds: [id] })

  const seen = verifyClaimBindings([claim('aroma_system.suppliers#100')], ctx)[0]
  const hidden = verifyClaimBindings([claim('aroma_system.suppliers#120')], ctx)[0]
  assert.equal(seen.binding, 'verified', 'a row the model saw still binds normally')
  assert.equal(hidden.binding, 'unverified', '⛔ a row the model never saw was VALIDATED')
  assert.equal(hidden.reason, 'source_id_not_retrieved')
})

/* ═══ G — THE RENDERER CANNOT CARRY MODEL TEXT ════════════════════════════ */

test('*** ⛔ G. NO MODEL-AUTHORED STRING CAN REACH THE EXHAUSTIVE SECTION ***', () => {
  /**
   * ⛔ STRUCTURAL, NOT POLICED. `renderCompleteSupplierList(rows, labels)` takes two
   * arguments and neither can carry model output — no reply, no plan, no headings, no
   * claims. The canaries prove the wiring, and the signature makes the wiring impossible to
   * get wrong later.
   */
  const rows = supplierRows(36)
  const out = RV.buildReadResultReply({
    reply: '好的。CANARY_MODEL_REPLY_X91',
    message: '列出全部供應商',
    answerPlan: {
      sections: [{ heading: 'CANARY_MODEL_HEADING_X92', items: [] }],
      answerClaims: [{ claim: 'CANARY_MODEL_CLAIM_X93', sourceId: 'aroma_system.suppliers#100' }]
    },
    itemsBySource: [{ source: 'aroma_system', readKey: 'aroma_system.suppliers', items: rows.slice(0, 4) }],
    retrievedItemsBySource: [{ source: 'aroma_system', readKey: 'aroma_system.suppliers', items: rows }],
    perSource: [{ source: 'aroma_system', trust: 'live', count: 4, error: null, usedFallback: false }],
    evidenceSets: []
  })
  /**
   * ⛔ THE SIGNATURE IS THE GUARANTEE, NOT THE CANARIES. A canary proves the wiring TODAY;
   * arity proves that model text has nowhere to enter TOMORROW. Without this, adding a third
   * parameter and passing a model heading through it leaves every canary assertion green —
   * measured, not theorised: that exact mutation passed this test before this line existed.
   */
  assert.equal(RV.renderCompleteSupplierList.length, 2, '⛔ the renderer grew a parameter that could carry model text')

  const section = RV.renderCompleteSupplierList(rows, {})
  for (const canary of ['CANARY_MODEL_REPLY_X91', 'CANARY_MODEL_HEADING_X92', 'CANARY_MODEL_CLAIM_X93']) {
    assert.equal(section.includes(canary), false, '⛔ ' + canary + ' reached the exhaustive section')
  }
  // The bounded section renders its four rows too, so the reply carries BOTH sections — what
  // matters is that all 36 are present in the reply and that the complete section holds exactly 36.
  assert.ok((out.reply.match(/Supplier 1\d\d/g) || []).length >= 36, 'the exhaustive request did not render all 36')
  assert.equal((section.match(/Supplier 1\d\d/g) || []).length, 36)
  // every rendered value traces to a retrieval row
  for (const r of rows) assert.ok(section.includes(r.title), 'row missing: ' + r.title)
})

/* ═══ BOUNDARIES ══════════════════════════════════════════════════════════ */

test('*** SUPPLIER BOUNDARIES: 0, 4, 5, 25, 26, 36 ***', async () => {
  for (const n of [0, 4, 5, 25, 26, 36]) {
    const out = await adapterWith(suppliers(n)).methods.listSuppliers({})
    assert.equal(out.results.length, n, 'adapter kept the wrong count at n=' + n)
    if (n > 0) {
      assert.equal(out.evidence.returnedRows, n)
      assert.equal(out.evidence.completeness, 'complete', 'never a sample at n=' + n)
    }
  }
})
