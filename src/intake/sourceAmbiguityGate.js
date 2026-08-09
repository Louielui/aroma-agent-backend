'use strict'

/**
 * sourceAmbiguityGate.js — one narrow binary question, asked BEFORE any connector runs.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ WHY THIS EXISTS, AND WHY IT IS NOT A FIFTH PROMPT CALIBRATION.
 *
 * Four attempts have failed to make the MAIN model ask when the Owner's meaning is genuinely
 * ambiguous: two prose calibrations (one over-asked, one under-asked), removing the
 * commit/read contract contradiction, and finally giving it a real second world to choose
 * from. Each moved a global threshold; none taught the distinction. Measured, every time, it
 * prefers to READ rather than ASK.
 *
 * The remaining hypothesis is that the judgement is being asked of a model that is
 * simultaneously composing an answer, choosing an operation, obeying a schema and minding a
 * persona. This gate removes everything else from the question: one call, two inputs, two
 * possible answers.
 *
 * ⛔ IT DECIDES ONE THING AND HAS NO OTHER POWER. It cannot answer the Owner, pick a
 * capability, name a tool, choose a provider, read evidence or execute anything. It returns
 * allow or ask.
 *
 * ⛔ AND IT FAILS CLOSED, ALWAYS. A throw, a timeout, malformed JSON, an unknown decision, an
 * absent verifier — every one of them means NO READ. A gate that fails open is not a gate;
 * and the safe direction here is unambiguous, because asking one extra question costs a
 * sentence while reading the wrong world costs a wrong answer presented as fact.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const A4_AMBIGUITY_FLAG = 'A4_SOURCE_AMBIGUITY'

/** off unless exactly 'on'. Unset, empty and typos all mean off. */
function resolveAmbiguityGate (env = process.env) {
  const raw = env && typeof env[A4_AMBIGUITY_FLAG] === 'string' ? env[A4_AMBIGUITY_FLAG].trim() : ''
  if (raw === 'on') return 'on'
  if (raw !== '' && raw !== 'off') {
    console.warn(`[AROMA-HUB] Invalid ${A4_AMBIGUITY_FLAG}="${raw}" — falling back to 'off' (fails closed).`)
  }
  return 'off'
}

function ambiguityGateEnabled (env = process.env) {
  return resolveAmbiguityGate(env) === 'on'
}

/**
 * ⛔ THE WORLD VOCABULARY IS TWO WORDS, ON PURPOSE.
 *
 * A taxonomy would be a second routing table to keep in step with the first, and the whole
 * point of A4 was to stop deciding meaning from a table. `internal` is 「our own truth」 and
 * `public` is 「the outside world」 — the only distinction whose answer changes what question
 * is being answered.
 *
 * ⛔ THE VERIFIER NEVER SEES A CAPABILITY NAME. It is given a WORLD. A verifier that could
 * read operation names would be choosing a tool, which is precisely what it must not do.
 */
const WORLD = Object.freeze({ INTERNAL: 'internal', PUBLIC: 'public' })

function worldForCapability (capability) {
  const c = typeof capability === 'string' ? capability : ''
  return c.startsWith('public_knowledge') ? WORLD.PUBLIC : WORLD.INTERNAL
}

/** The distinct worlds a set of authorised capabilities can reach. Order is stable. */
function availableWorlds (capabilities = []) {
  const out = []
  for (const c of (Array.isArray(capabilities) ? capabilities : [])) {
    const w = worldForCapability(c)
    if (!out.includes(w)) out.push(w)
  }
  return out.sort()
}

/**
 * The verifier's output contract. Strict-mode rules, same as everywhere else: every property
 * required, optionality as a null union, additionalProperties false.
 *
 * ⛔ THERE IS NO `reason`, `rationale`, `confidence` OR `analysis` FIELD, and there will not
 * be one. A gate that explains itself is a gate that can be argued with, and the explanation
 * would be chain-of-thought wearing a field name.
 */
const VERIFIER_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'question'],
  properties: {
    decision: { type: 'string', enum: ['allow', 'ask'], description: 'allow＝意思夠清楚，可以照讀；ask＝真係要問清楚先。' },
    question: { type: ['string', 'null'], description: 'ask 先填：一句簡短嘅澄清問題。allow 一定要填 null。' }
  }
})

/**
 * ⛔ MODEL TEXT (governance/textClasses.js, class MODEL). Deliberately narrow: it describes
 * the ONE judgement and forbids everything else. No business domain, no example sentence from
 * any canary — those are holdout data and putting them here would make the test a rehearsal.
 */
const VERIFIER_SYSTEM = `你係一個「意思含糊」判斷閘。你唔係答問題嘅人。

你唯一要判斷嘅係：Louie 想問嘅係「我哋自己嘅實際情況」，定係「出面公開世界嘅情況」——佢自己講清楚咗未。

allow —— 以下任何一種都算清楚：
- 句子本身已經講明係邊一邊（例如講明係我哋自己嘅、或者講明係出面／同業／市場嘅）
- 之前嘅對話已經講明咗
- 佢明顯係要兩邊一齊比較（要兩邊 ≠ 含糊）

ask —— 只喺以下情況：
- 兩種意思都同樣講得通
- 而揀邊一邊會變成答緊另一條問題
- 而句子同對話都冇講明佢想要邊一邊

規則：
- 唔好答佢個業務問題。
- 唔好揀工具、來源或者操作。
- 唔好解釋你點諗。
- 「有某個功能」唔等於 Louie 想用嗰個功能。唔好因為某一邊查得到就當佢想查嗰邊。
- ask 嘅問題只可以問「意思」，用生意語言，一句，唔好提任何系統、工具或功能名。
- allow 嘅時候 question 一定要係 null。`

