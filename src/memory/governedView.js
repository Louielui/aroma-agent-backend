'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { t } = require('../i18n/t')
function buildHtml() {
  const labels = {
    title: t('mem6.title'), intro: t('mem6.intro'), back: t('manager.back'), architecture: t('master.checklist'), legacy: t('mem6.legacy'),
    all: t('mem6.all'), type: t('mem6.type'), scope: t('mem6.scope'), status: t('mem6.status'), source: t('mem6.source'),
    subject: t('mem6.subject'), content: t('memory.content'), propose: t('mem6.propose'), approve: t('mem6.approve'), reject: t('mem6.reject'),
    archive: t('mem6.archive'), revise: t('mem6.revise'), index: t('mem6.index'), audit: t('mem6.audit'), refresh: t('mem6.refresh'),
    search: t('memory.autoSearch'), query: t('mem6.query'), loading: t('memory.loading'), error: t('mem6.error'), done: t('mem6.done'),
    confirm: t('mem6.confirm'), reflection: t('mem6.reflection'), reflect: t('mem6.reflect'), evidence: t('mem6.evidence'),
    link: t('mem6.link'), version: t('mem6.version'), grants: t('mem6.grants'), agent: t('mem6.agent'), grant: t('mem6.grant'),
    working: t('mem6.working'), episodic: t('mem6.episodic'), semantic: t('mem6.semantic'), decision: t('mem6.decision'),
    procedural: t('mem6.procedural'), preference: t('mem6.preference'), candidate: t('mem6.candidate'), active: t('mem6.active'),
    temporary: t('mem6.temporary'), superseded: t('mem6.superseded'), archived: t('mem6.archived'), ignored: t('mem6.ignored'), rejected: t('mem6.rejected'),
    goal: t('mem6.goal'), project: t('mem6.project'), worker: t('mem6.worker'), run: t('mem6.run'), createWork: t('mem6.createWork'),
    finish: t('mem6.finish'), noResults: t('mem6.noResults'), totals: t('mem6.totals'), sourceDate: t('mem6.sourceDate'),
    noConfidence: t('mem6.noConfidence'), indexes: t('mem6.indexes'), usage: t('mem6.usage'), exception: t('mem6.exception'),
    outcome: t('mem6.outcome'), recordUsage: t('mem6.recordUsage'), stale: t('mem6.stale'), backup: t('mem6.backup'),
    revoke: t('mem6.revoke'), more: t('mem6.more'), connected: t('mem6.connected'), unavailable: t('mem6.unavailable'),
    pending: t('mem6.pending'), unconfirmed: t('mem6.unconfirmed'), saved: t('mem6.saved'), loaded: t('mem6.loaded')
  }
  return fs.readFileSync(path.join(__dirname, 'governedView.html'), 'utf8').replace('/*LABELS*/', JSON.stringify(labels).replace(/</g, '\\u003c'))
}
module.exports = { buildHtml }
