'use strict'
function sourceOnlyReason(value) {
  if (value.trim().length <= 1) return 'text_too_short'
  if (value.length > 32000) return 'text_too_long'
  return null
}
module.exports = { sourceOnlyReason }
