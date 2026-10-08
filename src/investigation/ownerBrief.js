'use strict'

const { t } = require('../i18n/t')
function reasonText (reason, locale) {
  switch (reason) {
    case 'source_dirty': return t('investigation.briefReasonDirty', {}, locale)
    case 'source_changed': return t('investigation.briefReasonChanged', {}, locale)
    case 'timeout': case 'timed_out': return t('investigation.briefReasonTimeout', {}, locale)
    default: return t('investigation.briefReasonOther', {}, locale)
  }
}

// Presentation only: retain complete receipts and detailed prose in the saved
// report. The brief never reads, selects sources, upgrades grades or proves repair.
function ownerBrief (report, { message = '', findings } = {}) {
  if (report?.readOnly !== true || report.continuity || report.evidenceModel?.contradictions?.length ||
      report.contradictions?.length || findings?.kind !== 'work_failure' || !findings.references?.length) return null
  // A broader external enquiry can contribute facts beyond the failed-work
  // receipt. Keep its reviewed answer rather than silently hiding those facts.
  if (report.crossSourceReads?.some(r => r.scope !== 'exact_target_source_revision_not_repair_proof')) return null
  const locale = /[\u3400-\u9fff]/.test(message) ? 'zh' : 'en'
  const ref = findings.references[0]
  const sections = report.sections.filter(s => s.sourceId === ref.sourceId && ['ok', 'partial'].includes(s.state))
  const rows = sections.length === 1 ? sections[0].records.filter(r => r.sourceId === ref.recordId) : []
  if (rows.length !== 1 || rows[0].reason !== ref.fields.reason || rows[0].state !== 'failed') return null
  const reason = reasonText(rows[0].reason, locale)
  const lines = [t('investigation.ownerFailure', { reason }, locale), t('investigation.ownerRepairUnknown', {}, locale)]
  if (report.workCorrelation?.operationRecovery === 'CONFIRMED') lines.push(t('investigation.ownerPrerequisiteRecovered', {}, locale))
  const reads = report.crossSourceReads || []
  if (reads.some(r => r.scope === 'exact_target_source_revision_not_repair_proof')) {
    lines.push(reads.some(r => r.state === 'sampled') ? t('investigation.ownerRevisionRead', {}, locale) : t('investigation.ownerRevisionUnavailable', {}, locale))
  }
  if (report.routing?.unmappedFacts?.length || findings.otherSourcesNotVerified) lines.push(t('investigation.ownerMissingSource', {}, locale))
  lines.push(t('investigation.ownerRecommendation', {}, locale))
  return { text: lines.join('\n\n'), references: findings.references, kind: 'source_bound_owner_brief', locale, modelProseUsed: false }
}

module.exports = { ownerBrief }
