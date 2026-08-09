'use strict'

/**
 * ownerSourceIntentResolver.js — WHICH WORLD DID LOUIE MEAN?
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY THE PREVIOUS ABSTRACTION HAD TO GO, NOT BE TUNED.
 *
 * The Source Ambiguity Gate asked 「has he clearly said internal or public?」 and was handed
 * `proposedWorld` that it never actually received in its prompt — no committed body builder
 * existed, and every seam dropped the field. So it could not express 「would reading THIS world
 * preserve his meaning」, and it could not catch a wrong-world proposal at all: a clear PUBLIC
 * question with an INTERNAL read proposed would return `allow`, because his meaning WAS clear.
 *
 * Measured, on two independent model families, it also over-asked on the one cell that mattered:
 *   clear-public / proposed public → ALLOW:  GPT 2/10, Claude 0/10.
 * Rewriting its wording moved the error rather than removing it (GPT 42/60, Claude 40/60):
 * ask-heavy caught ambiguity and blocked clear questions; allow-heavy did the reverse. Two
 * contracts, two model families, one threshold, no separation.
 *
 * ⛔ SO THE QUESTION CHANGED. This module does not ask whether a proposed read may proceed.
 * It resolves what the Owner MEANT, on its own, and the server routes afterwards:
 *
 *     internal · public · mixed · ambiguous
 *
 * ⛔ IT IS DELIBERATELY NOT TOLD WHAT THE SYSTEM WANTS OR CAN DO. No `proposedWorld` — that is
 * what biased the old gate into answering 「can I proceed?」. No `availableWorlds` either:
 * 「what he means」 and 「what we can currently reach」 are different questions, and mixing them
 * lets availability quietly decide meaning. Availability is applied by the server AFTER.
 *
 * ── MEASURED BEFORE ADOPTED ──────────────────────────────────────────────────
 * Same 60 distinct cases, same contract, one revision, ladder from the cheapest role upward:
 *     GPT medium 60/60 · fresh 24-case holdout 24/24 · 20 paraphrased boundaries 20/20
 * (The pre-revision contract scored GPT 50/60, Haiku 44/60, Sonnet 54/60, Opus 59/60 — the
 * ladder is recorded because it shows the contract, not the model, was the binding constraint.)
 *
 * ── PROVIDER-NEUTRAL BY CONSTRUCTION ─────────────────────────────────────────
 * No adapter, model or provider name appears here; it is handed a `resolve` closure. A static
 * test greps this file for provider tokens.
 *
 * ── AND IT FAILS CLOSED TO A QUESTION ────────────────────────────────────────
 * Missing resolver, throw, malformed, unknown value — all resolve to `ambiguous`, which means
 * ASK the Owner and read nothing. The safe direction here is asking one extra question, never
 * reading a world he did not ask for.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { ownerAuthoredContext } = require('./publicQueryEgressPlanner')

/** The four meanings. There is no fifth, and no `reason` field anywhere. */
const INTENT = Object.freeze({
  INTERNAL: 'internal',
  PUBLIC: 'public',
  MIXED: 'mixed',
  AMBIGUOUS: 'ambiguous'
})

/**
 * ⛔ ROOT IS A PLAIN OBJECT, NOTHING NULLABLE — portable to both strict dialects. OpenAI
 * requires optionality as a nullable union; Anthropic rejects a nullable union carrying an
 * enum. One required enum field sidesteps the disagreement entirely.
 *
 * No `reason`, `rationale`, `confidence`, `analysis`, `capability`, `query`, `tool` or
 * `provider`. An explanation field is chain-of-thought wearing a respectable name.
 */
const INTENT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['intent'],
  properties: {
    intent: {
      type: 'string',
      enum: ['internal', 'public', 'mixed', 'ambiguous'],
      description: 'internal＝問我哋自己；public＝問出面；mixed＝明確要兩邊比較；ambiguous＝兩種都同樣講得通。'
    }
  }
})

