'use strict'

/**
 * terminalComposeEfficiency.test.js — C5.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE TURN THIS FILE EXISTS FOR: 0c3c0371, 67.5 s end to end.
 *
 * 50.6 s of it — 75% — was ONE call: the reserved terminal compose. Throughput was not the
 * problem (Opus 60.3 tok/s against Haiku's measured 54.8 across 274 calls); VOLUME was. The
 * model returned 3,052 output tokens, and the grounding layer then deleted the summary
 * sentence, 9 of the per-row facts and 2 of the 4 items.
 *
 * ⛔ WHAT PHASE 1 FOUND, AND IT IS NOT WHAT WAS EXPECTED. The terminal PROMPT is already
 * read-planning-clean: composeOnly closes nextRead in the schema to `{"type":"null"}` — 37
 * characters — and appends one structural sentence. There is almost no terminal dead weight
 * left to remove. The waste is on the OUTPUT side, and one field caused most of it: `facts`
 * had NO description at all, so the model filled it with 「為何優先」 and 「性質」 — analysis,
 * not row values — and every one of those was always going to be deleted.
 *
 * ⛔ SO THIS FILE PROVES A CONTRACT, NOT A SPEED. No test here asserts a latency: a test
 * cannot time a provider, and a number produced by a fake would be a fiction. It proves the
 * terminal call is told what will survive, that nothing else changed, and that the evidence
 * and grounding this system exists for are all still where they were.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   Run: node --test src/intake/terminalComposeEfficiency.test.js
 */

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')
const answerPlan = require('./answerPlan')
const { withTerminalComposeGuidance, DISTILL_WITH_PLAN_SCHEMA, withRowRefs } = answerPlan
const { ClaudeAdapter } = require('../adapters/ClaudeAdapter')

/* ═══ THE PRODUCTION SHAPE, SANITISED ═══════════════════════════════════════ */

const QUESTION = '幫我看看最近 Gmail，有哪些事情我需要優先處理？\n你直接幫我排優先次序和告訴我為什麼。'

const mail = (id, title, date, content) => ({
  source: 'gmail', sourceId: id, title, originalDate: date, content,
  retrievedAt: '2026-08-22', link: null, trust: 'live', error: null,
  entityType: 'mail', fields: { subject: title, from: 'SANITISED-SENDER-' + id, date }
})
const ROWS = [
  mail('m1', 'SANITISED-MAIL-A', '2026-08-21', 'delivery confirmation needed'),
  mail('m2', 'SANITISED-MAIL-B', '2026-08-20', 'invoice overdue reminder'),
  mail('m3', 'SANITISED-MAIL-C', '2026-08-19', 'supplier price update'),
  mail('m4', 'SANITISED-MAIL-D', '2026-08-18', 'membership promotion notice')
]

/** ⛔ HONOURS PER-ID HYDRATION. A stub that ignores its params renders one row four times and
 *  invents a defect that is not there — the E4 lesson, paid for once already. */
function stubConnector () {
  return {
    async read (source, method, params) {
      if (source !== 'gmail') throw new Error('not wired')
      if (params && typeof params === 'object') {
        const wanted = Object.values(params).find((x) => typeof x === 'string')
        const hit = ROWS.find((r) => r.sourceId === wanted)
        if (hit) return { asOf: '2026-08-22', source, count: 1, results: [hit] }
      }
      return { asOf: '2026-08-22', source, count: ROWS.length, results: ROWS }
    }
  }
}

const READ = { intent: 'question', mode: 'chat', reply: '我睇睇先。', nextRead: { capability: 'gmail' } }

