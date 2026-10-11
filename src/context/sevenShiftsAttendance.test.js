'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { createSevenShiftsReport, clockOutRequest } = require('./sevenShiftsReport')
const { createSevenShiftsReadAdapter } = require('./adapters/sevenShiftsRead')
const env = () => ({ READ_ACCESS: 'on', CONTEXT_SEVEN_SHIFTS: 'on', SEVEN_SHIFTS_COMPANY_ID: '123', SEVEN_SHIFTS_ACCESS_TOKEN: 'synthetic-attendance-secret' })
const owner = { id: 'owner', role: 'owner' }, now = '2026-10-10T18:00:00Z'
const punch = (id, start, end) => ({ id, company_id: 123, user_id: id, clocked_in: start, clocked_out: end, deleted: false, approved: false, auto_clocked_out: false })
const request = { window: 'dates', dates: ['2026-10-09'] }

test('attendance intent owns missing-clock-out questions in both languages and never steals ordinary clock-out, quoted or write requests', () => {
  const { attendanceRequest } = require('./sevenShiftsAttendance')
  for (const q of ['幫我查昨日有哪些員工漏打下班卡。', '查 2026-10-09 未打下班卡的員工', 'Which employees missed clock-out yesterday?', 'Check missing clock-outs in 7shifts on 2026-10-09']) {
    assert.ok(attendanceRequest(q)); assert.equal(clockOutRequest(q), null)
  }
  assert.equal(attendanceRequest('幫我查昨日有哪些員工漏打下班卡。').window, 'yesterday')
  assert.equal(attendanceRequest('Find missing clock-out punches for employees').window, 'unspecified')
  for (const q of ['Read 7shifts clock-out times yesterday', '不要查漏打下班卡', 'Approve missing 7shifts clock-outs yesterday', '修改漏打下班卡', '"Which employees missed clock-out yesterday?"', 'Explain what a missing clock-out means']) assert.equal(attendanceRequest(q), null)
})

test('real named attendance reader selects clock-in dates, retains open punches, proves pagination and projects only approved fields', async () => {
  const calls = [], e = env(), rows = [punch(1, '2026-10-09T21:00:00Z', null), punch(2, '2026-10-10T03:00:00Z', '2026-10-10T06:00:00Z')]
  const adapter = createSevenShiftsReadAdapter({ env: e, clock: () => now, fetchFn: async (url, options) => {
    calls.push([new URL(url), options]); const u = new URL(url)
    if (u.pathname.includes('/users/')) return { ok: true, json: async () => ({ data: { id: Number(u.pathname.split('/').at(-1)), company_id: 123, first_name: 'Employee', last_name: u.pathname.split('/').at(-1), email: 'private@example.test', hourly_wage: 9000 } }) }
    return { ok: true, json: async () => ({ data: rows.map(p => ({ ...p, notes: 'private-note', hourly_wage: 9000 })), meta: { cursor: { next: null } }, object: 'time_punches' }) }
  } })
  assert.equal(typeof adapter.methods.listAttendance, 'function')
  const value = await adapter.methods.listAttendance({ timeMin: '2026-10-09T05:00:00Z', timeMax: '2026-10-10T04:59:59.999Z' })
  assert.equal(calls[0][0].searchParams.get('clocked_in[gte]'), '2026-10-09T05:00:00.000Z')
  assert.equal(calls[0][0].searchParams.has('clocked_out[gte]'), false)
  assert.equal(value.evidence.completeWithinScope, true); assert.equal(value.evidence.queryScope.field, 'clocked_in')
  assert.equal(value.results[0].fields.clockedOut, null); assert.equal(value.results[0].fields.employeeName, 'Employee 1')
  assert.equal(value.results[1].fields.clockedOut, '2026-10-10T06:00:00Z')
  for (const [u, opts] of calls) { assert.equal(u.origin, 'https://api.7shifts.com'); assert.equal(opts.method, 'GET'); assert.equal(opts.redirect, 'error') }
  for (const absent of ['synthetic-attendance-secret', 'private@example', 'hourly_wage', 'private-note']) assert.equal(JSON.stringify(value).includes(absent), false)
})

