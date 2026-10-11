'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const { createSevenShiftsReadAdapter } = require('./adapters/sevenShiftsRead')
const { createSevenShiftsReport } = require('./sevenShiftsReport')
const env = () => ({ READ_ACCESS: 'on', CONTEXT_SEVEN_SHIFTS: 'on', SEVEN_SHIFTS_COMPANY_ID: '123', SEVEN_SHIFTS_ACCESS_TOKEN: 'synthetic-comparison-secret' })
const now = '2026-10-10T18:00:00Z', owner = { id: 'owner', role: 'owner' }, day = { window: 'dates', dates: ['2026-10-09'] }
const shift = (id, user, start, end) => ({ id, company_id: 123, user_id: user, location_id: 5, start, end, draft: false, deleted: false, publish_status: 'published', open: false, unassigned: false })
const punch = (id, user, shiftId, start, end) => ({ id, company_id: 123, user_id: user, shift_id: shiftId, location_id: 5, clocked_in: start, clocked_out: end, deleted: false, auto_clocked_out: false })
function fixture (shifts, punches, options = {}) {
  const e = env(), calls = []
  const adapter = createSevenShiftsReadAdapter({ env: e, clock: () => now, fetchFn: async (url, opts) => {
    const u = new URL(url); calls.push([u, opts]); options.onRead?.(u, e)
    if (options.status) return { ok: false, status: options.status }
    const names = u.pathname.includes('/users/')
    return { ok: true, json: async () => names ? { data: { id: Number(u.pathname.split('/').at(-1)), company_id: 123, first_name: 'Employee', last_name: u.pathname.split('/').at(-1), email: 'private@example.test' } } :
      { data: (u.pathname.endsWith('/shifts') ? shifts : punches).map(p => ({ ...p, hourly_wage: 9999, notes: 'private-note' })), meta: { cursor: { next: options.next ?? null } }, object: u.pathname.endsWith('/shifts') ? 'shifts' : 'time_punches' } }
  } })
  return { e, calls, adapter, service: createSevenShiftsReport({ env: e, adapter, clock: () => now }) }
}

test('comparison intent is bilingual, date bounded and excludes quoted, negated and write requests', () => {
  const { comparisonRequest } = require('./sevenShiftsComparison')
  for (const message of ['幫我查昨日哪些員工的打卡與排班不一致，列出原因和需要確認的項目。', 'Compare employee punches against scheduled shifts yesterday.', '查 2026-10-09 排班與打卡對照']) assert.ok(comparisonRequest(message))
  for (const message of ['不要查排班與打卡', '修改排班與打卡', 'Approve schedule and punches yesterday', '"Compare punches with schedules"', 'Explain schedule and punches', '查昨天所有員工下班時間']) assert.equal(comparisonRequest(message), null)
  assert.equal(comparisonRequest('Compare punches with schedules').window, 'unspecified')
})

test('real bounded transport reads published shifts and adjacent-day punches, compares exact links and keeps uncertainty', async () => {
  const shifts = [shift(10, 1, '2026-10-09T15:00:00Z', '2026-10-09T23:00:00Z'), shift(11, 2, '2026-10-10T03:00:00Z', '2026-10-10T07:00:00Z'), shift(12, 3, '2026-10-09T15:00:00Z', '2026-10-09T23:00:00Z'), shift(13, 4, '2026-10-09T16:00:00Z', '2026-10-09T23:00:00Z')]
  const punches = [punch(20, 1, 10, '2026-10-09T15:10:00Z', '2026-10-09T23:00:00Z'), punch(21, 2, 11, '2026-10-10T03:00:00Z', '2026-10-10T07:00:00Z'), punch(22, 3, 12, '2026-10-09T15:00:00Z', null)]
  const f = fixture(shifts, punches), report = await f.service.readComparison(owner, day)
  assert.equal(report.state, 'live'); assert.equal(report.rows.length, 4); assert.equal(report.completeWithinScope, true)
  assert.equal(report.rows[0].startDifferenceMinutes, 10); assert.equal(report.rows[0].matchState, 'CONFIRMED'); assert.ok(report.rows[0].findings.includes('later_clock_in'))
  const row = id => report.rows.find(r => r.shiftId === id)
  assert.equal(row(11).overnight, true); assert.deepEqual(row(11).findings, [])
  assert.ok(row(12).findings.includes('unclosed_after_scheduled_end')); assert.equal(row(12).currentlyWorkingState, 'UNKNOWN')
  assert.ok(row(13).findings.includes('no_linked_punch')); assert.equal(row(13).absenceState, 'UNKNOWN')
  const s = f.calls.find(([u]) => u.pathname.endsWith('/shifts'))[0], p = f.calls.find(([u]) => u.pathname.endsWith('/time_punches'))[0]
  assert.equal(s.searchParams.get('start[gte]'), '2026-10-09T05:00:00.000Z'); assert.equal(s.searchParams.get('draft'), 'false'); assert.equal(s.searchParams.get('consider_tz_in_ranges'), 'true')
  assert.equal(f.calls.find(([u]) => u.pathname.endsWith('/shifts'))[1].headers['x-api-version'], '2026-01-01')
  assert.equal(f.calls.find(([u]) => u.pathname.endsWith('/time_punches'))[1].headers['x-api-version'], '2025-03-01')
  assert.equal(p.searchParams.get('clocked_in[gte]'), '2026-10-08T05:00:00.000Z'); assert.equal(p.searchParams.get('clocked_in[lte]'), '2026-10-11T04:59:59.999Z')
  for (const [u, o] of f.calls) { assert.equal(u.origin, 'https://api.7shifts.com'); assert.equal(o.method, 'GET'); assert.equal(o.redirect, 'error') }
  for (const absent of ['synthetic-comparison-secret', 'private@example', 'hourly_wage', 'private-note']) assert.equal(JSON.stringify(report).includes(absent), false)
  assert.equal(report.modelCalls, 0); assert.equal(report.writes, false)
  const { comparisonReply } = require('./sevenShiftsComparison')
  for (const lang of ['zh', 'en']) { const reply = comparisonReply(report, lang); assert.match(reply, /Employee 1/); assert.match(reply, /UNKNOWN/); assert.match(reply, /2026-10-10 02:00/); assert.match(reply, /CANDIDATE/); assert.match(reply, /Winnipeg/) }
})