/** A concise, grounded terminal envelope: judgment in directAnswer, values in facts. */
const GOOD_FINAL = {
  intent: 'question',
  mode: 'chat',
  reply: '我睇咗你最近嘅郵件。',
  nextRead: null,
  answerPlan: {
    directAnswer: '要先睇 SANITISED-MAIL-B，跟住 SANITISED-MAIL-A。',
    answerClaims: null,
    sections: [{
      heading: '需要你處理',
      rankingClaim: null,
      items: [
        { sourceId: 'gmail#m2', title: 'SANITISED-MAIL-B', facts: [{ field: '日期', value: '2026-08-20' }] },
        { sourceId: 'gmail#m1', title: 'SANITISED-MAIL-A', facts: [{ field: '日期', value: '2026-08-21' }] }
      ]
    }],
    limitations: [],
    followUp: null,
    unanswerable: false,
    citesEvidence: true
  }
}

const ENV = {
  GOAL_DECOMPOSER: 'off', MULTI_AI_ROUTER: 'off', A4_KNOWLEDGE_ROUTING: 'on',
  READ_ACCESS: 'on', CONTEXT_GMAIL: 'on', CONTEXT_DRIVE: 'off', CONTEXT_CALENDAR: 'off',
  CONTEXT_GITHUB: 'off', CONTEXT_AROMA_SYSTEM: 'off', CONVERSATION_DEMO: 'on',
  DECISION_RECALL: 'off', CONVERSATION_RECALL: 'off', TURN_ROUTER: 'on'
}

