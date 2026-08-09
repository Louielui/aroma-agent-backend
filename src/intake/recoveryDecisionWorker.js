'use strict'

/**
 * recoveryDecisionWorker.js — when the main brain will not go and get what it needs.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ MEASURED, NOT SUSPECTED.
 *
 * On one faithful, byte-identical recovery input — the obligation already established, the
 * structural observation already in the prompt, the required capability already in the
 * authorised enum — the main model chose the correct read:
 *
 *     LOW     3 / 7
 *     MEDIUM  2 / 7
 *
 * Same prompt hash, same schema hash, same model; only `reasoningEffort` differed. Raising
 * effort made it worse, so this is not an effort problem and there is nothing left to tune.
 * Four semantic calibrations and three structural gates already sit upstream; another gate
 * would be a fifth calibration wearing armour.
 *
 * The remaining explanation is that ONE narrow decision — 「which authorised operation
 * satisfies the world we already know is missing」 — was being asked of a model simultaneously
 * composing an answer, holding a persona, minding a schema and managing a conversation. So it
 * is asked of something else, with everything else removed. On the same four classes that
 * model scored 40/40.
 *
 * ⛔ WHAT IT IS NOT, AND THE LIST IS THE POINT.
 * It does not answer Louie. It does not write prose. It is not 香香. It does not decide
 * WHETHER information is needed — that is the knowledge obligation, already settled upstream.
 * It does not choose the WORLD — that is settled too. It does not construct a public query.
 * It does not execute anything. It cannot write. It picks ONE name from a list it was handed,
 * and the server checks even that.
 *
 * ⛔ AND IT NEVER SEES THE BUSINESS. No evidence, no EvidenceSets, no connector bodies, no
 * assistant text, no rejected answer, no persona, no memory. On a mixed turn the internal read
 * may already have produced a supplier and a unit price; the worker learns only that the
 * public side is still missing. It cannot leak what it was never shown, which is a stronger
 * guarantee than filtering, and it is what keeps a second provider inside the existing
 * provider-sharing boundary.
 *
 * ── PROVIDER-NEUTRAL BY CONSTRUCTION ─────────────────────────────────────────
 * No adapter import, no model name, no provider name in this file. It is handed a `decide`
 * closure. Which provider and which model answer is a WIRING decision, exactly as verifier
 * effort is — and a static test greps this file for provider tokens.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const { ownerAuthoredContext } = require('./publicQueryEgressPlanner')
const { describeOperations, resolveReadOperation } = require('../context/readOperations')
const { WRITE_SHAPED } = require('./reasoningLoop')

/** The two worlds, spelled as everywhere else in A4. */
const WORLD_LABEL = Object.freeze({
  internal: '我哋自己嘅實際資料',
  public: '出面公開世界嘅資料'
})

/** Which world an authorised capability belongs to. Same rule as sourceAmbiguityGate. */
function worldForCapability (capability) {
  return String(capability || '').indexOf('public_knowledge') === 0 ? 'public' : 'internal'
}

/**
 * ⛔ THE SENTINEL EXISTS BECAUSE THE TWO PROVIDER DIALECTS DISAGREE, AND IT WAS MEASURED.
 *
 * OpenAI strict mode REQUIRES optionality as a nullable union (`type: ['string','null']`).
 * Anthropic REJECTS a nullable union that carries an enum — verified live:
 * `Invalid schema: Enum value ...`. The frozen READ_ARGS_SCHEMA declares `freshness` in exactly
 * that pattern, which is why it is NOT sent here and why this contract has no args at all.
 *
 * So nothing in this schema is nullable. `cannot_route` pairs with the reserved capability
 * `none`, and a closed enum carries both. It is portable to both dialects by construction.
 */
const NO_CAPABILITY = 'none'

/**
 * ⛔ NO ARGS, BY ARCHITECTURE RATHER THAN BY OMISSION.
 *
 * PUBLIC: the Owner-only publicQueryEgressPlanner is the sole trusted constructor of an
 * outbound query once internal evidence exists. A worker-supplied query would be a second,
 * untrusted egress source that the planner would overrule anyway — so it is never asked for.
 * INTERNAL: the authorised operation already owns its server-side query semantics.
 *
 * And there is no `reason`, `rationale`, `analysis`, `confidence`, `answer`, `message`,
 * `query`, `freshness`, `location` or `params` field. An explanation field is chain-of-thought
 * wearing a respectable name; a query field is egress.
 */
