'use strict'

/**
 * C2-a — THE RESERVED COMPOSE CALL MUST ACTUALLY BE COMPOSE-ONLY.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE FLAG WAS PASSED AND NOBODY READ IT.
 *
 * `reasoningLoop` spends its last budget on one reserved call and passes `composeOnly: true`,
 * documenting that a read from it is refused so it cannot extend the turn. The only production
 * consumer is `intakeService`'s `callModel`, and it destructured `async ({ step })` — so the
 * flag arrived nowhere. That call was built like any other planning step: the same prompt, and
 * a schema whose `nextRead` still listed every operation not yet read.
 *
 * So on its LAST call the model was still being invited to ask for another read. When it did,
 * `callModel` returned `{type:'read'}`, the loop's compose branch requires `type === 'final'`,
 * and the entire envelope was discarded — `STEP_LIMIT_NO_COMPOSE`, then `no_plan_returned`.
 * Q9, Q21, Q24 and Q26 of the benchmark all died exactly there, each with modelCallCount 4,
 * steps 4, observations 3.
 *
 * ⛔ WHY THIS FILE EXERCISES THE REAL CONSUMER.
 *
 * `reservedCompose.test.js` already covers this path — and stayed green for the whole time the
 * defect was live, because its fake callModel destructures `composeOnly` itself and composes
 * BECAUSE of it. That proves the loop PASSES the flag. It cannot prove any consumer READS it.
 * This is the same shape as the eight-day error-message defect: a test comparing the right
 * thing inside a world it built itself.
 *
 * So the assertions below observe what production actually handed the PROVIDER: the prompt and
 * the response schema, captured at the adapter boundary. No fake here knows what `composeOnly`
 * is, and none is asked to.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')
const { A4_FLAG } = require('./a4Contract')

const NOW = '2026-08-17T00:00:00.000Z'
const REQ = '11111111-2222-4333-8444-555555555555'

const ENV = {
  READ_ACCESS: 'on',
  CONTEXT_AROMA_SYSTEM: 'on',
  TURN_ROUTER: 'on',
  MULTI_AI_ROUTER: 'off',
  [A4_FLAG]: 'on'
}

async function withEnv (fn) {
  const saved = {}
  for (const k of Object.keys(ENV)) { saved[k] = process.env[k]; process.env[k] = ENV[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

/**
 * ⛔ THE PROVIDER BOUNDARY, RECORDED VERBATIM. This is not a stand-in for the consumer — it is
 * where production's own construction arrives. Whatever `callModel` built is what lands here.
 */
function recordingAdapter (envelopes) {
  const calls = []
  return {
    label: 'claude',
    calls,
    async complete (prompt, opts) {
      calls.push({ prompt: String(prompt), responseFormat: (opts && opts.responseFormat) || null })
      const body = envelopes[calls.length - 1]
      if (!body) throw new Error('adapter called more times than scripted: ' + calls.length)
      return { text: JSON.stringify(body), usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, model: 'scripted', latencyMs: 1, stopReason: 'end_turn' }
    }
  }
}

const liveConnector = () => ({
  reads: [],
  connector: {
    async read (source, method) {
      const rows = [{ source, sourceId: '7', title: 'Brisket', entityType: 'inventory_item', content: 'x=1', fields: { id: '7', x: '1' }, trust: 'live', retrievedAt: NOW, originalDate: null, link: null, error: null }]
      return {
        asOf: NOW,
        source,
        count: 1,
        results: rows,
        evidence: { source, endpoint: method, entityType: 'inventory_item', rowShape: { hasLocation: false, hasAsOf: false, note: null }, metrics: {}, matchingTotal: 1, shownCount: 1, sourceTotal: null, queryScope: { field: null, window: null, declaredBy: 'reader' }, completeness: 'complete', usedFallback: false, retrievedAt: NOW, trust: 'live', provenance: 'fake' }
      }
    }
  }
})

const READ = (capability) => ({ intent: 'question', mode: 'chat', reply: '等我睇睇。', nextRead: { capability }, answerPlan: null })
/** The shape the benchmark actually produced on the reserved call: another read request. */
const STILL_READING = READ('aroma_system.daily_counts')

