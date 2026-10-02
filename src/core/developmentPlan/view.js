'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { t } = require('../../i18n/t')
function buildHtml () {
  const labels = { title: t('plan.title'), intro: t('plan.intro'), back: t('manager.back'), architecture: t('architecture.title'), start: t('plan.start'), cancel: t('workflow.cancel'), refresh: t('live.refresh'), loading: t('live.loading'), idle: t('plan.idle'), error: t('plan.error'), quota: t('plan.quota'), login: t('diag.subscriptionLogin'), proposal: t('plan.proposal'), scope: t('plan.scope'), evidence: t('plan.evidence'), checks: t('plan.checks'), questions: t('plan.questions'), timeline: t('plan.timeline'), history: t('plan.history'), detail: t('live.details'), verified: t('plan.verified'), changed: t('plan.changed'), memory: t('plan.memory'),
    queued: t('workflow.queued'), running: t('plan.running'), completed: t('plan.completed'), failed: t('workflow.failed'), cancelled: t('workflow.cancelled'), timed_out: t('workflow.timedOut'), interrupted: t('workflow.interrupted'), needs_attention: t('plan.attention') }
  return fs.readFileSync(path.join(__dirname, 'view.html'), 'utf8').replace('/*LABELS*/{}', JSON.stringify(labels).replace(/</g, '\u003c'))
}
module.exports = { buildHtml }
