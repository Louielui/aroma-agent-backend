'use strict'
const { classifyPureChatEligibility } = require('./pureChatEligibility')
const { DEFAULT_EFFORT, REASONING_EFFORTS } = require('../subscription/chatModels')
const PROFILES = Object.freeze(Object.fromEntries(REASONING_EFFORTS.map(level => [level, Object.freeze({ level, effort: level })])))
const LEGACY_LEVELS = Object.freeze({ fast: 'low', standard: 'medium', deep: 'high' })
function profileFor (level = DEFAULT_EFFORT) {
  if (typeof level !== 'string') throw Error('invalid_chat_level')
  const canonical = Object.hasOwn(LEGACY_LEVELS, level) ? LEGACY_LEVELS[level] : level
  if (!Object.hasOwn(PROFILES, canonical)) throw Error('invalid_chat_level')
  return PROFILES[canonical]
}
function canUseSocialFastPath (message, route, history, opts) {
  if (!Array.isArray(history) || !opts || opts.contextCard || opts.attachSection || opts.sectionPreamble) return false
  // The browser includes the current message in history. Earlier turns can carry
  // pending work, so they keep the full pipeline even when this message is thanks.
  if (history.length && !(history.length === 1 && history[0] && history[0].role === 'user' && history[0].text === message)) return false
  return classifyPureChatEligibility(message, route).eligible === true
}
module.exports = { PROFILES, LEGACY_LEVELS, profileFor, canUseSocialFastPath }