/**
 * ⛔ MODEL TEXT (governance/textClasses.js, class MODEL).
 *
 * Three principles, and the third is the one this revision exists for: an UNSCOPED metric or
 * trend request is ambiguous, and neither 「businesses usually track this themselves」 nor
 * 「a public benchmark exists」 is a reason to pick a side. Before it, every model read a bare
 * price question as one world or the other — GPT 2/10, Haiku 0/10, Sonnet 4/10, Opus 9/10 on
 * that cell. With it, GPT reaches 10/10 and nothing else regresses.
 *
 * No product, supplier, price or holdout literal appears; no keyword list, no regex. A static
 * test enforces that.
 */
const INTENT_SYSTEM = `你係一個「意思分類」判斷器。你唔係答問題嘅人，唔會查任何嘢。

你只做一件事：睇 Louie 想問嘅係邊個世界嘅資料。

Louie 係一間餐廳嘅老闆。有兩個世界：
- 我哋自己：呢間餐廳自己嘅實際狀況、內部紀錄、我哋同外面某一方之間嘅往來、我哋自己嘅數字
- 出面：外面公開世界——行業整體、地區或者司法管轄區、公開嘅參考指標、規管同政策、外面普遍情況

四個答案，揀一個：

internal —— 佢問緊我哋自己嗰個世界。
public —— 佢問緊出面嗰個世界。
mixed —— 佢明確要攞兩邊嚟比較，或者問兩邊之間嘅關係。
ambiguous —— 兩種理解同樣講得通，而揀邊一邊會變成答緊另一條問題。

⛔ 三條最重要嘅規則：

一、我哋自己有冇呢方面嘅資料，唔會令一條明明問出面嘅問題變成含糊。
反過嚟，出面有冇公開資料，亦唔會令一條明明問我哋自己嘅問題變成含糊。
差唔多每個話題兩邊都拉得上關係——如果咁都當含糊，就等於乜都答唔到。

二、一句好短嘅跟進句，會繼承 Louie 自己之前講過嘅範圍。
唔好淨係因為今次句子短就當佢含糊。

三、**冇講明範圍嘅「數字／趨勢」問題，當含糊。**
如果佢問嘅係一個數字、成本、價錢、比率、幅度、趨勢、表現或者變化，
而佢自己嘅講法同之前嘅對話都冇將範圍定落嚟，
而「我哋自己嗰個數」同「出面公開世界嗰個數」兩種理解都自然講得通、答案又會唔同——
噉就答 ambiguous。
唔好淨係因為「呢類數字做生意嘅通常都會睇自己嗰份」就當 internal。
亦唔好淨係因為「呢類數字出面有得查」就當 public。
但如果佢嘅講法或者之前講過嘅嘢已經定咗範圍，噉就跟返嗰個範圍，唔算含糊。

規則：
- 唔好答佢個業務問題。
- 唔好揀工具、來源或者操作。
- 唔好解釋你點諗。`

/**
 * The prompt body, committed here so ONE contract has ONE input shape. The old gate's field
 * loss happened precisely because assembly lived in each seam; a future seam cannot drop a
 * field the semantics depend on if the module owns the builder.
 */
function buildIntentPrompt (ownerMessages) {
  return 'Louie 自己打過嘅說話（舊到新）：\n' + ownerMessages.map((m, i) => (i + 1) + '. ' + m).join('\n')
}

/** What the resolved intent OBLIGES, once the server has decided knowledge is needed. */
const WORLDS_FOR_INTENT = Object.freeze({
  [INTENT.INTERNAL]: Object.freeze({ internal: true, public: false }),
  [INTENT.PUBLIC]: Object.freeze({ internal: false, public: true }),
  [INTENT.MIXED]: Object.freeze({ internal: true, public: true }),
  [INTENT.AMBIGUOUS]: null
})

/** ⛔ THE CLARIFICATION. A MEANING question, naming no system, tool or source. */
const CLARIFY_QUESTION = '你想我睇我哋自己嘅實際情況，定係外面公開嘅情況？'

const OUTCOME = Object.freeze({
  INTERNAL: 'internal',
  PUBLIC: 'public',
  MIXED: 'mixed',
  AMBIGUOUS: 'ambiguous',
  UNAVAILABLE: 'unavailable'
})

/** Admit ONLY the closed shape. @returns {string|null} null ⇒ unusable */
function validateIntent (raw) {
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
  return Object.prototype.hasOwnProperty.call(WORLDS_FOR_INTENT, obj.intent) ? obj.intent : null
}

