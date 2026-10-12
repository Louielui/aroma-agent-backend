'use strict'
// Pure projection of local bookkeeping. No row identity/content, calls or writes.
const rules = Object.freeze({
  memory_index: { failure:'unconfirmed', success:['saved','raw_only'], reasons:['memory_timeout','memory_rate_limited','memory_unauthorized','memory_invalid_request','memory_invalid_text','memory_invalid_result','memory_unconfirmed','memory_unavailable'] },
  memory_consolidation: { failure:'failed', success:['done','empty'], reasons:['invalid_consolidation','stale_evidence','consolidation_unavailable'] }
})
const retryKeys = ['scheduled','due','exhausted','blocked','unknown']
const blockedIndex = new Set(['memory_unauthorized','memory_invalid_request','memory_invalid_text','memory_invalid_result'])
const integer = v => Number.isSafeInteger(v) && v >= 0
function time(value, at, future = false) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || (!future && Date.parse(value) > Date.parse(at))) return null
  return new Date(Date.parse(value)).toISOString()
}
const newest = values => values.filter(Boolean).sort().at(-1) || null
const earliest = values => values.filter(Boolean).sort()[0] || null
function buildDiagnostics(role, rows, at) {
  const rule = rules[role]
  if (!rule) return null
  const states = rows.map(r => role === 'memory_index' ? r.index : r.details?.consolidation).filter(Boolean)
  const failures = states.filter(s => s.state === rule.failure)
  const groups = new Map()
  for (const s of failures) {
    const raw = role === 'memory_index' ? s.reason : s.error
    const code = rule.reasons.includes(raw) ? raw : 'unknown'
    const checkedAt = time(s.checkedAt,at), nextRetryAt = time(s.nextRetryAt,at,true)
    const attempts = integer(s.attempts) ? s.attempts : null
    let retry = 'unknown'
    if (code !== 'unknown' && checkedAt && attempts !== null && attempts > 0) {
      if (attempts >= 3 && s.nextRetryAt === null) retry = 'exhausted'
      else if (attempts < 3 && nextRetryAt && Date.parse(nextRetryAt) >= Date.parse(checkedAt) && !(role === 'memory_index' && blockedIndex.has(code))) retry = Date.parse(nextRetryAt) <= Date.parse(at) ? 'due' : 'scheduled'
      else if (attempts < 3 && s.nextRetryAt === null && role === 'memory_index' && blockedIndex.has(code)) retry = 'blocked'
    }
    if (!groups.has(code)) groups.set(code,{code,count:0,retry:Object.fromEntries(retryKeys.map(k=>[k,0])),attempts:[],times:[],next:[],unknownAttempts:0})
    const g = groups.get(code); g.count++; g.retry[retry]++
    if (attempts === null) g.unknownAttempts++; else g.attempts.push(attempts)
    g.times.push(checkedAt)
    if (['scheduled','due'].includes(retry)) g.next.push(nextRetryAt)
  }
  const reasons = [...groups.values()].sort((a,b)=>a.code.localeCompare(b.code)).map(g=>({code:g.code,count:g.count,retry:g.retry,
    attempts:{min:g.attempts.length?Math.min(...g.attempts):null,max:g.attempts.length?Math.max(...g.attempts):null,unknown:g.unknownAttempts},
    lastFailureAt:newest(g.times),nextRetryAt:earliest(g.next)}))
  return {version:1,basis:'local_record_bookkeeping',failed:failures.length,reasons,
    retry:Object.fromEntries(retryKeys.map(k=>[k,reasons.reduce((n,r)=>n+r.retry[k],0)])),
    lastRecordedSuccessAt:newest(states.filter(s=>rule.success.includes(s.state)).map(s=>time(s.checkedAt,at))),
    latestFailureAt:newest(failures.map(s=>time(s.checkedAt,at))),missingFailureTime:failures.filter(s=>!time(s.checkedAt,at)).length,
    historyComplete:false,rootCauseConfirmed:false}
}
function projectDiagnostics(role, value, failed, at) {
  const rule = rules[role]
  if (!rule || !value || value.version !== 1 || value.basis !== 'local_record_bookkeeping' || value.failed !== failed ||
      value.historyComplete !== false || value.rootCauseConfirmed !== false || !Array.isArray(value.reasons) || value.reasons.length > rule.reasons.length + 1 ||
      !integer(value.missingFailureTime) || value.missingFailureTime > failed) return null
  const validTime = (v,future=false) => v === null || time(v,at,future) !== null
  if (!validTime(value.lastRecordedSuccessAt) || !validTime(value.latestFailureAt)) return null
  const reasons = [], seen = new Set()
  for (const r of value.reasons) {
    if (!r || ![...rule.reasons,'unknown'].includes(r.code) || seen.has(r.code) || !integer(r.count) || r.count === 0 ||
        !retryKeys.every(k=>integer(r.retry?.[k])) || retryKeys.reduce((n,k)=>n+r.retry[k],0) !== r.count ||
        !integer(r.attempts?.unknown) || r.attempts.unknown > r.count ||
        !validTime(r.lastFailureAt) || !validTime(r.nextRetryAt,true)) return null
    const a = r.attempts
    if (a.unknown === r.count ? a.min !== null || a.max !== null : !integer(a.min) || !integer(a.max) || a.min > a.max) return null
    const automatic = r.retry.scheduled + r.retry.due
    if ((automatic === 0) !== (r.nextRetryAt === null) ||
        (r.retry.due > 0 && Date.parse(r.nextRetryAt) > Date.parse(at)) ||
        (r.retry.due === 0 && r.retry.scheduled > 0 && Date.parse(r.nextRetryAt) <= Date.parse(at)) ||
        (r.code === 'unknown' && r.retry.unknown !== r.count) ||
        (r.retry.blocked && !(role === 'memory_index' && blockedIndex.has(r.code))) ||
        (automatic && role === 'memory_index' && blockedIndex.has(r.code)) ||
        (r.retry.exhausted && (a.max === null || a.max < 3))) return null
    seen.add(r.code)
    reasons.push({code:r.code,count:r.count,retry:Object.fromEntries(retryKeys.map(k=>[k,r.retry[k]])),attempts:{min:a.min,max:a.max,unknown:a.unknown},lastFailureAt:r.lastFailureAt,nextRetryAt:r.nextRetryAt})
  }
  if (reasons.reduce((n,r)=>n+r.count,0) !== failed || value.latestFailureAt !== newest(reasons.map(r=>r.lastFailureAt)) ||
      !retryKeys.every(k=>integer(value.retry?.[k]) && value.retry[k] === reasons.reduce((n,r)=>n+r.retry[k],0))) return null
  return {version:1,basis:value.basis,failed,reasons,retry:Object.fromEntries(retryKeys.map(k=>[k,value.retry[k]])),
    lastRecordedSuccessAt:value.lastRecordedSuccessAt,latestFailureAt:value.latestFailureAt,missingFailureTime:value.missingFailureTime,historyComplete:false,rootCauseConfirmed:false}
}
function renderDiagnostics(role, diagnostic, locale) {
  const {t} = require('../i18n/t')
  if (!diagnostic) return t('investigation.memoryFailureMissing',{},locale)
  const lines = [t('investigation.memoryFailureTitle',{},locale)]
  const reasonLabels = {
    memory_timeout:()=>t('investigation.memoryReasonTimeout',{},locale),
    memory_rate_limited:()=>t('investigation.memoryReasonRateLimit',{},locale),
    memory_unauthorized:()=>t('investigation.memoryReasonUnauthorized',{},locale),
    memory_invalid_request:()=>t('investigation.memoryReasonInvalidRequest',{},locale),
    memory_invalid_text:()=>t('investigation.memoryReasonInvalidText',{},locale),
    memory_invalid_result:()=>t('investigation.memoryReasonInvalidResult',{},locale),
    memory_unconfirmed:()=>t('investigation.memoryReasonUnconfirmed',{},locale),
    memory_unavailable:()=>t('investigation.memoryReasonUnavailable',{},locale),
    invalid_consolidation:()=>t('investigation.memoryReasonInvalidConsolidation',{},locale),
    stale_evidence:()=>t('investigation.memoryReasonStaleEvidence',{},locale),
    consolidation_unavailable:()=>t('investigation.memoryReasonUnavailable',{},locale),
    unknown:()=>t('investigation.memoryReasonUnknown',{},locale)
  }
  for (const r of diagnostic.reasons) {
    lines.push(t('investigation.memoryFailureReason',{reason:reasonLabels[r.code](),count:r.count},locale))
    if(r.attempts.min!==null)lines.push(t('investigation.memoryFailureAttempts',{min:r.attempts.min,max:r.attempts.max,unknown:r.attempts.unknown},locale))
  }
  lines.push(t('investigation.memoryFailureRetry',diagnostic.retry,locale))
  if (diagnostic.lastRecordedSuccessAt) lines.push(t('investigation.memoryFailureLastSuccess',{at:diagnostic.lastRecordedSuccessAt},locale))
  else lines.push(t('investigation.memoryFailureSuccessUnknown',{},locale))
  if (diagnostic.latestFailureAt) lines.push(t('investigation.memoryFailureLastFailure',{at:diagnostic.latestFailureAt},locale))
  if (diagnostic.missingFailureTime) lines.push(t('investigation.memoryFailureMissingTime',{count:diagnostic.missingFailureTime},locale))
  const next = earliest(diagnostic.reasons.map(r=>r.nextRetryAt))
  if(next) lines.push(t('investigation.memoryFailureNextRetry',{at:next},locale))
  if (diagnostic.failed) {
    lines.push(role==='memory_index'?t('investigation.memoryFailureIndexImpact',{},locale):t('investigation.memoryFailureConsolidationImpact',{},locale))
    const advice = new Set(diagnostic.reasons.map(r=>r.code==='memory_unauthorized'?'Auth':blockedIndex.has(r.code)?'Input':r.code==='invalid_consolidation'?'Validation':r.code==='stale_evidence'?'FreshEvidence':['memory_timeout','memory_rate_limited'].includes(r.code)?'Wait':'Inspect'))
    const adviceText = {
      Auth:()=>t('investigation.memoryFailureAdviceAuth',{},locale),
      Input:()=>t('investigation.memoryFailureAdviceInput',{},locale),
      Validation:()=>t('investigation.memoryFailureAdviceValidation',{},locale),
      FreshEvidence:()=>t('investigation.memoryFailureAdviceFreshEvidence',{},locale),
      Wait:()=>t('investigation.memoryFailureAdviceWait',{},locale),
      Inspect:()=>t('investigation.memoryFailureAdviceInspect',{},locale)
    }
    for(const key of advice)lines.push(adviceText[key]())
    if (diagnostic.retry.exhausted) lines.push(t('investigation.memoryFailureAdviceExhausted',{},locale))
  } else lines.push(t('investigation.memoryFailureNone',{},locale))
  lines.push(t('investigation.memoryFailureBoundary',{},locale))
  return lines.join('\n')
}
module.exports = {buildDiagnostics,projectDiagnostics,renderDiagnostics}
