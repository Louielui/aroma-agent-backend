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
module.exports = { guidance, forFiles, systemFor }