test('historical unclosed records are candidates; overnight and auto clock-outs never become missing punches', async () => {
  const rows = [punch(1, '2026-10-09T14:00:00Z', null), punch(2, '2026-10-10T03:00:00Z', '2026-10-10T06:30:00Z'), { ...punch(3, '2026-10-09T15:00:00Z', '2026-10-09T23:00:00Z'), auto_clocked_out: true }, punch(4, '2026-10-09T16:00:00Z', '2026-10-09T22:00:00Z')]
  const { attendanceReply } = require('./sevenShiftsAttendance')
  const adapter = { methods: { listAttendance: async () => ({ results: rows.map(p => ({ fields: { companyId: 123, userId: p.user_id, punchId: p.id, clockedIn: p.clocked_in, clockedOut: p.clocked_out, autoClockedOut: p.auto_clocked_out, employeeName: 'Employee ' + p.id, nameState: 'confirmed' } })), evidence: { trust: 'live', completeWithinScope: true, returnedRows: rows.length, queryScope: { companyId: 123, field: 'clocked_in', window: '2026-10-09T05:00:00.000Z..2026-10-10T04:59:59.999Z' } } }) } }
  const service = createSevenShiftsReport({ env: env(), adapter, clock: () => now })
  assert.equal(typeof service.readAttendance, 'function')
  const report = await service.readAttendance(owner, request)
  assert.equal(report.state, 'live'); assert.equal(report.rows.length, 4)
  assert.deepEqual(report.rows.map(r => r.status), ['unclosed_historical', 'closed_overnight', 'auto_clocked_out', 'closed'])
  assert.equal(report.rows[0].missingClockOutState, 'CANDIDATE'); assert.equal(report.rows[0].currentlyWorkingState, 'UNKNOWN')
  assert.equal(report.rows[1].clockOutState, 'CONFIRMED'); assert.equal(report.rows[1].missingClockOutState, 'CONTRADICTED')
  assert.equal(report.rows[2].missingClockOutState, 'UNKNOWN'); assert.equal(report.rows[2].manualClockOutState, 'UNKNOWN')
  assert.deepEqual(report.counts, { unclosedHistorical: 1, unclosedCurrent: 0, overnightClosed: 1, autoClockedOut: 1, closed: 1 })
  assert.equal(report.writes, false); assert.equal(report.modelCalls, 0)
  for (const lang of ['zh', 'en']) { const reply = attendanceReply(report, lang); assert.match(reply, /CANDIDATE/); assert.match(reply, /UNKNOWN/); assert.match(reply, /Employee 1/); assert.match(reply, /2026-10-10 01:30/); assert.match(reply, /Winnipeg/); assert.equal(reply.includes('synthetic-attendance-secret'), false) }
})

test('today, incomplete pagination, no punch rows and revoked reads cannot establish absence or current working status', async () => {
  const { attendanceRequest, attendanceReply } = require('./sevenShiftsAttendance')
  let result = { results: [{ fields: { companyId: 123, userId: 1, punchId: 1, clockedIn: '2026-10-10T16:00:00Z', clockedOut: null } }], evidence: { trust: 'live', completeWithinScope: false, returnedRows: 1, queryScope: { companyId: 123, field: 'clocked_in', window: '2026-10-10T05:00:00.000Z..2026-10-11T04:59:59.999Z' } } }
  let calls = 0; const e = env(), service = createSevenShiftsReport({ env: e, adapter: { methods: { listAttendance: async () => { calls++; return result } } }, clock: () => now })
  const report = await service.readAttendance(owner, attendanceRequest('Which employees missed clock-out today?'))
  assert.equal(report.completeWithinScope, false); assert.equal(report.rows[0].status, 'unclosed_current'); assert.equal(report.rows[0].missingClockOutState, 'UNKNOWN'); assert.equal(report.rows[0].currentlyWorkingState, 'UNKNOWN')
  assert.match(attendanceReply(report, 'en'), /partial|incomplete/i)
  result = { results: [], evidence: { trust: 'live', returnedRows: 0, completeWithinScope: true, queryScope: { companyId: 123, field: 'clocked_in', window: '2026-10-09T05:00:00.000Z..2026-10-10T04:59:59.999Z' } } }
  assert.match(attendanceReply(await service.readAttendance(owner, request), 'en'), /does not prove/i)
  const before = calls; e.READ_ACCESS = 'off'
  assert.equal((await service.readAttendance(owner, request)).state, 'unavailable'); assert.equal(calls, before)
  await assert.rejects(service.readAttendance({ id: 'other', role: 'manager' }, request), /permission_denied/)
})

test('attendance civil days preserve DST and reject impossible/future days and out-of-scope source rows', async () => {
  const { attendanceRequest } = require('./sevenShiftsAttendance')
  let input; const e = env(), service = createSevenShiftsReport({ env: e, clock: () => now, adapter: { methods: { listAttendance: async q => { input = q; return { results: [], evidence: { trust: 'live', returnedRows: 0, completeWithinScope: true, queryScope: { companyId: 123, field: 'clocked_in', window: q.timeMin + '..' + q.timeMax } } } } } } })
  assert.equal((await service.readAttendance(owner, attendanceRequest('查 2026-03-08 員工漏打下班卡'))).state, 'live')
  assert.equal(Date.parse(input.timeMax) - Date.parse(input.timeMin) + 1, 23 * 3600000)
  for (const date of ['2026-02-30', '2027-01-01']) assert.equal((await service.readAttendance(owner, attendanceRequest('Check 7shifts missing clock-out ' + date))).state, 'unavailable')
})