function buildSchema (capabilities) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['decision', 'capability'],
    properties: {
      decision: {
        type: 'string',
        enum: ['read', 'cannot_route'],
        description: 'read＝揀到一個操作；cannot_route＝清單入面冇一個屬於仲欠嗰一邊。'
      },
      capability: {
        type: 'string',
        enum: capabilities.concat([NO_CAPABILITY]),
        description: 'read 就填清單入面嗰個名，一個字都唔可以改；cannot_route 就填 none。'
      }
    }
  }
}

/**
 * ⛔ MODEL TEXT (governance/textClasses.js, class MODEL).
 *
 * Deliberately narrow, and free of business nouns — no product, supplier, price or market. It
 * describes a SELECTION, not a judgement: which side is missing has already been decided, and
 * saying so plainly is what stops the worker relitigating it. A static test enforces the
 * absence of domain words and of any holdout sentence.
 */
const WORKER_SYSTEM = `你係一個好窄嘅「揀讀取操作」工人。你唔係答問題嘅人，唔係香香。

情況：系統已經判定咗，要答 Louie 呢一問，仲欠某一邊嘅資料。**邊一邊已經決定咗，唔係你決定。**

你唯一要做嘅：喺下面列出嘅「可用讀取操作」入面，揀一個去攞返仲欠嗰一邊嘅資料。

規則：
- 一定要揀返仲欠嗰一邊嘅操作。唔可以改揀另一邊。
- 只可以揀清單入面有嘅名，一個字都唔可以改。
- 唔好答 Louie 個問題，唔好寫解釋、判斷或者結論。
- 你唔使填任何查詢字句；出面點搵、點問，由系統另外負責。
- 只有喺清單入面真係冇一個屬於仲欠嗰一邊嘅時候，先至填 cannot_route。`

/** Why no read was routed. Enums only. */
const OUTCOME = Object.freeze({
  ROUTED: 'routed',
  NO_WORKER: 'no_worker',
  NO_OWNER_CONTEXT: 'no_owner_context',
  FAILED: 'failed',
  UNUSABLE: 'unusable',
  CANNOT_ROUTE: 'cannot_route',
  WRONG_WORLD: 'wrong_world',
  UNAUTHORISED: 'unauthorised_capability',
  WRITE_SHAPED: 'write_shaped'
})

const refuse = (outcome) => ({ ok: false, capability: null, outcome })

/**
 * Ask the worker which authorised operation satisfies the missing world, and VERIFY the answer.
 *
 * PURE apart from the injected `decide` call.
 *
 * @param {object} input
 * @param {function} input.decide          injected seam ({ownerMessages, requiredWorld, completedWorlds, capabilities, system, schema}) => decision
 * @param {string}   input.message         current Owner message
 * @param {object[]} input.history         conversation history; only role:'user' is read
 * @param {string}   input.requiredWorld   'internal' | 'public' — ALREADY decided upstream
 * @param {object}   input.completedWorlds {internal:boolean, public:boolean}
 * @param {string[]} input.capabilities    READ operations already authorised this turn
 * @returns {Promise<{ok:boolean, capability:string|null, outcome:string}>}
 */
