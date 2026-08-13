'use strict'

/**
 * rankingProofClosure.test.js — the two things the Owner would not merge without.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ A. SILENCE IS THE WORSE DEFECT, AND THIS GATE DELIBERATELY EMPTIES TEXT.
 *
 * An unexplained empty reply already happened on this system — a completed call with
 * `content: ""`, cause still unsettled. `rankingProof` sets `directAnswer = ''` on purpose, so
 * 「the floor downstream should catch it」 is a claim about code, and this project has been
 * wrong about that before (`answerPlan.js:1251`, a whole contract that was computed and
 * consumed by nothing).
 *
 * These run the FULL intake path and assert what the Owner actually receives.
 *
 * ⛔ B. THE STRENGTH OF THE CLAIM DECIDES THE STRENGTH OF THE PROOF.
 *   「Napa Cabbage 最嚴重」            → first place only; the tail is not this gate's business
 *   an ordered/numbered ranking       → the WHOLE presented sequence must respect the proof
 * An ordinary list of items is NOT a ranking claim and must not be forced to become one.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { processIntake } = require('./intakeService')
const { RANKING_METRIC } = require('./rankingProof')
const { A4_FLAG } = require('./a4Contract')
const { A4_AMBIGUITY_FLAG } = require('./sourceAmbiguityGate')

const NOW = '2026-08-09T00:00:00.000Z'
const ASK = '現在缺貨最嚴重的是什麼？'

/** The Owner's real four, in the adapter's proven order: 70 > 39 > 37 > 20. */
const NAPA = 'Napa Cabbage'
const NOLA = 'New Orleans Style Sauce'
const SOY = 'Dark Soy Sauce'
const JARS = 'Jars for Red Chili Oil'
const RANKED = [
  { title: NAPA, id: '1', shortfall: 70 },
  { title: NOLA, id: '2', shortfall: 39 },
  { title: SOY, id: '3', shortfall: 37 },
  { title: JARS, id: '4', shortfall: 20 }
]

