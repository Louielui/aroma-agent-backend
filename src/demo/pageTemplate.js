'use strict'
const SCRIPT_BOUNDARY = '\n;\n'
function assemblePage (p) {
  const parts = {
    '/*INLINE_I18N*/': p.i18n,
    '/*INLINE_CSS*/': p.css + '\n' + p.sidebarCss,
    '/*INLINE_JS*/': SCRIPT_BOUNDARY + p.sidebar + SCRIPT_BOUNDARY + (p.topics || '') + SCRIPT_BOUNDARY + p.app,
    '/*INLINE_DOT*/': p.dot,
    '/*FAVICON_URI*/': p.favicon,
    '/*READ_SOURCE_LABELS*/': JSON.stringify(p.sourceLabels),
    '/*BUILD_STAMP*/': p.buildStamp,
    '/*SUBSCRIPTION_CHAT*/': JSON.stringify(p.subscription)
  }
  let html = p.template
  for (const [key, value] of Object.entries(parts)) {
    if (typeof value !== 'string') throw Error('invalid_page_assets')
    html = html.split(key).join(value)
  }
  for (const key of Object.keys(parts)) if (html.includes(key)) throw Error('invalid_page_assets')
  return html
}
module.exports = { assemblePage, SCRIPT_BOUNDARY }
