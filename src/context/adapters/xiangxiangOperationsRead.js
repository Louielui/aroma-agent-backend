'use strict'
// Fixed local sources only. No model-controlled paths, shell commands or write methods.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { resolveDataDir } = require('../../store/dataDir')
const { isTestProcess } = require('../../testProcess')
const { makeContextResult } = require('../contextResult')
const { projectWorkRecord, selectWorkSample } = require('../../investigation/workEvidence')
const SOURCE = 'xiangxiang_operations'
const SECTIONS = Object.freeze(['configuration', 'schedules', 'work', 'history', 'execution', 'usage', 'billing'])
const WORK_DIRS = Object.freeze(['project-work-runs', 'project-task-runs', 'project-adoption-runs', 'task-plan-runs', 'code-repair-runs', 'development-plan-runs', 'manager-runs'])
const LIMIT = 5
const ID = /^[a-z0-9][a-z0-9-]{7,63}\.json$/i
const small = (v, n = 160) => typeof v === 'string' ? v.slice(0, n) : null
const digest = v => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const date = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null

function readText (file, max = 2 * 1024 * 1024) {
  // Native canonical resolution rejects redirected paths without requiring directory
  // metadata rights above the approved root (LocalService may only traverse them).
  const expected = path.resolve(file), actual = fs.realpathSync.native(file)
  const same = process.platform === 'win32' ? expected.toLowerCase() === actual.toLowerCase() : expected === actual
  if (!same || fs.lstatSync(file).isSymbolicLink()) throw Error('unsafe_source')
  const stat = fs.statSync(file)
  if (!stat.isFile() || stat.size > max) throw Error('source_limit')
  return fs.readFileSync(file, 'utf8')
}
function readJson (file, max) { return JSON.parse(readText(file, max)) }
function jsonRows (dir, select) {
  let names
  try { names = fs.readdirSync(dir).filter(n => ID.test(n)).sort() } catch (e) { return { records: [], state: e.code === 'ENOENT' ? 'missing' : 'unavailable', scanned: 0 } }
  const records = []; let failed = 0
  // Bounded scan; selection is not a claim about all historical records.
  for (const name of names.slice(0, 250)) {
    try { const r = select(readJson(path.join(dir, name), 2 * 1024 * 1024)); if (r) records.push({ sourceId: name.slice(0, -5), ...r }) } catch (_) { failed++ }
  }
  return { records, state: failed || names.length > 250 ? 'partial' : 'ok', scanned: Math.min(names.length, 250), omitted: Math.max(0, names.length - 250), failed }
}
function bounded (part, query = '') {
  const terms = String(query).toLowerCase().match(/[a-z0-9_-]{3,}|[\u3400-\u9fff]{2,}/g) || []
  const score = r => terms.reduce((n, word) => n + (JSON.stringify(r).toLowerCase().includes(word) ? 1 : 0), 0)
  const matching = part.records.filter(r => score(r) > 0)
  const pool = matching.length ? matching : part.records
  const records = pool.sort((a, b) => score(b) - score(a) || String(b.at || '').localeCompare(String(a.at || ''))).slice(0, LIMIT)
  return { ...part, records, selection: matching.length ? 'lexical_matches' : 'recent_sample', matched: matching.length, omitted: (part.omitted || 0) + Math.max(0, pool.length - LIMIT), state: part.state === 'ok' && pool.length > LIMIT ? 'partial' : part.state }
}
function createXiangxiangOperationsReadAdapter (options = {}) {
  const dataDir = options.dataDir || resolveDataDir()
  const env = options.env || process.env
  const clock = options.clock || (() => new Date().toISOString())
  const automationDir = options.automationDir || env.XIANGXIANG_OPERATIONS_AUTOMATION_DIR || (isTestProcess() ? path.join(dataDir, 'test-automations') : path.join(os.homedir(), '.codex', 'automations'))
  const scheduler = options.scheduler || (() => require('../../home/schedulerWitness').readSchedulerWitness())
  const workerRoot = options.workerRoot || env.XIANGXIANG_OPERATIONS_WORKER_ROOT || (isTestProcess() ? path.join(dataDir, 'test-workers') : path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'AromaXiangXiang', 'worker-flow'))
  const executionReader = options.executionReader || (isTestProcess() ? null : () => require('../../adapters/CodexSubscriptionAdapter').localRequest('/execution-metadata', {}, env))
  const workReader = options.workReader || (isTestProcess() ? null : () => require('../../adapters/CodexSubscriptionAdapter').localRequest('/work-metadata', {}, env))
  async function section (name, query) {
    try {
      if (name === 'billing') return { state: 'unconnected', evidenceState: 'not_established', records: [], provesCharge: false, note: 'No provider billing ledger or execution-to-charge correlation is connected. Actual charges and their causes are NOT ESTABLISHED.' }
      if (name === 'execution') {
        if (!executionReader) return { state: 'unconnected', evidenceState: 'not_established', records: [], provesCharge: false }
        const r = await executionReader()
        if (!['ok', 'partial', 'missing', 'unavailable'].includes(r?.state) || !Array.isArray(r.records)) throw Error('invalid_execution_receipt')
        return { ...r, evidenceState: r.records.length ? 'confirmed' : 'not_established', provesCharge: false }
      }
      if (name === 'configuration') {
        const d = readJson(path.join(dataDir, 'model-center.json'))
        if (!d.brain || typeof d.brain.model !== 'string') throw Error('invalid_config')
        const allowedFlags = ['CHAT_BACKEND', 'WORKER_INVOCATION', 'DEVELOP_DISPATCH', 'AGENT_BRIDGE', 'COMPUTER_OPERATOR', 'READONLY_ENQUIRY', 'GOAL_DECOMPOSER', 'XIANGXIANG_MEMORY']
        const flags = Object.fromEntries(allowedFlags.map(k => [k, ['on', 'off', 'codex-subscription'].includes(env[k]) ? env[k] : null]))
        const { BOOT_COMMIT, BOOTED_AT } = require('../../governance/bootCommit')
        return { state: 'ok', evidenceState: 'confirmed', records: [{ role: 'central_brain_default', model: small(d.brain.model), effort: small(d.brain.effort), revision: Number.isInteger(d.revision) ? d.revision : null, bootCommit: BOOT_COMMIT, bootedAt: BOOTED_AT, flags }], note: 'Current central brain default and this process boot revision only. Topic overrides and worker models can differ. Historical worker models and bounded live bridge workflow occupancy are in work records. Full named job activity is not connected.' }
      }
      if (name === 'schedules') {
        let witness, witnessFailed = false
        try { const w = await scheduler(); if (w.state === 'UNREADABLE') throw Error('unreadable'); witness = { sourceId: 'AromaXiangXiang-ErrandRecall', state: small(w.state), lastRunAt: w.lastRunAt ?? null, nextRunAt: w.nextRunAt ?? null, scheduled: typeof w.scheduled === 'boolean' ? w.scheduled : null } } catch (_) { witnessFailed = true }
        let names = [], missing = false, unreadable = false
        try { names = fs.readdirSync(automationDir).filter(n => /^[a-zA-Z0-9_-]+$/.test(n)) } catch (e) { missing = e.code === 'ENOENT'; unreadable = !missing }
        const records = witness ? [witness] : []
        let failed = 0
        for (const name of names.slice(0, 20)) {
          try {
            const text = readText(path.join(automationDir, name, 'automation.toml'), 65536)
            const field = key => small(new RegExp('^' + key + ' = "([^"\\r\\n]*)"', 'm').exec(text)?.[1], 220)
            records.push({ sourceId: 'codex-automation:' + name, name: field('name'), state: field('status'), schedule: field('rrule'), model: field('model'), effort: field('reasoning_effort'), currentRunningState: 'unknown', modelState: field('model') ? 'explicit_definition' : 'not_recorded', executionHistoryState: 'unconnected' })
          } catch (_) { failed++ }
        }
        return { state: witnessFailed && !records.length ? 'unavailable' : witnessFailed || missing || unreadable || failed || names.length > 20 ? 'partial' : 'ok', evidenceState: records.length ? 'confirmed' : 'not_established', records, missingAutomationDirectory: missing, automationReadState: unreadable ? 'unavailable' : missing ? 'missing' : failed || names.length > 20 ? 'partial' : 'ok', automationReadErrors: failed, witnessUnavailable: witnessFailed, note: 'Current schedule definitions and one Windows task witness only. Unreadable or partial automation coverage cannot establish absence or exclude usage sources. A schedule is a possible usage source, not a billing cause. Codex execution history is not connected.' }
      }
      if (name === 'work') {
        if (workReader) {
          const r=await workReader()
          if (!['ok','partial','missing','unavailable'].includes(r?.state)||!Array.isArray(r.records)) throw Error('invalid_work_receipt')
          return {...r,evidenceState:r.records.length?'confirmed':'not_established',provesCharge:false}
        }
        const dirs = WORK_DIRS.map(folder => ({ folder, dir: path.join(dataDir, folder) })).concat(['project-runs', 'runs', 'adoptions'].map(folder => ({ folder: 'worker/' + folder, dir: path.join(workerRoot, folder) })))
        const repoRoot = options.repoRoot || path.resolve(__dirname, '../../..')
        const parts = dirs.map(({ folder, dir }) => ({ folder, ...jsonRows(dir, d => projectWorkRecord(d, { kind: folder, readSource: name => readText(path.join(repoRoot, name), 512 * 1024) })) }))
        const all = parts.flatMap(p => p.records), selected = selectWorkSample(all)
        return { ...selected, state: parts.every(p => p.state === 'ok') && !selected.omitted ? 'ok' : 'partial', scanned: parts.reduce((n, p) => n + p.scanned, 0), coverage: parts.map(p => ({ kind: p.folder, state: p.state, scanned: p.scanned, failed: p.failed ?? null, omitted: p.omitted ?? null })), evidenceState: selected.records.length ? 'confirmed' : 'not_established', provesCharge: false, note: 'Latest recorded failure, explicit run-ID links and recent work within a bounded scan. Tests and reviews belong to their candidate/source revision. Current file hashes are disk observations, not proof that a failure is fixed in the running process. Saved running state is historical; current activity is unknown. Missing directories are not zero work.' }
      }
      if (name === 'history') {
        const rows = jsonRows(path.join(dataDir, 'conversations'), d => ({ title: small(d.title), at: date(d.updatedAt || d.createdAt), excerpts: Array.isArray(d.messages) ? d.messages.filter(m => ['user', 'assistant'].includes(m.role)).slice(-6).map(m => ({ role: m.role, text: small(m.text || m.content, 260) })) : [] }))
        return { ...bounded(rows, query), evidenceState: 'supported', note: 'Historical conversation statements, not independent truth or present state. Partial search cannot establish absence. No Codex conversation history is connected.' }
      }
      if (name === 'usage') {
        const d = readJson(path.join(dataDir, 'aroma-truth.json'), 16 * 1024 * 1024)
        if (!Array.isArray(d.llm_usage)) throw Error('usage_invalid')
        const rows = d.llm_usage.slice(-LIMIT).map(r => ({ sourceId: small(r.id), model: small(r.model), at: date(r.at), estimated_tokens: Number.isFinite(r.estimated_tokens) ? r.estimated_tokens : null, request_count: Number.isFinite(r.request_count) ? r.request_count : null }))
        return { state: d.llm_usage.length > LIMIT ? 'partial' : 'ok', evidenceState: 'supported', records: rows, omitted: Math.max(0, d.llm_usage.length - LIMIT), provesCharge: false, note: 'Legacy local usage sample. May contain test/old records and has no provider billing correlation. Estimated tokens are not credits or charges; subscription activity is not fully covered.' }
      }
      throw Error('unknown_section')
    } catch (e) { return { state: e.code === 'ENOENT' ? 'missing' : 'unavailable', evidenceState: 'not_established', records: [], note: 'Source could not be inspected; this is not an empty result.' } }
  }
  return { source: SOURCE, methods: { async readInvestigation (params = {}) {
    const retrievedAt = clock(), results = []
    for (const name of SECTIONS) {
      try { options.onProgress?.({ section: name, state: 'reading' }) } catch (_) {}
      const value = await section(name, String(params.query || '').slice(0, 2000))
      const fields = { section: name, ...value, sha256: digest(value) }
      results.push(makeContextResult({ source: SOURCE, sourceId: name + ':' + fields.sha256.slice(0, 16), title: name, retrievedAt, content: JSON.stringify(fields), fields }))
      try { options.onProgress?.({ section: name, state: value.state }) } catch (_) {}
    }
    return { results, evidence: { source: SOURCE, trust: 'live', shownCount: results.length, matchingTotal: results.length, sourceTotal: null, completeWithinScope: false, truncated: null, queryScope: { field: 'fixed local source sections', window: null }, dataAsOf: retrievedAt, note: 'Section receipts; each section has its own read state. Not a complete account audit.' } }
  } } }
}
module.exports = { createXiangxiangOperationsReadAdapter, SOURCE, SECTIONS }
