'use strict'

/**
 * evidenceTruthContract.test.js — A1. Semantics, not shape.
 *
 * > **Owner GO, P0: 「Make the current Aroma System read path semantically honest even when the
 * > server cannot yet provide source totals or authoritative scope metadata.」**
 *
 * ⛔ EVERY TEST HERE WOULD PASS ON THE OLD CODE IF IT ONLY CHECKED SHAPE. 「the field exists」,
 * 「it is a number」 — the defect had all of those. Each test below states a MEANING and fails
 * on the pre-A1 behaviour.
 *
 * The defect being closed: one number, `body.count`, travelled from the server to the prompt
 * and was rendered as 「N records exist」. On three of six endpoints it is a filtered page count,
 * so 「1 records exist」 was printed for an invoice table holding ~471.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { createAromaSystemReadAdapter, ROW_SHAPE, QUERY_SCOPE, SERVER_LIMITS } = require('./adapters/aromaSystemRead')
const { renderScopeLine } = require('./readContext')
const { checkEvidence } = require('../agent/evidenceGate')

/** A fake server response. `count` is what aroma-system really sends: data.length. */
function reply (rows, extra) {
  return Object.assign({ success: true, count: rows.length, data: rows }, extra || {})
}
function rowsOf (n, seed) {
  return Array.from({ length: n }, (_, i) => ({ id: String(seed || 'r') + i, name: 'n' + i }))
}
/** The adapter exposes readWithState(endpointKey); there is no per-entity method on the root. */
function read (endpointKey, body) {
  return createAromaSystemReadAdapter({
    apiKey: 'k',
    baseUrl: 'https://example.invalid',
    fetchFn: async () => ({ ok: true, status: 200, json: async () => body })
  }).readWithState(endpointKey)
}

// ─── 1 ───────────────────────────────────────────────────────────────────────
test('*** ⛔ a filtered endpoint may not produce an existence claim ***', async () => {
  const out = await read('invoices', reply(rowsOf(1)))
  const e = out.evidence
  assert.equal(e.matchingTotal, 1, 'one row matched the declared 30-day query')
  assert.equal(e.sourceTotal, null, 'the wider source total is NOT known')

  const line = renderScopeLine(e)
  assert.ok(line, 'a scope line must still be produced')
  // ⛔ THE CLAIM, NOT THE WORD. The first version of this assertion forbade 「exist」 outright
  // and failed on the line's own INSTRUCTION — 「do not state or imply how many exist」, which
  // is the opposite of the defect. Forbidding a word is a proxy; the defect is a NUMBER
  // asserted to be a population.
  assert.equal(/\d+\s*(records?\s*)?exists?\b/i.test(line), false,
    'must not assert a count of what EXISTS: ' + line)
  assert.equal(/系統共有|共有 ?\d+ ?筆/.test(line), false, 'nor the Chinese equivalent: ' + line)
  assert.ok(/UNKNOWN/.test(line), 'and it must SAY the source total is unknown: ' + line)
  assert.ok(/do not state or imply/i.test(line), 'and instruct against inferring one: ' + line)
})

// ─── 2 ───────────────────────────────────────────────────────────────────────
test('*** ⛔ on-the-cap is UNKNOWN, never false ***', async () => {
  // daily-counts: server window 7d, hardcoded limit 50. Exactly 50 rows came back.
  const out = await read('dailyCounts', reply(rowsOf(50)))
  const e = out.evidence
  assert.equal(e.limit, 50)
  assert.equal(e.returnedRows, 50)
  // strictEqual against null — `ok(!x)` would pass on false and is the assertion-shape
  // defect this project already has a fence for.
  assert.strictEqual(e.truncated, null, 'a result sitting exactly on its cap cannot be shown untruncated')
  assert.strictEqual(e.completeWithinScope, null, 'and completeness cannot be claimed from it')
})

test('*** below the cap IS establishable — the rule must not be uselessly conservative ***', async () => {
  const out = await read('purchaseOrders', reply(rowsOf(14)))
  assert.strictEqual(out.evidence.truncated, false)
  assert.strictEqual(out.evidence.completeWithinScope, true)
})