test('named attendance transport preserves unknown completeness and names, caps pages, and fails closed on revoked or malformed reads', async () => {
  const query = { timeMin: '2026-10-09T05:00:00Z', timeMax: '2026-10-10T04:59:59.999Z' }
  const row = punch(1, '2026-10-09T14:00:00Z', null)
  for (const metadata of [undefined, { cursor: {} }, { cursor: { next: 'next-page' } }]) {
    let pages = 0
    const adapter = createSevenShiftsReadAdapter({ env: env(), fetchFn: async u => {
      if (new URL(u).pathname.includes('/users/')) return { ok: false, status: 404 }
      return { ok: true, json: async () => ({ data: [{ ...row, id: ++pages }], ...(metadata ? { meta: metadata } : {}) }) }
    } })
    if (metadata?.cursor?.next) await assert.rejects(adapter.methods.listAttendance(query), /invalid_source_response/)
    else { const value = await adapter.methods.listAttendance(query); assert.equal(value.evidence.completeWithinScope, false); assert.equal(value.results[0].fields.employeeName, null); assert.equal(value.results[0].fields.nameState, 'unavailable') }
  }
  let pages = 0
  const capped = createSevenShiftsReadAdapter({ env: env(), fetchFn: async u => new URL(u).pathname.includes('/users/') ? { ok: false, status: 404 } : { ok: true, json: async () => ({ data: [{ ...row, id: ++pages }], meta: { cursor: { next: 'page-' + pages } } }) } })
  const partial = await capped.methods.listAttendance(query); assert.equal(pages, 3); assert.equal(partial.evidence.truncated, true); assert.equal(partial.results.length, 3)
  for (const bad of [{ company_id: 999 }, { clocked_in: '2026-10-08T14:00:00Z' }, { clocked_in: '2026-02-30T14:00:00Z' }, { clocked_out: 'bad' }, { auto_clocked_out: true }, { clocked_out: '2026-10-09T13:00:00Z' }]) {
    const adapter = createSevenShiftsReadAdapter({ env: env(), fetchFn: async () => ({ ok: true, json: async () => ({ data: [{ ...row, ...bad }], meta: { cursor: { next: null } } }) }) })
    await assert.rejects(adapter.methods.listAttendance(query), /invalid_source_response/)
  }
  const e = env(), revoked = createSevenShiftsReadAdapter({ env: e, fetchFn: async () => { e.READ_ACCESS = 'off'; return { ok: true, json: async () => ({ data: [row], meta: { cursor: { next: null } } }) } } })
  await assert.rejects(revoked.methods.listAttendance(query), /read_access_disabled/)
  for (const status of [401, 403, 429, 500]) {
    const a = createSevenShiftsReadAdapter({ env: env(), fetchFn: async () => ({ ok: false, status }) })
    await assert.rejects(a.methods.listAttendance(query), new RegExp(status === 401 || status === 403 ? 'source_not_authorised' : status === 429 ? 'source_rate_limited' : 'source_unavailable'))
  }
  for (const extra of [{ url: 'https://evil.test' }, { method: 'POST' }, { userId: 7 }]) {
    let calls = 0; const a = createSevenShiftsReadAdapter({ env: env(), fetchFn: async () => { calls++ } })
    await assert.rejects(a.methods.listAttendance({ ...query, ...extra }), /invalid_request/); assert.equal(calls, 0)
  }
})

test('the report rejects wrong scope, duplicate rows, bad chronology and missing source clock-out fields rather than giving a false zero', async () => {
  const p = { companyId: 123, userId: 7, punchId: 1, clockedIn: '2026-10-09T14:00:00Z', clockedOut: null }
  const evidence = { trust: 'live', completeWithinScope: true, returnedRows: 1, queryScope: { companyId: 123, field: 'clocked_in', window: '2026-10-09T05:00:00.000Z..2026-10-10T04:59:59.999Z' } }
  const { attendanceReply } = require('./sevenShiftsAttendance')
  for (const result of [
    { results: [{ fields: { ...p, clockedIn: '2026-10-08T14:00:00Z' } }], evidence },
    { results: [{ fields: { ...p, clockedOut: undefined } }], evidence },
    { results: [{ fields: { ...p, clockedOut: '2026-10-11T01:00:00Z' } }], evidence },
    { results: [{ fields: { ...p, clockedOut: '2026-10-09T13:00:00Z' } }], evidence },
    { results: [{ fields: p }, { fields: p }], evidence: { ...evidence, returnedRows: 2 } },
    { results: [{ fields: p }], evidence: { ...evidence, trust: 'stale' } },
    { results: [{ fields: p }], evidence: { ...evidence, queryScope: { ...evidence.queryScope, field: 'clocked_out' } } },
    { results: [{ fields: p }], evidence: { ...evidence, queryScope: { ...evidence.queryScope, window: 'different' } } }
  ]) {
    const service = createSevenShiftsReport({ env: env(), clock: () => now, adapter: { methods: { listAttendance: async () => result } } })
    const report = await service.readAttendance(owner, request)
    assert.equal(report.state, 'unavailable'); assert.equal(report.reason, 'invalid_source_response'); assert.equal(report.counts, undefined)
    assert.match(attendanceReply(report, 'en'), /does not establish/)
  }
})
