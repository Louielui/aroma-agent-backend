'use strict'
const { queryWindow, displayTime, TIME_ZONE } = require('./sevenShiftsReport')
const { instant } = require('./adapters/sevenShiftsRead')
function attendanceRequest (message) {
  if (require('./sevenShiftsComparison').comparisonRequest(message)) return null
  if (typeof message !== 'string' || message.length > 2000 || /(?:不要|不用查|唔好|不需要|don't|do not|批准|批核|刪除|修改|寄出|發送|pause|resume|delete|approve|update|send|payroll|explain|what.*means)/i.test(message) || /[「」“”"]/u.test(message)) return null
  if (!/(?:漏打(?:下班)?卡|漏打下班|未打下班卡|未打卡下班|忘記.*下班.*打卡|missing[ -]?clock[ -]?outs?|missed[ -]?clock[ -]?outs?|(?:missing|missed|forgot).*clock[ -]?out|clock[ -]?out.*(?:missing|missed))/i.test(message)) return null
  if (!/(?:查|找|哪些|邊個|7\s*shifts?|employees?|check|find|show|who)/i.test(message)) return null
  const dates = message.match(/\b\d{4}-\d{2}-\d{2}\b/g) || []
  if (dates.length) return { window: 'dates', dates }
  if (/(?:昨天|昨日|尋日|yesterday)/i.test(message)) return { window: 'yesterday' }
  if (/(?:今天|今日|today)/i.test(message)) return { window: 'today' }
  return { window: 'unspecified' }
}
const id = n => Number.isSafeInteger(n) && n > 0
const localDay = time => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time))
function buildAttendance (result, request, retrievedAt, companyId) {
  if (request.window === 'dates' && request.dates?.length !== 1) throw Error('invalid_request')
  const query = { ...queryWindow(request, retrievedAt), selection: 'clocked_in_local_calendar' }
  if (Date.parse(query.start) > Date.parse(retrievedAt)) throw Error('invalid_request')
  const evidence = result?.evidence, expectedWindow = query.start + '..' + new Date(Date.parse(query.end) - 1).toISOString()
  if (evidence?.trust !== 'live' || evidence.queryScope?.companyId !== companyId || evidence.queryScope?.field !== 'clocked_in' || evidence.queryScope?.window !== expectedWindow ||
      !Array.isArray(result.results) || result.results.length > 300 || evidence.returnedRows !== result.results.length || typeof evidence.completeWithinScope !== 'boolean') throw Error('invalid_source_response')
  const ids = new Set(), historical = Date.parse(query.end) <= Date.parse(retrievedAt)
  const counts = { unclosedHistorical: 0, unclosedCurrent: 0, overnightClosed: 0, autoClockedOut: 0, closed: 0 }
  const rows = result.results.map(row => {
    const p = row.fields
    if (!p || p.companyId !== companyId || !id(p.userId) || !id(p.punchId) || ids.has(p.punchId) || !instant(p.clockedIn) || p.clockedOut !== null && !instant(p.clockedOut) ||
        Date.parse(p.clockedIn) < Date.parse(query.start) || Date.parse(p.clockedIn) >= Date.parse(query.end) || Date.parse(p.clockedIn) > Date.parse(retrievedAt) ||
        p.clockedOut !== null && (Date.parse(p.clockedOut) < Date.parse(p.clockedIn) || Date.parse(p.clockedOut) > Date.parse(retrievedAt)) || p.clockedOut === null && p.autoClockedOut === true) throw Error('invalid_source_response')
    ids.add(p.punchId)
    const open = p.clockedOut === null, auto = p.autoClockedOut === true
    const overnight = !open && localDay(p.clockedIn) !== localDay(p.clockedOut)
    const status = open ? historical ? 'unclosed_historical' : 'unclosed_current' : auto ? 'auto_clocked_out' : overnight ? 'closed_overnight' : 'closed'
    counts[{ unclosed_historical: 'unclosedHistorical', unclosed_current: 'unclosedCurrent', auto_clocked_out: 'autoClockedOut', closed_overnight: 'overnightClosed', closed: 'closed' }[status]]++
    const name = p.nameState === 'confirmed' && typeof p.employeeName === 'string' && p.employeeName.trim() && p.employeeName.length <= 200 && !/[\x00-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(p.employeeName) ? p.employeeName : null
    return { userId: p.userId, punchId: p.punchId, employeeName: name, clockedIn: p.clockedIn, clockedOut: p.clockedOut, status, overnight,
      autoClockedOut: typeof p.autoClockedOut === 'boolean' ? p.autoClockedOut : null,
      clockOutState: open ? 'UNKNOWN' : 'CONFIRMED', manualClockOutState: open || auto || p.autoClockedOut == null ? 'UNKNOWN' : 'SUPPORTED',
      missingClockOutState: open ? historical ? 'CANDIDATE' : 'UNKNOWN' : auto || p.autoClockedOut == null ? 'UNKNOWN' : 'CONTRADICTED', currentlyWorkingState: 'UNKNOWN' }
  })
  return { state: 'live', query, retrievedAt, companyId, rows, counts, completeWithinScope: evidence.completeWithinScope,
    unresolvedNames: rows.filter(r => !r.employeeName).length, modelCalls: 0, writes: false, recommendation: rows.some(r => r.status !== 'closed' && r.status !== 'closed_overnight') ? 'confirm_with_employee' : 'no_unclosed_rows_observed' }
}
const cell = v => String(v).replace(/[|<>`\r\n]/g, ' ')
function attendanceReply (report, language = 'zh') {
  const zh = language === 'zh'
  if (report.state === 'needs_date') return zh ? '要查哪一天的漏打下班卡？我會按 Winnipeg 上班日期查詢，分清未結束及跨午夜的打卡。' : 'Which Winnipeg clock-in day should I investigate for missing clock-outs? I will separate unclosed records from closed overnight shifts.'
  if (report.state !== 'live') return zh ? '本次出勤調查未完成（' + report.reason + '）。未取得可核實的結果，不能說沒有漏打卡。' : 'Attendance investigation is unavailable (' + report.reason + '). There is no verified result; this does not establish that no punches are missing.'
  const c = report.counts, attention = report.rows.filter(r => r.status !== 'closed')
  const lines = [zh ? `出勤調查：${report.query.firstDate}（America/Winnipeg 上班日期）` : `Attendance investigation: ${report.query.firstDate} (America/Winnipeg clock-in date)`,
    zh ? `已讀取 ${report.rows.length} 筆；${report.completeWithinScope ? '查詢範圍完整。' : '清單不完整，不能確認全部員工的情況。'}` : `${report.rows.length} punch records read; ${report.completeWithinScope ? 'complete within this query scope.' : 'partial list; the full employee situation is unverified.'}`,
    zh ? `歷史未結束 ${c.unclosedHistorical} 筆；當日未結束 ${c.unclosedCurrent} 筆；跨午夜已下班 ${c.overnightClosed} 筆；系統自動下班 ${c.autoClockedOut} 筆；其他已下班 ${c.closed} 筆。` : `Historical unclosed: ${c.unclosedHistorical}; current-day unclosed: ${c.unclosedCurrent}; closed overnight: ${c.overnightClosed}; auto clock-outs: ${c.autoClockedOut}; other closed: ${c.closed}.`,
    zh ? '歷史未結束紀錄是漏打卡候選（CANDIDATE），不是已確認漏打。是否仍在上班為 UNKNOWN；目前未接排班結束時間或現場確認。系統自動下班不能證明員工親自打卡。' : 'Historical unclosed records are missing-punch CANDIDATEs, not confirmed omissions. Whether someone is currently working is UNKNOWN; scheduled end times and on-site confirmation are not connected. Auto clock-out does not establish a manual clock-out.']
  if (attention.length) {
    lines.push('', zh ? '| 員工／ID | 上班（本地） | 下班（本地） | 判斷 | 打卡 ID |' : '| Employee / ID | Clock-in (local) | Clock-out (local) | Finding | Punch ID |', '|---|---|---|---|---|')
    const labels = zh ? { unclosed_historical: '歷史未結束 · CANDIDATE', unclosed_current: '當日未結束 · UNKNOWN', closed_overnight: '跨午夜已下班 · CONFIRMED', auto_clocked_out: '系統自動下班 · 人手打卡 UNKNOWN' } : { unclosed_historical: 'Historical unclosed · CANDIDATE', unclosed_current: 'Current-day unclosed · UNKNOWN', closed_overnight: 'Closed overnight · CONFIRMED', auto_clocked_out: 'Auto clock-out · manual punch UNKNOWN' }
    for (const r of attention) lines.push(`| ${cell(r.employeeName || (zh ? '姓名未核實' : 'Name unavailable'))} / ${r.userId} | ${displayTime(r.clockedIn)} | ${r.clockedOut === null ? (zh ? '未記錄' : 'Not recorded') : displayTime(r.clockedOut)} | ${labels[r.status]} | ${r.punchId} |`)
  } else lines.push(zh ? '已取得的紀錄沒有未結束或自動下班項目；不代表未上班打卡的員工沒有漏打卡。' : 'No unclosed or auto-clocked-out items were observed in the returned records. This does not prove that employees without a clock-in have no missing punches.')
  if (report.unresolvedNames) lines.push(zh ? `${report.unresolvedNames} 筆姓名未核實，保留員工及打卡 ID。` : `${report.unresolvedNames} names are unavailable; employee and punch IDs are retained.`)
  lines.push('', zh ? '建議：先向相關員工確認實際下班時間，再決定如何處理。這次只調查，沒有修改打卡或提交薪資。' : 'Recommendation: confirm actual finish times with the relevant employees before deciding how to handle the records. No punch or payroll changes were made.',
    zh ? `來源：7shifts 固定 GET time_punches 與 users；核對時間 ${report.retrievedAt}。結果是當時快照，重新送出查詢才更新。` : `Source: fixed 7shifts GET time_punches and users; checked ${report.retrievedAt}. This is a snapshot; send a new query to refresh it.`)
  return lines.join('\n')
}
module.exports = { attendanceRequest, buildAttendance, attendanceReply }
