'use strict'

// A required, authorised source-level read may supplement an Owner investigation.
// Keep only the bounded, model-visible sample as citable evidence. A successful
// search is still a sample, and a failed read never becomes an empty result.
const SOURCE_LEVEL = new Set(['gmail', 'drive', 'calendar', 'github'])
const short = (value, limit) => typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ').slice(0, limit) : null

function requiredExternalSources (plan, authorised) {
  const allow = new Set(Array.isArray(authorised) ? authorised : [])
  return [...new Set((plan?.facts || [])
    .filter(f => f?.necessity === 'required' && SOURCE_LEVEL.has(f.operation) && allow.has(f.operation))
    .map(f => f.operation))]
}

function appendCrossSourceEvidence (report, read) {
  if (!report?.readOnly || !Array.isArray(report.sections)) return []
  const groups = new Map((read?.itemsBySource || []).map(g => [g.source, g]))
  const scopes = new Map((read?.evidenceSets || []).map(e => [e.source, e]))
  const entries = []
  for (const status of read?.perSource || []) {
    if (!SOURCE_LEVEL.has(status.source)) continue
    const source = status.source
    const live = status.trust === 'live'
    const group = groups.get(source)
    const records = live ? (group?.items || []).slice(0, 4).map(item => ({
      sourceId: short(String(item.sourceId ?? ''), 160) || null,
      title: short(item.title, 200),
      content: short(item.content, 400),
      retrievedAt: short(item.retrievedAt, 40)
    })).filter(item => item.sourceId) : []
    const scope = scopes.get(source)
    const section = {
      section: 'external_' + source,
      sourceId: 'read-context:' + source,
      state: live ? 'partial' : 'unconnected',
      retrievedAt: new Date().toISOString(),
      coverage: 'bounded_search_sample_not_exhaustive',
      usedFallback: status.usedFallback === true,
      retrievalCompleteness: scope?.retrievalCompleteness || 'unknown',
      records
    }
    report.sections.push(section)
    report.plan.sources.push(section.section)
    report.gaps.push({ section: section.section, state: section.state, sourceId: section.sourceId, coverage: section.coverage })
    entries.push({ source, state: live ? 'sampled' : 'unavailable', count: records.length,
      usedFallback: status.usedFallback === true, durationMs: Number.isFinite(status.durationMs) ? status.durationMs : null })
  }
  report.crossSourceReads = entries
  return entries
}

module.exports = { requiredExternalSources, appendCrossSourceEvidence }
