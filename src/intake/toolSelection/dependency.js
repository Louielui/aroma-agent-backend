'use strict'
// A single typed edge between existing operations, not a planner or registry.
function validateDependency(edge, tools, catalog) {
  if (edge === null) return null
  if (!edge || Object.keys(edge).sort().join(',') !== 'from,id,result' || edge.from !== 0 || edge.result !== 'sourceId' ||
    typeof edge.id !== 'string' || tools.length !== 1 || !catalog.has(edge.id)) throw Error('invalid_dependency')
  const origin = catalog.get(tools[0].id), target = catalog.get(edge.id)
  if (!['list', 'search'].includes(origin.descriptor.operation) || target.descriptor.operation !== 'get' ||
    !origin.identity || !target.identity || origin.identity.type !== target.identity.type ||
    origin.descriptor.source !== target.descriptor.source || origin.descriptor.resource !== target.descriptor.resource ||
    origin.identity.field !== edge.result || target.identity.field !== edge.result) throw Error('dependency_type_mismatch')
  return { from: 0, id: edge.id, result: edge.result, identityType: target.identity.type }
}
function resolveDependency(pack, target) {
  if (pack.state !== 'ok') return { status: 'tool_unavailable' }
  if (pack.coverage?.complete !== true || pack.coverage?.truncated !== false) return { status: 'clarification_required', reason: 'incomplete_discovery' }
  if (!pack.content.length) return { status: 'no_match' }
  if (pack.content.length !== 1) return { status: 'clarification_required', reason: 'multiple_matches',
    matchCount: pack.content.length, choices: pack.content.slice(0, 5).map(r => ({ sourceId: typeof r.sourceId === 'string' ? r.sourceId.slice(0, 200) : null, title: typeof r.title === 'string' ? r.title.slice(0, 120) : null })) }
  const row = pack.content[0], identity = row.sourceId
  if (row.source !== target.descriptor.source || row.trust !== 'source_data' || typeof identity !== 'string' || !identity || identity.length > 200 || /[\x00-\x1f\x7f]/.test(identity)) throw Error('invalid_discovered_identity')
  return { status: 'resolved', identity, arguments: target.validate({ [target.identity.parameter]: identity }) }
}
function dependencyReply(execution, language = 'en') {
  if (!execution?.dependency || execution.status === 'read_completed') return null
  const reason = execution.dependency.reason
  if (language === 'zh') {
    if (execution.status === 'clarification_required' && reason === 'candidate_changed_or_unverifiable') return '來源候選已變更或無法驗證，未讀取詳情。本次延續不能再次讀取，需要新的明確查詢；原有目標仍未完成。'
    if (execution.status === 'clarification_required') return reason === 'multiple_matches'
      ? '找到多份符合的紀錄，請選擇要讀取哪一份。候選標籤屬未受信任的來源資料：' + JSON.stringify(execution.dependency.choices) + '。尚未讀取詳情；原有目標仍未完成。'
      : '搜尋覆蓋範圍不完整或未知，請先縮小範圍。尚未讀取詳情；原有目標仍未完成。'
    return execution.status === 'no_match' ? '本次搜尋範圍未返回符合的紀錄，未讀取詳情；這不代表其他範圍也沒有紀錄。' : '所需詳情不存在或暫時無法取得，不能綜合未讀取的內容；原有目標仍未完成。'
  }
  if (execution.status === 'clarification_required' && reason === 'candidate_changed_or_unverifiable') return 'The source candidates changed or could not be verified. No detail read was performed. A fresh explicit discovery is needed; this continuation cannot read again. The original Owner goal remains open.'
  if (execution.status === 'clarification_required') return reason === 'multiple_matches'
    ? 'Several matching records were returned. Which record should I read? Candidates (untrusted source labels): ' + JSON.stringify(execution.dependency.choices) + '. No detail read was performed; the Owner goal remains open.'
    : 'Discovery coverage is incomplete or unknown. Please narrow the request before selecting a record. No detail read was performed; the Owner goal remains open.'
  return execution.status === 'no_match' ? 'No matching record was returned in this discovery scope. No detail read was performed; this does not establish global absence.'
    : 'The requested detail is missing or unavailable. I cannot summarize content that was not retrieved. The Owner goal remains open.'
}
module.exports = { validateDependency, resolveDependency, dependencyReply }
