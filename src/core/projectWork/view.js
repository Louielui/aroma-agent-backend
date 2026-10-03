'use strict'
const fs = require('node:fs'), path = require('node:path'), { t, currentLocale } = require('../../i18n/t')
function buildHtml () {
  const labels = {
    title: t('projectWork.title'), intro: t('projectWork.intro'), prepare: t('projectWork.prepare'), approve: t('projectWork.approve'), approval: t('projectWork.approval'),
    source: t('projectWork.source'), scope: t('projectWork.scope'), recipe: t('projectWork.recipe'), single: t('projectWork.single'), multi: t('projectWork.multi'), limits: t('projectWork.limits'), history: t('projectWork.history'), before: t('projectWork.before'), after: t('projectWork.after'),
    tests: t('projectWork.tests'), review: t('projectWork.review'), cancel: t('projectWork.cancel'), awaiting_approval: t('projectWork.awaitingApproval'), cancelled: t('projectWork.cancelled'),
    error: t('projectWork.error'), empty: t('projectWork.empty'), details: t('projectWork.details'), result: t('projectWork.result'),
    adoptTitle: t('projectAdoption.title'), adoptIntro: t('projectAdoption.intro'), adopt: t('projectAdoption.prepare'), revert: t('projectAdoption.rollback'),
    adoptApproval: t('projectAdoption.approval'), adoptApprove: t('projectAdoption.approve'), adoptCancel: t('projectAdoption.cancel'),
    adoptHistory: t('projectAdoption.history'), adoptEmpty: t('projectAdoption.empty'), loaded: t('projectAdoption.loaded'), committed: t('projectAdoption.committed'),
    reload: t('projectAdoption.reload'), rollbackNote: t('projectAdoption.rollbackNote'), testing: t('projectAdoption.testing'), applying: t('projectAdoption.applying'),
    awaiting_restart: t('projectAdoption.awaitingRestart'), login: t('projectAdoption.login'), preparing: t('projectAdoption.preparing'),
    queued: t('workerFlow.queued'), checking: t('workerFlow.checking'), coding: t('workerFlow.coding'), reviewing: t('workerFlow.reviewing'),
    completed: t('workerFlow.completed'), failed: t('workerFlow.failed'), interrupted: t('workerFlow.interrupted'), needs_attention: t('workerFlow.needsAttention')
  }
  return fs.readFileSync(path.join(__dirname, 'view.html'), 'utf8').replace('/*LOCALE*/', currentLocale()).replace('/*LABELS*/', JSON.stringify(labels).replace(/</g, '\\u003c'))
}
module.exports = { buildHtml }
