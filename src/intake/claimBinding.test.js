'use strict'

/**
 * claimBinding.test.js — A2 Phase 2. STRUCTURE ONLY. Nothing is enforced.
 *
 * > **Owner: 「The MODEL may declare the claim structure. The SERVER must VERIFY that
 * > declaration structurally. Never trust a model declaration merely because it is in JSON.」**
 *
 * ── THE TWO BLOCKERS THIS EXISTS TO REMOVE ───────────────────────────────────
 * BLOCKER 1 — a directAnswer sentence has no structural mapping to the source it is about, so
 * handing `checkEvidence` the whole `evidenceSets` array would let an unrelated source's
 * unknown coverage refuse a sentence about a different source.
 * BLOCKER 2 — a row-local fact must not inherit set-wide truncation. `PO123.status = received`
 * is fully supported even if 100 of 500 purchase orders came back.
 *
 * ⛔ NO PROSE IS READ ANYWHERE IN THIS MODULE. The binding is declared by the model as
 * structure and verified by the server against retrieved evidence. There is no noun list, no
 * regex over claim text, and no scope inferred from words. A test below asserts that the
 * verifier's decision does not change when the claim TEXT is replaced with unrelated text.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { verifyClaimBindings, CLAIM_KIND, BINDING } = require('./claimBinding')

const NOW = '2026-08-08T12:00:00.000Z'

/** An evidence descriptor in the A1 canonical shape. */
const ev = (source, over = {}) => Object.assign({
  source,
  endpoint: source === 'aroma_system' ? 'purchaseOrders' : null,
  trust: 'live',
  returnedRows: 14,
  shownCount: 14,
  matchingTotal: 14,
  sourceTotal: null,
  queryScope: { field: 'createdAt', window: 'last_30_days', declaredBy: 'reader' },
  filtersApplied: null,
  limit: 100,
  limitKnown: true,
  truncated: false,
  completeWithinScope: true,
  dataAsOf: null,
  retrievedAt: NOW
}, over)

/** Retrieved rows, in the shape itemsBySource carries. */
const items = (source, ids) => [{ source, items: ids.map((id) => ({ source, sourceId: String(id), title: 't' + id })) }]

const ctx = (evidenceSets, itemsBySource) => ({ evidenceSets, itemsBySource })

/* ═══ 1. A CLAIM MAY NOT BIND TO A SOURCE THAT WAS NOT READ ═══════════════════ */

test('*** ⛔ a claim cannot bind to a source that was not read ***', () => {
  const claims = [{ text: 'x', claimKind: CLAIM_KIND.SET_SCOPED, evidenceSources: ['gmail'], sourceIds: [], scope: { field: null, window: null } }]
  const out = verifyClaimBindings(claims, ctx([ev('aroma_system')], items('aroma_system', ['PO1'])))
  assert.equal(out[0].binding, BINDING.UNVERIFIED)
  assert.equal(out[0].reason, 'source_not_read')
})

/* ═══ 2. A ROW_LOCAL CLAIM MUST NAME RETRIEVED ROWS ═══════════════════════════ */

test('*** ⛔ a row_local claim cannot reference a sourceId that was not retrieved ***', () => {
  const claims = [{ text: 'x', claimKind: CLAIM_KIND.ROW_LOCAL, evidenceSources: ['aroma_system'], sourceIds: ['PO999'], scope: { field: null, window: null } }]
  const out = verifyClaimBindings(claims, ctx([ev('aroma_system')], items('aroma_system', ['PO1', 'PO2'])))
  assert.equal(out[0].binding, BINDING.UNVERIFIED)
  assert.equal(out[0].reason, 'source_id_not_retrieved')
})

test('*** a row_local claim naming a retrieved row VERIFIES ***', () => {
  const claims = [{ text: 'x', claimKind: CLAIM_KIND.ROW_LOCAL, evidenceSources: ['aroma_system'], sourceIds: ['PO1'], scope: { field: null, window: null } }]
  const out = verifyClaimBindings(claims, ctx([ev('aroma_system')], items('aroma_system', ['PO1', 'PO2'])))
  assert.equal(out[0].binding, BINDING.VERIFIED)
  assert.equal(out[0].claimKind, CLAIM_KIND.ROW_LOCAL)
})

