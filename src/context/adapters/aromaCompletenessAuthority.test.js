'use strict'

/**
 * aromaCompletenessAuthority.test.js — WHOSE WORD PROVES A CAPPED RANKING COMPLETE.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE DISTINCTION THIS FILE EXISTS TO KEEP.
 *
 * There are TWO facts named "truncated" and they are not interchangeable:
 *
 *   truncationOf(returnedRows, limit, limitKnown)  — the READER inferring, from a post-limit
 *     count and a constant obtained by auditing someone else's source. 45 rows under a cap of
 *     100 yields `false`.
 *   serverTruncatedOf(body)                        — the SERVER stating it, as a literal boolean.
 *
 * Promoting the first to ranking authority is precisely the substitution that produced
 * DEFECT-009: a page count wearing a population's clothes. So for a CAPPED endpoint only the
 * server's word counts, and every other shape — absent, null, "false", 0 — keeps the old refusal.
 *
 * ⛔ AND THAT IS WHAT MAKES THE ROLLOUT SAFE IN EITHER ORDER. An old server sends no field and
 * behaves exactly as today; a new server sends one and unlocks nothing else.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   Run: node --test src/context/adapters/aromaCompletenessAuthority.test.js
 */

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const mod = require('./aromaSystemRead')
const { createAromaSystemReadAdapter, serverTruncatedOf, truncationOf, SERVER_LIMITS, CLIENT_ROW_LIMITS } = mod

/** Identity-only rows: an index and the fields the reader needs. Never business content. */
const rows = (n) => Array.from({ length: n }, (_, i) => ({
  id: 'row-' + i, ingredientName: 'item-' + i, currentStock: i, parLevel: 1000, suggestedOrderQty: 1000 - i
}))

/**
 * One read against a scripted body.
 *
 * ⛔ NO NETWORK. `fetchFn` is injected, which the adapter treats as a test choosing exactly what
 * happens next — the live-egress fence keys on the DEFAULT transport only, so nothing here can
 * reach a real Aroma System.
 */
async function read (endpointKey, body) {
  const adapter = createAromaSystemReadAdapter({
    apiKey: 'test-key-not-a-secret',
    baseUrl: 'http://127.0.0.1:0',
    clock: () => '2026-08-24T00:00:00.000Z',
    fetchFn: async () => ({ ok: true, status: 200, json: async () => body })
  })
  return adapter.readWithState(endpointKey, {})
}

const ORDER_PLANNING = 'orderPlanning'
const CAP = SERVER_LIMITS.orderPlanning // 100

describe('the extractor accepts only a literal boolean', () => {
  test('*** ⛔ EVERY NON-BOOLEAN SHAPE IS 「NOT STATED」 ***', () => {
    assert.equal(serverTruncatedOf({ truncated: false }), false)
    assert.equal(serverTruncatedOf({ truncated: true }), true)
    for (const body of [
      {}, null, undefined, [], 'x', 42,
      { truncated: null }, { truncated: 'false' }, { truncated: 'true' },
      { truncated: 0 }, { truncated: 1 }, { truncated: undefined }, { truncated: {} },
      // Nested carriers. A body is not a place to go looking for a convenient boolean: the
      // contract names ONE top-level field, and anything that would also accept a nested one
      // lets any object we happen to be handed — including model-shaped output — name itself
      // the authority. Depth is not provenance.
      { meta: { truncated: false } }, { meta: { truncated: true } },
      { data: { truncated: false } }, { result: { truncated: false } },
      { body: { truncated: false } }, { response: { truncated: false } },
      { truncated: { value: false } }, { meta: { meta: { truncated: false } } }
    ]) {
      assert.equal(serverTruncatedOf(body), null, '⛔ accepted a non-boolean: ' + JSON.stringify(body))
    }
  })

  test('the reader inference is still its own separate function, unchanged', () => {
    assert.equal(truncationOf(45, 100, true), false, 'reader still infers under-cap as false')
    assert.equal(truncationOf(100, 100, true), null, 'and still refuses to guess at the cap')
  })
})

