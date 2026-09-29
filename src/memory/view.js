'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { t } = require('../i18n/t')
function buildMemoryHtml ({ governed = false } = {}) {
  const labels = { title: t('memory.title'), intro: t('memory.intro'), save: t('memory.save'), edit: t('memory.edit'), forget: t('memory.forget'), back: t('manager.back'),
    loading: t('memory.loading'), connected: t('memory.connected'), unavailable: t('memory.unavailable'), saved: t('memory.saved'), forgotten: t('memory.forgotten'),
    unconfirmed: t('memory.unconfirmed'), empty: t('memory.empty'), content: t('memory.content'), cancel: t('memory.cancel'), confirm: t('memory.confirm'), limit: t('memory.limit'),
    autoTitle: t('memory.autoTitle'), autoIntro: t('memory.autoIntro'), autoPending: t('memory.autoPending'), autoProcessing: t('memory.autoProcessing'), autoSaved: t('memory.autoSaved'), autoUnconfirmed: t('memory.autoUnconfirmed'), autoSkipped: t('memory.autoSkipped'), autoEdited: t('memory.autoEdited'), autoForgotten: t('memory.autoForgotten'), autoPaused: t('memory.autoPaused'), autoDisabled: t('memory.autoDisabled'), autoOptOut: t('memory.autoOptOut'), autoSensitive: t('memory.autoSensitive'), autoTooLong: t('memory.autoTooLong'), autoInterrupted: t('memory.autoInterrupted'), autoUnknown: t('memory.autoUnknown'), autoConversation: t('memory.autoConversation'), autoBriefing: t('memory.autoBriefing'), autoFacts: t('memory.autoFacts'), autoSource: t('memory.autoSource'), autoNoSource: t('memory.autoNoSource'), autoRetry: t('memory.autoRetry'), autoError: t('memory.autoError'), autoOn: t('memory.autoOn'), autoPause: t('memory.autoPause'), autoResume: t('memory.autoResume'), autoUpdated: t('memory.autoUpdated'), autoSearchLabel: t('memory.autoSearchLabel'), autoSearch: t('memory.autoSearch'), autoHistory: t('memory.autoHistory'), autoNoResults: t('memory.autoNoResults') }
  if (governed) Object.assign(labels, { intro: t('mem6.legacyIntro'), autoIntro: t('mem6.queueIntro'), connected: t('mem6.canonicalConnected'), saved: t('mem6.canonicalSaved'), forget: t('mem6.archive'), forgotten: t('mem6.removed'), confirm: t('mem6.removeConfirm') })
  return fs.readFileSync(path.join(__dirname, 'view.html'), 'utf8').replace('/*LABELS*/', JSON.stringify(labels).replace(/</g, '\\u003c')).replace('/*CAPTURE_SCRIPT*/', () => fs.readFileSync(path.join(__dirname, 'captureClient.js'), 'utf8'))
}
module.exports = { buildMemoryHtml }