async function runRecoveryWorker (input = {}) {
  const decide = typeof input.decide === 'function' ? input.decide : null
  // ⛔ NO WORKER, NO READ. A missing fallback must not silently become a read nobody chose.
  if (!decide) return refuse(OUTCOME.NO_WORKER)

  const requiredWorld = input.requiredWorld === 'public' ? 'public' : 'internal'
  const capabilities = (Array.isArray(input.capabilities) ? input.capabilities : []).map(String)
  if (!capabilities.length) return refuse(OUTCOME.CANNOT_ROUTE)

  const ownerMessages = ownerAuthoredContext(input.message, input.history)
  if (!ownerMessages.length) return refuse(OUTCOME.NO_OWNER_CONTEXT)

  const completed = input.completedWorlds && typeof input.completedWorlds === 'object' ? input.completedWorlds : {}
  const completedWorlds = { internal: completed.internal === true, public: completed.public === true }

  let raw
  try {
    raw = await decide({
      // ⛔ THE COMPLETE INPUT LIST, AND IT IS THE SECURITY PROPERTY. There is no evidence
      // parameter to forget to strip: this function receives only a message, a history, a
      // world name, two booleans and a capability list.
      ownerMessages: ownerMessages.slice(),
      requiredWorld,
      completedWorlds,
      capabilities: capabilities.slice(),
      system: WORKER_SYSTEM,
      schema: buildSchema(capabilities)
    })
  } catch (_) {
    // The thrown message is DISCARDED — an upstream error can carry the prompt back with it.
    return refuse(OUTCOME.FAILED)
  }

  let o = raw
  if (typeof raw === 'string') {
    const s = raw.trim()
    if (!s) return refuse(OUTCOME.UNUSABLE)
    try { o = JSON.parse(s) } catch (_) {
      const m = /\{[\s\S]*\}/.exec(s)
      if (!m) return refuse(OUTCOME.UNUSABLE)
      try { o = JSON.parse(m[0]) } catch (_) { return refuse(OUTCOME.UNUSABLE) }
    }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return refuse(OUTCOME.UNUSABLE)
  if (o.decision === 'cannot_route' || o.capability === NO_CAPABILITY) return refuse(OUTCOME.CANNOT_ROUTE)
  if (o.decision !== 'read') return refuse(OUTCOME.UNUSABLE)

  const cap = typeof o.capability === 'string' ? o.capability : ''
  // ══════════════════════════════════════════════════════════════════════════
  // ⛔ THE WORKER PROPOSES; THESE CHECKS DISPOSE. Every one of them is the server's, and a
  // second provider changes none of them: an invented name, a write-shaped name, or a name
  // from the world we did NOT ask for is refused here, before any connector is touched.
  // ══════════════════════════════════════════════════════════════════════════
  if (!capabilities.includes(cap)) return refuse(OUTCOME.UNAUTHORISED)
  if (WRITE_SHAPED.test(cap)) return refuse(OUTCOME.WRITE_SHAPED)
  if (worldForCapability(cap) !== requiredWorld) return refuse(OUTCOME.WRONG_WORLD)
  if (!resolveReadOperation(cap)) return refuse(OUTCOME.UNAUTHORISED)

  return { ok: true, capability: cap, outcome: OUTCOME.ROUTED }
}

/**
 * The prompt body the wiring sends. Kept here so the ONE place that decides what the worker
 * may see is the same place that documents it — and so a provider adapter never assembles it.
 */
function buildWorkerPrompt ({ ownerMessages, requiredWorld, completedWorlds, capabilities }) {
  const done = []
  if (completedWorlds && completedWorlds.internal === true) done.push(WORLD_LABEL.internal)
  if (completedWorlds && completedWorlds.public === true) done.push(WORLD_LABEL.public)
  return [
    'Louie 自己打過嘅說話（舊到新）：\n' + ownerMessages.map((m, i) => (i + 1) + '. ' + m).join('\n'),
    '仲欠：' + WORLD_LABEL[requiredWorld] + '。',
    '已經攞到：' + (done.length ? done.join('、') : '（暫時乜都未攞到）'),
    '可用讀取操作：\n' + describeOperations(capabilities)
  ].join('\n\n')
}

/** One content-free line: enums and counts. Never the Owner's words, never a capability body. */
function logRecoveryWorker (entry, sink) {
  const line = {
    event: 'A4_RECOVERY_WORKER',
    timestamp: new Date().toISOString(),
    requestId: entry && entry.requestId != null ? String(entry.requestId) : null,
    outcome: entry && Object.values(OUTCOME).includes(entry.outcome) ? entry.outcome : OUTCOME.FAILED,
    requiredWorld: entry && entry.requiredWorld === 'public' ? 'public' : 'internal',
    // The chosen operation is a fixed identifier from the authorised list, never content.
    capability: entry && typeof entry.capability === 'string' ? entry.capability.slice(0, 64) : null,
    durationMs: Number.isFinite(entry && entry.durationMs) ? entry.durationMs : null
  }
  try { (sink || ((l) => console.log('[AROMA-RECOVERY-WORKER]', JSON.stringify(l))))(line) } catch (_) {}
  return line
}

module.exports = {
  WORKER_SYSTEM,
  WORLD_LABEL,
  NO_CAPABILITY,
  OUTCOME,
  buildSchema,
  buildWorkerPrompt,
  worldForCapability,
  runRecoveryWorker,
  logRecoveryWorker
}
