'use strict'
const fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto')
function acquireLease({ dir, component, pid = process.pid, clock = Date.now, isAlive = candidate => { try { process.kill(candidate, 0); return true } catch (e) { return e.code === 'EPERM' } } }) {
  if (!path.isAbsolute(dir) || !['bridge', 'hindsight'].includes(component)) throw Error('invalid_supervisor_lease')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, component + '.lock'), nonce = randomUUID()
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (_) { return null } }
  function writeNew() {
    const fd = fs.openSync(file, 'wx', 0o600)
    try { fs.writeFileSync(fd, JSON.stringify({ component, pid, nonce, at: clock() })); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  }
  try { writeNew() } catch (e) {
    if (e.code !== 'EEXIST') throw e
    const old = read()
    const valid = old && Number.isInteger(old.pid) && Number.isFinite(old.at)
    if (valid ? isAlive(old.pid) && clock() - old.at < 120000 : clock() - fs.statSync(file).mtimeMs < 120000) return null
    fs.unlinkSync(file)
    try { writeNew() } catch (again) { if (again.code === 'EEXIST') return null; throw again }
  }
  return {
    renew() {
      if (read()?.nonce !== nonce) return false
      const temp = file + '.' + nonce + '.tmp'
      fs.writeFileSync(temp, JSON.stringify({ component, pid, nonce, at: clock() }), { mode: 0o600 })
      fs.renameSync(temp, file); return true
    },
    release() { if (read()?.nonce === nonce) fs.unlinkSync(file) }
  }
}
module.exports = { acquireLease }