async function withEnv (fn) {
  const saved = {}
  for (const k of Object.keys(ENV)) { saved[k] = process.env[k]; process.env[k] = ENV[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

/** Drive one whole turn, capturing every request AND the ANSWER_PLAN telemetry line. */
async function turn (script) {
  const calls = []
  let i = 0
  const adapter = {
    async complete (prompt, opts = {}) {
      const fmt = opts.responseFormat || null
      calls.push({
        prompt: String(prompt || ''),
        system: String((opts && opts.system) || ''),
        schemaName: fmt ? fmt.name : null,
        schema: fmt ? fmt.schema : null,
        schemaChars: fmt ? JSON.stringify(fmt.schema).length : 0,
        maxTokens: opts.maxTokens
      })
      const body = script[Math.min(i, script.length - 1)]
      i++
      return { text: JSON.stringify(body), usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }, model: 'fake', latencyMs: 1, stopReason: 'end_turn' }
    }
  }
  const planLines = []
  const realLog = console.log
  console.log = (...a) => {
    if (a[0] === '[AROMA-ANSWER-PLAN]') { try { planLines.push(JSON.parse(a[1])) } catch (_) {} return }
    if (typeof a[0] === 'string' && a[0].startsWith('[AROMA')) return
    realLog(...a)
  }
  let res
  try {
    res = await processIntake(QUESTION, adapter, [], {
      demo: true, interactionMode: 'chat', providerHint: 'claude',
      readContextDeps: { sources: ['gmail'], connector: stubConnector() }
    })
  } finally { console.log = realLog }
  return { res, calls, plan: planLines[planLines.length - 1] || null }
}

const terminalOf = (calls) => calls[calls.length - 1]
const factsDescOf = (schema) => {
  try {
    return schema.properties.answerPlan.properties.sections.items
      .properties.items.items.properties.facts.description
  } catch (_) { return undefined }
}
/** Can the model still ask for another read under this schema? */
function nextReadOpen (schema) {
  const s = JSON.stringify(schema && schema.properties && schema.properties.nextRead)
  const m = s.match(/"enum":\[([^\]]*)\]/)
  return !!(m && m[1].replace(/null|,|\s/g, '').length > 0)
}

/* ═══ 1. THE TERMINAL FIXTURE — everything that must still be true ══════════ */

describe('C5 (1) the terminal call is terminal, and it still carries everything', () => {
  test('*** ⛔ composeOnly is the LAST call and its nextRead is structurally closed ***', async () => {
    await withEnv(async () => {
      const { calls } = await turn([READ, GOOD_FINAL])
      assert.equal(calls.length, 2, 'read decision then terminal compose')
      const t = terminalOf(calls)
      assert.equal(t.schemaName, 'distill_with_answer_plan')
      assert.equal(nextReadOpen(t.schema), false, '⛔ the last call may still ask for another read')
      // ⛔ NOTE, MEASURED: this turn's last call is reasoning step 2 returning `final`, NOT the
      // reserved composeOnly call — exactly as production 0c3c0371 behaved. The last-call
      // sentence therefore does NOT appear, and asserting that it does would be asserting a
      // path production does not take.
      assert.equal(/最後一次呼叫/.test(t.prompt), false, 'this shape does not reach the reserved compose')
    })
  })

  test('*** ⛔ all four Gmail rows are in the terminal request ***', async () => {
    await withEnv(async () => {
      const { calls } = await turn([READ, GOOD_FINAL])
      const t = terminalOf(calls).prompt
      for (const r of ROWS) assert.ok(t.includes(r.title), '⛔ MISSING FROM THE TERMINAL REQUEST: ' + r.title)
      for (const r of ROWS) assert.ok(t.includes('ref=gmail#' + r.sourceId), 'no citable ref for ' + r.sourceId)
    })
  })

  test('*** ⛔ the Owner question survives to the terminal request ***', async () => {
    await withEnv(async () => {
      const { calls } = await turn([READ, GOOD_FINAL])
      assert.ok(terminalOf(calls).prompt.includes('優先處理'), '⛔ the question was optimised away')
    })
  })

  test('*** ⛔ gmail is the read source, and NO Aroma evidence is introduced ***', async () => {
    await withEnv(async () => {
      const { calls } = await turn([READ, GOOD_FINAL])
      const t = terminalOf(calls).prompt
      assert.ok(t.includes('[gmail]'), 'the gmail evidence block must be present')
      assert.equal(/aroma_system\.(inventory|suppliers|daily_counts|replenishment|purchasing|invoices)/.test(t), false,
        '⛔ an Aroma operation reached a Gmail-only terminal request')
      assert.equal(/SANITISED-DOC|SANITISED-EVENT/.test(t), false, 'no other source may appear')
    })
  })

  test('*** ⛔ the Answer Plan schema is still enforced on the terminal call ***', async () => {
    await withEnv(async () => {
      const { calls } = await turn([READ, GOOD_FINAL])
      const s = terminalOf(calls).schema
      assert.deepEqual(s.required, ['intent', 'nextRead', 'mode', 'reply', 'answerPlan'])
      const ap = s.properties.answerPlan
      for (const k of ['directAnswer', 'answerClaims', 'sections', 'limitations', 'followUp', 'unanswerable', 'citesEvidence']) {
        assert.ok(ap.required.includes(k), 'answerPlan lost required field ' + k)
      }
    })
  })

  test('*** ⛔ the terminal schema pins sourceId to the rows actually read ***', async () => {
    // ⛔ FOUND BY MUTATION. Dropping withRowRefs leaves server-side citation proof intact, so
    // behaviour looked unchanged — but the MODEL loses the closed list of ids it may cite, and
    // a contract that stops naming its evidence is a weaker contract even when the guard holds.
    await withEnv(async () => {
      const { calls } = await turn([READ, GOOD_FINAL])
      const sid = terminalOf(calls).schema.properties.answerPlan.properties.sections.items
        .properties.items.items.properties.sourceId
      assert.ok(Array.isArray(sid.enum), '⛔ the terminal schema no longer names the readable rows')
      for (const r of ROWS) {
        assert.ok(sid.enum.includes('gmail#' + r.sourceId), 'missing ref for ' + r.sourceId)
      }
    })
  })

  test('*** ⛔ the chat token budget is UNCHANGED at 8192 on every call ***', async () => {
    // Opus at a small budget can spend the whole budget thinking and return no text. The
    // ceiling is not the lever, and this pins that it was not quietly used as one.
    await withEnv(async () => {
      const { calls } = await turn([READ, GOOD_FINAL])
      for (const c of calls) assert.equal(c.maxTokens, 8192, '⛔ the chat budget moved')
    })
  })
})

/* ═══ 2. DETERMINISTIC SIZES — recorded, not asserted against a target ══════ */

describe('C5 (2) prompt and schema sizes, measured', () => {
  test('*** the terminal request is larger than the pre-read one BECAUSE OF EVIDENCE ***', async () => {
    await withEnv(async () => {
      const { calls } = await turn([READ, GOOD_FINAL])
      const pre = calls[0]; const term = calls[1]
      // ⛔ NO PERCENTAGE TARGET. Phase 1 measured that the terminal prompt is already free of
      // read-planning material; the growth from pre-read to terminal is the evidence block, and
      // evidence is the one thing that must NOT shrink. This records the shape so a future
      // tranche can see it move.
      assert.ok(term.prompt.length > pre.prompt.length, 'the terminal call carries the evidence')
      const evidenceChars = ROWS.reduce((n, r) => n + r.title.length + r.content.length, 0)
      assert.ok(term.prompt.length - pre.prompt.length > evidenceChars,
        'the growth is at least the evidence itself')
      // The system contract is identical on both calls — it is not a terminal cost.
      assert.equal(term.system, pre.system)
    })
  })

  test('*** ⛔ the terminal schema closes nextRead rather than describing it ***', () => {
    const closed = answerPlan.withReadChoices(DISTILL_WITH_PLAN_SCHEMA, [], 'gloss')
    const open = answerPlan.withReadChoices(DISTILL_WITH_PLAN_SCHEMA, ['gmail'], 'gloss')
    const closedChars = JSON.stringify(closed.properties.nextRead).length
    const openChars = JSON.stringify(open.properties.nextRead).length
    assert.ok(closedChars < openChars,
      'the closed form must be smaller: ' + closedChars + ' vs ' + openChars)
    assert.equal(nextReadOpen(closed), false)
    assert.equal(nextReadOpen(open), true)
  })
})

/* ═══ 3. TERMINAL-ONLY, AND PURE ═══════════════════════════════════════════ */

describe('C5 (3) the guidance reaches the terminal call and nothing else', () => {
  test('*** ⛔ the READ-PLANNING call is NOT annotated ***', async () => {
    await withEnv(async () => {
      /**
       * ⛔ THE GATE IS THE SCHEMA, NOT THE STEP NUMBER — and the fixture is why.
       *
       * Call 1 is `distill_with_read_decision`: its whole job is choosing a read, and it must
       * stay byte-identical. Call 2 is `distill_with_answer_plan`: it composes an answer over
       * evidence, and it is annotated. On production 0c3c0371 call 2 was a reasoning step that
       * returned `final`, not the reserved compose — so a composeOnly gate would have annotated
       * nothing at all on the turn this tranche was opened for.
       */
      const { calls } = await turn([READ, GOOD_FINAL])
      assert.equal(calls[0].schemaName, 'distill_with_read_decision')
      assert.equal(factsDescOf(calls[0].schema), undefined, '⛔ guidance leaked into the read-planning call')
      assert.equal(calls[1].schemaName, 'distill_with_answer_plan')
      assert.ok(typeof factsDescOf(calls[1].schema) === 'string', 'the composition call must be annotated')
    })
  })

  test('*** ⛔ the wrapper does not mutate the shared frozen schema ***', () => {
    const base = withRowRefs(DISTILL_WITH_PLAN_SCHEMA, ['gmail#m1'])
    const before = JSON.stringify(base)
    const out = withTerminalComposeGuidance(base)
    assert.equal(JSON.stringify(base), before, '⛔ the shared schema was mutated in place')
    assert.equal(factsDescOf(base), undefined)
    assert.ok(typeof factsDescOf(out) === 'string')
    assert.equal(factsDescOf(DISTILL_WITH_PLAN_SCHEMA), undefined, '⛔ the module-level schema was touched')
  })

  test('*** it points judgement at the fields that carry it, and values at facts ***', () => {
    const d = factsDescOf(withTerminalComposeGuidance(withRowRefs(DISTILL_WITH_PLAN_SCHEMA, [])))
    assert.match(d, /directAnswer/, 'the reason belongs in directAnswer and must say so')
    assert.match(d, /limitations/, 'what could not be seen belongs in limitations')
  })

  test('*** a schema of another shape is returned untouched, not half-annotated ***', () => {
    const odd = Object.freeze({ type: 'object', properties: {} })
    assert.equal(withTerminalComposeGuidance(odd), odd)
    assert.equal(withTerminalComposeGuidance(null), null)
  })
})

/* ═══ 4. THE QUALITY FIXTURE — a concise grounded answer must survive ══════ */

describe('C5 (4) a concise grounded priority answer survives validation', () => {
  test('*** ⛔ directAnswer is preserved; no answer_unsupported, no zero-item ***', async () => {
    await withEnv(async () => {
      const { res, plan } = await turn([READ, GOOD_FINAL])
      assert.ok(plan, 'the Answer Plan telemetry line must exist')
      assert.notEqual(plan.reason, 'answer_unsupported', '⛔ the answer sentence was deleted again')
      assert.notEqual(plan.outcome, 'fallback', '⛔ the plan was bypassed')
      assert.ok(plan.modelItemCount > 0, '⛔ zero-item failure')
      assert.equal(plan.keptItemCount, plan.modelItemCount, '⛔ an intended item was dropped')
      assert.ok(String(res.reply).includes('SANITISED-MAIL-B'), 'the prioritised item must reach the Owner')
      assert.equal(res.readClaimCorrected, false, '⛔ a false-read correction fired on a successful read')
    })
  })

  test('*** ⛔ SEEN TO FAIL — the production shape still fails, so the test can tell them apart ***', async () => {
    // The same turn with the production defect reproduced: judgement written into `facts`, and
    // a CJK count in the sentence that no row carries. If this passed, the test above would be
    // proving nothing.
    const BAD = JSON.parse(JSON.stringify(GOOD_FINAL))
    BAD.answerPlan.directAnswer = '四封郵件當中有兩封要即刻處理。'
    BAD.answerPlan.sections[0].items[0].facts = [
      { field: '為何優先', value: '因為已經逾期，需要即刻回覆' },
      { field: '性質', value: '推廣／會員優惠通知' }
    ]
    await withEnv(async () => {
      const { plan } = await turn([READ, BAD])
      assert.ok(plan.droppedSentences > 0 || plan.droppedFacts > 0,
        'the production shape must still lose content — otherwise nothing was measured')
    })
  })
})

/* ═══ 5. RANKING — reported honestly, never faked ══════════════════════════ */

describe('C5 (5) ranking over Gmail cannot be proven, and is not pretended', () => {
  test('*** ⛔ only the Aroma adapter ever sets a rankingMetric ***', () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const dir = path.join(__dirname, '..', 'context', 'adapters')
    const setters = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
      .filter((f) => /rankingMetric/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
    assert.deepEqual(setters, ['aromaSystemRead.js'],
      '⛔ the ranking-proof surface changed — C5 assumed it was Aroma-only')
  })

  test('*** ⛔ a declared ranking over Gmail rows is REJECTED, not accepted ***', async () => {
    const RANKED = JSON.parse(JSON.stringify(GOOD_FINAL))
    RANKED.answerPlan.sections[0].heading = '頭兩項最緊急'
    RANKED.answerPlan.sections[0].rankingClaim = { kind: 'top_n', n: 2, metric: null }
    await withEnv(async () => {
      const { plan } = await turn([READ, RANKED])
      const verdicts = Array.isArray(plan.rankingGate) ? plan.rankingGate : []
      assert.ok(verdicts.some((v) => v.status === 'evaluated_rejected'),
        '⛔ an unprovable ranking was allowed through: ' + JSON.stringify(verdicts))
    })
  })

  test('*** ⛔ and the useful, non-fabricated form is the one that survives ***', async () => {
    // No rankingClaim: the priority judgement lives in directAnswer, the items are listed
    // neutrally, and nothing claims a proof the evidence cannot carry.
    await withEnv(async () => {
      const { res, plan } = await turn([READ, GOOD_FINAL])
      const verdicts = Array.isArray(plan.rankingGate) ? plan.rankingGate : []
      assert.equal(verdicts.some((v) => v.status === 'evaluated_rejected'), false,
        'an undeclared list is not a rejected ranking')
      assert.ok(String(res.reply).length > 0, 'the Owner still receives an answer')
    })
  })
})

/* ═══ 6. THE ADAPTER'S STRUCTURAL TELEMETRY ═══════════════════════════════ */

describe('C5 (6) response shape is measurable, and carries no content', () => {
  const KEY = 'FAKE-KEY-NOT-A-CREDENTIAL'
  const reply = (blocks, stop) => async () => ({ data: { content: blocks, stop_reason: stop || 'end_turn', model: 'claude-opus-5', usage: { input_tokens: 10, output_tokens: 3052 } } })

  test('*** ⛔ text-only: the shape reports chars, one block, no thinking ***', async () => {
    const a = new ClaudeAdapter({ model: 'claude-opus-5', apiKey: KEY, transport: reply([{ type: 'text', text: '你好嗎' }]) })
    const r = await a.complete('hi')
    assert.equal(r.text, '你好嗎')
    assert.equal(r.shape.textChars, 3)
    assert.equal(r.shape.textBytes, 9)
    assert.equal(r.shape.textBlockCount, 1)
    assert.deepEqual(r.shape.blockKinds, ['text'])
    assert.equal(r.shape.thinkingBlockPresent, false)
  })

  test('*** ⛔ THE QUESTION PRODUCTION COULD NOT ANSWER: thinking beside a short answer ***', async () => {
    // 3,052 output tokens and 6 characters of answer is a different problem from 3,052 tokens
    // of answer. Until now both looked identical from outside.
    const a = new ClaudeAdapter({
      model: 'claude-opus-5',
      apiKey: KEY,
      transport: reply([{ type: 'thinking', thinking: 'PRIVATE-REASONING' }, { type: 'text', text: '好，我睇咗' }])
    })
    const r = await a.complete('hi')
    assert.equal(r.shape.thinkingBlockPresent, true)
    assert.deepEqual(r.shape.blockKinds, ['thinking', 'text'])
    assert.equal(r.shape.textChars, 5)
    assert.equal(r.usage.outputTokens, 3052)
  })

  test('*** ⛔ NO CONTENT EVER TRAVELS IN THE SHAPE ***', async () => {
    const a = new ClaudeAdapter({
      model: 'claude-opus-5',
      apiKey: KEY,
      transport: reply([{ type: 'thinking', thinking: 'PRIVATE-REASONING' }, { type: 'text', text: 'SECRET-BODY' }])
    })
    const r = await a.complete('hi')
    const s = JSON.stringify(r.shape)
    assert.equal(s.includes('PRIVATE-REASONING'), false, '⛔ thinking content leaked into telemetry')
    assert.equal(s.includes('SECRET-BODY'), false, '⛔ answer content leaked into telemetry')
    assert.equal(s.includes(KEY), false)
    // Only these keys, ever.
    assert.deepEqual(Object.keys(r.shape).sort(),
      ['blockKinds', 'textBlockCount', 'textBytes', 'textChars', 'thinkingBlockPresent'])
  })

  test('*** the thinking-only failure is unchanged — the shape did not swallow it ***', async () => {
    const a = new ClaudeAdapter({ model: 'claude-opus-5', apiKey: KEY, transport: reply([{ type: 'thinking', thinking: 'x' }], 'max_tokens') })
    await assert.rejects(() => a.complete('hi'), /only reasoning blocks/)
  })
})

/* ═══ 8. THE RESERVED COMPOSE — the other terminal path ════════════════════ */

describe('C5 (8) the reserved compose carries the same evidence and cannot re-read', () => {
  /**
   * ⛔ TWO TERMINAL PATHS, AND THE FIRST FIXTURE ONLY REACHED ONE.
   *
   * A turn ends either because a reasoning step returns `final` (production 0c3c0371) or
   * because the loop spends its steps and grants the reserved `composeOnly` call. Mutation
   * found this: MUT-C5-1/2/3 all target the composeOnly branch and all SURVIVED, because
   * nothing here ever drove the loop that far. A model that keeps asking does.
   */
  const KEEP_READING = { intent: 'question', mode: 'chat', reply: '再睇多啲。', nextRead: { capability: 'gmail' } }

  test('*** ⛔ the reserved compose still carries all four Gmail rows and the question ***', async () => {
    await withEnv(async () => {
      const { calls } = await turn([READ, KEEP_READING, KEEP_READING, KEEP_READING, KEEP_READING])
      const reserved = calls.find((c) => /最後一次呼叫/.test(c.prompt))
      assert.ok(reserved, 'the reserved compose must have run: ' + calls.length + ' calls')
      for (const r of ROWS) {
        assert.ok(reserved.prompt.includes(r.title), '⛔ MISSING FROM THE RESERVED COMPOSE: ' + r.title)
      }
      assert.ok(reserved.prompt.includes('優先處理'), '⛔ the Owner question was dropped from the reserved compose')
    })
  })

  test('*** ⛔ the reserved compose CANNOT ask for another read ***', async () => {
    await withEnv(async () => {
      const { calls } = await turn([READ, KEEP_READING, KEEP_READING, KEEP_READING, KEEP_READING])
      const reserved = calls.find((c) => /最後一次呼叫/.test(c.prompt))
      assert.ok(reserved)
      assert.equal(nextReadOpen(reserved.schema), false,
        '⛔ the reserved call was offered a read the runtime refuses to honour')
    })
  })

  test('*** ⛔ and the read-planning schema can never be annotated, by construction ***', () => {
    // MUT-C5-6 is an EQUIVALENT MUTANT and this is why: the wrapper is shape-guarded, so
    // wrapping the read-decision schema returns the identical object. The property holds
    // structurally rather than by a rule someone has to remember.
    const rd = answerPlan.DISTILL_WITH_READ_DECISION_SCHEMA
    assert.equal(withTerminalComposeGuidance(rd), rd, '⛔ the wrapper altered a read-planning schema')
    assert.equal(factsDescOf(rd), undefined)
  })
})

/* ═══ 7. NOTHING ELSE MOVED ═══════════════════════════════════════════════ */

describe('C5 (7) the protected boundaries are untouched', () => {
  test('*** ⛔ C3 model separation is unchanged ***', () => {
    const { A4_ROLES } = require('./a4Runtime')
    assert.equal(A4_ROLES.sourceIntentResolver.model, 'gpt-5.6-terra')
    assert.equal(A4_ROLES.finalVerifier.model, 'gpt-5.6-terra')
    assert.equal(A4_ROLES.publicQueryPlanner.model, 'gpt-5.6-terra')
    assert.equal(A4_ROLES.recoveryWorker.model, 'claude-haiku-4-5-20251001')
    const fs = require('node:fs')
    const path = require('node:path')
    const svc = fs.readFileSync(path.join(__dirname, 'intakeService.js'), 'utf8')
    assert.match(svc, /const controlAdapter = \(opts && opts\.controlAdapter\) \|\| adapter/,
      '⛔ the C3 control-adapter seam moved')
  })

  test('*** ⛔ the chat budget constant is still 8192 in source ***', () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const svc = fs.readFileSync(path.join(__dirname, 'intakeService.js'), 'utf8')
    assert.match(svc, /CHAT_MAX_TOKENS = 8192/, '⛔ the chat token budget was lowered')
  })

  test('*** ⛔ C4 source vocabulary is unchanged ***', () => {
    const { operationNames } = require('./goal/operationCatalogue')
    for (const s of ['gmail', 'drive', 'calendar', 'github']) assert.ok(operationNames().includes(s))
  })
})
