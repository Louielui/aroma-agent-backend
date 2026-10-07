'use strict'
// Project only metadata needed for read-only diagnosis. Never copy source bodies,
// worker output, review prose, credentials or approval nonces into an investigation.
const crypto = require('node:crypto')
const { FILES, INTERFACE_FILES, CHAT_FILES } = require('../core/projectTasks/contract')
const READABLE_SOURCE_FILES = Object.freeze([...new Set([...FILES, ...INTERFACE_FILES, ...CHAT_FILES])])
const text = (v, n = 180) => typeof v === 'string' ? v.slice(0, n) : null
const at = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null
const sha = v => typeof v === 'string' && /^[a-f0-9]{40,64}$/i.test(v) ? v : null
const code = v => typeof v === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(v) ? v : null
const id = v => typeof v === 'string' && /^[a-f0-9-]{36}$/i.test(v) ? v : null
function tests (v) {
  if (!v || typeof v !== 'object') return null
  return Object.fromEntries(['total', 'passed', 'failed', 'exitCode', 'skipped', 'cancelled'].map(k => [k, Number.isInteger(v[k]) ? v[k] : null]))
}
function projectWorkRecord (d, { kind, readSource = () => null } = {}) {
  const evidence = d.source?.evidence || d.snapshot?.evidence || {}, result = d.coding || d.result || {}
  const rawSteps = Array.isArray(d.steps) ? d.steps : Array.isArray(d.events) ? d.events : []
  const metadata = rawSteps.slice(-4).map(s => ({ id: code(s.stage || s.id || s.key), state: code(s.status || s.state), at: at(s.at), reason: code(s.facts?.reason || s.error), model: text(s.facts?.model || s.model), verdict: code(s.facts?.verdict || s.verdict) }))
  const sources = (Array.isArray(evidence.sourceFiles) ? evidence.sourceFiles : []).slice(0, 5).filter(f => READABLE_SOURCE_FILES.includes(f.path)).map(f => {
    const change = (Array.isArray(result.changes) ? result.changes : []).find(c => c.file === f.path)
    let currentHash = null
    try { const body = readSource(f.path); if (typeof body === 'string') currentHash = crypto.createHash('sha256').update(body).digest('hex') } catch (_) {}
    return { path: f.path, originalHash: sha(f.sha256), candidateHash: sha(change?.afterHash), currentHash,
      comparison: currentHash ? currentHash === sha(change?.afterHash) ? 'matches_candidate' : currentHash === sha(f.sha256) ? 'matches_original' : 'different' : 'unavailable' }
  })
  const diagnostic = d.failureDiagnostic
  return { kind, name: text(d.input?.goal || d.workOrder?.goal || d.message, 240), goal: text(d.input?.goal || d.workOrder?.goal || d.message, 240), state: code(d.status || d.state),
    at: at(d.updatedAt || d.finishedAt || d.startedAt || d.createdAt), startedAt: at(d.startedAt || d.createdAt), finishedAt: at(d.finishedAt), reason: code(d.reason || d.error),
    model: text(d.model || d.execution?.model || result.model || metadata.find(s => s.model)?.model), effort: text(d.effort || result.effort || d.draftEffort), reviewModel: text(d.review?.model || d.acceptanceReview?.model),
    recipe: text(d.workOrder?.recipe || d.executableRecipe), taskRunId: id(d.taskRunId), workRunId: id(d.workRunId), requestId: id(d.requestId), action: code(d.action),
    sourceRevision: sha(evidence.revision || d.input?.bootCommit), commit: sha(d.commit), loadedCommit: sha(d.loaded?.bootCommit), sourceFiles: sources,
    tests: tests(d.tests || result.tests), baseline: tests(result.baseline), reviewVerdict: code(d.review?.verdict || d.acceptanceReview?.verdict),
    appliedToLive: typeof d.appliedToLive === 'boolean' ? d.appliedToLive : typeof result.appliedToLive === 'boolean' ? result.appliedToLive : null,
    failureDiagnostic: diagnostic ? { exitCode: Number.isInteger(diagnostic.exitCode) ? diagnostic.exitCode : null, subtype: code(diagnostic.subtype) } : null,
    steps: metadata, currentRunningState: 'unknown', fixedInCurrentVersion: null }
}
// Source selection affects only the bounded sample, never routing or permission.
function selectWorkSample (records, limit = 5) {
  const recent = records.slice().sort((a,b) => String(b.at || '').localeCompare(String(a.at || '')))
  const failed = recent.find(r => ['failed', 'timed_out', 'needs_attention'].includes(r.state) && (r.kind.includes('project') || r.kind.includes('repair')))
  const picked = failed ? [failed] : []
  const linked = r => picked.some(p => p.workRunId === r.sourceId || p.taskRunId === r.sourceId || r.workRunId === p.sourceId || r.taskRunId === p.sourceId)
  for (let i = 0; i < 3; i++) for (const r of recent) if (!picked.includes(r) && linked(r) && picked.length < limit) picked.push(r)
  for (const r of recent.filter(r => r.kind === 'worker/project-runs' || r.kind === 'worker/adoptions').concat(recent)) if (!picked.includes(r) && picked.length < limit) picked.push(r)
  return { records: picked, selection: 'latest_failure_explicit_links_and_recent_work', omitted: Math.max(0, records.length - picked.length), latestFailureId: failed?.sourceId || null }
}
module.exports = { projectWorkRecord, selectWorkSample, READABLE_SOURCE_FILES }
