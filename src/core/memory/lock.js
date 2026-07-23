'use strict'

/**
 * lock — per-store advisory write lock.
 *
 * Default: if a lock file exists, writes are refused (LOCK_HELD). M1 NEVER
 * auto-deletes a stale lock — a crash/Windows-Update residual lock must be
 * recovered by an operator/Louie decision, not silently overwritten. A read-only
 * inspectLock() exposes the metadata to support that decision.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { MemoryError } = require('./errors')

function lockPath (storeDir) { return path.join(storeDir, 'lock.json') }

function acquireLock (storeDir, meta = {}) {
  const p = lockPath(storeDir)
  const lockId = crypto.randomUUID()
  const body = {
    lockId,
    processId: process.pid,
    createdAtLabel: meta.createdAtLabel || new Date().toISOString(),
    hostnameLabel: os.hostname(),
    operation: meta.operation || 'unknown',
    store: meta.store || 'unknown'
  }
  let fd
  try {
    fd = fs.openSync(p, 'wx') // exclusive create — fails if a lock already exists
  } catch (e) {
    if (e && e.code === 'EEXIST') throw new MemoryError('LOCK_HELD', 'store write lock is held (not auto-removed; operator recovery required)')
    throw new MemoryError('LOCK_HELD', 'could not acquire lock')
  }
  try { fs.writeFileSync(fd, JSON.stringify(body), { encoding: 'utf8' }); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  return lockId
}

// Release only our own lock. Never remove a lock whose id we don't hold.
function releaseLock (storeDir, lockId) {
  const p = lockPath(storeDir)
  let held
  try { held = JSON.parse(fs.readFileSync(p, 'utf8')) } catch (e) { return false }
  if (!held || held.lockId !== lockId) return false // not ours — leave it
  fs.rmSync(p, { force: true })
  return true
}

function inspectLock (storeDir) {
  const p = lockPath(storeDir)
  if (!fs.existsSync(p)) return null
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch (e) { return { unreadable: true } }
}

module.exports = { acquireLock, releaseLock, inspectLock, lockPath }
