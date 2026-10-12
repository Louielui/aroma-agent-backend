'use strict'
const express = require('express')
const { t } = require('../i18n/t')
function createImageBodyParser() {
  const parser = express.json({ limit: '9mb' })
  return (req, res, next) => parser(req, res, err => {
    if (!err) return next()
    res.status(err.type === 'entity.too.large' ? 413 : 400).json({ error: { message: t('imageChat.invalid'), retryable: false } })
  })
}
module.exports = { createImageBodyParser }
