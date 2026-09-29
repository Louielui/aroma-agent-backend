'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { t } = require('../i18n/t')
function buildHtml () {
  const labels = { title: t('connections.title'), intro: t('connections.intro'), back: t('manager.back'),
    google: t('connections.google'), auth: t('connections.authorize'), manage: t('connections.manage'), authNote: t('connections.authNote'),
    test: t('connections.test'), enable: t('connections.enable'), disable: t('connections.disable'),
    account: t('connections.account'), unknown: t('connections.unknown'), checked: t('connections.checked'), success: t('connections.lastSuccess'),
    scopes: t('connections.scopes'), loading: t('connections.loading'), error: t('connections.error'), masterOff: t('connections.masterOff'),
    scopeNote: t('connections.scopeNote'), authSuccess: t('connections.authSuccess'), authFailed: t('connections.authFailed'),
    authMissing: t('connections.authMissing'), count: t('connections.count'), pending: t('connections.pending'),
    connected: t('connections.connected'), unverified: t('connections.unverified'), stale: t('connections.stale'),
    disabled: t('connections.disabled'), authorization: t('connections.authorization'), permission: t('connections.permission'),
    configuration: t('connections.configuration'), timeout: t('connections.timeout'), failed: t('connections.failed'),
    gmail: t('connections.gmail'), drive: t('connections.drive'), calendar: t('connections.calendar') }
  return fs.readFileSync(path.join(__dirname, 'view.html'), 'utf8').replace('/*LABELS*/', JSON.stringify(labels).replace(/</g, '\\u003c'))
}
module.exports = { buildHtml }
