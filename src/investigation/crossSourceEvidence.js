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
      originalDate: short(item.originalDate, 40),
      from: short(item.fields?.from, 160),
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

const eligibleId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{15,99}$/.test(value)
const hasMeasuredUsage = row => row?.usage && typeof row.usage === 'object' &&
  Object.values(row.usage).some(value => Number.isFinite(value))
const mentionsId = (value, id) => typeof value === 'string' &&
  new RegExp('(^|[^A-Za-z0-9-])' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[^A-Za-z0-9-])').test(value)

// Compare only identities present in both bounded receipts. A mail body may
// mention a request ID without being authentic billing evidence, so every
// match is a possible lead, never a confirmed charge or causal attribution.
function compareCostEvidence (report) {
  if (report?.readOnly !== true || report.focus !== 'cost') return null
  const mailRead = report.crossSourceReads?.find(row => row.source === 'gmail')
  if (!mailRead) return null
  const mailSection = report.sections.find(row => row.section === 'external_gmail')
  const execution = report.sections.find(row => row.section === 'execution')
  const mail = mailSection?.records || []
  const calls = (execution?.records || []).filter(row => row.evidenceBasis === 'owner_bridge_invocation_ledger')
  const allLinks = []
  const seen = new Set()
  for (const message of mail) for (const call of calls) {
    for (const field of ['requestId', 'invocationId']) {
      const id = call[field]
      if (!eligibleId(id)) continue
      const mailField = ['title', 'content'].find(key => mentionsId(message[key], id))
      if (!mailField) continue
      const key = message.sourceId + ':' + call.sourceId + ':' + field
      if (seen.has(key)) continue
      seen.add(key)
      allLinks.push({ mailSourceId: mailSection.sourceId, mailRecordId: message.sourceId,
        executionSourceId: execution.sourceId, executionRecordId: call.sourceId,
        matchedField: field, mailField, matchedId: id, usageReported: !!hasMeasuredUsage(call),
        evidenceState: 'possible', basis: 'exact_identifier_mentioned_in_untrusted_mail_text', provesCharge: false })
    }
  }
  const links = allLinks.slice(0, 6)
  return { version: 1, state: mailRead.state !== 'sampled' ? 'mail_unavailable'
    : !mail.length ? 'empty_sample' : !calls.length ? 'local_invocations_unavailable'
      : links.length ? 'possible_identifier_link' : 'no_shared_identifier_in_sample',
  mailSelection: mailRead.usedFallback ? 'recency_fallback' : 'question_search',
  sampledMailCount: mail.length, sampledInvocationCount: calls.length,
  sampledInvocationUsageCount: calls.filter(hasMeasuredUsage).length,
  links, linksOmitted: Math.max(0, allLinks.length - links.length), billingConfirmed: false,
  scope: 'bounded_samples_exact_identifier_text_only_no_billing_or_global_absence' }
}

function renderCostEvidenceComparison (comparison, { message = '' } = {}) {
  if (!comparison) return null
  const zh = /[\u3400-\u9fff]/.test(message)
  const { sampledMailCount: mail, sampledInvocationCount: calls, sampledInvocationUsageCount: usage } = comparison
  const lines = [zh
    ? `已逐項對照本次取樣的 ${mail} 筆電郵與 ${calls} 筆本機模型呼叫；其中 ${usage} 筆呼叫記有用量。這些數字只代表取樣範圍。`
    : `Compared ${mail} sampled emails with ${calls} local model invocations; ${usage} invocations include usage records. These are sample counts only.`]
  if (comparison.mailSelection === 'recency_fallback') lines.push(zh
    ? '原問題的電郵關鍵字搜尋未命中，這些郵件是按最近時間回退取得，相關性未確認。'
    : 'The email keyword search for this question returned no matches; these messages came from a recent-items fallback and their relevance is unconfirmed.')
  if (comparison.state === 'mail_unavailable') lines.push(zh ? '電郵未能讀取，無法對照。' : 'Email was unavailable, so no comparison was possible.')
  else if (comparison.state === 'empty_sample') lines.push(zh ? '本次取樣沒有電郵紀錄，不能推論其他郵件不存在。' : 'The sample has no email records; this does not mean other emails do not exist.')
  else if (comparison.state === 'local_invocations_unavailable') lines.push(zh ? '沒有可對照的本機呼叫取樣。' : 'No local invocation sample was available for comparison.')
  else if (comparison.links.length) lines.push(zh
    ? `取樣內有 ${comparison.links.length} 處相同的請求／呼叫 ID 字樣，僅列為可能線索；電郵文字不能證明實際扣款或因果關係。`
    : `${comparison.links.length} exact request/invocation ID mentions are possible leads only; email text does not prove a charge or cause.`)
  else lines.push(zh
    ? '取樣內沒有找到共同的請求／呼叫 ID；不能推論未取樣的紀錄也沒有關聯。'
    : 'No shared request/invocation ID was found in the sample; this says nothing about unsampled records.')
  return lines.join('\n')
}

module.exports = { requiredExternalSources, appendCrossSourceEvidence, compareCostEvidence, renderCostEvidenceComparison }
