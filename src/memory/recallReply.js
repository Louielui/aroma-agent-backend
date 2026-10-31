'use strict'
const { t } = require('../i18n/t')

// Owner-facing outcomes; model instructions stay in context.js.
function missingRecallReply(context, question = null) {
  const clarification = typeof question === 'string' && question.trim() ? question.trim() : t('memory.recallClarification')
  if (!context || context.state !== 'ok') return t('memory.unavailable') + '\n\n' + clarification
  if (context.count === 0) return t('memory.noMatchingRecall') + '\n\n' + clarification
  return null
}
function withMemoryFailureNotice(result, failures) {
  if (!result || result.blocked || !failures?.size) return result
  const prefix = t('context.memoryUnavailable') + '\n\n'
  return { ...result, contextFailures: [...failures], reply: prefix + (result.reply || ''),
    ...(typeof result.replyForArchive === 'string' ? { replyForArchive: prefix + result.replyForArchive } : {}) }
}
module.exports = { missingRecallReply, withMemoryFailureNotice }
