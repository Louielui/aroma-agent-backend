'use strict'

/**
 * OPERATION-AWARE READ LABELS — ARCHITECTURE B.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE IDENTITY WAS NEVER MISSING. IT WAS DISCARDED AT PRESENTATION.
 *
 * Six Aroma operations rendered under one heading — 「餐廳系統」 — so 倉存, 訂貨建議 and 採購單
 * were indistinguishable on screen. `readOperations.js` has carried a label for every one of
 * the six all along; the renderer keyed on `source` and never asked for it.
 *
 * ⛔ AND THE FIRST FIX WAS REJECTED, WHICH IS WHY THIS FILE EXISTS IN THIS SHAPE.
 *
 * That attempt derived the readKey from the executed method, so an automatic inventory read
 * became `aroma_system.inventory`. It rendered correctly and it was WRONG: readKey is the
 * EVIDENCE NAMESPACE. Row refs, the answerPlan sourceId enum, the evidence index, claim
 * binding and the ranking proof are all built on it, so the rename silently rewrote
 * `aroma_system#7` into `aroma_system.inventory#7` — a contract a previous tranche pinned on
 * purpose, in a test that says so by name. Six tests across five files went red and none of
 * them was about labels.
 *
 * ⛔ SO THERE ARE THREE IDENTITIES, AND THEY NEVER MERGE:
 *     source    — which connector answered              aroma_system
 *     readKey   — the evidence / ref namespace, FROZEN  aroma_system
 *     operation — the business read that actually ran   aroma_system.inventory
 *
 * `operation` is PRESENTATION METADATA. It rides on the group and the perSource row, never on
 * a row, an EvidenceSet or a ref. Nothing downstream may bind to it — a value invented for a
 * heading must never become something a claim can be validated against.
 *
 * ⛔ NO NEW TABLE. Labels resolve through the canonical frozen vocabulary in readOperations.js.
 * A second map would be one rename away from telling the model one thing and the Owner another.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const RO = require('./readOperations')
const { buildReadContext } = require('./readContext')
const RV = require('../intake/readResultView')
const { createReadConnector } = require('./readConnector')
const AR = require('./adapters/aromaSystemRead')
const { validatePlan } = require('../intake/answerPlan')
const { RANKING_METRIC } = require('../intake/rankingProof')

const READ_ENV = { READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on' }
const NOW = '2026-08-16T00:00:00.000Z'

const rowsFor = (kind, n) => Array.from({ length: n }, (_, i) => (kind === 'inventory'
  ? { id: i + 1, itemName: 'item ' + i, currentStock: 0, parLevel: 10 + i }
  : { id: i + 1, itemName: 'item ' + i, suggested_order_qty: 5 + i }))

const adapterFor = (rows) => AR.createAromaSystemReadAdapter({
  env: { AROMA_SYSTEM_KEY: 'k' },
  fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, count: rows.length, data: rows }) }),
  clock: () => NOW
})

const contextFor = async (rows, message, over = {}) => {
  const c = createReadConnector({ env: READ_ENV })
  c.register(adapterFor(rows))
  return buildReadContext(Object.assign({ connector: c, message, sources: ['aroma_system'], env: READ_ENV }, over))
}

const viewOf = (rc, message) => RV.buildReadResultReply({
  reply: '好的。',
  message,
  itemsBySource: rc.itemsBySource,
  retrievedItemsBySource: rc.retrievedItemsBySource,
  perSource: rc.perSource,
  evidenceSets: rc.evidenceSets
})

/**
 * ⛔ CAUGHT WHILE READING THE RED: A HEADING MATCH IS NOT A SECTION MATCH.
 *
 * The first draft asserted /### 訂貨建議/ against the whole reply. It went red — but for the
 * wrong reason, and the red output showed why that mattered: the reply ALREADY opened with
 * `### 訂貨建議`. That is `renderSummary`, which titles itself from the INTENT and is not one
 * of the label sites this change touches. On a replenishment question the assertion was
 * satisfied before a single line of production code moved.
 *
 * Both discriminators below are immune to that: `renderSection` is exercised directly, and
 * `餐廳系統` must be absent from the WHOLE reply — today it appears in the section heading AND
 * in the summary sentence.
 */
