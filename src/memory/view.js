'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { t } = require('../i18n/t')
function buildMemoryHtml () {
  const labels = { title: t('memory.title'), intro: t('memory.intro'), save: t('memory.save'), edit: t('memory.edit'), forget: t('memory.forget'), back: t('manager.back'),
    loading: t('memory.loading'), connected: t('memory.connected'), unavailable: t('memory.unavailable'), saved: t('memory.saved'), forgotten: t('memory.forgotten'),
    unconfirmed: t('memory.unconfirmed'), empty: t('memory.empty'), content: t('memory.content'), cancel: t('memory.cancel'), confirm: t('memory.confirm'), limit: t('memory.limit') }
  return fs.readFileSync(path.join(__dirname, 'view.html'), 'utf8').replace('/*LABELS*/', JSON.stringify(labels).replace(/</g, '\\u003c'))
}
module.exports = { buildMemoryHtml }
