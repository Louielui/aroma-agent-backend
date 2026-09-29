'use strict'
const { classifyPureChatEligibility } = require('./pureChatEligibility')
const PROFILES = Object.freeze({
  fast: Object.freeze({ level: 'fast', effort: 'low' }),
  standard: Object.freeze({ level: 'standard', effort: 'medium' }),
  deep: Object.freeze({ level: 'deep', effort: 'high' })
})
function profileFor (level = 'fast') {
  if (typeof level !== 'string' || !Object.prototype.hasOwnProperty.call(PROFILES, level)) throw Error('invalid_chat_level')
  return PROFILES[level]
}
function canUseSocialFastPath (message, route, history, opts) {
  if (!Array.isArray(history) || !opts || opts.contextCard || opts.attachSection || opts.sectionPreamble) return false
  // The browser includes the current message in history. Earlier turns can carry
  // pending work, so they keep the full pipeline even when this message is thanks.
  if (history.length && !(history.length === 1 && history[0] && history[0].role === 'user' && history[0].text === message)) return false
  return classifyPureChatEligibility(message, route).eligible === true
}
module.exports = { PROFILES, profileFor, canUseSocialFastPath }
