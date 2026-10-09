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
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
function testWitness (v, expected) {
  // Hash-bound host sandbox results only. Never forward stdout, paths to the
  // sandbox, source bodies, or a model's assertion that a test succeeded.
  if (v?.engine !== 'windows-sandbox-offline-v1' || !/^[a-f0-9]{64}$/.test(v.evidenceHash || '') ||
      !expected.length || expected.some(f => !/^[a-f0-9]{64}$/.test(f.hash || '')) ||
      new Set(expected.map(f=>f.path)).size !== expected.length ||
      !['noExternalInterfaces','hostReadDenied','hostWriteDenied','readonlyInputDenied','readonlyToolsDenied','loopbackDenied','ipv6LoopbackDenied','internetDenied','cleanIdentity','secretsAbsent'].every(k=>v.boundary?.[k]===true) ||
      !v.inputHashes || Object.keys(v.inputHashes).length !== expected.length ||
      expected.some(f => v.inputHashes[f.path] !== f.hash)) return null
  return { evidenceHash:v.evidenceHash, inputHash:hash(JSON.stringify(expected.slice().sort((a,b)=>a.path.localeCompare(b.path)))), at:at(v.at) }
}
function tests (v) {
  if (!v || typeof v !== 'object') return null
  return Object.fromEntries(['total', 'passed', 'failed', 'exitCode', 'skipped', 'cancelled'].map(k => [k, Number.isInteger(v[k]) ? v[k] : null]))
}
function projectWorkRecord (d, { kind, recordId, readSource = () => null } = {}) {
  const evidence = d.source?.evidence || d.snapshot?.evidence || {}, result = d.coding || d.result || {}
  const rawSteps = Array.isArray(d.steps) ? d.steps : Array.isArray(d.events) ? d.events : []
  const metadata = rawSteps.slice(-4).map(s => ({ id: code(s.stage || s.id || s.key), state: code(s.status || s.state), at: at(s.at), reason: code(s.facts?.reason || s.error), model: text(s.facts?.model || s.model), verdict: code(s.facts?.verdict || s.verdict) }))
  const sources = (Array.isArray(evidence.sourceFiles) ? evidence.sourceFiles : []).slice(0, 5).filter(f => READABLE_SOURCE_FILES.includes(f.path)).map(f => {
    const change = (Array.isArray(result.changes) ? result.changes : []).find(c => c.file === f.path)
    const adoptedBody = d.action === 'adopt' ? (typeof d.after === 'string' && evidence.sourceFiles.length === 1 ? d.after : d.after?.[f.path]) : null
    const candidateHash = sha(change?.afterHash) || (typeof adoptedBody === 'string' ? crypto.createHash('sha256').update(adoptedBody).digest('hex') : null)
    let currentHash = null
    try { const body = readSource(f.path); if (typeof body === 'string') currentHash = crypto.createHash('sha256').update(body.replace(/\r\n/g,'\n')).digest('hex') } catch (_) {}
    return { path: f.path, originalHash: sha(f.sha256), candidateHash, currentHash,
      comparison: currentHash ? currentHash === candidateHash ? 'matches_candidate' : currentHash === sha(f.sha256) ? 'matches_original' : 'different' : 'unavailable' }
  })
  const diagnostic = d.failureDiagnostic
  const acceptance = (Array.isArray(evidence.acceptanceFiles) ? evidence.acceptanceFiles : []).slice(0,30)
    .filter(f => typeof f.path === 'string' && /^acceptance\/[a-zA-Z0-9_.-]+\.(?:js|cjs)$/.test(f.path) && /^[a-f0-9]{64}$/.test(f.sha256 || '')).map(f=>({path:f.path,sha256:f.sha256}))
  const dependencies = (Array.isArray(evidence.dependencyFiles) ? evidence.dependencyFiles : []).slice(0,READABLE_SOURCE_FILES.length).filter(f => READABLE_SOURCE_FILES.includes(f.path)).map(f => {
    let currentHash = null
    try { const body=readSource(f.path);if(typeof body==='string')currentHash=hash(body.replace(/\r\n/g,'\n')) } catch (_) {}
    return {path:f.path,originalHash:sha(f.sha256),currentHash}
  })
  const complete = sources.length > 0 && sources.length === evidence.sourceFiles?.length && acceptance.length > 0 &&
    acceptance.length === evidence.acceptanceFiles?.length && dependencies.length === (evidence.dependencyFiles?.length || 0)
  const fixed = [...acceptance.map(f=>({path:f.path,hash:f.sha256})),...dependencies.map(f=>({path:f.path,hash:f.originalHash}))]
  const baselineInput = [...sources.map(f=>({path:f.path,hash:f.originalHash})),...fixed]
  const candidateInput = [...sources.map(f=>({path:f.path,hash:f.candidateHash})),...fixed]
  const testBinding = complete ? { protectedTestsHash:hash(JSON.stringify(acceptance.slice().sort((a,b)=>a.path.localeCompare(b.path)))),
    baseline:testWitness(result.baseline,baselineInput),candidate:testWitness(d.tests || result.tests,candidateInput),
    dependenciesMatch:dependencies.every(f=>f.originalHash === f.currentHash && /^[a-f0-9]{64}$/.test(f.currentHash || '')) } : null
  return { kind, name: text(d.input?.goal || d.workOrder?.goal || d.message, 240), goal: text(d.input?.goal || d.workOrder?.goal || d.message, 240), state: code(d.status || d.state),
    at: at(d.updatedAt || d.finishedAt || d.startedAt || d.createdAt), startedAt: at(d.startedAt || d.createdAt), finishedAt: at(d.finishedAt), reason: code(d.reason || d.error),
    model: text(d.model || d.execution?.model || result.model || metadata.find(s => s.model)?.model), effort: text(d.effort || result.effort || d.draftEffort), reviewModel: text(d.review?.model || d.acceptanceReview?.model),
    recipe: text(d.workOrder?.recipe || d.executableRecipe || evidence.recipe), registeredTaskId:id(/^registered-task-(.+)$/.exec(d.workOrder?.recipe || '')?.[1]), taskRunId: id(d.taskRunId), workRunId: id(d.workRunId), requestId: id(d.requestId), action: code(d.action),
    sourceRevision: sha(evidence.revision || d.input?.bootCommit), commit: sha(d.commit), loadedCommit: sha(d.loaded?.bootCommit), sourceFiles: sources,
    sourceFilesComplete: Array.isArray(evidence.sourceFiles) && evidence.sourceFiles.length > 0 && sources.length === evidence.sourceFiles.length,
    tests: tests(d.tests || result.tests), baseline: tests(result.baseline), reviewVerdict: code(d.review?.verdict || d.acceptanceReview?.verdict),
    testBinding,
    workerRuns: recordId === d.id && /^worker\/(project-tasks|project-runs|runs)$/.test(kind || '') && Array.isArray(d.workerRuns) ? d.workerRuns.slice(-20).map(r => require('./workerInvocation').projectRun(r, kind.slice(7), recordId)).filter(Boolean) : [],
    repairOf:id(d.repairOf || d.accepted?.repairOf),
    liveBaseline:require('../core/projectWork/liveVerification').project(d.liveBaseline || d.accepted?.liveBaseline),
    liveVerification:require('../core/projectWork/liveVerification').project(d.liveVerification),
    appliedToLive: typeof d.appliedToLive === 'boolean' ? d.appliedToLive : typeof result.appliedToLive === 'boolean' ? result.appliedToLive : null,
    failureDiagnostic: diagnostic ? { exitCode: Number.isInteger(diagnostic.exitCode) ? diagnostic.exitCode : null, subtype: code(diagnostic.subtype) } : null,
    steps: metadata, currentRunningState: 'unknown', fixedInCurrentVersion: null }
}
// Source selection affects only the bounded sample, never routing or permission.
function selectWorkSample (records, limit = 5) {
  const recent = records.slice().sort((a,b) => String(b.at || '').localeCompare(String(a.at || '')))
  const failed = recent.find(r => ['failed', 'timed_out', 'needs_attention'].includes(r.state) && /project|repair|adoption/.test(r.kind || ''))
  const picked = failed ? [failed] : []
  const linked = r => picked.some(p => ['workRunId','taskRunId','registeredTaskId','repairOf'].some(field => p[field] === r.sourceId || r[field] === p.sourceId))
  for (let i = 0; i < 3; i++) for (const r of recent) if (!picked.includes(r) && linked(r) && picked.length < limit) picked.push(r)
  const sibling = r => failed && ((failed.workRunId && failed.workRunId === r.workRunId) || (failed.taskRunId && failed.taskRunId === r.taskRunId))
  for (const r of recent) if (!picked.includes(r) && sibling(r) && picked.length < limit) picked.push(r)
  for (const r of recent.filter(r => r.kind === 'worker/project-runs' || r.kind === 'worker/adoptions').concat(recent)) if (!picked.includes(r) && picked.length < limit) picked.push(r)
  return { records: picked, selection: 'latest_failure_explicit_links_and_recent_work', omitted: Math.max(0, records.length - picked.length), latestFailureId: failed?.sourceId || null }
}
module.exports = { projectWorkRecord, selectWorkSample, READABLE_SOURCE_FILES, testWitness }