test('multiple punches aggregate a shift and approximate or ambiguous matches never establish misconduct or absence', async () => {
  const shifts = [shift(10, 1, '2026-10-09T15:00:00Z', '2026-10-09T23:00:00Z'), shift(11, 2, '2026-10-09T16:00:00Z', '2026-10-09T22:00:00Z'), shift(12, 2, '2026-10-09T16:30:00Z', '2026-10-09T22:00:00Z'), shift(13, 3, '2026-10-09T15:00:00Z', '2026-10-09T23:00:00Z')]
  const punches = [punch(20, 1, 10, '2026-10-09T15:00:00Z', '2026-10-09T18:00:00Z'), punch(21, 1, 10, '2026-10-09T18:30:00Z', '2026-10-09T23:00:00Z'), punch(22, 2, null, '2026-10-09T17:00:00Z', '2026-10-09T21:00:00Z'), { ...punch(23, 3, null, '2026-10-09T15:05:00Z', '2026-10-09T22:00:00Z'), auto_clocked_out: true }]
  const report = await fixture(shifts, punches).service.readComparison(owner, day)
  assert.equal(report.rows[0].punchIds.length, 2); assert.deepEqual(report.rows[0].findings, [])
  const row = id => report.rows.find(r => r.shiftId === id)
  assert.equal(row(11).matchState, 'UNKNOWN'); assert.equal(row(12).matchState, 'UNKNOWN'); assert.equal(report.unmatchedPunches.length, 1)
  assert.equal(row(13).matchState, 'SUPPORTED'); assert.ok(row(13).findings.includes('approximate_match')); assert.ok(row(13).findings.includes('auto_clocked_out'))
  assert.ok(report.rows.every(r => r.absenceState === 'UNKNOWN' && r.currentlyWorkingState === 'UNKNOWN'))
})

test('invalid shift rows, exact-link contradictions, source errors and revoked access fail closed without expanding permissions', async () => {
  const s = shift(10, 1, '2026-10-09T15:00:00Z', '2026-10-09T23:00:00Z'), p = punch(20, 1, 10, '2026-10-09T15:00:00Z', '2026-10-09T23:00:00Z')
  for (const changed of [{ company_id: 456 }, { draft: true }, { publish_status: 'draft' }, { deleted: true }, { start: '2026-02-30T15:00:00Z' }, { end: s.start }, { user_id: -1 }, { id: '10' }]) {
    const report = await fixture([{ ...s, ...changed }], [p]).service.readComparison(owner, day)
    assert.equal(report.state, 'unavailable'); assert.equal(report.reason, 'invalid_source_response')
  }
  const contradiction = await fixture([s], [{ ...p, user_id: 2 }]).service.readComparison(owner, day)
  assert.equal(contradiction.state, 'live'); assert.equal(contradiction.rows[0].matchState, 'CONTRADICTED'); assert.ok(contradiction.rows[0].findings.includes('link_contradiction'))
  for (const [status, reason] of [[403, 'source_not_authorised'], [429, 'source_rate_limited'], [500, 'source_unavailable']]) assert.equal((await fixture([s], [p], { status }).service.readComparison(owner, day)).reason, reason)
  const revoked = fixture([s], [p], { onRead: (u, e) => { e.READ_ACCESS = 'off' } })
  assert.equal((await revoked.service.readComparison(owner, day)).reason, 'read_access_disabled'); assert.equal(revoked.calls.length, 1)
  await assert.rejects(() => fixture([], []).service.readComparison({ id: 'other', role: 'owner' }, day), /permission_denied/)
})

