'use strict'
// Owner-user projection of registered-project execution metadata. Never return
// messages, account identifiers, prompts, tools, rate-limit objects or paths.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const stamp = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null
const label = v => typeof v === 'string' && /^[a-z0-9_.:/-]{1,160}$/i.test(v) ? v : null
const normalized = p => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p)
function canonical (p) {
  if (normalized(fs.realpathSync.native(p)) !== normalized(p) || fs.lstatSync(p).isSymbolicLink()) throw Error('unsafe_source')
  return fs.statSync(p)
}
function usageSnapshot (raw) {
  if (!raw || typeof raw !== 'object') return null
  const out = {}
  for (const key of ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens']) {
    if (Number.isSafeInteger(raw[key]) && raw[key] >= 0) out[key] = raw[key]
  }
  return Object.keys(out).length ? out : null
}
function createExecutionReader ({ sessionRoot, workspaceRoots = [], clock = () => new Date().toISOString(), maxFileBytes = 4 * 1024 * 1024, maxFiles = 120, maxDirectories = 256, maxRecords = 5 } = {}) {
  const allowed = new Set(workspaceRoots.map(normalized))
  let pending = null
  async function readSnapshot () {
    const retrievedAt = clock(), coverage = { scope: 'registered_project_sessions', directoriesVisited: 0, filesInspected: 0, eligibleFiles: 0, excludedWorkspaceFiles: 0, sampledFiles: 0, invalidLines: 0, failedFiles: 0, omittedRecords: 0, enumerationTruncated: false, complete: false }
    const records = [], files = []
    try {
      if (!sessionRoot || !allowed.size || !canonical(sessionRoot).isDirectory()) throw Error('invalid_root')
      function walk (dir, depth = 0) {
        if (coverage.directoriesVisited >= maxDirectories) { coverage.enumerationTruncated = true; return }
        coverage.directoriesVisited++
        for (const name of fs.readdirSync(dir).sort().reverse()) {
          if (!/^[a-zA-Z0-9_.-]+$/.test(name)) continue
          const file = path.join(dir, name)
          try {
            const stat = canonical(file)
            if (stat.isDirectory() && depth < 3 && /^\d{2,4}$/.test(name)) walk(file, depth + 1)
            else if (stat.isFile() && name.endsWith('.jsonl')) files.push({ file, size: stat.size, modified: stat.mtimeMs })
          } catch (_) { coverage.failedFiles++ }
          if (files.length >= 3000) { coverage.enumerationTruncated = true; return }
        }
      }
      walk(sessionRoot)
    } catch (e) { return { state: e.code === 'ENOENT' ? 'missing' : 'unavailable', records: [], coverage, retrievedAt, provesCharge: false } }
    files.sort((a, b) => b.modified - a.modified || b.file.localeCompare(a.file))
    if (files.length > maxFiles) coverage.enumerationTruncated = true
    for (const candidate of files.slice(0, maxFiles)) {
      coverage.filesInspected++
      let fd
      try {
        const stat = canonical(candidate.file)
        fd = fs.openSync(candidate.file, 'r')
        const header = Buffer.alloc(Math.min(65536, stat.size)); const count = fs.readSync(fd, header, 0, header.length, 0)
        const first = header.subarray(0, count).toString('utf8').split('\n')[0]
        const meta = JSON.parse(first)
        if (meta.type !== 'session_meta' || !label(meta.payload?.id) || typeof meta.payload?.cwd !== 'string' || !allowed.has(normalized(meta.payload.cwd))) { coverage.excludedWorkspaceFiles++; continue }
        coverage.eligibleFiles++
        const completeFile = stat.size <= maxFileBytes
        const size = Math.min(stat.size, maxFileBytes), half = Math.floor(size / 2)
        const head = Buffer.alloc(completeFile ? size : half), tail = completeFile ? null : Buffer.alloc(size - half)
        const headRead = fs.readSync(fd, head, 0, head.length, 0)
        const tailRead = tail ? fs.readSync(fd, tail, 0, tail.length, Math.max(0, stat.size - tail.length)) : 0
        if (!completeFile) coverage.sampledFiles++
        const headText = head.subarray(0, headRead).toString('utf8'), tailText = tail ? tail.subarray(0, tailRead).toString('utf8') : ''
        // Index slicing is linear even for huge message/image lines. An unanchored
        // end-of-line regex can backtrack quadratically over those private lines.
        const chunks = completeFile ? [headText] : [headText.slice(0, headText.lastIndexOf('\n') + 1), tailText.includes('\n') ? tailText.slice(tailText.indexOf('\n') + 1) : '']
        const row = { sourceId: 'codex-session:' + meta.payload.id, sessionId: meta.payload.id, recordedAt: stamp(meta.timestamp), at: stamp(meta.timestamp), model: null, effort: null, lastStartedAt: null, lastCompletedAt: null, usage: null, usageAt: null, usageBasis: 'latest_recorded_cumulative_session_snapshot_not_sum', declaredAutomationId: null, triggerVerified: false, completeFile, provesCharge: false }
        for (const line of chunks.join('\n').split('\n')) {
          if (!line.trim()) continue
          let data
          try { data = JSON.parse(line) } catch (_) { coverage.invalidLines++; continue }
          const p = data.payload || {}, at = stamp(data.timestamp)
          if (at && (!row.at || at > row.at)) row.at = at
          if (data.type === 'turn_context') { if (label(p.model)) row.model = p.model; if (label(p.effort)) row.effort = p.effort }
          if (data.type === 'event_msg' && p.type === 'task_started' && at) row.lastStartedAt = at
          if (data.type === 'event_msg' && p.type === 'task_complete' && at) row.lastCompletedAt = at
          if (data.type === 'event_msg' && p.type === 'token_count' && at) {
            const usage = usageSnapshot(p.info?.total_token_usage)
            if (usage && (!row.usageAt || at >= row.usageAt)) { row.usage = usage; row.usageAt = at }
          }
          // A copied heartbeat is a declaration, not an authenticated scheduler
          // witness. Preserve that distinction before any exact-ID correlation.
          if (data.type === 'response_item' && p.type === 'message' && p.role === 'user' && Array.isArray(p.content)) {
            for (const item of p.content) {
              if (item.type !== 'input_text' || typeof item.text !== 'string' || item.text.length > 16000) continue
              const id = /^\s*<heartbeat>\s*<automation_id>([a-zA-Z0-9_-]{1,100})<\/automation_id>[\s\S]*<\/heartbeat>\s*$/.exec(item.text)?.[1]
              if (id) row.declaredAutomationId = id
            }
          }
        }
        row.sha256 = crypto.createHash('sha256').update(head.subarray(0, headRead)).update(tail ? tail.subarray(0, tailRead) : '').digest('hex')
        row.hashScope = completeFile ? 'complete_file' : 'sampled_prefix_and_tail'
        records.push(row)
      } catch (_) { coverage.failedFiles++ } finally { if (fd !== undefined) fs.closeSync(fd) }
      // Yield without blocking chat or metadata requests on large directory scans.
      await new Promise(resolve => setImmediate(resolve))
    }
    records.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
    coverage.omittedRecords = Math.max(0, records.length - maxRecords)
    coverage.complete = !coverage.enumerationTruncated && !coverage.sampledFiles && !coverage.failedFiles && !coverage.invalidLines && !coverage.omittedRecords
    return { state: coverage.complete ? 'ok' : 'partial', records: records.slice(0, maxRecords), coverage, retrievedAt, provesCharge: false, note: 'Project-scoped execution events and recorded cumulative tokens only. Sampling cannot establish absence, current activity, authenticated triggers or actual credits. Cumulative snapshots must not be added together.' }
  }
  return { read () { if (!pending) pending = readSnapshot().finally(() => { pending = null }); return pending } }
}
module.exports = { createExecutionReader }
