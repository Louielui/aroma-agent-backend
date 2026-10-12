'use strict'
const fs = require('node:fs'), path = require('node:path')
function page () {
  return fs.readFileSync(path.join(__dirname, 'view.html'), 'utf8').split('/*I18N*/').join(require('../i18n/browserResolver').browserI18nSource()).split('/*CLIENT*/').join(fs.readFileSync(path.join(__dirname, 'client.js'), 'utf8'))
}
module.exports = { page }
