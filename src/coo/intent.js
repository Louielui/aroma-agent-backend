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

  // Ask the injected model. Any throw is contained: an unusable model answer is
  // simply not a development request.
  let raw
  try {
    raw = await llm(message)
  } catch (err) {
    return chat(`classifier unavailable: ${err && err.message ? err.message : String(err)}`)
  }

  if (!raw || typeof raw !== 'object') {
    return chat('classifier returned no usable result')
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

module.exports = { classifyIntent, TARGET_PROJECTS }
