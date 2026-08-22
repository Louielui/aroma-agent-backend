'use strict'

/**
 * selfDescription.js — what she IS, so she never has to ask the Owner.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE FAILURE THIS EXISTS FOR, IN THE OWNER'S WORDS:
 *
 *   「你講嘅 Aroma System 係我哋內部使用嘅系統，定係外部公司／服務嘅網站？」
 *
 * She asked him what Aroma System is. She reads it every day, it is six endpoints she holds a
 * catalogue for, and she had answered inventory questions from it that week.
 *
 * **The acceptance case is not a question she answers well. It is that she never has to ask.**
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── ⛔ PROHIBITION 1 — RUNTIME VALUES, NEVER SOURCE CONSTANTS ───────────────
 *
 * `src/index.js` reads `process.env.PORT || 8081`. The live port is **8090**, set by the
 * launcher, from outside this repo — and 8081 is a REAL, DIFFERENT service that answers. A
 * self-description built from the source constant would state the wrong port with total
 * confidence and be believed. Same for the base URL: `DEFAULT_BASE_URL` is a FALLBACK behind
 * `AROMA_SYSTEM_URL`, not a fact.
 *
 * So everything below that can vary at runtime is READ FROM THE RUNTIME, and anything not
 * knowable is `null` — never a default wearing a fact's clothes.
 *
 * ── ⛔ PROHIBITION 2 — REGISTRY TO SENTENCE, DETERMINISTICALLY ──────────────
 *
 * No model composes any of this. A model would smooth 「六個」 into 「幾個」, or invent a
 * seventh. `describe()` is a pure function of the registry.
 *
 * ── ⛔ PROHIBITION 3 — A FLAG MAY NEVER ANSWER A CAPABILITY QUESTION ────────
 *
 * A flag says what was CONFIGURED, not what WORKS. 「你可以讀咩」 is answered from the registry
 * of what EXISTS; 「你而家讀唔讀到 X」 is a live probe or an honest 「唔知」. Conflating them
 * rebuilds the 401-as-empty defect one layer up, which is the defect this project keeps
 * removing. `reachable` is therefore ALWAYS null here — this module never claims it.
 */

// ⛔ `PUBLIC_OPERATIONS` is deliberately NOT exported by readOperations — the public plane is a
// contract, reached through `operationsForSources`. Importing a name that does not exist gave
// `undefined.map`, which the tests caught before this ever described anything.
const { AROMA_OPERATIONS, operationsForSources } = require('../context/readOperations')
/**
 * ⛔ S1 — ONE REGISTRY, RE-EXPORTED, NEVER A SECOND TABLE.
 *
 * This module already refuses to read capability out of configuration —
 * 「我唔會用設定嚟當答案」 is its own sentence. S1 gives that rule a structure; putting a
 * second capability list here is how the structure and the prose start disagreeing.
 */
const selfCapability = require('./selfCapability')

/**
 * ⛔ THE NAMES SHE ANSWERS TO, AND WHY THIS IS NOT `availableWorlds`.
 *
 * `ownerSourceIntentResolver` is deliberately NOT told what the system can reach: 「what he
 * means」 and 「what we can currently reach」 are different questions, and mixing them lets
 * availability quietly decide meaning. That rule is correct and is NOT being relaxed.
 *
 * This is a different fact. 「Aroma System」 is not a statement about availability — it is what
 * the words DENOTE. A resolver that does not know the name cannot tell an internal system from
 * an outside company, and it did not: it asked. Identity is a fact about language; availability
 * is a fact about the network. Only the first belongs in a question about meaning.
 */
/**
 * ⛔ EVERY ENTRY MUST DESIGNATE THE SYSTEM. BRAND NAMES WERE REMOVED, MEASURED.
 *
 * 17:34 local, real UI, on 91b0a0a:
 *
 *   user   「aroma bistro有公開網站嗎?」
 *   reply  「Aroma System 係你自己間餐廳嘅內部系統，唔係出面嘅公司或者網站。」
 *
 * He asked about AROMA BISTRO — the restaurant — and received the identity fact about Aroma
 * System, a different subject. `Aroma` and `阿羅瑪` name the BUSINESS; they matched, `WANTED`
 * resolved `identity`, and the composed path then discarded whatever the model would have
 * said. **His actual question was never answered.** A guarantee that discards model output
 * must be certain it is answering the question that was asked.
 *
 * ⛔ AND THE FIX IS NOT A NEGATIVE LIST. Adding 「aroma bistro」 as an exclusion buys one
 * collision and loses the next — the vocabulary-chasing this line of work already abandoned
 * when the filter leaked on 「我哋現有」. The rule is positive and about SUBJECT: a token
 * qualifies only if it names the system itself. 「Aroma」 alone does not; 「Aroma System」 does.
 *
 * The cost is stated: a message naming ONLY the restaurant now receives no composed answer and
 * no identity fact — it falls through to ordinary handling, which is what it always should
 * have had.
 */
