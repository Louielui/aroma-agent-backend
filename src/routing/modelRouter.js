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
 *
 * ── THE OWNER'S PROVIDER HINT (v0.1) ────────────────────────────────────────────
 * The browser may express which 守燈 the Owner wants to talk to. That is INTENT, not
 * authority, so the hint is validated HERE against a closed allowlist and can do
 * exactly ONE thing: choose between the two providers for a CHAT turn.
 *
 *   - anything not exactly 'claude' or 'openai' is discarded, silently and safely
 *   - a hint on a non-chat turn is discarded (proposal / email_draft / legacy are
 *     unaffected by construction — they never consult it)
 *   - a hint cannot switch lanes, change the context boundary, skip the fallback, or
 *     reach anything executable: this function returns a provider NAME and nothing else
 *   - with the router flag off the hint is still honoured for chat, because choosing
 *     between two already-configured adapters is not a capability change; if the chosen
 *     adapter is not configured the orchestrator falls back exactly as it does today
 */

const { resolveFlag } = require('../context/flags')

const CLAUDE = 'claude'
const OPENAI = 'openai'
// The closed allowlist. Membership is the ONLY way a browser value survives.
const VALID_PROVIDERS = Object.freeze([CLAUDE, OPENAI])

/** Strict 'on' only; unset/empty/invalid -> 'off'. */
function resolveMultiAiRouter (env = process.env) {
  return resolveFlag(env, 'MULTI_AI_ROUTER')
}

/**
 * Validate an untrusted provider hint. Exact string match against the allowlist —
 * no trimming, no case-folding, no coercion, so 'Claude', ' openai', 'openai;drop' and
 * every object/array/number are all simply not providers.
 * @returns {'claude'|'openai'|null} null when there is no usable hint
 */
function normalizeProviderHint (hint) {
  return (typeof hint === 'string' && VALID_PROVIDERS.includes(hint)) ? hint : null
}

/**
 * @param {object} env  process env
 * @param {{ interactionMode?: string, providerHint?: * }} opts
 * @returns {'claude'|'openai'}
 */
function selectPrimaryProvider (env = process.env, opts = {}) {
  const isChat = !!(opts && opts.interactionMode === 'chat')
  // The hint applies to the chat lane and nowhere else.
  if (isChat) {
    const hinted = normalizeProviderHint(opts && opts.providerHint)
    if (hinted) return hinted
  }
  if (resolveMultiAiRouter(env) !== 'on') return CLAUDE
  return isChat ? OPENAI : CLAUDE
}

module.exports = { resolveMultiAiRouter, selectPrimaryProvider, normalizeProviderHint, VALID_PROVIDERS, CLAUDE, OPENAI }
