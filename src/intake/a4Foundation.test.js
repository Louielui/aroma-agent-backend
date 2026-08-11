'use strict'

/**
 * a4Foundation.test.js — A4-0A: the read-argument channel is proven end to end, and inert.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT THIS SLICE CLAIMS, AND THEREFORE WHAT IS ASSERTED HERE.
 *
 *   1. With A4 OFF — the default, and production today — NOTHING differs from f836534.
 *   2. With A4 ON — an argument declared by the model survives, with its exact values,
 *      all the way from the strict schema to executeRead:
 *
 *          schema → parser → distilled.nextRead.args → pending
 *                → reasoningLoop decision.args → executeRead({capability, args})
 *
 *   3. Nothing consumes those arguments. No adapter's parameters change.
 *   4. No authorisation moved. An invented capability is refused exactly as before.
 *
 * ⛔ THE SEAM THAT MADE THIS NECESSARY. reasoningLoop.js:130 has ALWAYS called
 * `executeRead({ capability, args: decision.args || {} })` — but the schema never offered an
 * args field, the parser never admitted one, and intakeService's executeRead destructured
 * `({ capability })` only. The channel looked wired from every single vantage point and
 * carried nothing from end to end. That is exactly the class of defect A3 hit twice.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')
const { parseDistillResponse } = require('./distillPrompt')
const {
  DISTILL_WITH_PLAN_SCHEMA, DISTILL_WITH_READ_DECISION_SCHEMA, withReadArgs, withRowRefs, withReadChoices
} = require('./answerPlan')
const {
  A4_FLAG, resolveA4, a4ContractEnabled, admitReadArgs, READ_ARGS_SCHEMA,
  EGRESS_CONTRACT, wouldLeakInternalEvidence
} = require('./a4Contract')
const { MAX_REASONING_STEPS, WRITE_SHAPED } = require('./reasoningLoop')

const NOW = '2026-08-09T00:00:00.000Z'
const REPL = 'aroma_system.replenishment'
const PURC = 'aroma_system.purchasing'

/* ═══ FIXTURES ════════════════════════════════════════════════════════════ */

const ROW = {
  sourceId: '7', title: 'Napa Cabbage', entityType: 'order_suggestion',
  content: 'id=7 · name=Napa Cabbage · live_qty=0.000 · par_level=75.000',
  fields: { id: '7', name: 'Napa Cabbage', live_qty: '0.000', par_level: '75.000' }
}

/** Records the params EVERY adapter method actually received — proof I is measured, not argued. */
function spyConnector () {
  const reads = []
  return {
    reads,
    connector: {
      async read (source, method, params) {
        reads.push({ source, method, params: JSON.parse(JSON.stringify(params || {})) })
        const rows = [Object.assign({ source, trust: 'live', retrievedAt: NOW, originalDate: null, link: null, error: null }, ROW)]
        return {
          asOf: NOW, source, count: rows.length, results: rows,
          evidence: {
            source, endpoint: method, entityType: 'order_suggestion',
            rowShape: { hasLocation: false, hasAsOf: false, note: null }, metrics: {},
            matchingTotal: 1, shownCount: 1, sourceTotal: null,
            queryScope: { field: null, window: null, declaredBy: 'reader' },
            completeness: 'complete', usedFallback: false, retrievedAt: NOW, trust: 'live',
            provenance: 'spy'
          }
        }
      }
    }
  }
}

function scriptedAdapter (label, envelopes) {
  const calls = []
  return {
    label,
    calls,
    async complete (prompt, opts = {}) {
      calls.push({ schemaName: opts.responseFormat ? opts.responseFormat.name : null, schema: opts.responseFormat ? opts.responseFormat.schema : null })
      const body = envelopes[calls.length - 1]
      if (!body) throw new Error(label + ' called more times than scripted: ' + calls.length)
      return { text: JSON.stringify(body), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: label, latencyMs: 1, stopReason: 'end_turn' }
    }
  }
}

const READ = (capability, args) => ({ intent: 'question', mode: 'chat', reply: '等我睇睇。', nextRead: args === undefined ? { capability } : { capability, args }, answerPlan: null })
const FINAL = (reply) => ({ intent: 'question', mode: 'chat', reply, nextRead: null, answerPlan: null })