test('*** a row_local claim with NO sourceIds is unverified — it is not row-local at all ***', () => {
  const claims = [{ text: 'x', claimKind: CLAIM_KIND.ROW_LOCAL, evidenceSources: ['aroma_system'], sourceIds: [], scope: { field: null, window: null } }]
  const out = verifyClaimBindings(claims, ctx([ev('aroma_system')], items('aroma_system', ['PO1'])))
  assert.equal(out[0].binding, BINDING.UNVERIFIED)
  assert.equal(out[0].reason, 'row_local_without_rows')
})

/* ═══ 3. BLOCKER 2 — TRUNCATION IS SET-WIDE AND MUST NOT REACH A ROW ══════════ */

test('*** ⛔ a row_local claim stays VERIFIED when its source is truncated ***', () => {
  // 100 of 500 purchase orders returned. PO1 was one of them. 「PO1 is received」 is
  // completely supported, and set-wide incompleteness has nothing to say about it.
  const truncated = ev('aroma_system', { truncated: true, completeWithinScope: false, matchingTotal: null, returnedRows: 100, limit: 100 })
  const claims = [{ text: 'x', claimKind: CLAIM_KIND.ROW_LOCAL, evidenceSources: ['aroma_system'], sourceIds: ['PO1'], scope: { field: null, window: null } }]
  const out = verifyClaimBindings(claims, ctx([truncated], items('aroma_system', ['PO1'])))
  assert.equal(out[0].binding, BINDING.VERIFIED,
    'row-local truth is independent of source-wide completeness')
})

test('*** but a set_scoped claim on a truncated source is NOT verified ***', () => {
  const truncated = ev('aroma_system', { truncated: true, completeWithinScope: false, matchingTotal: null })
  const claims = [{ text: 'x', claimKind: CLAIM_KIND.SET_SCOPED, evidenceSources: ['aroma_system'], sourceIds: [], scope: { field: 'createdAt', window: 'last_30_days' } }]
  const out = verifyClaimBindings(claims, ctx([truncated], items('aroma_system', ['PO1'])))
  assert.equal(out[0].binding, BINDING.UNVERIFIED)
  assert.equal(out[0].reason, 'scope_not_complete')
})

/* ═══ 4. THE KINDS ARE DISTINGUISHABLE WITHOUT READING PROSE ══════════════════ */

test('*** ⛔ kind is structural — replacing the TEXT changes no verdict ***', () => {
  const base = { claimKind: CLAIM_KIND.ROW_LOCAL, evidenceSources: ['aroma_system'], sourceIds: ['PO1'], scope: { field: null, window: null } }
  const c = ctx([ev('aroma_system')], items('aroma_system', ['PO1']))
  const a = verifyClaimBindings([{ ...base, text: 'PO1 已收貨。' }], c)
  const b = verifyClaimBindings([{ ...base, text: '所有採購單都已收貨，全部，每一張。' }], c)
  assert.deepEqual(a, b,
    'no noun list, no regex, no scope read from words — text is carried, never consulted')
})

test('*** source_wide is structurally distinct from row_local ***', () => {
  const c = ctx([ev('aroma_system')], items('aroma_system', ['PO1']))
  const rowLocal = verifyClaimBindings([{ text: 'x', claimKind: CLAIM_KIND.ROW_LOCAL, evidenceSources: ['aroma_system'], sourceIds: ['PO1'], scope: { field: null, window: null } }], c)
  const sourceWide = verifyClaimBindings([{ text: 'x', claimKind: CLAIM_KIND.SOURCE_WIDE, evidenceSources: ['aroma_system'], sourceIds: [], scope: { field: null, window: null } }], c)
  assert.notEqual(rowLocal[0].claimKind, sourceWide[0].claimKind)
  assert.equal(rowLocal[0].binding, BINDING.VERIFIED)
  assert.equal(sourceWide[0].binding, BINDING.UNVERIFIED, 'sourceTotal is null, so coverage is not established')
  assert.equal(sourceWide[0].reason, 'source_coverage_unknown')
})

test('*** source_wide VERIFIES only when matchingTotal === sourceTotal ***', () => {
  const covered = ev('aroma_system', { matchingTotal: 4, sourceTotal: 4, returnedRows: 4, shownCount: 4 })
  const claims = [{ text: 'x', claimKind: CLAIM_KIND.SOURCE_WIDE, evidenceSources: ['aroma_system'], sourceIds: [], scope: { field: null, window: null } }]
  assert.equal(verifyClaimBindings(claims, ctx([covered], items('aroma_system', ['a'])))[0].binding, BINDING.VERIFIED)

  const partial = ev('aroma_system', { matchingTotal: 1, sourceTotal: 471 })
  assert.equal(verifyClaimBindings(claims, ctx([partial], items('aroma_system', ['a'])))[0].binding, BINDING.UNVERIFIED)
})