const BASE = { READ_ACCESS: 'on', CONTEXT_AROMA_SYSTEM: 'on', TURN_ROUTER: 'on', MULTI_AI_ROUTER: 'off', [A4_FLAG]: 'on', [A4_AMBIGUITY_FLAG]: 'on' }
async function withEnv (over, fn) {
  const all = Object.assign({}, BASE, over)
  const saved = {}
  for (const k of Object.keys(all)) { saved[k] = process.env[k]; if (all[k] === null) delete process.env[k]; else process.env[k] = all[k] }
  try { return await fn() } finally {
    for (const k of Object.keys(all)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
}

/**
 * ⛔ LIVE-SHAPED. The evidence object carries the ranking proof exactly as
 * `aromaSystemRead.describe()` emits it, because `readContext.describeRead` uses the adapter's
 * own descriptor as its base — so these fields survive the trip to `answerPlan` untouched.
 */
function rankedConnector () {
  const reads = []
  return {
    reads,
    connector: {
      async read (source, method) {
        reads.push({ method })
        return {
          asOf: NOW,
          source,
          count: RANKED.length,
          results: RANKED.map((r) => ({
            source,
            sourceId: r.id,
            title: r.title,
            entityType: 'inventory_item',
            content: `par 100 · on hand ${100 - r.shortfall}`,
            fields: { id: r.id, parLevel: '100', currentStock: String(100 - r.shortfall) },
            trust: 'live',
            retrievedAt: NOW,
            originalDate: null,
            link: null,
            error: null
          })),
          evidence: {
            source: 'aroma_system',
            entityType: 'inventory_item',
            endpoint: 'inventory',
            returnedRows: 199,
            shownCount: RANKED.length,
            matchingTotal: 199,
            sourceTotal: null,
            queryScope: { field: null, window: null, declaredBy: 'reader' },
            filtersApplied: null,
            limit: null,
            limitKnown: true,
            truncated: false,
            completeWithinScope: true,
            rowShape: { hasLocation: false, hasAsOf: false, note: null },
            metrics: {},
            derivations: {},
            fieldLabels: {},
            completeness: 'sample',
            rankedBy: 'parLevel - currentStock desc',
            rankingMetric: RANKING_METRIC.ABSOLUTE_SHORTFALL,
            rankingDirection: 'desc',
            rankingCompleteWithinScope: true,
            dataAsOf: null,
            retrievedAt: NOW,
            trust: 'live',
            provenance: 'FAKE INVENTORY'
          }
        }
      }
    }
  }
}

function scriptedAdapter (envelopes) {
  const calls = []
  return {
    label: 'claude',
    calls,
    async complete (prompt) {
      calls.push(String(prompt))
      const e = envelopes[Math.min(calls.length - 1, envelopes.length - 1)]
      return { text: JSON.stringify(e), usage: { inputTokens: 1, outputTokens: 1 } }
    }
  }
}

const READ = { intent: 'answer', mode: 'chat', reply: null, nextRead: { capability: 'aroma_system.inventory' }, answerPlan: null }

/** A terminal envelope carrying the model's own answer plan. */
const PLAN = (directAnswer, claims) => ({
  intent: 'answer',
  mode: 'chat',
  reply: directAnswer,
  nextRead: null,
  answerPlan: Object.assign({
    directAnswer,
    sections: [],
    limitations: [],
    followUp: null,
    unanswerable: false,
    citesEvidence: true
  }, claims ? { answerClaims: claims } : {})
})

const run = (msg, adapter, c) => processIntake(msg, adapter, [], {
  demo: true, interactionMode: 'chat', providerHint: 'claude', requestId: '11111111-2222-4333-8444-555555555555',
  readContextDeps: {
    connector: c.connector,
    sources: ['aroma_system', 'public_knowledge'],
    sourceIntentResolver: async () => ({ intent: 'internal' })
  }
})

const EXTREMUM = (metric) => [{ claimKind: 'extremum', metric }]

/* ═══ A — EVERY WITHHOLD BRANCH MUST STILL SHIP WORDS ════════════════════ */

/**
 * The four ways this gate withholds. Each must reach the Owner with SOMETHING — the
 * deterministic fallback or the empty-reply defect sentence, both of which already exist.
 * ⛔ No new ranking answer is invented to satisfy this; a refusal that had to be given a
 * voice would be a refusal that shipped an answer.
 */
const WITHHOLD_CASES = [
  {
    name: 'no declared claim',
    message: ASK,
    plan: PLAN(`缺貨最嚴重嘅係 ${NAPA}。`, null)
  },
  {
    name: 'metric mismatch (percentage question, absolute claim)',
    message: '邊個缺貨百分比最高？',
    plan: PLAN(`${NAPA}。`, EXTREMUM(RANKING_METRIC.ABSOLUTE_SHORTFALL))
  },
  {
    name: 'ranking incomplete',
    message: ASK,
    plan: PLAN(`${NAPA}。`, EXTREMUM(RANKING_METRIC.ABSOLUTE_SHORTFALL)),
    incomplete: true
  },
  {
    name: 'order contradicts the proof',
    message: ASK,
    plan: PLAN(`最緊急缺貨項目係 ${JARS}，之後係 ${NAPA}。`, EXTREMUM(RANKING_METRIC.ABSOLUTE_SHORTFALL))
  }
]

for (const c of WITHHOLD_CASES) {
  test(`*** ⛔ A. WITHHOLD 「${c.name}」 STILL SHIPS A NON-EMPTY REPLY ***`, async () => {
    await withEnv({}, async () => {
      const conn = rankedConnector()
      if (c.incomplete) {
        const inner = conn.connector.read
        conn.connector.read = async (s, m) => {
          const out = await inner(s, m)
          out.evidence.rankingCompleteWithinScope = false
          return out
        }
      }
      const out = await run(c.message, scriptedAdapter([READ, c.plan]), conn)
      const reply = String(out && out.reply != null ? out.reply : '')
      // ⛔ SHOWN, NOT ASSERTED IN PROSE. The message prints what actually shipped.
      assert.ok(reply.trim().length > 0,
        `⛔ SILENCE on withhold 「${c.name}」 — shipped: ${JSON.stringify(reply)}`)
      // It must be a real path, not a stray fragment of the refused answer.
      assert.ok(reply.length >= 2, 'shipped: ' + JSON.stringify(reply))
    })
  })
}

/**
 * ⛔ WHAT PROTECTS THIS PATH, AND WHAT DOES NOT. Measured this round, not reasoned:
 *
 *   bypass `ensureNonEmptyReply`  → these four tests STAYED GREEN
 *   empty `minimalAnswer`         → all four went red, shipping ""
 *
 * So the non-empty reply comes from `minimalAnswer` upstream, and the floor at
 * `intakeService.js:2380` is NOT reached on this path — the answer-plan branch returns at
 * `:2305`, before it.
 *
 * ⛔ AND THE WEAKER CLAIM IS THE ACCURATE ONE (Owner's wording, recorded verbatim so it does
 * not drift): that unreachability is **reliability debt and a potential contributor**. It is
 * NOT established as the cause of the 22:18:29Z empty reply, which remains UNSETTLED. A
 * separate work item; nothing here moves the floor.
 *
 * ⛔ A TEST NAMED 「A2. AND THE FLOOR IS REACHABLE FROM THIS PATH AT ALL」 STOOD HERE AND WAS
 * DELETED, because it asserted only that `EMPTY_REPLY_DEFECT` is a non-empty string — which
 * `governance/composedAnswer.test.js:83–84` already pins more strictly — while its NAME
 * asserted the opposite of what was measured above. The test-name ledger is a system contract,
 * so a name known to be false is worse than no test at all.
 */

/* ═══ B — CLAIM STRENGTH DECIDES PROOF STRENGTH ══════════════════════════ */

const { verifyRanking, VERDICT } = require('./rankingProof')
const ROWS = RANKED.map((r) => ({ title: r.title, sourceId: r.id }))
const EV = [{
  source: 'aroma_system',
  endpoint: 'inventory',
  trust: 'live',
  rankingMetric: RANKING_METRIC.ABSOLUTE_SHORTFALL,
  rankingDirection: 'desc',
  rankingCompleteWithinScope: true
}]

const check = (directAnswer) => verifyRanking({
  message: ASK, directAnswer, evidenceSets: EV, rankedRows: ROWS,
  claims: EXTREMUM(RANKING_METRIC.ABSOLUTE_SHORTFALL)
})

test('*** ⛔ B1. A RANKING WITH THE CORRECT FULL SEQUENCE IS ALLOWED ***', () => {
  const r = check(`缺貨排序：1. ${NAPA} 2. ${NOLA} 3. ${SOY} 4. ${JARS}`)
  assert.equal(r.verdict, VERDICT.ALLOW, 'verdict: ' + r.verdict)
})

test('*** ⛔ B2. NAPA FIRST BUT THE TAIL REORDERED MUST NOT SHIP AS A RANKING ***', () => {
  // ⛔ Position 1 is correct, so a first-place-only check would pass this. The Owner asked
  // specifically that a PRESENTED ranking be held to its whole sequence.
  const r = check(`缺貨排序：1. ${NAPA} 2. ${JARS} 3. ${SOY} 4. ${NOLA}`)
  assert.equal(r.verdict, VERDICT.ORDER_CONTRADICTS_PROOF, 'verdict: ' + r.verdict)
})

test('*** ⛔ B3. A BARE SUPERLATIVE NEEDS FIRST PLACE ONLY — NO TAIL VALIDATION ***', () => {
  // Names other items in a non-ranked way. This is not a ranking claim and must not be
  // forced to become one.
  const r = check(`缺貨最嚴重嘅係 ${NAPA}。另外 ${JARS} 同 ${SOY} 都要留意。`)
  assert.equal(r.verdict, VERDICT.ALLOW, 'verdict: ' + r.verdict)
})

test('*** ⛔ B4. AN ORDINARY LIST IS NOT A RANKING CLAIM ***', () => {
  const r = verifyRanking({
    message: '而家倉存有咩？',
    directAnswer: `有 ${JARS}、${SOY}、${NAPA}。`,
    evidenceSets: EV,
    rankedRows: ROWS,
    claims: null
  })
  assert.equal(r.verdict, VERDICT.NOT_ASKED, '⛔ an ordinary list was treated as a ranking')
})

test('*** ⛔ B5. AND A WRONG FIRST PLACE STILL FAILS, RANKING OR NOT ***', () => {
  const bare = check(`缺貨最嚴重嘅係 ${JARS}。`)
  assert.equal(bare.verdict, VERDICT.ORDER_CONTRADICTS_PROOF, 'verdict: ' + bare.verdict)
})
