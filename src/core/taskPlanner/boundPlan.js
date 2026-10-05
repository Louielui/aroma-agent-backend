'use strict'
const { t } = require('../../i18n/t')
// A closed acknowledgement grammar binds to one displayed host job. Additional
// targets, quoted text, conditions and negations still require interpretation.
const confirmation = s => typeof s === 'string' && /^(?:(?:好|好的|很好|可以|確認|同意)[,，、!！\s]*(?:可以|並|就)?(?:開始|執行|開始改良|開始執行)|(?:請)?(?:開始|執行)|(?:好[,，\s]*)?(?:請)?照(?:這個|這份|剛才的)方案(?:做|開始)|(?:(?:yes|okay|ok)[,!\s]*)?(?:please\s+)?(?:go ahead|confirm and start|start|proceed)(?: please)?)(?:吧)?[.!。！\s]*$/iu.test(s.trim())
function status (run, language) {
  const e = run.execution
  if (e) {
    if (['queued', 'reading', 'drafting', 'checking', 'coding', 'reviewing'].includes(e.state)) return t('confirmedWork.running', undefined, language)
    if (e.state === 'completed') return t('confirmedWork.completed', undefined, language)
    if (e.state === 'cancelled') return t('workActivity.cancelled', undefined, language)
    if (['worker_timeout', 'timed_out'].includes(e.reason)) return t('confirmedWork.timeout', undefined, language)
    if (e.reason === 'review_changes_requested') return t('confirmedWork.reviewBlocked', undefined, language)
    if (e.reason === 'subscription_limit_reached') return t('confirmedWork.limit', undefined, language)
    if (['claude_unavailable', 'claude_max_turns', 'subscription_login_required'].includes(e.reason)) return t('confirmedWork.reviewerUnavailable', undefined, language)
    return t('confirmedWork.unconfirmed', undefined, language)
  }
  if (run.state === 'out_of_scope' || run.result?.capability?.status === 'unsupported') return t('taskPlan.outOfScope', undefined, language) + '\n' + (run.result?.capability?.explanation || '')
  if (run.executionStale) return t('confirmedWork.changed', undefined, language)
  if (['queued', 'running'].includes(run.state)) return t('taskPlan.alreadyStarted', undefined, language)
  if (run.state === 'needs_clarification') return t('taskPlan.answerQuestions', undefined, language)
  if (run.state === 'timed_out') return t('confirmedWork.timeout', undefined, language)
  if (run.state === 'cancelled') return t('workActivity.cancelled', undefined, language)
  if (run.state !== 'completed') return t('confirmedWork.stopped', undefined, language)
  if (run.registrationPreparation || run.preparation || run.taskRunId || run.workRunId) return t('dialogue.existing', undefined, language)
  return t('taskPlan.executionUnavailable', undefined, language)
}
module.exports = { confirmation, status }
