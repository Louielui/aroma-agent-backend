'use strict'

/**
 * noIntentNoRead.test.js — no intent match means READ NOTHING.
 *
 * ── THE DEFAULT BEING DELETED ────────────────────────────────────────────────
 *   readContext.js   aromaMethodFor: `return (hit && hit.method) || 'listInventory'`
 *
 * That single `||` is why 「現在是幾點？」 came back with 199 inventory rows. The read was
 * never wrong about what it was asked for — it was asked for the wrong thing, because a
 * message matching no business intent was quietly treated as a stock question.
 *
 * UTILITY now catches the clock, but the default sat there for every OTHER unmatched
 * message, so the same failure was one unfamiliar phrasing away. It is deleted, not gated:
 * a dormant default is one refactor from being reachable again, and it is silent when it
 * fires.
 *
 * ── THE TRAP THIS TEST FILE EXISTS TO CATCH ──────────────────────────────────
 * "Not asked" must NOT become "could not be read". `planFor` returning `{ unavailable }`
 * would set trust:'unavailable', emit an `UNAVAILABLE:` line, and the safety header
 * instructs the model to say 目前讀不到 for those — so she would tell the Owner she could
 * not read the restaurant's own system, which is FALSE. There is a third outcome, and the
 * assertions below pin it: the source is absent, not failed.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { planFor, aromaMethodFor, intentFor, buildReadContext } = require('./readContext')

/* ═══ 1. THE CONTRACT OF aromaMethodFor ════════════════════════════════════ */

test('*** no intent match returns NULL, not listInventory ***', () => {
  for (const msg of ['', '今日天氣點', 'how are we doing', 'what is the position', '你好', '現在是幾點？']) {
    assert.equal(aromaMethodFor(msg), null, `"${msg}" must not become a stock question`)
  }
})

test('*** every business intent still returns exactly the method it always did ***', () => {
  // The Owner's working paths. These must be byte-identical afterwards.
  const FROZEN = [
    ['最近有咩發票？', 'listInvoices'],
    ['張採購單點', 'listPurchaseOrders'],
    ['邊個供應商', 'listSuppliers'],
    ['今日盤點', 'listDailyCounts'],
    ['要訂咩貨', 'listOrderPlanning'],
    ['而家倉存入面有咩？', 'listInventory']
  ]
  for (const [msg, method] of FROZEN) assert.equal(aromaMethodFor(msg), method, msg)
})

test('an intent that asks nothing of Aroma System also returns null', () => {
  // schedule / mail / document / code carry method:null in the intent table. They used to
  // fall through the `||` to listInventory — so a calendar question read stock.
  for (const msg of ['今個星期有咩安排', '有咩新郵件', '搵份文件', '睇下個 repo']) {
    assert.ok(intentFor(msg), msg + ' does match an intent')
    assert.equal(aromaMethodFor(msg), null, msg + ' must ask nothing of Aroma System')
  }
})

/* ═══ 2. planFor: A THIRD OUTCOME, NOT A FAILURE ═══════════════════════════ */

test('*** an unmatched message yields notAsked — NOT a plan and NOT unavailable ***', () => {
  const p = planFor('aroma_system', { keywords: [], message: '現在是幾點？', env: {} })
  assert.equal(p.method, undefined, 'no method means no read')
  assert.equal(p.unavailable, undefined, 'NOT unavailable — it was not asked, which is different')
  assert.ok(p.notAsked, 'the third outcome is explicit: ' + JSON.stringify(p))
})

test('a matched message still yields the same plan it always did', () => {
  const p = planFor('aroma_system', { keywords: ['發票'], message: '最近有咩發票？', env: {} })
  assert.equal(p.method, 'listInvoices')
  assert.equal(p.notAsked, undefined)
  assert.ok(p.params && Number.isFinite(p.params.limit))
})

/* ═══ 3. END TO END: THE SOURCE IS ABSENT, NOT FAILED ══════════════════════ */

/**
 * A connector that records which source+method was actually called.
 *
 * THE REAL INTERFACE IS `read(source, method, params) -> { results: [{trust:'live', …}] }`.
 * My first version implemented `call()` returning `{items}`, so every read THREW, became
 * `unavailable`, and recorded zero calls — and the "calls the connector ZERO times" test
 * passed while measuring nothing. Same false-green shape as the answerer tests that never
 * crossed the router: the assertion was true for the wrong reason.
 *
 * The `EARNED` check below exists so that can never happen again silently: a test that
 * expects zero calls first proves the spy CAN record one.
 */
function spyConnector (rows = []) {
  const calls = []
  return {
    calls,
    connector: {
      read: async (source, method) => {
        calls.push(source + '.' + method)
        return { results: rows.map((r) => Object.assign({ trust: 'live', source }, r)) }
      }
    }
  }
}

const read = async (message, spy) => buildReadContext({
  connector: spy.connector, message, sources: ['aroma_system'], env: {}
})

/** EARN THE ZERO: prove the spy records a call before trusting that it recorded none. */
test('the spy connector actually records calls (so a zero below means something)', async () => {
  const spy = spyConnector([{ sourceId: '1', title: 'INV-001' }])
  await read('最近有咩發票？', spy)
  assert.ok(spy.calls.length > 0, 'if this fails, every zero-call assertion here is vacuous')
})

test('*** an unmatched message calls the connector ZERO times ***', async () => {
  const spy = spyConnector()
  const rc = await read('現在是幾點？', spy)
  assert.deepEqual(spy.calls, [], 'THE DEFECT: this called aroma_system.listInventory')
  assert.deepEqual(rc.itemsBySource.flatMap((g) => g.items), [], 'and no rows exist')
})

