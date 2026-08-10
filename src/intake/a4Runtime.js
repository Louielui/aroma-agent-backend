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
 * ══════════════════════════════════════════════════════════════════════════════
 * ⛔ EVERY A4 ROLE IS PINNED TO THE MODEL ITS CONTRACT WAS VALIDATED ON.
 *
 * The first version of this composer handed the three verifiers the TURN'S MAIN ADAPTER. That
 * is a real defect, not a style point: `adapterFactory` defaults to Claude, so shipping it
 * would have run three safety-critical contracts on a provider none of them was ever measured
 * against — and 「change the conversational brain」 would silently have become 「re-benchmark the
 * source-intent resolver」. The SIR ladder alone showed four models disagreeing on the same
 * case; a verifier's provider is part of its contract, not an implementation detail.
 *
 * ⛔ AND THE MODEL IS A LITERAL, NOT `OPENAI_MODEL`. Reading the env var would put a safety
 * component back under a setting that exists to steer the conversational lane — the same class
 * of coupling, one indirection along. Changing a role here is a code change, reviewed as one.
 * ══════════════════════════════════════════════════════════════════════════════
 */
const VERIFIER_PROVIDER = 'openai'
const VERIFIER_MODEL = 'gpt-5.6-terra'

/**
 * ⛔ MEDIUM, AND NEVER THE GLOBAL DEFAULT. The adapter's own default is `low`, which is right
 * for the conversational lane and wrong here: these are narrow judgements the whole turn's
 * honesty rests on, and they were validated at medium.
 */
const VERIFIER_EFFORT = 'medium'

const A4_ROLES = Object.freeze({
  sourceIntentResolver: Object.freeze({ provider: VERIFIER_PROVIDER, model: VERIFIER_MODEL, effort: VERIFIER_EFFORT }),
  finalVerifier: Object.freeze({ provider: VERIFIER_PROVIDER, model: VERIFIER_MODEL, effort: VERIFIER_EFFORT }),
  publicQueryPlanner: Object.freeze({ provider: VERIFIER_PROVIDER, model: VERIFIER_MODEL, effort: VERIFIER_EFFORT }),
  recoveryWorker: Object.freeze({ provider: 'anthropic', model: RECOVERY_WORKER_MODEL, effort: null })
})

/**
 * The narrow verifiers reason about ONE question against the Owner's own words. Reasoning
 * tokens bill as output tokens AND count against this budget, so it is set high enough that a
 * medium-effort pass cannot exhaust it before emitting the JSON — an exhausted budget returns
 * empty text, which every runner correctly reads as 「unavailable」 and which would therefore
 * look exactly like a model that could not decide.
 */
const VERIFIER_MAX_TOKENS = 4096
const PUBLIC_KEY_ENV = 'OPENAI_API_KEY'

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

/**
 * Build the ROLE adapter for one verifier. Lazy: nothing is constructed until a turn actually
 * asks that role a question, so composition costs nothing on a turn that never routes.
 */
function defaultVerifierAdapterFactory ({ role, model, effort, apiKey }) {
  const { OpenAIAdapter } = require('../adapters/OpenAIAdapter')
  // ⛔ THE MODEL IS PASSED IN, NOT READ FROM THE ENVIRONMENT. `createOpenAIAdapterIfConfigured`
  // takes OPENAI_MODEL, which is the CONVERSATIONAL lane's setting; a verifier that followed it
  // would be re-pointed by a change that has nothing to do with it.
  return new OpenAIAdapter({ model, apiKey, reasoningEffort: effort })
}