test('empty, partial, future and invalid dates are explicit; DST padding uses civil days and unavailable evidence stays unavailable', async () => {
  const f = fixture([], [])
  assert.equal((await f.service.readComparison(owner, { window: 'unspecified' })).state, 'needs_date'); assert.equal(f.calls.length, 0)
  for (const dates of [['2026-02-30'], ['2026-10-11'], ['2026-10-08', '2026-10-09']]) assert.equal((await f.service.readComparison(owner, { window: 'dates', dates })).reason, 'invalid_request')
  const empty = await f.service.readComparison(owner, day); assert.equal(empty.state, 'live'); assert.equal(empty.rows.length, 0)
  const { comparisonWindows } = require('./sevenShiftsComparison')
  const dst = comparisonWindows({ window: 'dates', dates: ['2026-03-08'] }, now)
  assert.equal(Date.parse(dst.query.end) - Date.parse(dst.query.start), 23 * 3600000)
  assert.equal(Date.parse(dst.punchQuery.end) - Date.parse(dst.punchQuery.start), 71 * 3600000)
  const partialAdapter = { methods: { listShifts: async q => ({ results: [], evidence: { trust: 'live', returnedRows: 0, completeWithinScope: false, queryScope: { companyId: 123, field: 'start', window: q.timeMin + '..' + q.timeMax } } }), listAttendance: async q => ({ results: [], evidence: { trust: 'live', returnedRows: 0, completeWithinScope: true, queryScope: { companyId: 123, field: 'clocked_in', window: q.timeMin + '..' + q.timeMax } } }) } }
  const partial = await createSevenShiftsReport({ env: env(), adapter: partialAdapter, clock: () => now }).readComparison(owner, day)
  assert.equal(partial.completeWithinScope, false); assert.match(require('./sevenShiftsComparison').comparisonReply(partial, 'en'), /partial/i)
  partialAdapter.methods.listShifts = async () => ({ results: [], evidence: { trust: 'cached' } })
  assert.equal((await createSevenShiftsReport({ env: env(), adapter: partialAdapter, clock: () => now }).readComparison(owner, day)).reason, 'invalid_source_response')
})

test('future-start and unassigned shifts make no omission finding; page limits and opaque cursors never imply completeness', async () => {
  const future = shift(10, 1, '2026-10-10T20:00:00Z', '2026-10-11T03:00:00Z'), open = { ...shift(11, null, '2026-10-10T19:00:00Z', '2026-10-11T03:00:00Z'), open: true, unassigned: true }
  const report = await fixture([future, open], []).service.readComparison(owner, { window: 'today' })
  assert.equal(report.state, 'live'); assert.ok(report.rows.find(r => r.shiftId === 10).findings.includes('no_punch_before_scheduled_start')); assert.equal(report.rows.find(r => r.shiftId === 10).discrepancyState, 'UNKNOWN')
  assert.ok(report.rows.find(r => r.shiftId === 11).findings.includes('unassigned_shift')); assert.equal(report.rows.find(r => r.shiftId === 11).discrepancyState, 'UNKNOWN')
  let pages = 0
  const adapter = createSevenShiftsReadAdapter({ env: env(), fetchFn: async () => ({ ok: true, json: async () => ({ data: [], meta: { cursor: { next: 'cursor-' + ++pages } }, object: 'shifts' }) }) })
  const q = { timeMin: '2026-10-09T05:00:00Z', timeMax: '2026-10-10T04:59:59.999Z' }, result = await adapter.methods.listShifts(q)
  assert.equal(pages, 3); assert.equal(result.evidence.completeWithinScope, false); assert.equal(result.evidence.truncated, true)
  const repeated = fixture([], [], { next: 'https://evil.test/cursor' })
  await assert.rejects(() => repeated.adapter.methods.listShifts(q), /invalid_source_response/)
  assert.equal(repeated.calls.length, 2); assert.ok(repeated.calls.every(([u]) => u.origin === 'https://api.7shifts.com'))
  for (const invalid of [{ ...q, endpoint: 'https://evil.test' }, { ...q, userId: 1 }, { ...q, timeMin: '2026-02-30T05:00:00Z' }]) await assert.rejects(() => adapter.methods.listShifts(invalid), /invalid_request/)
})