test('*** and she does NOT claim the system was unreadable ***', async () => {
  // The honesty half. An UNAVAILABLE line would make her say 目前讀不到 about a system that
  // was simply never asked — a false read-failure claim, which is the exact class of defect
  // the read-state guard exists to catch.
  const spy = spyConnector()
  const rc = await read('現在是幾點？', spy)
  const row = rc.perSource.find((r) => r.source === 'aroma_system')
  assert.equal(row, undefined, 'the source is ABSENT from the turn, not marked failed')
  // A *LINE*, not the word. My first version matched /UNAVAILABLE/ and failed on the safety
  // header's own prose, which explains the convention — measuring the explanation instead of
  // the claim, the same trap as scanning source text that names the bug in a comment.
  const block = rc.block || ''
  assert.equal(/\[aroma_system\]\s*UNAVAILABLE/.test(block), false, 'no UNAVAILABLE line: ' + block)
  assert.equal(/\[aroma_system\]/.test(block), false, 'the source contributes no line at all')
})

test('*** with nothing asked and nothing read, there is no block at all ***', async () => {
  // Before this change every source produced a line, so a block always had content. A
  // skipped source produces none — and a header-only shell would have cost ~350 tokens of
  // prose announcing excerpts that are not there, on every unmatched turn.
  const spy = spyConnector()
  const rc = await read('現在是幾點？', spy)
  assert.equal(rc.block, null, 'read nothing means inject nothing')
  assert.deepEqual(rc.perSource, [])
})

test('*** a business question is untouched — it still reads, with the right method ***', async () => {
  const rows = [{ id: '1', name: 'INV-001', amount: 100 }]
  for (const [msg, method] of [
    ['最近有咩發票？', 'listInvoices'],
    ['而家倉存入面有咩？', 'listInventory'],
    ['邊個供應商未找數', 'listSuppliers'],
    ['張採購單點', 'listPurchaseOrders']
  ]) {
    const spy = spyConnector(rows)
    await read(msg, spy)
    assert.deepEqual(spy.calls, ['aroma_system.' + method], msg)
  }
})

test('a source that genuinely fails is still reported as unavailable', () => {
  // The third outcome must not swallow the second. github with no repo configured is a real
  // "cannot be read", and it must keep saying so.
  const p = planFor('github', { keywords: [], message: '睇下個 repo', env: {} })
  assert.ok(p.unavailable, 'a real failure still reports itself: ' + JSON.stringify(p))
})

/* ═══ 4. ZERO ROWS MEANS SHE ANSWERS FREELY — PROVEN, NOT ASSUMED ══════════ */

test('*** zero rows → no responseFormat, so no Answer Plan is forced ***', async () => {
  // The Owner asked for this to be proved rather than asserted. answerPlanFormat() returns
  // undefined when turnItems is empty, and the only observable proof is what the adapter is
  // actually handed — so this reads the real call options from a spy, through processIntake.
  const { processIntake } = require('../intake/intakeService')
  const calls = []
  const adapter = {
    name: 'spy',
    async complete (prompt, o) {
      calls.push({ responseFormat: (o && o.responseFormat) || null })
      return { text: JSON.stringify({ intent: 'question', mode: 'chat', reply: '好的。' }), provider: 'claude', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'spy' }
    }
  }
  const saved = { ...process.env }
  Object.assign(process.env, {
    TURN_ROUTER: 'off', READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on'
  })
  try {
    const spy = spyConnector()
    // A message with no business intent: nothing is read, so no rows exist.
    await processIntake('你今日點呀？', adapter, [], {
      interactionMode: 'chat',
      demo: false,
      readContextDeps: { connector: spy.connector, sources: ['aroma_system'] }
    })
    assert.deepEqual(spy.calls, [], 'nothing was read')
    assert.equal(calls.length, 1, 'the model was called once')
    assert.equal(calls[0].responseFormat, null, 'and handed NO schema — she answers freely')
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
    Object.assign(process.env, saved)
  }
})

test('*** and a business question with rows DOES get the plan schema ***', async () => {
  // The other half: proving the format is undefined is only meaningful if it is defined when
  // rows exist. Otherwise the assertion above could pass because the schema never appears.
  const { processIntake } = require('../intake/intakeService')
  const calls = []
  const adapter = {
    name: 'spy',
    async complete (prompt, o) {
      calls.push({ responseFormat: (o && o.responseFormat) || null })
      return { text: JSON.stringify({ intent: 'question', mode: 'chat', reply: '好的。' }), provider: 'claude', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'spy' }
    }
  }
  const saved = { ...process.env }
  Object.assign(process.env, { TURN_ROUTER: 'off', READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on' })
  try {
    const spy = spyConnector([{ sourceId: '1', title: 'INV-001', originalDate: '2026-08-01' }])
    await processIntake('最近有咩發票？', adapter, [], {
      interactionMode: 'chat',
      demo: false,
      readContextDeps: { connector: spy.connector, sources: ['aroma_system'] }
    })
    assert.deepEqual(spy.calls, ['aroma_system.listInvoices'], 'it read the invoice endpoint')
    assert.ok(calls[0].responseFormat, 'rows exist, so the plan schema IS requested')
    assert.equal(calls[0].responseFormat.type, 'json_schema')
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
    Object.assign(process.env, saved)
  }
})