/** One structured-output call on a ROLE-PINNED adapter. */
function structuredCall (makeAdapter, role, name) {
  return async (prompt, system, schema) => {
    const adapter = makeAdapter(role)
    const r = await adapter.complete(prompt, {
      system,
      // ⛔ `type` IS REQUIRED. Without it the adapter rejects the option, the runner swallows the
      // throw, and the turn silently degrades to its fail-closed answer — a broken verifier and
      // an honestly-undecidable question are indistinguishable from the outside.
      responseFormat: { type: 'json_schema', name, schema, strict: true },
      // ⛔ PER-CALL, so the global OPENAI_REASONING_EFFORT cannot lower a verifier.
      reasoningEffort: A4_ROLES[role].effort,
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
 * ⛔ THERE IS NO `adapter` PARAMETER, AND THAT IS THE FIX. The turn's conversational adapter is
 * not accepted here at all, so no future edit can quietly let the main model answer a verifier:
 * there is no channel to pass it through. A test asserts the module never mentions one.
 *
 * @param {object} [options]
 * @param {object} [options.env]
 * @param {function} [options.verifierAdapterFactory]  test seam — ({role, model, effort, apiKey}) => adapter
 * @param {function} [options.recoveryAdapterFactory]  test seam — (model) => adapter
 * @returns {{deps: object|null, built: string[], skipped: {name:string, reason:string}[], roles: object}}
 */
function createA4RuntimeDependencies (options = {}) {
  const env = options.env || process.env
  const built = []
  const skipped = []

  /**
   * ⛔ A4 OFF BUILDS NOTHING. Not a resolver, not a worker, not an adapter object. The OFF path
   * must not depend on anything A4 needs — including a model client that would be constructed,
   * and possibly fail, for a feature that is not running.
   */
  if (!a4SemanticRoutingEnabled(env)) {
    return { deps: null, built, skipped: [{ name: 'a4', reason: 'A4_KNOWLEDGE_ROUTING off' }], roles: A4_ROLES }
  }

  const deps = {}
  const apiKey = env[PUBLIC_KEY_ENV]
  const makeVerifier = options.verifierAdapterFactory || defaultVerifierAdapterFactory

  /**
   * ⛔ NO KEY, NO VERIFIERS — AND NO SUBSTITUTE ANYWHERE.
   *
   * The verifiers are simply absent, which lands each turn on its own runner's fail-closed
   * path: the resolver asks the Owner what he meant, the planner refuses to let anything leave.
   * ⛔ IT DOES NOT FALL BACK TO CLAUDE OR TO THE MAIN ADAPTER. A fallback would answer the
   * Owner using a contract that was never validated on the model that answered it, and it would
   * do so invisibly — which is worse than not answering. It does not fall back to legacy
   * behaviour either, because legacy behaviour is 「answer anyway」, and answering without
   * establishing the world is the thing A4 exists to stop.
   */
  if (!apiKey) {
    for (const role of ['sourceIntentResolver', 'finalVerifier', 'publicQueryPlanner']) {
      skipped.push({ name: role, reason: PUBLIC_KEY_ENV + ' not set' })
    }
  } else {
    const adapterFor = (role) => makeVerifier({
      role,
      provider: A4_ROLES[role].provider,
      model: A4_ROLES[role].model,
      effort: A4_ROLES[role].effort,
      apiKey
    })

    const sirCall = structuredCall(adapterFor, 'sourceIntentResolver', 'owner_source_intent')
    const finalCall = structuredCall(adapterFor, 'finalVerifier', 'final_knowledge_requirement')
    const plannerCall = structuredCall(adapterFor, 'publicQueryPlanner', 'public_query_plan')

    deps.sourceIntentResolver = async ({ ownerMessages, system, schema }) =>
      sirCall(buildIntentPrompt(ownerMessages), system || INTENT_SYSTEM, schema || INTENT_SCHEMA)

    deps.finalVerifier = async ({ ownerMessages, availableWorlds, system, schema }) =>
      finalCall(renderOwnerMessages(ownerMessages) + renderAvailableWorlds(availableWorlds), system, schema)

    deps.publicQueryPlanner = async ({ ownerMessages, system, schema }) =>
      plannerCall(renderOwnerMessages(ownerMessages), system, schema)

    built.push('sourceIntentResolver', 'finalVerifier', 'publicQueryPlanner')
  }

  /**
   * ⛔ THE RECOVERY WORKER STAYS EXACTLY WHERE IT WAS — Anthropic, Haiku 4.5, pinned. It has a
   * different provider from the three verifiers ON PURPOSE: it exists because the GPT main
   * model failed the same recovery case repeatedly, so putting it on the same family it was
   * introduced to compensate for would undo the reason it exists. ClaudeAdapter's own defects
   * are a separate, un-authorised piece of work and are not touched here.
   */
  const recoveryModel = options.recoveryWorkerModel || A4_ROLES.recoveryWorker.model
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

  return { deps, built, skipped, roles: A4_ROLES }
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
    // ⛔ THE PINNED ROLE MAP, so a running process can be asked what its verifiers actually
    // are. Provider and model names only — never a key, a prompt or an Owner message.
    roles: Object.fromEntries(Object.entries(A4_ROLES).map(([k, v]) => [k, v.provider + ':' + v.model])),
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
  defaultVerifierAdapterFactory,
  A4_ROLES,
  RECOVERY_WORKER_MODEL,
  VERIFIER_PROVIDER,
  VERIFIER_MODEL,
  VERIFIER_EFFORT,
  VERIFIER_MAX_TOKENS,
  PUBLIC_KEY_ENV
}
