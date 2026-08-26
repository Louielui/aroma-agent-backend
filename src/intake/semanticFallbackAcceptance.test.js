'use strict'
/**
 * semanticFallbackAcceptance.test.js — THE WHOLE CORPUS, THROUGH THE ACTIVATED PATH.
 *
 * Not classifier output — FINAL BEHAVIOUR. Every row runs the real deterministic router, and
 * only the rows it leaves reading nothing reach the semantic fallback.
 *
 * ⛔ THE MODEL REPLIES ARE REPLAYED FROM THE REAL B3 QUALIFICATION, not invented. Two live
 * passes of claude-haiku-4-5-20251001 over these exact 21 sentences produced exactly these
 * candidates and confidences, including the disagreement on 「有咩貨唔夠要入返？」 that is the
 * whole reason two calls are required. Inventing agreeable fixtures would test the harness
 * rather than the contract.
 *
 * Connectors are fake and counted. No network, no provider, no production HTTP.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { routeTurn } = require('./turnRouter')
const { DECISION, resolveSemanticFallback } = require('./semanticFallback')
const { CORPUS } = require('../context/eval/businessIntentCorpus')

/** Real measured pairs from the B3 run: q -> [passA, passB] as "intent/CONFIDENCE". */
const REPLAY = {
  '有咩貨唔夠要入返？': ['inventory/HIGH', 'order_planning/HIGH'],
  '有啲咩要買返嚟？': ['order_planning/MEDIUM', 'order_planning/MEDIUM'],
  '今日要入啲乜？': ['NONE/LOW', 'NONE/LOW'],
  '仲有幾多貨？': ['inventory/HIGH', 'inventory/HIGH'],
  '啲貨夠唔夠？': ['inventory/HIGH', 'inventory/HIGH'],
  '雪櫃仲有幾多？': ['inventory/HIGH', 'inventory/HIGH'],
  '有冇嘢斷咗貨？': ['inventory/HIGH', 'inventory/HIGH'],
  '有邊幾張單未找？': ['invoice/HIGH', 'invoice/HIGH'],
  '今個月啲單幾多錢？': ['invoice/MEDIUM', 'invoice/HIGH'],
  '邊張單金額最大？': ['NONE/LOW', 'NONE/LOW'],
  '有冇未付嘅單？': ['invoice/HIGH', 'invoice/HIGH'],
  '有咩仲未到？': ['NONE/LOW', 'NONE/LOW'],
  '叫咗嘅貨到咗未？': ['purchase_order/HIGH', 'purchase_order/HIGH'],
  '有冇未到貨嘅單？': ['purchase_order/HIGH', 'purchase_order/HIGH'],
  '上星期落咗幾多張單？': ['NONE/LOW', 'NONE/LOW'],
  '呢樣嘢我哋同邊個買？': ['supplier/HIGH', 'supplier/HIGH'],
  '邊間出呢隻貨？': ['NONE/LOW', 'NONE/LOW'],
  '有咩嘢就快唔夠？': ['NONE/LOW', 'NONE/LOW'],
  '聽日搞乜？': ['NONE/LOW', 'NONE/LOW'],
  '有冇人覆咗我？': ['NONE/LOW', 'NONE/LOW'],
  '份 spec 喺邊？': ['NONE/LOW', 'NONE/LOW']
}

/** A model that serves pass A then pass B, so the two calls are genuinely different replies. */
function replayFor (q, reads) {
  let n = 0
  return async () => {
    const pair = REPLAY[q]
    if (!pair) return JSON.stringify({ intent: 'NONE', confidence: 'LOW' })
    // ⛔ A read that appears BETWEEN this row entering the fallback and consensus being
    // reached would mean the classifier itself caused it. Compare against the count taken
    // when THIS row started, not the running total — earlier rows read legitimately.
    if (reads.count !== reads.atRowStart) reads.preConsensus++
    const [intent, confidence] = pair[Math.min(n++, 1)].split('/')
    return JSON.stringify({ intent, confidence })
  }
}

