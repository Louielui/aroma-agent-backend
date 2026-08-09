'use strict'

/**
 * routingGovernsReads.test.js — Step 3. The route decides what is read.
 *
 * ── WHAT CHANGES ─────────────────────────────────────────────────────────────
 * Until now the read guard asked only "is this the chat lane and is READ_ACCESS on", so
 * every enabled source was read on every chat turn. 「你可以幫我做什麼？」 paid for four
 * connectors and thirteen rows, and those rows then forced an Answer Plan. Now:
 *
 *   CONVERSATION / UTILITY   read nothing
 *   BUSINESS_QUERY           reads ONLY the single source its intent names
 *   ACTION                   unchanged
 *
 * ── THE OWNER'S RULING ON DECLARED SOURCES ───────────────────────────────────
 * An intent's `sources` is a HINT about where an answer might live, not an authorisation to
 * read. Three intents named Gmail as a second source — invoice, purchase_order, supplier —
 * and Gmail is the most sensitive connector here. An invoice report EMAIL is not the invoice
 * RECORD, and she has already been seen citing a Gmail summary as though it were data. If
 * the restaurant system cannot answer, the honest reply is that it could not; reaching into
 * mail on a hunch is the wrong default. Each intent may now name at most the ONE source that
 * authoritatively holds that entity.
 *
 * ── EARN THE ZERO ────────────────────────────────────────────────────────────
 * Two zero-call assertions this week passed while measuring nothing: one spy implemented the
 * wrong connector method, another test never crossed the router. Every zero below is
 * preceded by a proof that the same spy CAN record a call.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')
const { INTENTS } = require('../context/readContext')
const { routeTurn } = require('./turnRouter')

/* ═══ 1. THE SOURCE TABLE, AFTER THE RULING ════════════════════════════════ */

test('*** no intent names more than one source ***', () => {
  const offenders = INTENTS.filter((i) => (i.sources || []).length !== 1)
    .map((i) => i.key + ':' + JSON.stringify(i.sources))
  assert.deepEqual(offenders, [], 'an intent may name at most the one authoritative source')
})

test('*** the three that named Gmail now name only the restaurant system ***', () => {
  for (const key of ['invoice', 'purchase_order', 'supplier']) {
    const i = INTENTS.find((x) => x.key === key)
    assert.deepEqual(i.sources, ['aroma_system'], key + ' must not reach into mail on a hunch')
  }
})

test('a mail question still reads mail — that is the domain, not a hunch', () => {
  assert.deepEqual(INTENTS.find((i) => i.key === 'mail').sources, ['gmail'])
  assert.deepEqual(INTENTS.find((i) => i.key === 'schedule').sources, ['calendar'])
  assert.deepEqual(INTENTS.find((i) => i.key === 'document').sources, ['drive'])
  assert.deepEqual(INTENTS.find((i) => i.key === 'code').sources, ['github'])
})

test('and the router hands the same single source through', () => {
  assert.deepEqual(routeTurn('最近有咩發票？').sources, ['aroma_system'])
  assert.deepEqual(routeTurn('今日有咩安排？').sources, ['calendar'])
  assert.deepEqual(routeTurn('你可以幫我做什麼？').sources, [])
  assert.deepEqual(routeTurn('現在是幾點？').sources, [])
})

/* ═══ 2. THE LIVE TURN ═════════════════════════════════════════════════════ */

const ALL = ['drive', 'gmail', 'calendar', 'github', 'aroma_system']

/** Records every source+method the pipeline actually asks for. */
function spyConnector (rows = []) {
  const calls = []
  return {
    calls,
    sources: () => [...new Set(calls.map((c) => c.split('.')[0]))],
    connector: {
      read: async (source, method) => {
        calls.push(source + '.' + method)
        return { results: rows.map((r) => Object.assign({ trust: 'live', source }, r)) }
      }
    }
  }
}