test('*** an AUDITED-UNBOUNDED endpoint is establishable — it is not the unknown case ***', async () => {
  // ⛔ CORRECTED BY OWNER REVIEW 4. This test used to assert `truncated: null` for inventory,
  // because the first A1 cut had one `limit: null` meaning two things — 「audited: no cap」 and
  // 「cap unknown」. Conflating them made the reader fail closed on an endpoint it had actually
  // verified was uncapped, which is not caution, it is a second ambiguity replacing the first.
  const out = await read('inventory', reply(rowsOf(199)))
  assert.strictEqual(out.evidence.limitKnown, true, 'the cap STATE was audited')
  assert.strictEqual(out.evidence.limit, null, 'and the audit found no cap')
  assert.strictEqual(out.evidence.truncated, false, 'so nothing could have been cut')
  assert.strictEqual(out.evidence.completeWithinScope, true)
})

// ─── 3 ───────────────────────────────────────────────────────────────────────
test('*** matchingTotal and sourceTotal are never conflated ***', async () => {
  const withTotal = await read('invoices', reply(rowsOf(1), { sourceTotal: 471 }))
  assert.equal(withTotal.evidence.matchingTotal, 1)
  assert.equal(withTotal.evidence.sourceTotal, 471, 'an explicitly provided source total is used')

  const withoutTotal = await read('invoices', reply(rowsOf(1)))
  assert.equal(withoutTotal.evidence.matchingTotal, 1)
  assert.strictEqual(withoutTotal.evidence.sourceTotal, null,
    'and it is NEVER substituted from the matching total')
})

test('*** ⛔ totalCount is GONE — not aliased ***', async () => {
  const out = await read('suppliers', reply(rowsOf(3)))
  assert.equal('totalCount' in out.evidence, false,
    'keeping it as a synonym would preserve the ambiguity under a new name — the whole defect')
})

// ─── 4 ───────────────────────────────────────────────────────────────────────
test('*** unknown survives adapter → readContext, undefaulted ***', async () => {
  const e = (await read('invoices', reply(rowsOf(1)))).evidence
  for (const f of ['sourceTotal', 'dataAsOf']) {
    assert.strictEqual(e[f], null, f + ' must be null')
    assert.equal(f in e, true, f + ' must be PRESENT — never omitted because it is unknown')
  }
  const line = renderScopeLine(e)
  assert.equal(/null|undefined|NaN/.test(line), false, 'and unknown is worded, not leaked: ' + line)
})

// ─── 5 ───────────────────────────────────────────────────────────────────────
test('*** ⛔ the universal-claim gate fires when completeness is UNKNOWN ***', async () => {
  const e = (await read('dailyCounts', reply(rowsOf(50)))).evidence
  assert.strictEqual(e.completeWithinScope, null)
  const v = checkEvidence({ claim: '所有盤點都已經完成', evidence: [e] })
  assert.equal(v.ok, false, 'a universal claim on unknown completeness must be refused')
})


// ─── 6 ───────────────────────────────────────────────────────────────────────
test('*** queryScope inferred from audited source is marked as DEBT ***', async () => {
  const e = (await read('invoices', reply(rowsOf(1)))).evidence
  assert.equal(e.queryScope.declaredBy, 'reader',
    'the reader is asserting a property of a server it does not control — that is on record')
  assert.equal(e.queryScope.field, 'createdAt')
  assert.equal(e.queryScope.window, 'last_30_days')
})

test('*** an endpoint with no window says so explicitly, rather than omitting queryScope ***', async () => {
  const e = (await read('suppliers', reply(rowsOf(36)))).evidence
  assert.equal('queryScope' in e, true)
  assert.strictEqual(e.queryScope.field, null)
  assert.strictEqual(e.queryScope.window, null)
  assert.equal(e.queryScope.declaredBy, 'reader')
})

