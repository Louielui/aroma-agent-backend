'use strict'

/**
 * a4Runtime.js — THE ONE PLACE A4'S RUNTIME DEPENDENCIES ARE CONSTRUCTED.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ THE GAP THIS CLOSES: A4 WAS MERGED AND UNREACHABLE.
 *
 * `intakeRouter` called `processIntake(message, adapter, history, opts)` with no
 * `readContextDeps` at all, so in production every A4 dependency resolved to `null`:
 *
 *   · Source Intent Resolver  → null → `runOwnerSourceIntent` fails closed to 「ambiguous」,
 *     so every A4 turn asked a clarifying question and never routed anywhere
 *   · Final Knowledge verifier → null → the obligation gate could not verify
 *   · Public Query Egress Planner → null → a public read after internal evidence refused
 *   · `public_knowledge`      → absent from the source registry entirely
 *
 * A4 was therefore inert BY ACCIDENT rather than by decision — and 「inert by accident」 is the
 * state that quietly becomes 「live by accident」 the moment someone flips a flag. Composition is
 * now explicit, and the flags are the only switch.
 *
 * ⛔ THIS IS WIRING. It activates nothing: A4 defaults off, `public_knowledge` defaults off,
 * and both must be turned on deliberately.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ── WHY PROVIDER CHOICE LIVES HERE AND NOWHERE ELSE ─────────────────────────
 * The semantic modules state WHAT must be decided and carry their own frozen system text and
 * schema. They must never learn WHO decides it — a vendor name inside a semantic contract makes
 * the contract un-portable and makes 「swap the model」 a semantic change. So every module hands
 * this file a `{system, schema}` pair, and this file is the only one that owns a model.
 */

const { INTENT_SYSTEM, INTENT_SCHEMA, buildIntentPrompt } = require('./ownerSourceIntentResolver')
const { buildWorkerPrompt } = require('./recoveryDecisionWorker')
const { a4SemanticRoutingEnabled } = require('./a4Contract')

/**
 * ⛔ THE RECOVERY WORKER'S MODEL IS PINNED, NOT INHERITED.
 * It is a narrow, bounded classifier whose only job is 「which capability reaches the world the
 * main model just refused to read」. It was measured on this build and stays on it; letting it
 * follow the session model would silently re-benchmark a safety component.
 */
const RECOVERY_WORKER_MODEL = 'claude-haiku-4-5-20251001'

/**
 * The narrow verifiers reason about ONE question against the Owner's own words. Reasoning
 * tokens bill as output tokens AND count against this budget, so it is set high enough that a
 * medium-effort pass cannot exhaust it before emitting the JSON — an exhausted budget returns
 * empty text, which every runner correctly reads as 「unavailable」 and which would therefore
 * look exactly like a model that could not decide.
 */
const VERIFIER_MAX_TOKENS = 4096
const VERIFIER_EFFORT = 'medium'

/**
 * Render the Owner's own messages for a verifier that has no builder of its own.
 * ⛔ OWNER TEXT AND NOTHING ELSE. The runners have already filtered `history` down to messages
 * he actually typed; this only numbers them.
 */
function renderOwnerMessages (ownerMessages) {
  return 'Messages Louie wrote himself (oldest to newest):\n' +
    (Array.isArray(ownerMessages) ? ownerMessages : []).map((m, i) => (i + 1) + '. ' + m).join('\n')
}

/**
 * ⛔ TWO BOOLEANS, RENDERED AS TWO BOOLEANS. The final-knowledge verifier is documented to
 * receive which worlds are reachable at all; without this it would be asked to decide with a
 * parameter it never sees, and would oblige a world that cannot be read.
 */
function renderAvailableWorlds (aw) {
  const yn = (b) => (b === true ? 'yes' : 'no')
  return '\n\nReachable knowledge worlds — internal: ' + yn(aw && aw.internal) +
    ', public: ' + yn(aw && aw.public) + '.'
}

/** One structured-output call, on whichever adapter composition chose. */
function structuredCall (adapter, name) {
  return async (prompt, system, schema) => {
    const r = await adapter.complete(prompt, {
      system,
      // ⛔ `type` IS REQUIRED. Without it the adapter rejects the option, the runner swallows the
      // throw, and the turn silently degrades to its fail-closed answer — a broken verifier and
      // an honestly-undecidable question are indistinguishable from the outside.
      responseFormat: { type: 'json_schema', name, schema, strict: true },
      reasoningEffort: VERIFIER_EFFORT,
      maxTokens: VERIFIER_MAX_TOKENS
    })
    // ⛔ THE RAW STRING, NOT A PARSED OBJECT. Every runner validates and parses for itself,
    // against its own schema. Parsing here would put a second, unvalidated reader in the path.
    return r.text
  }
}