/**
 * Resolve what the Owner meant. PURE apart from the injected `resolve` call.
 *
 * @param {{resolve?:function, message?:string, history?:object[]}} input
 * @returns {Promise<{intent:string, requiredWorlds:object|null, question:string|null, outcome:string}>}
 */
async function runOwnerSourceIntent (input = {}) {
  const resolve = typeof input.resolve === 'function' ? input.resolve : null
  const askBack = (outcome) => ({ intent: INTENT.AMBIGUOUS, requiredWorlds: null, question: CLARIFY_QUESTION, outcome })
  // ⛔ NO RESOLVER, NO WORLD. Failing to a question is the only safe direction: the alternative
  // is reading a world nobody established he meant.
  if (!resolve) return askBack(OUTCOME.UNAVAILABLE)

  const ownerMessages = ownerAuthoredContext(input.message, input.history)
  if (!ownerMessages.length) return askBack(OUTCOME.UNAVAILABLE)

  let raw
  try {
    raw = await resolve({
      // ⛔ THE COMPLETE INPUT. His own words and nothing else — no proposedWorld, no
      // availableWorlds, no evidence, no assistant text, no capability, no persona. There is no
      // parameter here to forget to strip.
      ownerMessages: ownerMessages.slice(),
      system: INTENT_SYSTEM,
      schema: INTENT_SCHEMA
    })
  } catch (_) {
    return askBack(OUTCOME.UNAVAILABLE) // the thrown message is DISCARDED
  }

  const intent = validateIntent(raw)
  if (intent === null || intent === INTENT.AMBIGUOUS) {
    return askBack(intent === null ? OUTCOME.UNAVAILABLE : OUTCOME.AMBIGUOUS)
  }
  return { intent, requiredWorlds: WORLDS_FOR_INTENT[intent], question: null, outcome: intent }
}

/**
 * ⛔ ONCE PER STABLE OWNER CONTEXT, TURN-LOCAL, NEVER PERSISTED.
 * A later decision in the same turn reuses the answer: his words have not changed, and a
 * second answer could differ, giving one turn two meanings. A new turn with a clarification
 * carries new Owner text, so it resolves again.
 */
function createTurnIntentCache () {
  const byContext = new Map()
  return {
    async get (input = {}) {
      const key = JSON.stringify(ownerAuthoredContext(input.message, input.history))
      if (byContext.has(key)) return byContext.get(key)
      const r = await runOwnerSourceIntent(input)
      byContext.set(key, r)
      return r
    },
    get calls () { return byContext.size }
  }
}

/** Which world a capability belongs to — the same rule A4 uses everywhere. */
function worldForCapability (capability) {
  return String(capability || '').indexOf('public_knowledge') === 0 ? 'public' : 'internal'
}

/** Does a proposed read satisfy the resolved intent? `mixed` accepts either side. */
function readMatchesIntent (capability, intent) {
  if (intent === INTENT.MIXED) return true
  return worldForCapability(capability) === intent
}

/** One content-free line: an enum and a count. Never his words. */
function logOwnerSourceIntent (entry, sink) {
  const line = {
    event: 'A4_SOURCE_INTENT',
    timestamp: new Date().toISOString(),
    requestId: entry && entry.requestId != null ? String(entry.requestId) : null,
    outcome: entry && Object.values(OUTCOME).includes(entry.outcome) ? entry.outcome : OUTCOME.UNAVAILABLE,
    ownerMessageCount: Number.isFinite(entry && entry.ownerMessageCount) ? entry.ownerMessageCount : 0,
    durationMs: Number.isFinite(entry && entry.durationMs) ? entry.durationMs : null
  }
  try { (sink || ((l) => console.log('[AROMA-SOURCE-INTENT]', JSON.stringify(l))))(line) } catch (_) {}
  return line
}

module.exports = {
  INTENT,
  INTENT_SCHEMA,
  INTENT_SYSTEM,
  WORLDS_FOR_INTENT,
  CLARIFY_QUESTION,
  OUTCOME,
  buildIntentPrompt,
  validateIntent,
  runOwnerSourceIntent,
  createTurnIntentCache,
  worldForCapability,
  readMatchesIntent,
  logOwnerSourceIntent
}
