'use strict'

/**
 * mixedKnowledgeRequirement.js — did the Owner ask for BOTH worlds at once?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ TWO LIVE FAILURES, ONE MISSING CONCEPT.
 *
 * ⛔ THE HOLDOUT SENTENCE IS DELIBERATELY NOT QUOTED ANYWHERE IN THIS FILE. It lives in the
 * canary and nowhere else — a static test asserts its absence. An earlier draft quoted it in
 * this very paragraph, which is how prompts acquire the test's own answers: a comment is one
 * copy-paste away from a system string, and four semantic calibrations were already lost to
 * teaching-to-the-test. Described generically instead:
 *
 * A question that named BOTH our own figure and the outside market, and asked whether the
 * comparison was reasonable, failed twice on the real model, in two different places, for the
 * same underlying reason:
 *
 *   1. The AMBIGUITY gate answered `ask` — although its own frozen rules say
 *      「要兩邊 ≠ 含糊」. Asked 「is his meaning unclear」 about a sentence that names both
 *      sides, it read the two sides AS the ambiguity.
 *
 *   2. With the gate off, the main model read internal evidence and went straight to FINAL,
 *      honestly reporting that it had no market data — instead of going and getting some.
 *
 * Both are the same gap: EXPLICIT MIXED had nowhere to live. A turn could be 「clear」 or
 * 「ambiguous」, and a request for two worlds is neither. It is the clearest kind of request
 * there is, and it needs TWO reads to answer.
 *
 * ⛔ AND THE FIX MAY NOT BE ANOTHER PROMPT. Four semantic calibrations have already failed
 * on this exact family of judgement, which is why the ambiguity gate became a separate narrow
 * call rather than a fifth paragraph. This is the same shape: one binary question, everything
 * else removed, and it decides ONE thing.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── WHAT IT IS NOT ───────────────────────────────────────────────────────────
 * Not a taxonomy, not a world registry, not a router. There are exactly two worlds and one
 * question about them. It cannot answer the Owner, pick a capability, name a tool, choose a
 * provider, read evidence, or order the reads.
 *
 * ── PROVIDER-NEUTRAL BY CONSTRUCTION ─────────────────────────────────────────
 * No adapter, router or connector import. It is handed a `verify` closure and never learns
 * what is behind it — the same seam reasoningLoop and sourceAmbiguityGate use.
 *
 * ── AND IT FAILS TOWARD THE EXISTING BEHAVIOUR ───────────────────────────────
 * Missing verifier, throw, malformed, unknown decision — all mean `not_mixed`, which hands
 * the turn back to the ambiguity gate exactly as it behaves today. ⛔ NOTE THE DIRECTION: for
 * THIS gate, failing closed means NOT claiming a requirement, because claiming one would
 * SKIP the ambiguity ASK and authorise a second read world. The safe direction is to grant
 * nothing and let the existing guard decide.
 */

/**
 * ⛔ TWO VALUES, AND NO THIRD. `mixed` means the Owner explicitly requires both our own truth
 * and the outside world's. Everything else — clear single-world, genuinely ambiguous,
 * small talk — is `not_mixed` and is somebody else's question.
 *
 * There is no `reason`, `rationale`, `confidence`, `analysis`, `capability`, `tool`,
 * `provider`, `query` or `source` field, and there will not be one. A gate that explains
 * itself can be argued with, and the explanation would be chain-of-thought wearing a field
 * name — the same ruling as VERIFIER_SCHEMA.
 */
const MIXED_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['decision'],
  properties: {
    decision: {
      type: 'string',
      enum: ['mixed', 'not_mixed'],
      description: 'mixed＝佢明確要「我哋自己」同「出面公開」兩邊一齊；not_mixed＝其他所有情況。'
    }
  }
})