function spyAdapter () {
  const calls = []
  return {
    calls,
    name: 'spy',
    async complete (prompt, o) {
      calls.push({ responseFormat: (o && o.responseFormat) || null })
      return { text: JSON.stringify({ intent: 'question', mode: 'chat', reply: '好的。' }), provider: 'claude', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'spy' }
    }
  }
}

const withEnv = async (vars, fn) => {
  const saved = {}
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

const LIVE = {
  TURN_ROUTER: 'on',
    // ⛔ A4 off: this pins the AUTOMATIC-READ contract, which A4-1 deliberately replaces.
    A4_KNOWLEDGE_ROUTING: 'off',
  READ_ACCESS: 'on',
  CONTEXT_DRIVE: 'on',
  CONTEXT_GMAIL: 'on',
  CONTEXT_CALENDAR: 'on',
  CONTEXT_GITHUB: 'on',
  CONTEXT_AROMA_SYSTEM: 'on'
}

async function turn (message, env = {}, rows = [{ sourceId: '1', title: 'ROW', originalDate: '2026-08-01' }]) {
  const a = spyAdapter()
  const c = spyConnector(rows)
  const res = await withEnv(Object.assign({}, LIVE, env), () =>
    processIntake(message, a, [], {
      interactionMode: 'chat',
      demo: false,
      readContextDeps: { connector: c.connector, sources: ALL }
    }))
  return { res, model: a.calls, reads: c.calls, sources: c.sources() }
}

/* ── EARN THE ZERO ────────────────────────────────────────────────────────── */

test('the spy records calls — every zero below is measured, not vacuous', async () => {
  const t = await turn('最近有咩發票？')
  assert.ok(t.reads.length > 0, 'if this fails, every zero-call assertion in this file is meaningless')
  assert.ok(t.model.length > 0, 'and the adapter spy records too')
})

/* ── the defect that started this ─────────────────────────────────────────── */

test('*** a capability question performs ZERO connector calls ***', async () => {
  const t = await turn('你可以幫我做什麼？')
  assert.deepEqual(t.reads, [], 'THE DEFECT: this paid for 4 sources and 13 rows')
  assert.deepEqual(t.sources, [])
})

/**
 * ⛔ NO ANSWER PLAN — WHICH IS NOT THE SAME AS NO SCHEMA (A3 first-read initiation).
 *
 * These three assertions used to read `responseFormat === null`. That was stronger than the
 * rule they exist to protect, and the extra strength was itself a defect: with no schema there
 * is no `nextRead`, so on a zero-row turn the model had no structural way to ask for a read,
 * and 「你能看到 aroma system 嗎？」 was answered 「我無法確認」 with the connector authorised
 * and working.
 *
 * The rule is unchanged and is what is checked now: the ROUTE decides whether an evidence-shaped
 * ANSWER PLAN may be demanded, independently of the row count. A read DECISION is not evidence
 * and forces nothing to be cited.
 */
function assertNoPlanDemanded (fmt, why) {
  assert.notEqual(fmt, null, why + ': the decision surface must still exist')
  assert.equal(fmt.name, 'distill_with_read_decision', why)
  assert.equal(fmt.schema.properties.answerPlan, undefined, why + ': nothing evidence-shaped is demanded')
}

test('*** and demands NO Answer Plan — no rows, and not a business route either ***', async () => {
  const t = await turn('你可以幫我做什麼？')
  assert.equal(t.model.length, 1, 'the model was called once')
  assertNoPlanDemanded(t.model[0].responseFormat, 'she answers freely')
})

test('*** an ordinary conversational turn reads nothing ***', async () => {
  for (const q of ['你好', '你今日點呀？', '多謝晒']) {
    const t = await turn(q)
    assert.deepEqual(t.reads, [], q)
  }
})

test('A JUDGEMENT BOUNDARY, recorded rather than hidden', async () => {
  // 「我諗緊下星期點安排人手」 contains 安排, which the schedule intent owns, so it routes
  // BUSINESS_QUERY and reads the calendar. I had assumed it would read nothing and my test
  // said so; the behaviour is defensible — it is a scheduling-adjacent question — and the
  // point of Step 3 holds either way: ONE source instead of the five it used to read.
  //
  // Whether thinking aloud about staffing should open the calendar at all is the Owner's
  // call, and exactly the kind of thing the shadow log exists to surface. Pinned here so a
  // future change to it is deliberate.
  const t = await turn('我諗緊下星期點安排人手')
  assert.deepEqual(t.sources, ['calendar'], 'one source, not five')
})

test('*** a utility turn reads nothing and never reaches the model ***', async () => {
  const t = await turn('現在是幾點？')
  assert.deepEqual(t.reads, [])
  assert.equal(t.model.length, 0)
})

/* ── business questions read exactly one source ───────────────────────────── */

test('*** an invoice question reads aroma_system and NOT Gmail ***', async () => {
  const t = await turn('最近有咩發票？')
  assert.deepEqual(t.sources, ['aroma_system'], 'the ruling, live: ' + JSON.stringify(t.reads))
  assert.equal(t.sources.includes('gmail'), false, 'the most sensitive connector is not read on a hunch')
})

test('*** each business question reads exactly its own one source ***', async () => {
  const cases = [
    ['最近有咩發票？', ['aroma_system']],
    ['張採購單點', ['aroma_system']],
    ['邊個供應商未找數', ['aroma_system']],
    ['而家倉存入面有咩？', ['aroma_system']],
    ['今日有咩安排？', ['calendar']],
    ['有咩新郵件', ['gmail']],
    ['搵份文件', ['drive']]
  ]
  for (const [q, want] of cases) {
    const t = await turn(q)
    assert.deepEqual(t.sources, want, q + ' -> ' + JSON.stringify(t.reads))
  }
})

test('*** a business question with rows DOES get the plan schema ***', async () => {
  const t = await turn('最近有咩發票？')
  assert.ok(t.model[0].responseFormat, 'rows exist on a business route')
  assert.equal(t.model[0].responseFormat.type, 'json_schema')
})

test('*** a business route with NO rows still demands no plan ***', async () => {
  const t = await turn('最近有咩發票？', {}, [])
  assert.deepEqual(t.sources, ['aroma_system'], 'it did read')
  assertNoPlanDemanded(t.model[0].responseFormat, 'nothing came back, so nothing to cite')
})

/* ── the gate does not lean on there being no rows ────────────────────────── */

test('*** rows on a NON-business route can never force a plan ***', async () => {
  // The Owner's requirement in full: the gate is on the ROUTE, independently of whether rows
  // exist. Reads are governed now so a CONVERSATION turn should have none — but if a future
  // change ever put rows on that path, the schema must still not appear. Proven by injecting
  // a source list the route did not ask for.
  const a = spyAdapter()
  const c = spyConnector([{ sourceId: '1', title: 'ROW' }])
  await withEnv(LIVE, () => processIntake('你好', a, [], {
    interactionMode: 'chat',
    demo: false,
    // forceSources bypasses the route's own list — the only way to create the situation.
    readContextDeps: { connector: c.connector, sources: ALL, forceSources: true }
  }))
  assertNoPlanDemanded(a.calls[0].responseFormat, 'route, not row count, decides the plan')
})

/* ── rollback ─────────────────────────────────────────────────────────────── */

test('*** TURN_ROUTER=shadow keeps Step 2 behaviour — reads are NOT governed ***', async () => {
  const t = await turn('你可以幫我做什麼？', { TURN_ROUTER: 'shadow' })
  assert.ok(t.reads.length > 0, 'shadow still reads everything; only UTILITY acts')
})

test('*** TURN_ROUTER=off keeps pre-router behaviour — a live rollback target ***', async () => {
  // WAS `{ TURN_ROUTER: undefined }`, i.e. it inherited the default. The default flipped to
  // 'on' on 2026-08-05, so this now says what it means instead of borrowing it. Kept, not
  // deleted: 'off' is still a supported rollback and has to stay provable.
  const t = await turn('現在是幾點？', { TURN_ROUTER: 'off' })
  assert.ok(t.model.length === 1, 'off means the utility does not act either')
})
