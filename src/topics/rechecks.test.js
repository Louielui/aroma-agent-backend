'use strict'
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { createTopicStore } = require('./workspaces'), { createConversationStore } = require('../store/conversationStore'), { createSnapshot, createEvidenceFollowups } = require('./evidenceFollowups')
const report = () => ({ state: 'live', companyId: 123, query: { firstDate: '2026-10-09', timeZone: 'America/Winnipeg' }, retrievedAt: '2026-10-10T18:00:00Z', completeWithinScope: true,
  rows: [{ userId: 7, shiftId: 9, employeeName: 'Fixture employee', punchIds: [11], scheduledStart: '2026-10-09T15:00:00Z', scheduledEnd: '2026-10-09T23:00:00Z', clockedIn: '2026-10-09T15:00:00Z', clockedOut: null, matchState: 'CONFIRMED', findings: ['unclosed_after_scheduled_end'] }], unmatchedPunches: [] })
function setup (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-rechecks-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const store = createTopicStore({ dataDir: dir }), conversations = createConversationStore({ dataDir: dir }), snapshot = createSnapshot('comparison', report(), 'source-report')
  store.link('hr', 'hr-fixture'); conversations.appendTurn({ id: 'hr-fixture', userText: 'Compare', replyText: 'Report', evidenceReport: snapshot })
  const saved = createEvidenceFollowups({ store, conversations }).accept('hr', { conversationId: 'hr-fixture', reportId: snapshot.id, keys: [snapshot.candidates[0].key], confirmed: true })
  return { dir, store, conversations, note: saved.notes[0] }
}
test('fresh exact evidence proposes completion but only confirmed revision-bound selection updates notes; original source and next step survive reload', async t => {
  const { createRechecks } = require('./rechecks'), x = setup(t), fresh = report(); fresh.retrievedAt = '2026-10-11T18:00:00Z'; fresh.rows[0].clockedOut = fresh.rows[0].scheduledEnd; fresh.rows[0].findings = []
  let reads = 0; const service = createRechecks({ store: x.store, reader: { captureAccess: () => () => {}, readComparison: async () => { reads++; return fresh } }, clock: () => '2026-10-11T18:01:00Z' })
  const preview = await service.prepare('hr', { conversationId: 'hr-fixture', requestId: 'check-fixture' })
  assert.equal(preview.items[0].result.state, 'changed'); assert.equal(preview.items[0].result.suggestedState, 'done'); assert.equal(x.store.get('hr').notes[0].state, 'todo')
  assert.deepEqual(await service.prepare('hr', { conversationId: 'hr-fixture', requestId: preview.id }), preview); assert.equal(reads, 1)
  assert.throws(() => service.accept('hr', { id: preview.id, keys: [x.note.id], confirmed: false }), /confirmation_required/)
  assert.throws(() => service.accept('hr', { id: preview.id, keys: ['forged-note'], confirmed: true }), /invalid_request/)
  const body = { id: preview.id, keys: [x.note.id], confirmed: true }, accepted = service.accept('hr', body)
  assert.equal(accepted.notes[0].state, 'done'); assert.equal(accepted.notes[0].nextStep, x.note.nextStep); assert.deepEqual(accepted.notes[0].source, x.note.source)
  assert.equal(service.accept('hr', body).notes[0].revision, 2)
  const reopened = createTopicStore({ dataDir: x.dir }); assert.equal(reopened.get('hr').notes[0].lastRecheckId, preview.id)
  assert.equal(reopened.getRecheck('hr', preview.id).items[0].result.after.evidence.clockedOut, fresh.rows[0].clockedOut)
})
test('absence, partial, contradictory, reassigned, stale and denied reads never become resolved facts', async t => {
  const { createRechecks } = require('./rechecks'), x = setup(t)
  const fixtures = []
  const missing = report(); missing.rows = []; fixtures.push([missing, 'unknown'])
  const reassigned = report(); reassigned.rows[0].userId = 8; fixtures.push([reassigned, 'unknown'])
  const partial = report(); partial.completeWithinScope = false; partial.rows[0].findings = []; partial.rows[0].clockedOut = partial.rows[0].scheduledEnd; fixtures.push([partial, 'unknown'])
  const contrary = report(); contrary.rows[0].matchState = 'CONTRADICTED'; fixtures.push([contrary, 'unknown'])
  fixtures.push([{ state: 'unavailable', reason: 'source_not_authorised' }, 'unavailable'])
  fixtures.push([{ ...report(), retrievedAt: '2026-10-09T18:00:00Z' }, 'unknown'])
  for (let i = 0; i < fixtures.length; i++) {
    const [value, expected] = fixtures[i]; if (value.state === 'live' && i !== 5) value.retrievedAt = '2026-10-11T18:00:00Z'
    const service = createRechecks({ store: x.store, reader: { captureAccess: () => () => {}, readComparison: async () => value }, clock: () => '2026-10-11T18:01:00Z' })
    const preview = await service.prepare('hr', { conversationId: 'hr-fixture', requestId: 'check-fixture-' + i })
    assert.equal(preview.items[0].result.state, expected); assert.equal(preview.items[0].result.suggestedState, 'todo')
    assert.throws(() => service.accept('hr', { id: preview.id, keys: [x.note.id], confirmed: true }), /unverified_recheck/)
  }
  assert.equal(x.store.get('hr').notes[0].revision, 1)
})
test('concurrent edits, expired proposals and company changes refuse updates; empty scope makes zero reads', async t => {
  const { createRechecks } = require('./rechecks'), x = setup(t); let now = '2026-10-11T18:01:00Z', calls = 0
  const value = report(); value.retrievedAt = '2026-10-11T18:00:00Z'
  const service = createRechecks({ store: x.store, reader: { captureAccess: () => () => {}, readComparison: async () => { calls++; return value } }, clock: () => now })
  const preview = await service.prepare('hr', { conversationId: 'hr-fixture', requestId: 'check-revision' })
  x.store.updateNote('hr', x.note.id, { revision: 1, state: 'doing', nextStep: 'Owner new draft' })
  assert.throws(() => service.accept('hr', { id: preview.id, keys: [x.note.id], confirmed: true }), /revision_conflict/)
  const next = await service.prepare('hr', { conversationId: 'hr-fixture', requestId: 'check-expired' }); now = '2026-10-11T20:00:00Z'
  assert.throws(() => service.accept('hr', { id: next.id, keys: [x.note.id], confirmed: true }), /recheck_expired/)
  value.companyId = 999; value.retrievedAt = now
  const wrong = await service.prepare('hr', { conversationId: 'hr-fixture', requestId: 'check-company' }); assert.equal(wrong.items[0].result.state, 'unknown')
  x.store.updateNote('hr', x.note.id, { revision: 2, state: 'done', nextStep: 'Owner checked' })
  const empty = await service.prepare('hr', { conversationId: 'hr-fixture', requestId: 'check-empty' }); assert.deepEqual(empty.items, []); assert.equal(calls, 3)
  await assert.rejects(service.prepare('email', { conversationId: 'hr-fixture', requestId: 'check-outside' }), /source_topic_mismatch/)
})
test('accepted evidence becomes the next baseline, grouped reads are bounded and repeated requests share one read', async t => {
  const { createRechecks } = require('./rechecks'), x = setup(t); let at = '2026-10-11T18:00:00Z', calls = 0
  const value = report(); value.rows[0].clockedIn = '2026-10-09T15:10:00Z'; value.rows[0].findings.push('later_clock_in')
  const reader = { captureAccess: () => () => {}, readComparison: async () => { calls++; await new Promise(r => setTimeout(r, 5)); return { ...structuredClone(value), retrievedAt: at } } }
  const service = createRechecks({ store: x.store, reader, clock: () => '2026-10-11T18:02:00Z' }), input = { conversationId: 'hr-fixture', requestId: 'shared-recheck' }
  const [a, b] = await Promise.all([service.prepare('hr', input), service.prepare('hr', input)])
  assert.deepEqual(a, b); assert.equal(calls, 1); assert.equal(a.items[0].result.state, 'changed')
  service.accept('hr', { id: a.id, keys: [x.note.id], confirmed: true }); at = '2026-10-11T18:01:00Z'
  const next = await service.prepare('hr', { ...input, requestId: 'next-baseline' }); assert.equal(next.items[0].result.state, 'unchanged')
  assert.equal(next.items[0].baseline.reportId, a.id); assert.equal(next.items[0].source.reportId, 'source-report')
  const cleared = report(); cleared.retrievedAt = at; cleared.rows[0].clockedOut = cleared.rows[0].scheduledEnd; cleared.rows[0].findings = []
  const finish = createRechecks({ store: x.store, reader: { ...reader, readComparison: async () => cleared }, clock: () => '2026-10-11T18:02:00Z' })
  const done = await finish.prepare('hr', { ...input, requestId: 'closed-baseline' }); finish.accept('hr', { id: done.id, keys: [x.note.id], confirmed: true })
  x.store.updateNote('hr', x.note.id, { revision: 3, state: 'doing', nextStep: 'Owner reopened' }); at = '2026-10-11T18:01:30Z'; cleared.retrievedAt = at
  const again = await finish.prepare('hr', { ...input, requestId: 'reopened-baseline' }); assert.equal(again.items[0].baseline.snapshot.evidence.findings.length, 0)
  assert.equal(again.items[0].result.state, 'unchanged'); assert.equal(again.items[0].result.suggestedState, 'doing')
})
test('attendance closure distinguishes manual evidence from auto/unknown closure and malformed source', async t => {
  const { compare } = require('./rechecks'), x = setup(t)
  const original = { ...report(), rows: [{ userId: 7, punchId: 11, employeeName: 'Fixture', clockedIn: '2026-10-09T15:00:00Z', clockedOut: null, status: 'unclosed_historical', clockOutState: 'UNKNOWN' }] }
  const snapshot = createSnapshot('attendance', original, 'attendance-source')
  x.conversations.appendTurn({ id: 'hr-fixture', userText: 'Attendance', replyText: 'Source', evidenceReport: snapshot })
  const n = createEvidenceFollowups({ store: x.store, conversations: x.conversations }).accept('hr', { conversationId: 'hr-fixture', reportId: snapshot.id, keys: [snapshot.candidates[0].key], confirmed: true }).notes[0]
  const fresh = { ...original, retrievedAt: '2026-10-11T18:00:00Z', rows: [{ ...original.rows[0], status: 'closed', clockOutState: 'CONFIRMED', clockedOut: '2026-10-09T23:00:00Z', autoClockedOut: false }] }
  assert.equal(compare(n, fresh).suggestedState, 'done')
  fresh.rows[0].autoClockedOut = null; assert.equal(compare(n, fresh).state, 'unknown')
  fresh.rows[0].status = 'auto_clocked_out'; fresh.rows[0].autoClockedOut = true; assert.equal(compare(n, fresh).suggestedState, 'todo')
  fresh.rows[0].status = 'closed'; fresh.rows[0].autoClockedOut = false; fresh.rows[0].clockedOut = 'bad-time'; assert.equal(compare(n, fresh).state, 'unavailable')
})
test('five source groups are queried once each, overflow stays visible, and one edited selection makes the whole update atomic', async t => {
  const { createRechecks } = require('./rechecks'), x = setup(t)
  for (let i = 1; i <= 5; i++) {
    const r = report(); r.query.firstDate = '2026-10-0' + i; r.rows[0].shiftId += i; r.rows[0].punchIds = [11 + i]
    const snap = createSnapshot('comparison', r, 'group-source-' + i)
    x.conversations.appendTurn({ id: 'hr-fixture', userText: 'Source', replyText: 'Report', evidenceReport: snap })
    createEvidenceFollowups({ store: x.store, conversations: x.conversations }).accept('hr', { conversationId: 'hr-fixture', reportId: snap.id, keys: [snap.candidates[0].key], confirmed: true })
  }
  let calls = 0
  const service = createRechecks({ store: x.store, reader: { captureAccess: () => () => {}, readComparison: async (_, request) => {
    calls++; const r = report(); r.query.firstDate = request.dates[0]; r.retrievedAt = '2026-10-11T18:00:00Z'
    const number = request.dates[0] === '2026-10-09' ? 0 : Number(request.dates[0].slice(-1)); r.rows[0].shiftId += number; r.rows[0].punchIds = [11 + number]; return r
  } }, clock: () => '2026-10-11T18:01:00Z' })
  const check = await service.prepare('hr', { conversationId: 'hr-fixture', requestId: 'group-check-fixture' })
  assert.equal(calls, 5); assert.equal(check.items.length, 6); assert.equal(check.items[5].result.reason, 'read_limit')
  assert.equal(check.items[5].result.checkedAt, null)
  const notes = x.store.get('hr').notes
  x.store.updateNote('hr', notes[1].id, { revision: 1, state: 'doing', nextStep: 'Owner edit' })
  assert.throws(() => service.accept('hr', { id: check.id, keys: [notes[0].id, notes[1].id], confirmed: true }), /revision_conflict/)
  assert.equal(x.store.get('hr').notes[0].revision, 1); assert.deepEqual(x.store.getRecheck('hr', check.id).acceptedIds, [])
  const file = path.join(x.dir, 'topic-workspaces.json'), data = JSON.parse(fs.readFileSync(file)); data.topics.hr.rechecks[0].items[0].result.after.evidence.clockedOut = 'invented'
  fs.writeFileSync(file, JSON.stringify(data)); assert.throws(() => x.store.get('hr'), /topic_store_unavailable/)
})
test('recheck intent refuses negation, external writes, quoted instructions and unsupported departments', () => {
  const { recheckRequest } = require('./followupIntent')
  assert.equal(recheckRequest('重新查一下 HR 未完成的跟進項目，看看哪些已有變化'), true)
  assert.equal(recheckRequest('Recheck unfinished HR follow-ups and show changes'), true)
  for (const message of ['不要重新查 HR 跟進', 'Recheck HR follow-ups and send email', 'Recheck HR follow-ups and mark them done', '重新查 HR 跟進並修改打卡', 'Recheck purchasing follow-ups', 'Explain "Recheck HR follow-ups"']) assert.equal(recheckRequest(message), false)
})
