'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { resolveDataDir } = require('../store/dataDir')
function createBackupScheduler ({ backup, dir = path.join(resolveDataDir(), 'memory-capture'), clock = () => Date.now() }) {
  const file = path.join(dir, 'backup-state.json')
  let busy = false; let timer; let running = false
  function read () {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) }
    catch (e) { return e.code === 'ENOENT' ? {} : { state: 'failed', reason: 'backup_state_unavailable' } }
  }
  const status = () => ({ state: 'not_started', lastSucceededAt: null, lastAttemptAt: null,
    nextAt: null, reason: null, path: null, sha256: null, filesRestored: null, ...read(), busy, intervalHours: 24 })
  function save (value) {
    fs.mkdirSync(dir, { recursive: true })
    const temporary = file + '.' + process.pid + '.tmp'
    const fd = fs.openSync(temporary, 'w', 0o600)
    try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    fs.renameSync(temporary, file)
  }
  async function perform (force = false) {
    if (busy) return
    const previous = read()
    // An interrupted process cannot own an active job after the service restarts.
    if (!force && previous.state !== 'running' && Date.parse(previous.nextAt) > clock()) return
    busy = true
    try {
      save({ ...previous, state: 'running', lastAttemptAt: new Date(clock()).toISOString(), reason: null })
      const result = await backup()
      if (result?.restored?.state !== 'verified' || !/^[0-9a-f]{64}$/.test(result.restored.sha256 || '') ||
          typeof result.path !== 'string' || !path.isAbsolute(result.path) || result.recovery?.state !== 'verified' ||
          result.filesRestored?.state !== 'isolated_files_restored' || !Number.isSafeInteger(result.filesRestored.files) ||
          result.filesRestored.files < 0 || result.recovery.files !== result.filesRestored.files) throw Error('backup_proof_unconfirmed')
      save({ state: 'verified', lastSucceededAt: new Date(clock()).toISOString(),
        lastAttemptAt: new Date(clock()).toISOString(), nextAt: new Date(clock() + 86400000).toISOString(),
        path: result.path, sha256: result.restored.sha256, filesRestored: result.filesRestored.files,
        reason: null })
    } catch (_) {
      try { save({ ...previous, state: 'failed', lastAttemptAt: new Date(clock()).toISOString(),
        nextAt: new Date(clock() + 1800000).toISOString(), reason: 'backup_unavailable' }) } catch (_) {}
    } finally { busy = false }
  }
  const tick = () => perform(false)
  const run = async () => { await perform(true); return status() }
  const loop = async () => { await tick(); if (running) { timer = setTimeout(loop, 60000); timer.unref() } }
  return { status, tick, run, start () { if (!running) { running = true; void loop() } }, stop () { running = false; clearTimeout(timer) } }
}
module.exports = { createBackupScheduler }