/**
 * ⛔ MODEL TEXT (governance/textClasses.js, class MODEL). She is told this.
 *
 * Deliberately narrow, and deliberately free of business nouns — no product, no supplier, no
 * price, no index. The judgement is about the SHAPE of the request — 「兩邊」 — not about any
 * domain. A rule naming a product would be the keyword classifier this slice was told not to
 * build, wearing prose. A static test enforces the absence rather than trusting this note.
 *
 * ⛔ NO CANARY SENTENCE APPEARS HERE. The holdout strings are the measurement; putting one in
 * the prompt would turn the test into a rehearsal, which is the failure mode recorded against
 * the four earlier calibrations.
 */
const MIXED_SYSTEM = `你係一個好窄嘅判斷閘。你唔係答問題嘅人。

你唯一要判斷嘅係：Louie 今次係咪明確要**兩邊都要**——即係「我哋自己嘅實際情況」同「出面公開世界嘅情況」，兩樣都要，先答得到佢。

mixed —— 只喺佢明確要兩邊：
- 句子本身要求拎我哋自己嘅嘢同出面嘅嘢作比較
- 或者之前傾開嗰陣佢已經講明兩邊都要，今次係接住嗰句

not_mixed —— 其餘全部，包括：
- 佢只要我哋自己嘅嘢
- 佢只要出面嘅嘢
- 佢講得唔清楚、兩種意思都講得通（呢個係「含糊」，唔係「兩邊都要」，有另一個閘負責）
- 傾閒偈、或者佢已經自己俾晒數字

規則：
- 唔好答佢個業務問題。
- 唔好揀工具、來源或者操作。
- 唔好解釋你點諗。
- 唔清楚就答 not_mixed。「可能要兩邊」唔算明確要兩邊。`

/** The two worlds. Same vocabulary as sourceAmbiguityGate — one concept, one spelling. */
const REQUIRED_BOTH = Object.freeze({ internal: true, public: true })

const DECISION = Object.freeze({ MIXED: 'mixed', NOT_MIXED: 'not_mixed' })

/**
 * ⛔ THE OWNER-ROLE DISCIPLINE, IDENTICAL TO publicQueryEgressPlanner.
 *
 * An allowlist, and the default is inverted from buildDistillPrompt on purpose: that file
 * attributes an unknown role to the Owner because mislabelling his words as hers caused a
 * real defect, but here her turns are where evidence and inference have already been spoken
 * aloud. Only an explicit 'user' counts. Assistant, unknown, missing, malformed: excluded.
 *
 * Imported rather than re-implemented so the two gates cannot drift apart.
 */
const { ownerAuthoredContext } = require('./publicQueryEgressPlanner')

/**
 * Admit ONLY the closed shape. A fresh value is returned, so nothing the provider invented
 * has anywhere to travel.
 * @returns {'mixed'|'not_mixed'|null} null = unusable
 */
function validateMixedDecision (raw) {
  let obj = raw
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s) return null
    try { obj = JSON.parse(s) } catch (_) {
      const m = /\{[\s\S]*\}/.exec(s)
      if (!m) return null
      try { obj = JSON.parse(m[0]) } catch (_) { return null }
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  return obj.decision === DECISION.MIXED ? DECISION.MIXED : (obj.decision === DECISION.NOT_MIXED ? DECISION.NOT_MIXED : null)
}

/**
 * Ask the one question. PURE apart from the injected `verify` call.
 *
 * @param {{verify?:function, message?:string, history?:object[]}} input
 * @returns {Promise<{decision:string, requiredWorlds:object|null, outcome:string}>}
 */
