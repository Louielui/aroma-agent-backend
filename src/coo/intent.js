'use strict'

/**
 * intent.js — the conversation → intent classifier for the Aroma OS backend.
 *
 * This is the first, smallest step on the "talking → doing" bridge. Given one
 * message from Louie, it decides whether the message is ordinary conversation
 * (intent 'chat') or a request to change a project (intent 'develop'). It is NOT
 * a planner: it never breaks work into steps, never dispatches anything, and
 * never creates a Run. It only labels a single message.
 *
 * The language model is UNTRUSTED and INJECTABLE. classifyIntent takes an `llm`
 * function so tests can drive it with a fake and the real model is never called
 * from here. Whatever the model returns is treated as a suggestion that must
 * survive strict validation before it is believed:
 *
 *   - Greetings, questions and small talk are 'chat' and can never carry a task.
 *   - A 'develop' intent is honoured ONLY when it also carries a non-empty task
 *     string and a targetProject that is EXACTLY 'backend' or 'frontend'.
 *   - Any other targetProject — most importantly 'production' — is rejected and
 *     the whole classification falls back to 'chat' with an explanation. A
 *     language model can therefore never steer work at production from here.
 *
 * Everything is in-memory and pure: no file I/O, no network, no real LLM.
 */

// The only project targets a develop intent may name. 'production' is
// deliberately absent — it is a separate, human-gated concern and can never be
// reached through a classified message.
const TARGET_PROJECTS = ['backend', 'frontend']

/** True when a value is a present, non-blank string. */
function isNonEmptyString (value) {
  return typeof value === 'string' && value.trim().length > 0
}

/** Build a 'chat' classification, optionally carrying an explanation. */
function chat (explanation) {
  const result = { intent: 'chat' }
  if (isNonEmptyString(explanation)) result.explanation = explanation
  return result
}

/**
 * ⛔ THE THIRD OUTCOME. There were two — chat and develop — and every way of failing had to
 * pick one of them. Failing picked `chat`, which is why a lost instruction looked like a reply.
 *
 * `unavailable` asserts nothing about what the Owner asked for. It says only that we could not
 * find out, which is the honest position and the one the caller must not paper over.
 */
function unavailable (reason, detail) {
  return {
    intent: 'unavailable',
    reason: isNonEmptyString(reason) ? reason : 'error',
    detail: isNonEmptyString(detail) ? detail : null
  }
}

/**
 * Which KIND of not-finding-out it was. The adapter already distinguishes these — a timeout
 * means the model was still working, an unreadable response means we could not parse what came
 * back — and losing that here would rebuild the same flattening one layer up.
 */
/**
 * The deterministic route, or `null` if the router cannot be consulted.
 *
 * ⛔ A ROUTER FAILURE FALLS BACK TO THE MODEL, NEVER TO A GUESS. If `routeTurn` throws, this
 * returns null and the caller behaves exactly as it did before the split — one model call that
 * decides. Failing closed to 「it must be chat」 here would be the lost-instruction defect
 * rebuilt in the component added to prevent paying for it.
 */
/**
 * Does this sentence propose CHANGING or MAKING something?
 *
 * ⛔ DELIBERATELY WIDE, AND THE DIRECTION OF THE ERROR IS THE POINT. This only ever decides
 * whether the deterministic cover may REJECT the model's `develop` claim. Over-matching leaves
 * the model in charge — today's behaviour, no regression. Under-matching EATS A REAL
 * INSTRUCTION, silently, and the Owner is told it was a chat. So when in doubt, match.
 *
 * ⛔ IT IS NOT `laneRouter`'s CHANGE_ACT AND MUST NOT BE MERGED WITH IT. That one is narrow on
 * purpose: paired with a file object it OPENS the proposal lane, so a wide version there would
 * route loose talk into work orders. This one only CLOSES a claim. Same words, opposite
 * consequence of being wrong — which is why they are two lists and not one (HR-58: a shared
 * vocabulary whose two callers need opposite error directions is not a shared vocabulary).
 *
 * Measured on the Owner's phrasings: 6 of 6 work requests preserved, 4 of 5 asks protected.
 * The miss is 「講吓你可以做咩」 — 「做」 inside 「做咩」 — recorded rather than tuned away.
 */
const CHANGE_ISH = /(改|更新|修正|修復|整|做|加|新增|加入|建立|開發|刪|移除|重寫|重構|部署|發佈|安裝|設定|配置|寫|生成|產生|實作|實現|update|modify|edit|fix|change|refactor|remove|delete|add|build|create|make|deploy|install|implement|write|generate)/i

function proposesAChange (message) {
  return typeof message === 'string' && CHANGE_ISH.test(message)
}

