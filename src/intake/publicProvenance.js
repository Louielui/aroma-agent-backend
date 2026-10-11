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
        title: cleanText(String(row.fields.sourceTitle || url.hostname).slice(0, 100)) })
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
  if (rows.some(r => r?.trust !== 'live' || r.fields?.provider !== 'claude_subscription_search' || !['web_search_cited_summary','publisher_cited_summary'].includes(r.fields?.contentKind) || r.fields?.consulted !== true)) return null
  const locale = /[\u3400-\u9fff]/.test(input.message || '') ? 'zh' : 'en'
  if(rows.every(r=>r.fields.sourceEvidence))return composedSummary(rows,input,locale)
  const sections = []
  for (const row of rows.slice(0, 5)) {
    if (typeof row.content !== 'string' || !row.content.trim()) continue
    const source = publicProvenance({ ...input, itemsBySource: [{ source: 'public_knowledge', items: [row] }] })
    if (!source) continue
    // Show the observed search summary as an excerpt, not a validated business
    // fact. Model-authored markup/links cannot gain a second attribution channel.
    const excerpt = cleanText(row.content.trim().slice(0, 800)).replace(/\r?\n/g, '\n> ')
    sections.push('> ' + excerpt + (row.content.trim().length > 800 ? '…' : '') + '\n\n' + source.split('\n').slice(1).join('\n'))
  }
  return sections.length ? t('publicSearch.summaryIntro', {}, locale) + '\n\n' + sections.join('\n\n') : null
}
function cleanText(text){return String(text||'').replace(/\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/[\\\[\]*_`<>#]/g,'').replace(/\r/g,'')}
function localTime(value,locale){return /^\d{4}-\d{2}-\d{2}$/.test(value)?value:Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat(locale==='zh'?'zh-TW':'en-CA',{timeZone:'America/Winnipeg',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value))+' (Winnipeg)':null}
function timeLabel(kind,locale){if(kind==='observation')return t('publicSearch.observationTime',{},locale);if(kind==='forecast')return t('publicSearch.forecastTime',{},locale);if(kind==='publication')return t('publicSearch.publicationTime',{},locale);return t('publicSearch.updateTime',{},locale)}
function composedSummary(rows,input,locale){
 if(rows.some(r=>r.fields.sourceEvidence.language!==locale))return t('publicSearch.languageUnavailable',{},locale)
 const primary=rows.filter(r=>r.fields.contentKind==='publisher_cited_summary'&&r.fields.sourceEvidence.kind==='publisher_page'&&/^[a-f0-9]{64}$/.test(r.fields.sourceEvidence.hash||''))
 const insufficient=rows.some(r=>r.fields.sourceEvidence.answerState==='insufficient')
 const lead=insufficient?t('publicSearch.insufficient',{},locale):rows.slice(0,3).map(r=>'- '+cleanText(r.content)).join('\n')
 const note=primary.length===rows.length?t('publicSearch.primaryIntro',{},locale):t('publicSearch.summaryShort',{},locale)
 const times=Array.from(new Map(primary.flatMap(r=>(r.fields.sourceEvidence.times||[]).filter(v=>['observation','forecast','publication'].includes(v.kind)).map(v=>[v.kind+v.value,v]))).values())
 const timing=times.map(v=>timeLabel(v.kind,locale)+': '+localTime(v.value,locale)).join('\n')
 const stale=primary.some(r=>r.fields.sourceEvidence.freshness==='stale_observation'),unknown=!times.length
 const limits=stale?t('publicSearch.stale',{},locale):unknown?t('publicSearch.timeUnknown',{},locale):t('publicSearch.observationLimit',{},locale)
 const sources=Array.from(new Map(rows.map(r=>[r.fields.url,r])).values())
 const links=t('publicSearch.sources',{},locale)+'\n'+sources.map(r=>`[${cleanText(r.fields.sourceTitle||new URL(r.fields.url).hostname)}](${r.fields.url})`).join('\n')+'\n'+t('publicSearch.queryTime',{},locale)+': '+localTime(rows[0].retrievedAt,locale)
 const omitted=rows.some(r=>r.fields.sourceEvidence.omitted>0)?t('publicSearch.omitted',{},locale):null
 const details=rows.map(r=>{
  const e=r.fields.sourceEvidence,kind=e.kind==='publisher_page'?t('publicSearch.primaryQuote',{},locale):t('publicSearch.searchQuote',{},locale)
  const quote='> '+cleanText(e.quote).replace(/\n/g,'\n> ')
  const dates=(e.times||[]).map(v=>timeLabel(v.kind,locale)+': '+localTime(v.value,locale)).join('\n')
  const failed=(e.pageChecks||[]).filter(c=>c.state!=='read').map(c=>cleanText(c.url)+' — '+t('publicSearch.sourceUnavailable',{},locale)).join('\n')
  const readAt=localTime(e.readAt,locale)
  return [kind,quote,dates,readAt?t('publicSearch.pageReadTime',{},locale)+': '+readAt:null,failed].filter(Boolean).join('\n\n')
 }).join('\n\n')
 return [lead,note,omitted,timing,limits,links,'### '+t('publicSearch.details',{},locale),details].filter(Boolean).join('\n\n')
}
module.exports = { publicProvenance, publicSummary,cleanText,localTime }
