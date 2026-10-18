'use strict'
// External Sandbox driver diagnostics only. Does not start tests or terminate children.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const cp = require('node:child_process')
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const errorValue = error => ({ name: String(error.name || 'Error').slice(0, 80), code: error.code || null, message: String(error.message || error).slice(0, 4096) })

function launchMonitor(options) {
  if (!uuid.test(options.runId) || !path.isAbsolute(options.outputDir) || !path.isAbsolute(options.executable) || !path.isAbsolute(options.script)) throw Error('invalid_monitor_launch_contract')
  const maxOutputBytes = options.maxOutputBytes ?? 65536
  const timeout = options.readyTimeoutMs ?? 30000
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 1048576 || !Number.isInteger(timeout) || timeout < 1 || timeout > 60000) throw Error('invalid_diagnostic_bounds')
  if (!Array.isArray(options.args) || options.args.length > 64 || options.args.some(arg => typeof arg !== 'string') || Buffer.byteLength(JSON.stringify(options.args)) > 16384) throw Error('invalid_monitor_arguments')
  const launchId = crypto.randomUUID(), requestedAt = new Date().toISOString()
  const invocation = { executable: options.executable, args: [...options.args, '-RunId', options.runId, '-LaunchId', launchId] }
  const state = {
    schema: 1, runId: options.runId, launchId, requestedAt, invocation, parentPid: options.parentPid,
    identities: {}, pid: null, spawnedAt: null, spawnError: null, probeError: null, outputErrors: [],
    classification: 'UNKNOWN', reason: 'not_observed', timeoutOccurred: false,
    ready: { verified: false, observedAt: null, readyAt: null, evidence: null, process: null },
    exitCode: null, signal: null, exitObservedAt: null, closedAt: null,
    finalProcessState: 'NOT_OBSERVED', logsClosed: false,
    stdout: { bytesReceived: 0, bytesCaptured: 0, truncated: false, sha256: null },
    stderr: { bytesReceived: 0, bytesCaptured: 0, truncated: false, sha256: null }
  }
  const fds = {}, files = {}, copy = () => JSON.parse(JSON.stringify(state))
  let child = null, spawned = false, exited = false, closed = false, decided = false, timer, polling = false, phase = 'OUTPUT_SETUP', pendingProbe = null
  let resolveReady, resolveCompletion
  const ready = new Promise(resolve => { resolveReady = resolve })
  const completion = new Promise(resolve => { resolveCompletion = resolve })
  const writeNew = (name, value) => fs.writeFileSync(path.join(options.outputDir, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
  function noteOutputError(error) { if (state.outputErrors.length < 8) state.outputErrors.push(errorValue(error)) }
  function decide(classification, reason) {
    if (decided) return
    decided = true; clearTimeout(timer)
    state.classification = classification; state.reason = reason
    try { writeNew('monitor-observation.json', { ...copy(), final: false }) } catch (error) { noteOutputError(error); state.classification = 'OUTPUT_UNAVAILABLE'; state.reason = 'observation_write_failed' }
    resolveReady(copy())
  }
  function outputFailure(error) {
    noteOutputError(error)
    if (decided) { state.classification = 'OUTPUT_UNAVAILABLE'; state.reason = 'diagnostic_output_incomplete' }
    else decide('OUTPUT_UNAVAILABLE', 'diagnostic_output_incomplete')
  }
  function capture(name, chunk) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), record = state[name]
    record.bytesReceived += bytes.length
    const captured = bytes.subarray(0, Math.max(0, maxOutputBytes - record.bytesCaptured))
    try {
      if (captured.length) { fs.writeSync(fds[name], captured); record.bytesCaptured += captured.length }
    } catch (error) { outputFailure(error) }
    if (record.bytesReceived > record.bytesCaptured) { record.truncated = true; outputFailure(Error(name + '_limit_exceeded')) }
  }
  function finalize(code, signal) {
    if (closed) return
    closed = true; exited = true; clearTimeout(timer)
    state.closedAt = new Date().toISOString(); state.exitCode = Number.isInteger(code) ? code : null; state.signal = signal || null
    state.finalProcessState = state.spawnError ? 'SPAWN_FAILED' : !child ? 'NOT_STARTED' : state.exitCode !== null ? 'EXITED' : state.signal ? 'EXITED_BY_SIGNAL' : 'EXIT_OUTCOME_UNKNOWN'
    // The guest's bounded process probe also writes a diagnostic receipt. Do not
    // seal the final diagnostic while that writer is still in flight.
    if (pendingProbe) { pendingProbe.then(writeFinal, writeFinal); return }
    writeFinal()
  }
  function writeFinal() {
    for (const name of ['stdout', 'stderr']) {
      if (fds[name] !== undefined) {
        try { fs.fsyncSync(fds[name]); fs.closeSync(fds[name]); delete fds[name]; state[name].sha256 = sha(fs.readFileSync(files[name])) } catch (error) { noteOutputError(error) }
      }
    }
    state.logsClosed = Object.keys(fds).length === 0
    if (!decided) decide(state.spawnError ? 'SPAWN_FAILED' : state.finalProcessState === 'EXIT_OUTCOME_UNKNOWN' ? 'UNKNOWN' : 'PROCESS_EXITED_BEFORE_READY', 'process_closed_before_ready')
    if (!state.spawnError && state.finalProcessState === 'EXIT_OUTCOME_UNKNOWN') { state.classification = 'UNKNOWN'; state.reason = 'exit_outcome_missing' }
    if (state.ready.verified && (state.exitCode !== 0 || state.signal)) { state.classification = 'UNKNOWN'; state.reason = 'unsuccessful_exit_after_ready' }
    if (state.outputErrors.length) { state.classification = 'OUTPUT_UNAVAILABLE'; state.reason = 'diagnostic_output_incomplete' }
    try {
      // Child close is after stdio closure; local log FDs must also close first.
      if (!state.logsClosed) throw Error('diagnostic_logs_not_closed')
      const tmp = path.join(options.outputDir, 'monitor-diagnostic.tmp'), final = path.join(options.outputDir, 'monitor-diagnostic.json')
      if (fs.existsSync(final)) throw Error('final_receipt_already_exists')
      fs.writeFileSync(tmp, JSON.stringify({ ...copy(), final: true }, null, 2) + '\n', { flag: 'wx' })
      fs.renameSync(tmp, final)
    } catch (error) { noteOutputError(error); state.classification = 'OUTPUT_UNAVAILABLE'; state.reason = 'final_receipt_write_failed' }
    resolveCompletion(copy())
  }
  function failedSpawn(error) {
    state.spawnError = errorValue(error); state.finalProcessState = 'SPAWN_FAILED'
    try { writeNew('monitor-launch-error.json', { schema: 1, runId: options.runId, launchId, at: new Date().toISOString(), error: state.spawnError }) } catch (writeError) { noteOutputError(writeError) }
    decide('SPAWN_FAILED', 'monitor_launch_failed')
  }
  async function poll() {
    if (decided || exited || !spawned || polling) return
    polling = true
    try {
      const text = options.readReady()
      if (text !== null && text !== undefined) {
        state.ready.observedAt = new Date().toISOString()
        let receipt
        try {
          if (typeof text !== 'string' || Buffer.byteLength(text) > 16384) throw Error('ready_size_invalid')
          receipt = JSON.parse(text)
          const started = Date.parse(receipt.processStartedAt), at = Date.parse(receipt.readyAt)
          if (receipt.schema !== 1 || receipt.runId !== options.runId || receipt.launchId !== launchId || receipt.pid !== state.pid || receipt.scriptSha256 !== state.identities.script.sha256 || receipt.executableSha256 !== state.identities.executable.sha256 || receipt.subscriptions !== 2 || receipt.handshake !== 'process-trace-subscribed' || !Number.isFinite(started) || started < Date.parse(requestedAt) || !Number.isFinite(at) || at < started || at > Date.now()) throw Error('ready_identity_or_handshake_mismatch')
        } catch (error) { decide('READY_HANDSHAKE_INVALID', error.message); return }
        // Keep only the known schema. Arbitrary receipt fields are untrusted output.
        state.ready.evidence = Object.fromEntries(['schema', 'runId', 'launchId', 'pid', 'processStartedAt', 'readyAt', 'scriptSha256', 'executableSha256', 'subscriptions', 'handshake'].map(key => [key, receipt[key]]))
        let evidence
        try {
          pendingProbe = Promise.resolve().then(() => options.probe(state.pid))
          evidence = await pendingProbe
        } catch (error) { state.probeError = errorValue(error); if (!exited) decide('UNKNOWN', 'current_process_probe_failed'); return }
        if (exited || closed || decided) return
        state.ready.process = evidence && Object.fromEntries(['alive', 'pid', 'parentPid', 'executable', 'executableSha256', 'createdAt'].map(key => [key, evidence[key]]))
        if (!evidence || evidence.alive !== true || evidence.pid !== state.pid || evidence.parentPid !== options.parentPid || typeof evidence.executable !== 'string' || path.resolve(evidence.executable).toLowerCase() !== path.resolve(options.executable).toLowerCase() || evidence.executableSha256 !== state.identities.executable.sha256 || Date.parse(evidence.createdAt) !== Date.parse(receipt.processStartedAt)) { decide('UNKNOWN', 'current_process_identity_not_verified'); return }
        state.ready.verified = true; state.ready.readyAt = receipt.readyAt
        decide('READY_VERIFIED', 'current_process_and_handshake_verified'); return
      }
    } catch (error) { state.probeError = errorValue(error); decide('UNKNOWN', 'ready_observation_unavailable') }
    finally { polling = false }
    if (!decided && !exited) setTimeout(poll, Math.max(1, Math.min(options.pollMs ?? 20, 1000)))
  }
  try {
    for (const name of ['stdout', 'stderr']) { files[name] = path.join(options.outputDir, 'monitor-' + name + '.log'); fds[name] = fs.openSync(files[name], 'wx') }
    phase = 'IDENTITY'
    for (const key of ['executable', 'script']) { const bytes = fs.readFileSync(options[key]); state.identities[key] = { path: options[key], bytes: bytes.length, sha256: sha(bytes) } }
    phase = 'LAUNCH_RECEIPT'
    writeNew('monitor-launch.json', copy())
    phase = 'SPAWN'
    child = (options.spawn || cp.spawn)(invocation.executable, invocation.args, { env: options.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    state.pid = Number.isInteger(child.pid) ? child.pid : null
    child.once('error', error => { failedSpawn(error) })
    for (const name of ['stdout', 'stderr']) {
      if (child[name]) { child[name].on('data', bytes => capture(name, bytes)); child[name].on('error', outputFailure) }
    }
    child.once('spawn', () => {
      spawned = true; state.spawnedAt = new Date().toISOString(); state.finalProcessState = 'RUNNING'
      if (!Number.isInteger(child.pid) || child.pid < 1) { decide('UNKNOWN', 'spawn_event_without_pid'); return }
      state.pid = child.pid
      if (!child.stdout || !child.stderr) { outputFailure(Error('monitor_stdio_missing')); return }
      void poll()
    })
    child.once('exit', (code, signal) => { exited = true; state.exitObservedAt = new Date().toISOString(); state.exitCode = Number.isInteger(code) ? code : null; state.signal = signal || null; state.finalProcessState = state.exitCode !== null ? 'EXITED_AWAITING_IO_CLOSE' : state.signal ? 'SIGNALLED_AWAITING_IO_CLOSE' : 'EXIT_OUTCOME_UNKNOWN' })
    child.once('close', finalize)
    timer = setTimeout(() => { if (!decided) { state.timeoutOccurred = true; decide('READY_TIMEOUT', 'deadline_elapsed_without_verified_ready') } }, timeout)
  } catch (error) {
    if (phase === 'OUTPUT_SETUP' || phase === 'LAUNCH_RECEIPT') outputFailure(error)
    else failedSpawn(error)
    finalize(null, null)
  }
  return { launchId, child, ready, completion, get terminal() { return closed }, snapshot: copy }
}
module.exports = { launchMonitor }
