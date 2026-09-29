'use strict'
const { browserCatalogueSource } = require('../../src/i18n/browserResolver')

// "Authorization" in a compiled interface sentence is prose, not a header.
// Exclude only the exact generated catalogue from that check. Token identifiers
// and Bearer material remain forbidden across the entire page, including labels.
function hasBrowserAuthority (html) {
  return /HUB_TOKEN|Bearer/i.test(html) || /Authorization/i.test(html.replace(browserCatalogueSource(), ''))
}
module.exports = { hasBrowserAuthority }