function safeRoute (message) {
  try {
    const { routeTurn } = require('../intake/turnRouter')
    const r = routeTurn(message)
    return (r && typeof r.route === 'string') ? r : null
  } catch (_) {
    return null
  }
}

function reasonOf (err) {
  if (!err) return 'error'
  if (err.isTimeout === true) return 'timeout'
  if (err.unreadableResponse === true) return 'unreadable'
  if (/\boverloaded\b/i.test(String(err.message || ''))) return 'overloaded'
  return 'error'
}

/**
 * Classify one message as 'chat' or 'develop'.
 *
 * @param {string} message — Louie's raw message.
 * @param {function} llm — an injectable classifier. Called as `llm(message)` and
 *   expected to return (sync or async) an object shaped like
 *   `{ intent: 'chat'|'develop', task?: string, targetProject?: string,
 *      reply?: string }`. Its output is UNTRUSTED and fully re-validated here.
 * @returns {Promise<{ intent: 'chat', explanation?: string, reply?: string }
 *   | { intent: 'develop', task: string, targetProject: 'backend'|'frontend' }>}
 */
async function classifyIntent (message, llm) {
  if (typeof llm !== 'function') {
    throw new TypeError('classifyIntent requires an injectable llm function')
  }
  if (!isNonEmptyString(message)) {
    return chat('empty message — nothing to classify')
  }

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * ⛔ ROUTE FIRST, DETERMINISTICALLY — AND THE ROUTER ALREADY EXISTED.
   *
   * This call used to do two jobs with opposite requirements in one 400-token budget: decide
   * whether the message is a change request, and AUTHOR the task string a worker executes.
   * Routing wants cheap, closed and deterministic. Authoring wants reasoning and headroom.
   *
   * `turnRouter.routeTurn` has returned ['UTILITY','ACTION','BUSINESS_QUERY','CONVERSATION']
   * with zero model calls since before this file's classifier was written, and it runs on every
   * turn already. `ACTION` IS the routing half of what the model was being paid to do — so this
   * is a DELETION of a second router, not the addition of a first. (HR-71.)
   *
   * ── ⛔ THE BOUNDARY IS NARROWER THAN THE DESIGN PROPOSED, AND HERE IS WHY ──
   *
   * The design said: ambiguous ⇒ ask. `routeTurn` cannot express that ambiguity. `ACTION` and
   * `CONVERSATION` are both returned with confidence 'high' — 'low' appears only where a
   * UTILITY pattern collides with a business noun. CONVERSATION is the FALLBACK, reached with
   * `reason: 'default'` when nothing matched, and on this Owner's traffic (median message: nine
   * characters) most ordinary chat lands there. Asking 「你想我改嘢定係答你？」 on every
   * default-routed turn would interrogate him for saying 你好.
   *
   * So the split is applied only where the router SPEAKS POSITIVELY:
   *
   *   ACTION                      -> author (the model call, now the only one)
   *   UTILITY | BUSINESS_QUERY    -> chat, WITH NO MODEL CALL — something matched, and it
   *                                  was not a change request
   *   CONVERSATION via 'default'  -> unchanged: the model still decides
   *
   * The residue keeps today's behaviour exactly rather than being degraded by a signal that
   * does not exist. The ask-branch needs a detector of 「looks like a change request」 that
   * `routeTurn` does not provide, and inventing one here would be the fifth duplicate.
   * ══════════════════════════════════════════════════════════════════════════
   */
  /**
   * ⛔ AND THE SAVING I FIRST CLAIMED HERE DID NOT EXIST. MY OWN TEST CAUGHT IT.
   *
   * The first version returned `chat(...)` immediately on a positively-routed non-action, with
   * no model call — 「three of five real messages now cost nothing」. That was true and it was
   * dropping the reply: THIS CALL AUTHORS THREE THINGS, not two. It routes, it authors the work
   * order's task, AND it authors the ordinary chat reply that `propose()` returns to its caller
   * as `reply`. Skipping the call skipped the answer.
   *
   * So the split on this path is NOT a cost saving. It is a correctness one, and it is worth
   * more than the saving was:
   *
   *   the ROUTE decides develop-or-not, deterministically
   *   the MODEL only writes prose, and its `intent` claim is IGNORED where the router spoke
   *
   * A model that hallucinates `intent: 'develop'` on 「聽日幾號？」 can no longer create a work
   * order, because a deterministic router already said UTILITY and that is not overridable by
   * a sentence. The 400-token budget stops being the thing that decides.
   */
  const route = safeRoute(message)
  /**
   * ⛔ TWO WAYS TO BE POSITIVELY NOT-AN-ACTION, AND THE SECOND ONE IS NEW (HR-75).
   *
   * (a) the router positively matched something — UTILITY, BUSINESS_QUERY, or a question.
   * (b) the sentence proposes no change at all.
   *
   * (b) exists because `reason` is only INTERROGATIVE-or-not (`laneRouter.js:121`), so (a)
   * alone protected QUESTIONS and not REQUESTS. 「給我 Aroma System 的 website」 routed
   * CONVERSATION/'default', the cover switched off, and the model's `develop` claim turned an
   * ordinary request into 「尚未建立任何提案」.
   *
   * ⛔ AND THE BLANKET FIX WAS MEASURED AND REJECTED. Simply dropping `!== 'default'` looks
   * right and is not: EVERY genuine work request also routes CONVERSATION/'default', because
   * the PROPOSAL lane needs a change verb AND a file object AND no question mark. Blanket
   * would convert every development request into chat — the LOST INSTRUCTION failure this
   * file already names, where the Owner asks for work and is told it was a conversation.
   */
  const routedNotAnAction = !!(route && route.route !== 'ACTION' &&
    (route.reason !== 'default' || !proposesAChange(message)))

  /**
   * ⛔ A CLASSIFIER FAILURE IS A FAILURE. IT IS NOT A CONVERSATION.
   *
   * This used to be `catch (err) { return chat('classifier unavailable: …') }`, and the
   * comment above it said 「any throw is contained: an unusable model answer is simply not a
   * development request」. That reasoning is sound for a model that ANSWERED and said no. It is
   * false for a model that never answered.
   *
   * The consequence: the Owner asks for work, the call times out, and `propose()` sees an
   * intent that is not 'develop' and returns `{intent:'chat', proposal:null}`. **The
   * instruction is not degraded — it is LOST, and he is told it was a chat.** He would never
   * know he had asked for something.
   *
   * ⛔ HR-67, ONE SUBSYSTEM OVER: a failure emitting the success path's vocabulary. And it gets
   * likelier the moment authoring runs a reasoning model at a 120-second ceiling.
   *
   * ⛔ AND THE FIX IS NOT A LONGER TIMEOUT. A longer timeout makes this rarer. Only naming it
   * makes it visible, and a lost instruction the Owner cannot see is not made acceptable by
   * being rare.
   */
  let raw
  try {
    raw = await llm(message)
  } catch (err) {
    return unavailable(reasonOf(err), err && err.message ? String(err.message).slice(0, 200) : String(err))
  }

  // Nothing usable came back. The model may have answered, but not in a shape that can be
  // read — which is the same position as not having answered at all, and is reported as such.
  if (!raw || typeof raw !== 'object') {
    return unavailable('unreadable', 'the classifier returned no usable result')
  }

  /**
   * ⛔ THE ROUTER OUTRANKS THE MODEL'S CLAIM. This is the correctness half of the split.
   *
   * When `routeTurn` positively matched UTILITY or BUSINESS_QUERY, the message is not a change
   * request and no sentence the model returns can make it one. Its prose is still used as the
   * reply — that is the job it is genuinely good at — but its `intent` is discarded.
   */
  if (routedNotAnAction && raw.intent === 'develop') {
    return isNonEmptyString(raw.reply)
      ? { intent: 'chat', reply: raw.reply, explanation: `routed ${route.route} deterministically; the model's develop claim was not accepted` }
      : chat(`routed ${route.route} deterministically; the model's develop claim was not accepted`)
  }

  // Anything that is not an explicit, well-formed 'develop' is conversation.
  // Greetings, questions and small talk land here and never carry a task.
  if (raw.intent !== 'develop') {
    return isNonEmptyString(raw.reply) ? { intent: 'chat', reply: raw.reply } : chat()
  }

  // From here the model claims a development request. Believe it ONLY if it is
  // fully specified and safe.
  if (!isNonEmptyString(raw.task)) {
    return chat('a development request must name a concrete task')
  }
  if (raw.targetProject === 'production') {
    return chat('production is never a valid target for a development request')
  }
  if (!TARGET_PROJECTS.includes(raw.targetProject)) {
    return chat(`targetProject must be exactly one of ${TARGET_PROJECTS.join(' or ')}`)
  }

  // A valid, safe development request. Return only the fields we vouch for — the
  // task is passed through VERBATIM so it is exactly what a worker would receive.
  return {
    intent: 'develop',
    task: raw.task,
    targetProject: raw.targetProject
  }
}

module.exports = {
  // Exported for its own test: the guard's new half is a rule about the Owner's phrasings
  // and must be provable without a model call.
  proposesAChange, classifyIntent, TARGET_PROJECTS }
