'use strict'
const fs = require('node:fs'), path = require('node:path')
const { t } = require('../i18n/t')
function driveReply (report) {
  const p = report.pack
  if (p.state !== 'ok') return t('driveContext.error')
  const rows = p.content.slice(0, 10).map(row => t('driveContext.replyItem', { name: row.title || row.sourceId,
    date: row.originalDate || t('live.unknown'), link: row.link || t('live.unknown') })).join('\n')
  return t('driveContext.reply', { source: report.source?.name || t('live.unknown'), count: p.count,
    scope: p.coverage.scope, coverage: p.coverage.complete === true ? t('live.full') : p.coverage.complete === false ? t('live.partial') : t('live.unknown'),
    at: p.retrievedAt, rows: rows || t('live.empty') })
}
function buildDriveContextHtml () {
  const labels = { title: t('driveContext.title'), intro: t('driveContext.intro'), back: t('manager.back'), github: t('live.title'), architecture: t('architecture.title'),
    query: t('driveContext.query'), queryHint: t('driveContext.queryHint'), search: t('driveContext.search'), root: t('driveContext.root'), parent: t('driveContext.parent'),
    idle: t('driveContext.idle'), loading: t('driveContext.loading'), error: t('driveContext.error'), unsupported: t('driveContext.unsupported'),
    list: t('driveContext.list'), openFolder: t('driveContext.openFolder'), read: t('driveContext.read'), metadata: t('driveContext.metadata'),
    empty: t('live.empty'), count: t('live.count'), fetched: t('live.fetched'), original: t('live.original'), unknown: t('live.unknown'),
    details: t('live.details'), scope: t('live.scope'), complete: t('live.complete'), full: t('live.full'), partial: t('live.partial'), truncated: t('live.truncated'),
    source: t('live.source'), originalLink: t('driveContext.originalLink'), text: t('driveContext.text'), textPartial: t('driveContext.textPartial'),
    metadataOnly: t('driveContext.metadataOnly'), revision: t('driveContext.revision'), excluded: t('driveContext.excluded'),
    ownerOnly: t('driveContext.ownerOnly'), dataOnly: t('driveContext.dataOnly'),
    reasons: { unsupported_format: t('driveContext.unsupported'), download_not_allowed: t('driveContext.downloadDenied'), source_revision_unavailable: t('driveContext.revisionUnknown'),
      folder: t('driveContext.folder'), metadata_requested: t('driveContext.metadataOnly') }, audit: t('live.audit'), auditEmpty: t('live.auditEmpty'), auditError: t('live.auditError') }
  return fs.readFileSync(path.join(__dirname, 'driveContextView.html'), 'utf8').replace('/*LABELS*/{}', JSON.stringify(labels).replace(/</g, '\\u003c'))
}
module.exports = { buildDriveContextHtml, driveReply }
