'use strict'

/**
 * firstReadInitiation.test.js — the loop must be able to START a read, not only extend one.
 *
 * > **Owner, in the real UI, 香香（GPT）: 「你能看到 aroma system 嗎？」**
 * > **Aroma answered that it could not verify whether Aroma System was accessible.**
 *
 * TWO defects, one behind the other. firstReadDiagnosis.test.js pins both.
 *
 *   1. `answerPlanFormat()` returned undefined on a zero-row turn, so no schema was sent and
 *      `nextRead` was never offered. The model had no structural way to ask. (Fixed in the WIP.)
 *   2. Once it COULD ask, it asked for `aroma_system` — and buildReadContext re-derived the view
 *      by running aromaMethodFor() over the Owner's original message, which carried no business
 *      intent, so planFor returned `notAsked` and the connector was never called.
 *
 * ⛔ THE FIX IS NOT TO DELETE THE notAsked RULE. That rule is what stops 「現在是幾點？」 from
 * becoming an inventory read, and the AUTOMATIC read path still uses it, unchanged. What changed
 * is that a MODEL-DIRECTED read no longer arrives under-specified: the model picks a CONCRETE
 * operation from a closed, server-generated enum (aroma_system.invoices, aroma_system.inventory,
 * …), so there is no view left for the server to rediscover.
 *
 * And when the model genuinely CANNOT tell which view is wanted, the honest move is one short
 * question — not an arbitrary inventory read wearing the costume of a capability check.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')

const NOW = '2026-08-08T12:00:00.000Z'

function fakeConnector () {
  const reads = []
  return {
    reads,
    connector: {
      async read (source, method) {
        reads.push({ source, method })
        return {
          asOf: NOW,
          source,
          count: 1,
          results: [{ source, sourceId: 'X1', title: 'Row', entityType: 'inventory_item', content: 'id=X1', fields: { id: 'X1' }, trust: 'live', retrievedAt: NOW }],
          evidence: { source, trust: 'live', shownCount: 1, matchingTotal: 1, sourceTotal: null, completeness: 'complete', retrievedAt: NOW }
        }
      }
    }
  }
}

/** Records the SCHEMA each call was shown — the decision surface, never the prompt. */
function scriptedAdapter (label, envelopes) {
  const calls = []
  return {
    label,
    calls,
    async complete (prompt, opts = {}) {
      const nr = opts.responseFormat && opts.responseFormat.schema &&
        opts.responseFormat.schema.properties && opts.responseFormat.schema.properties.nextRead
      calls.push({
        schemaName: opts.responseFormat ? opts.responseFormat.name : null,
        readChoices: nr && nr.properties ? nr.properties.capability.enum : (nr ? 'null-only' : 'no-schema'),
        gloss: nr && nr.properties ? nr.properties.capability.description : null,
        prompt: String(prompt),
        promptChars: String(prompt).length
      })
      const body = envelopes[calls.length - 1]
      if (!body) throw new Error(label + ' called more times than scripted: ' + calls.length)
      return { text: JSON.stringify(body), usage: { totalTokens: 2 }, model: label, latencyMs: 1, stopReason: 'end_turn' }
    }
  }
}

const READ = (capability) => ({ intent: 'question', mode: 'chat', reply: '等我睇睇。', nextRead: { capability } })
const FINAL = (reply) => ({ intent: 'question', mode: 'chat', reply, nextRead: null, answerPlan: null })
const ASK = (reply) => ({ intent: 'question', mode: 'ask', reply, nextRead: null, answerPlan: null })

const ALL_AROMA_OPS = [
  'aroma_system.inventory', 'aroma_system.suppliers', 'aroma_system.daily_counts',
  'aroma_system.replenishment', 'aroma_system.purchasing', 'aroma_system.invoices'
]

