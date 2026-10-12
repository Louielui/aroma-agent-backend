'use strict'
const { PROFILES } = require('./contract')
// Keep full, hashed evidence in storage. Only the provider view is excerpted;
// exact original line numbers remain usable by the source citation validator.
const ANCHORS = {
  'src/demo/assets/app.js': /(?:function (?:selectConversation|renderSidebar|loadConversation)|sidebarController|sidebarLabels|(?:manager|driveContext|calendarContext|gmailContext|settings)Btn|open-(?:manager|drive|calendar|gmail)|(?:manager|drive|calendar|gmail)-label|side-search|sideSearch|convsEl)/,
  'src/demo/assets/app.css': /(?:#sidebar|\.convs\b|side-workspace|side-history|side-search|side-foot|#topbar|#main|settings|@media)/
}
function numberedEvidence (evidence) {
  return { ...evidence, files: evidence.files.map(({ content, ...f }) => {
    const lines = content.split('\n'), readOnly = !PROFILES[evidence.profile].includes(f.path)
    const anchor = evidence.profile === 'interface' && readOnly && ANCHORS[f.path]
    const keep = new Set()
    if (anchor) lines.forEach((line, i) => { if (anchor.test(line)) for (let j = Math.max(0, i - 8); j <= Math.min(lines.length - 1, i + 26); j++) keep.add(j) })
    // Empty fixture or future source without anchors stays explicit, not fabricated.
    const excerpt = !!anchor && keep.size > 0 && keep.size < lines.length
    const source = lines.flatMap((line, i) => !excerpt || keep.has(i) ? [(i + 1) + ' | ' + line] : []).join('\n')
    return { ...f, readOnly, excerpt, source }
  }) }
}
module.exports = { numberedEvidence }