const noGenericLabel = (reply, why) => assert.equal(reply.includes('餐廳系統'), false, why)

const headingOf = (section) => section.split('\n')[0]

/* ═══ A / B — the AUTOMATIC path: operation known, readKey untouched ═══════ */

test('*** ⛔ A. AUTOMATIC INVENTORY: operation aroma_system.inventory, readKey STILL aroma_system ***', async () => {
  /**
   * ⛔ THE WHOLE ARCHITECTURE IN ONE TEST. The operation is recovered — so the Owner reads 倉存
   * — and every identity that carries evidence stays exactly where it was. If this passes and
   * the ref assertion below fails, the rejected migration is back.
   */
  const rc = await contextFor(rowsFor('inventory', 3), '而家倉存點')
  const group = (rc.itemsBySource || [])[0]

  assert.equal(group.source, 'aroma_system', 'the connector identity is untouched')
  assert.equal(group.readKey, 'aroma_system', '⛔ readKey MOVED — the evidence namespace is frozen')
  assert.equal(group.operation, 'aroma_system.inventory', '⛔ the executed operation was not recorded')
  assert.equal((rc.retrievedItemsBySource || [])[0].operation, 'aroma_system.inventory', 'the retrieved group carries it too')
  assert.equal(rc.perSource[0].operation, 'aroma_system.inventory', 'and so does the perSource row')

  // ⛔ THE REF CONTRACT, ASSERTED WHERE THE MODEL ACTUALLY READS IT.
  assert.match(rc.block, /ref=aroma_system#1/, '⛔ the row ref is no longer source-namespaced')
  assert.equal(/ref=aroma_system\.inventory#/.test(rc.block), false, '⛔ THE REJECTED MIGRATION IS BACK')

  assert.equal(headingOf(RV.renderSection(group.operation, group.items, group.source)), '### 倉存', '⛔ the section heading is not the operation')
  noGenericLabel(viewOf(rc, '而家倉存點').reply, '⛔ 餐廳系統 still stands where the operation is known')
})

test('*** ⛔ B. AUTOMATIC REPLENISHMENT RENDERS 訂貨建議, REFS STILL SOURCE-NAMESPACED ***', async () => {
  const rc = await contextFor(rowsFor('replenishment', 3), '要訂啲乜')
  const group = (rc.itemsBySource || [])[0]
  assert.equal(group.readKey, 'aroma_system')
  assert.equal(group.operation, 'aroma_system.replenishment')
  assert.match(rc.block, /ref=aroma_system#1/, '⛔ the row ref moved')
  assert.equal(headingOf(RV.renderSection(group.operation, group.items, group.source)), '### 訂貨建議')
  noGenericLabel(viewOf(rc, '要訂啲乜').reply, '⛔ 餐廳系統 survives in the summary or the limits')
})

/* ═══ C — model-directed semantics unchanged ═══════════════════════════════ */

test('*** C. A MODEL-DIRECTED READ IS UNCHANGED — readKey IS the operation, refs follow it ***', async () => {
  /**
   * ⛔ THE OTHER HALF OF THE CONTRACT. A directed read has ALWAYS keyed evidence on the
   * operation, and that stays true: this tranche must not quietly normalise the two paths.
   */
  const rc = await contextFor(rowsFor('inventory', 2), '睇吓存貨', { operation: 'aroma_system.inventory' })
  const group = (rc.itemsBySource || [])[0]
  assert.equal(group.readKey, 'aroma_system.inventory', 'directed evidence identity is unchanged')
  assert.equal(group.operation, 'aroma_system.inventory', 'and the presentation metadata agrees with it')
  assert.match(rc.block, /ref=aroma_system\.inventory#1/, 'directed refs are operation-namespaced, as before')
  assert.equal(headingOf(RV.renderSection(group.operation, group.items, group.source)), '### 倉存')
})

/* ═══ E / H — the metadata leaks into nothing ══════════════════════════════ */

test('*** ⛔ E. ADDING THE METADATA CHANGES NO EVIDENCE IDENTITY ***', async () => {
  /**
   * ⛔ NOT WORDED AS 「the string never appears in a prompt」. The reasoning capability
   * vocabulary legitimately contains operation names, so such an assertion would fail for a
   * reason that has nothing to do with this change. What is proven here is narrower and
   * actually the risk: the new field is not SERIALISED into the evidence observation, and no
   * ref, scope line or EvidenceSet moved because it exists.
   */
  const rc = await contextFor(rowsFor('inventory', 3), '而家倉存點')

  const evidenceLines = rc.block.split('\n').filter((l) => l.startsWith('[aroma_system]'))
  assert.equal(evidenceLines.length, 3, 'three rows were rendered into the block')
  for (const line of evidenceLines) {
    assert.equal(line.includes('operation'), false, '⛔ an operation field reached an evidence line')
    assert.match(line, /ref=aroma_system#\d+ /, '⛔ the row ref prefix changed')
  }
  assert.match(rc.block, /SCOPE \[aroma_system\]/, '⛔ the scope line is keyed on something new')

  const ev = (rc.evidenceSets || [])[0]
  assert.equal(ev.readKey, 'aroma_system', '⛔ H. EvidenceSet.readKey was overwritten')
  assert.equal(Object.prototype.hasOwnProperty.call(ev, 'operation'), false, '⛔ the EvidenceSet grew an operation field')
  for (const row of rc.itemsBySource[0].items) {
    assert.equal(Object.prototype.hasOwnProperty.call(row, 'operation'), false, '⛔ a ROW carries the presentation value')
    assert.equal(row.readKey, 'aroma_system', '⛔ a row readKey moved')
  }
})

/* ═══ E2 / F — the DOWNSTREAM consumers still key on readKey ═══════════════ */

test('*** ⛔ E2. THE EVIDENCE INDEX AND CLAIM BINDING IGNORE THE NEW METADATA ***', () => {
  /**
   * ⛔ FOUND BY A MUTATION THAT SURVIVED THE WHOLE REPOSITORY.
   *
   * Keying the evidence index on `g.operation` — one plausible line in `answerPlan.js` —
   * passed all 4,432 tests. Every existing fixture hand-builds its groups WITHOUT an
   * operation, so the field that production now attaches was invisible to all of them: the
   * canonical ref would have become `aroma_system.inventory#1` downstream while the block
   * still said `aroma_system#1`, and a valid citation would resolve to nothing.
   *
   * ⛔ SO THE FIXTURE IS THE PRODUCTION SHAPE, DELIBERATELY. readKey bare, operation present,
   * exactly what `readContext` emits for an automatic read. Both consumers must key on the
   * readKey and be blind to the operation.
   */
  const { evidenceIndex } = require('../intake/answerPlan')
  const { verifyClaimBindings, BINDING } = require('../intake/claimBinding')

  const row = { source: 'aroma_system', readKey: 'aroma_system', sourceId: '1', title: 'Napa Cabbage', entityType: 'inventory_item', content: 'x', fields: { id: '1' }, trust: 'live' }
  const groups = [{ source: 'aroma_system', readKey: 'aroma_system', operation: 'aroma_system.inventory', items: [row] }]
  const evidence = [{ source: 'aroma_system', readKey: 'aroma_system', entityType: 'inventory_item', trust: 'live', shownCount: 1, matchingTotal: 1, completeness: 'complete' }]

  const index = evidenceIndex(evidence, groups)
  assert.ok(index.byId.has('aroma_system#1'), '⛔ the canonical ref left the readKey namespace')
  assert.equal(index.byId.has('aroma_system.inventory#1'), false, '⛔ the presentation value became an evidence identity')

  const verdicts = verifyClaimBindings(
    [{ text: 'Napa Cabbage 冇貨', claimKind: 'row_local', evidenceSources: ['aroma_system'], sourceIds: ['aroma_system#1'] }],
    { evidenceSets: evidence, itemsBySource: groups }
  )
  assert.equal(verdicts.length, 1, 'the claim was evaluated')
  assert.equal(verdicts[0].binding, BINDING.VERIFIED, '⛔ a valid claim on the canonical ref no longer binds: ' + JSON.stringify(verdicts[0]))
})

/* ═══ G — the ranking proof still binds on readKey ═════════════════════════ */

test('*** ⛔ G. THE RANKING PROOF BINDS ON readKey, NOT ON THE NEW METADATA ***', () => {
  /**
   * ⛔ THE QUIETEST WAY TO BREAK THIS. The proof picks the group it owns by comparing the
   * EvidenceSet readKey to `g.readKey || g.source`. A group now ALSO carries an operation, and
   * switching that comparison to it looks like an improvement — an automatic turn would then
   * compare `aroma_system` against `aroma_system.replenishment`, find no group, and report a
   * real proof as `no_ranking_proof`. Silently: a degraded answer, no error.
   *
   * So this is the AUTOMATIC shape — readKey bare, operation present, both on the same group.
   */
  const rowOf = (id, title) => ({ source: 'aroma_system', readKey: 'aroma_system', sourceId: id, title, entityType: 'order_suggestion', content: 'x', fields: { id }, trust: 'live' })
  const rows = [rowOf('1', 'P'), rowOf('2', 'Q'), rowOf('3', 'R')]
  const evidence = {
    source: 'aroma_system',
    entityType: 'order_suggestion',
    endpoint: 'orderPlanning',
    readKey: 'aroma_system', // ⛔ automatic read: the BARE SOURCE, exactly as production emits
    trust: 'live',
    shownCount: 3,
    matchingTotal: 39,
    sourceTotal: null,
    queryScope: { field: null, window: null, declaredBy: 'reader' },
    rowShape: { hasLocation: false, hasAsOf: false, note: null },
    metrics: {},
    derivations: {},
    fieldLabels: {},
    completeness: 'sample',
    rankingMetric: RANKING_METRIC.SUGGESTED_ORDER_QTY,
    rankingDirection: 'desc',
    rankingCompleteWithinScope: true
  }
  const groups = [{ source: 'aroma_system', readKey: 'aroma_system', operation: 'aroma_system.replenishment', items: rows }]
  const section = {
    heading: '訂貨建議排序',
    rankingClaim: { kind: 'ordering', n: null, metric: null },
    items: ['1', '2', '3'].map((id) => ({ sourceId: id, title: rows.find((r) => r.sourceId === id).title, facts: [] }))
  }
  const r = validatePlan(
    { directAnswer: '', sections: [section], limitations: [], followUp: null, unanswerable: false, citesEvidence: true },
    { evidenceSets: [evidence], itemsBySource: groups, message: '訂貨建議點？' }
  )
  const verdicts = r.rankingVerdicts || []
  assert.equal(verdicts.length, 1, 'the ranking claim was evaluated')
  assert.equal(verdicts[0].reason, null, '⛔ a real proof was reported as absent: ' + JSON.stringify(verdicts[0]))
})

/* ═══ I / J — the canonical six, and a safe fallback ═══════════════════════ */

test('*** I. THE SIX LABELS COME FROM THE CANONICAL TABLE, NOT A COPY ***', () => {
  // ⛔ Resolved through readOperations itself. A test-local table would be exactly the second
  //    truth this change exists to avoid: it would agree with itself forever while the
  //    application drifted away from it.
  const expected = [
    ['aroma_system.inventory', '倉存'],
    ['aroma_system.suppliers', '供應商'],
    ['aroma_system.daily_counts', '盤點紀錄'],
    ['aroma_system.replenishment', '訂貨建議'],
    ['aroma_system.purchasing', '採購單'],
    ['aroma_system.invoices', '發票']
  ]
  for (const [op, label] of expected) assert.equal(RO.labelForOperation(op), label, op)
  assert.equal(RO.labelForOperation('aroma_system.invoices'), '發票', '⛔ invoices is 發票 here, not 最近發票')
})

test('*** ⛔ J. AN UNKNOWN OPERATION FALLS BACK SAFELY ***', () => {
  assert.equal(RO.labelForOperation('aroma_system.nonesuch'), null, 'an unknown name resolves to null, never a guess')
  assert.equal(RO.labelForOperation('aroma_system'), null, 'a bare SOURCE is not an operation')
  // ⛔ DOTTED IS NOT TRUSTED. A string that merely looks like an operation must not print
  //    itself as a heading — the frozen vocabulary is the only authority.
  const view = RV.buildReadResultReply({
    reply: '好的。',
    message: '倉存',
    itemsBySource: [{ source: 'aroma_system', readKey: 'aroma_system', operation: 'aroma_system.nonesuch', items: [{ source: 'aroma_system', readKey: 'aroma_system', sourceId: 'x', title: 'T', content: 'c' }] }],
    perSource: [{ source: 'aroma_system', readKey: 'aroma_system', operation: 'aroma_system.nonesuch', trust: 'live', count: 1, error: null, usedFallback: false }],
    evidenceSets: []
  })
  assert.match(view.reply, /### 餐廳系統/, 'it falls back to the source label')
  assert.equal(/undefined|\[object Object\]|nonesuch/.test(view.reply), false, '⛔ a broken or raw heading reached the screen')
})

/* ═══ K — the 資料限制 lines, the third label site ═════════════════════════ */

test('*** ⛔ K. 資料限制 NAMES THE VIEW, AND FALLS BACK WHEN THERE IS NONE ***', async () => {
  /**
   * ⛔ WRITTEN BECAUSE A MUTATION WOULD OTHERWISE SURVIVE. Reverting this site to the source
   * label left every other test green: nothing in the suite reached 資料限制 at all.
   */
  const empty = await contextFor([], '要訂啲乜')
  assert.equal(empty.perSource[0].operation, 'aroma_system.replenishment')
  const emptyReply = viewOf(empty, '要訂啲乜').reply
  assert.match(emptyReply, /訂貨建議：讀到，但沒有相關結果/, '⛔ an empty read is not named')
  noGenericLabel(emptyReply, '⛔ 資料限制 still says 餐廳系統')

  const c = createReadConnector({ env: READ_ENV })
  c.register(AR.createAromaSystemReadAdapter({
    env: { AROMA_SYSTEM_KEY: 'k' },
    fetchFn: async () => { throw new Error('boom') },
    clock: () => NOW
  }))
  const dead = await buildReadContext({ connector: c, message: '要訂啲乜', sources: ['aroma_system'], env: READ_ENV })
  assert.equal(dead.perSource[0].trust, 'unavailable', 'the read really did fail')
  // ⛔ EXPLICITLY AUTHORISED: an unavailable replenishment read says 訂貨建議. The plan exists
  //    before the read is attempted, so the view that was ASKED FOR is the honest name.
  assert.match(viewOf(dead, '要訂啲乜').reply, /訂貨建議：讀不到/, '⛔ the failed view is not named')

  // ⛔ AND WITHOUT AN OPERATION IT IS STILL THE SOURCE. Nothing is invented to fill the gap.
  const generic = RV.buildReadResultReply({
    reply: '好的。',
    message: '要訂啲乜',
    itemsBySource: [],
    perSource: [{ source: 'aroma_system', readKey: 'aroma_system', operation: null, trust: 'unavailable', count: 0, error: 'boom', usedFallback: false }],
    evidenceSets: []
  })
  assert.match(generic.reply, /餐廳系統：讀不到/, '⛔ the fallback name is gone')
})

/* ═══ L — the exhaustive supplier list, heading included ═══════════════════ */

test('*** ⛔ L. THE COMPLETE SUPPLIER LIST IS HEADED 供應商, AND NOTHING ELSE MOVED ***', () => {
  /**
   * ⛔ THE SUPPLIER SUITE PASSED UNCHANGED — WHICH IS ITSELF A FINDING. Its heading assertion
   * is `/完整名單，共 36 項/`, so the LABEL in front of it was never pinned and could have
   * become anything at all without a single test going red. It is pinned here.
   *
   * ⛔ AND THE P0 GUARANTEES ARE RE-PROVEN, NOT ASSUMED. A label change has no business
   * touching row count, retrieval order or suppression, so those are measured again rather
   * than taken on the word of a suite that also would not have noticed.
   */
  const rows = Array.from({ length: 36 }, (_, i) => ({
    source: 'aroma_system',
    readKey: 'aroma_system.suppliers',
    sourceId: String(100 + i),
    entityType: 'supplier',
    title: 'Supplier ' + String(100 + i),
    content: 'contact=Contact ' + i
  }))
  const out = RV.buildReadResultReply({
    reply: '好的。',
    message: '列出全部供應商',
    answerPlan: {
      directAnswer: '系統有 36 個供應商，目前只看得到部分樣本資料。',
      citesEvidence: true,
      unanswerable: false,
      answerClaims: [],
      sections: [],
      limitations: ['系統返回的樣本不完整，無法列出全部 36 個供應商的完整詳情'],
      followUp: '要我幫你整理邊幾間？'
    },
    itemsBySource: [{ source: 'aroma_system', readKey: 'aroma_system.suppliers', operation: 'aroma_system.suppliers', items: rows.slice(0, 4) }],
    retrievedItemsBySource: [{ source: 'aroma_system', readKey: 'aroma_system.suppliers', operation: 'aroma_system.suppliers', items: rows }],
    perSource: [{ source: 'aroma_system', readKey: 'aroma_system.suppliers', operation: 'aroma_system.suppliers', trust: 'live', count: 4, error: null, usedFallback: false }],
    evidenceSets: []
  })

  assert.equal(out.reply.split('\n')[0], '### 供應商（完整名單，共 36 項）', '⛔ the heading is not the operation')
  const numbered = out.reply.split('\n').filter((l) => /^\d+\. Supplier/.test(l))
  assert.equal(numbered.length, 36, '⛔ a label change cost rows')
  assert.deepEqual(numbered.map((l) => l.split('Supplier ')[1].split('｜')[0]), rows.map((r) => r.sourceId), '⛔ retrieval order moved')
  assert.equal(out.reply.includes('目前只看得到部分樣本資料'), false, '⛔ suppression broke')
  assert.equal(out.reply.includes('無法列出全部'), false, '⛔ a model limitation returned beside the list')

  // ⛔ THE STRUCTURAL GUARANTEE IS UNCHANGED: two parameters, so there is still nowhere for a
  //    model-authored heading to enter. The label now comes from the canonical table instead
  //    of the LABELS argument — a narrower channel, not a wider one.
  assert.equal(RV.renderCompleteSupplierList.length, 2, '⛔ the renderer grew a third parameter')
  assert.equal(RV.renderCompleteSupplierList([], { aroma_system: '全部供應商（模型話嘅）' }).split('\n')[0],
    '### 供應商（完整名單，共 0 項）', '⛔ a caller-supplied label reached the heading')
})

/* ═══ M — the source-level name survives ═══════════════════════════════════ */

test('*** M. 餐廳系統 REMAINS THE SOURCE-LEVEL NAME ***', () => {
  // ⛔ This is operation-aware RESULT presentation, not a rename of the source. Source lists
  //    and interface chrome still say 餐廳系統, and their tests must stay green.
  const { LABELS } = require('../intake/readStateGuard')
  assert.equal(LABELS.aroma_system, '餐廳系統')
})

/* ═══ the executed method and the operation cannot disagree ════════════════ */

test('*** ⛔ THE EXECUTED METHOD AND THE OPERATION CANNOT DISAGREE ***', () => {
  // ⛔ Asserted through the canonical helpers rather than a handwritten list: both sides read
  //    the same frozen table, so a rename cannot leave one true and the other stale.
  for (const op of ['aroma_system.inventory', 'aroma_system.suppliers', 'aroma_system.daily_counts', 'aroma_system.replenishment', 'aroma_system.purchasing', 'aroma_system.invoices']) {
    const method = RO.resolveReadOperation(op).method
    assert.equal(RO.operationForAromaMethod(method), op, 'method ' + method + ' must round-trip to ' + op)
    assert.ok(RO.labelForOperation(op), 'and every operation must have a label')
  }
})
