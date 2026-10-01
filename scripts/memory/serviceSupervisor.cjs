'use strict'
const fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process')
const { createSupervisor } = require('./runtimeSupervisor')
const { acquireLease } = require('./supervisorLease')
const { probeBridge, probeHindsight } = require('../../src/memory/serviceHealth')
function startOwned({ entry, cwd, env = process.env, executable = process.execPath, launch = spawn, platform = process.platform }) {
  const processHandle = launch(executable, [entry], { cwd, env, windowsHide: true, stdio: 'ignore' })
  let exited = false
  processHandle.once('exit', () => { exited = true })
  processHandle.once('error', () => { exited = true })
  return {
    pid: processHandle.pid,
    running: () => !exited,
    async stop() {
      if (exited) return true
      if (!Number.isInteger(processHandle.pid)) return false
      // Only this exact spawned child tree is eligible. Existing listeners are never adopted.
      if (platform === 'win32') return new Promise(resolve => {
        const cleanup = launch(path.join(process.env.SystemRoot || 'C:/Windows', 'System32/taskkill.exe'), ['/PID', String(processHandle.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        const timeout = setTimeout(() => { cleanup.kill(); resolve(false) }, 10000)
        cleanup.once('exit', code => { clearTimeout(timeout); resolve(code === 0) }); cleanup.once('error', () => { clearTimeout(timeout); resolve(false) })
      })
      return processHandle.kill('SIGTERM')
    }
  }
}
async function run(component) {
  if (require('../../src/testProcess').isTestProcess()) throw Error('supervisor_test_fence')
  if (!['bridge', 'hindsight'].includes(component)) throw Error('invalid_component')
  const repo = path.resolve(__dirname, '../..')
  const env = require('dotenv').parse(fs.readFileSync(path.join(repo, '.env')))
  const dir = path.join(process.env.LOCALAPPDATA || path.join(require('node:os').homedir(), 'AppData', 'Local'), 'AromaXiangXiang', 'memory-supervisors')
  const lease = acquireLease({ dir, component })
  if (!lease) return
  let stopping = false
  const pulse = setInterval(() => { try { if (!lease.renew()) stopping = true } catch (_) { stopping = true } }, 10000)
  const entry = component === 'bridge' ? path.join(repo, 'scripts', 'subscription', 'startBridge.js') : path.join(repo, 'scripts', 'memory', 'startHindsight.cjs')
  const supervisor = createSupervisor({ component,
    probe: async () => component === 'bridge' ? (await probeBridge({ env })).bridge : probeHindsight({ env }),
    start: () => startOwned({ entry, cwd: repo, env: { ...process.env, ...env } }),
    save: value => {
      const file = path.join(dir, component + '-status.json'), temp = file + '.' + process.pid + '.tmp'
      fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 }); fs.renameSync(temp, file)
    } })
  process.once('SIGINT', () => { stopping = true })
  process.once('SIGTERM', () => { stopping = true })
  try {
    while (!stopping) {
      if (!lease.renew()) break
      await supervisor.tick()
      if (!stopping) await new Promise(resolve => setTimeout(resolve, 10000))
    }
  } finally { clearInterval(pulse); lease.release() }
}
if (require.main === module) run(process.argv[2]).catch(() => { console.error('memory_supervisor_unavailable'); process.exitCode = 1 })
module.exports = { run, startOwned }