/** Q9's real budget shape: three model-directed reads, then the reserved call. */
const THREE_READS = ['aroma_system.inventory', 'aroma_system.replenishment', 'aroma_system.purchasing'].map(READ)

const run = (msg, adapter, connector) => processIntake(msg, adapter, [], {
  demo: true,
  interactionMode: 'chat',
  providerHint: 'claude',
  requestId: REQ,
  readContextDeps: { connector, sources: ['aroma_system'], sourceIntentResolver: async () => ({ intent: 'internal' }) }
})

const nextReadOf = (call) => {
  const s = call && call.responseFormat && call.responseFormat.schema
  return s && s.properties ? s.properties.nextRead : undefined
}

/* ═══ A / B / C — the reserved call ════════════════════════════════════════ */

test('*** ⛔ A+C. THE RESERVED COMPOSE CALL MAY NOT OFFER ANOTHER READ ***', async () => {
  await withEnv(async () => {
    const c = liveConnector()
    const a = recordingAdapter([...THREE_READS, STILL_READING])
    await run('有冇貨已經有 incoming，所以唔應該再訂咁多？', a, c.connector)

    assert.equal(a.calls.length, 4, 'the budget is 3 steps plus one reserved call — got ' + a.calls.length)

    const reserved = nextReadOf(a.calls[3])
    assert.ok(reserved, 'the reserved call still carries the answer-plan contract')
    assert.equal(reserved.type, 'null',
      '⛔ nextRead is STILL OPEN on the final call — the model is being invited to read again ' +
      'when there is no budget left to honour it. This is the Q9/Q21/Q24/Q26 death.')
  })
})

test('*** ⛔ B. THE PROMPT ON THAT CALL SAYS IT IS THE FINAL COMPOSITION ***', async () => {
  /**
   * ⛔ THE OBSERVABLE PROOF THAT `composeOnly` REACHED THE CONSUMER. Only the consumer can
   * change the prompt, so a difference here cannot be produced by the loop, by this test, or
   * by any fake. Structural instruction only — no reasoning advice, no hidden thinking.
   */
  await withEnv(async () => {
    const c = liveConnector()
    const a = recordingAdapter([...THREE_READS, STILL_READING])
    await run('有冇貨已經有 incoming，所以唔應該再訂咁多？', a, c.connector)

    const ordinary = a.calls.slice(0, 3).map((x) => x.prompt)
    const reserved = a.calls[3].prompt

    // ⛔ THE MARKERS ARE DUPLICATED HERE ON PURPOSE — this is a contract pin. If the wording
    //    moves, this must be updated deliberately rather than drifting silently.
    assert.match(reserved, /最後一步/, '⛔ the reserved call was never told it is the last one')
    assert.match(reserved, /nextRead 必須係 null/, '⛔ the reserved call was not told the read door is shut')

    // ⛔ AND NOT MERELY "DIFFERENT". The prompt already varies between steps because it carries
    //    the accumulated observations, so a difference alone proves nothing — an earlier draft
    //    of this test passed against the DEFECT for exactly that reason.
    for (let i = 0; i < ordinary.length; i++) {
      assert.equal(/最後一步/.test(ordinary[i]), false,
        '⛔ ordinary call ' + (i + 1) + ' was told it is the final call — the directive leaked')
    }
  })
})

/* ═══ D — ordinary calls must not be narrowed ══════════════════════════════ */

test('*** D. ORDINARY CALLS STILL OFFER THE SAME OPEN CHOICES ***', async () => {
  // ⛔ THE OVER-NARROWING GUARD. Closing nextRead everywhere would "fix" the symptom by
  //    removing the model's ability to read at all. Steps 1-3 must be untouched.
  await withEnv(async () => {
    const c = liveConnector()
    const a = recordingAdapter([...THREE_READS, STILL_READING])
    await run('有冇貨已經有 incoming，所以唔應該再訂咁多？', a, c.connector)

    for (let i = 0; i < 3; i++) {
      const nr = nextReadOf(a.calls[i])
      assert.ok(nr, 'call ' + (i + 1) + ' carries a schema')
      assert.notEqual(nr.type, 'null', '⛔ ordinary call ' + (i + 1) + ' lost its ability to request a read')
      const en = nr.properties && nr.properties.capability && nr.properties.capability.enum
      assert.ok(Array.isArray(en) && en.length > 0, '⛔ ordinary call ' + (i + 1) + ' has an empty choice list')
    }
  })
})

