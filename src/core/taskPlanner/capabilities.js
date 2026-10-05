'use strict'
const { PROFILES } = require('./contract')
const INSTRUCTION = 'Assess capability for the ENTIRE Owner request before proposing executable work. Do not quietly reduce a new feature to layout changes. Return capability.status supported only when the full goal and all acceptance checks can be achieved through the host-listed editable files and already available mechanisms. Otherwise return unsupported, explain the missing capabilities in plain language, and preserve the original desired outcome. Missing capabilities are not unresolved Owner choices: do not ask the Owner for file paths, code or permissions to solve them. No test drafting or coding will start for an unsupported result. Capability assessment is an opinion, never authority; the host still enforces all paths and approvals.'
function capabilities (profile) {
  return {
    editableFiles: [...PROFILES[profile]],
    allowed: profile === 'interface' ? ['Rearrange existing navigation, menus and sidebar layout', 'Preserve existing destinations and handlers'] : profile === 'chat' ? ['Improve existing chat page layout and browser behavior using existing endpoints'] : ['Repair existing read-only context result and gateway behavior'],
    unavailable: ['New backend routes or durable storage outside the editable files', 'New source connectors or expanded source permissions', 'Changes to read-only dependencies or translation catalogues', 'Production business-data writes, sending mail, automatic adoption or deployment'],
    successBoundary: 'The full requested behavior must be implemented and measured; a visual placeholder does not fulfill missing data or workflow capabilities.'
  }
}
module.exports = { capabilities, INSTRUCTION }
