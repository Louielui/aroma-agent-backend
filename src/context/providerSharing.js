'use strict'

/**
 * providerSharing.js — WHICH context sources may be sent to WHICH provider.
 *
 * Until now the answer was hard-coded: Claude received the read-context and Decision
 * Recall blocks, GPT received neither, and changing that meant changing code. The Owner
 * has now decided, knowingly, that his operational data may go to a second vendor — so
 * GPT receives the same context Claude does.
 *
 * That decision is not permanent and must not require another code change to walk back.
 * This module makes the sharing policy CONFIGURATION, per source, per provider:
 *
 *     CONTEXT_<SOURCE>_OPENAI = on | off
 *
 * where <SOURCE> is DRIVE, GMAIL, CALENDAR, GITHUB, or DECISIONS (the Decision Recall
 * block). Unset means SHARED, because that is the decision the Owner just made. Setting
 * one to `off` withholds that single source from GPT while leaving Claude untouched —
 * Gmail is the one most likely to be pulled back, and it can be, on its own.
 *
 * FAIL-CLOSED DIRECTION. For a flag that controls whether data leaves for a second
 * vendor, "closed" means WITHHOLD. So an unrecognised value ('yes', 'true', 'ON', '1',
 * anything) is treated as `off` and warned about — a typo can only ever send LESS data to
 * OpenAI, never more. This is the opposite default from the capability flags in flags.js,
 * where unset means off; there, closed means "no capability", here it means "no export".
 *
 * The Claude path is deliberately not configurable here: Claude is the provider the
 * context was gathered for, and gating it would be a capability change (that is what
 * READ_ACCESS and the per-source CONTEXT_* flags in flags.js already do, for both).
 */

const CLAUDE = 'claude'
const OPENAI = 'openai'

// The Decision Recall block is treated as a source for sharing purposes: it is Owner
// decision history, and he must be able to withhold it exactly like Gmail.
const DECISIONS = 'decisions'

const SHARABLE = Object.freeze(['drive', 'gmail', 'calendar', 'github', DECISIONS])

/** The env var that governs one source for one provider. */
function sharingVarName (source, provider) {
  if (provider !== OPENAI) return null // only the second vendor is gated here
  return `CONTEXT_${String(source).toUpperCase()}_OPENAI`
}

/**
 * May `source` be sent to `provider`?
 * @returns {boolean}
 */
function isSharedWith (provider, source, env = process.env) {
  if (provider !== OPENAI) return true // Claude: unchanged, always
  const name = sharingVarName(source, provider)
  const raw = env[name]
  if (raw === undefined || raw === null || raw === '') return true // the Owner's decision: shared
  if (raw === 'on') return true
  if (raw === 'off') return false
  // Fail-closed for an EXPORT flag = withhold. A typo must never widen what leaves.
  console.warn(`[AROMA-HUB] Invalid ${name}="${raw}" — withholding ${source} from OpenAI (fail-closed).`)
  return false
}

/**
 * Filter a source list for one provider, preserving order.
 * @returns {string[]}
 */
function sourcesForProvider (provider, sources = [], env = process.env) {
  return sources.filter((s) => isSharedWith(provider, s, env))
}

/** Convenience for the Decision Recall block, which is not part of the source list. */
function decisionRecallSharedWith (provider, env = process.env) {
  return isSharedWith(provider, DECISIONS, env)
}

/** What is currently withheld from OpenAI — for the UI and for the report. */
function withheldFrom (provider, env = process.env) {
  return SHARABLE.filter((s) => !isSharedWith(provider, s, env))
}

module.exports = {
  isSharedWith,
  sourcesForProvider,
  decisionRecallSharedWith,
  withheldFrom,
  sharingVarName,
  SHARABLE,
  DECISIONS,
  CLAUDE,
  OPENAI
}