const FLAGS = { READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', TURN_ROUTER: 'on', MULTI_AI_ROUTER: 'off' }

async function withEnv (over, fn) {
  const all = Object.assign({}, FLAGS, over)
  const saved = {}
  for (const k of Object.keys(all)) { saved[k] = process.env[k]; if (all[k] === null) delete process.env[k]; else process.env[k] = all[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(all)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

const run = (msg, adapter, deps, extra, history) => processIntake(msg, adapter, history || [], Object.assign({
  demo: true, interactionMode: 'chat', providerHint: 'claude', requestId: '11111111-2222-4333-8444-555555555555',
  readContextDeps: deps
}, extra || {}))

/* ═══ A. MODEL-DIRECTED CONCRETE AROMA READ ════════════════════════════════ */

test('*** A — 幫我睇 Aroma System 最近啲發票: the model names the view, and it RUNS ***', async () => {
  await withEnv({}, async () => {
    const fc = fakeConnector()
    // The message names invoices, so the AUTOMATIC planner would also have found them. The
    // point of this case is the MODEL-DIRECTED path, so the automatic read is taken out of the
    // way with a CONVERSATION route... it cannot be, deterministically. Instead the model asks
    // for a view the message does NOT name: suppliers. If the server were still re-deriving the
    // view from the message this would read invoices — or nothing — instead.
    const gpt = scriptedAdapter('openai', [READ('aroma_system.suppliers'), FINAL('讀到喇。')])
    const claude = scriptedAdapter('claude', [FINAL('CLAUDE MUST NOT BE CALLED')])
    process.env.MULTI_AI_ROUTER = 'on'
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key'
    const out = await run('你能看到 aroma system 嗎？', claude, { connector: fc.connector, sources: ['aroma_system'] },
      { openaiAdapter: gpt, providerHint: 'openai' })

    // 1. the FIRST call — before any row exists — was shown CONCRETE choices
    assert.deepEqual(gpt.calls[0].readChoices, ALL_AROMA_OPS,
      'the decision surface must exist on a zero-read turn, and it must be view-level')
    assert.equal(gpt.calls[0].readChoices.includes('aroma_system'), false,
      '⛔ a bare source is not a read operation — that is what made the request under-specified')
    assert.equal(gpt.calls[0].schemaName, 'distill_with_read_decision',
      'and it is the DECISION schema — no answerPlan is forced before evidence exists')
    assert.ok(/aroma_system\.purchasing＝採購單/.test(gpt.calls[0].gloss || ''),
      'each opaque operation name is glossed, so the choice is informed rather than guessed')

    // 2. the connector really ran, on the method the MODEL chose — not one derived from the
    //    message, which carries no business intent at all
    assert.deepEqual(fc.reads, [{ source: 'aroma_system', method: 'listSuppliers' }],
      '⛔ the exact operation the model named, resolved through the frozen table')

    // 3. the observation reached call 2, on the SAME provider
    assert.equal(gpt.calls.length, 2, 'exactly two model calls')
    assert.ok(gpt.calls[1].promptChars > gpt.calls[0].promptChars, 'call 2 grew by the observation')
    assert.equal(claude.calls.length, 0, 'the turn must not switch provider')

    // 4. the view just read is withdrawn; its five siblings remain askable
    assert.equal(gpt.calls[1].readChoices.includes('aroma_system.suppliers'), false,
      'a view already answered is not offered again')
    assert.equal(gpt.calls[1].readChoices.includes('aroma_system.invoices'), true,
      'but reading suppliers answers nothing about invoices — the source must not vanish wholesale')

    // 5. FINAL
    assert.ok(typeof out.reply === 'string' && out.reply.length > 0)
  })
})

test('*** A2 — the invoice question reads INVOICES, not the inventory default ***', async () => {
  await withEnv({}, async () => {
    const fc = fakeConnector()
    const a = scriptedAdapter('claude', [READ('aroma_system.invoices'), FINAL('最近嘅發票喺度。')])
    // forceSources keeps the automatic route out of it, so the ONLY read is the model's.
    await run('你可以驗證一下嗎？', a, { connector: fc.connector, sources: ['aroma_system'] })
    assert.deepEqual(fc.reads, [{ source: 'aroma_system', method: 'listInvoices' }],
      'the message names nothing; the operation named everything')
  })
})

/* ═══ B. AMBIGUOUS CAPABILITY QUESTION → ASK, NOT AN ARBITRARY READ ════════ */

test('*** B — 你能看到 Aroma System 嗎: ask ONE question, read NOTHING, write NOTHING ***', async () => {
  await withEnv({}, async () => {
    const fc = fakeConnector()
    const a = scriptedAdapter('claude', [
      ASK('可以嘗試讀取。你想我用倉存、發票、供應商、盤點、訂貨建議定係採購單即場驗證？')
    ])
    const out = await run('你能看到 Aroma System 嗎？', a, { connector: fc.connector, sources: ['aroma_system'] })

    // ⛔ THERE IS NO GENERIC AROMA HEALTH READ, AND NONE WAS INVENTED TO MAKE THIS SAY READ.
    assert.equal(a.calls[0].readChoices.includes('aroma_system'), false,
      'no bare-source operation exists, so the model cannot ask a question it cannot specify')
    assert.deepEqual(fc.reads, [], '⛔ NO arbitrary Inventory fallback')
    assert.equal(a.calls.length, 1, 'one call: asking is a complete turn, not a failure')
    assert.equal(out.decision, null, 'zero write')
    assert.equal((out.tasks || []).length, 0, 'zero action')
    assert.ok(typeof out.reply === 'string' && out.reply.length > 0, 'and the Owner gets the question')
  })
})

/* ═══ C. THE FOLLOW-UP RESOLVES FROM THE EXISTING HISTORY ══════════════════ */

test('*** C — Aroma asked which view; 「庫存」 resolves it and the read runs ***', async () => {
  await withEnv({}, async () => {
    const fc = fakeConnector()
    const question = '你想我用倉存、發票、供應商、盤點、訂貨建議定係採購單即場驗證？'
    // `text`, not `content` — buildDistillPrompt renders h.text, and 'assistant' is the only
    // role that attributes a line to her (anything else defaults to the Owner).
    const history = [
      { role: 'user', text: '你能看到 Aroma System 嗎？' },
      { role: 'assistant', text: question }
    ]
    const a = scriptedAdapter('claude', [FINAL('倉存讀到 1 項。')])
    await run('庫存', a, { connector: fc.connector, sources: ['aroma_system'] }, {}, history)

    // ⛔ NO NEW CONVERSATION-STATE SYSTEM. The Ask is carried by the history that already
    // exists, and this asserts it is really in the prompt rather than assumed to be.
    assert.ok(a.calls[0].prompt.includes(question),
      'the previous Ask must be visible on the next turn, or 「庫存」 is an orphan word')
    assert.deepEqual(fc.reads, [{ source: 'aroma_system', method: 'listInventory' }],
      'the answer resolved to the inventory view and the read executed')
    assert.equal(a.calls.length, 1, 'and it needed no extra round trip')
  })
})

test('*** C2 — the view just read is declared READ, not left looking unavailable ***', async () => {
  await withEnv({}, async () => {
    const fc = fakeConnector()
    const a = scriptedAdapter('claude', [FINAL('倉存讀到 1 項。')])
    await run('庫存', a, { connector: fc.connector, sources: ['aroma_system'] })

    // ⛔ FOUND BY THE LIVE CANARY, NOT BY A FAKE. Inventory was read and its rows were in the
    // prompt, but 倉存 was merely ABSENT from the choice list — and GPT read that absence as
    // 「目前可讀取的資料沒有『庫存』操作 … 無法直接讀取庫存資料」, then spent a second paid read
    // on 盤點紀錄 as a substitute. A view she is holding must never look like one she was denied.
    const gloss = a.calls[0].gloss || ''
    assert.ok(gloss.includes('本回合已經讀取'), 'the already-read state is stated, not implied by omission')
    assert.ok(gloss.includes('aroma_system.inventory＝倉存'), 'and it names the view she is holding')
    assert.equal(a.calls[0].readChoices.includes('aroma_system.inventory'), false,
      'it is still not OFFERED — it has already been answered')
  })
})

/* ═══ D. A GENERIC SOURCE IS UNCHANGED ════════════════════════════════════ */

test('*** D — a zero-read Gmail question still initiates its existing generic read ***', async () => {
  await withEnv({ CONTEXT_GMAIL: 'on' }, async () => {
    const fc = fakeConnector()
    const a = scriptedAdapter('claude', [READ('gmail'), FINAL('郵件讀咗。')])
    await run('你可以驗證一下嗎？', a, { connector: fc.connector, sources: ['gmail'] })
    assert.deepEqual(a.calls[0].readChoices, ['gmail'],
      'a generic source is its own single operation — no expansion, no view to disambiguate')
    assert.equal(fc.reads.length > 0, true, 'and the read ran, with no clarification asked')
    assert.equal(fc.reads[0].source, 'gmail')
  })
})

/* ═══ E. AN ORDINARY GREETING IS NOT PUSHED THROUGH A READ ════════════════ */

test('*** E — 你好: the model may answer directly — ONE call, ZERO reads ***', async () => {
  await withEnv({}, async () => {
    const fc = fakeConnector()
    const a = scriptedAdapter('claude', [FINAL('你好！')])
    await run('你好', a, { connector: fc.connector, sources: ['aroma_system'] })
    assert.equal(a.calls.length, 1, 'no turn is forced through a read')
    assert.deepEqual(fc.reads, [], 'and nothing was read')
    assert.deepEqual(a.calls[0].readChoices, ALL_AROMA_OPS, 'offered; declining it is the model decision')
  })
})

/* ═══ F. THE AUTHORISATION BOUNDARY IS UNCHANGED ══════════════════════════ */

test('*** F — READ_ACCESS off → no read operation exposed at all ***', async () => {
  await withEnv({ READ_ACCESS: 'off' }, async () => {
    const fc = fakeConnector()
    const a = scriptedAdapter('claude', [FINAL('冇讀到。')])
    await run('你能看到 aroma system 嗎？', a, { connector: fc.connector, sources: ['aroma_system'] })
    assert.equal(a.calls[0].readChoices, 'no-schema', 'nothing readable means nothing offered')
    assert.deepEqual(fc.reads, [])
  })
})

test('*** F2 — a source not authorised this turn is never exposed ***', async () => {
  await withEnv({}, async () => {
    const fc = fakeConnector()
    const a = scriptedAdapter('claude', [FINAL('ok')])
    await run('你能看到咩？', a, { connector: fc.connector, sources: ['aroma_system'] })
    assert.equal(a.calls[0].readChoices.includes('drive'), false, 'drive was never authorised this turn')
  })
})

/* ═══ G. PROVIDER WITHHOLDING HIDES EVERY CHILD OPERATION ═════════════════ */

test('*** G — aroma_system withheld from OpenAI → not ONE child operation is exposed ***', async () => {
  await withEnv({ CONTEXT_AROMA_SYSTEM_OPENAI: 'off', CONTEXT_GMAIL: 'on' }, async () => {
    const fc = fakeConnector()
    const gpt = scriptedAdapter('openai', [FINAL('得。')])
    const claude = scriptedAdapter('claude', [FINAL('CLAUDE MUST NOT BE CALLED')])
    process.env.MULTI_AI_ROUTER = 'on'
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key'
    await run('你能看到 aroma system 嗎？', claude, { connector: fc.connector, sources: ['aroma_system', 'gmail'] },
      { openaiAdapter: gpt, providerHint: 'openai' })

    const choices = gpt.calls[0].readChoices
    assert.equal(Array.isArray(choices) ? choices.some((c) => c.startsWith('aroma_system')) : false, false,
      '⛔ authorisation is SOURCE based: a withheld source exposes none of its operations')
    assert.deepEqual(choices, ['gmail'], 'and what IS shared is still offered')
    assert.deepEqual(fc.reads, [])
  })
})

/* ═══ H. AN INVENTED OPERATION IS REFUSED BEFORE THE CONNECTOR ════════════ */

test('*** H — an operation outside the vocabulary never reaches the reader ***', async () => {
  await withEnv({}, async () => {
    const fc = fakeConnector()
    const a = scriptedAdapter('claude', [READ('aroma_system.staffing'), FINAL('讀唔到嗰part。')])
    const events = []
    const realLog = console.log
    console.log = (...args) => { if (args[0] === '[AROMA-REASONING]') { try { events.push(JSON.parse(args[1])) } catch (_) {} } }
    try {
      await run('你能看到 aroma system 嗎？', a, { connector: fc.connector, sources: ['aroma_system'] })
    } finally { console.log = realLog }

    assert.deepEqual(fc.reads, [], '⛔ zero connector calls — refused before the reader, not after')
    const refused = events.find((e) => e && e.refusal)
    assert.ok(refused, 'and the refusal is on the record')
    assert.equal(refused.refusal, 'capability_not_allowed')
  })
})

test('*** H2 — a raw adapter method is not an operation ***', async () => {
  await withEnv({}, async () => {
    const fc = fakeConnector()
    const a = scriptedAdapter('claude', [READ('listInvoices'), FINAL('唔得。')])
    await run('你能看到 aroma system 嗎？', a, { connector: fc.connector, sources: ['aroma_system'] })
    assert.deepEqual(fc.reads, [], 'the model may never name a method or a path')
  })
})

test('*** H3 — a bare aroma_system is no longer a valid request ***', async () => {
  await withEnv({}, async () => {
    const fc = fakeConnector()
    const a = scriptedAdapter('claude', [READ('aroma_system'), FINAL('要講明邊一部分。')])
    await run('你能看到 aroma system 嗎？', a, { connector: fc.connector, sources: ['aroma_system'] })
    assert.deepEqual(fc.reads, [],
      '⛔ THE ORIGINAL UNDER-SPECIFIED REQUEST. It is now refused at the allowlist, in the open, ' +
      'instead of being silently vetoed by the message-driven planner as notAsked.')
  })
})

/* ═══ THE PROPOSAL LANE IS UNCHANGED ══════════════════════════════════════ */

test('*** the proposal lane is unchanged — no decision schema there ***', async () => {
  await withEnv({}, async () => {
    const fc = fakeConnector()
    const a = scriptedAdapter('claude', [{ intent: 'task', mode: 'chat', reply: 'ok', nextRead: null }])
    await processIntake('幫我改 docs/x.md', a, [], {
      demo: true, interactionMode: 'proposal', requestId: '11111111-2222-4333-8444-555555555555',
      readContextDeps: { connector: fc.connector, sources: ['aroma_system'] }
    })
    assert.equal(a.calls[0].readChoices, 'no-schema', 'chat lane only')
  })
})

/* ═══ THE AUTOMATIC READ PATH IS UNTOUCHED ════════════════════════════════ */

test('*** the message-driven planner still governs the AUTOMATIC read ***', async () => {
  await withEnv({}, async () => {
    const fc = fakeConnector()
    const a = scriptedAdapter('claude', [FINAL('倉存資料喺度。')])
    await run('而家倉存入面有咩？', a, { connector: fc.connector, sources: ['aroma_system'] })
    assert.deepEqual(fc.reads, [{ source: 'aroma_system', method: 'listInventory' }],
      'a business question still reads automatically, from the message, with no model decision')
    assert.equal(a.calls[0].readChoices.includes('aroma_system.inventory'), false,
      'and the view it just supplied is not offered back')
  })
})

test('*** a no-intent message still reads NOTHING automatically — notAsked survives ***', async () => {
  await withEnv({}, async () => {
    const fc = fakeConnector()
    const a = scriptedAdapter('claude', [FINAL('而家係下午。')])
    await run('現在是幾點？', a, { connector: fc.connector, sources: ['aroma_system'] })
    assert.deepEqual(fc.reads, [],
      '⛔ THE RULE THAT MUST NOT BE DELETED: an unrelated question does not become a stock read')
  })
})