// ─── 7 ───────────────────────────────────────────────────────────────────────
test('*** ⛔ rowShape and queryScope cannot be confused ***', async () => {
  const e = (await read('inventory', reply(rowsOf(1)))).evidence
  assert.equal('rowShape' in e, true, 'the shape of a row')
  assert.equal('queryScope' in e, true, 'which rows were selected')
  assert.equal('scope' in e, false, 'the ambiguous word is retired entirely')
  assert.equal(e.rowShape.hasAsOf, false, 'inventory rows carry no as-of timestamp')
  assert.equal(ROW_SHAPE.inventory.hasLocation, false)
})

test('*** every endpoint is present in ROW_SHAPE, QUERY_SCOPE and SERVER_LIMITS ***', () => {
  const { PATHS } = require('./adapters/aromaSystemRead')
  const keys = Object.keys(PATHS).sort()
  for (const [name, table] of [['ROW_SHAPE', ROW_SHAPE], ['QUERY_SCOPE', QUERY_SCOPE], ['SERVER_LIMITS', SERVER_LIMITS]]) {
    assert.deepEqual(Object.keys(table).sort(), keys,
      name + ' must be TOTAL over the endpoints — a missing key is indistinguishable from ' +
      '「nothing to declare」, which is how DERIVATIONS_OF lost four endpoints')
  }
})

// ─── the pin the Owner asked for by name ─────────────────────────────────────
test('*** ⛔ a 30-day count cannot become a source-total claim, end to end ***', async () => {
  const e = (await read('invoices', reply(rowsOf(1)))).evidence
  const line = renderScopeLine(e)
  // The exact sentence that shipped: 「1 records exist」.
  assert.equal(line.includes('records exist'), false)
  assert.ok(line.includes('1'), 'the number is still reported — honestly: ' + line)
  assert.ok(/30|scope|window/i.test(line), 'and the window it belongs to is named: ' + line)
})

/* ═══ OWNER REVIEW CORRECTIONS, 2026-08-08 ════════════════════════════════════
 * Four P0 truth-semantic defects the Owner found in the first A1 cut. Each is a case
 * where a value was asserted more confidently than the evidence allows.
 */

test('*** ⛔ REVIEW 1: a capped count is NOT a matching total ***', async () => {
  // body.count is data.length AFTER the server's LIMIT, so on a capped response it is the
  // size of the page — not the size of the population that matched. The first A1 cut set
  // matchingTotal = body.count universally, which re-created the original defect one level
  // in: a page count wearing a population's clothes.
  const e = (await read('dailyCounts', reply(rowsOf(50)))).evidence
  assert.equal(e.returnedRows, 50)
  assert.equal(e.limit, 50)
  assert.strictEqual(e.matchingTotal, null,
    'truncation cannot be ruled out, so the matching population is UNKNOWN')
})

test('*** below the cap, the count IS the matching total ***', async () => {
  const e = (await read('purchaseOrders', reply(rowsOf(14)))).evidence
  assert.strictEqual(e.matchingTotal, 14, 'nothing was cut, so the count is the population')
})

test('*** ⛔ REVIEW 2: order-planning is capped at 100 ***', async () => {
  // Audited from aroma-system/server/routes/aiIntegration.ts. It uses RAW SQL — `LIMIT 100`
  // inside a template literal, twice — so a grep for drizzle's `.limit(` missed it and the
  // first A1 cut declared this endpoint unbounded. Searching for one spelling of a thing.
  assert.strictEqual(SERVER_LIMITS.orderPlanning, 100)
  const e = (await read('orderPlanning', reply(rowsOf(44)))).evidence
  assert.strictEqual(e.limit, 100)
  assert.strictEqual(e.truncated, false, '44 < 100')
  assert.strictEqual(e.matchingTotal, 44)
})

