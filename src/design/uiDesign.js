'use strict'
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto')
// Fixed host-owned guidance, not caller-supplied skill paths or execution authority.
const root = path.join(__dirname, '../../skills/xiangxiang-ui-design')
const instructions = ['SKILL.md', 'references/design-system.md'].map(n => fs.readFileSync(path.join(root, n), 'utf8').replace(/\r\n/g, '\n')).join('\n\n')
const hash = createHash('sha256').update(instructions).digest('hex')
const receipt = Object.freeze({ id: 'xiangxiang-ui-design', version: 1, hash })
function guidance (profile) { return ['interface', 'chat'].includes(profile) ? { ...receipt, receipt, instructions } : null }
function forFiles (files) {
  if (!Array.isArray(files) || !files.length || new Set(files).size !== files.length) return null
  const profiles = { interface: ['src/demo/assets/sidebar.js', 'src/demo/assets/sidebar.css'], chat: ['src/demo/assets/index.html', 'src/demo/assets/app.js', 'src/demo/assets/app.css'] }
  return guidance(Object.keys(profiles).find(k => files.every(f => profiles[k].includes(f))))
}
function systemFor (system, profile) { const g = guidance(profile); return g ? system + '\nHost-owned UI design guidance (no additional authority):\n' + g.instructions : system }
// The design guide describes the complete delivery, while this stage only drafts
// and reviews tests. Keep future evidence obligations out of the pre-code gate.
const TEST_DRAFT_STAGE = 'Current host stage: protected test draft, BEFORE implementation or execution. Apply the design guidance as coverage requirements for future execution, not as evidence already available. Do not request completed screenshots or executed test results at this stage. The existing offline browser harness produces candidate desktop/mobile Chinese/English screenshots; actual-pixel review remains mandatory after implementation and failure or missing evidence blocks completion. It does not produce paired before/after screenshots, dark-theme screenshots, or arbitrary numeric geometry assertions. Do not invent these receipts: custom pixel measurements require explicit harness coverage. Reject uncovered behavior even when later visual review is available. CSS declaration checks prove declarations only. For a CSS-only request, test the changed declaration and meaningful preserved invariants; do not rebuild unrelated application behavior or embed the entire stylesheet as a brittle snapshot. A passing draft review authorizes only the next stage, never completion or deployment.'
function testDraftSystem (system, profile) { return systemFor(system, profile) + '\n' + TEST_DRAFT_STAGE }
module.exports = { guidance, forFiles, systemFor, testDraftSystem, TEST_DRAFT_STAGE }
