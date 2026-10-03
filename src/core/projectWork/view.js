'use strict'
const fs = require('node:fs'), path = require('node:path'), { t, currentLocale } = require('../../i18n/t')
function buildHtml () {
  const labels = {
    title: t('projectWork.title'), intro: t('projectWork.intro'), prepare: t('projectWork.prepare'), approve: t('projectWork.approve'), approval: t('projectWork.approval'),
    source: t('projectWork.source'), scope: t('projectWork.scope'), limits: t('projectWork.limits'), history: t('projectWork.history'), before: t('projectWork.before'), after: t('projectWork.after'),
    tests: t('projectWork.tests'), review: t('projectWork.review'), cancel: t('projectWork.cancel'), awaiting_approval: t('projectWork.awaitingApproval'), cancelled: t('projectWork.cancelled'),
    error: t('projectWork.error'), empty: t('projectWork.empty'), details: t('projectWork.details'), result: t('projectWork.result'),
    queued: t('workerFlow.queued'), checking: t('workerFlow.checking'), coding: t('workerFlow.coding'), reviewing: t('workerFlow.reviewing'),
    completed: t('workerFlow.completed'), failed: t('workerFlow.failed'), interrupted: t('workerFlow.interrupted'), needs_attention: t('workerFlow.needsAttention')
  }
  return fs.readFileSync(path.join(__dirname, 'view.html'), 'utf8').replace('/*LOCALE*/', currentLocale()).replace('/*LABELS*/', JSON.stringify(labels).replace(/</g, '\\u003c'))
}
module.exports = { buildHtml }
