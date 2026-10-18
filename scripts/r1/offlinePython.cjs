'use strict'
// Test entrypoints only. The trusted launcher must pin the COMPLETE public bundle
// before test discovery; this local check additionally binds the executable bytes.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const LEGACY_PYTHON = 'C:/Aroma/hindsight-runtime/Scripts/python.exe'
function resolveTestPython(env = process.env, io = fs) {
  const keys = ['R1_OFFLINE_TEST_MODE', 'R1_OFFLINE_TEST_PYTHON', 'R1_OFFLINE_TEST_PYTHON_SHA256']
  if (!keys.some(k => env[k] !== undefined)) return { python: LEGACY_PYTHON, skip: !io.existsSync(LEGACY_PYTHON) }
  if (env.R1_OFFLINE_TEST_MODE !== '1' || !env.NODE_TEST_CONTEXT) throw Error('r1_offline_python_test_mode_required')
  const python = env.R1_OFFLINE_TEST_PYTHON, pin = env.R1_OFFLINE_TEST_PYTHON_SHA256
  if (typeof python !== 'string' || !path.isAbsolute(python) || /^C:[\\/]Aroma(?:[\\/]|$)/i.test(python) ||
      !/^[a-f0-9]{64}$/.test(pin || '')) throw Error('r1_offline_python_identity_required')
  if (!io.existsSync(python)) throw Error('r1_offline_python_missing')
  const s = io.lstatSync(python)
  if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1) throw Error('r1_offline_python_alias')
  for (let p = path.dirname(python); ; p = path.dirname(p)) {
    const stat = io.lstatSync(p)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('r1_offline_python_alias')
    if (path.dirname(p) === p) break
  }
  if (io.realpathSync(python).toLowerCase() !== path.resolve(python).toLowerCase()) throw Error('r1_offline_python_alias')
  if (crypto.createHash('sha256').update(io.readFileSync(python)).digest('hex') !== pin) throw Error('r1_offline_python_hash_mismatch')
  return { python, skip: false }
}
module.exports = { resolveTestPython, LEGACY_PYTHON }
