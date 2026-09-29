'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { t } = require('../../i18n/t')
function buildManagerHtml () {
  const labels = {
    title: t('manager.title'), intro: t('manager.intro'), run: t('manager.run'), back: t('manager.back'),
    idle: t('manager.idle'), running: t('manager.running'), completed: t('manager.completed'), partial: t('manager.partial'), unavailable: t('manager.unavailable'),
    audit: t('manager.audit'), architecture: t('manager.architecture'), emptyAudit: t('manager.emptyAudit'), failedAudit: t('manager.failedAudit'),
    limited: t('manager.limited'), empty: t('manager.empty'), unknown: t('manager.unknown'), checked: t('manager.checked'),
    source: t('manager.source'), sample: t('manager.sample'), count: t('manager.count'), untitled: t('manager.untitled'),
    busy: t('manager.busy'), auditBlocked: t('manager.auditBlocked'), details: t('manager.details'),
    truth: t('manager.truth'), knowledge: t('manager.knowledge'), memory: t('manager.memory'),
    scope: t('manager.scope'), dataAsOf: t('manager.dataAsOf'), received: t('manager.received'), reason: t('manager.reason'),
    noModel: t('manager.noModel'), planned: t('manager.planned'), approval: t('manager.approval'), memoryNote: t('manager.memoryNote'),
    tools: {
      'aroma.replenishment': t('manager.replenishment'), 'aroma.invoices': t('manager.invoices'),
      'calendar.agenda': t('manager.calendar'), 'drive.documents': t('manager.documents'),
      'local.tasks': t('manager.tasks'), 'local.approvals': t('manager.approvals'), 'memory.decisions': t('manager.decisions')
    }
  }
  return fs.readFileSync(path.join(__dirname, 'view.html'), 'utf8')
    .replace('/*LABELS*/', JSON.stringify(labels).replace(/</g, '\\u003c'))
    .replace('/*CLIENT*/', () => fs.readFileSync(path.join(__dirname, 'viewClient.js'), 'utf8'))
}
module.exports = { buildManagerHtml }
