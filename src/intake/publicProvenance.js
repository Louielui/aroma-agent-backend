'use strict'
const { t } = require('../i18n/t')

// The answer formatter may withhold numeric claims. It must not also erase the
// links and evidence age. This adds provenance only, never restores model facts.
function publicProvenance (input) {
  const rows = (input.itemsBySource || []).flatMap(g => g?.source === 'public_knowledge' && Array.isArray(g.items) ? g.items : [])
    .filter(r => r?.trust === 'live' && r.fields?.provider === 'claude_subscription_search' && r.fields?.consulted === true)
  const sources = new Map()
  for (const row of rows) {
    try {
      const url = new URL(row.fields.url)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue
      if (!Number.isFinite(Date.parse(row.retrievedAt))) continue
      const key = JSON.stringify([url.href, row.retrievedAt])
      if (!sources.has(key)) sources.set(key, { url: url.href, at: row.retrievedAt,
        title: String(row.fields.sourceTitle || url.hostname).slice(0, 100).replace(/[\r\n]/g, ' ').replace(/[\\\[\]()*_`<>]/g, '\\$&') })
    } catch (_) { /* malformed provenance cannot become an attribution */ }
  }
  if (!sources.size) return null
  const locale = /[\u3400-\u9fff]/.test(input.message || '') ? 'zh' : 'en'
  return t('publicSearch.replyProvenance', {}, locale) + '\n' + Array.from(sources.values()).slice(0, 5)
    .map(s => `[${s.title}](${s.url}) — ` + t('publicSearch.retrievedAt', { at: s.at }, locale)).join('\n')
}
function publicSummary (input) {
  const groups = (input.itemsBySource || []).filter(g => Array.isArray(g?.items) && g.items.length)
  if (!groups.length || groups.some(g => g.source !== 'public_knowledge')) return null
  const rows = groups.flatMap(g => g.items)
  if (rows.some(r => r?.trust !== 'live' || r.fields?.provider !== 'claude_subscription_search' || r.fields?.contentKind !== 'web_search_cited_summary' || r.fields?.consulted !== true)) return null
  const locale = /[\u3400-\u9fff]/.test(input.message || '') ? 'zh' : 'en'
  const sections = []
  for (const row of rows.slice(0, 5)) {
    if (typeof row.content !== 'string' || !row.content.trim()) continue
    const source = publicProvenance({ ...input, itemsBySource: [{ source: 'public_knowledge', items: [row] }] })
    if (!source) continue
    // Show the observed search summary as an excerpt, not a validated business
    // fact. Model-authored markup/links cannot gain a second attribution channel.
    const excerpt = row.content.trim().slice(0, 800).replace(/[\\\[\]()*_`<>#]/g, '\\$&').replace(/\r?\n/g, '\n> ')
    sections.push('> ' + excerpt + (row.content.trim().length > 800 ? '…' : '') + '\n\n' + source.split('\n').slice(1).join('\n'))
  }
  return sections.length ? t('publicSearch.summaryIntro', {}, locale) + '\n\n' + sections.join('\n\n') : null
}
module.exports = { publicProvenance, publicSummary }