describe('a capped ranking is proven only by the server', () => {
  const ev = async (body) => (await read(ORDER_PLANNING, body)).evidence

  test('*** ⛔ A — server truncated:false PROVES the capped ranking complete ***', async () => {
    const e = await ev({ success: true, count: 45, data: rows(45), truncated: false })
    assert.equal(e.rankingCompleteWithinScope, true, '⛔ the server said it was complete and was not believed')
    assert.equal(e.truncationAuthority, 'server')
    assert.equal(e.serverTruncated, false)
  })

  test('*** ⛔ B — server truncated:true REFUSES it ***', async () => {
    const e = await ev({ success: true, count: CAP, data: rows(CAP), truncated: true })
    assert.equal(e.rankingCompleteWithinScope, false)
    assert.equal(e.truncationAuthority, 'server')
  })

  test('*** ⛔ C — NO FIELD AT ALL keeps today’s refusal (old server, new consumer) ***', async () => {
    const e = await ev({ success: true, count: 45, data: rows(45) })
    assert.equal(e.rankingCompleteWithinScope, false, '⛔ an old server silently unlocked a ranking')
    assert.equal(e.truncationAuthority, 'reader')
    assert.equal(e.serverTruncated, null)
  })

  test('*** ⛔ D — MALFORMED VALUES ALL REFUSE ***', async () => {
    for (const t of [null, 'false', 'true', 0, 1, {}, []]) {
      const e = await ev({ success: true, count: 45, data: rows(45), truncated: t })
      assert.equal(e.rankingCompleteWithinScope, false, '⛔ accepted ' + JSON.stringify(t))
      assert.equal(e.truncationAuthority, 'reader')
    }
  })

  test('*** ⛔ E — READER INFERENCE ALONE MUST NOT GRANT AUTHORITY ***', async () => {
    // 45 rows under a cap of 100: truncationOf() says `false`, and that is exactly the opinion
    // that must not become proof. Without a server statement the ranking stays refused.
    const e = await ev({ success: true, count: 45, data: rows(45) })
    assert.equal(truncationOf(45, CAP, true), false, 'the reader does infer false here')
    assert.equal(e.rankingCompleteWithinScope, false, '⛔ reader inference was promoted to authority')
  })

  test('*** ⛔ L — A NESTED CARRIER MUST NOT FORGE AUTHORITY ***', async () => {
    // The dangerous version of C. Here the body DOES contain `truncated: false` — just not
    // where the contract puts it. A reader that searched for the field instead of reading the
    // declared one would call this proof, and then anything with a `meta` could grant itself
    // ranking authority. It stays refused, and it stays attributed to the reader.
    for (const body of [
      { success: true, count: 45, data: rows(45), meta: { truncated: false } },
      { success: true, count: 45, data: rows(45), result: { truncated: false } },
      { success: true, count: 45, data: rows(45), truncated: { value: false } }
    ]) {
      const e = await ev(body)
      assert.equal(e.serverTruncated, null, '⛔ a nested value was read as a server statement')
      assert.equal(e.truncationAuthority, 'reader', '⛔ authority was credited to the server')
      assert.equal(e.rankingCompleteWithinScope, false, '⛔ a forged field unlocked a ranking')
    }
  })

  test('*** ⛔ F — EXACT FIT: cap rows + server truncated:false is provable ***', async () => {
    // The case the reader can never settle alone — truncationOf returns null here.
    const e = await ev({ success: true, count: CAP, data: rows(CAP), truncated: false })
    assert.equal(truncationOf(CAP, CAP, true), null, 'the reader cannot tell')
    assert.equal(e.rankingCompleteWithinScope, true, 'the server can, and did')
    assert.equal(e.truncationAuthority, 'server')
  })

  test('*** ⛔ G — AN UNBOUNDED RANKED ENDPOINT IS UNCHANGED ***', async () => {
    // inventory is audited unbounded: nothing could cut it, so the audit alone still proves it
    // and no server field is required.
    assert.equal(SERVER_LIMITS.inventory, null)
    const e = (await read('inventory', { success: true, count: 199, data: rows(199) })).evidence
    assert.equal(e.rankingCompleteWithinScope, true, '⛔ an unbounded ranking was newly blocked')
    assert.equal(e.truncationAuthority, 'reader', 'and it still rests on the audit, honestly labelled')
  })

  test('*** ⛔ H — THE CLIENT ROW CAP IS UNTOUCHED ***', async () => {
    assert.equal(CLIENT_ROW_LIMITS.orderPlanning, 25)
    const r = await read(ORDER_PLANNING, { success: true, count: 45, data: rows(45), truncated: false })
    assert.equal(r.results.length, 25, '⛔ the client cap moved')
    assert.equal(r.evidence.completeness, 'sample', 'and the client-side sample is still declared as one')
  })

  test('*** ⛔ I — NO HIDDEN SENTINEL ROW CAN REACH THE RESULT ***', async () => {
    // The server never sends the cap+1 row, but if a future one did, the client cap and the
    // ordering must still bound what a caller sees.
    const r = await read(ORDER_PLANNING, { success: true, count: CAP, data: rows(CAP + 1), truncated: true })
    assert.ok(r.results.length <= CLIENT_ROW_LIMITS.orderPlanning)
    assert.equal(r.results.some((x) => String(x.id) === 'row-' + CAP), false, '⛔ a sentinel row surfaced')
  })
})

