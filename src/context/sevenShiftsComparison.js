'use strict'
const { queryWindow, displayTime, TIME_ZONE } = require('./sevenShiftsReport')
const { instant } = require('./adapters/sevenShiftsRead')
// Bounded bilingual input matching and deterministic evidence output. No model or write operations.
function comparisonRequest (message) {
  if (typeof message !== 'string' || message.length > 2000 || /(?:不要|不用查|唔好|不需要|don't|do not|批准|批核|刪除|修改|寄出|發送|pause|resume|delete|approve|update|send|payroll|explain)/i.test(message) || /[「」“”"]/u.test(message)) return null
  if (!/(?:排班|scheduled? shifts?|schedules?)/i.test(message) || !/(?:打卡|punch|clock[ -]?(?:in|out))/i.test(message) || !/(?:查|找|哪些|對照|比較|compare|check|find|show|which)/i.test(message)) return null
  const dates = message.match(/\b\d{4}-\d{2}-\d{2}\b/g) || []
  if (dates.length) return { window: 'dates', dates }
  if (/(?:昨天|昨日|尋日|yesterday)/i.test(message)) return { window: 'yesterday' }
  if (/(?:今天|今日|today)/i.test(message)) return { window: 'today' }
  return { window: 'unspecified' }
}
function comparisonWindows (request, now) {
  if (request?.window === 'dates' && request.dates?.length !== 1) throw Error('invalid_request')
  const query = { ...queryWindow(request, now), selection: 'published_scheduled_start_local_calendar' }
  if (Date.parse(query.start) > Date.parse(now)) throw Error('invalid_request')
  const civil = Date.parse(query.firstDate + 'T00:00:00Z'), date = delta => new Date(civil + delta * 86400000).toISOString().slice(0, 10)
  const punchQuery = queryWindow({ window: 'dates', dates: [date(-1), date(1)] }, now)
  return { query, punchQuery: { ...punchQuery, selection: 'adjacent_clock_in_days' } }
}
const id = n => Number.isSafeInteger(n) && n > 0
const name = p => p.nameState === 'confirmed' && typeof p.employeeName === 'string' && p.employeeName.trim() && p.employeeName.length <= 200 && !/[\x00-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(p.employeeName) ? p.employeeName : null
const localDay = v => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(v))
function scopedFields (result, query, field, companyId) {
  const e = result?.evidence, window = query.start + '..' + new Date(Date.parse(query.end) - 1).toISOString()
  if (e?.trust !== 'live' || e.queryScope?.companyId !== companyId || e.queryScope?.field !== field || e.queryScope?.window !== window ||
      !Array.isArray(result.results) || result.results.length > 300 || e.returnedRows !== result.results.length || typeof e.completeWithinScope !== 'boolean') throw Error('invalid_source_response')
  return result.results.map(r => {
    const p = r?.fields
    const value = p?.[field === 'clocked_in' ? 'clockedIn' : field]
    if (!p || p.companyId !== companyId || !instant(value) || Date.parse(value) < Date.parse(query.start) || Date.parse(value) >= Date.parse(query.end)) throw Error('invalid_source_response')
    return p
  })
}
function buildComparison (shiftsResult, punchesResult, request, retrievedAt, companyId) {
  const { query, punchQuery } = comparisonWindows(request, retrievedAt), seen = new Set()
  const shifts = scopedFields(shiftsResult, query, 'start', companyId)
  for (const s of shifts) {
    if (!id(s.shiftId) || seen.has(s.shiftId) || !id(s.locationId) || !(id(s.userId) || s.userId === null && s.unassigned === true) ||
        typeof s.unassigned !== 'boolean' || s.published !== true || !instant(s.end) || Date.parse(s.end) <= Date.parse(s.start)) throw Error('invalid_source_response')
    seen.add(s.shiftId)
  }
  seen.clear()
  const punches = scopedFields(punchesResult, punchQuery, 'clocked_in', companyId)
  return compare(shifts, punches, shiftsResult, punchesResult, query, punchQuery, retrievedAt, companyId, seen)
}
function compare (shifts, punches, shiftsResult, punchesResult, query, punchQuery, retrievedAt, companyId, seen) {
  for (const p of punches) {
    if (!id(p.punchId) || seen.has(p.punchId) || !id(p.userId) || p.shiftId != null && !id(p.shiftId) || p.locationId != null && !id(p.locationId) ||
        !instant(p.clockedIn) || Date.parse(p.clockedIn) > Date.parse(retrievedAt) || p.clockedOut !== null && (!instant(p.clockedOut) || Date.parse(p.clockedOut) < Date.parse(p.clockedIn) || Date.parse(p.clockedOut) > Date.parse(retrievedAt)) ||
        p.clockedOut === null && p.autoClockedOut === true) throw Error('invalid_source_response')
    seen.add(p.punchId)
  }
  const groups = new Map(shifts.map(s => [s.shiftId, []])), contradictions = new Set(), approximate = new Set(), unmatched = []
  for (const p of punches) {
    const exact = shifts.find(s => s.shiftId === p.shiftId)
    if (exact) {
      if (exact.unassigned || exact.userId !== p.userId || p.locationId !== null && p.locationId !== undefined && exact.locationId !== p.locationId) { contradictions.add(exact.shiftId); unmatched.push(p); continue }
      groups.get(exact.shiftId).push(p); continue
    }
    // Never override an explicit association outside the selected schedule scope.
    const candidates = p.shiftId != null ? [] : shifts.filter(s => !s.unassigned && s.userId === p.userId && p.locationId === s.locationId &&
      Date.parse(p.clockedIn) < Date.parse(s.end) && (p.clockedOut === null ? Date.parse(retrievedAt) : Date.parse(p.clockedOut)) >= Date.parse(s.start))
    if (candidates.length === 1) { groups.get(candidates[0].shiftId).push(p); approximate.add(candidates[0].shiftId) } else unmatched.push(p)
  }
  const rows = shifts.map(s => {
    const ps = groups.get(s.shiftId).sort((a, b) => Date.parse(a.clockedIn) - Date.parse(b.clockedIn)), findings = []
    const clockedIn = ps[0]?.clockedIn ?? null, unclosed = ps.some(p => p.clockedOut === null)
    const clockedOut = ps.length && !unclosed ? ps.reduce((last, p) => Date.parse(p.clockedOut) > Date.parse(last) ? p.clockedOut : last, ps[0].clockedOut) : null
    const matchState = contradictions.has(s.shiftId) ? 'CONTRADICTED' : !ps.length ? 'UNKNOWN' : approximate.has(s.shiftId) ? 'SUPPORTED' : 'CONFIRMED'
    const startDifferenceMinutes = clockedIn === null ? null : (Date.parse(clockedIn) - Date.parse(s.start)) / 60000
    const endDifferenceMinutes = clockedOut === null ? null : (Date.parse(clockedOut) - Date.parse(s.end)) / 60000
    if (contradictions.has(s.shiftId)) findings.push('link_contradiction')
    if (s.unassigned) findings.push('unassigned_shift')
    else if (!ps.length) findings.push(Date.parse(s.start) > Date.parse(retrievedAt) ? 'no_punch_before_scheduled_start' : 'no_linked_punch')
    if (approximate.has(s.shiftId)) findings.push('approximate_match')
    if (startDifferenceMinutes > 0) findings.push('later_clock_in')
    if (startDifferenceMinutes < 0) findings.push('earlier_clock_in')
    if (endDifferenceMinutes < 0) findings.push('earlier_clock_out')
    if (endDifferenceMinutes > 0) findings.push('later_clock_out')
    if (unclosed) findings.push(Date.parse(s.end) < Date.parse(retrievedAt) ? 'unclosed_after_scheduled_end' : 'unclosed_before_scheduled_end')
    if (ps.some(p => p.autoClockedOut === true)) findings.push('auto_clocked_out')
    return { shiftId: s.shiftId, userId: s.userId, locationId: s.locationId, employeeName: name(s) || name(ps[0] || {}), scheduledStart: s.start, scheduledEnd: s.end,
      punchIds: ps.map(p => p.punchId), clockedIn, clockedOut, startDifferenceMinutes, endDifferenceMinutes, matchState, findings,
      overnight: localDay(s.start) !== localDay(s.end), discrepancyState: s.unassigned || findings.length === 1 && findings[0] === 'no_punch_before_scheduled_start' ? 'UNKNOWN' : findings.length ? 'CANDIDATE' : ps.length ? 'CONTRADICTED' : 'UNKNOWN',
      absenceState: 'UNKNOWN', currentlyWorkingState: 'UNKNOWN' }
  }).sort((a, b) => Date.parse(a.scheduledStart) - Date.parse(b.scheduledStart) || a.shiftId - b.shiftId)
  const unmatchedPunches = unmatched.filter(p => Date.parse(p.clockedIn) >= Date.parse(query.start) && Date.parse(p.clockedIn) < Date.parse(query.end)).map(p => ({ punchId: p.punchId, userId: p.userId, shiftId: p.shiftId ?? null, employeeName: name(p), clockedIn: p.clockedIn, clockedOut: p.clockedOut, matchState: 'UNKNOWN' }))
  return { state: 'live', query, punchQuery, retrievedAt, companyId, rows, unmatchedPunches, scheduleRows: shifts.length, punchRows: punches.length,
    completeWithinScope: shiftsResult.evidence.completeWithinScope && punchesResult.evidence.completeWithinScope,
    scheduleComplete: shiftsResult.evidence.completeWithinScope, punchesComplete: punchesResult.evidence.completeWithinScope,
    attentionRows: rows.filter(r => r.findings.length).length, modelCalls: 0, writes: false }
}
const cell = v => String(v).replace(/[|<>`\r\n]/g, ' ')
function comparisonReply (report, language = 'zh') {
  const zh = language === 'zh'
  if (report.state === 'needs_date') return zh ? '要對照哪一天的排班與打卡？請指定 Winnipeg 排班開始日期。' : 'Which Winnipeg scheduled-start day should I compare with punches?'
  if (report.state !== 'live') return zh ? `排班與打卡對照未完成（${report.reason}）。尚無可核實結果，不能判斷沒有異常。` : `Schedule/punch comparison is unavailable (${report.reason}). No verified result establishes an absence of discrepancies.`
  const labels = zh ? { later_clock_in: '打卡晚於排班開始', earlier_clock_in: '打卡早於排班開始', earlier_clock_out: '打卡早於排班結束', later_clock_out: '打卡晚於排班結束', unclosed_after_scheduled_end: '排班已結束，打卡仍未記錄下班', unclosed_before_scheduled_end: '排班未結束，打卡尚未結束', no_linked_punch: '沒有可配對打卡；缺卡／缺勤 UNKNOWN', approximate_match: '時間重疊推定配對，需確認', auto_clocked_out: '系統自動下班，需確認實際時間', link_contradiction: '排班連結與員工／地點矛盾', unassigned_shift: '未指派班次，不判斷缺勤' } :
    { later_clock_in: 'Clock-in later than scheduled start', earlier_clock_in: 'Clock-in earlier than scheduled start', earlier_clock_out: 'Clock-out earlier than scheduled end', later_clock_out: 'Clock-out later than scheduled end', unclosed_after_scheduled_end: 'Unclosed punch after scheduled end', unclosed_before_scheduled_end: 'Unclosed before scheduled end', no_linked_punch: 'No linked punch; omission/absence UNKNOWN', approximate_match: 'Inferred overlap match; confirm association', auto_clocked_out: 'Auto clock-out; confirm actual finish', link_contradiction: 'Shift link contradicts employee/location', unassigned_shift: 'Unassigned shift; no absence finding' }
  const time = v => v === null ? (zh ? '未記錄' : 'Not recorded') : displayTime(v), delta = v => v === null ? 'UNKNOWN' : (v > 0 ? '+' : '') + Number(v.toFixed(2))
  const lines = [zh ? `排班與打卡對照：${report.query.firstDate}（America/Winnipeg 排班開始日期）` : `Schedule/punch comparison: ${report.query.firstDate} (America/Winnipeg scheduled-start day)`,
    zh ? `已讀取 ${report.scheduleRows} 筆排班、${report.punchRows} 筆相鄰日期打卡；${report.completeWithinScope ? '查詢範圍完整。' : '清單不完整，不能作全面結論。'}需確認 ${report.attentionRows} 筆排班；另有 ${report.unmatchedPunches.length} 筆當日打卡無法配對。` : `${report.scheduleRows} scheduled shifts and ${report.punchRows} adjacent-day punches read; ${report.completeWithinScope ? 'complete within scope.' : 'partial lists; no comprehensive conclusion.'} ${report.attentionRows} shifts need confirmation; ${report.unmatchedPunches.length} punches from the selected day are unmatched.`,
    zh ? '時間差是紀錄對照，並非已確認遲到、早退或加班。需確認項目為 CANDIDATE；是否缺勤、是否仍在上班為 UNKNOWN。排班是目前已發佈版本，不是當時版本的證明。' : 'Time differences compare records; they do not establish lateness, early departure or overtime. Follow-up items are CANDIDATEs; absence and current working status are UNKNOWN. The schedule is its currently published version, not proof of the historical version.']
  if (report.rows.length) {
    lines.push('', zh ? '| 員工／ID | 排班開始 → 結束 | 打卡上班 → 下班 | 開始／結束差（分鐘） | 需確認原因／配對證據 | 排班／打卡 ID |' : '| Employee / ID | Scheduled start → end | Clock-in → out | Start / end delta (minutes) | Finding / match evidence | Shift / punch IDs |', '|---|---|---|---|---|---|')
    labels.no_punch_before_scheduled_start = zh ? '排班尚未開始，不判斷漏打卡' : 'Scheduled start is in the future; no omission finding'
    for (const r of report.rows) lines.push(`| ${cell(r.employeeName || (zh ? '姓名未核實' : 'Name unavailable'))} / ${r.userId ?? 'UNKNOWN'} | ${time(r.scheduledStart)} → ${time(r.scheduledEnd)} | ${time(r.clockedIn)} → ${time(r.clockedOut)} | ${delta(r.startDifferenceMinutes)} / ${delta(r.endDifferenceMinutes)} | ${r.findings.map(f => labels[f]).join('；') || (zh ? '紀錄時間一致' : 'Recorded times align')} · ${r.matchState}${r.overnight ? (zh ? '；跨午夜' : '; overnight') : ''} | ${r.shiftId} / ${r.punchIds.join(', ') || 'UNKNOWN'} |`)
  } else lines.push(zh ? '已取得及可配對的紀錄沒有時間差項目；不代表現場沒有異常。' : 'No time differences were observed in the retrieved matched records; this does not establish no on-site issues.')
  if (report.unmatchedPunches.length) {
    lines.push('', zh ? '| 無法配對的員工／ID | 上班 → 下班 | 排班 ID／打卡 ID |' : '| Unmatched employee / ID | Clock-in → out | Shift / punch ID |', '|---|---|---|')
    for (const p of report.unmatchedPunches) lines.push(`| ${cell(p.employeeName || (zh ? '姓名未核實' : 'Name unavailable'))} / ${p.userId} | ${time(p.clockedIn)} → ${time(p.clockedOut)} | ${p.shiftId ?? 'UNKNOWN'} / ${p.punchId} |`)
  }
  lines.push('', zh ? '建議：先核對排班是否事後更改、跨班次配對、獲准提早／延後及實際下班時間，再向員工確認。未修改打卡、批准薪資或聯絡員工。' : 'Recommendation: check schedule edits, shift associations, authorized changes and actual finish times before confirming with employees. No punch edits, payroll approvals or employee messages.',
    zh ? `來源：7shifts 固定 GET shifts、time_punches、users；核對時間 ${report.retrievedAt}。打卡開始日期範圍 ${report.punchQuery.firstDate} 至 ${report.punchQuery.lastDate}；超出範圍或無明確配對的紀錄保持未知。結果已保存為快照，重新送出才更新。` : `Source: fixed 7shifts GET shifts, time_punches and users; checked ${report.retrievedAt}. Clock-in dates cover ${report.punchQuery.firstDate} through ${report.punchQuery.lastDate}; out-of-scope or unlinked records remain unknown. Saved snapshot; send a new query to refresh.`)
  return lines.join('\n')
}
module.exports = { comparisonRequest, comparisonWindows, buildComparison, comparisonReply }
