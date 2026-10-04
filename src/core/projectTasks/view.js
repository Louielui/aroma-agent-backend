'use strict'
const fs = require('node:fs'), path = require('node:path'), { t, currentLocale } = require('../../i18n/t')
function buildHtml () {
  const labels = {
    title: t('projectTask.title'),
    intro: t('projectTask.intro'),
    goal: t('projectTask.goal'),
    criteria: t('projectTask.criteria'),
    scope: t('projectTask.scope'),
    profile: t('projectTask.profile'),
    contextProfile: t('projectTask.contextProfile'),
    interfaceProfile: t('projectTask.interfaceProfile'),
    start: t('projectTask.start'),
    history: t('projectTask.history'),
    refresh: t('projectTask.refresh'),
    approve: t('projectTask.approve'),
    prepare: t('projectTask.prepare'),
    confirm: t('projectTask.confirm'),
    tests: t('projectTask.tests'),
    review: t('projectTask.review'),
    source: t('projectTask.source'),
    cancel: t('projectTask.cancel'),
    uncertain: t('projectTask.uncertain'),
    limits: t('projectTask.limits'),
    work: t('projectTask.work'),
    empty: t('projectTask.empty'),
    login: t('projectTask.login'),
    codingApprove: t('projectTask.codingApprove'),
    queued: t('projectTask.state.queued'),
    reading: t('projectTask.state.reading'),
    drafting: t('projectTask.state.drafting'),
    reviewing: t('projectTask.state.reviewing'),
    awaiting_approval: t('projectTask.state.awaitingApproval'),
    registered: t('projectTask.state.registered'),
    needs_attention: t('projectTask.state.needsAttention'),
    failed: t('projectTask.state.failed'),
    cancelled: t('projectTask.state.cancelled'),
    timed_out: t('projectTask.state.timedOut'),
    interrupted: t('projectTask.state.interrupted')
  }
  return fs.readFileSync(path.join(__dirname, 'view.html'), 'utf8').replace('/*LOCALE*/', currentLocale()).replace('/*LABELS*/', JSON.stringify(labels).replace(/</g, '\\u003c'))
}
module.exports = { buildHtml }
