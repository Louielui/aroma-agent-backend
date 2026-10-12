'use strict'
const test = require('node:test'), assert = require('node:assert/strict')

test('the actual acceptance reviewer accepts the closed 7shifts source packet', () => {
  const providers = require('../core/workerFlow/providers')
  const source = { 'src/context/adapters/sevenShiftsRead.js': 'source', 'src/context/contextResult.js': 'dependency' }
  assert.deepEqual(providers.acceptanceReviewFiles({ source }), ['acceptance/registered-task.test.cjs'])
  assert.throws(() => providers.acceptanceReviewFiles({ source: { ...source, '.env': 'forbidden' } }), /invalid_worker_result/)
})

test('Winnipeg yesterday, explicit days and DST use calendar boundaries, never a rolling 24-hour window', () => {
  const { clockOutRequest, queryWindow } = require('./sevenShiftsReport')
  const request = clockOutRequest('查昨天所有員工的下班打卡時間，顯示姓名及 Winnipeg 本地時間。')
  assert.equal(request.window, 'yesterday')
  assert.equal(clockOutRequest('Show all employees 7shifts clock-out times yesterday in Winnipeg, with names.').window, 'yesterday')
  const q = queryWindow(request, '2026-10-10T18:00:00Z')
  assert.equal(q.start, '2026-10-09T05:00:00.000Z'); assert.equal(q.end, '2026-10-10T05:00:00.000Z')
  for (const [date, hours] of [['2026-03-08', 23], ['2026-11-01', 25]]) {
    const range = queryWindow(clockOutRequest('7shifts all employee clock out ' + date), '2026-10-10T18:00:00Z')
    assert.equal((Date.parse(range.end) - Date.parse(range.start)) / 3600000, hours)
  }
  assert.throws(() => queryWindow(clockOutRequest('7shifts clock out 2026-02-30'), '2026-10-10T18:00:00Z'), /invalid_request/)
  assert.equal(clockOutRequest('approve all 7shifts time punches'), null)
  assert.equal(clockOutRequest('7shifts clock out payroll send'), null)
})

test('missing implementation proposes a bounded gap, while revoked access makes no query or development claim', async () => {
  const { createSevenShiftsReport, clockOutRequest } = require('./sevenShiftsReport')
  const env = { READ_ACCESS: 'on', CONTEXT_SEVEN_SHIFTS: 'on', SEVEN_SHIFTS_COMPANY_ID: '123', SEVEN_SHIFTS_ACCESS_TOKEN: 'synthetic' }
  let calls = 0
  const service = createSevenShiftsReport({ env, adapter: { methods: {} }, clock: () => '2026-10-10T18:00:00Z' })
  const request = clockOutRequest('7shifts clock out yesterday')
  const report = await service.read({ id: 'owner', role: 'owner' }, request)
  assert.equal(report.state, 'capability_gap'); assert.equal(report.gap.kind, 'unmapped_read')
  assert.equal(report.gap.capability, 'seven_shifts.read')
  const guarded = createSevenShiftsReport({ env, adapter: { methods: { listClockOuts: async () => { calls++; throw Error('must not run') } } } })
  const lease = guarded.captureAccess(); env.CONTEXT_SEVEN_SHIFTS = 'off'
  assert.throws(lease, /read_access_disabled/)
  const unavailable = await guarded.read({ id: 'owner', role: 'owner' }, request)
  assert.equal(unavailable.state, 'unavailable'); assert.equal(unavailable.gap, undefined); assert.equal(calls, 0)
})

test('the full source report retains all rows, local dates, gaps and evidence instead of the four-row preview', async () => {
  const { createSevenShiftsReport, clockOutRequest, reportReply } = require('./sevenShiftsReport')
  const env = { READ_ACCESS: 'on', CONTEXT_SEVEN_SHIFTS: 'on', SEVEN_SHIFTS_COMPANY_ID: '123', SEVEN_SHIFTS_ACCESS_TOKEN: 'synthetic' }
  const rows = Array.from({ length: 6 }, (_, i) => ({ sourceId: '123:' + (i + 1), fields: { companyId: 123, userId: i + 10, punchId: i + 1, employeeName: i === 5 ? null : 'Employee ' + i, nameState: i === 5 ? 'unavailable' : 'confirmed', clockedIn: '2026-10-09T03:00:00Z', clockedOut: '2026-10-09T06:30:00Z', approved: false, autoClockedOut: false } }))
  let input
  const adapter = { methods: { listClockOuts: async q => {
    input = q
    return { results: rows, evidence: { trust: 'live', completeWithinScope: true, returnedRows: 6, queryScope: { companyId: 123, field: 'clocked_out' } } }
  } } }
  const service = createSevenShiftsReport({ env, clock: () => '2026-10-10T18:00:00Z', adapter })
  const report = await service.read({ id: 'owner', role: 'owner' }, clockOutRequest('7shifts clock out yesterday'))
  assert.equal(input.timeMin, '2026-10-09T05:00:00.000Z'); assert.equal(input.timeMax, '2026-10-10T04:59:59.999Z')
  assert.equal(report.rows.length, 6); assert.equal(report.unresolvedNames, 1); assert.equal(report.completeWithinScope, true)
  const reply = reportReply(report, 'zh')
  assert.match(reply, /2026-10-09 01:30/); assert.match(reply, /Employee 4/); assert.match(reply, /15/)
  assert.match(reply, /America\/Winnipeg/); assert.match(reply, /6/); assert.match(reply, /姓名/)
  assert.equal(reply.includes('synthetic'), false)
  rows[0].fields.clockedOut = '2026-10-10T05:00:00Z'
  assert.equal((await service.read({ id: 'owner', role: 'owner' }, clockOutRequest('7shifts clock out yesterday'))).state, 'unavailable')
})
