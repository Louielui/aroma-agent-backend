'use strict'
const { t } = require('../i18n/t')

// Owner-facing outcomes; model instructions stay in context.js.
function missingRecallReply(context) {
  if (!context || context.state !== 'ok') return t('memory.unavailable')
  if (context.count === 0) return t('memory.noMatchingRecall')
  return null
}
module.exports = { missingRecallReply }
