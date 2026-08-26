'use strict'
/**
 * semanticFallback.js — TWO INDEPENDENT OPINIONS, OR NOBODY READS ANYTHING.
 *
 * The deterministic router is precise and narrow: over a 68-row corpus it produced zero false
 * positives and left 21 real business questions reading nothing at all. This recovers part of
 * that narrow half WITHOUT spending the precise half, so it runs in exactly one place — after
 * the deterministic router has already decided CONVERSATION.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY TWO CALLS AND NOT ONE.
 *
 * Measured on the miss corpus: single-call HIGH produced 10 candidates, and ONE of them was
 * wrong — 「有咩貨唔夠要入返？」 came back `inventory` at HIGH when the answer was
 * `order_planning`. The same sentence returned `order_planning` at HIGH on the next pass. A
 * confidence score cannot see its own instability; only a second, independent opinion can.
 *
 * The two calls must be INDEPENDENT. They are issued in parallel and parsed separately — one
 * parsed response may never be copied into both slots, because two identical answers derived
 * from one request prove nothing and would silently restore single-call behaviour.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ⛔ AND IT DECIDES AN INTENT, NEVER AN AUTHORITY. The model names a key from a closed enum.
 * The SERVER maps that key through the existing INTENTS table to get sources. A key the table
 * does not know resolves to nothing and reads nothing. There is no second source registry.
 */

const { INTENTS } = require('../context/readContext')
const { admit, NONE } = require('../context/eval/semanticIntentShadow')

const DECISION = Object.freeze({ AUTO_READ: 'AUTO_READ', CLARIFY: 'CLARIFY', ABSTAIN: 'ABSTAIN' })

/**
 * ⛔ WORDING THAT IS AMBIGUOUS NO MATTER HOW CONFIDENT THE MODEL SOUNDS.
 *
 * A bare shortage claim answers equally as 「what is low」 (inventory) and 「what to reorder」
 * (order_planning). 「有咩貨唔夠要入返？」 is the measured case, and the model asserted BOTH
 * readings at HIGH on separate passes.
 *
 * 夠唔夠 is deliberately excluded: 「啲貨夠唔夠？」 asks a sufficiency QUESTION and resolves
 * cleanly to inventory — it is one of the rows that auto-reads correctly. The lookbehind is the
 * whole distinction between a shortage assertion and a sufficiency question.
 */
const AMBIGUOUS_WORDING = /(?<!夠)唔夠/

function isAmbiguousWording (message) {
  const t = typeof message === 'string' ? message : ''
  return AMBIGUOUS_WORDING.test(t)
}

/** SERVER-SIDE source resolution. The model had no part in this. */
function resolveSource (intentKey) {
  if (!intentKey || intentKey === NONE) return []
  const hit = INTENTS.find((i) => i.key === intentKey)
  return hit && Array.isArray(hit.sources) ? hit.sources.slice() : []
}

/** A short, specific question naming both readings — never a read. */
function clarifyQuestionFor (a, b) {
  const label = { inventory: '而家邊啲貨存量低', order_planning: '訂貨建議', invoice: '發票',
    purchase_order: '未到嘅採購單', daily_count: '今日盤點', supplier: '供應商',
    schedule: '行程', mail: '郵件', document: '文件', code: '程式碼改動' }
  const x = label[a]; const y = label[b]
  if (x && y && x !== y) return '你係想睇' + x + '，定係想睇' + y + '？'
  return '你想睇邊方面嘅資料？我怕估錯，想同你確認一次。'
}

/** One call, parsed on its own. Never throws: a dead provider is a result, not a crash. */
async function oneCall (callModel, message, system) {
  try {
    const raw = await callModel({ system, prompt: message })
    return { ok: true, ...admit(raw) }
  } catch (e) {
    return { ok: false, candidate: NONE, confidence: 'LOW', rejected: 'provider_error' }
  }
}

