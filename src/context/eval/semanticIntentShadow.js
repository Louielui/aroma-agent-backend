'use strict'
/**
 * semanticIntentShadow.js — A SUGGESTION. NEVER AN AUTHORITY.
 *
 * The deterministic matcher is precise (0 false positives over 16 adversarial rows) and narrow
 * (2/17 on colloquial questions). This exists to recover the narrow half WITHOUT spending the
 * precise half, so it runs ONLY where the deterministic router would otherwise read nothing.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT THIS MAY RETURN, AND WHAT IT MAY NEVER RETURN.
 *
 * MAY:    one key from a CLOSED enum, plus a bounded confidence.
 * NEVER:  a source, a connector, a tool, a method, a write/action/proposal/dispatch decision.
 *
 * The model never names a source. The SERVER maps an accepted key through the EXISTING INTENTS
 * table — the same table the deterministic path uses — so there is no second source registry to
 * drift out of step, and a model that invents a key gets nothing, because an unrecognised key
 * resolves to no source at all.
 *
 * ⛔ AND IT CHANGES NO ROUTE IN THIS TRANCHE. `observe()` returns a record for measurement.
 * Nothing consumes it to decide a turn. Wiring it in is a separate, later decision that must be
 * argued from these numbers.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { INTENTS } = require('../readContext')

/** The closed candidate space. Anything outside it is NONE, by construction. */
const NONE = 'NONE'
const CANDIDATES = Object.freeze([
  'invoice', 'purchase_order', 'daily_count', 'supplier', 'order_planning',
  'inventory', 'schedule', 'mail', 'document', 'code', NONE
])
const CONFIDENCE = Object.freeze(['HIGH', 'MEDIUM', 'LOW'])

/**
 * Strict admission. A model may return anything; only these two shapes survive.
 * Unparseable, unknown key, unknown confidence, or an attempt to name a source ⇒ abstain.
 */
function admit (raw) {
  const out = { candidate: NONE, confidence: 'LOW', rejected: null }
  let obj = raw
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw.trim().replace(/^```(?:json)?|```$/g, '').trim()) } catch (_) {
      out.rejected = 'unparseable'; return out
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { out.rejected = 'not_an_object'; return out }

  // ⛔ AN ATTEMPT TO NAME A SOURCE IS REJECTED OUTRIGHT, not quietly ignored. A classifier that
  // starts emitting `source` is a classifier drifting toward authority, and a silent strip would
  // hide that drift for as long as the field happened to agree with the table.
  for (const forbidden of ['source', 'sources', 'connector', 'tool', 'method', 'action', 'write']) {
    if (Object.prototype.hasOwnProperty.call(obj, forbidden)) {
      out.rejected = 'attempted_' + forbidden; return out
    }
  }
  if (!CANDIDATES.includes(obj.intent)) { out.rejected = 'out_of_enum'; return out }
  if (!CONFIDENCE.includes(obj.confidence)) { out.rejected = 'bad_confidence'; return out }
  out.candidate = obj.intent
  out.confidence = obj.candidate === NONE ? 'LOW' : obj.confidence
  return out
}

/** SERVER-SIDE. The model had no part in this. */
function resolveSource (candidate) {
  if (candidate === NONE) return []
  const hit = INTENTS.find((i) => i.key === candidate)
  return hit && Array.isArray(hit.sources) ? hit.sources.slice() : []
}

const SYSTEM = [
  'You classify a restaurant owner\'s message into ONE business-data topic, or NONE.',
  'Reply with JSON only: {"intent":"<key>","confidence":"HIGH|MEDIUM|LOW"}',
  'Allowed keys, and nothing else:',
  '  invoice         - bills received from suppliers, amounts owed, due/unpaid',
  '  purchase_order  - orders already placed; whether goods have arrived yet',
  '  daily_count     - the stock-take actually performed today; discrepancies',
  '  supplier        - who we buy something from',
  '  order_planning  - what should be re-ordered now; suggested order quantities',
  '  inventory       - how much stock is on hand right now; running low; out of stock',
  '  schedule        - calendar, appointments, what is on tomorrow',
  '  mail            - email received or awaiting reply',
  '  document        - files and documents',
  '  code            - source code changes',
  '  NONE            - anything else, including small talk, arithmetic, the time or date,',
  '                    and any request to DO something rather than to be told something',
  'HIGH means you would bet the answer on it. If two keys are plausible, use MEDIUM.',
  'Never output a source, connector, tool or method. Never output prose.'
].join('\n')

/**
 * Classify one message. `callModel` is injected so tests never reach a provider.
 * Returns { candidate, confidence, rejected } — never a source.
 */
async function classify (message, callModel) {
  const raw = await callModel({ system: SYSTEM, prompt: String(message == null ? '' : message) })
  return admit(raw)
}

/**
 * SHADOW OBSERVATION. Call only when the deterministic route read nothing.
 * Returns a record. Returns no decision, and no caller may treat it as one.
 */
async function observe ({ message, deterministicRoute, callModel }) {
  if (deterministicRoute !== 'CONVERSATION') {
    return { applicable: false, candidate: NONE, confidence: 'LOW', impliedSource: [], routeChanged: false }
  }
  const r = await classify(message, callModel)
  return {
    applicable: true,
    candidate: r.candidate,
    confidence: r.confidence,
    rejected: r.rejected,
    // What the SERVER would resolve IF this were ever acted on. Recorded, never acted on here.
    impliedSource: resolveSource(r.candidate),
    routeChanged: false
  }
}

module.exports = { CANDIDATES, CONFIDENCE, NONE, admit, resolveSource, classify, observe, SYSTEM }