/** A question may never leak implementation vocabulary to the Owner. */
const IMPLEMENTATION_TERMS = /public_knowledge|aroma_system|nextRead|capability|connector|readKey|schema|operation|A4|API|endpoint|provider|tool/i

/**
 * ⛔ ONE DETERMINISTIC FALLBACK, and it is a MEANING question.
 *
 * Used when the verifier says ask but its question is unusable — malformed, empty, over-long,
 * or carrying implementation vocabulary. It names no domain noun, so it cannot accidentally
 * assert what the question was about.
 */
const SAFE_FALLBACK_QUESTION = '你想我睇我哋自己嘅實際情況，定係外面公開市場嘅情況？'
const MAX_QUESTION_CHARS = 120

/**
 * Admit ONLY the closed shape. A fresh object is constructed, so an extra field the provider
 * invented has nowhere to be written to.
 * @returns {{decision:'allow'|'ask', question:string|null}|null} null = unusable ⇒ fail closed
 */
function validateVerifierDecision (raw) {
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
  const d = obj.decision
  if (d !== 'allow' && d !== 'ask') return null
  if (d === 'allow') return { decision: 'allow', question: null }

  const q = typeof obj.question === 'string' ? obj.question.trim() : ''
  const usable = q !== '' && q.length <= MAX_QUESTION_CHARS && !IMPLEMENTATION_TERMS.test(q)
  return { decision: 'ask', question: usable ? q : SAFE_FALLBACK_QUESTION }
}

/**
 * Run the gate. PURE apart from the injected verifier call.
 *
 * ⛔ PROVIDER-NEUTRAL BY CONSTRUCTION. This module imports no adapter and no router; it is
 * handed a `verify` closure and never learns what is behind it, exactly as reasoningLoop is.
 *
 * @param {{verify?:function, message?:string, history?:object[], proposedWorld?:string, availableWorlds?:string[]}} input
 * @returns {Promise<{decision:'allow'|'ask', question:string|null, outcome:string}>}
 */
async function runSourceAmbiguityGate (input = {}) {
  const verify = typeof input.verify === 'function' ? input.verify : null
  // ⛔ NO VERIFIER, NO READ. Enabling the gate without wiring one must not silently skip it —
  // that is the failure mode where a guard exists on paper and passes everything.
  if (!verify) return { decision: 'ask', question: SAFE_FALLBACK_QUESTION, outcome: 'unavailable' }

  let raw
  try {
    raw = await verify({
      // ⛔ THE ONLY INPUTS. No evidence, no turnItems, no EvidenceSets, no capability names,
      // no supplier or price retrieved this turn — this runs BEFORE any read, and it stays
      // that way even if a read has happened for some other reason.
      message: typeof input.message === 'string' ? input.message : '',
      history: Array.isArray(input.history) ? input.history : [],
      proposedWorld: input.proposedWorld === WORLD.PUBLIC ? WORLD.PUBLIC : WORLD.INTERNAL,
      availableWorlds: Array.isArray(input.availableWorlds) ? input.availableWorlds.slice() : [],
      system: VERIFIER_SYSTEM,
      schema: VERIFIER_SCHEMA
    })
  } catch (_) {
    // The thrown message is DISCARDED: an upstream error can carry a prompt or a value.
    return { decision: 'ask', question: SAFE_FALLBACK_QUESTION, outcome: 'unavailable' }
  }

  const decided = validateVerifierDecision(raw)
  if (!decided) return { decision: 'ask', question: SAFE_FALLBACK_QUESTION, outcome: 'unavailable' }
  return { decision: decided.decision, question: decided.question, outcome: decided.decision }
}

/**
 * One content-free line. Counts and short enums only — never the Owner's message, the
 * history, the question, a query or any business value.
 */
function logAmbiguityGate (entry, sink) {
  const line = {
    event: 'A4_SOURCE_AMBIGUITY',
    timestamp: new Date().toISOString(),
    requestId: entry && entry.requestId != null ? String(entry.requestId) : null,
    decision: entry && ['allow', 'ask', 'unavailable'].includes(entry.outcome) ? entry.outcome : 'unavailable',
    proposedWorld: entry && entry.proposedWorld === WORLD.PUBLIC ? WORLD.PUBLIC : WORLD.INTERNAL,
    availableWorldCount: Number.isFinite(entry && entry.availableWorldCount) ? entry.availableWorldCount : 0,
    durationMs: Number.isFinite(entry && entry.durationMs) ? entry.durationMs : null
  }
  try { (sink || ((l) => console.log('[AROMA-AMBIGUITY]', JSON.stringify(l))))(line) } catch (_) {}
  return line
}

module.exports = {
  A4_AMBIGUITY_FLAG,
  resolveAmbiguityGate,
  ambiguityGateEnabled,
  WORLD,
  worldForCapability,
  availableWorlds,
  VERIFIER_SCHEMA,
  VERIFIER_SYSTEM,
  IMPLEMENTATION_TERMS,
  SAFE_FALLBACK_QUESTION,
  MAX_QUESTION_CHARS,
  validateVerifierDecision,
  runSourceAmbiguityGate,
  logAmbiguityGate
}
