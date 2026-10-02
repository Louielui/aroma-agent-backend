'use strict'
const fs = require('node:fs'), path = require('node:path'), { t } = require('../i18n/t')
function gmailReply (report) {
  const p = report.pack
  if (p.state !== 'ok') return t('gmailContext.error')
  const rows = p.content.map(row => t('gmailContext.replyItem', { title: row.title || row.sourceId, id: row.sourceId, from: row.fields.from || t('live.unknown'), date: row.originalDate || t('live.unknown'), link: row.link || t('live.unknown') })).join('\n')
  const reply = t('gmailContext.reply', { mailbox: report.mailbox === 'admin' ? t('gmailContext.admin') : t('gmailContext.owner'), count: p.count, scope: p.coverage.scope, at: p.retrievedAt,
    complete: p.coverage.complete === true ? t('gmailContext.complete') : p.coverage.complete === false ? t('live.partial') : t('live.unknown'), rows: rows || t('gmailContext.empty') })
  const detail = p.operation === 'get' ? p.content[0] : null
  return detail ? reply + '\n\n' + t('gmailContext.replyBody', { complete: detail.fields.originalBodyComplete === true ? t('gmailContext.bodyComplete') : t('gmailContext.bodyPartial'), content: detail.content || t('live.unknown') }) : reply
}
function buildGmailContextHtml () {
  const labels = { title: t('gmailContext.title'), intro: t('gmailContext.intro'), back: t('manager.back'), architecture: t('architecture.title'), owner: t('gmailContext.owner'), admin: t('gmailContext.admin'),
    today: t('calendarContext.today'), unread: t('gmailContext.unread'), latest: t('gmailContext.latest'), list: t('gmailContext.list'), metadata: t('gmailContext.metadata'),
    options: t('gmailContext.options'), query: t('gmailContext.query'), search: t('driveContext.search'), messageId: t('gmailContext.messageId'), get: t('gmailContext.get'),
    keyword: t('gmailContext.keyword'), subject: t('gmailContext.subject'), from: t('gmailContext.from'), idle: t('gmailContext.idle'), loading: t('gmailContext.loading'), error: t('gmailContext.error'), empty: t('gmailContext.empty'),
    count: t('live.count'), fetched: t('live.fetched'), original: t('live.original'), unknown: t('live.unknown'), scope: t('live.scope'), coverage: t('live.complete'),
    complete: t('gmailContext.complete'), partial: t('live.partial'), truncated: t('live.truncated'), source: t('live.source'), details: t('live.details'),
    limits: t('gmailContext.limits'), ownerOnly: t('gmailContext.ownerOnly'), bodyComplete: t('gmailContext.bodyComplete'), bodyPartial: t('gmailContext.bodyPartial'), audit: t('live.audit'), auditEmpty: t('live.auditEmpty'), auditError: t('live.auditError') }
  return fs.readFileSync(path.join(__dirname, 'gmailContextView.html'), 'utf8').replace('/*LABELS*/{}', JSON.stringify(labels).replace(/</g, '\\u003c'))
}
module.exports = { buildGmailContextHtml, gmailReply }