/**
 * ⛔ THE DECISION, SEPARATED FROM THE I/O ON PURPOSE.
 *
 * Three of the fences below cannot be reached through resolveSemanticFallback today, each
 * because a DIFFERENT upstream invariant already holds: a failed call cannot carry a candidate,
 * NONE is normalised to LOW before it ever arrives, and every enum key currently exists in the
 * INTENTS table. That is exactly how a guard rots — unreachable, untested, and quietly deleted
 * by someone who checked only that the suite still passed. Exposing the decision as a pure
 * function lets each fence be asserted on its own terms, against the day one of those
 * invariants changes.
 *
 * @param {{ok:boolean, candidate:string, confidence:string}} a
 * @param {{ok:boolean, candidate:string, confidence:string}} b
 * @param {boolean} ambiguous
 * @param {(k:string)=>string[]} [resolveFn]  injected for tests; production uses the table
 */
function decideFromCalls (a, b, ambiguous, resolveFn) {
  const resolve = typeof resolveFn === 'function' ? resolveFn : resolveSource
  const bothOk = a.ok && b.ok
  const agree = a.candidate === b.candidate
  const bothHigh = a.confidence === 'HIGH' && b.confidence === 'HIGH'
  const real = a.candidate !== NONE

  if (bothOk && agree && bothHigh && real && !ambiguous) {
    const sources = resolve(a.candidate)
    if (sources.length === 0) {
      // An enum key the table does not know reads nothing. No second registry, no guessing.
      return { decision: DECISION.ABSTAIN, intent: null, sources: [], clarifyQuestion: null }
    }
    return { decision: DECISION.AUTO_READ, intent: a.candidate, sources, clarifyQuestion: null }
  }

  const usable = [a, b].filter((r) => r.ok && r.candidate !== NONE).map((r) => r.candidate)
  if (usable.length > 0) {
    return { decision: DECISION.CLARIFY, intent: null, sources: [],
      clarifyQuestion: clarifyQuestionFor(usable[0], usable[1] || usable[0]) }
  }
  return { decision: DECISION.ABSTAIN, intent: null, sources: [], clarifyQuestion: null }
}

/**
 * @returns {{applicable:boolean, decision:string, intent:string|null, sources:string[],
 *            clarifyQuestion:string|null, telemetry:object}}
 */
async function resolveSemanticFallback (opts) {
  const message = (opts && typeof opts.message === 'string') ? opts.message : ''
  const route = opts && opts.deterministicRoute
  const callModel = opts && opts.callModel
  const system = opts && opts.system

  // ⛔ THE ONLY DOOR. A deterministic win — UTILITY, ACTION, or a BUSINESS_QUERY that already
  // named its sources — is final and never reaches this module.
  if (route !== 'CONVERSATION' || typeof callModel !== 'function') {
    return { applicable: false, decision: DECISION.ABSTAIN, intent: null, sources: [], clarifyQuestion: null,
      telemetry: { deterministicRoute: route || null, semanticInvoked: false } }
  }

  const ambiguous = isAmbiguousWording(message)
  const started = 0
  // Independent and parallel: latency is max(A,B), not A+B.
  const [a, b] = await Promise.all([oneCall(callModel, message, system), oneCall(callModel, message, system)])

  const tel = {
    deterministicRoute: 'CONVERSATION',
    semanticInvoked: true,
    ambiguousWording: ambiguous,
    candidateA: a.candidate, confidenceA: a.confidence, okA: a.ok,
    candidateB: b.candidate, confidenceB: b.confidence, okB: b.ok,
    consensus: false, clarify: false, finalIntent: null, selectedSource: [], readExecuted: false
  }

  const d = decideFromCalls(a, b, ambiguous)
  if (d.decision === DECISION.AUTO_READ) { tel.consensus = true; tel.finalIntent = d.intent; tel.selectedSource = d.sources }
  if (d.decision === DECISION.CLARIFY) { tel.clarify = true }
  return { applicable: true, decision: d.decision, intent: d.intent, sources: d.sources,
    clarifyQuestion: d.clarifyQuestion, telemetry: tel }
}
module.exports = { DECISION, resolveSemanticFallback, decideFromCalls, resolveSource, isAmbiguousWording, clarifyQuestionFor }
