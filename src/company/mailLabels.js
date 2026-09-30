'use strict'
const { t } = require('../i18n/t')
function mailLabels () {
  return { automation: { title: t('mailAutomation.title'), note: t('mailAutomation.note'), authorize: t('mailAutomation.authorize'),
    disconnect: t('mailAutomation.disconnect'), refresh: t('mailAutomation.refresh'), pause: t('mailAutomation.pause'), resume: t('mailAutomation.resume'),
    retry: t('mailAutomation.retry'), events: t('mailAutomation.events'), scheduler: t('mailAutomation.scheduler'),
    catchup: t('mailAutomation.catchup'), balanced: t('mailAutomation.balanced'), next: t('mailAutomation.next'),
    last: t('mailAutomation.last'), quota: t('mailAutomation.quota'), foreground: t('mailAutomation.foreground'), unavailable: t('mailAutomation.unavailable'),
    awaiting: t('mailAutomation.awaiting'), rejected: t('mailAutomation.rejected'),
    reasons: { invalid_payload: t('mailAutomation.invalidPayload'), wrong_mailbox: t('mailAutomation.wrongMailbox'), invalid_history: t('mailAutomation.invalidHistory') },
    states: { not_connected: t('mailAutomation.notConnected'), setup_required: t('mailAutomation.setupRequired'),
      watching: t('mailAutomation.watching'), recovering: t('mailAutomation.recovering'), failed: t('mailAutomation.failed'),
      paused: t('mailAutomation.paused'), active: t('mailAutomation.active') } },
    mailCategories: { all: t('mailTriage.all'), attention: t('mailTriage.attention'), decision: t('mailTriage.decision'),
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
