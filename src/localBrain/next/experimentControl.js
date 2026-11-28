'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const PILOT = 'C:/Aroma/local-brain-runtime/phase1-pilot'
const PRODUCTION = 'C:/Aroma/aroma-agent-backend'
const SHA = /^[0-9a-f]{40}$/

function samePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
}

function directory(dir) {
  const stat = fs.lstatSync(dir)
  if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(fs.realpathSync(dir), dir)) {
    throw Error('phase1_directory_invalid')
  }
}

function control(root = PILOT) {
  const marker = path.join(root, 'enabled.json')
  function current() {
    directory(root)
    let stat
    try { stat = fs.lstatSync(marker) }
    catch (error) { if (error.code === 'ENOENT') return null; throw error }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== 41 ||
        !samePath(fs.realpathSync(marker), marker)) throw Error('phase1_marker_invalid')
    const bytes = fs.readFileSync(marker, 'utf8')
    if (bytes.length !== 41 || bytes[40] !== '\n' || !SHA.test(bytes.slice(0, 40))) {
      throw Error('phase1_marker_invalid')
    }
    return bytes.slice(0, 40)
  }
  function set(expected, next) {
    if ((next !== null && !SHA.test(next)) || current() !== expected) throw Error('phase1_marker_drift')
    if (expected === next) return
    if (next === null) { fs.unlinkSync(marker); return }
    const staging = path.join(root, 'enabled-' + randomUUID() + '.tmp')
    const fd = fs.openSync(staging, 'wx')
    let published = false
    try {
      try { fs.writeFileSync(fd, next + '\n'); fs.fsyncSync(fd) }
      finally { fs.closeSync(fd) }
      // All writers use the same promotion lock. A completed rename produces
      // one ordinary file even if the Owner process exits immediately after it.
      if (current() !== null) throw Error('phase1_marker_drift')
      fs.renameSync(staging, marker)
      published = true
    } finally { if (!published) fs.unlinkSync(staging) }
  }
  return { current, set }
}

function formalSource(root) {
  return process.platform === 'win32' && samePath(root, PRODUCTION)
}

module.exports = { PILOT, PRODUCTION, control, directory, formalSource }
