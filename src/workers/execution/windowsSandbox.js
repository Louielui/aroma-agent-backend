'use strict'
// OS isolation is provided by Windows Sandbox, never by a model permission flag.
// Only disposable, explicitly packaged bytes are mapped. No live repo or account
// directory is shared. An unavailable OS boundary never falls back to host exec.
const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { randomUUID, createHash } = require('node:crypto')
const digest = value => createHash('sha256').update(value).digest('hex')
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const VERSION = 'windows-sandbox-offline-v1'
function xml (value) { return String(value).replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[x]) }
function fileName (name) {
  if (typeof name !== 'string' || name.length > 160 || !/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.(?:js|cjs|json|css)$/.test(name) || /(?:^|\/)(?:node_modules|data|credentials|secrets)(?:\/|\.)/i.test(name) || name.split('/').some(n => /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(n))) throw Error('invalid_work_order')
  return name
}
function validatePackage ({ files, tests, expectedTests }) {
  if (!files || Array.isArray(files) || typeof files !== 'object' || Object.keys(files).length < 2 || Object.keys(files).length > 50 || !Array.isArray(tests) || !tests.length || !Number.isSafeInteger(expectedTests) || expectedTests < 1 || expectedTests > 10000) throw Error('invalid_work_order')
  const names = Object.keys(files).map(fileName)
  if (new Set(names.map(n => n.toLowerCase())).size !== names.length || new Set(tests).size !== tests.length) throw Error('invalid_work_order')
  let bytes = 0
  for (const n of names) { if (typeof files[n] !== 'string' || Buffer.byteLength(files[n]) > 100000) throw Error('invalid_work_order'); bytes += Buffer.byteLength(files[n]) }
  if (bytes > 1000000 || tests.some(n => !names.includes(fileName(n)) || !/\.test\.(?:js|cjs)$/.test(n))) throw Error('invalid_work_order')
  return { files: { ...files }, tests: [...tests], expectedTests }
}
function regular (filename, max = 2000000) {
  const st = fs.lstatSync(filename)
  if (!st.isFile() || st.isSymbolicLink() || st.size > max || st.nlink !== 1) throw Error('scope_changed')
  return fs.readFileSync(filename)
}
function directory (dir) {
  const absolute = path.resolve(dir)
  if (fs.realpathSync(absolute).toLowerCase() !== absolute.toLowerCase() || !fs.lstatSync(absolute).isDirectory()) throw Error('scope_changed')
  // Junctions/reparse ancestors may otherwise redirect a newly created child.
  for (let p = absolute; path.dirname(p) !== p; p = path.dirname(p)) if (fs.lstatSync(p).isSymbolicLink()) throw Error('scope_changed')
  return absolute
}
function execute (exe, args, { timeout = 30000, signal } = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => ['systemroot', 'windir', 'path', 'pathext', 'localappdata', 'appdata', 'userprofile', 'temp', 'tmp'].includes(k.toLowerCase())))
  return new Promise((resolve, reject) => execFile(exe, args, { env, windowsHide: true, shell: false, timeout, signal, maxBuffer: 1000000, encoding: 'utf8' }, (error, stdout) => error ? reject(Error('sandbox_unavailable')) : resolve(stdout)))
}
async function readiness ({ run = execute, platform = process.platform } = {}) {
  if (platform !== 'win32') return { ready: false, reason: 'windows_required', engine: VERSION }
  try {
    const script = "$f=Get-CimInstance Win32_OptionalFeature | Where-Object Name -eq 'Containers-DisposableClientVM';$c=Get-Command wsb.exe -ErrorAction SilentlyContinue;$h=Get-CimInstance Win32_ComputerSystem;[PSCustomObject]@{featureInstalled=($f.InstallState -eq 1);hypervisorPresent=($h.HypervisorPresent -eq $true);restartPending=(Test-Path 'HKLM:/SOFTWARE/Microsoft/Windows/CurrentVersion/Component Based Servicing/RebootPending');cli=if($c){$c.Source}else{$null}} | ConvertTo-Json -Compress"
    const state = JSON.parse(await run(path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script]))
    if (!state.featureInstalled) return { ready: false, reason: 'windows_sandbox_not_enabled', engine: VERSION }
    // CBS is a machine-wide Windows Update flag; it may remain set even after
    // this feature's reboot. Require the actual hypervisor and CLI instead of
    // trapping an already running Sandbox in an endless reboot prompt.
    if (state.hypervisorPresent !== true) return { ready: false, reason: state.restartPending === true ? 'windows_restart_required' : 'windows_virtualization_unavailable', engine: VERSION }
    if (typeof state.cli !== 'string' || !path.isAbsolute(state.cli)) return { ready: false, reason: 'windows_sandbox_cli_unavailable', engine: VERSION }
    const help = await run(state.cli, ['--help'])
    if (!['start', 'stop', 'connect'].every(x => new RegExp('\\b' + x + '\\b', 'i').test(help))) return { ready: false, reason: 'windows_sandbox_cli_unavailable', engine: VERSION }
    return { ready: true, engine: VERSION, cli: state.cli, boundaryVerified: false, systemRestartPending: state.restartPending === true }
  } catch (_) { return { ready: false, reason: 'windows_sandbox_unavailable', engine: VERSION } }
}
function configuration (job) {
  const map = (host, guest, readOnly) => `<MappedFolder><HostFolder>${xml(host)}</HostFolder><SandboxFolder>${guest}</SandboxFolder><ReadOnly>${readOnly}</ReadOnly></MappedFolder>`
  return '<Configuration><Networking>Disable</Networking><vGPU>Disable</vGPU><AudioInput>Disable</AudioInput><VideoInput>Disable</VideoInput><PrinterRedirection>Disable</PrinterRedirection><ClipboardRedirection>Disable</ClipboardRedirection><ProtectedClient>Enable</ProtectedClient><MemoryInMB>4096</MemoryInMB><MappedFolders>' + map(job.tools, 'C:\\XiangTools', true) + map(job.input, 'C:\\XiangInput', true) + map(job.output, 'C:\\XiangOutput', false) + '</MappedFolders><LogonCommand><Command>powershell.exe -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File C:\\XiangTools\\launch.ps1</Command></LogonCommand></Configuration>'
}
function prepare ({ root, pack, node = process.execPath }) {
  pack = validatePackage(pack)
  fs.mkdirSync(root, { recursive: true }); root = directory(root)
  const id = randomUUID(), dir = fs.mkdtempSync(path.join(root, 'offline-'))
  const job = { id, dir, tools: path.join(dir, 'tools'), input: path.join(dir, 'input'), output: path.join(dir, 'output'), version: VERSION }
  for (const key of ['tools', 'input', 'output']) fs.mkdirSync(job[key])
  fs.copyFileSync(node, path.join(job.tools, 'node.exe'))
  fs.copyFileSync(path.join(__dirname, 'sandboxGuest.cjs'), path.join(job.tools, 'runner.cjs'))
  fs.writeFileSync(path.join(job.tools, 'launch.ps1'), "$ErrorActionPreference='Stop'\n& 'C:/XiangTools/node.exe' 'C:/XiangTools/runner.cjs'\n", { flag: 'wx' })
  const sentinel = path.join(dir, 'host-only-canary.txt'); fs.writeFileSync(sentinel, 'nonsecret ' + id, { flag: 'wx' })
  for (const [name, content] of Object.entries(pack.files)) { const p = path.join(job.input, ...name.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content, { flag: 'wx' }) }
  const manifest = { id, engine: VERSION, expectedTests: pack.expectedTests, tests: pack.tests, hashes: Object.fromEntries(Object.entries(pack.files).map(([n, c]) => [n, digest(c)])), sentinel, hostLoopbackPort: 8091 }
  fs.writeFileSync(path.join(job.tools, 'manifest.json'), JSON.stringify(manifest), { flag: 'wx' })
  job.manifest = manifest; job.hashes = { ...manifest.hashes }
  job.toolHashes = Object.fromEntries(fs.readdirSync(job.tools).map(n => [n, digest(regular(path.join(job.tools, n), 100000000))]))
  job.config = configuration(job); job.configHash = digest(job.config)
  fs.writeFileSync(path.join(dir, 'sandbox.wsb'), job.config, { flag: 'wx' })
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify({ id, engine: VERSION, state: 'prepared', configHash: job.configHash, inputHashes: job.hashes, createdAt: new Date().toISOString() }), { flag: 'wx' })
  return job
}
function verifyInputs (job) {
  directory(job.dir)
  const walk = (root, prefix = '') => fs.readdirSync(root).flatMap(n => {
    const p = path.join(root, n), st = fs.lstatSync(p), rel = prefix + n
    if (st.isSymbolicLink()) throw Error('scope_changed')
    return st.isDirectory() ? walk(p, rel + '/') : [rel]
  })
  if (walk(job.input).sort().join('\n') !== Object.keys(job.hashes).sort().join('\n')) throw Error('scope_changed')
  for (const [n, hash] of Object.entries(job.hashes)) if (digest(regular(path.join(job.input, ...n.split('/')))) !== hash) throw Error('scope_changed')
  if (fs.readdirSync(job.tools).sort().join('\n') !== Object.keys(job.toolHashes).sort().join('\n')) throw Error('scope_changed')
  for (const [n, hash] of Object.entries(job.toolHashes)) if (digest(regular(path.join(job.tools, n), 100000000)) !== hash) throw Error('scope_changed')
  if (digest(regular(path.join(job.dir, 'sandbox.wsb'))) !== job.configHash || fs.readFileSync(job.manifest.sentinel, 'utf8') !== 'nonsecret ' + job.id) throw Error('scope_changed')
}
function evidence (job) {
  verifyInputs(job); directory(job.output)
  if (fs.readdirSync(job.output).sort().join(',') !== 'evidence.json') throw Error('invalid_sandbox_evidence')
  const raw = regular(path.join(job.output, 'evidence.json')), value = JSON.parse(raw.toString('utf8'))
  const b = value.boundary
  if (value.id !== job.id || value.engine !== VERSION || !b || !['noExternalInterfaces', 'hostReadDenied', 'hostWriteDenied', 'readonlyInputDenied', 'readonlyToolsDenied', 'loopbackDenied', 'ipv6LoopbackDenied', 'internetDenied', 'cleanIdentity', 'secretsAbsent'].every(k => b[k] === true) || JSON.stringify(value.inputHashes) !== JSON.stringify(job.hashes)) throw Error('sandbox_failed')
  const r = value.tests
  if (!r || ![0, 1].includes(r.exitCode) || ![r.total, r.passed, r.failed].every(n => Number.isSafeInteger(n) && n >= 0) || r.total !== job.manifest.expectedTests || r.cancelled !== 0 || r.skipped !== 0 || r.passed + r.failed !== r.total || (r.exitCode === 0 && r.failed !== 0) || (r.exitCode === 1 && r.failed < 1) || typeof r.stdout !== 'string' || r.stdout.length > 200000 || typeof r.stderr !== 'string' || r.stderr.length > 20000) throw Error('invalid_sandbox_evidence')
  return { ...r, boundary: b, evidenceHash: digest(raw), inputHashes: job.hashes, configHash: job.configHash, engine: VERSION, workspace: job.dir, at: value.at, trust: 'guest_test_output_requires_owner_review' }
}
function boundOutput (job) {
  directory(job.output)
  const names = fs.readdirSync(job.output)
  if (names.some(n => !['evidence.tmp', 'evidence.json', 'error.json'].includes(n))) throw Error('invalid_sandbox_evidence')
  let bytes = 0
  for (const n of names) { const st = fs.lstatSync(path.join(job.output, n)); if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1) throw Error('scope_changed'); bytes += st.size }
  if (bytes > 4000000) throw Error('invalid_sandbox_evidence')
}
function createExecutor ({ root, run = execute, check = readiness, timeoutMs = 240000, node = process.execPath, pollMs = 500 } = {}) {
  fs.mkdirSync(root, { recursive: true }); root = directory(root)
  const lease = path.join(root, 'sandbox-lease.json')
  let busy = fs.existsSync(lease)
  async function executePackage (pack, { signal } = {}) {
    if (busy) throw Error('worker_busy')
    if (signal?.aborted) throw Error('worker_cancelled')
    busy = true
    let job, cli, stopRequired = false, stopped = true
    const stamp = (state, extra = {}) => job && fs.writeFileSync(path.join(job.dir, 'job.json'), JSON.stringify({ id: job.id, engine: VERSION, state, configHash: job.configHash, inputHashes: job.hashes, at: new Date().toISOString(), ...extra }))
    try {
      const ready = await check()
      if (!ready.ready) throw Error(ready.reason || 'sandbox_unavailable')
      cli = ready.cli; job = prepare({ root, pack, node }); verifyInputs(job)
      try { fs.writeFileSync(lease, JSON.stringify({ id: job.id, dir: job.dir, engine: VERSION }), { flag: 'wx' }) } catch (_) { throw Error('worker_busy') }
      stamp('starting'); stopRequired = true; stopped = false
      await run(cli, ['start', '--id', job.id, '--config', job.config, '--raw'], { timeout: 60000, signal })
      stamp('running')
      await run(cli, ['connect', '--id', job.id], { timeout: 30000, signal })
      const deadline = Date.now() + timeoutMs
      while (!fs.existsSync(path.join(job.output, 'evidence.json'))) {
        boundOutput(job)
        if (fs.existsSync(path.join(job.output, 'error.json'))) throw Error('sandbox_failed')
        if (signal?.aborted) throw Error('worker_cancelled')
        if (Date.now() >= deadline) throw Error('worker_timeout')
        await new Promise(resolve => setTimeout(resolve, pollMs))
      }
      boundOutput(job); const result = evidence(job); stamp('evidence_received', { evidenceHash: result.evidenceHash })
      return result
    } catch (error) { stamp('failed', { error: ['worker_cancelled', 'worker_timeout', 'sandbox_failed', 'scope_changed', 'invalid_work_order', 'invalid_sandbox_evidence'].includes(error.message) ? error.message : 'sandbox_unavailable' }); throw error }
    finally {
      if (stopRequired) {
        try { if (!UUID.test(job.id)) throw Error(); await run(cli, ['stop', '--id', job.id, '--raw'], { timeout: 30000 }); stopped = true; stamp('stopped'); fs.unlinkSync(lease) }
        catch (_) { stamp('stop_unconfirmed'); throw Error('sandbox_stop_unconfirmed') }
      }
      if (stopped) busy = false
    }
  }
  async function recover () {
    if (!fs.existsSync(lease)) return { recovered: false }
    const value = JSON.parse(regular(lease).toString('utf8'))
    if (!UUID.test(value.id) || value.engine !== VERSION || path.dirname(directory(value.dir)) !== root || !path.basename(value.dir).startsWith('offline-')) throw Error('scope_changed')
    const record = JSON.parse(regular(path.join(value.dir, 'job.json')).toString('utf8'))
    if (record.id !== value.id || record.engine !== VERSION) throw Error('scope_changed')
    const ready = await check(); if (!ready.ready) throw Error('sandbox_unavailable')
    await run(ready.cli, ['stop', '--id', value.id, '--raw'], { timeout: 30000 })
    fs.writeFileSync(path.join(value.dir, 'job.json'), JSON.stringify({ ...record, state: 'interrupted_stopped', at: new Date().toISOString(), resumed: false }))
    fs.unlinkSync(lease); busy = false; return { recovered: true, id: value.id, resumed: false }
  }
  return { run: executePackage, readiness: () => check(), isBusy: () => busy, recover }
}
module.exports = { createExecutor, readiness, validatePackage, fileName, configuration, prepare, verifyInputs, evidence, VERSION, digest }