const BASE = { READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', TURN_ROUTER: 'on', MULTI_AI_ROUTER: 'off' }
async function withEnv (over, fn) {
  const all = Object.assign({}, BASE, over)
  const saved = {}
  for (const k of Object.keys(all)) { saved[k] = process.env[k]; if (all[k] === null) delete process.env[k]; else process.env[k] = all[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(all)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}
const A4_ON = { [A4_FLAG]: 'on' }
const A4_OFF = { [A4_FLAG]: null } // unset

const BROAD = '根據而家嘅資料，幫我判斷今日有咩需要我優先處理。'
const run = (msg, adapter, deps) => processIntake(msg, adapter, [], {
  demo: true, interactionMode: 'chat', providerHint: 'claude', requestId: '11111111-2222-4333-8444-555555555555',
  readContextDeps: deps
})

/* ═══ THE GATE ════════════════════════════════════════════════════════════ */

test('*** the gate fails closed: unset, empty and nonsense all mean off ***', () => {
  for (const v of [undefined, '', '  ', 'yes', 'true', 'ON', '1', 'enabled']) {
    const env = v === undefined ? {} : { [A4_FLAG]: v }
    assert.equal(resolveA4(env), 'off', JSON.stringify(v) + ' must not enable A4')
  }
  assert.equal(resolveA4({ [A4_FLAG]: 'on' }), 'on')
  assert.equal(resolveA4({ [A4_FLAG]: 'shadow' }), 'shadow')
  assert.equal(resolveA4({ [A4_FLAG]: 'off' }), 'off')
  assert.equal(a4ContractEnabled({}), false, 'the default is off')
})

test('*** ⛔ TURN_ROUTER is NOT the A4 rollback — the flags are independent ***', () => {
  // TURN_ROUTER='off' means PRE-ROUTER, where reads were ungoverned. Rolling A4 back through
  // it would WIDEN reads while claiming to retreat. A4 must be unaffected by it, both ways.
  assert.equal(a4ContractEnabled({ TURN_ROUTER: 'off' }), false)
  assert.equal(a4ContractEnabled({ TURN_ROUTER: 'off', [A4_FLAG]: 'on' }), true)
  assert.equal(a4ContractEnabled({ TURN_ROUTER: 'on' }), false, 'the router says nothing about A4')
})

/* ═══ A / B / C — A4 OFF IS BYTE-IDENTICAL TO TODAY ═══════════════════════ */

test('*** A — A4 off: the nextRead schema is the UNCHANGED object, not a copy ***', () => {
  for (const schema of [DISTILL_WITH_PLAN_SCHEMA, DISTILL_WITH_READ_DECISION_SCHEMA]) {
    const out = withReadArgs(schema, false)
    assert.equal(out, schema, 'the same object identity — an off turn cannot differ by key order')
    assert.equal(out.properties.nextRead.properties.args, undefined, 'no args property exists')
    assert.deepEqual(out.properties.nextRead.required, ['capability'])
  }
})

test('*** B — A4 off: the parser output is unchanged and drops args ***', async () => {
  await withEnv(A4_OFF, () => {
    const envelope = JSON.stringify({
      intent: 'q', mode: 'chat', reply: 'x',
      nextRead: { capability: REPL, args: { query: 'beef', freshness: 'current', location: 'Winnipeg' } }
    })
    const parsed = parseDistillResponse(envelope, {})
    assert.deepEqual(parsed.nextRead, { capability: REPL },
      '⛔ with A4 off the envelope is exactly today\'s: capability only, args dropped like any unknown field')
    assert.equal('args' in parsed.nextRead, false)
  })
})

test('*** C — A4 off: an ordinary chat turn is unchanged (one call, no schema drift) ***', async () => {
  await withEnv(A4_OFF, async () => {
    const sc = spyConnector()
    const a = scriptedAdapter('claude', [FINAL('你好！')])
    await run('你好', a, { connector: sc.connector, sources: ['aroma_system'] })
    assert.equal(a.calls.length, 1)
    assert.deepEqual(sc.reads, [], 'nothing read')
    const nr = a.calls[0].schema.properties.nextRead
    assert.equal(nr.properties.args, undefined, 'no args offered to the model')
    assert.deepEqual(nr.required, ['capability'])
  })
})

/* ═══ D / E / F — THE SCHEMA UNDER A4 ON ═════════════════════════════════ */

test('*** D — A4 on: the strict schema carries args ***', () => {
  const out = withReadArgs(DISTILL_WITH_READ_DECISION_SCHEMA, true)
  const nr = out.properties.nextRead
  assert.ok(nr.properties.args, 'args exists')
  assert.ok(nr.required.includes('args'), 'and is REQUIRED — strict mode has no optional-by-omission')
  assert.deepEqual(nr.properties.args.type, ['object', 'null'], 'optionality is a NULL UNION')
  assert.deepEqual(nr.properties.args.required.sort(), ['freshness', 'location', 'query'])
  assert.equal(nr.properties.args.additionalProperties, false)
  assert.notEqual(out, DISTILL_WITH_READ_DECISION_SCHEMA, 'the source schema is never mutated')
  assert.equal(DISTILL_WITH_READ_DECISION_SCHEMA.properties.nextRead.properties.args, undefined)
})

test('*** D2 — the args shape is CLOSED: no url, provider, endpoint, headers, count ***', () => {
  assert.deepEqual(Object.keys(READ_ARGS_SCHEMA.properties).sort(), ['freshness', 'location', 'query'])
  for (const forbidden of ['url', 'domain', 'provider', 'endpoint', 'apiKey', 'headers', 'method', 'count', 'limit']) {
    assert.equal(READ_ARGS_SCHEMA.properties[forbidden], undefined,
      '⛔ ' + forbidden + ' would hand the model mechanism; it supplies MEANING only')
  }
  // ⛔ THE CLOSED VALUE SET IS UNCHANGED; ONLY ITS SPELLING IS.
  //
  // This used to read `.enum` off a `type: ['string','null']` field. That spelling is accepted
  // by OpenAI and REFUSED by Anthropic — 'Enum value 'current' does not match declared type' —
  // which returned HTTP 400 on every Claude chat turn with A4 on. anyOf says the same thing in
  // a form both providers accept, so the assertion follows the shape rather than the union.
  const f = READ_ARGS_SCHEMA.properties.freshness
  assert.ok(Array.isArray(f.anyOf), 'anyOf, not a union type carrying an enum')
  assert.equal(f.enum, undefined, 'no top-level enum beside anyOf — that is the shape that 400s')
  const strings = f.anyOf.find((b) => b.type === 'string')
  assert.deepEqual(strings.enum, ['current', 'recent', 'any'], 'the same three values')
  assert.ok(f.anyOf.some((b) => b.type === 'null'), 'and null is still admissible')
})

test('*** E — unknown properties are not admitted, and cannot ride along ***', () => {
  const out = admitReadArgs({
    query: 'beef price', freshness: 'current', location: 'Winnipeg',
    url: 'https://evil.example/x', provider: 'acme', endpoint: '/v1/hack', headers: { a: 'b' }, count: 99
  })
  assert.deepEqual(out, { query: 'beef price', freshness: 'current', location: 'Winnipeg' },
    'a fresh object is CONSTRUCTED — unknown keys have nowhere to be written to')
  assert.deepEqual(Object.keys(out).sort(), ['freshness', 'location', 'query'])
})

test('*** E2 — an invalid freshness is nulled, never passed through ***', () => {
  assert.equal(admitReadArgs({ query: 'x', freshness: 'URGENT', location: null }).freshness, null)
  assert.equal(admitReadArgs({ query: 'x', freshness: 'current', location: null }).freshness, 'current')
})

test('*** F — args null survives as null, and an empty declaration IS null ***', async () => {
  assert.equal(admitReadArgs(null), null)
  assert.equal(admitReadArgs(undefined), null)
  assert.equal(admitReadArgs({}), null, 'nothing declared is not the same as {null,null,null}')
  assert.equal(admitReadArgs({ query: '   ' }), null, 'whitespace is not a query')
  await withEnv(A4_ON, () => {
    const parsed = parseDistillResponse(JSON.stringify({ intent: 'q', mode: 'chat', reply: 'x', nextRead: { capability: REPL, args: null } }), {})
    assert.deepEqual(parsed.nextRead, { capability: REPL, args: null }, 'null survives as null')
  })
})

/* ═══ G — THE WHOLE CHAIN, WITH EXACT VALUES AT executeRead ══════════════ */

test('*** G — ⛔ EXACT VALUES arrive at executeRead: schema → parser → pending → loop → read ***', async () => {
  await withEnv(A4_ON, async () => {
    const sc = spyConnector()
    const seen = []
    const ARGS = { query: 'Winnipeg beef wholesale price', freshness: 'current', location: 'Winnipeg' }
    const a = scriptedAdapter('claude', [READ(REPL, ARGS), FINAL('讀完。')])
    await run(BROAD, a, {
      connector: sc.connector, sources: ['aroma_system'],
      onModelDirectedRead: (x) => seen.push(x)
    })

    // 1. the model was OFFERED the channel
    assert.ok(a.calls[0].schema.properties.nextRead.properties.args, 'schema offered args')
    // 2. it arrived at the reader, intact, with exactly the declared values
    assert.equal(seen.length, 1, 'executeRead ran once')
    assert.equal(seen[0].capability, REPL)
    assert.deepEqual(seen[0].args, ARGS,
      '⛔ THE POINT OF THE SLICE: not one field lost between the schema and the reader')
  })
})

test('*** G2 — with A4 off the same envelope delivers args = null (channel closed) ***', async () => {
  await withEnv(A4_OFF, async () => {
    const sc = spyConnector()
    const seen = []
    const a = scriptedAdapter('claude', [READ(REPL, { query: 'x', freshness: 'current', location: 'Y' }), FINAL('ok')])
    await run(BROAD, a, { connector: sc.connector, sources: ['aroma_system'], onModelDirectedRead: (x) => seen.push(x) })
    assert.equal(seen.length, 1, 'the read still happens — A4 changes nothing about reading')
    assert.equal(seen[0].args, null, 'but no argument travels, because the parser never admitted one')
  })
})

/* ═══ H — EACH READ KEEPS ITS OWN ARGS ═══════════════════════════════════ */

test('*** H — a second model-directed read carries ITS OWN args, not the first read\'s ***', async () => {
  await withEnv(A4_ON, async () => {
    const sc = spyConnector()
    const seen = []
    const A1 = { query: 'replenishment gap', freshness: 'recent', location: null }
    const A2 = { query: 'open purchase orders', freshness: 'any', location: null }
    const a = scriptedAdapter('claude', [READ(REPL, A1), READ(PURC, A2), FINAL('兩樣都睇咗。')])
    await run(BROAD, a, { connector: sc.connector, sources: ['aroma_system'], onModelDirectedRead: (x) => seen.push(x) })

    assert.equal(seen.length, 2)
    assert.deepEqual(seen[0], { capability: REPL, args: A1 })
    assert.deepEqual(seen[1], { capability: PURC, args: A2 },
      '⛔ step 2 must not inherit step 1\'s arguments — pending is reassigned per envelope')
  })
})

/* ═══ I — INTERNAL ADAPTERS ARE UNTOUCHED ════════════════════════════════ */

test('*** I — args do NOT reach any current adapter: params are identical with and without ***', async () => {
  const paramsFor = async (over, args) => {
    let captured = null
    await withEnv(over, async () => {
      const sc = spyConnector()
      const a = scriptedAdapter('claude', [READ(REPL, args), FINAL('ok')])
      await run(BROAD, a, { connector: sc.connector, sources: ['aroma_system'] })
      captured = sc.reads
    })
    return captured
  }
  const withArgs = await paramsFor(A4_ON, { query: 'SHOULD NOT REACH THE ADAPTER', freshness: 'current', location: 'Winnipeg' })
  const without = await paramsFor(A4_OFF, undefined)

  assert.deepEqual(withArgs, without,
    '⛔ INERT BY CONSTRUCTION. An internal operation IS its own query; forwarding args now would ' +
    'change what today\'s adapters receive, which is exactly what this slice promised not to do.')
  assert.equal(JSON.stringify(withArgs).includes('SHOULD NOT REACH'), false, 'and the value is nowhere near the connector')
})

/* ═══ J / K / L / M — NOTHING ELSE MOVED ═════════════════════════════════ */

test('*** J — an invented capability is still refused before the connector ***', async () => {
  await withEnv(A4_ON, async () => {
    const sc = spyConnector()
    const a = scriptedAdapter('claude', [READ('aroma_system.staffing', { query: 'x', freshness: null, location: null }), FINAL('唔得。')])
    await run(BROAD, a, { connector: sc.connector, sources: ['aroma_system'] })
    assert.deepEqual(sc.reads, [], 'args do not buy a capability — authorisation did not move')
  })
})

test('*** K — WRITE_SHAPED refusal is untouched ***', () => {
  for (const bad of ['send_mail', 'create_order', 'aroma_system.pay', 'deploy']) {
    assert.equal(WRITE_SHAPED.test(bad), true, bad + ' must still be refused')
  }
  for (const ok of ['aroma_system.replenishment', 'aroma_system.purchasing', 'gmail', 'drive']) {
    assert.equal(WRITE_SHAPED.test(ok), false, ok + ' must still pass')
  }
})

test('*** L — the reasoning step bound is unchanged ***', () => {
  assert.equal(MAX_REASONING_STEPS, 3, 'A4-0A does not touch the bound')
})

test('*** M — no chain-of-thought field exists anywhere in the shaped schemas ***', () => {
  const shaped = withReadChoices(withReadArgs(withRowRefs(DISTILL_WITH_PLAN_SCHEMA, ['aroma_system#1']), true), ['gmail'], null)
  const keys = []
  const walk = (n) => {
    if (!n || typeof n !== 'object') return
    if (n.properties) keys.push(...Object.keys(n.properties))
    for (const k of Object.keys(n)) walk(n[k])
  }
  walk(shaped)
  for (const banned of ['reasoning', 'thoughts', 'chainOfThought', 'chain_of_thought', 'rationale', 'why', 'scratchpad', 'deliberation']) {
    assert.equal(keys.includes(banned), false, '⛔ ' + banned + ' must not exist — the model returns decisions, never deliberation')
  }
})

/* ═══ STRICT-MODE COMPATIBILITY OF THE ACTUAL SHAPED SCHEMA ══════════════ */

function violations (schema) {
  const nodes = []
  const walk = (n, p) => {
    if (!n || typeof n !== 'object') return
    if (n.properties && typeof n.properties === 'object') nodes.push({ p, n })
    for (const k of Object.keys(n)) walk(n[k], p + '.' + k)
  }
  walk(schema, 'root')
  return nodes.flatMap(({ p, n }) => {
    const req = Array.isArray(n.required) ? n.required : []
    return Object.keys(n.properties).filter((k) => !req.includes(k)).map((k) => p + '.' + k)
  })
}

test('*** the A4 shaped schema obeys strict mode at every node ***', () => {
  for (const choices of [[], ['gmail'], ['aroma_system.invoices', 'gmail']]) {
    for (const base of [DISTILL_WITH_READ_DECISION_SCHEMA, withRowRefs(DISTILL_WITH_PLAN_SCHEMA, ['aroma_system#1'])]) {
      const shaped = withReadChoices(withReadArgs(base, true), choices, null)
      assert.deepEqual(violations(shaped), [], 'choices=' + JSON.stringify(choices))
    }
  }
})

test('*** with no choices left, nextRead collapses to null-only and takes args with it ***', () => {
  const shaped = withReadChoices(withReadArgs(DISTILL_WITH_READ_DECISION_SCHEMA, true), [], null)
  assert.equal(shaped.properties.nextRead.type, 'null')
  assert.equal(shaped.properties.nextRead.properties, undefined, 'an empty enum is itself invalid')
  assert.deepEqual(violations(shaped), [])
})

/* ═══ N — THE EGRESS CONTRACT, RECORDED AND UNENFORCED ═══════════════════ */

test('*** N — the egress invariant is written down, and honestly marked UNENFORCED ***', () => {
  assert.equal(EGRESS_CONTRACT.id, 'A4-EGRESS-1')
  assert.equal(EGRESS_CONTRACT.stage, 'A4-2')
  assert.equal(EGRESS_CONTRACT.enforcedBy, null,
    '⛔ null MEANS UNENFORCED. A4-0A sends nothing anywhere; when the public plane ships, this ' +
    'must name the guard that fails the read closed — and this assertion must change with it.')
})

test('*** N2 — the detector catches the exact forbidden composition ***', () => {
  // internal read yields supplier=Gordon, price=$8.72 → a public query must not carry them.
  const internal = ['Gordon', '8.72', 'Aroma Bistro']
  assert.equal(
    wouldLeakInternalEvidence({ query: 'Gordon Aroma Bistro beef price $8.72' }, internal), true,
    'the natural, helpful composition is exactly the forbidden one')
  assert.equal(
    wouldLeakInternalEvidence({ query: 'Canada wholesale beef price trend' }, internal), false,
    'a public-only question is fine')
  assert.equal(wouldLeakInternalEvidence({ query: null }, internal), false)
  assert.equal(wouldLeakInternalEvidence(null, internal), false)
})

test('*** N3 — A4-0A performs no egress at all: args reach no connector ***', async () => {
  await withEnv(A4_ON, async () => {
    const sc = spyConnector()
    const a = scriptedAdapter('claude', [READ(REPL, { query: 'Gordon $8.72', freshness: 'current', location: 'Winnipeg' }), FINAL('ok')])
    await run(BROAD, a, { connector: sc.connector, sources: ['aroma_system'] })
    assert.equal(JSON.stringify(sc.reads).includes('Gordon'), false, 'nothing left the process carrying it')
    assert.equal(JSON.stringify(sc.reads).includes('8.72'), false)
  })
})
