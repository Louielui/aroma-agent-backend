'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { t, currentLocale } = require('../../i18n/t')
function buildWorkerHtml () {
  const labels = {
    title: t('workerFlow.title'), intro: t('workerFlow.intro'), check: t('workerFlow.check'), run: t('workerFlow.run'), approval: t('workerFlow.approval'),
    scope: t('workerFlow.scope'), billing: t('workerFlow.billing'), workOrder: t('workerFlow.workOrder'), goal: t('workerFlow.goal'),
    back: t('manager.back'), architecture: t('architecture.title'), history: t('workerFlow.history'), empty: t('workerFlow.empty'),
    evidence: t('workerFlow.evidence'), before: t('workerFlow.before'), after: t('workerFlow.after'), tests: t('workerFlow.tests'), review: t('workerFlow.review'),
    testCount: t('workerFlow.testCount'),
    unknown: t('manager.unknown'), ready: t('workerFlow.ready'), unavailable: t('workerFlow.unavailable'), disabled: t('workerFlow.disabled'),
    queued: t('workerFlow.queued'), checking: t('workerFlow.checking'), coding: t('workerFlow.coding'), reviewing: t('workerFlow.reviewing'),
    completed: t('workerFlow.completed'), needs_attention: t('workerFlow.needsAttention'), failed: t('workerFlow.failed'), interrupted: t('workerFlow.interrupted'),
    elapsed: t('workerFlow.elapsed'), details: t('manager.details'), retry: t('workerFlow.retry'), isolation: t('isolation.title'), isolationPending: t('isolation.pending'), isolationReady: t('isolation.ready'), isolationNotice: t('isolation.notice'), isolationRestart: t('isolation.restart'), isolationCli: t('isolation.cli'), isolationVirtualization: t('isolation.virtualization'), isolationRecovery: t('isolation.recovery')
  }
  return fs.readFileSync(path.join(__dirname, 'view.html'), 'utf8').replace('/*LOCALE*/', currentLocale())
    .replace('/*LABELS*/', JSON.stringify(labels).replace(/</g, '\\u003c'))
}
module.exports = { buildWorkerHtml }
