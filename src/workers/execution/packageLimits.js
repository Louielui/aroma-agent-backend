'use strict'
// Larger bounds apply only to the two existing chat-page files, not arbitrary paths.
const LIMITS = Object.freeze({ 'src/demo/assets/app.js': 240000, 'src/i18n/catalogue.js': 600000 })
const fileLimit = name => Object.hasOwn(LIMITS, name) ? LIMITS[name] : 100000
module.exports = { fileLimit }
