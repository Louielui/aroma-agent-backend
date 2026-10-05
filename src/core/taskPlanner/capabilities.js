'use strict'
const { PROFILES } = require('./contract')
const INSTRUCTION = 'Assess capability for the ENTIRE Owner request before proposing executable work. Do not quietly reduce a new feature to layout changes. Return capability.status supported only when the full goal and all acceptance checks can be achieved through the host-listed editable files and already available mechanisms. Otherwise return unsupported, explain the missing capabilities in plain language, and preserve the original desired outcome. Missing capabilities are not unresolved Owner choices: do not ask the Owner for file paths, code or permissions to solve them. No test drafting or coding will start for an unsupported result. Capability assessment is an opinion, never authority; the host still enforces all paths and approvals.'
function capabilities (profile) {
  return {
    editableFiles: [...PROFILES[profile]],
    allowed: profile === 'interface' ? ['Rearrange existing navigation, menus and sidebar layout', 'Preserve existing destinations and handlers'] : profile === 'chat' ? ['Improve existing chat page layout and browser behavior using existing endpoints'] : ['Repair existing read-only context result and gateway behavior'],
    unavailable: ['New backend routes or durable storage outside the editable files', 'New source connectors or expanded source permissions', 'Changes to read-only dependencies or translation catalogues', 'Production business-data writes, sending mail, automatic adoption or deployment'],
    verification: {
      source: 'Exact editable allowlist and protected before/after file hashes; deterministic Node assertions of requested changes.',
      browser: ['interface', 'chat'].includes(profile) ? 'Fixed candidate Chinese/English desktop/mobile browser cases: navigation reachability, bounds, clipping and hit testing; candidate screenshots and a separate actual-pixel review after coding.' : null,
      unavailable: ['Paired before/after or dark-theme screenshot receipts', 'Arbitrary exact rendered pixel measurements absent from the fixed harness'],
      planningRule: 'Keep acceptance proportional to the Owner request and these actual checks. Do not invent additional acceptance demands or evidence the pipeline cannot produce. Preserve explicit Owner requirements; if those require unavailable verification, report unsupported rather than silently dropping them. A requested CSS declaration value can be tested as a declaration, not claimed as a measured rendered distance. Test drafting describes future checks; actual results only exist after execution.'
    },
    successBoundary: 'The full requested behavior must be implemented and measured; a visual placeholder does not fulfill missing data or workflow capabilities.'
  }
}
module.exports = { capabilities, INSTRUCTION }