describe('the change stays ranking-specific', () => {
  test('*** ⛔ J — matchingTotal AND completeWithinScope KEEP READER SEMANTICS ***', async () => {
    // ⛔ DELIBERATE. `queryScope.declaredBy` is still 'reader', so letting a server truncation
    // flag strengthen general completeness would let a negative-existence claim rest on a scope
    // only the reader declared. Fail closed: this tranche settles ONE fact, the cap.
    const e = (await read(ORDER_PLANNING, { success: true, count: CAP, data: rows(CAP), truncated: false })).evidence
    assert.equal(e.completeWithinScope, null, '⛔ general completeness was strengthened by a ranking fact')
    assert.equal(e.matchingTotal, null, '⛔ a post-limit count became a population')
    assert.equal(e.queryScope.declaredBy, 'reader', 'scope authority is explicitly NOT migrated here')
    assert.equal(e.rankingCompleteWithinScope, true, 'while the ranking fact itself is proven')
  })

  test('*** ⛔ K — rankingProof.js IS BYTE-IDENTICAL TO BASELINE ***', async () => {
    const p = path.resolve(__dirname, '..', '..', 'intake', 'rankingProof.js')
    const sha = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
    assert.equal(sha, '0ae27a1a6d9bc1d065cd027b7d75b18d6668040bdf561565d59369c7be38a4c8', '⛔ rankingProof.js changed in a tranche that must not touch it')
  })
})

describe('cross-repo compatibility — staged rollout in either order', () => {
  test('OLD server shape + NEW consumer behaves exactly like today', async () => {
    const e = (await read(ORDER_PLANNING, { success: true, count: 45, data: rows(45) })).evidence
    assert.equal(e.rankingCompleteWithinScope, false)
    assert.equal(e.serverTruncated, null)
    assert.equal(e.truncationAuthority, 'reader')
  })

  test('NEW server shape + NEW consumer may prove a capped ranking', async () => {
    const e = (await read(ORDER_PLANNING, { success: true, count: 45, data: rows(45), truncated: false })).evidence
    assert.equal(e.rankingCompleteWithinScope, true)
  })

  test('NEW server saying truncated:true is still refused', async () => {
    const e = (await read(ORDER_PLANNING, { success: true, count: CAP, data: rows(CAP), truncated: true })).evidence
    assert.equal(e.rankingCompleteWithinScope, false)
  })
})