test('*** ⛔ REVIEW 3: unknown filters are null, never [] ***', async () => {
  // [] asserts 「known to have NO filters」. The server applies predicates the reader cannot
  // authoritatively enumerate — 30-day windows, and order-planning's own WHERE clauses.
  const e = (await read('invoices', reply(rowsOf(1)))).evidence
  assert.strictEqual(e.filtersApplied, null,
    'an empty array would claim the filter set is known to be empty')
  assert.equal('filtersApplied' in e, true, 'and it is still PRESENT, as an explicit unknown')
})

test('*** ⛔ REVIEW 4: limitKnown separates 「no limit」 from 「limit unknown」 ***', async () => {
  // KNOWN UNBOUNDED — audited: no cap exists in the route.
  const unbounded = (await read('inventory', reply(rowsOf(199)))).evidence
  assert.strictEqual(unbounded.limitKnown, true)
  assert.strictEqual(unbounded.limit, null)
  assert.strictEqual(unbounded.truncated, false, 'nothing can cut an uncapped query')
  assert.strictEqual(unbounded.completeWithinScope, true)
  assert.strictEqual(unbounded.matchingTotal, 199, 'and the count IS the population')

  // KNOWN BOUNDED.
  const bounded = (await read('invoices', reply(rowsOf(1)))).evidence
  assert.strictEqual(bounded.limitKnown, true)
  assert.strictEqual(bounded.limit, 100)
})

test('*** a source with no audited limit is limitKnown:false, and stays unknown throughout ***', () => {
  // The non-aroma descriptor. `limit: null` alone could not say which of the two states it
  // was in, and the difference decides whether truncation is establishable.
  const { describeRead } = require('./readContext')
  const e = describeRead('gmail', null, [{ entityType: 'email' }], false, '2026-08-08T00:00:00.000Z')
  assert.strictEqual(e.limitKnown, false)
  assert.strictEqual(e.limit, null)
  assert.strictEqual(e.truncated, null)
  assert.strictEqual(e.completeWithinScope, null)
  assert.strictEqual(e.filtersApplied, null)
})

/* ═══ OWNER REVIEW — A1 FINAL TRUTH BLOCKER ═══════════════════════════════════
 *
 * > **Owner: 「completeWithinScope=true means only: all rows matching the declared server query
 * > were returned without truncation. It does NOT mean: all records in the wider source were
 * > examined. Therefore the current positive test is wrong.」**
 *
 * ⛔ IT WAS. The removed test asserted that 14 purchase orders — complete within a THIRTY-DAY
 * window, with sourceTotal unknown — supported 「所有採購單都已收貨」. That is a source-wide
 * claim resting on a scoped read, and I wrote an assertion that licensed it. A test that
 * permits a false claim is worse than a missing test: it is a fence installed backwards.
 */

test('*** ⛔ complete WITHIN SCOPE does not support a SOURCE-WIDE universal claim ***', async () => {
  const e = (await read('purchaseOrders', reply(rowsOf(14)))).evidence
  // Everything the reader knows is true, and none of it is enough.
  assert.strictEqual(e.completeWithinScope, true, 'nothing was truncated')
  assert.strictEqual(e.matchingTotal, 14)
  assert.strictEqual(e.sourceTotal, null, 'and the wider source is UNKNOWN')
  assert.equal(e.queryScope.window, 'last_30_days', 'because the query was scoped')

  const v = checkEvidence({ claim: '所有採購單都已收貨', evidence: [e] })
  assert.equal(v.ok, false,
    'a 30-day slice cannot support a claim about every purchase order')
})

test('*** sourceTotal=null can never support an unqualified source-wide universal ***', async () => {
  // The unwindowed endpoints too: no window is not the same as known coverage.
  for (const ep of ['inventory', 'suppliers', 'orderPlanning']) {
    const e = (await read(ep, reply(rowsOf(10)))).evidence
    assert.strictEqual(e.sourceTotal, null)
    const v = checkEvidence({ claim: '所有項目都已經處理', evidence: [e] })
    assert.equal(v.ok, false, ep + ': coverage of the wider source is not established')
  }
})

