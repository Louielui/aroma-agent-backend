'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { t } = require('../i18n/t')
function testLabel (state) {
  switch (state) {
    case 'not_published': return t('live.testsAbsent')
    case 'published_success': return t('live.testsSuccess')
    case 'failed': return t('live.testsFailed')
    case 'pending': return t('live.testsPending')
    case 'incomplete': return t('live.testsIncomplete')
    default: return t('live.testsUnavailable')
  }
}
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) ? value.slice(0, 7) : t('live.unknown')
function developmentReply (report) {
  return t('live.reply', { repository: report.repository || t('live.unknown'), branch: report.branch || t('live.unknown'),
    remote: sha(report.remoteCommit), deployed: sha(report.runtime?.deployedCommit), running: sha(report.runtime?.bootCommit),
    tests: testLabel(report.tests?.state), count: Number.isInteger(report.counts?.pullRequests) ? report.counts.pullRequests : t('live.unknown'),
    retrievedAt: report.retrievedAt || t('live.unknown') })
}
function buildLiveContextHtml () {
  const labels = { title: t('live.title'), intro: t('live.intro'), back: t('manager.back'), drive: t('driveContext.title'), refresh: t('live.refresh'), idle: t('live.idle'), loading: t('live.loading'), error: t('live.error'),
    versions: t('live.versions'), remote: t('live.remote'), deployed: t('live.deployed'), running: t('live.running'), restart: t('live.restart'), architecture: t('architecture.title'),
    tests: t('live.tests'), testsAbsent: t('live.testsAbsent'), testsSuccess: t('live.testsSuccess'), testsFailed: t('live.testsFailed'), testsPending: t('live.testsPending'), testsIncomplete: t('live.testsIncomplete'), testsUnavailable: t('live.testsUnavailable'),
    metadata: t('live.metadata'), commits: t('live.commits'), pullRequests: t('live.pullRequests'), checks: t('live.checks'), statuses: t('live.statuses'),
    source: t('live.source'), fetched: t('live.fetched'), original: t('live.original'), scope: t('live.scope'), count: t('live.count'), complete: t('live.complete'),
    partial: t('live.partial'), unavailable: t('live.unavailable'), empty: t('live.empty'), unknown: t('live.unknown'), cached: t('live.cached'), fresh: t('live.fresh'),
    details: t('live.details'), publicOnly: t('live.publicOnly'), audit: t('live.audit'), auditEmpty: t('live.auditEmpty'), auditError: t('live.auditError'), full: t('live.full'), truncated: t('live.truncated') }
  return fs.readFileSync(path.join(__dirname, 'liveContextView.html'), 'utf8').replace('/*LABELS*/{}', JSON.stringify(labels).replace(/</g, '\\u003c'))
}
module.exports = { buildLiveContextHtml, developmentReply, testLabel }
