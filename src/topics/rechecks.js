'use strict'
const { isValidId } = require('../store/conversationStore')
const { candidateFor } = require('./evidenceFollowups')
const { exact, validResult } = require('./recheckContract')
function compare (note, report) {
  const s = note.source, e = s.snapshot.evidence
  const result = { state: 'unknown', reason: 'record_not_found', checkedAt: report?.retrievedAt || null, completeWithinScope: typeof report?.completeWithinScope === 'boolean' ? report.completeWithinScope : null, after: null, suggestedState: note.state }
  const finish = () => validResult(result, s, note.state) ? result : { state: 'unavailable', reason: 'invalid_source_response', checkedAt: null, completeWithinScope: null, after: null, suggestedState: note.state }
  if (report?.state !== 'live') { result.state = 'unavailable'; result.reason = 'source_unavailable'; return finish() }
  if (report.companyId !== s.companyId || report.query?.firstDate !== s.queryDate || report.query?.timeZone !== s.timeZone) { result.reason = 'scope_mismatch'; return finish() }
  if (!(Date.parse(report.retrievedAt) > Date.parse(s.retrievedAt))) { result.reason = 'stale_source'; return finish() }
  let rows, after
  if (s.reportKind === 'comparison') {
    if (!Array.isArray(report.rows) || !Array.isArray(report.unmatchedPunches)) { result.state = 'unavailable'; result.reason = 'invalid_source_response'; return finish() }
    if (e.shiftId !== null) {
      rows = report.rows.filter(r => r.shiftId === e.shiftId && r.userId === e.userId)
      if (rows.length === 1) { const r = rows[0]; after = candidateFor(s.reportKind, s.companyId, s.queryDate, r, r.findings, r.shiftId, r.punchIds, r.matchState) }
    } else {
      rows = report.rows.filter(r => r.userId === e.userId && r.punchIds?.includes(e.punchIds[0]))
      const unmatched = report.unmatchedPunches.filter(r => r.userId === e.userId && r.punchId === e.punchIds[0])
      if (rows.length + unmatched.length === 1) {
        const r = rows[0] || unmatched[0]
        after = candidateFor(s.reportKind, s.companyId, s.queryDate, r, rows.length ? r.findings : ['unmatched_punch'], null, [e.punchIds[0]], r.matchState)
      }
      rows = [...rows, ...unmatched]
    }
  } else {
    if (!Array.isArray(report.rows)) { result.state = 'unavailable'; result.reason = 'invalid_source_response'; return finish() }
    rows = report.rows.filter(r => r.userId === e.userId && r.punchId === e.punchIds[0])
    if (rows.length === 1) {
      const r = rows[0], closed = ['closed', 'closed_overnight'].includes(r.status)
      const reasons = closed ? [] : [r.status]
      after = candidateFor(s.reportKind, s.companyId, s.queryDate, r, reasons, null, [r.punchId], r.clockOutState)
      if (closed && r.autoClockedOut !== false) { result.reason = 'manual_out_unknown'; return finish() }
    }
  }
  if (rows.length !== 1) { result.reason = rows.length ? 'ambiguous_match' : 'record_not_found'; return finish() }
  result.after = after
  if (report.completeWithinScope !== true) { result.reason = 'partial_scope'; return finish() }
  if (after.evidence.matchState !== 'CONFIRMED') { result.reason = 'unverified_match'; return finish() }
  const comparable = evidence => ({ ...evidence, findings: evidence.findings.slice().sort(), punchIds: evidence.punchIds.slice().sort((a, b) => a - b),
    scheduledStart: evidence.scheduledStart === null ? null : new Date(evidence.scheduledStart).toISOString(), scheduledEnd: evidence.scheduledEnd === null ? null : new Date(evidence.scheduledEnd).toISOString(),
    clockedIn: evidence.clockedIn === null ? null : new Date(evidence.clockedIn).toISOString(), clockedOut: evidence.clockedOut === null ? null : new Date(evidence.clockedOut).toISOString() })
  try {
    const equal = JSON.stringify(comparable(e)) === JSON.stringify(comparable(after.evidence))
    result.state = equal ? 'unchanged' : 'changed'; result.reason = equal ? 'records_unchanged' : 'records_changed'
    if (!equal && !after.evidence.findings.length && after.evidence.clockedOut !== null) { result.reason = 'findings_cleared'; result.suggestedState = 'done' }
  } catch (_) { result.state = 'unavailable'; result.reason = 'invalid_source_response'; result.after = null }
  return finish()
}
function createRechecks ({ store, reader, clock = () => new Date().toISOString() }) {
  const pending = new Map()
  async function prepare (topic, input) {
    if (topic !== 'hr' || store.topicForConversation(input?.conversationId) !== topic) throw Error('source_topic_mismatch')
    if (!exact(input, ['conversationId', 'requestId']) || !isValidId(input.conversationId) || !isValidId(input.requestId)) throw Error('invalid_request')
    const old = store.getRecheck(topic, input.requestId)
    if (old) { if (old.conversationId !== input.conversationId) throw Error('request_conflict'); reader?.captureAccess(); return old }
    if (pending.has(input.requestId)) { const p = pending.get(input.requestId); if (p.conversationId !== input.conversationId) throw Error('request_conflict'); return p.result }
    const result = run(topic, input); pending.set(input.requestId, { conversationId: input.conversationId, result })
    try { return await result } finally { pending.delete(input.requestId) }
  }
  async function run (topic, input) {
    const notes = store.get(topic).notes.filter(n => n.state !== 'done' && n.source?.kind === 'investigation')
    const reports = new Map(), items = []
    for (const note of notes) {
      const s = note.source, key = JSON.stringify([s.companyId, s.reportKind, s.queryDate])
      if (!reports.has(key)) {
        if (reports.size >= 5) reports.set(key, { state: 'unavailable', reason: 'read_limit' })
        else {
          let report
          try {
            const verify = reader.captureAccess(); verify()
            report = await (s.reportKind === 'comparison' ? reader.readComparison : reader.readAttendance)({ id: 'owner', role: 'owner' }, { window: 'dates', dates: [s.queryDate] }); verify()
          } catch (_) { report = { state: 'unavailable' } }
          reports.set(key, report)
        }
      }
      const previous = note.lastRecheckId ? store.getRecheck(topic, note.lastRecheckId) : null
      const priorItem = previous?.items.find(i => i.noteId === note.id)
      const baseline = priorItem?.result.after ? { ...s, snapshot: priorItem.result.after, retrievedAt: priorItem.result.checkedAt, reportId: previous.id, completeWithinScope: priorItem.result.completeWithinScope } : s
      const report = reports.get(key)
      let result
      try { result = compare({ ...note, source: baseline }, report) } catch (_) { result = compare(note, { state: 'unavailable' }) }
      if (result.checkedAt && Date.parse(result.checkedAt) > Date.parse(clock())) result = { state: 'unavailable', reason: 'invalid_source_response', checkedAt: null, completeWithinScope: null, after: null, suggestedState: note.state }
      if (report.reason === 'read_limit') result.reason = 'read_limit'
      items.push({ noteId: note.id, revision: note.revision, state: note.state, nextStep: note.nextStep, title: note.title, source: structuredClone(s), baseline: structuredClone(baseline), result })
    }
    const createdAt = clock(), record = { id: input.requestId, conversationId: input.conversationId, createdAt, expiresAt: new Date(Date.parse(createdAt) + 3600000).toISOString(), items, acceptedIds: [] }
    return store.saveRecheck(topic, record)
  }
  function accept (topic, input) {
    if (topic !== 'hr') throw Error('source_topic_mismatch')
    if (!exact(input, ['id', 'keys', 'confirmed']) || !isValidId(input.id) || !Array.isArray(input.keys) || !input.keys.length || input.keys.length > 100 || input.keys.some(k => !isValidId(k)) || new Set(input.keys).size !== input.keys.length) throw Error('invalid_request')
    if (input.confirmed !== true) throw Error('confirmation_required')
    return store.confirmRecheck(topic, input.id, input.keys, clock())
  }
  return { prepare, accept, get: (topic, id) => { if (topic !== 'hr' || !isValidId(id)) throw Error('source_topic_mismatch'); const record = store.getRecheck(topic, id); if (!record) throw Error('recheck_not_found'); return record } }
}
module.exports = { createRechecks, compare }
