'use strict'

/**
 * modelRouter.js — Multi-AI Router v0. Selects the PRIMARY provider for a turn.
 *
 * It decides ONE thing, deterministically: which provider gets the first attempt.
 * Fallback is NOT decided here — it belongs to the orchestration boundary in
 * intakeService that owns both adapter.complete() and the strict-envelope parse
 * (the parser cannot be reached from an adapter, so a router-level fallback would
 * have to duplicate or weaken it).
 *
 * RULE (no heuristics, no "may"):
 *   MULTI_AI_ROUTER !== 'on'                      -> 'claude'   (default, today's behaviour)
 *   MULTI_AI_ROUTER === 'on' AND mode === 'chat'  -> 'openai'
 *   anything else (proposal / email_draft / legacy / unset / non-exact 'chat') -> 'claude'
 *
 * Fail-closed: unset/empty/invalid flag values resolve to 'off'.
 */

const { resolveFlag } = require('../context/flags')

const CLAUDE = 'claude'
const OPENAI = 'openai'

/** Strict 'on' only; unset/empty/invalid -> 'off'. */
function resolveMultiAiRouter (env = process.env) {
  return resolveFlag(env, 'MULTI_AI_ROUTER')
}

/**
 * @param {object} env  process env
 * @param {{ interactionMode?: string }} opts
 * @returns {'claude'|'openai'}
 */
function selectPrimaryProvider (env = process.env, opts = {}) {
  if (resolveMultiAiRouter(env) !== 'on') return CLAUDE
  return (opts && opts.interactionMode === 'chat') ? OPENAI : CLAUDE
}

module.exports = { resolveMultiAiRouter, selectPrimaryProvider, CLAUDE, OPENAI }
