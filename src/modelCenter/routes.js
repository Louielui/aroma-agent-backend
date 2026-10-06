'use strict'
const express = require('express'), { t } = require('../i18n/t')
function inventory (locale) {
  return [
    { role: t('brain.roleEyes', undefined, locale), selection: t('brain.eyesSelection', undefined, locale), status: t('brain.partial', undefined, locale) },
    { role: t('brain.roleCode', undefined, locale), selection: 'GPT-6.1 Sol', status: t('brain.fixedWorker', undefined, locale) },
    { role: t('brain.roleReview', undefined, locale), selection: 'Claude Sonnet · Medium', status: t('brain.fixedWorker', undefined, locale) },
    { role: t('brain.roleVisual', undefined, locale), selection: 'GPT-6.1 Sol · Medium', status: t('brain.fixedWorker', undefined, locale) },
    { role: t('brain.roleMail', undefined, locale), selection: 'Claude Sonnet · Low', status: t('brain.fixedWorker', undefined, locale) },
    { role: t('brain.roleMemory', undefined, locale), selection: t('brain.memorySelection', undefined, locale), status: t('brain.partial', undefined, locale) },
    { role: t('brain.roleRouting', undefined, locale), selection: t('brain.routingSelection', undefined, locale), status: t('brain.fixedWorker', undefined, locale) }
  ]
}
function createModelCenterRouter ({ center, catalogue }) {
  const router = express.Router()
  router.get('/model-center', (req, res) => res.type('html').send(require('./view').page()))
  router.use('/api/v1/model-center', (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    if (req.method !== 'GET' && (!['127.0.0.1', 'localhost'].includes(req.hostname) || req.get('origin') !== req.protocol + '://' + req.get('host') || req.get('sec-fetch-site') === 'cross-site')) return res.status(403).json({ error: 'origin_rejected' })
    next()
  })
  const handle = fn => async (req, res) => {
    try { res.json({ ok: true, ...await fn(req) }) }
    catch (e) { const known = ['revision_conflict', 'invalid_request', 'invalid_scope', 'invalid_model_selection', 'model_selection_unavailable', 'settings_capacity']; const error = known.includes(e.message) ? e.message : 'model_settings_unavailable'; res.status(error === 'revision_conflict' ? 409 : error === 'model_settings_unavailable' || error === 'model_selection_unavailable' ? 503 : 400).json({ error }) }
  }
  router.get('/api/v1/model-center', handle(async req => {
    const settings = center.read(), models = await catalogue()
    return { revision: settings.revision, brain: settings.brain, models: models.models, billing: models.billing, roles: inventory(req.query.lang), autoFallback: false }
  }))
  router.put('/api/v1/model-center/brain', handle(async req => {
    if (!req.body || Object.keys(req.body).sort().join(',') !== 'effort,model,revision') throw Error('invalid_request')
    const value = await center.saveBrain(req.body); return { revision: value.revision, brain: value.brain }
  }))
  router.get('/api/v1/model-center/selection/:kind/:id', handle(req => ({ selection: center.selection(req.params.kind, req.params.id) })))
  router.put('/api/v1/model-center/selection/:kind/:id', handle(async req => ({ selection: await center.saveSelection(req.params.kind, req.params.id, req.body) })))
  return router
}
module.exports = { createModelCenterRouter, inventory }
