'use strict'
const { createHash } = require('node:crypto')
const { isValidId } = require('../store/conversationStore')
const { t } = require('../i18n/t')
const exact = (o, keys) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).sort().join(',') === keys.slice().sort().join(',')
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const identityFor = (kind, companyId, date, e) => hash(['seven_shifts', kind, companyId, date, e.userId, e.shiftId === null ? ['punch', e.punchIds[0]] : ['shift', e.shiftId]])
const positive = v => Number.isSafeInteger(v) && v > 0
const instant = v => v === null || typeof v === 'string' && v.length <= 35 && Number.isFinite(Date.parse(v))
const findings = ['later_clock_in', 'earlier_clock_in', 'earlier_clock_out', 'later_clock_out', 'unclosed_after_scheduled_end', 'unclosed_before_scheduled_end', 'no_linked_punch', 'approximate_match', 'auto_clocked_out', 'link_contradiction', 'unassigned_shift', 'no_punch_before_scheduled_start', 'unmatched_punch', 'unclosed_historical', 'unclosed_current']
function validCandidate (c) {
  const e = c?.evidence
  return exact(c, ['key', 'identity', 'employeeName', 'evidence']) && /^[a-f0-9]{64}$/.test(c.key) && /^[a-f0-9]{64}$/.test(c.identity) &&
    (c.employeeName === null || typeof c.employeeName === 'string' && c.employeeName.length <= 200 && !/[\x00-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(c.employeeName)) &&
    exact(e, ['userId', 'shiftId', 'punchIds', 'scheduledStart', 'scheduledEnd', 'clockedIn', 'clockedOut', 'matchState', 'findings', 'absenceState', 'currentlyWorkingState']) &&
    (e.userId === null || positive(e.userId)) && (e.shiftId === null || positive(e.shiftId)) && Array.isArray(e.punchIds) && e.punchIds.length <= 300 && e.punchIds.every(positive) && new Set(e.punchIds).size === e.punchIds.length &&
    (e.shiftId !== null || e.punchIds.length > 0) && [e.scheduledStart, e.scheduledEnd, e.clockedIn, e.clockedOut].every(instant) && ['CONFIRMED', 'SUPPORTED', 'CONTRADICTED', 'UNKNOWN'].includes(e.matchState) &&
    Array.isArray(e.findings) && e.findings.length > 0 && e.findings.length <= findings.length && e.findings.every(f => findings.includes(f)) && e.absenceState === 'UNKNOWN' && e.currentlyWorkingState === 'UNKNOWN'
}
function validSnapshot (s) {
  return exact(s, ['version', 'id', 'kind', 'queryDate', 'timeZone', 'companyId', 'retrievedAt', 'completeWithinScope', 'candidates']) && s.version === 1 && isValidId(s.id) &&
    ['comparison', 'attendance'].includes(s.kind) && /^\d{4}-\d{2}-\d{2}$/.test(s.queryDate) && Number.isFinite(Date.parse(s.queryDate)) && s.timeZone === 'America/Winnipeg' &&
    positive(s.companyId) && typeof s.retrievedAt === 'string' && s.retrievedAt.length <= 35 && Number.isFinite(Date.parse(s.retrievedAt)) && typeof s.completeWithinScope === 'boolean' &&
    Array.isArray(s.candidates) && s.candidates.length <= 600 && s.candidates.every(c => validCandidate(c) && c.identity === identityFor(s.kind, s.companyId, s.queryDate, c.evidence) && c.key === hash([c.identity, c.evidence])) && new Set(s.candidates.map(c => c.key)).size === s.candidates.length
}
function createSnapshot (kind, report, id) {
  if (report?.state !== 'live') return null
  const candidates = []
  function add (row, reasons, shiftId, punchIds, matchState) {
    const evidence = { userId: row.userId ?? null, shiftId, punchIds, scheduledStart: row.scheduledStart ?? null, scheduledEnd: row.scheduledEnd ?? null,
      clockedIn: row.clockedIn ?? null, clockedOut: row.clockedOut ?? null, matchState, findings: reasons, absenceState: 'UNKNOWN', currentlyWorkingState: 'UNKNOWN' }
    const identity = identityFor(kind, report.companyId, report.query.firstDate, evidence)
    candidates.push({ key: hash([identity, evidence]), identity, employeeName: row.employeeName ?? null, evidence })
  }
  if (kind === 'comparison') {
    for (const row of report.rows) if (row.findings.length) add(row, row.findings, row.shiftId, row.punchIds, row.matchState)
    for (const row of report.unmatchedPunches) add(row, ['unmatched_punch'], null, [row.punchId], row.matchState)
  } else if (kind === 'attendance') {
    for (const row of report.rows) if (['unclosed_historical', 'unclosed_current', 'auto_clocked_out'].includes(row.status)) add(row, [row.status], null, [row.punchId], row.clockOutState)
  }
  const snapshot = { version: 1, id, kind, queryDate: report.query.firstDate, timeZone: report.query.timeZone, companyId: report.companyId, retrievedAt: report.retrievedAt, completeWithinScope: report.completeWithinScope, candidates }
  if (!validSnapshot(snapshot)) throw Error('invalid_evidence_report')
  return structuredClone(snapshot)
}
function validEvidenceSource (s) {
  return exact(s, ['kind', 'conversationId', 'reportId', 'queryDate', 'timeZone', 'companyId', 'retrievedAt', 'completeWithinScope', 'reportKind', 'snapshot']) && s.kind === 'investigation' &&
    isValidId(s.conversationId) && validSnapshot({ version: 1, id: s.reportId, kind: s.reportKind, queryDate: s.queryDate, timeZone: s.timeZone, companyId: s.companyId, retrievedAt: s.retrievedAt, completeWithinScope: s.completeWithinScope, candidates: [s.snapshot] })
}
function latestReport (conversation) {
  const message = (conversation?.messages || []).filter(m => m.role === 'assistant' && (m.evidenceReportAttempt || m.evidenceReport)).at(-1)
  return validSnapshot(message?.evidenceReport) ? message.evidenceReport : null
}
function createEvidenceFollowups ({ store, conversations }) {
  function load (topic, input) {
    if (topic !== 'hr') throw Error('source_topic_mismatch')
    if (!exact(input, ['conversationId', 'reportId']) || !isValidId(input.conversationId) || !isValidId(input.reportId)) throw Error('invalid_request')
    if (store.topicForConversation(input.conversationId) !== topic) throw Error('source_topic_mismatch')
    let conversation
    try { conversation = conversations.get(input.conversationId) } catch (_) { throw Error('evidence_source_unavailable') }
    const report = conversation?.messages?.find(m => m.role === 'assistant' && m.evidenceReport?.id === input.reportId)?.evidenceReport
    if (!report) throw Error('evidence_report_not_found')
    if (!validSnapshot(report)) throw Error('evidence_source_unavailable')
    return report
  }
  function prepare (topic, input) {
    const report = load(topic, input), notes = store.get(topic).notes
    return { ...structuredClone(report), conversationId: input.conversationId, candidates: report.candidates.map(c => ({ ...c, existingNoteId: notes.find(n => n.source?.kind === 'investigation' && n.source.snapshot.identity === c.identity)?.id || null })) }
  }
  function accept (topic, input) {
    if (!exact(input, ['conversationId', 'reportId', 'keys', 'confirmed'])) throw Error('invalid_request')
    if (input.confirmed !== true) throw Error('confirmation_required')
    if (!Array.isArray(input.keys) || !input.keys.length || input.keys.length > 100 || new Set(input.keys).size !== input.keys.length) throw Error('invalid_request')
    const report = load(topic, { conversationId: input.conversationId, reportId: input.reportId })
    const selected = input.keys.map(key => report.candidates.find(c => c.key === key))
    if (selected.some(c => !c)) throw Error('invalid_request')
    const notes = selected.map(c => ({ requestId: c.identity, title: (report.queryDate + ' · ' + (c.employeeName || 'ID ' + c.evidence.userId)).slice(0, 160), nextStep: t('followup.nextDefault'), source: {
      kind: 'investigation', conversationId: input.conversationId, reportId: report.id, queryDate: report.queryDate, timeZone: report.timeZone, companyId: report.companyId,
      retrievedAt: report.retrievedAt, completeWithinScope: report.completeWithinScope, reportKind: report.kind, snapshot: structuredClone(c)
    } }))
    return store.createEvidenceNotes(topic, notes)
  }
  return { prepare, accept }
}
module.exports = { createSnapshot, validSnapshot, validEvidenceSource, followupRequest: require('./followupIntent').followupRequest, latestReport, createEvidenceFollowups }