/* ═══ E — a usable plan on the reserved call still completes ═══════════════ */

test('*** E. A GROUNDED PLAN ON THE RESERVED CALL IS USED, NOT DISCARDED ***', async () => {
  /**
   * ⛔ A PRESERVATION TEST, AND SAID SO PLAINLY. This passes before the fix as well as after —
   * the loop always accepted a `final` from the reserved call. It is here because closing
   * `nextRead` must not cost the turn its ability to COMPOSE on that call: if a later change
   * ever narrows the reserved contract too far, this goes red.
   *
   * ⛔ THE PLAN IS GROUNDED ON PURPOSE. An ungrounded one is dropped by the answer validator —
   * correctly, and for reasons that have nothing to do with C2-a. Measured while writing this:
   * a plain sentence with no row ref returned `answer_unsupported`, which would have made this
   * test fail for the wrong reason and taught the next reader the wrong lesson.
   */
  await withEnv(async () => {
    const c = liveConnector()
    const FINAL = {
      intent: 'question',
      mode: 'chat',
      reply: 'Brisket 喺紀錄入面。',
      nextRead: null,
      answerPlan: {
        directAnswer: 'Brisket 喺紀錄入面。',
        citesEvidence: true,
        unanswerable: false,
        sections: [{ heading: '倉存', items: [{ sourceId: 'aroma_system.inventory#7', title: 'Brisket', facts: [] }] }],
        limitations: [],
        followUp: null
      }
    }
    const a = recordingAdapter([...THREE_READS, FINAL])
    const out = await run('有冇貨已經有 incoming，所以唔應該再訂咁多？', a, c.connector)
    assert.equal(a.calls.length, 4, 'the reserved call happened')
    assert.ok(String(out && out.reply).includes('Brisket'),
      '⛔ a usable final from the reserved call did not reach the Owner — got: ' + String(out && out.reply).slice(0, 140))
    assert.equal(String(out && out.reply).includes('組不出一個可靠的答案'), false,
      '⛔ the deterministic fallback replaced a valid composed answer')
  })
})

/* ═══ G — the benchmark death, reproduced without rerunning it ═════════════ */

test('*** ⛔ G. A RESERVED CALL THAT STILL ASKS TO READ ENDS IN THE FALLBACK ***', async () => {
  /**
   * ⛔ THIS IS Q9 / Q21 / Q24 / Q26, DETERMINISTICALLY AND WITH NO PROVIDER. The envelope on
   * the reserved call carries `nextRead`, exactly as production did; the loop cannot honour it
   * with no budget left, so the whole envelope is discarded and the Owner reads the fallback.
   *
   * ⛔ IT STAYS TRUE AFTER THE FIX, BY DESIGN. Closing the schema removes the model's REASON to
   * ask; it does not, and must not, invent an answer when it asks anyway. `STEP_LIMIT_NO_COMPOSE`
   * semantics are unchanged — what changes is how often the model is led into it.
   */
  await withEnv(async () => {
    const c = liveConnector()
    const a = recordingAdapter([...THREE_READS, STILL_READING])
    const out = await run('有冇貨已經有 incoming，所以唔應該再訂咁多？', a, c.connector)
    assert.equal(a.calls.length, 4)
    /**
     * ⛔ MEASURED, NOT ASSUMED — AND MY FIRST GUESS WAS WRONG. I expected the minimalAnswer
     * sentence 「組不出一個可靠的答案」 here. The run shows something worse: the discarded
     * envelope leaves the LAST INTERIM prose standing as the answer, so the Owner reads
     * 「等我睇睇。」 — a sentence that promised to go and look — as though it were the reply.
     * That matches the benchmark, where Q9 ended on 「我需要睇一次現有存量…」 and the
     * minimalAnswer sentence appeared on OTHER questions entirely.
     */
    assert.ok(String(out && out.reply).includes('等我睇睇'),
      'the discarded-envelope shape is reproduced here rather than by re-running the benchmark — got: ' +
      String(out && out.reply).slice(0, 120))
  })
})