/**
 * Build A4's runtime dependency bundle.
 *
 * @param {object} options
 * @param {object} options.adapter   the turn's main adapter — the same one answering the Owner
 * @param {object} [options.env]
 * @param {string} [options.recoveryWorkerModel]
 * @param {function} [options.recoveryAdapterFactory]  test seam, same shape as liveClients'
 * @returns {{deps: object|null, built: string[], skipped: {name:string, reason:string}[]}}
 */
function createA4RuntimeDependencies (options = {}) {
  const env = options.env || process.env
  const adapter = options.adapter || null
  const built = []
  const skipped = []

  /**
   * ⛔ A4 OFF BUILDS NOTHING. Not a resolver, not a worker, not an adapter object. The OFF path
   * must not depend on anything A4 needs — including a model client that would be constructed,
   * and possibly fail, for a feature that is not running.
   */
  if (!a4SemanticRoutingEnabled(env)) {
    return { deps: null, built, skipped: [{ name: 'a4', reason: 'A4_KNOWLEDGE_ROUTING off' }] }
  }

  /**
   * ⛔ NO ADAPTER, NO VERIFIERS — AND NO SUBSTITUTE. Each dependency is simply absent, which
   * lands the turn on its own runner's fail-closed path: the resolver asks the Owner what he
   * meant, the planner refuses to let anything leave. It does NOT fall back to legacy
   * behaviour, because legacy behaviour is 「answer anyway」, and answering was the thing A4
   * exists to stop.
   */
  if (!adapter || typeof adapter.complete !== 'function') {
    skipped.push({ name: 'sourceIntentResolver', reason: 'no adapter' })
    skipped.push({ name: 'finalVerifier', reason: 'no adapter' })
    skipped.push({ name: 'publicQueryPlanner', reason: 'no adapter' })
  }

  const deps = {}

  if (adapter && typeof adapter.complete === 'function') {
    const call = structuredCall(adapter, 'a4_verifier')

    deps.sourceIntentResolver = async ({ ownerMessages, system, schema }) =>
      call(buildIntentPrompt(ownerMessages), system || INTENT_SYSTEM, schema || INTENT_SCHEMA)

    deps.finalVerifier = async ({ ownerMessages, availableWorlds, system, schema }) =>
      call(renderOwnerMessages(ownerMessages) + renderAvailableWorlds(availableWorlds), system, schema)

    deps.publicQueryPlanner = async ({ ownerMessages, system, schema }) =>
      call(renderOwnerMessages(ownerMessages), system, schema)

    built.push('sourceIntentResolver', 'finalVerifier', 'publicQueryPlanner')
  }

  /**
   * The recovery worker owns its own model, so it survives an absent main adapter — but it is
   * still constructed lazily, per call, exactly as the previous inline default did.
   */
  const recoveryModel = options.recoveryWorkerModel || RECOVERY_WORKER_MODEL
  deps.recoveryWorker = async (input) => {
    const make = options.recoveryAdapterFactory ||
      ((model) => new (require('../adapters/ClaudeAdapter').ClaudeAdapter)({ model }))
    const a = make(recoveryModel)
    const r = await a.complete(buildWorkerPrompt(input), {
      system: input.system,
      responseFormat: { type: 'json_schema', name: 'recovery_decision', schema: input.schema, strict: true }
    })
    return r.text
  }
  built.push('recoveryWorker')

  return { deps, built, skipped }
}

/**
 * ⛔ ONE CONTENT-FREE LINE SAYING WHAT A4 IS ACTUALLY MADE OF THIS PROCESS.
 * Names and reasons only — never a prompt, a schema, a model key or an Owner message.
 */
function logA4Composition ({ built, skipped }, sink) {
  const line = {
    event: 'A4_COMPOSITION',
    timestamp: new Date().toISOString(),
    built: Array.isArray(built) ? built.slice().sort() : [],
    skipped: Array.isArray(skipped) ? skipped.map((s) => ({ name: s.name, reason: s.reason })) : []
  }
  try { (sink || ((l) => console.log('[AROMA-A4-COMPOSITION]', JSON.stringify(l))))(line) } catch (_) {}
  return line
}

module.exports = {
  createA4RuntimeDependencies,
  logA4Composition,
  renderOwnerMessages,
  renderAvailableWorlds,
  RECOVERY_WORKER_MODEL,
  VERIFIER_EFFORT,
  VERIFIER_MAX_TOKENS
}
