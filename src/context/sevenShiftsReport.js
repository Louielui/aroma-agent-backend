'use strict'
const TIME_ZONE = 'America/Winnipeg', DAY = 86400000
const zoneParts = time => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
}).formatToParts(new Date(time)).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]))
const civilDate = date => {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('invalid_request')
  const time = Date.parse(date + 'T00:00:00Z')
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) throw Error('invalid_request')
  return time
}
function midnight (civil) {
  let candidate = civil
  for (let i = 0; i < 4; i++) {
    const p = zoneParts(candidate)
    const delta = civil - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
    if (!delta) return new Date(candidate).toISOString()
    candidate += delta
  }
  throw Error('timezone_boundary_unavailable')
}
function clockOutRequest (message) {
  if (require('./sevenShiftsAttendance').attendanceRequest(message)) return null
  if (typeof message !== 'string' || message.length > 2000 || /(?:不要|不用查|唔好|不需要|don't|do not|批准|批核|刪除|修改|寄出|發送|pause|resume|delete|approve|update|send|payroll)/i.test(message) || /[「」“”"]/u.test(message)) return null
  if (!/(?:clock[ -]?out|下班打卡|下班.*時間)/i.test(message) ||
      !/(?:7\s*shifts?|所有員工|全部員工|all employees)/i.test(message)) return null
  const dates = message.match(/\b\d{4}-\d{2}-\d{2}\b/g) || []
  if (dates.length) return { window: 'dates', dates }
  if (/(?:昨天|昨日|尋日|yesterday)/i.test(message)) return { window: 'yesterday' }
  if (/(?:今天|今日|today)/i.test(message)) return { window: 'today' }
  return { window: 'unspecified' }
}
function queryWindow (request, now) {
  if (!request || !['dates', 'yesterday', 'today'].includes(request.window) || !Number.isFinite(Date.parse(now))) throw Error('invalid_request')
  if (Object.keys(request).sort().join(',') !== (request.window === 'dates' ? 'dates,window' : 'window')) throw Error('invalid_request')
  let first, last
  if (request.window === 'dates') {
    if (!Array.isArray(request.dates) || ![1, 2].includes(request.dates.length)) throw Error('invalid_request')
    first = civilDate(request.dates[0]); last = civilDate(request.dates.at(-1))
  } else {
    const p = zoneParts(now)
    first = last = Date.UTC(p.year, p.month - 1, p.day) - (request.window === 'yesterday' ? DAY : 0)
  }
  if (last < first || last - first >= 31 * DAY) throw Error('invalid_request')
  const start = midnight(first), end = midnight(last + DAY)
  return { start, end, timeZone: TIME_ZONE, firstDate: new Date(first).toISOString().slice(0, 10), lastDate: new Date(last).toISOString().slice(0, 10), selection: 'clocked_out_local_calendar' }
}
const nameText = value => typeof value === 'string' && value.trim() && value.length <= 200 && !/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/u.test(value)
function createSevenShiftsReport ({ env = process.env, adapter, fetchFn, clock = () => new Date().toISOString() } = {}) {
  const source = adapter || require('./adapters/sevenShiftsRead').createSevenShiftsReadAdapter({ env, fetchFn, clock })
  const captureAccess = () => {
    const companyId = Number(env.SEVEN_SHIFTS_COMPANY_ID), token = env.SEVEN_SHIFTS_ACCESS_TOKEN
    const verify = () => {
      if (env.READ_ACCESS !== 'on' || env.CONTEXT_SEVEN_SHIFTS !== 'on') throw Error('read_access_disabled')
      if (!Number.isSafeInteger(companyId) || companyId < 1 || typeof token !== 'string' || !token.trim()) throw Error('connection_not_configured')
      if (Number(env.SEVEN_SHIFTS_COMPANY_ID) !== companyId || env.SEVEN_SHIFTS_ACCESS_TOKEN !== token) throw Error('source_access_changed')
    }
    verify(); return verify
  }
  async function read (actor, request) {
    if (actor?.id !== 'owner' || actor.role !== 'owner') throw Error('permission_denied')
    const retrievedAt = clock()
    try {
      const verify = captureAccess()
      if (request?.window === 'unspecified') return { state: 'needs_date', retrievedAt, modelCalls: 0 }
      const query = queryWindow(request, retrievedAt)
      if (typeof source.methods?.listClockOuts !== 'function') return { state: 'capability_gap', query, retrievedAt, modelCalls: 0,
        gap: require('../capabilities/gapContract').detectGap({ reason: 'no_mapped_operation', plan: { requestedCapability: 'seven_shifts.read' }, state: { facts: [
          { necessity: 'required', need: '7shifts employee names and all scoped clock-out rows, including overnight punches', readState: 'no_system_operation' }
        ] } }) }
      const result = await source.methods.listClockOuts({ timeMin: query.start, timeMax: new Date(Date.parse(query.end) - 1).toISOString() })
      verify()
      const evidence = result?.evidence, companyId = Number(env.SEVEN_SHIFTS_COMPANY_ID)
      if (evidence?.trust !== 'live' || evidence.queryScope?.companyId !== companyId || evidence.queryScope?.field !== 'clocked_out' ||
          !Array.isArray(result.results) || result.results.length > 300 || evidence.returnedRows !== result.results.length || typeof evidence.completeWithinScope !== 'boolean') throw Error('invalid_source_response')
      const ids = new Set(), rows = result.results.map(row => {
        const p = row.fields
        if (!p || p.companyId !== companyId || !Number.isSafeInteger(p.userId) || p.userId < 1 || !Number.isSafeInteger(p.punchId) || p.punchId < 1 || ids.has(p.punchId) ||
            !Number.isFinite(Date.parse(p.clockedIn)) || !Number.isFinite(Date.parse(p.clockedOut)) || Date.parse(p.clockedIn) > Date.parse(p.clockedOut) ||
            Date.parse(p.clockedOut) < Date.parse(query.start) || Date.parse(p.clockedOut) >= Date.parse(query.end)) throw Error('invalid_source_response')
        ids.add(p.punchId)
        return { userId: p.userId, punchId: p.punchId, employeeName: p.nameState === 'confirmed' && nameText(p.employeeName) ? p.employeeName : null,
          clockedIn: p.clockedIn, clockedOut: p.clockedOut, approved: typeof p.approved === 'boolean' ? p.approved : null,
          autoClockedOut: typeof p.autoClockedOut === 'boolean' ? p.autoClockedOut : null }
      }).sort((a, b) => Date.parse(a.clockedOut) - Date.parse(b.clockedOut) || a.punchId - b.punchId)
      return { state: 'live', query, retrievedAt, companyId, rows, completeWithinScope: evidence.completeWithinScope,
        unresolvedNames: rows.filter(r => !r.employeeName).length, modelCalls: 0, writes: false }
    } catch (e) {
      return { state: 'unavailable', reason: ['invalid_request', 'read_access_disabled', 'connection_not_configured', 'source_access_changed', 'source_not_authorised', 'source_rate_limited', 'invalid_source_response'].includes(e.message) ? e.message : 'source_unavailable', retrievedAt, modelCalls: 0 }
    }
  }
  async function readAttendance (actor, request) {
    if (actor?.id !== 'owner' || actor.role !== 'owner') throw Error('permission_denied')
    const retrievedAt = clock()
    try {
      const verify = captureAccess()
      if (request?.window === 'unspecified') return { state: 'needs_date', retrievedAt, modelCalls: 0 }
      if (request?.window === 'dates' && request.dates?.length !== 1) throw Error('invalid_request')
      const query = queryWindow(request, retrievedAt)
      if (Date.parse(query.start) > Date.parse(retrievedAt)) throw Error('invalid_request')
      if (typeof source.methods?.listAttendance !== 'function') throw Error('attendance_reader_unavailable')
      const result = await source.methods.listAttendance({ timeMin: query.start, timeMax: new Date(Date.parse(query.end) - 1).toISOString() })
      verify()
      return require('./sevenShiftsAttendance').buildAttendance(result, request, retrievedAt, Number(env.SEVEN_SHIFTS_COMPANY_ID))
    } catch (e) {
      return { state: 'unavailable', reason: ['invalid_request', 'attendance_reader_unavailable', 'read_access_disabled', 'connection_not_configured', 'source_access_changed', 'source_not_authorised', 'source_rate_limited', 'invalid_source_response'].includes(e.message) ? e.message : 'source_unavailable', retrievedAt, modelCalls: 0 }
    }
  }
  return Object.freeze({ read, readAttendance, captureAccess })
}
function displayTime (iso) {
  const p = zoneParts(iso)
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  const offset = Math.round((wall - Math.floor(Date.parse(iso) / 1000) * 1000) / 60000)
  const sign = offset < 0 ? '-' : '+', abs = Math.abs(offset)
  const pad = n => String(n).padStart(2, '0')
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)} UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}
const cell = value => String(value).replace(/[|<>`\r\n]/g, ' ')
function reportReply (report, language = 'zh') {
  const zh = language === 'zh'
  if (report.state === 'needs_date') return zh ? '要查哪一天的下班打卡？我會按 America/Winnipeg 本地日期查詢，顯示姓名及完整查詢結果。' : 'Which local day should I check? I will show names and all scoped clock-out records in America/Winnipeg.'
  if (report.state === 'capability_gap') return zh ? '7shifts 已有唯讀連線，但現有讀取器未能按下班日期取得完整名單及員工姓名。我可以提出固定唯讀範圍的補強方案；尚未派工或更改資料。' : '7shifts has a read-only connection, but the current reader cannot yet return employee names and the full clock-out-day report. A bounded remediation proposal can be prepared; no development or data changes have been dispatched.'
  if (report.state !== 'live') return zh ? '本次 7shifts 查詢未完成（' + report.reason + '）。這不代表沒有打卡，亦不代表需要新增權限；我沒有修改資料。' : 'The 7shifts query is incomplete (' + report.reason + '). This does not establish missing punches or permissions. No data was changed.'
  const q = report.query, count = report.rows.length
  const lines = [zh ? `7shifts 下班打卡：${q.firstDate}${q.lastDate !== q.firstDate ? ' 至 ' + q.lastDate : ''}（America/Winnipeg）` : `7shifts clock-outs: ${q.firstDate}${q.lastDate !== q.firstDate ? ' through ' + q.lastDate : ''} (America/Winnipeg)`,
    zh ? `公司 ${report.companyId}；以「下班時間落在上述本地日期」篩選，包含前一天上班、跨午夜下班的班次。` : `Company ${report.companyId}; selected by the local clock-out date, including shifts that started on a previous day.`,
    zh ? `本次${report.completeWithinScope ? '已完整讀取' : '只取得部分'}查詢範圍內 ${count} 筆；${report.completeWithinScope ? '不是四筆預覽。' : '尚未證明清單完整，不能稱為全部。'}` : `${count} records ${report.completeWithinScope ? 'fully retrieved within this query scope, without the four-row preview limit.' : 'partially retrieved; completeness is unverified.'}`,
    '', zh ? '| 員工姓名／ID | 下班時間（本地） | 打卡 ID |' : '| Employee name / ID | Clock-out (local) | Punch ID |', '|---|---|---|']
  for (const r of report.rows) lines.push(`| ${cell(r.employeeName || (zh ? '姓名未核實' : 'Name unavailable'))} / ${r.userId} | ${displayTime(r.clockedOut)} | ${r.punchId} |`)
  if (!count) lines.push(zh ? '這個已查詢範圍未回傳下班打卡；不代表當天沒有員工上班或沒有未下班的班次。' : 'No clock-out rows were returned for this scope. This does not prove nobody worked or that no shifts remain open.')
  if (report.unresolvedNames) lines.push(zh ? `${report.unresolvedNames} 筆姓名未核實，已保留員工 ID 與已核實的打卡時間。` : `${report.unresolvedNames} rows have unresolved names; verified IDs and punch times are retained.`)
  lines.push('', zh ? `來源：7shifts 固定 GET time_punches 與 users；核對時間 ${report.retrievedAt}。未修改打卡或提交薪資。` : `Source: fixed 7shifts GET time_punches and users; checked ${report.retrievedAt}. No punch or payroll changes.`)
  return lines.join('\n')
}
module.exports = { TIME_ZONE, clockOutRequest, queryWindow, createSevenShiftsReport, reportReply, displayTime }
