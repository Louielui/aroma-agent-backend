'use strict'
const { t } = require('../i18n/t')
function mailLabels () {
  return { historyImport: {title:t('mailHistory.title'),scope:t('mailHistory.scope'),snapshot:t('mailHistory.snapshot'),processed:t('mailHistory.processed'),retained:t('mailHistory.retained'),excluded:t('mailHistory.excluded'),partial:t('mailHistory.partial'),range:t('mailHistory.range'),start:t('mailHistory.start'),cancel:t('mailHistory.cancel'),unavailable:t('mailHistory.unavailable'),
    states:{not_started:t('mailHistory.notStarted'),running:t('mailHistory.running'),completed:t('mailHistory.completed'),paused:t('mailAutomation.paused'),cancelled:t('mailHistory.cancelled'),failed:t('mailHistory.failed'),unavailable:t('mailHistory.unavailable')},
    reasons:{excluded:t('mailHistory.sensitive'),body_unavailable:t('company.mailBodyUnavailable'),mail_message_gone:t('mailHistory.gone'),thread_limit:t('mailHistory.threadLimit')}},
    mailIndex:t('mailHistory.index'),mailIndexRetry:t('mailHistory.indexRetry'),mailIndexRebuild:t('mailHistory.indexRebuild'),mailIndexConfigured:t('mailHistory.indexConfigured'),mailIndexRawOnly:t('mailHistory.indexRawOnly'),mailIndexSourceOnly:t('mailHistory.indexSourceOnly'),mailIndexPartial:t('mailHistory.indexPartial'),mailIndexTotal:t('mailHistory.indexTotal'),mailHistoryNewPass:t('mailHistory.newPass'),
    mailIndexRebuildStates:{queued:t('mailHistory.rebuilding'),running:t('mailHistory.rebuilding'),completed:t('mailHistory.rebuiltQueue'),failed:t('mailHistory.failed')},
    mailIndexSourceOnlyReasons:{text_policy_excluded:t('mailHistory.indexPolicyExcluded'),text_too_short:t('mailHistory.indexTooShort'),text_too_long:t('mailHistory.indexTooLong')},
    automation: { title: t('mailAutomation.title'), note: t('mailAutomation.note'), authorize: t('mailAutomation.authorize'),
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
