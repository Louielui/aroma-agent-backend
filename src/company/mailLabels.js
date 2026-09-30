'use strict'
const { t } = require('../i18n/t')
function mailLabels () {
  return { mailCategories: { all: t('mailTriage.all'), attention: t('mailTriage.attention'), decision: t('mailTriage.decision'),
    follow_up: t('mailTriage.followUp'), notification: t('mailTriage.notification'), promotion: t('mailTriage.promotion'), unknown: t('mailTriage.unknown') },
  mailChanges: { reply: t('mailTriage.reply'), correction: t('mailTriage.correction'), cancellation: t('mailTriage.cancellation') },
  mailAnalyze: t('mailTriage.analyze'), mailAnalyzeBatch: t('mailTriage.analyzeBatch'), mailAnalysisNote: t('mailTriage.note'),
  mailAnalysisPending: t('mailTriage.pending'), mailAnalysisReady: t('mailTriage.ready'), mailAnalysisFailed: t('mailTriage.failed'),
  mailAnalysisPartial: t('mailTriage.partial'), mailSuggestion: t('mailTriage.suggestion'), mailCitation: t('mailTriage.citation'),
  mailFilter: t('mailTriage.filter'), mailBriefingReview: t('mailTriage.review'), mailAnalysisStale: t('mailTriage.stale'),
  mailAssignee: t('company.mailMemoryAssignee'), mailDeadline: t('company.mailMemoryDeadline'),
  mailMemoryNeedsReview: t('company.mailMemoryNeedsReview'), mailMemoryApproved: t('company.mailMemoryApproved'),
  mailMemoryCandidate: t('company.mailMemoryCandidate'), mailMemoryRejected: t('company.mailMemoryRejected') }
}
module.exports = { mailLabels }