const INTERNAL_NAMES = Object.freeze([
  'Aroma System', 'aroma system', 'aroma_system', 'AromaSystem',
  '我哋個系統', '餐廳系統', '內部系統'
])

/** Is this proper noun one of her own? Case-insensitive, exact-substring. */
function namesInternalSystem (text) {
  const s = typeof text === 'string' ? text.toLowerCase() : ''
  if (!s) return false
  return INTERNAL_NAMES.some((n) => s.includes(n.toLowerCase()))
}

/**
 * Everything she can say about herself.
 *
 * @param {object} [deps]
 * @param {object} [deps.env]        defaults to process.env — RUNTIME, not a constant
 * @param {object} [deps.server]     a live http.Server, when one exists: `address()` is the
 *                                   only thing that knows the port actually bound
 */
function selfDescription (deps = {}) {
  const env = deps.env || process.env
  const server = deps.server || null

  // ⛔ THE BOUND PORT, FROM THE SOCKET. `process.env.PORT` is what was ASKED for; `address()`
  // is what happened. They differ when something else holds the port.
  let boundPort = null
  try {
    const a = server && typeof server.address === 'function' ? server.address() : null
    if (a && typeof a === 'object' && Number.isFinite(a.port)) boundPort = a.port
  } catch (_) { boundPort = null }

  const requestedPort = Number.isFinite(Number(env.PORT)) && env.PORT !== '' ? Number(env.PORT) : null

  return Object.freeze({
    identity: '香香',
    role: 'the Owner\'s local AI COO',

    // ⛔ null when unknown. A default here would be a fact-shaped guess.
    port: boundPort !== null ? boundPort : requestedPort,
    portSource: boundPort !== null ? 'bound_socket' : (requestedPort !== null ? 'env' : null),
    bindHost: env.AROMA_BIND_HOST || null,

    /**
     * The business system she READS — not herself. The Owner's question conflated the two, and
     * so did she, which is the whole defect.
     */
    aromaSystem: Object.freeze({
      what: 'the restaurant\'s Business OS — the Owner\'s own internal system',
      isInternal: true,
      baseUrl: env.AROMA_SYSTEM_URL || 'https://system.aromabistro741.com',
      baseUrlSource: env.AROMA_SYSTEM_URL ? 'env' : 'default',
      operations: AROMA_OPERATIONS.map((o) => Object.freeze({
        operation: o.operation, label: o.label,
        // ⛔ ALWAYS null. Whether it answers right now is a probe, never a flag (prohibition 3).
        reachable: null
      }))
    }),

    publicOperations: operationsForSources(['public_knowledge'])
      .map((op) => Object.freeze({ operation: op, label: op, reachable: null })),

    /**
     * ⛔ WHAT SHE CANNOT ANSWER, NAMED. Absence stated is a fact; absence unstated becomes a
     * confident guess the first time someone asks.
     */
    cannot: Object.freeze([
      'her own source code or version',
      'whether any source answers right now — that needs a live read, not a flag',
      'anything about the business not carried by the six operations above'
    ])
  })
}

/**
 * The registry, as one sentence. ⛔ PURE — no model, no template a model can extend.
 * Counts come from the arrays, so 「六個」 can never drift from six.
 */
function describe (deps) {
  const d = selfDescription(deps)
  const n = d.aromaSystem.operations.length
  const where = d.port !== null ? `127.0.0.1:${d.port}` : '（未知端口）'
  return [
    `我係${d.identity}，喺 ${where} 行緊。`,
    `Aroma System 係你自己間餐廳嘅內部系統（${d.aromaSystem.baseUrl}），唔係出面嘅公司或者網站。`,
    `我可以讀佢${n}個唯讀端點：${d.aromaSystem.operations.map((o) => o.label).join('、')}。`,
    '我讀唔讀得到，要真係去讀一次先知——我唔會用設定嚟當答案。'
  ].join('')
}

module.exports = {
  selfDescription,
  describe,
  namesInternalSystem,
  INTERNAL_NAMES,
  /** ⛔ S1: the canonical capability facts, reachable from the one self-description door. */
  capabilities: selfCapability.REGISTRY,
  capabilityBlock: selfCapability.capabilityBlock,
  implementationOf: selfCapability.implementationOf
}