/* ═══ 5. SET_SCOPED CARRIES AN EXPLICIT STRUCTURAL SCOPE ══════════════════════ */

test('*** a set_scoped claim without a structural scope is unverified ***', () => {
  const claims = [{ text: 'x', claimKind: CLAIM_KIND.SET_SCOPED, evidenceSources: ['aroma_system'], sourceIds: [], scope: { field: null, window: null } }]
  const out = verifyClaimBindings(claims, ctx([ev('aroma_system')], items('aroma_system', ['PO1'])))
  assert.equal(out[0].binding, BINDING.UNVERIFIED)
  assert.equal(out[0].reason, 'scope_not_declared')
})

test('*** ⛔ a claimed scope that CONTRADICTS the evidence scope is unverified ***', () => {
  // The evidence was selected by createdAt over 30 days. A claim declaring a different field
  // or a wider window is asserting coverage the read does not have.
  const c = ctx([ev('aroma_system')], items('aroma_system', ['PO1']))
  for (const scope of [
    { field: 'invoiceDate', window: 'last_30_days' },
    { field: 'createdAt', window: 'last_90_days' }
  ]) {
    const out = verifyClaimBindings([{ text: 'x', claimKind: CLAIM_KIND.SET_SCOPED, evidenceSources: ['aroma_system'], sourceIds: [], scope }], c)
    assert.equal(out[0].binding, BINDING.UNVERIFIED, JSON.stringify(scope))
    assert.equal(out[0].reason, 'scope_mismatch')
  }
})

test('*** a set_scoped claim MATCHING the evidence scope verifies ***', () => {
  const claims = [{ text: 'x', claimKind: CLAIM_KIND.SET_SCOPED, evidenceSources: ['aroma_system'], sourceIds: [], scope: { field: 'createdAt', window: 'last_30_days' } }]
  const out = verifyClaimBindings(claims, ctx([ev('aroma_system')], items('aroma_system', ['PO1'])))
  assert.equal(out[0].binding, BINDING.VERIFIED)
})

/* ═══ 6. UNKNOWN NEVER BECOMES SOMETHING ═════════════════════════════════════ */

test('*** ⛔ a missing claim structure is UNBOUND — never row_local, never source_wide ***', () => {
  for (const missing of [undefined, null, []]) {
    const out = verifyClaimBindings(missing, ctx([ev('aroma_system')], items('aroma_system', ['PO1'])))
    assert.deepEqual(out, [], 'no claims declared yields no bindings — not an inferred one')
  }
})

test('*** an unrecognised claimKind is UNVERIFIED, not coerced to a known kind ***', () => {
  const claims = [{ text: 'x', claimKind: 'everything_is_fine', evidenceSources: ['aroma_system'], sourceIds: [], scope: { field: null, window: null } }]
  const out = verifyClaimBindings(claims, ctx([ev('aroma_system')], items('aroma_system', ['PO1'])))
  assert.equal(out[0].binding, BINDING.UNVERIFIED)
  assert.equal(out[0].reason, 'unknown_claim_kind')
  assert.equal(out[0].claimKind, null, 'an unknown kind is null, never defaulted')
})

test('*** a claim naming NO evidence source is unverified ***', () => {
  const claims = [{ text: 'x', claimKind: CLAIM_KIND.SET_SCOPED, evidenceSources: [], sourceIds: [], scope: { field: 'createdAt', window: 'last_30_days' } }]
  const out = verifyClaimBindings(claims, ctx([ev('aroma_system')], items('aroma_system', ['PO1'])))
  assert.equal(out[0].binding, BINDING.UNVERIFIED)
  assert.equal(out[0].reason, 'no_evidence_source')
})

test('*** a source read but NOT live cannot carry a binding ***', () => {
  const stale = ev('aroma_system', { trust: 'unavailable' })
  const claims = [{ text: 'x', claimKind: CLAIM_KIND.ROW_LOCAL, evidenceSources: ['aroma_system'], sourceIds: ['PO1'], scope: { field: null, window: null } }]
  const out = verifyClaimBindings(claims, ctx([stale], items('aroma_system', ['PO1'])))
  assert.equal(out[0].binding, BINDING.UNVERIFIED)
  assert.equal(out[0].reason, 'source_not_read')
})
