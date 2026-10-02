'use strict'

// Chat choices are a host allowlist, not arbitrary provider/execution settings.
// The account catalogue still decides which of these choices is available.
const DEFAULT_MODEL = 'gpt-6-astra'
const CHAT_MODELS = Object.freeze([
  Object.freeze({ model: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', noteKey: 'provider.solLatestNote' }),
  Object.freeze({ model: 'gpt-6-astra', name: 'GPT-6 Astra', noteKey: 'provider.astraNote' }),
  Object.freeze({ model: 'gpt-6-luna', name: 'GPT-6 Luna', noteKey: 'provider.lunaNote' }),
  Object.freeze({ model: 'gpt-6-sol', name: 'GPT-6 Sol', noteKey: 'provider.solPreviousNote' })
])
function isChatModel (value) { return typeof value === 'string' && CHAT_MODELS.some(item => item.model === value) }
module.exports = { DEFAULT_MODEL, CHAT_MODELS, isChatModel }