async function runMixedRequirement (input = {}) {
  const verify = typeof input.verify === 'function' ? input.verify : null
  const notMixed = (outcome) => ({ decision: DECISION.NOT_MIXED, requiredWorlds: null, outcome })
  // ⛔ NO VERIFIER, NO REQUIREMENT. Never 「assume mixed」: that would skip the ambiguity ASK
  // and licence a second world on the strength of a gate that did not run.
  if (!verify) return notMixed('unavailable')

  const ownerMessages = ownerAuthoredContext(input.message, input.history)
  if (!ownerMessages.length) return notMixed('no_owner_context')

  let raw
  try {
    raw = await verify({
      // ⛔ THE ONLY INPUTS, and the list is the contract. No evidence, no turnItems, no
      // EvidenceSets, no capability names, no proposed query, no persona, no contract, no
      // connector output — this runs BEFORE any read and sees only what he typed.
      ownerMessages: ownerMessages.slice(),
      system: MIXED_SYSTEM,
      schema: MIXED_SCHEMA
    })
  } catch (_) {
    // The thrown message is DISCARDED — an upstream error can carry the prompt back with it.
    return notMixed('unavailable')
  }

  const decided = validateMixedDecision(raw)
  if (decided === null) return notMixed('unusable')
  if (decided === DECISION.NOT_MIXED) return notMixed(DECISION.NOT_MIXED)
  return { decision: DECISION.MIXED, requiredWorlds: REQUIRED_BOTH, outcome: DECISION.MIXED }
}

/**
 * ⛔ ONCE PER TURN. In memory, turn-scoped, dropped with the request.
 *
 * The main model can propose a first read more than once inside the bounded loop, and the
 * Owner's words do not change between those proposals. Re-asking would spend a second paid
 * call to re-derive the same answer — and could derive a DIFFERENT one, which would mean a
 * turn whose completion requirement changed underneath it.
 */
function createTurnMixedCache () {
  let result = null
  let calls = 0
  return {
    async get (input) {
      if (result) return result
      calls++
      result = await runMixedRequirement(input)
      return result
    },
    get calls () { return calls },
    get settled () { return result !== null }
  }
}

/**
 * ⛔ WHICH REQUIRED WORLD IS STILL MISSING — and nothing else.
 *
 * A world counts ONLY after a successful LIVE read. A refused, unavailable or failed read
 * does not satisfy it: that is the same three-state rule A3 established, applied to a second
 * question. Treating an attempt as completion is exactly the defect 「attempted ≠ read」 was
 * raised to end.
 *
 * @param {object|null} requiredWorlds e.g. {internal:true, public:true}
 * @param {{internal:boolean, public:boolean}} completed which worlds have live evidence
 * @returns {'internal'|'public'|null} the first missing world, or null when complete
 */
function missingWorld (requiredWorlds, completed = {}) {
  if (!requiredWorlds) return null
  // Order is stable and stated: internal before public. It is a REPORTING order only — the
  // guard never chooses a capability, and either world may be read first.
  if (requiredWorlds.internal === true && completed.internal !== true) return 'internal'
  if (requiredWorlds.public === true && completed.public !== true) return 'public'
  return null
}

/**
 * One content-free line. An enum and two booleans; never the Owner's message, never a query,
 * never a business value.
 */
function logMixedRequirement (entry, sink) {
  const line = {
    event: 'A4_MIXED_REQUIREMENT',
    timestamp: new Date().toISOString(),
    requestId: entry && entry.requestId != null ? String(entry.requestId) : null,
    outcome: entry && ['mixed', 'not_mixed', 'unavailable', 'unusable', 'no_owner_context'].includes(entry.outcome) ? entry.outcome : 'unavailable',
    ownerMessageCount: Number.isFinite(entry && entry.ownerMessageCount) ? entry.ownerMessageCount : 0,
    durationMs: Number.isFinite(entry && entry.durationMs) ? entry.durationMs : null
  }
  try { (sink || ((l) => console.log('[AROMA-MIXED]', JSON.stringify(l))))(line) } catch (_) {}
  return line
}

module.exports = {
  MIXED_SCHEMA,
  MIXED_SYSTEM,
  DECISION,
  REQUIRED_BOTH,
  validateMixedDecision,
  runMixedRequirement,
  createTurnMixedCache,
  missingWorld,
  logMixedRequirement
}