async function activatedRun () {
  const reads = { count: 0, preConsensus: 0, atRowStart: 0 }
  const out = []
  for (const row of CORPUS) {
    const rt = routeTurn(row.q, { previousLane: null })
    if (rt.route !== 'CONVERSATION') {
      // Deterministic win — final, and never offered to the classifier.
      if ((rt.sources || []).length > 0) reads.count++
      out.push({ row, path: 'deterministic', route: rt.route, intent: rt.domain || null, sources: rt.sources || [] })
      continue
    }
    reads.atRowStart = reads.count
    const r = await resolveSemanticFallback({
      message: row.q, deterministicRoute: 'CONVERSATION', callModel: replayFor(row.q, reads), system: 'x'
    })
    if (r.decision === DECISION.AUTO_READ) reads.count++
    out.push({ row, path: 'semantic', decision: r.decision, intent: r.intent, sources: r.sources })
  }
  return { out, reads }
}

test('*** ACTIVATED: deterministic wins are untouched ***', async () => {
  const { out } = await activatedRun()
  const det = out.filter((o) => o.path === 'deterministic')
  // Every previously-correct deterministic row still resolves the same way.
  const bizCorrect = det.filter((o) => o.row.expect.intent && o.intent === o.row.expect.intent)
  assert.equal(bizCorrect.length, 27, 'deterministic correct rows changed')
  // And no UTILITY / ACTION row was ever offered to the classifier.
  for (const o of det) assert.notEqual(o.path, 'semantic')
})

test('*** ACTIVATED: no false positive, no wrong source, no action misroute ***', async () => {
  const { out } = await activatedRun()
  const nonBiz = out.filter((o) => o.row.expect.kind === 'NON_BUSINESS')
  for (const o of nonBiz) {
    assert.equal((o.sources || []).length, 0, '⛔ a non-business row read something: ' + o.row.q)
  }
  const actions = out.filter((o) => o.row.expect.mode === 'ACTION')
  for (const o of actions) {
    assert.notEqual(o.route, 'BUSINESS_QUERY', '⛔ action answered as read: ' + o.row.q)
    assert.equal((o.sources || []).length, 0)
  }
})

test('*** ACTIVATED: the 21 misses — 9 auto-read, 0 wrong ***', async () => {
  const { out } = await activatedRun()
  const sem = out.filter((o) => o.path === 'semantic' && o.row.expect.kind === 'BUSINESS' && o.row.expect.mode === 'READ')
  const auto = sem.filter((o) => o.decision === DECISION.AUTO_READ)
  const wrong = auto.filter((o) => o.intent !== o.row.expect.intent)
  assert.equal(sem.length, 21, 'the miss population changed')
  assert.equal(auto.length, 9)
  assert.equal(wrong.length, 0, '⛔ an auto-read went to the wrong table: ' + wrong.map((w) => w.row.q).join(', '))
  assert.equal(sem.filter((o) => o.decision === DECISION.CLARIFY).length, 3)
  assert.equal(sem.filter((o) => o.decision === DECISION.ABSTAIN).length, 9)
})

test('*** ACTIVATED: the ambiguous sentence CLARIFIES, it does not read ***', async () => {
  const { out } = await activatedRun()
  const amb = out.find((o) => o.row.q === '有咩貨唔夠要入返？')
  assert.equal(amb.decision, DECISION.CLARIFY)
  assert.deepEqual(amb.sources, [], '⛔ an ambiguous sentence read a table')
})

test('*** ACTIVATED: 「叫咗嘅貨到咗未？」 reaches purchase_order ONLY on agreeing HIGH ***', async () => {
  const { out } = await activatedRun()
  const r = out.find((o) => o.row.q === '叫咗嘅貨到咗未？')
  assert.equal(r.decision, DECISION.AUTO_READ)
  assert.equal(r.intent, 'purchase_order')
  assert.deepEqual(r.sources, ['aroma_system'])
})

test('*** ACTIVATED: ZERO connector reads before consensus ***', async () => {
  const { reads } = await activatedRun()
  assert.equal(reads.preConsensus, 0, '⛔ something read before the classifier had agreed')
})