test('*** it DOES pass when coverage is structurally established ***', async () => {
  // The only shape that earns it: nothing truncated, both totals known, and equal.
  const e = (await read('invoices', reply(rowsOf(4), { sourceTotal: 4 }))).evidence
  assert.strictEqual(e.completeWithinScope, true)
  assert.strictEqual(e.matchingTotal, 4)
  assert.strictEqual(e.sourceTotal, 4)
  const v = checkEvidence({ claim: '所有發票都已經入帳', evidence: [e] })
  assert.equal(v.ok, true, 'matchingTotal === sourceTotal is the structural proof of coverage')
})

test('*** and NOT when the totals are known but differ ***', async () => {
  const e = (await read('invoices', reply(rowsOf(1), { sourceTotal: 471 }))).evidence
  assert.strictEqual(e.matchingTotal, 1)
  assert.strictEqual(e.sourceTotal, 471)
  const v = checkEvidence({ claim: '所有發票都已經入帳', evidence: [e] })
  assert.equal(v.ok, false, '1 of 471 is the DEFECT-009 case and must never pass')
})

test('*** ⛔ body.count is never called matchingTotal before it has been qualified ***', async () => {
  // STATIC, and honestly so: this pins a NAME at the request layer, which no runtime check
  // can see. The name is the defect — a local called `matchingTotal` holding an unqualified
  // page count is how the wrong meaning travels to the next reader.
  const fs = require('node:fs')
  const path = require('node:path')
  const src = fs.readFileSync(path.join(__dirname, 'adapters', 'aromaSystemRead.js'), 'utf8')
  const assigns = [...src.matchAll(/const\s+(\w+)\s*=\s*Number\.isFinite\(body && body\.count\)/g)].map((m) => m[1])
  assert.ok(assigns.length > 0, 'the body.count read must still exist')
  for (const name of assigns) {
    assert.notEqual(name, 'matchingTotal',
      'body.count is a RESPONSE COUNT until matchingTotalOf() rules out truncation')
  }
})

/* ═══ OWNER REVIEW — THE DORMANT BLANKET BYPASS ═══════════════════════════════
 *
 * > **Owner: 「Even though `admitsLimitation` has no production setter today, the Evidence
 * > Truth Contract must not contain a dormant blanket bypass that could become live when a
 * > caller is wired later.」**
 *
 * `if (admitsLimitation) return { ok: true }` sat BEFORE every truncation, sample and
 * coverage check. A single boolean, set by anyone, disabled the whole contract. It was
 * harmless only by the accident of nothing setting it — and 「harmless because unwired」 is
 * exactly the state that ends the day something gets wired.
 */

test('*** ⛔ admitsLimitation cannot license a universal claim with sourceTotal unknown ***', async () => {
  const e = (await read('purchaseOrders', reply(rowsOf(14)))).evidence
  assert.strictEqual(e.sourceTotal, null)
  const v = checkEvidence({ claim: '所有採購單都已收貨', evidence: [e], admitsLimitation: true })
  assert.equal(v.ok, false, 'a caller-supplied boolean may not overrule the structural coverage test')
})

test('*** ⛔ admitsLimitation cannot license a claim from a TRUNCATED read ***', async () => {
  const truncated = { source: 'aroma_system', trust: 'live', truncated: true, shownCount: 5, matchingTotal: null, sourceTotal: null }
  const v = checkEvidence({ claim: '呢批貨已經齊晒', evidence: [truncated], admitsLimitation: true })
  assert.equal(v.ok, false, 'truncation is a fact about the read; a claim cannot assert it away')
})

test('*** the parameter is INERT, not merely deprioritised ***', async () => {
  // Passing it must change nothing at all, in either direction — including on a claim that
  // already passes. An argument that sometimes matters is worse than one that never does.
  const e = (await read('invoices', reply(rowsOf(4), { sourceTotal: 4 }))).evidence
  const claim = '所有發票都已經入帳'
  const withFlag = checkEvidence({ claim, evidence: [e], admitsLimitation: true })
  const without = checkEvidence({ claim, evidence: [e] })
  assert.deepEqual(withFlag, without, 'identical verdicts with and without the flag')
})
