'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { t } = require('../../i18n/t')
function buildManagerHtml () {
  const labels = {
    not_connected: t('manager.notConnected'), read_failed: t('manager.readFailed'),
    master_disabled: t('manager.disabled'), source_disabled: t('manager.disabled'), credential_missing: t('manager.credentialsMissing'),
    governance_disabled: t('manager.governanceDisabled'), not_implemented: t('manager.notImplemented'), registration_failed: t('manager.registrationFailed'),
    followup: t('manager.followup'), followupHelp: t('manager.followupHelp'), followupSaved: t('manager.followupSaved'),
    followupError: t('manager.followupError'), followupExcluded: t('manager.followupExcluded'), newMemory: t('manager.newMemory'),
    correction: t('manager.correction'), approvedAt: t('manager.approvedAt'), memoryId: t('manager.memoryId'),
    decision: t('mem6.decision'), preference: t('mem6.preference'), todo: t('mem6.todo'),
    taskOpen: t('mem6.open'), taskCompleted: t('mem6.completed'),
    subject: t('mem6.subject'), content: t('memory.content'), propose: t('mem6.propose'), review: t('mem6.review'),
    inventory: t('architecture.title'),
    queued: t('workflow.queued'), failed: t('workflow.failed'), cancelled: t('workflow.cancelled'), timed_out: t('workflow.timedOut'),
    interrupted: t('workflow.interrupted'), pending: t('workflow.pending'), not_run: t('workflow.notRun'), ok: t('workflow.readOk'),
    cancel: t('workflow.cancel'), retry: t('workflow.retry'), openRetry: t('workflow.openRetry'),
    cancelNote: t('workflow.cancelNote'), statusFailed: t('workflow.statusFailed'), reload: t('workflow.reload'),
    history: t('workflow.history'), none: t('workflow.none'),
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
      'gmail.admin': t('company.mailBriefing'),
      'aroma.replenishment': t('manager.replenishment'), 'aroma.invoices': t('manager.invoices'),
      'calendar.agenda': t('manager.calendar'), 'drive.documents': t('manager.documents'),
      'local.tasks': t('manager.tasks'), 'local.approvals': t('manager.approvals'), 'memory.decisions': t('manager.approvedContext')
    }
  }
  return fs.readFileSync(path.join(__dirname, 'view.html'), 'utf8')
    .replace('/*LABELS*/', JSON.stringify(labels).replace(/</g, '\\u003c'))
    .replace('/*CLIENT*/', () => fs.readFileSync(path.join(__dirname, 'viewClient.js'), 'utf8'))
}
module.exports = { buildManagerHtml }
