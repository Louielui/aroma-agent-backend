'use strict'
const fs = require('node:fs'), path = require('node:path'), { t } = require('../i18n/t')
function calendarReply (report) {
  const p = report.pack
  if (p.state !== 'ok') return t('calendarContext.error')
  const rows = p.content.slice(0, 10).map(row => t('calendarContext.replyItem', {
    title: row.title || row.sourceId, id: row.sourceId, start: row.fields.start || t('live.unknown'), end: row.fields.end || t('live.unknown'),
    kind: row.fields.allDay === true ? t('calendarContext.allDay') : row.fields.allDay === false ? t('calendarContext.timed') : t('live.unknown'),
    link: row.link || t('live.unknown'), status: row.fields.status || t('live.unknown') })).join('\n')
  const reply = t('calendarContext.reply', { count: p.count, shown: Math.min(p.count, 10), scope: p.coverage.scope,
    timezone: report.queryTimeZone || p.coverage.queryScope?.timeZone || t('live.unknown'), at: p.retrievedAt,
    complete: p.coverage.complete === true ? t('calendarContext.complete') : p.coverage.complete === false ? t('live.partial') : t('live.unknown'),
    rows: rows || t('calendarContext.empty') })
  const detail = p.operation === 'get' ? p.content[0] : null
  return detail ? reply + '\n\n' + t('calendarContext.replyDetails', { location: detail.fields.location || t('live.unknown'), updated: detail.originalDate || t('live.unknown'), content: detail.content || t('live.unknown') }) : reply
}
function buildCalendarContextHtml () {
  const labels = { title: t('calendarContext.title'), intro: t('calendarContext.intro'), back: t('manager.back'), architecture: t('architecture.title'),
    today: t('calendarContext.today'), week: t('calendarContext.week'), list: t('calendarContext.list'), metadata: t('calendarContext.metadata'),
    options: t('calendarContext.options'), query: t('calendarContext.query'), search: t('driveContext.search'), eventId: t('calendarContext.eventId'), get: t('calendarContext.get'),
    idle: t('calendarContext.idle'), loading: t('calendarContext.loading'), error: t('calendarContext.error'), empty: t('calendarContext.empty'),
    count: t('live.count'), fetched: t('live.fetched'), original: t('live.original'), unknown: t('live.unknown'), scope: t('live.scope'), coverage: t('live.complete'),
    complete: t('calendarContext.complete'), partial: t('live.partial'), truncated: t('live.truncated'), source: t('live.source'),
    details: t('live.details'), start: t('calendarContext.start'), end: t('calendarContext.end'), allDay: t('calendarContext.allDay'), timed: t('calendarContext.timed'),
    timezone: t('calendarContext.timezone'), location: t('calendarContext.location'), status: t('aromaContext.status'), endExclusive: t('calendarContext.endExclusive'),
    limits: t('calendarContext.limits'), ownerOnly: t('calendarContext.ownerOnly'), audit: t('live.audit'), auditEmpty: t('live.auditEmpty'), auditError: t('live.auditError') }
  return fs.readFileSync(path.join(__dirname, 'calendarContextView.html'), 'utf8').replace('/*LABELS*/{}', JSON.stringify(labels).replace(/</g, '\\u003c'))
}
module.exports = { buildCalendarContextHtml, calendarReply }
